import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SUMMARY_MAX_FEED_ROWS,
    buildRunSummary,
    computeFeedRates,
    renderRunSummaryMarkdown,
    writeRunSummary,
} from '../../../scripts/feed-run-summary.js';
import { sanitizeErrorMessage } from '../../../shared/feed-health-model.js';

// Bereinigung wie im Cron-Lauf: dieselben Secrets, dieselbe Funktion.
const SECRETS = Object.freeze([
    'pg-geheim',
    'kv-token-geheim',
    'gsk-groq-geheim',
    'proxy-geheim',
]);

const redact = message => sanitizeErrorMessage(message, { secrets: SECRETS }) ?? '';

const FEEDS = Object.freeze([
    Object.freeze({ id: 'gamestar', name: 'GameStar', url: 'https://www.gamestar.de/feed.xml' }),
    Object.freeze({ id: 'gamepro', name: 'GamePro', url: 'https://www.gamepro.de/feed.xml' }),
    Object.freeze({ id: 'vg247', name: 'VG247', url: 'https://www.vg247.com/feed' }),
    Object.freeze({ id: 'buffed', name: 'Buffed', url: 'https://www.buffed.de/feed.xml' }),
]);

const FEED_HEALTH = Object.freeze({
    // Direkter Erfolg.
    gamestar: {
        status: 'success',
        message: 'Successfully fetched and parsed 12 articles.',
        durationMs: 820,
        articleCount: 12,
        skippedItemCount: 1,
    },
    // Erfolg erst über den Proxy.
    gamepro: {
        status: 'success',
        message: 'Successfully fetched and parsed 7 articles.',
        durationMs: 3400,
        articleCount: 7,
        skippedItemCount: 0,
    },
    // Endgültiger Abruffehler.
    vg247: {
        status: 'error',
        message: 'Fetch failed. Error: Direct fetch failed with status 503',
        durationMs: 15000,
        articleCount: null,
        skippedItemCount: 0,
    },
    // Wegen Deadline zurückgestellt: kein Fehler dieser Quelle.
    buffed: {
        status: 'warning',
        message: 'Zurückgestellt: Zeitbudget des Laufs erschöpft.',
        durationMs: null,
        articleCount: null,
        skippedItemCount: 0,
    },
});

const TRANSPORTS = new Map([
    ['gamestar', { transport: 'direct', httpStatus: 200 }],
    ['gamepro', { transport: 'proxy', httpStatus: 200 }],
    ['vg247', { transport: 'none', httpStatus: 503 }],
    ['buffed', { transport: 'none', httpStatus: null }],
]);

const RUN = Object.freeze({
    runId: '2026-07-30T12-00-lauf',
    result: 'success',
    startedAt: '2026-07-30T12:00:00.000Z',
    finishedAt: '2026-07-30T12:04:30.000Z',
    fatalError: null,
    degradedReason: null,
    feeds: { total: 4, success: 2, warning: 1, error: 1, unknown: 0 },
    durations: {
        totalMs: 270000,
        feedFetchMs: 120000,
        imageScrapeMs: 40000,
        imageBackfillMs: null,
        publishMs: 8000,
        trendsMs: 90000,
    },
});

const SNAPSHOT = Object.freeze({
    pointer: { snapshotId: '1785412800000-lauf', createdAt: '2026-07-30T12:00:00.000Z' },
    payloads: {
        full: { articles: new Array(940), bytes: 8_100_000 },
        medium: { articles: new Array(64), bytes: 540_000 },
        preview: { articles: new Array(16), bytes: 130_000 },
    },
});

function summary(overrides = {}) {
    return buildRunSummary({
        run: RUN,
        feeds: FEEDS,
        feedHealth: FEED_HEALTH,
        transports: TRANSPORTS,
        snapshot: SNAPSHOT,
        redact,
        ...overrides,
    });
}

const rowFor = (report, name) => report.feeds.find(entry => entry.name === name);

// === Fehlerquote =============================================================

test('die Fehlerquote hat einen dokumentierten Nenner und vermischt nichts', () => {
    // Nenner sind nur bewertete Feeds; `unknown` wurde gar nicht beurteilt.
    const rates = computeFeedRates({ total: 10, success: 5, warning: 2, error: 1, unknown: 2 });

    assert.equal(rates.evaluated, 8, 'success + warning + error');
    assert.equal(rates.errorRate, 1 / 8);
    assert.equal(rates.warningRate, 2 / 8, 'Warnungen bleiben getrennt sichtbar');
    assert.equal(rates.unknown, 2);
});

test('ohne bewertete Feeds gibt es keine erfundene Quote', () => {
    const rates = computeFeedRates({ total: 3, success: 0, warning: 0, error: 0, unknown: 3 });

    assert.equal(rates.evaluated, 0);
    assert.equal(rates.errorRate, null);
    assert.equal(rates.warningRate, null);
});

// === Aufbau des Berichts =====================================================

test('der Bericht nennt Lauf-ID, Ergebnis, Dauern und Zähler', () => {
    const report = summary();

    assert.equal(report.runId, RUN.runId);
    assert.equal(report.result, 'success');
    assert.equal(report.reason, null, 'ein erfolgreicher Lauf hat keinen Grund');
    assert.equal(report.durations.totalMs, 270000);
    assert.equal(report.durations.imageBackfillMs, null, 'nicht gelaufene Phasen bleiben leer');
    assert.deepEqual(report.counters, { total: 4, success: 2, warning: 1, error: 1, unknown: 0 });
    assert.equal(report.rates.evaluated, 4);
    assert.equal(report.rates.errorRate, 0.25);
});

test('Snapshot-Kennung, Artikelzahlen und Bytegrößen stammen aus dem Publish', () => {
    const report = summary();

    assert.equal(report.snapshot.snapshotId, '1785412800000-lauf');
    assert.deepEqual(report.snapshot.full, { count: 940, bytes: 8_100_000 });
    assert.deepEqual(report.snapshot.medium, { count: 64, bytes: 540_000 });
    assert.deepEqual(report.snapshot.preview, { count: 16, bytes: 130_000 });
});

test('ohne Publish bleibt die Snapshot-Angabe leer statt geraten', () => {
    const report = summary({ snapshot: null });
    assert.equal(report.snapshot, null);
});

test('der Transport unterscheidet direkt, Proxy und gar nicht', () => {
    const report = summary();

    assert.equal(rowFor(report, 'GameStar').transport, 'direct');
    assert.equal(rowFor(report, 'GameStar').httpStatus, 200);

    // `proxy` heisst: die erfolgreiche Antwort kam wirklich vom Proxy.
    assert.equal(rowFor(report, 'GamePro').transport, 'proxy');
    assert.equal(rowFor(report, 'GamePro').httpStatus, 200);

    assert.equal(rowFor(report, 'VG247').transport, 'none');
    assert.equal(rowFor(report, 'VG247').httpStatus, 503);

    // Zurückgestellt: kein Transport und kein erfundener Status.
    assert.equal(rowFor(report, 'Buffed').transport, 'none');
    assert.equal(rowFor(report, 'Buffed').httpStatus, null);
});

test('ein unbekannter Transport wird zu none statt geraten', () => {
    const report = summary({ transports: new Map() });

    for (const entry of report.feeds) {
        assert.equal(entry.transport, 'none');
        assert.equal(entry.httpStatus, null);
    }
});

test('nur in diesem Lauf gelieferte Artikel zählen', () => {
    const report = summary();

    assert.equal(rowFor(report, 'GameStar').articleCount, 12);
    assert.equal(rowFor(report, 'GameStar').skippedItemCount, 1);
    // Eine zurückgestellte Quelle behält ihre alten Artikel - geliefert hat sie
    // in diesem Lauf trotzdem nichts.
    assert.equal(rowFor(report, 'Buffed').articleCount, null);
    assert.equal(rowFor(report, 'VG247').articleCount, null);
});

test('degraded und fatal tragen ihren bereinigten Grund', () => {
    const degraded = summary({
        run: {
            ...RUN,
            result: 'degraded',
            degradedReason: '3 Quelle(n) wegen Zeitbudget zurückgestellt',
        },
    });
    assert.equal(degraded.result, 'degraded');
    assert.match(degraded.reason, /zurückgestellt/);

    const fatal = summary({
        run: {
            ...RUN,
            result: 'fatal',
            fatalError: 'connect ECONNREFUSED postgres://nutzer:pg-geheim@db.example/main',
        },
    });
    assert.equal(fatal.result, 'fatal');
    assert.doesNotMatch(fatal.reason, /pg-geheim/);
});

// === Grenzen und Escaping ====================================================

test('die Feed-Tabelle ist begrenzt und meldet den Rest als Zahl', () => {
    const vieleFeeds = Array.from({ length: SUMMARY_MAX_FEED_ROWS + 7 }, (_, index) => ({
        id: `feed-${index}`,
        name: `Quelle ${index}`,
    }));
    const health = Object.fromEntries(vieleFeeds.map(feed => [feed.id, {
        status: 'success',
        durationMs: 100,
        articleCount: 1,
        skippedItemCount: 0,
    }]));

    const report = buildRunSummary({
        run: RUN,
        feeds: vieleFeeds,
        feedHealth: health,
        transports: new Map(),
        snapshot: null,
        redact,
    });

    assert.equal(report.feeds.length, SUMMARY_MAX_FEED_ROWS);
    assert.equal(report.truncatedFeedCount, 7);

    const markdown = renderRunSummaryMarkdown(report);
    assert.match(markdown, /7 weitere/);
});

test('Feed-Namen werden für Markdown entschärft', () => {
    const report = buildRunSummary({
        run: RUN,
        feeds: [{ id: 'boese', name: 'A | B\n\n# Überschrift **fett** `code`' }],
        feedHealth: { boese: { status: 'success', durationMs: 1, articleCount: 0, skippedItemCount: 0 } },
        transports: new Map(),
        snapshot: null,
        redact,
    });

    const zelle = report.feeds[0].name;
    assert.doesNotMatch(zelle, /\n/, 'keine Zeilenumbrüche in einer Tabellenzelle');
    assert.doesNotMatch(zelle, /(?<!\\)\|/, 'die Spaltentrennung bleibt unversehrt');

    // Nur die Quellentabelle prüfen: die anderen Tabellen des Berichts haben
    // bewusst eigene Spaltenzahlen.
    const markdown = renderRunSummaryMarkdown(report);
    const quellen = markdown.slice(markdown.indexOf('### Quellen'));
    const tabellenzeilen = quellen.split('\n').filter(line => line.startsWith('| '));

    assert.ok(tabellenzeilen.length >= 3, 'Kopf, Trennzeile und mindestens eine Datenzeile');
    for (const zeile of tabellenzeilen) {
        // Sieben Spalten ergeben neun Teile: außen je ein leerer Rand.
        assert.equal(zeile.split(/(?<!\\)\|/).length, 9, `unerwartete Spaltenzahl: ${zeile}`);
    }
});

// === Keine Geheimnisse, keine Adressen =======================================

test('weder Secrets noch Querystrings erscheinen in der Ausgabe', () => {
    const report = summary({
        run: {
            ...RUN,
            result: 'fatal',
            fatalError: 'KV https://kv.example?token=kv-token-geheim / groq gsk-groq-geheim'
                + ' / proxy https://proxy.example/feed-proxy.php?key=proxy-geheim',
        },
    });
    const markdown = renderRunSummaryMarkdown(report);

    for (const secret of SECRETS) {
        assert.doesNotMatch(markdown, new RegExp(secret), `${secret} steht in der Zusammenfassung`);
    }
    assert.doesNotMatch(markdown, /token=/);
    assert.doesNotMatch(markdown, /key=/);
});

test('keine Feed-Adressen, Artikeltexte oder Rohmeldungen in der Ausgabe', () => {
    const markdown = renderRunSummaryMarkdown(summary());

    assert.doesNotMatch(markdown, /https?:\/\//, 'keine Adressen jeglicher Art');
    assert.doesNotMatch(markdown, /gamestar\.de|gamepro\.de|vg247\.com/);
    // Die Rohmeldungen je Feed gehören ins Log, nicht in die Zusammenfassung.
    assert.doesNotMatch(markdown, /Successfully fetched and parsed/);
    assert.doesNotMatch(markdown, /Zeitbudget des Laufs/);
});

// === Schreiben der Step-Summary ==============================================

test('ohne GITHUB_STEP_SUMMARY wird nichts geschrieben', async () => {
    const versuche = [];
    const schreiben = async (...args) => versuche.push(args);

    for (const env of [{}, { GITHUB_STEP_SUMMARY: '' }, { GITHUB_STEP_SUMMARY: '   ' }]) {
        const geschrieben = await writeRunSummary({
            env,
            markdown: '# Test',
            writeSummary: schreiben,
        });
        assert.equal(geschrieben, false);
    }

    assert.deepEqual(versuche, [], 'kein einziger Schreibversuch');
});

test('mit gesetztem Pfad wird genau einmal angehängt', async () => {
    const versuche = [];
    const geschrieben = await writeRunSummary({
        env: { GITHUB_STEP_SUMMARY: '/tmp/summary.md' },
        markdown: '# Test',
        writeSummary: async (pfad, inhalt) => versuche.push({ pfad, inhalt }),
    });

    assert.equal(geschrieben, true);
    assert.equal(versuche.length, 1);
    assert.equal(versuche[0].pfad, '/tmp/summary.md');
    assert.match(versuche[0].inhalt, /# Test/);
});

test('ein Schreibfehler wird gemeldet, aber nicht geworfen', async () => {
    const warnungen = [];
    const geschrieben = await writeRunSummary({
        env: { GITHUB_STEP_SUMMARY: '/tmp/summary.md' },
        markdown: '# Test',
        writeSummary: async () => {
            throw new Error('ENOSPC: no space left on device für pg-geheim');
        },
        redact,
        logger: { warn: line => warnungen.push(String(line)) },
    });

    assert.equal(geschrieben, false, 'der Fehler bleibt ein Nein, keine Ausnahme');
    assert.equal(warnungen.length, 1);
    assert.doesNotMatch(warnungen[0], /pg-geheim/, 'auch die Warnung wird bereinigt');
});

// === Unbekannte Zahlen bleiben unbekannt =====================================

function feedRow(health) {
    const report = buildRunSummary({
        run: RUN,
        feeds: [{ id: 'quelle', name: 'Quelle' }],
        feedHealth: { quelle: health },
        transports: new Map(),
        snapshot: null,
        redact,
    });
    return { row: report.feeds[0], markdown: renderRunSummaryMarkdown(report) };
}

// Die Kopfzeile der Tabelle beginnt ebenfalls mit „| Quelle |"; gesucht ist
// die Datenzeile darunter.
const quellenZeile = markdown => markdown
    .split('\n')
    .filter(line => line.startsWith('| Quelle |'))
    .at(-1);

test('ein nie bearbeiteter Feed meldet keine übersprungenen Items', () => {
    // Nach einem Abbruch steht eine Quelle auf `unknown`; ihre Items wurden nie
    // untersucht. Eine 0 wäre eine unbelegte Aussage.
    const { row, markdown } = feedRow({ status: 'unknown' });

    assert.equal(row.skippedItemCount, null);
    assert.equal(row.articleCount, null);
    assert.match(quellenZeile(markdown), /\| – \| – \|/, 'beide Zahlen bleiben leer');
});

test('ein ausdrückliches null bleibt unbekannt', () => {
    const { row, markdown } = feedRow({
        status: 'warning',
        durationMs: 5,
        articleCount: null,
        skippedItemCount: null,
    });

    assert.equal(row.skippedItemCount, null);
    assert.match(quellenZeile(markdown), /\| – \| – \|/);
});

test('eine gemessene Null bleibt eine Null', () => {
    const { row, markdown } = feedRow({
        status: 'warning',
        durationMs: 5,
        articleCount: 0,
        skippedItemCount: 0,
    });

    assert.equal(row.articleCount, 0, 'ein leerer Feed hat wirklich 0 Artikel geliefert');
    assert.equal(row.skippedItemCount, 0);
    assert.match(quellenZeile(markdown), /\| 0 \| 0 \|/);
});

test('gemessene positive Zahlen bleiben erhalten', () => {
    const { row, markdown } = feedRow({
        status: 'success',
        durationMs: 5,
        articleCount: 12,
        skippedItemCount: 3,
    });

    assert.equal(row.articleCount, 12);
    assert.equal(row.skippedItemCount, 3);
    assert.match(quellenZeile(markdown), /\| 12 \| 3 \|/);
});

test('unbrauchbare Zahlen erzeugen keine falsche Null', () => {
    for (const unbrauchbar of [-1, Number.NaN, Number.POSITIVE_INFINITY, 'viele', {}]) {
        const { row } = feedRow({
            status: 'success',
            articleCount: unbrauchbar,
            skippedItemCount: unbrauchbar,
        });

        assert.equal(row.skippedItemCount, null, `${String(unbrauchbar)} ist keine Zahl`);
        assert.equal(row.articleCount, null, `${String(unbrauchbar)} ist keine Zahl`);
    }
});
