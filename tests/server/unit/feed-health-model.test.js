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
    resolveRunResult,
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

// === Ergebniszustaende success / degraded / fatal (O2b) ===

test('zurueckgestellte Arbeit ergibt degraded, sonst success', () => {
    assert.equal(resolveRunResult({ deferredWork: false }), 'success');
    assert.equal(resolveRunResult({}), 'success');
    assert.equal(resolveRunResult({ deferredWork: true }), 'degraded');
});

test('ein degradierter Lauf traegt seinen Grund, ein erfolgreicher nicht', () => {
    const run = createRunStatus({ runId: 'r1', startedAt: '2026-07-28T12:00:00.000Z' });

    const degradiert = finishRunStatus(run, {
        finishedAt: '2026-07-28T12:10:00.000Z',
        result: 'degraded',
        degradedReason: 'Zeitbudget erschöpft: 3 Quelle(n) zurückgestellt',
    });
    assert.equal(degradiert.result, 'degraded');
    assert.match(degradiert.degradedReason, /3 Quelle/);

    // Ein `success` mit Begruendung waere widerspruechlich: der Zustand sagt
    // „vollstaendig", der Text „es fehlt etwas".
    const erfolgreich = finishRunStatus(run, {
        finishedAt: '2026-07-28T12:10:00.000Z',
        result: 'success',
        degradedReason: 'darf nicht durchkommen',
    });
    assert.equal(erfolgreich.degradedReason, null);
});

test('der Grund eines degradierten Laufs wird wie jede Meldung bereinigt', () => {
    const run = createRunStatus({ runId: 'r1', startedAt: '2026-07-28T12:00:00.000Z' });

    const degradiert = finishRunStatus(run, {
        finishedAt: '2026-07-28T12:10:00.000Z',
        result: 'degraded',
        degradedReason: 'Abbruch bei https://nutzer:geheim@proxy.example/x.php?token=abc',
    });

    assert.doesNotMatch(degradiert.degradedReason, /geheim|token=abc/);
});

test('ein gespeicherter degradierter Lauf wird beim Lesen erkannt', () => {
    const gelesen = normalizeRunStatus({
        runId: 'r1',
        startedAt: '2026-07-28T12:00:00.000Z',
        finishedAt: '2026-07-28T12:10:00.000Z',
        result: 'degraded',
        degradedReason: 'Scrape-Budget erschöpft: 12 zurückgestellt',
    });

    assert.equal(gelesen.result, 'degraded');
    assert.match(gelesen.degradedReason, /Scrape-Budget/);
});

test('der Frischebericht reicht den Grund an das Admin weiter', () => {
    const bericht = buildFreshnessReport({
        run: {
            runId: 'r1',
            startedAt: '2026-07-28T12:00:00.000Z',
            finishedAt: '2026-07-28T12:10:00.000Z',
            result: 'degraded',
            degradedReason: 'Zeitbudget erschöpft: 2 Quelle(n) zurückgestellt',
        },
        publish: null,
        now: '2026-07-28T12:15:00.000Z',
    });

    assert.equal(bericht.run.result, 'degraded');
    assert.match(bericht.run.degradedReason, /2 Quelle/);
});

test('ein Lauf ohne Grund liefert null statt eines leeren Textes', () => {
    const bericht = buildFreshnessReport({
        run: { startedAt: '2026-07-28T12:00:00.000Z', result: 'success' },
        publish: null,
        now: '2026-07-28T12:05:00.000Z',
    });

    assert.equal(bericht.run.degradedReason, null);
});

test('ein gespeichertes success mit Begruendung zeigt keinen Widerspruch', () => {
    // Ein älterer oder manipulierter Datensatz darf im Admin nicht
    // „abgeschlossen" neben „zurückgestellt: …" anzeigen.
    for (const result of ['success', 'fatal', 'running']) {
        const gelesen = normalizeRunStatus({
            runId: 'r1',
            startedAt: '2026-07-28T12:00:00.000Z',
            finishedAt: '2026-07-28T12:10:00.000Z',
            result,
            degradedReason: 'Zeitbudget erschöpft: 2 Quelle(n) zurückgestellt',
        });

        assert.equal(gelesen.degradedReason, null, `${result}: kein Grund`);
    }
});

test('ein unbekanntes gespeichertes Ergebnis gilt als running, nicht als success', () => {
    const gelesen = normalizeRunStatus({
        runId: 'r1',
        startedAt: '2026-07-28T12:00:00.000Z',
        finishedAt: '2026-07-28T12:10:00.000Z',
        result: 'irgendwas',
        degradedReason: 'darf nicht durchkommen',
    });

    assert.equal(gelesen.result, 'running');
    assert.equal(gelesen.degradedReason, null);
});

test('der Frischebericht reicht einen widerspruechlichen Grund nicht durch', () => {
    const bericht = buildFreshnessReport({
        run: {
            runId: 'r1',
            startedAt: '2026-07-28T12:00:00.000Z',
            finishedAt: '2026-07-28T12:10:00.000Z',
            result: 'success',
            degradedReason: 'Zeitbudget erschöpft: 2 Quelle(n) zurückgestellt',
        },
        publish: null,
        now: '2026-07-28T12:15:00.000Z',
    });

    assert.equal(bericht.run.result, 'success');
    assert.equal(bericht.run.degradedReason, null);
});

// === Zugangsdaten aller ueblichen URI-Schemata ===============================
//
// Die O4a-Summary verspricht, keine Zugangsdaten auszugeben. Diese Zusage darf
// nicht davon abhaengen, dass eine Fehlermeldung die konfigurierte
// Verbindungszeichenfolge bytegenau wiederholt.

test('sanitizeErrorMessage entfernt Zugangsdaten aus einer PostgreSQL-Adresse', () => {
    const message = sanitizeErrorMessage(
        'connect ECONNREFUSED postgres://user:password@db.example/main',
    );

    assert.equal(message, 'connect ECONNREFUSED postgres://db.example/main');
});

test('sanitizeErrorMessage bereinigt auch eine abweichende PostgreSQL-Adresse', () => {
    // Kein exakter Treffer in `secrets`: der Host stammt aus einer anderen
    // Verbindung, das Passwort ist trotzdem eines.
    const message = sanitizeErrorMessage(
        'pool error postgresql://admin:anderes-passwort@replica.example:5432/db',
        { secrets: ['postgres://user:password@db.example/main'] },
    );

    assert.doesNotMatch(message, /anderes-passwort/);
    assert.doesNotMatch(message, /admin:/);
    assert.equal(message, 'pool error postgresql://replica.example:5432/db');
});

test('sanitizeErrorMessage entfernt ein Token aus einer Redis-Adresse', () => {
    const message = sanitizeErrorMessage(
        'redis connection lost redis://:rediss-token-geheim@cache.example:6379',
    );

    assert.doesNotMatch(message, /rediss-token-geheim/);
    assert.equal(message, 'redis connection lost redis://cache.example:6379');
});

test('sanitizeErrorMessage entfernt Querystrings auch bei Verbindungsadressen', () => {
    const message = sanitizeErrorMessage(
        'ssl error postgres://user:password@db.example/main?sslmode=require&token=abc',
    );

    assert.doesNotMatch(message, /password/);
    assert.doesNotMatch(message, /sslmode|token=abc/);
    assert.equal(message, 'ssl error postgres://db.example/main?[redacted]');
});

test('sanitizeErrorMessage laesst das bisherige HTTP(S)-Verhalten unveraendert', () => {
    assert.equal(
        sanitizeErrorMessage('fetch failed: https://token:abc@kv.example.com/pipeline?token=supersecret'),
        'fetch failed: https://kv.example.com/pipeline?[redacted]',
    );
    assert.equal(
        sanitizeErrorMessage('GET http://feeds.example/rss.xml failed'),
        'GET http://feeds.example/rss.xml failed',
    );
});

test('sanitizeErrorMessage ersetzt bekannte Secret-Werte weiterhin zuerst', () => {
    const message = sanitizeErrorMessage(
        'connect ECONNREFUSED für postgres://nutzer:geheim@db.example.com/main',
        { secrets: ['postgres://nutzer:geheim@db.example.com/main'] },
    );

    assert.equal(message, 'connect ECONNREFUSED für [redacted]');
});
