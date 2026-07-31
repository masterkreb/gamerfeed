import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealthDataHandler } from '../../../server/health-data-handler.ts';
import { FEED_STALE_AFTER_MS } from '../../../shared/feed-health-model.js';
import {
    FEED_RUN_HISTORY_KEY,
    FEED_RUN_HISTORY_LIMIT,
} from '../../../shared/feed-run-history.js';
import {
    NEWS_SNAPSHOT_VARIANTS,
    newsSnapshotPayloadKey,
} from '../../../shared/news-snapshot-store.js';

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
    assert.equal(first.error, 'Health-Daten sind derzeit nicht verfügbar.');

    const withoutCache = healthyStore();
    delete withoutCache.news_cache;
    const second = await createHandler(withoutCache).handler(new Request('https://example.com/x'));
    assert.equal(second.status, 404);
    assert.equal(second.headers.get('cache-control'), 'private, no-store');
    assert.equal((await second.json()).code, 'not_found');
});

test('die 404 verrät weder Provider noch Cache- oder Schlüsselnamen', async () => {
    const verboten = [
        /kv/i,
        /vercel/i,
        /redis/i,
        /postgres/i,
        /cache/i,
        /store/i,
        /feed_health_status/,
        /news_cache/,
        /feed_run_status/,
        /feed_publish_status/,
    ];

    for (const fehlend of ['feed_health_status', 'news_cache']) {
        const store = healthyStore();
        delete store[fehlend];

        const response = await createHandler(store).handler(new Request('https://example.com/x'));
        const rohtext = await response.text();

        assert.equal(response.status, 404, fehlend);
        assert.equal(JSON.parse(rohtext).code, 'not_found', fehlend);
        assert.equal(response.headers.get('cache-control'), 'private, no-store', fehlend);

        for (const muster of verboten) {
            assert.doesNotMatch(rohtext, muster, `${fehlend}: ${muster} steht in der Antwort`);
        }
    }
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

    // Die Laufhistorie protokolliert ihren eigenen Ausfall (O4b); gezählt wird
    // deshalb nur die Meldung dieses Fehlerpfads.
    const apiFehler = calls.filter(call => /API Error/.test(String(call[0])));
    assert.equal(apiFehler.length, 1, 'der Originaltext landet ausschliesslich im Log');
});

test('es werden nur die vier erwarteten KV-Schluessel gelesen', async () => {
    // Ohne injizierte Snapshot-Quelle wird der Zeiger gar nicht erst gelesen:
    // eine Zuordnung, die niemand belegen kann, gehoert nicht in die Antwort.
    const { handler, cache } = createHandler(healthyStore());
    await handler(new Request('https://example.com/x'));

    assert.deepEqual(cache.calls.sort(), [
        'feed_health_status',
        'feed_publish_status',
        'feed_run_status',
        'news_cache',
    ]);
});

// === Generation der Quellenzaehlung (Roadmap O3a) ===

test('eine belegbar gebundene Quelle wird gemeldet', async () => {
    // So sieht der Zustand ab O3b aus: die Quelle kann die Zugehoerigkeit
    // belegen, deshalb darf die Angabe in die Antwort.
    const store = healthyStore();
    const { handler } = createHandler(store, {
        readSnapshot: () => ({
            schemaVersion: 1,
            snapshotId: '2000-gha-2',
            createdAt: new Date(2000).toISOString(),
            articleCount: 1,
            runId: 'gha-2',
        }),
    });

    const body = await (await handler(new Request('https://example.com/x'))).json();

    assert.equal(body.snapshot.snapshotId, '2000-gha-2');
    assert.equal(body.snapshot.schemaVersion, 1);
    assert.deepEqual(body.sourcesInCache, ['GameStar']);
});

test('O3b liest Quellen und Generation aus dem Manifest statt aus dem Full-Cache', async () => {
    const snapshotId = '2000-gha-2';
    const descriptor = variant => ({
        key: newsSnapshotPayloadKey(snapshotId, variant),
        count: 1,
        bytes: 100,
    });
    const metadata = {
        schemaVersion: 1,
        snapshotId,
        createdAt: new Date(2000).toISOString(),
        articleCount: 1,
        runId: 'gha-2',
        complete: true,
        sources: ['GameStar', 'GameZone'],
        payloads: {
            full: descriptor(NEWS_SNAPSHOT_VARIANTS.FULL),
            preview: descriptor(NEWS_SNAPSHOT_VARIANTS.PREVIEW),
            medium: descriptor(NEWS_SNAPSHOT_VARIANTS.MEDIUM),
        },
    };
    const { handler, cache } = createHandler(healthyStore(), {
        readSnapshotMetadata: () => metadata,
    });

    const body = await (await handler(new Request('https://example.com/x'))).json();

    assert.equal(body.snapshot.snapshotId, snapshotId);
    assert.deepEqual(body.sourcesInCache, ['GameStar', 'GameZone']);
    assert.equal(cache.calls.includes('news_cache'), false, 'der grosse Full-Payload bleibt ungelesen');
});

test('die gebundene Quelle sieht die tatsaechlich gelesenen Artikel', async () => {
    let gesehen = null;
    const { handler } = createHandler(healthyStore(), {
        readSnapshot: artikel => {
            gesehen = artikel;
            return null;
        },
    });

    await handler(new Request('https://example.com/x'));

    assert.equal(Array.isArray(gesehen), true);
    assert.equal(gesehen.length, 1);
});

test('ein stabiler alter Zeiger mit passender Artikelzahl wird NICHT gemeldet', async () => {
    // Der Reviewbefund: `1000-old` mit articleCount 2 und zwei voellig anderen
    // Artikeln. Eine Artikelzahl belegt keine Zugehoerigkeit - zwei
    // Generationen koennen dieselbe haben. Ohne gebundene Quelle gilt Legacy.
    const store = healthyStore();
    store.news_cache = [
        createArticle('GameStar', isoAgo(60_000)),
        createArticle('GameZone', isoAgo(60_000)),
    ];
    store.news_snapshot_pointer = {
        schemaVersion: 1,
        snapshotId: '1000-old',
        createdAt: new Date(1000).toISOString(),
        articleCount: 2,
        runId: 'old',
    };

    const { handler } = createHandler(store);
    const body = await (await handler(new Request('https://example.com/x'))).json();

    assert.equal(body.snapshot, null, 'keine geratene Zuordnung');
    assert.deepEqual(body.sourcesInCache, ['GameStar', 'GameZone']);
});

test('ein Fehler beim Lesen der Quelle beendet die Health-API nicht', async () => {
    // Der Zeiger ist Diagnosebeiwerk. Sein Ausfall darf die Health-Daten nicht
    // mit 500 wegnehmen - dann gilt kontrolliert Legacy.
    const { handler, loggerCalls } = createHandler(healthyStore(), {
        readSnapshot: () => {
            throw new Error('KV nicht erreichbar');
        },
    });

    const response = await handler(new Request('https://example.com/x'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.snapshot, null);
    assert.deepEqual(body.sourcesInCache, ['GameStar']);
    const snapshotFehler = loggerCalls.filter(call => /Snapshot unavailable/.test(String(call[0])));
    assert.equal(snapshotFehler.length, 1, 'der Ausfall wird protokolliert');
});

test('eine unbrauchbare Angabe der Quelle gilt als Legacy', async () => {
    for (const kaputt of [
        'kein objekt',
        [],
        {},
        { schemaVersion: 99, snapshotId: '2000-gha-2', createdAt: new Date(2000).toISOString() },
        { schemaVersion: 1, snapshotId: 'zzz', createdAt: new Date(2000).toISOString() },
        { schemaVersion: 1, snapshotId: '2000-gha-2', createdAt: 'irgendwann' },
        { schemaVersion: 1, snapshotId: '2000-gha-2', createdAt: new Date(3000).toISOString() },
    ]) {
        const { handler } = createHandler(healthyStore(), { readSnapshot: () => kaputt });
        const body = await (await handler(new Request('https://example.com/x'))).json();

        assert.equal(body.snapshot, null, JSON.stringify(kaputt));
    }
});

test('ohne Zeiger meldet die Health-API null statt zu scheitern', async () => {
    const { handler } = createHandler(healthyStore());
    const response = await handler(new Request('https://example.com/x'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.snapshot, null);
    assert.deepEqual(body.sourcesInCache, ['GameStar']);
});

// === Begrenzte Laufhistorie (Roadmap O4b) ===
//
// Additiv: die Historie kommt zu den bestehenden Health-Daten hinzu und darf
// sie unter keinen Umständen gefährden. `[]` heisst „gelesen und leer“, `null`
// heisst „nicht lesbar“ - dieser Unterschied ist die eigentliche Aussage.

function historyEntry({ runId = 'gha-1', finishedAgeMs = 60_000, result = 'success', ...rest } = {}) {
    return {
        schemaVersion: 1,
        runId,
        startedAt: isoAgo(finishedAgeMs + 120_000),
        finishedAt: isoAgo(finishedAgeMs),
        result,
        degradedReason: null,
        fatalError: null,
        feeds: { total: 2, success: 2, warning: 0, error: 0, unknown: 0 },
        durations: { totalMs: 120_000 },
        ...rest,
    };
}

test('eine gültige Historie wird ausgeliefert, neueste zuerst', async () => {
    const { handler } = createHandler(healthyStore(), {
        readHistory: async () => [
            historyEntry({ runId: 'gha-mitte', finishedAgeMs: 20 * 60_000 }),
            historyEntry({ runId: 'gha-neu', finishedAgeMs: 60_000 }),
            historyEntry({
                runId: 'gha-alt',
                finishedAgeMs: 40 * 60_000,
                result: 'degraded',
                degradedReason: 'Trendphase zurückgestellt',
            }),
        ],
    });

    const response = await handler(new Request('https://example.com/x'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(body.runHistory.map(eintrag => eintrag.runId), ['gha-neu', 'gha-mitte', 'gha-alt']);
    assert.equal(body.runHistory[2].result, 'degraded');
    assert.equal(body.runHistory[2].degradedReason, 'Trendphase zurückgestellt');

    // Die bestehenden Verträge bleiben unberührt.
    assert.equal(body.heartbeat.run.runId, 'gha-123-1');
    assert.deepEqual(body.sourcesInCache, ['GameStar']);
});

test('beschädigte Elemente der Historie werden isoliert verworfen', async () => {
    const { handler } = createHandler(healthyStore(), {
        readHistory: async () => [
            historyEntry({ runId: 'gut' }),
            null,
            'kein Objekt',
            { ...historyEntry(), result: 'running', finishedAt: null },
            { ...historyEntry(), finishedAt: 'irgendwann' },
            { kaputt: true },
        ],
    });

    const body = await (await handler(new Request('https://example.com/x'))).json();

    assert.deepEqual(body.runHistory.map(eintrag => eintrag.runId), ['gut']);
});

test('eine gelesene, aber leere Historie ist ein leeres Feld und kein null', async () => {
    const { handler } = createHandler(healthyStore(), { readHistory: async () => [] });
    const body = await (await handler(new Request('https://example.com/x'))).json();

    assert.deepEqual(body.runHistory, []);
});

test('ein Lesefehler der Historie ergibt null, aber weiterhin Status 200', async () => {
    const { handler, loggerCalls } = createHandler(healthyStore(), {
        readHistory: async () => {
            throw new Error('Sorted Set nicht lesbar');
        },
    });

    const response = await handler(new Request('https://example.com/x'));
    const body = await response.json();

    assert.equal(response.status, 200, 'die übrigen Health-Daten bleiben ausgeliefert');
    assert.equal(body.runHistory, null, 'kein geratenes leeres Feld');
    assert.equal(body.healthStatus.gamestar.status, 'success');
    assert.deepEqual(body.sourcesInCache, ['GameStar']);
    assert.equal(body.heartbeat.run.runId, 'gha-123-1');
    assert.ok(loggerCalls.some(call => /Run history unavailable/.test(String(call[0]))));
});

test('ein Client ohne Sorted-Set-Zugriff ergibt runHistory null statt eines Fehlers', async () => {
    // Der Testclient kennt nur `get` - genau wie ein Legacy-KV-Client.
    const { handler } = createHandler(healthyStore());

    const response = await handler(new Request('https://example.com/x'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.runHistory, null);
});

test('die Historie wird aus dem Sorted Set des Clients gelesen', async () => {
    const cache = createCache(healthyStore());
    const zrangeCalls = [];
    cache.client.zrange = async (key, min, max, options) => {
        zrangeCalls.push({ key, min, max, options });
        return [historyEntry({ runId: 'gha-aus-kv' })];
    };

    const { logger } = createLogger();
    const handler = createHealthDataHandler(cache.client, { now: () => new Date(NOW) }, logger);
    const body = await (await handler(new Request('https://example.com/x'))).json();

    assert.deepEqual(body.runHistory.map(eintrag => eintrag.runId), ['gha-aus-kv']);
    assert.equal(zrangeCalls.length, 1);
    assert.equal(zrangeCalls[0].key, FEED_RUN_HISTORY_KEY);
    assert.equal(zrangeCalls[0].min, 0);
    assert.equal(zrangeCalls[0].max, FEED_RUN_HISTORY_LIMIT - 1);
    assert.deepEqual(zrangeCalls[0].options, { rev: true });
});

test('die Historie liefert keine Secrets aus, auch wenn sie welche enthielte', async () => {
    const { handler } = createHandler(healthyStore(), {
        readHistory: async () => [historyEntry({
            result: 'fatal',
            fatalError: 'connect ECONNREFUSED postgres://nutzer:pg-geheim@db.example/main '
                + 'sowie https://proxy.example/feed-proxy.php?key=proxy-geheim',
        })],
    });

    const body = await (await handler(new Request('https://example.com/x'))).json();
    const text = JSON.stringify(body);

    assert.ok(!text.includes('pg-geheim'));
    assert.ok(!text.includes('proxy-geheim'));
});

// === Der Historien-Read ist begrenzt ===
//
// Ein Speicher, der gar nicht antwortet, darf die Antwort nicht offen halten:
// alle uebrigen Health-Daten liegen laengst vor. Kein Test wartet real.

function createTestTimers() {
    const angelegt = [];
    const abgeraeumt = [];

    return {
        angelegt,
        offene: () => angelegt.filter(eintrag => !abgeraeumt.includes(eintrag)),
        setTimer(callback, ms) {
            const eintrag = { callback, ms };
            angelegt.push(eintrag);
            return eintrag;
        },
        clearTimer(handle) {
            if (handle) abgeraeumt.push(handle);
        },
        ablaufen() {
            for (const eintrag of angelegt) eintrag.callback();
        },
    };
}

async function abwickeln(runden = 8) {
    for (let index = 0; index < runden; index += 1) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

test('ein hängender Historien-Read hält die Health-Antwort nicht auf', async () => {
    const timers = createTestTimers();
    let ablehnen;
    const haengend = new Promise((_resolve, reject) => {
        ablehnen = reject;
    });
    void ablehnen;

    const { handler, loggerCalls } = createHandler(healthyStore(), {
        readHistory: () => haengend,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    });

    const antwort = handler(new Request('https://example.com/x'));
    await abwickeln();

    assert.equal(timers.angelegt.length, 1);
    assert.equal(timers.angelegt[0].ms, 3000, 'die dokumentierte Frist');
    timers.ablaufen();

    const response = await antwort;
    const body = await response.json();

    assert.equal(response.status, 200, 'die übrigen Health-Daten kommen an');
    assert.equal(body.runHistory, null, 'ein Zeitablauf ist kein leeres Feld');
    assert.equal(body.healthStatus.gamestar.status, 'success');
    assert.deepEqual(body.sourcesInCache, ['GameStar']);
    assert.equal(body.heartbeat.run.runId, 'gha-123-1');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(timers.offene(), [], 'der Zeitgeber wird abgeräumt');
    assert.ok(loggerCalls.some(call => /Run history unavailable/.test(String(call[0]))));
});

test('der Zeitgeber des Historien-Reads wird auch im Erfolgsfall abgeräumt', async () => {
    const timers = createTestTimers();
    const { handler } = createHandler(healthyStore(), {
        readHistory: async () => [historyEntry({ runId: 'gha-schnell' })],
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    });

    const body = await (await handler(new Request('https://example.com/x'))).json();

    assert.deepEqual(body.runHistory.map(eintrag => eintrag.runId), ['gha-schnell']);
    assert.deepEqual(timers.offene(), []);
});

test('eine verspätete Ablehnung des überholten Reads bleibt behandelt', async () => {
    const timers = createTestTimers();
    let ablehnen;
    const haengend = new Promise((_resolve, reject) => {
        ablehnen = reject;
    });

    const unbehandelte = [];
    const beobachter = grund => unbehandelte.push(grund);
    process.on('unhandledRejection', beobachter);

    try {
        const { handler } = createHandler(healthyStore(), {
            readHistory: () => haengend,
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
        });

        const antwort = handler(new Request('https://example.com/x'));
        await abwickeln();
        timers.ablaufen();

        assert.equal((await antwort).status, 200);

        ablehnen(new Error('KV offline: https://kv.example/pipeline?token=geheim'));
        await abwickeln();

        assert.deepEqual(unbehandelte, []);
    } finally {
        process.off('unhandledRejection', beobachter);
    }
});

test('die Frist des Historien-Reads verrät nichts über den Speicher', async () => {
    const timers = createTestTimers();
    const { handler, loggerCalls } = createHandler(healthyStore(), {
        readHistory: () => new Promise(() => {}),
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    });

    const antwort = handler(new Request('https://example.com/x'));
    await abwickeln();
    timers.ablaufen();

    const body = await (await antwort).json();

    assert.doesNotMatch(JSON.stringify(body), /feed_run_history|Zeitgrenze|kv/i);
    assert.ok(loggerCalls.some(call => /Run history unavailable/.test(String(call[0]))));
});

test('die Frist des Historien-Reads ist einstellbar', async () => {
    const timers = createTestTimers();
    const { handler } = createHandler(healthyStore(), {
        readHistory: () => new Promise(() => {}),
        historyTimeoutMs: 250,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    });

    const antwort = handler(new Request('https://example.com/x'));
    await abwickeln();

    assert.equal(timers.angelegt[0].ms, 250);
    timers.ablaufen();
    assert.equal((await antwort).status, 200);
});

test('Einträge mit fremder Schema-Version werden verworfen, die übrigen bleiben', async () => {
    const { handler } = createHandler(healthyStore(), {
        readHistory: async () => [
            { ...historyEntry({ runId: 'zu-neu' }), schemaVersion: 999 },
            historyEntry({ runId: 'gültig', finishedAgeMs: 20 * 60_000 }),
            { ...historyEntry({ runId: 'ohne-version' }), schemaVersion: undefined },
            { ...historyEntry({ runId: 'zu-alt' }), schemaVersion: 0 },
        ],
    });

    const response = await handler(new Request('https://example.com/x'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.runHistory.map(eintrag => eintrag.runId), ['gültig']);
    assert.equal(body.healthStatus.gamestar.status, 'success');
});
