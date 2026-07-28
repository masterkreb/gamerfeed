import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealthDataHandler } from '../../../server/health-data-handler.ts';
import { FEED_STALE_AFTER_MS } from '../../../shared/feed-health-model.js';

const NOW = Date.parse('2026-07-28T12:00:00.000Z');

function isoAgo(ageMs) {
    return new Date(NOW - ageMs).toISOString();
}

function createArticle(source, publicationDate) {
    return {
        id: `${source}-${publicationDate}`,
        title: `Artikel von ${source}`,
        source,
        publicationDate,
        summary: 'Zusammenfassung',
        link: `https://example.com/${encodeURIComponent(source)}`,
        imageUrl: 'https://example.com/bild.jpg',
        language: 'de',
    };
}

function createCache(values = {}, error = null) {
    const calls = [];

    return {
        calls,
        client: {
            async get(key) {
                calls.push(key);
                if (error !== null) throw error;
                return Object.hasOwn(values, key) ? values[key] : null;
            },
        },
    };
}

function createLogger() {
    const calls = [];
    return { calls, logger: { error: (...args) => calls.push(args) } };
}

function healthyStore({ runAgeMs = 60_000, publishAgeMs = 60_000, contentAgeMs = 60_000 } = {}) {
    return {
        feed_health_status: {
            gamestar: {
                status: 'success',
                message: 'Successfully fetched and parsed 12 articles.',
                lastAttemptAt: isoAgo(runAgeMs),
                lastSuccessAt: isoAgo(runAgeMs),
                durationMs: 1400,
                articleCount: 12,
            },
        },
        news_cache: [createArticle('GameStar', isoAgo(contentAgeMs))],
        feed_run_status: {
            schemaVersion: 1,
            runId: 'gha-123-1',
            startedAt: isoAgo(runAgeMs + 120_000),
            finishedAt: isoAgo(runAgeMs),
            result: 'success',
            fatalError: null,
            feeds: { total: 1, success: 1, warning: 0, error: 0, unknown: 0 },
            durations: { totalMs: 120_000, feedFetchMs: 40_000 },
        },
        feed_publish_status: {
            schemaVersion: 1,
            runId: 'gha-123-1',
            lastCorePublishAt: isoAgo(publishAgeMs),
            lastContentUpdateAt: isoAgo(contentAgeMs),
            newestArticleAt: isoAgo(contentAgeMs),
            articleCount: 1,
            feeds: { total: 1, success: 1, warning: 0, error: 0, unknown: 0 },
            durations: { publishMs: 800 },
        },
    };
}

function createHandler(values, options = {}) {
    const cache = createCache(values);
    const { logger, calls } = createLogger();
    const handler = createHealthDataHandler(cache.client, { now: () => new Date(NOW), ...options }, logger);
    return { handler, cache, loggerCalls: calls };
}

test('liefert Feed-Status, Quellen und Heartbeat eines frischen Laufs', async () => {
    const { handler } = createHandler(healthyStore());
    const response = await handler(new Request('https://example.com/api/get-health-data'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');

    assert.deepEqual(body.sourcesInCache, ['GameStar']);
    assert.equal(body.healthStatus.gamestar.status, 'success');
    assert.equal(body.healthStatus.gamestar.lastSuccessAt, isoAgo(60_000));

    assert.equal(body.heartbeat.staleAfterMs, FEED_STALE_AFTER_MS);
    assert.equal(body.heartbeat.isStale, false);
    assert.equal(body.heartbeat.run.runId, 'gha-123-1');
    assert.equal(body.heartbeat.run.result, 'success');
    assert.equal(body.heartbeat.run.ageMs, 60_000);
    assert.equal(body.heartbeat.corePublish.isStale, false);
    assert.equal(body.heartbeat.content.isStale, false);
    assert.equal(body.heartbeat.now, new Date(NOW).toISOString());
});

test('meldet einen ausgefallenen Cron als veraltet, obwohl der Feed-Status gruen ist', async () => {
    const store = healthyStore({
        runAgeMs: 3 * 60 * 60 * 1000,
        publishAgeMs: 3 * 60 * 60 * 1000,
        contentAgeMs: 3 * 60 * 60 * 1000,
    });
    const { handler } = createHandler(store);
    const body = await (await handler(new Request('https://example.com/api/get-health-data'))).json();

    assert.equal(body.healthStatus.gamestar.status, 'success', 'der gespeicherte Feed-Status bleibt gruen');
    assert.equal(body.heartbeat.isStale, true);
    assert.equal(body.heartbeat.run.isStale, true);
    assert.equal(body.heartbeat.corePublish.isStale, true);
    assert.equal(body.heartbeat.content.isStale, true);
});

test('trennt einen frischen Lauf ohne neuen Inhalt vom Kern-Publish', async () => {
    const store = healthyStore({ contentAgeMs: 4 * 60 * 60 * 1000 });
    store.feed_publish_status.feeds = { total: 1, success: 0, warning: 0, error: 1, unknown: 0 };
    store.feed_run_status.feeds = { total: 1, success: 0, warning: 0, error: 1, unknown: 0 };

    const { handler } = createHandler(store);
    const body = await (await handler(new Request('https://example.com/api/get-health-data'))).json();

    assert.equal(body.heartbeat.run.isStale, false);
    assert.equal(body.heartbeat.corePublish.isStale, false);
    assert.equal(body.heartbeat.content.isStale, true);
    assert.equal(body.heartbeat.isStale, true);
    assert.equal(body.heartbeat.corePublish.feeds.error, 1);
});

test('die Schwelle wird deterministisch und ohne Wartezeit ausgewertet', async () => {
    for (const [ageMs, expectedStale] of [
        [FEED_STALE_AFTER_MS - 1, false],
        [FEED_STALE_AFTER_MS, false],
        [FEED_STALE_AFTER_MS + 1, true],
    ]) {
        const { handler } = createHandler(healthyStore({
            runAgeMs: ageMs,
            publishAgeMs: ageMs,
            contentAgeMs: ageMs,
        }));
        const body = await (await handler(new Request('https://example.com/api/get-health-data'))).json();

        assert.equal(body.heartbeat.isStale, expectedStale, `Alter ${ageMs} ms`);
    }
});

test('fehlender Heartbeat gilt als veraltet, blockiert die Antwort aber nicht', async () => {
    const store = healthyStore();
    delete store.feed_run_status;
    delete store.feed_publish_status;

    const { handler } = createHandler(store);
    const response = await handler(new Request('https://example.com/api/get-health-data'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.heartbeat.run.at, null);
    assert.equal(body.heartbeat.isStale, true);
    assert.equal(body.heartbeat.corePublish.articleCount, 0);
});

test('fehlender Feed-Status oder News-Cache ergibt weiterhin 404', async () => {
    const withoutHealth = healthyStore();
    delete withoutHealth.feed_health_status;
    const first = await (await createHandler(withoutHealth).handler(new Request('https://example.com/x'))).json();
    assert.equal(first.error, 'Health data or news cache not available in KV store.');

    const withoutCache = healthyStore();
    delete withoutCache.news_cache;
    const second = await createHandler(withoutCache).handler(new Request('https://example.com/x'));
    assert.equal(second.status, 404);
    assert.equal(second.headers.get('cache-control'), 'private, no-store');
    assert.equal((await second.json()).code, 'not_found');
});

test('ein KV-Fehler wird protokolliert, aber nicht ausgeliefert', async () => {
    const cache = createCache({}, new Error('KV offline: https://kv.example/pipeline?token=geheim'));
    const { logger, calls } = createLogger();
    const handler = createHealthDataHandler(cache.client, { now: () => new Date(NOW) }, logger);

    const response = await handler(new Request('https://example.com/x'));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.code, 'internal_error');
    assert.equal(body.error, 'Es ist ein interner Serverfehler aufgetreten.');
    assert.doesNotMatch(JSON.stringify(body), /KV offline|geheim/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(calls.length, 1, 'der Originaltext landet ausschliesslich im Log');
});

test('es werden nur die vier erwarteten KV-Schluessel gelesen', async () => {
    const { handler, cache } = createHandler(healthyStore());
    await handler(new Request('https://example.com/x'));

    assert.deepEqual(cache.calls.sort(), [
        'feed_health_status',
        'feed_publish_status',
        'feed_run_status',
        'news_cache',
    ]);
});
