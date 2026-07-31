// Speicheradapter der begrenzten Laufhistorie (Roadmap-Paket O4b).
//
// Kein echter KV-Zugriff, kein Netz, keine Wartezeit: die Attrappe unten bildet
// genau die drei benutzten Sorted-Set-Befehle nach und protokolliert dabei, in
// welcher Transaktion sie gelandet sind. Nur so ist die eigentliche Zusage
// prüfbar - `zadd` und das Kürzen laufen **gemeinsam**.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FEED_RUN_HISTORY_KEY,
    FEED_RUN_HISTORY_LIMIT,
    buildRunHistoryEntry,
} from '../../../shared/feed-run-history.js';
import {
    appendRunHistoryEntry,
    readRunHistory,
} from '../../../shared/feed-run-history-store.js';

const BASIS_MS = Date.parse('2026-07-28T12:00:00.000Z');

function laufEintrag({ runId = 'gha-1', finishedAtMs = BASIS_MS, result = 'success' } = {}) {
    return buildRunHistoryEntry({
        runId,
        startedAt: new Date(finishedAtMs - 90_000).toISOString(),
        finishedAt: new Date(finishedAtMs).toISOString(),
        result,
        degradedReason: result === 'degraded' ? 'Bildbeschaffung zurückgestellt' : null,
        fatalError: result === 'fatal' ? 'Abbruch' : null,
        feeds: { total: 2, success: 2, warning: 0, error: 0, unknown: 0 },
        durations: { totalMs: 90_000 },
    });
}

/**
 * Sorted Set als Attrappe.
 *
 * `automaticDeserialization` bildet nach, dass der echte KV-Client Member als
 * JSON ablegt und beim Lesen wieder auspackt.
 */
function createSortedSetStore({ failOn = null, entries = [] } = {}) {
    const members = new Map(entries.map(entry => [JSON.stringify(entry), entry.score ?? 0]));
    const transactions = [];

    function sortedMembers() {
        return [...members.entries()]
            .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] - b[1]));
    }

    const store = {
        transactions,
        members,
        multi() {
            const commands = [];
            transactions.push(commands);

            return {
                zadd(key, { score, member }) {
                    commands.push({ command: 'zadd', key, score, member });
                    return this;
                },
                zremrangebyrank(key, start, stop) {
                    commands.push({ command: 'zremrangebyrank', key, start, stop });
                    return this;
                },
                async exec() {
                    if (failOn === 'exec') throw new Error('Transaktion abgelehnt');

                    const ergebnisse = [];
                    for (const befehl of commands) {
                        if (befehl.command === 'zadd') {
                            members.set(JSON.stringify(befehl.member), befehl.score);
                            ergebnisse.push(1);
                        } else {
                            const alle = sortedMembers();
                            const start = befehl.start < 0 ? alle.length + befehl.start : befehl.start;
                            const stop = befehl.stop < 0 ? alle.length + befehl.stop : befehl.stop;
                            let entfernt = 0;
                            for (let index = start; index <= stop && index < alle.length; index += 1) {
                                if (index < 0) continue;
                                members.delete(alle[index][0]);
                                entfernt += 1;
                            }
                            ergebnisse.push(entfernt);
                        }
                    }
                    return ergebnisse;
                },
            };
        },
        async zrange(key, min, max, options = {}) {
            if (failOn === 'zrange') throw new Error('Sorted Set nicht lesbar');

            const alle = sortedMembers();
            const geordnet = options.rev === true ? [...alle].reverse() : alle;
            return geordnet.slice(min, max + 1).map(([serialisiert]) => JSON.parse(serialisiert));
        },
    };

    if (failOn === 'multi') {
        delete store.multi;
    }
    if (failOn === 'kein-zrange') {
        delete store.zrange;
    }

    return store;
}

test('zadd und Kürzen laufen in derselben Transaktion', async () => {
    const store = createSortedSetStore();

    const ergebnis = await appendRunHistoryEntry(store, laufEintrag());

    assert.deepEqual(ergebnis, { ok: true, written: true, error: null });
    assert.equal(store.transactions.length, 1, 'genau eine Transaktion');

    const [befehle] = store.transactions;
    assert.deepEqual(befehle.map(befehl => befehl.command), ['zadd', 'zremrangebyrank']);
    assert.equal(befehle[0].key, FEED_RUN_HISTORY_KEY);
    assert.equal(befehle[1].key, FEED_RUN_HISTORY_KEY);
});

test('der Score ist finishedAt in Millisekunden', async () => {
    const store = createSortedSetStore();
    await appendRunHistoryEntry(store, laufEintrag({ finishedAtMs: BASIS_MS }));

    assert.equal(store.transactions[0][0].score, BASIS_MS);
});

test('das Kürzen lässt genau die neuesten Einträge stehen', async () => {
    const store = createSortedSetStore();
    await appendRunHistoryEntry(store, laufEintrag());

    const trim = store.transactions[0][1];
    assert.equal(trim.start, 0);
    assert.equal(trim.stop, -FEED_RUN_HISTORY_LIMIT - 1, 'Rang 0 bis -73 fällt weg');
});

test('nach mehr als 72 Läufen bleiben genau die 72 neuesten übrig', async () => {
    const store = createSortedSetStore();

    // 80 Läufe im Abstand von 20 Minuten, wie geplant.
    for (let index = 0; index < 80; index += 1) {
        await appendRunHistoryEntry(store, laufEintrag({
            runId: `gha-${index}`,
            finishedAtMs: BASIS_MS + index * 20 * 60_000,
        }));
    }

    // Entscheidend ist der **gespeicherte** Umfang, nicht nur der gelesene:
    // ohne das Kürzen in der Transaktion wüchse der Sorted Set unbegrenzt und
    // die Begrenzung wäre bloss eine Anzeigefrage.
    assert.equal(store.members.size, FEED_RUN_HISTORY_LIMIT, 'der Sorted Set selbst ist begrenzt');

    const gelesen = await readRunHistory(store);

    assert.equal(gelesen.length, FEED_RUN_HISTORY_LIMIT);
    assert.equal(gelesen[0].runId, 'gha-79', 'neuester Lauf zuerst');
    assert.equal(gelesen.at(-1).runId, 'gha-8', 'ältere fallen deterministisch heraus');
    assert.ok(
        gelesen.every(eintrag => Number(eintrag.runId.split('-')[1]) >= 8),
        'die acht ältesten Läufe sind weg',
    );
});

test('ein verspätet eintreffender Lauf wird nach finishedAt einsortiert, nicht nach Schreibreihenfolge', async () => {
    const store = createSortedSetStore();

    await appendRunHistoryEntry(store, laufEintrag({ runId: 'neu', finishedAtMs: BASIS_MS }));
    // Ein GitHub-Lauf, der verspätet startete und deshalb später schreibt,
    // obwohl er früher fertig war.
    await appendRunHistoryEntry(store, laufEintrag({ runId: 'alt', finishedAtMs: BASIS_MS - 60 * 60_000 }));

    const gelesen = await readRunHistory(store);
    assert.deepEqual(gelesen.map(eintrag => eintrag.runId), ['neu', 'alt']);
});

test('auch außerhalb der Reihenfolge eintreffende Läufe werden anhand finishedAt begrenzt', async () => {
    const store = createSortedSetStore();

    // Absichtlich gemischte Schreibreihenfolge: der zu alte Lauf kommt zuletzt.
    const zeiten = [];
    for (let index = 0; index < FEED_RUN_HISTORY_LIMIT; index += 1) {
        zeiten.push(BASIS_MS + index * 20 * 60_000);
    }
    for (const zeit of [...zeiten].reverse()) {
        await appendRunHistoryEntry(store, laufEintrag({ runId: `gha-${zeit}`, finishedAtMs: zeit }));
    }

    const zuAlt = BASIS_MS - 20 * 60_000;
    await appendRunHistoryEntry(store, laufEintrag({ runId: 'zu-alt', finishedAtMs: zuAlt }));

    assert.equal(store.members.size, FEED_RUN_HISTORY_LIMIT, 'der zu alte Lauf ist gar nicht erst gespeichert');

    const gelesen = await readRunHistory(store);
    assert.equal(gelesen.length, FEED_RUN_HISTORY_LIMIT);
    assert.ok(
        !gelesen.some(eintrag => eintrag.runId === 'zu-alt'),
        'der älteste Lauf fällt heraus, obwohl er zuletzt geschrieben wurde',
    );
    assert.equal(gelesen[0].finishedAt, new Date(zeiten.at(-1)).toISOString());
});

test('gelesen wird absteigend nach Abschlusszeit', async () => {
    const store = createSortedSetStore();
    for (const versatz of [0, -40 * 60_000, -20 * 60_000]) {
        await appendRunHistoryEntry(store, laufEintrag({
            runId: `gha${versatz}`,
            finishedAtMs: BASIS_MS + versatz,
        }));
    }

    const gelesen = await readRunHistory(store);
    const zeiten = gelesen.map(eintrag => Date.parse(eintrag.finishedAt));

    assert.deepEqual(zeiten, [...zeiten].sort((a, b) => b - a));
});

test('eine leere Historie ergibt eine leere Liste, keinen Fehler', async () => {
    assert.deepEqual(await readRunHistory(createSortedSetStore()), []);
});

test('beschädigte Einträge werden isoliert übersprungen', async () => {
    const store = createSortedSetStore();
    await appendRunHistoryEntry(store, laufEintrag({ runId: 'gut', finishedAtMs: BASIS_MS }));

    // Direkt in den Sorted Set geschmuggelt, wie es ein älteres Schema oder ein
    // manueller Eingriff hinterlassen würde.
    store.members.set(JSON.stringify({ result: 'running', startedAt: 'x' }), BASIS_MS - 1000);
    store.members.set(JSON.stringify({ kaputt: true }), BASIS_MS - 2000);
    store.members.set('"kein Objekt"', BASIS_MS - 3000);

    const gelesen = await readRunHistory(store);

    assert.equal(gelesen.length, 1);
    assert.equal(gelesen[0].runId, 'gut');
});

test('nicht parsbarer Text im Sorted Set fällt heraus, statt zu werfen', async () => {
    const store = createSortedSetStore();
    await appendRunHistoryEntry(store, laufEintrag({ runId: 'gut' }));

    // Ein Client ohne automatische Deserialisierung liefert Zeichenketten.
    const roh = [JSON.stringify(laufEintrag({ runId: 'gut' })), '{kein json', 'null'];
    const rohStore = { zrange: async () => roh };

    const gelesen = await readRunHistory(rohStore);
    assert.deepEqual(gelesen.map(eintrag => eintrag.runId), ['gut']);
});

test('ein Schreibfehler wirft nicht nach außen', async () => {
    const store = createSortedSetStore({ failOn: 'exec' });

    const ergebnis = await appendRunHistoryEntry(store, laufEintrag());

    assert.equal(ergebnis.ok, false);
    assert.equal(ergebnis.written, false);
    assert.match(ergebnis.error, /Transaktion abgelehnt/);
});

test('ein Speicher ohne Transaktion wirft nicht nach außen', async () => {
    const ergebnis = await appendRunHistoryEntry(createSortedSetStore({ failOn: 'multi' }), laufEintrag());

    assert.equal(ergebnis.ok, false);
    assert.match(ergebnis.error, /multi/);
});

test('ein Eintrag ohne verwertbares finishedAt wird gar nicht erst geschrieben', async () => {
    const store = createSortedSetStore();

    const ergebnis = await appendRunHistoryEntry(store, { runId: 'gha-1', finishedAt: 'irgendwann' });

    assert.equal(ergebnis.ok, false);
    assert.equal(store.transactions.length, 0, 'keine Transaktion begonnen');
});

test('ein Lesefehler wird weitergereicht, damit „leer“ und „nicht lesbar“ unterscheidbar bleiben', async () => {
    await assert.rejects(
        () => readRunHistory(createSortedSetStore({ failOn: 'zrange' })),
        /Sorted Set nicht lesbar/,
    );
});

test('ein Speicher ohne Sorted-Set-Zugriff meldet das als Lesefehler', async () => {
    await assert.rejects(
        () => readRunHistory(createSortedSetStore({ failOn: 'kein-zrange' })),
        /zrange/,
    );
});

test('derselbe Lauf zweimal geschrieben ergibt keinen doppelten Eintrag', async () => {
    const store = createSortedSetStore();
    const eintrag = laufEintrag({ runId: 'gha-doppelt' });

    await appendRunHistoryEntry(store, eintrag);
    await appendRunHistoryEntry(store, eintrag);

    const gelesen = await readRunHistory(store);
    assert.equal(gelesen.length, 1);
});

test('ein eigener Schlüssel und ein eigenes Limit werden durchgereicht', async () => {
    const store = createSortedSetStore();

    await appendRunHistoryEntry(store, laufEintrag(), { key: 'test_history', limit: 5 });

    const [zadd, trim] = store.transactions[0];
    assert.equal(zadd.key, 'test_history');
    assert.equal(trim.key, 'test_history');
    assert.equal(trim.stop, -6);
});
