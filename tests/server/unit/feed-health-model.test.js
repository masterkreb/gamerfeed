import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FEED_CLOCK_SKEW_TOLERANCE_MS,
    FEED_STALE_AFTER_MS,
    buildFreshnessReport,
    buildPublishStatus,
    createRunStatus,
    finishRunStatus,
    mergeFeedHealth,
    normalizePublishStatus,
    normalizeRunStatus,
    progressRunStatus,
    sanitizeErrorMessage,
    summarizeFeedHealth,
} from '../../../shared/feed-health-model.js';

// Feste Uhr: alle Grenzfaelle werden gerechnet, nie gewartet.
const NOW = Date.parse('2026-07-28T12:00:00.000Z');

function isoAgo(ageMs) {
    return new Date(NOW - ageMs).toISOString();
}

function runStatusAged(ageMs, overrides = {}) {
    return {
        schemaVersion: 1,
        runId: 'run-1',
        startedAt: isoAgo(ageMs + 60_000),
        finishedAt: isoAgo(ageMs),
        result: 'success',
        fatalError: null,
        feeds: { total: 3, success: 3, warning: 0, error: 0, unknown: 0 },
        durations: {},
        ...overrides,
    };
}

function publishStatusAged(ageMs, overrides = {}) {
    return {
        schemaVersion: 1,
        runId: 'run-1',
        lastCorePublishAt: isoAgo(ageMs),
        lastContentUpdateAt: isoAgo(ageMs),
        newestArticleAt: isoAgo(ageMs + 5 * 60_000),
        articleCount: 1200,
        feeds: { total: 3, success: 3, warning: 0, error: 0, unknown: 0 },
        durations: {},
        ...overrides,
    };
}

function reportAged(ageMs) {
    return buildFreshnessReport({
        run: runStatusAged(ageMs),
        publish: publishStatusAged(ageMs),
        now: NOW,
    });
}

// === Schwelle ===

test('die dokumentierte Schwelle liegt bei 50 Minuten', () => {
    assert.equal(FEED_STALE_AFTER_MS, 50 * 60 * 1000);
});

test('direkt vor der Schwelle gilt alles als aktuell', () => {
    const report = reportAged(FEED_STALE_AFTER_MS - 1);

    assert.equal(report.run.isStale, false);
    assert.equal(report.corePublish.isStale, false);
    assert.equal(report.content.isStale, false);
    assert.equal(report.isStale, false);
});

test('genau auf der Schwelle gilt alles noch als aktuell', () => {
    const report = reportAged(FEED_STALE_AFTER_MS);

    assert.equal(report.run.ageMs, FEED_STALE_AFTER_MS);
    assert.equal(report.run.isStale, false);
    assert.equal(report.corePublish.isStale, false);
    assert.equal(report.content.isStale, false);
    assert.equal(report.isStale, false);
});

test('eine Millisekunde ueber der Schwelle gilt alles als veraltet', () => {
    const report = reportAged(FEED_STALE_AFTER_MS + 1);

    assert.equal(report.run.isStale, true);
    assert.equal(report.corePublish.isStale, true);
    assert.equal(report.content.isStale, true);
    assert.equal(report.isStale, true);
});

test('die Schwelle ist ueberschreibbar, ohne den Standard zu veraendern', () => {
    const report = buildFreshnessReport({
        run: runStatusAged(10 * 60_000),
        publish: publishStatusAged(10 * 60_000),
        now: NOW,
        staleAfterMs: 5 * 60_000,
    });

    assert.equal(report.staleAfterMs, 5 * 60_000);
    assert.equal(report.run.isStale, true);
    assert.equal(FEED_STALE_AFTER_MS, 50 * 60 * 1000);
});

// === Zeitstempel aus der Zukunft ===

test('eine kleine Uhrabweichung nach vorn gilt weiterhin als aktuell', () => {
    const report = reportAged(-FEED_CLOCK_SKEW_TOLERANCE_MS);

    assert.equal(report.run.ageMs, -FEED_CLOCK_SKEW_TOLERANCE_MS);
    assert.equal(report.run.isFuture, false);
    assert.equal(report.run.isStale, false);
    assert.equal(report.isStale, false);
});

test('ein Zeitstempel jenseits der Uhrtoleranz gilt nie als frisch', () => {
    const report = reportAged(-(FEED_CLOCK_SKEW_TOLERANCE_MS + 1));

    assert.equal(report.run.isFuture, true);
    assert.equal(report.run.isStale, true);
    assert.equal(report.corePublish.isFuture, true);
    assert.equal(report.corePublish.isStale, true);
    assert.equal(report.content.isStale, true);
    assert.equal(report.isStale, true);
});

test('ein weit in der Zukunft gesetzter Kern-Publish verdeckt keinen Ausfall', () => {
    const report = buildFreshnessReport({
        run: runStatusAged(3 * 60 * 60 * 1000),
        publish: publishStatusAged(-(365 * 24 * 60 * 60 * 1000)),
        now: NOW,
    });

    assert.equal(report.corePublish.isStale, true);
    assert.equal(report.run.isStale, true);
    assert.equal(report.isStale, true);
});

test('fehlende Datensaetze gelten als veraltet, nicht als gesund', () => {
    const report = buildFreshnessReport({ run: null, publish: null, now: NOW });

    assert.equal(report.run.at, null);
    assert.equal(report.run.isStale, true);
    assert.equal(report.corePublish.isStale, true);
    assert.equal(report.content.isStale, true);
    assert.equal(report.isStale, true);
    assert.deepEqual(report.corePublish.feeds, { total: 0, success: 0, warning: 0, error: 0, unknown: 0 });
});

test('ein haengender Lauf ohne finishedAt wird am Start gemessen', () => {
    const report = buildFreshnessReport({
        run: {
            runId: 'run-hangs',
            startedAt: isoAgo(FEED_STALE_AFTER_MS + 60_000),
            finishedAt: null,
            result: 'running',
        },
        publish: publishStatusAged(60_000),
        now: NOW,
    });

    assert.equal(report.run.result, 'running');
    assert.equal(report.run.isStale, true);
    assert.equal(report.corePublish.isStale, false);
});

// === Getrennte Sichten: Lauf, Kern-Publish, Inhalt ===

test('ein beendeter Lauf mit ausschliesslich fehlgeschlagenen Feeds ist kein frischer Inhalt', () => {
    const previous = publishStatusAged(3 * 60 * 60 * 1000);
    const publish = buildPublishStatus({
        previous,
        runId: 'run-2',
        publishedAt: new Date(NOW),
        articleCount: 1200,
        newestArticleAt: isoAgo(3 * 60 * 60 * 1000),
        feeds: { total: 3, success: 0, warning: 0, error: 3, unknown: 0 },
    });

    assert.equal(publish.lastCorePublishAt, new Date(NOW).toISOString());
    assert.equal(publish.lastContentUpdateAt, previous.lastContentUpdateAt);

    const report = buildFreshnessReport({
        run: runStatusAged(0, { feeds: { total: 3, success: 0, warning: 0, error: 3, unknown: 0 } }),
        publish,
        now: NOW,
    });

    assert.equal(report.run.isStale, false, 'der Lauf selbst ist frisch');
    assert.equal(report.corePublish.isStale, false, 'der Kern-Publish hat stattgefunden');
    assert.equal(report.content.isStale, true, 'der Inhalt ist trotzdem alt');
    assert.equal(report.run.feeds.error, 3);
});

test('ein Lauf mit mindestens einem erfolgreichen Feed schreibt die Inhaltsfrische fort', () => {
    const previous = publishStatusAged(3 * 60 * 60 * 1000);
    const publish = buildPublishStatus({
        previous,
        runId: 'run-3',
        publishedAt: new Date(NOW),
        articleCount: 1201,
        newestArticleAt: isoAgo(2 * 60_000),
        feeds: { total: 3, success: 1, warning: 0, error: 2, unknown: 0 },
    });

    assert.equal(publish.lastContentUpdateAt, new Date(NOW).toISOString());

    const report = buildFreshnessReport({ run: runStatusAged(0), publish, now: NOW });
    assert.equal(report.content.isStale, false);
    assert.equal(report.content.newestArticleAt, isoAgo(2 * 60_000));
    assert.equal(report.content.newestArticleAgeMs, 2 * 60_000);
});

test('gelieferte Artikel schreiben die Inhaltsfrische fort, auch wenn nichts neu ist', () => {
    // Bewusst festgehaltene Grenze: feeds.success > 0 belegt nur, dass ein Feed
    // ueberhaupt Artikel geliefert hat. Ob darunter neue waren, weiss O1 nicht.
    const previous = publishStatusAged(20 * 60_000);
    const unveraenderterArtikel = previous.newestArticleAt;

    const publish = buildPublishStatus({
        previous,
        runId: 'run-unchanged',
        publishedAt: new Date(NOW),
        articleCount: previous.articleCount,
        newestArticleAt: unveraenderterArtikel,
        feeds: { total: 3, success: 3, warning: 0, error: 0, unknown: 0 },
    });

    assert.equal(publish.newestArticleAt, unveraenderterArtikel, 'kein neuerer Artikel');
    assert.equal(
        publish.lastContentUpdateAt,
        new Date(NOW).toISOString(),
        'die Inhaltsfrische steigt trotzdem – eine Novelty-Erkennung gehoert nicht zu O1',
    );
});

test('ohne vorherigen Publish bleibt die Inhaltsfrische ohne erfolgreiche Feeds leer', () => {
    const publish = buildPublishStatus({
        previous: null,
        runId: 'run-4',
        publishedAt: new Date(NOW),
        articleCount: 0,
        newestArticleAt: null,
        feeds: { total: 2, success: 0, warning: 2, error: 0, unknown: 0 },
    });

    assert.equal(publish.lastContentUpdateAt, null);
    assert.equal(publish.lastCorePublishAt, new Date(NOW).toISOString());
});

// === Gescheiterter Versuch ueberschreibt keine Erfolgsdaten ===

test('ein gescheiterter Feed uebernimmt den gespeicherten lastSuccessAt unveraendert', () => {
    const storedHealth = {
        gamestar: { status: 'success', message: 'ok', lastSuccessAt: isoAgo(15 * 60_000) },
    };

    const merged = mergeFeedHealth(storedHealth, {
        gamestar: { status: 'error', message: 'Fetch failed.', lastAttemptAt: new Date(NOW).toISOString() },
    });

    assert.equal(merged.gamestar.status, 'error');
    assert.equal(merged.gamestar.lastSuccessAt, storedHealth.gamestar.lastSuccessAt);
    assert.equal(merged.gamestar.lastAttemptAt, new Date(NOW).toISOString());
});

test('ein erfolgreicher Feed schreibt lastSuccessAt fort', () => {
    const merged = mergeFeedHealth(
        { gamestar: { status: 'error', message: 'alt', lastSuccessAt: isoAgo(60 * 60_000) } },
        { gamestar: { status: 'success', message: 'neu', lastAttemptAt: new Date(NOW).toISOString() } },
    );

    assert.equal(merged.gamestar.lastSuccessAt, new Date(NOW).toISOString());
});

test('eine Warnung ohne Artikel schreibt lastSuccessAt nicht fort', () => {
    const merged = mergeFeedHealth(
        { gamestar: { status: 'success', message: 'alt', lastSuccessAt: isoAgo(60 * 60_000) } },
        { gamestar: { status: 'warning', message: 'keine Artikel', lastAttemptAt: new Date(NOW).toISOString() } },
    );

    assert.equal(merged.gamestar.lastSuccessAt, isoAgo(60 * 60_000));
    assert.equal(merged.gamestar.lastAttemptAt, new Date(NOW).toISOString());
});

test('mergeFeedHealth entscheidet nicht selbst ueber eine leere Feed-Liste', () => {
    // Ob ein leeres Ergebnis gespeichert werden darf, haengt davon ab, warum es
    // leer ist. Diese Unterscheidung trifft der Recorder, nicht das Modell –
    // siehe tests/feeds/unit/feed-run-recorder.test.js.
    const stored = {
        gamestar: { status: 'success', message: 'ok', lastSuccessAt: isoAgo(20 * 60_000) },
    };

    assert.deepEqual(mergeFeedHealth(stored, {}), {});
});

test('ein geloeschter Feed verschwindet aus dem Status', () => {
    const merged = mergeFeedHealth(
        {
            gamestar: { status: 'success', message: 'ok', lastSuccessAt: isoAgo(20 * 60_000) },
            entfernt: { status: 'success', message: 'ok', lastSuccessAt: isoAgo(20 * 60_000) },
        },
        { gamestar: { status: 'success', message: 'ok', lastAttemptAt: new Date(NOW).toISOString() } },
    );

    assert.deepEqual(Object.keys(merged), ['gamestar']);
});

// === Zaehler, Dauern und Normalisierung ===

test('summarizeFeedHealth zaehlt jeden Status genau einmal', () => {
    const counters = summarizeFeedHealth({
        a: { status: 'success' },
        b: { status: 'success' },
        c: { status: 'warning' },
        d: { status: 'error' },
        e: { status: 'kaputt' },
    });

    assert.deepEqual(counters, { total: 5, success: 2, warning: 1, error: 1, unknown: 1 });
});

test('finishRunStatus veraendert den laufenden Versuch nicht', () => {
    const running = createRunStatus({ runId: 'run-6', startedAt: isoAgo(120_000) });
    const finished = finishRunStatus(running, {
        finishedAt: new Date(NOW),
        result: 'success',
        feeds: { total: 2, success: 2, warning: 0, error: 0, unknown: 0 },
        durations: { totalMs: 120_000, feedFetchMs: 40_000, publishMs: 900 },
    });

    assert.equal(running.result, 'running');
    assert.equal(running.finishedAt, null);
    assert.equal(finished.result, 'success');
    assert.equal(finished.startedAt, running.startedAt);
    assert.equal(finished.durations.totalMs, 120_000);
    assert.equal(finished.durations.imageScrapeMs, null);
});

test('progressRunStatus haelt den Versuch offen und traegt nur Zwischenstaende nach', () => {
    const running = createRunStatus({ runId: 'run-9', startedAt: isoAgo(120_000) });
    const progressed = progressRunStatus(running, {
        feeds: { total: 3, success: 2, warning: 0, error: 1, unknown: 0 },
        durations: { publishMs: 700 },
    });

    assert.equal(progressed.result, 'running');
    assert.equal(progressed.finishedAt, null, 'der Lauf ist noch nicht beendet');
    assert.equal(progressed.startedAt, running.startedAt);
    assert.equal(progressed.feeds.success, 2);
    assert.equal(progressed.durations.publishMs, 700);
});

test('ein unbekanntes Ergebnis wird nicht als Erfolg durchgereicht', () => {
    const finished = finishRunStatus(createRunStatus({ runId: 'run-7', startedAt: isoAgo(1000) }), {
        finishedAt: new Date(NOW),
        result: 'irgendwas',
    });

    assert.equal(finished.result, 'fatal');
});

test('kaputte gespeicherte Datensaetze werden verworfen statt geglaubt', () => {
    assert.equal(normalizeRunStatus(null), null);
    assert.equal(normalizeRunStatus('kaputt'), null);
    assert.equal(normalizeRunStatus({ startedAt: 'kein Datum' }), null);
    assert.equal(normalizePublishStatus({ lastCorePublishAt: 'kein Datum' }), null);
    assert.equal(normalizePublishStatus([]), null);

    const report = buildFreshnessReport({ run: 'kaputt', publish: { articleCount: 5 }, now: NOW });
    assert.equal(report.isStale, true);
    assert.equal(report.corePublish.articleCount, 0);
});

test('negative oder unsinnige Dauern werden nicht uebernommen', () => {
    const finished = finishRunStatus(createRunStatus({ runId: 'run-8', startedAt: isoAgo(1000) }), {
        finishedAt: new Date(NOW),
        result: 'success',
        durations: { totalMs: -5, feedFetchMs: 'schnell', publishMs: 12 },
    });

    assert.equal(finished.durations.totalMs, null);
    assert.equal(finished.durations.feedFetchMs, null);
    assert.equal(finished.durations.publishMs, 12);
});

// === Secrets ===

test('sanitizeErrorMessage entfernt bekannte Secret-Werte', () => {
    const message = sanitizeErrorMessage(
        'connect ECONNREFUSED für postgres://nutzer:geheim@db.example.com/main',
        { secrets: ['postgres://nutzer:geheim@db.example.com/main'] },
    );

    assert.equal(message, 'connect ECONNREFUSED für [redacted]');
});

test('sanitizeErrorMessage entfernt Zugangsdaten und Querystrings aus URLs', () => {
    const message = sanitizeErrorMessage(
        'fetch failed: https://token:abc@kv.example.com/pipeline?token=supersecret',
    );

    assert.equal(message, 'fetch failed: https://kv.example.com/pipeline?[redacted]');
});

test('sanitizeErrorMessage kuerzt sehr lange Meldungen', () => {
    const message = sanitizeErrorMessage('x'.repeat(5000));

    assert.equal(message.length, 301);
    assert.ok(message.endsWith('…'));
});

test('sanitizeErrorMessage liefert null statt leerer Meldungen', () => {
    assert.equal(sanitizeErrorMessage(null), null);
    assert.equal(sanitizeErrorMessage('   '), null);
});
