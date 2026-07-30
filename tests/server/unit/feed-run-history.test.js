// Datenmodell der begrenzten Laufhistorie (Roadmap-Paket O4b).
//
// Reine Rechenregeln: keine KV-, SQL-, Netz- oder Wartezugriffe. Alle
// Zeitstempel sind feste Konstanten.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FEED_RUN_HISTORY_KEY,
    FEED_RUN_HISTORY_LIMIT,
    FEED_RUN_HISTORY_RESULTS,
    FEED_RUN_HISTORY_SCHEMA_VERSION,
    buildRunHistoryEntry,
    normalizeRunHistory,
    normalizeRunHistoryEntry,
    runHistoryScore,
    summarizeRunHistory,
} from '../../../shared/feed-run-history.js';

const STARTED_AT = '2026-07-28T11:58:00.000Z';
const FINISHED_AT = '2026-07-28T12:00:00.000Z';

function finishedRun(overrides = {}) {
    return {
        schemaVersion: 1,
        runId: 'gha-4711-1',
        startedAt: STARTED_AT,
        finishedAt: FINISHED_AT,
        result: 'success',
        fatalError: null,
        degradedReason: null,
        feeds: { total: 4, success: 3, warning: 1, error: 0, unknown: 0 },
        durations: { totalMs: 120_000, feedFetchMs: 40_000, publishMs: 900 },
        ...overrides,
    };
}

test('die Schlüssel- und Grenzkonstanten sind festgelegt', () => {
    assert.equal(FEED_RUN_HISTORY_KEY, 'feed_run_history');
    assert.equal(FEED_RUN_HISTORY_LIMIT, 72);
    assert.equal(FEED_RUN_HISTORY_SCHEMA_VERSION, 1);
    assert.deepEqual([...FEED_RUN_HISTORY_RESULTS], ['success', 'degraded', 'fatal']);
});

test('ein abgeschlossener Lauf ergibt einen vollständigen Eintrag', () => {
    const entry = buildRunHistoryEntry(finishedRun());

    assert.deepEqual(entry, {
        schemaVersion: 1,
        runId: 'gha-4711-1',
        startedAt: STARTED_AT,
        finishedAt: FINISHED_AT,
        result: 'success',
        degradedReason: null,
        fatalError: null,
        feeds: { total: 4, success: 3, warning: 1, error: 0, unknown: 0 },
        durations: {
            totalMs: 120_000,
            feedFetchMs: 40_000,
            imageScrapeMs: null,
            imageBackfillMs: null,
            publishMs: 900,
            trendsMs: null,
        },
    });
});

test('nur abgeschlossene Ergebnisse werden angenommen', () => {
    for (const result of ['success', 'degraded', 'fatal']) {
        assert.equal(buildRunHistoryEntry(finishedRun({ result }))?.result, result, result);
    }
});

test('ein laufender Versuch gehört nicht in die Historie', () => {
    // `running` hat konstruktionsbedingt kein `finishedAt` - selbst mit einem
    // wäre der Versuch nicht abgeschlossen und dürfte keinen Eintrag ergeben.
    assert.equal(buildRunHistoryEntry(finishedRun({ result: 'running', finishedAt: null })), null);
    assert.equal(buildRunHistoryEntry(finishedRun({ result: 'running' })), null);
});

test('unbekannte Ergebnisse werden abgelehnt statt auf success abgebildet', () => {
    for (const result of ['erfolgreich', '', null, undefined, 42, { result: 'success' }]) {
        assert.equal(buildRunHistoryEntry(finishedRun({ result })), null, JSON.stringify(result));
    }
});

test('beschädigte Zeitstempel werden abgelehnt', () => {
    const kaputt = [
        { finishedAt: null },
        { finishedAt: 'irgendwann' },
        { finishedAt: '' },
        { startedAt: null },
        { startedAt: 'gestern' },
    ];

    for (const overrides of kaputt) {
        assert.equal(buildRunHistoryEntry(finishedRun(overrides)), null, JSON.stringify(overrides));
    }
});

test('kein Objekt ergibt keinen Eintrag', () => {
    for (const raw of [null, undefined, 'success', 7, [finishedRun()]]) {
        assert.equal(buildRunHistoryEntry(raw), null, JSON.stringify(raw));
    }
});

test('Zähler und Dauern werden normalisiert', () => {
    const entry = buildRunHistoryEntry(finishedRun({
        feeds: { total: 4.7, success: -1, warning: 'zwei', error: null, unknown: 3 },
        durations: { totalMs: -5, feedFetchMs: 'lang', publishMs: 800 },
    }));

    assert.deepEqual(entry.feeds, { total: 4, success: 0, warning: 0, error: 0, unknown: 3 });
    assert.deepEqual(entry.durations, {
        totalMs: null,
        feedFetchMs: null,
        imageScrapeMs: null,
        imageBackfillMs: null,
        publishMs: 800,
        trendsMs: null,
    });
});

test('fehlende Zähler und Dauern ergeben Nullwerte statt undefined', () => {
    const entry = buildRunHistoryEntry({
        runId: 'gha-1',
        startedAt: STARTED_AT,
        finishedAt: FINISHED_AT,
        result: 'success',
    });

    assert.deepEqual(entry.feeds, { total: 0, success: 0, warning: 0, error: 0, unknown: 0 });
    assert.equal(entry.durations.totalMs, null);
    assert.equal(entry.runId, 'gha-1');
});

test('eine leere Lauf-Kennung wird zu null statt zu einem leeren String', () => {
    assert.equal(buildRunHistoryEntry(finishedRun({ runId: '' })).runId, null);
    assert.equal(buildRunHistoryEntry(finishedRun({ runId: 4711 })).runId, null);
});

test('genau ein Grundfeld je Ergebnis', () => {
    const degraded = buildRunHistoryEntry(finishedRun({
        result: 'degraded',
        degradedReason: 'Bildbeschaffung zurückgestellt',
        fatalError: 'sollte hier nicht stehen',
    }));
    assert.equal(degraded.degradedReason, 'Bildbeschaffung zurückgestellt');
    assert.equal(degraded.fatalError, null, 'ein eingeschränkter Lauf trägt keinen Fatalfehler');

    const fatal = buildRunHistoryEntry(finishedRun({
        result: 'fatal',
        fatalError: 'Verbindung abgebrochen',
        degradedReason: 'sollte hier nicht stehen',
    }));
    assert.equal(fatal.fatalError, 'Verbindung abgebrochen');
    assert.equal(fatal.degradedReason, null, 'ein Abbruch trägt keine Zurückstellung');

    const success = buildRunHistoryEntry(finishedRun({
        degradedReason: 'sollte hier nicht stehen',
        fatalError: 'auch nicht',
    }));
    assert.equal(success.degradedReason, null);
    assert.equal(success.fatalError, null);
});

test('Gründe werden auf 300 Zeichen begrenzt', () => {
    const entry = buildRunHistoryEntry(finishedRun({
        result: 'fatal',
        fatalError: 'x'.repeat(600),
    }));

    assert.equal(entry.fatalError.length, 301, '300 Zeichen plus Auslassungszeichen');
    assert.ok(entry.fatalError.endsWith('…'));
});

test('URI-Zugangsdaten und Querystrings landen nicht in der Historie', () => {
    const entry = buildRunHistoryEntry(finishedRun({
        result: 'fatal',
        fatalError: 'connect ECONNREFUSED postgres://nutzer:pg-geheim@db.example/main '
            + 'sowie https://proxy.example/feed-proxy.php?key=proxy-geheim',
    }));

    assert.ok(!entry.fatalError.includes('pg-geheim'), 'keine Zugangsdaten');
    assert.ok(!entry.fatalError.includes('proxy-geheim'), 'kein Querystring-Token');
    assert.ok(entry.fatalError.includes('postgres://db.example/main'));
    assert.ok(entry.fatalError.includes('https://proxy.example/feed-proxy.php?[redacted]'));
});

test('konfigurierte Secrets werden entfernt, auch ohne Adressform', () => {
    const entry = buildRunHistoryEntry(
        finishedRun({ result: 'fatal', fatalError: 'Token kv-token-geheim abgelehnt' }),
        { secrets: ['kv-token-geheim'] },
    );

    assert.ok(!entry.fatalError.includes('kv-token-geheim'));
    assert.ok(entry.fatalError.includes('[redacted]'));
});

test('die Redaktion des Aufrufers läuft vor der gemeinsamen Bereinigung', () => {
    const entry = buildRunHistoryEntry(
        finishedRun({ result: 'degraded', degradedReason: 'Scrape-Budget gsk-groq-geheim' }),
        { redact: message => message.split('gsk-groq-geheim').join('[redacted]') },
    );

    assert.equal(entry.degradedReason, 'Scrape-Budget [redacted]');
});

test('ein leerer Grund wird zu null statt zu einer leeren Zeichenkette', () => {
    const entry = buildRunHistoryEntry(finishedRun({ result: 'degraded', degradedReason: '   ' }));
    assert.equal(entry.degradedReason, null);
});

test('gelesene Einträge folgen denselben Regeln wie geschriebene', () => {
    assert.deepEqual(normalizeRunHistoryEntry(finishedRun()), buildRunHistoryEntry(finishedRun()));
    assert.equal(normalizeRunHistoryEntry({ result: 'running', startedAt: STARTED_AT }), null);
});

test('normalizeRunHistory überspringt beschädigte Elemente isoliert', () => {
    const entries = normalizeRunHistory([
        finishedRun({ runId: 'gha-1', finishedAt: '2026-07-28T12:00:00.000Z' }),
        null,
        'kein Objekt',
        { result: 'running', startedAt: STARTED_AT },
        finishedRun({ runId: 'gha-2', finishedAt: '2026-07-28T11:40:00.000Z' }),
        { ...finishedRun(), finishedAt: 'irgendwann' },
    ]);

    assert.deepEqual(entries.map(entry => entry.runId), ['gha-1', 'gha-2']);
});

test('normalizeRunHistory sortiert neueste zuerst, unabhängig von der Eingabereihenfolge', () => {
    const entries = normalizeRunHistory([
        finishedRun({ runId: 'mitte', finishedAt: '2026-07-28T11:40:00.000Z' }),
        finishedRun({ runId: 'älteste', finishedAt: '2026-07-28T11:20:00.000Z' }),
        finishedRun({ runId: 'neueste', finishedAt: '2026-07-28T12:00:00.000Z' }),
    ]);

    assert.deepEqual(entries.map(entry => entry.runId), ['neueste', 'mitte', 'älteste']);
});

test('normalizeRunHistory begrenzt die Ausgabe', () => {
    const raw = Array.from({ length: 10 }, (_, index) => finishedRun({
        runId: `gha-${index}`,
        finishedAt: new Date(Date.parse(FINISHED_AT) - index * 60_000).toISOString(),
    }));

    assert.equal(normalizeRunHistory(raw, { limit: 3 }).length, 3);
    assert.deepEqual(
        normalizeRunHistory(raw, { limit: 3 }).map(entry => entry.runId),
        ['gha-0', 'gha-1', 'gha-2'],
    );
});

test('normalizeRunHistory verträgt Eingaben, die keine Liste sind', () => {
    for (const raw of [null, undefined, {}, 'nichts', 7]) {
        assert.deepEqual(normalizeRunHistory(raw), [], JSON.stringify(raw));
    }
});

test('die Zusammenfassung zählt nur die sichtbaren Einträge', () => {
    const summary = summarizeRunHistory([
        buildRunHistoryEntry(finishedRun({ result: 'success' })),
        buildRunHistoryEntry(finishedRun({ result: 'degraded', degradedReason: 'Deadline' })),
        buildRunHistoryEntry(finishedRun({ result: 'fatal', fatalError: 'Abbruch' })),
        buildRunHistoryEntry(finishedRun({ result: 'fatal', fatalError: 'Abbruch' })),
        { result: 'running' },
        null,
    ]);

    assert.deepEqual(summary, { total: 4, success: 1, degraded: 1, fatal: 2 });
});

test('die Zusammenfassung verträgt eine leere oder fehlende Historie', () => {
    assert.deepEqual(summarizeRunHistory([]), { total: 0, success: 0, degraded: 0, fatal: 0 });
    assert.deepEqual(summarizeRunHistory(null), { total: 0, success: 0, degraded: 0, fatal: 0 });
});

test('der Sortierschlüssel ist finishedAt in Millisekunden', () => {
    assert.equal(runHistoryScore({ finishedAt: FINISHED_AT }), Date.parse(FINISHED_AT));
    assert.equal(runHistoryScore({ finishedAt: 'irgendwann' }), null);
    assert.equal(runHistoryScore({}), null);
    assert.equal(runHistoryScore(null), null);
});
