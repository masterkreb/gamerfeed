import test from 'node:test';
import assert from 'node:assert/strict';
import {
    NEWS_SNAPSHOT_SCHEMA_VERSION,
    SNAPSHOT_CREATED_AT_HEADER,
    SNAPSHOT_DECISIONS,
    SNAPSHOT_ID_HEADER,
    SNAPSHOT_SCHEMA_HEADER,
    buildSnapshotPointer,
    compareSnapshots,
    createSnapshotId,
    decideSnapshotAcceptance,
    normalizeSnapshotPointer,
    readSnapshotHeaders,
    snapshotHeaders,
    withSnapshotQuery,
} from '../../../shared/news-snapshot.js';

// Vertrag des generationsgebundenen Leseprotokolls (O3a). Reine Rechenregeln,
// kein Netz, kein KV, keine Uhr.

function pointer(snapshotId, createdAt) {
    return buildSnapshotPointer({ snapshotId, createdAt, articleCount: 10, runId: 'gha-1' });
}

// === Kennung und Zeiger ===

test('die Kennung beginnt mit dem Zeitanteil und bleibt damit sortierbar', () => {
    const frueh = createSnapshotId('2026-07-29T10:00:00.000Z', 'gha-1');
    const spaet = createSnapshotId('2026-07-29T10:20:00.000Z', 'gha-2');

    assert.ok(frueh < spaet, `${frueh} < ${spaet}`);
    assert.match(frueh, /^\d+-gha-1$/);
});

test('die Kennung enthaelt keine unerwarteten Zeichen aus der Lauf-ID', () => {
    const id = createSnapshotId('2026-07-29T10:00:00.000Z', 'gha 1/2?x=geheim');

    assert.match(id, /^\d+-gha12xgeheim$/);
    assert.doesNotMatch(id, /[ /?=]/);
});

test('ein Zeiger ohne Lauf-ID bleibt gueltig', () => {
    const id = createSnapshotId('2026-07-29T10:00:00.000Z');
    assert.match(id, /^\d+-unknown$/);
});

test('ein gespeicherter Zeiger wird vollstaendig normalisiert', () => {
    const normalisiert = normalizeSnapshotPointer({
        schemaVersion: 1,
        snapshotId: '  1000-gha-1  ',
        createdAt: '2026-07-29T10:00:00.000Z',
        articleCount: 42.7,
        runId: 'gha-1',
    });

    assert.deepEqual(normalisiert, {
        schemaVersion: 1,
        snapshotId: '1000-gha-1',
        createdAt: '2026-07-29T10:00:00.000Z',
        articleCount: 42,
        runId: 'gha-1',
    });
});

test('ein unbrauchbarer Zeiger gilt als Legacy, nicht als Fehler', () => {
    // `null` heisst hier ausdrücklich „kein Generationswissen" - der Leser
    // fällt damit auf das Verhalten vor O3a zurück.
    for (const wert of [
        null,
        undefined,
        'kein objekt',
        [],
        {},
        { schemaVersion: 1 },
        { schemaVersion: 1, snapshotId: '   ' },
        { schemaVersion: 2, snapshotId: '1000-gha-1' },
        { schemaVersion: 0, snapshotId: '1000-gha-1' },
    ]) {
        assert.equal(normalizeSnapshotPointer(wert), null, JSON.stringify(wert));
    }
});

test('ein kaputter Zeitstempel macht den Zeiger nicht unbrauchbar', () => {
    const normalisiert = normalizeSnapshotPointer({
        schemaVersion: 1,
        snapshotId: '1000-gha-1',
        createdAt: 'irgendwann',
    });

    assert.equal(normalisiert.snapshotId, '1000-gha-1');
    assert.equal(normalisiert.createdAt, null);
});

// === Header ===

test('die Header tragen Kennung, Schemaversion und Zeitpunkt', () => {
    const headers = snapshotHeaders(pointer('1000-gha-1', '2026-07-29T10:00:00.000Z'));

    assert.equal(headers[SNAPSHOT_ID_HEADER], '1000-gha-1');
    assert.equal(headers[SNAPSHOT_SCHEMA_HEADER], String(NEWS_SNAPSHOT_SCHEMA_VERSION));
    assert.equal(headers[SNAPSHOT_CREATED_AT_HEADER], '2026-07-29T10:00:00.000Z');
});

test('ohne Zeiger gibt es keine Header', () => {
    assert.deepEqual(snapshotHeaders(null), {});
});

test('Header und Zeiger sind zueinander umkehrbar', () => {
    const original = pointer('1000-gha-1', '2026-07-29T10:00:00.000Z');
    const gelesen = readSnapshotHeaders(new Headers(snapshotHeaders(original)));

    assert.equal(gelesen.snapshotId, original.snapshotId);
    assert.equal(gelesen.createdAt, original.createdAt);
});

test('eine Antwort ohne Generations-Header gilt als Legacy', () => {
    assert.equal(readSnapshotHeaders(new Headers()), null);
    assert.equal(readSnapshotHeaders(null), null);
    assert.equal(readSnapshotHeaders({}), null);
});

test('eine unbekannte Schemaversion im Header gilt ebenfalls als Legacy', () => {
    const headers = new Headers({
        [SNAPSHOT_ID_HEADER]: '1000-gha-1',
        [SNAPSHOT_SCHEMA_HEADER]: '99',
    });

    assert.equal(readSnapshotHeaders(headers), null);
});

// === Vergleich ===

test('Generationen werden nach Zeitpunkt verglichen', () => {
    const alt = pointer('1000-gha-1', '2026-07-29T10:00:00.000Z');
    const neu = pointer('2000-gha-2', '2026-07-29T10:20:00.000Z');

    assert.equal(compareSnapshots(alt, neu), -1);
    assert.equal(compareSnapshots(neu, alt), 1);
    assert.equal(compareSnapshots(alt, alt), 0);
});

test('bei gleichem Zeitpunkt entscheidet die Kennung', () => {
    const a = pointer('1000-gha-1', '2026-07-29T10:00:00.000Z');
    const b = pointer('1000-gha-2', '2026-07-29T10:00:00.000Z');

    assert.equal(compareSnapshots(a, b), -1);
    assert.equal(compareSnapshots(b, a), 1);
});

test('ohne Zeitstempel entscheidet weiterhin die sortierbare Kennung', () => {
    const alt = normalizeSnapshotPointer({ schemaVersion: 1, snapshotId: '1000-gha-1' });
    const neu = normalizeSnapshotPointer({ schemaVersion: 1, snapshotId: '2000-gha-2' });

    assert.equal(compareSnapshots(alt, neu), -1);
});

test('Legacy gilt als aelter als jede echte Generation', () => {
    const echt = pointer('1000-gha-1', '2026-07-29T10:00:00.000Z');

    assert.equal(compareSnapshots(null, echt), -1);
    assert.equal(compareSnapshots(echt, null), 1);
    assert.equal(compareSnapshots(null, null), 0);
});

// === Die drei Regeln des Leseprotokolls ===

test('die erste brauchbare Antwort legt die Generation fest', () => {
    const eingehend = pointer('1000-gha-1', '2026-07-29T10:00:00.000Z');
    const entscheidung = decideSnapshotAcceptance({ pinned: null, incoming: eingehend });

    assert.equal(entscheidung.accept, true);
    assert.equal(entscheidung.pin, eingehend);
    assert.equal(entscheidung.reason, SNAPSHOT_DECISIONS.FIRST_GENERATION);
});

test('dieselbe Generation wird uebernommen, ohne umzupinnen', () => {
    const gepinnt = pointer('1000-gha-1', '2026-07-29T10:00:00.000Z');
    const entscheidung = decideSnapshotAcceptance({
        pinned: gepinnt,
        incoming: pointer('1000-gha-1', '2026-07-29T10:00:00.000Z'),
    });

    assert.equal(entscheidung.accept, true);
    assert.equal(entscheidung.pin, gepinnt);
    assert.equal(entscheidung.reason, SNAPSHOT_DECISIONS.SAME_GENERATION);
});

test('eine neuere Generation wird uebernommen und umgepinnt', () => {
    // Genau das verhindert den beobachteten Fall: ein Browser, dessen erster
    // Stand GameStar noch nicht kennt, übernimmt die vollständige neuere
    // Generation statt dauerhaft daneben zu liegen.
    const alt = pointer('1000-gha-1', '2026-07-29T10:00:00.000Z');
    const neu = pointer('2000-gha-2', '2026-07-29T10:20:00.000Z');

    const entscheidung = decideSnapshotAcceptance({ pinned: alt, incoming: neu });

    assert.equal(entscheidung.accept, true);
    assert.equal(entscheidung.pin, neu);
    assert.equal(entscheidung.reason, SNAPSHOT_DECISIONS.NEWER_GENERATION);
});

test('eine aeltere Generation wird verworfen', () => {
    const alt = pointer('1000-gha-1', '2026-07-29T10:00:00.000Z');
    const neu = pointer('2000-gha-2', '2026-07-29T10:20:00.000Z');

    const entscheidung = decideSnapshotAcceptance({ pinned: neu, incoming: alt });

    assert.equal(entscheidung.accept, false);
    assert.equal(entscheidung.pin, neu, 'die gepinnte Generation bleibt stehen');
    assert.equal(entscheidung.reason, SNAPSHOT_DECISIONS.OLDER_GENERATION);
});

test('ohne jede Generationsangabe bleibt das Legacy-Verhalten', () => {
    const entscheidung = decideSnapshotAcceptance({ pinned: null, incoming: null });

    assert.equal(entscheidung.accept, true);
    assert.equal(entscheidung.pin, null);
    assert.equal(entscheidung.reason, SNAPSHOT_DECISIONS.LEGACY);
});

test('eine Legacy-Antwort darf eine gepinnte Generation nicht zurueckdrehen', () => {
    // Der Edge-Cache-Fall: eine Kopie von vor der Migration trägt keine Header.
    const gepinnt = pointer('2000-gha-2', '2026-07-29T10:20:00.000Z');
    const entscheidung = decideSnapshotAcceptance({ pinned: gepinnt, incoming: null });

    assert.equal(entscheidung.accept, false);
    assert.equal(entscheidung.pin, gepinnt);
    assert.equal(entscheidung.reason, SNAPSHOT_DECISIONS.LEGACY_AFTER_GENERATION);
});

test('eine echte Generation loest einen Legacy-Stand ab', () => {
    // Die Migrationsrichtung: erst Legacy sichtbar, dann die erste echte
    // Generation - die muss übernommen werden.
    const neu = pointer('1000-gha-1', '2026-07-29T10:00:00.000Z');
    const entscheidung = decideSnapshotAcceptance({ pinned: null, incoming: neu });

    assert.equal(entscheidung.accept, true);
    assert.equal(entscheidung.pin, neu);
});

test('ein leerer Aufruf entscheidet wie Legacy', () => {
    assert.deepEqual(decideSnapshotAcceptance(), {
        accept: true,
        pin: null,
        reason: SNAPSHOT_DECISIONS.LEGACY,
    });
});

// === Adressbau ===

test('die gepinnte Generation haengt an der Adresse', () => {
    const gepinnt = pointer('1000-gha-1', '2026-07-29T10:00:00.000Z');

    assert.equal(withSnapshotQuery('/api/get-news', gepinnt), '/api/get-news?snapshot=1000-gha-1');
    assert.equal(
        withSnapshotQuery('/api/get-news?x=1', gepinnt),
        '/api/get-news?x=1&snapshot=1000-gha-1',
    );
});

test('ohne gepinnte Generation bleibt die Adresse unveraendert', () => {
    assert.equal(withSnapshotQuery('/api/get-news', null), '/api/get-news');
    assert.equal(withSnapshotQuery('/api/get-news', {}), '/api/get-news');
});

test('eine Kennung mit Sonderzeichen wird kodiert', () => {
    const gepinnt = { snapshotId: 'a b&c' };
    assert.equal(withSnapshotQuery('/api/get-news', gepinnt), '/api/get-news?snapshot=a%20b%26c');
});
