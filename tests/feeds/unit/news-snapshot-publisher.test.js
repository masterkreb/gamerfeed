import test from 'node:test';
import assert from 'node:assert/strict';
import {
    NEWS_SNAPSHOT_GC_GRACE_MS,
    NEWS_SNAPSHOT_PUBLISH_LEASE_KEY,
    NewsSnapshotPublishConflictError,
    garbageCollectNewsSnapshots,
    prepareNewsSnapshotPayloads,
    publishNewsSnapshot,
    readNewsPayloadBudgetConfiguration,
    rollbackToPreviousNewsSnapshot,
} from '../../../scripts/news-snapshot-publisher.js';
import {
    NEWS_SNAPSHOT_POINTER_KEY,
    normalizeSnapshotPointer,
} from '../../../shared/news-snapshot.js';
import {
    NEWS_SNAPSHOT_VARIANTS,
    newsSnapshotMetadataKey,
    newsSnapshotPayloadKey,
    readBoundNewsSnapshot,
} from '../../../shared/news-snapshot-store.js';

function article(id, dateMs, overrides = {}) {
    return {
        id,
        title: `Titel ${id}`,
        source: 'GameStar',
        publicationDate: new Date(dateMs).toISOString(),
        summary: `Zusammenfassung ${id}`,
        link: `https://example.com/${id}`,
        imageUrl: `https://example.com/${id}.jpg`,
        language: 'de',
        ...overrides,
    };
}

function createMemoryStore(initial = {}) {
    const data = structuredClone(initial);
    const writes = [];
    const deletes = [];
    let failAtSet = null;
    let setCount = 0;
    let leaseConflicts = 0;
    let pauseKey = null;
    let pausePromise = null;

    const store = {
        async get(key) {
            return Object.hasOwn(data, key) ? structuredClone(data[key]) : null;
        },
        async set(key, value, options = undefined) {
            setCount += 1;
            writes.push({ key, value: structuredClone(value), options });
            if (setCount === failAtSet) throw new Error(`Write ${setCount} faellt aus`);

            if (options?.nx === true && Object.hasOwn(data, key)) {
                leaseConflicts += 1;
                return null;
            }

            data[key] = structuredClone(value);
            if (key === pauseKey && pausePromise) await pausePromise;
            return 'OK';
        },
        async del(...keys) {
            let removed = 0;
            for (const key of keys) {
                deletes.push(key);
                if (Object.hasOwn(data, key)) {
                    delete data[key];
                    removed += 1;
                }
            }
            return removed;
        },
        async eval(_script, keys, args) {
            const [leaseKey, pointerKey] = keys;
            const [token, serializedPointer] = args;
            if (data[leaseKey] !== token) return 0;

            if (pointerKey) {
                setCount += 1;
                const pointer = JSON.parse(serializedPointer);
                writes.push({
                    key: pointerKey,
                    value: structuredClone(pointer),
                    options: { atomicLease: true },
                });
                if (setCount === failAtSet) throw new Error(`Write ${setCount} faellt aus`);
                data[pointerKey] = structuredClone(pointer);
                return 1;
            }

            delete data[leaseKey];
            return 1;
        },
        async scan(_cursor, { match } = {}) {
            const prefix = typeof match === 'string' && match.endsWith('*')
                ? match.slice(0, -1)
                : '';
            return [0, Object.keys(data).filter(key => key.startsWith(prefix))];
        },
    };

    return {
        data,
        writes,
        deletes,
        store,
        get setCount() {
            return setCount;
        },
        get leaseConflicts() {
            return leaseConflicts;
        },
        failAt(value) {
            failAtSet = value;
        },
        pause(key, promise) {
            pauseKey = key;
            pausePromise = promise;
        },
    };
}

const LEISE = Object.freeze({
    log() {},
    warn() {},
});

const PUBLISH_OPTIONS = Object.freeze({
    garbageCollect: false,
    logger: LEISE,
    leasePollMs: 1,
    leaseWaitMs: 2_000,
    sleep: () => new Promise(resolve => setImmediate(resolve)),
});

test('Bytebudgets sind konfigurierbar, unbrauchbare Werte schalten Grenzen nie ab', () => {
    const configured = readNewsPayloadBudgetConfiguration({
        NEWS_CACHE_FULL_MAX_BYTES: String(2 * 1024 * 1024),
        NEWS_CACHE_MEDIUM_MAX_BYTES: 'ungueltig',
        NEWS_CACHE_PREVIEW_MAX_BYTES: '-1',
        NEWS_CACHE_SAFETY_RESERVE_BYTES: String(32 * 1024),
    });

    assert.equal(configured.maxBytes.full, 2 * 1024 * 1024);
    assert.equal(configured.maxBytes.medium, 2 * 1024 * 1024);
    assert.equal(configured.maxBytes.preview, 512 * 1024);
    assert.equal(configured.safetyReserveBytes, 32 * 1024);
});

test('Payloads bleiben mit Reserve unter jedem Bytebudget und newest-first', () => {
    const articles = Array.from({ length: 20 }, (_, index) => article(
        `a${index}`,
        20_000 - index * 1_000,
        { summary: 'x'.repeat(300) },
    ));
    articles.splice(2, 0, article('riesig', 30_000, { summary: 'x'.repeat(80_000) }));
    articles.push(article('langer-titel', 500, { title: 'T'.repeat(900) }));

    const prepared = prepareNewsSnapshotPayloads(articles, {
        maxBytes: { full: 5_000, medium: 3_000, preview: 2_000 },
        safetyReserveBytes: 200,
    });

    assert.equal(prepared.stats.skippedOversized, 1, 'einzeln zu grosser Artikel wird verworfen');
    assert.ok(prepared.stats.droppedByBudget.full > 0, 'die aeltesten Eintraege fallen zuerst weg');

    for (const variant of ['full', 'preview', 'medium']) {
        const payload = prepared[variant];
        assert.equal(Buffer.byteLength(JSON.stringify(payload.articles)), payload.bytes);
        assert.ok(payload.bytes <= payload.effectiveMaxBytes, variant);
        assert.ok(payload.bytes < payload.maxBytes, `${variant}: Sicherheitsreserve bleibt frei`);
    }

    const dates = prepared.full.articles.map(item => Date.parse(item.publicationDate));
    assert.deepEqual(dates, [...dates].sort((a, b) => b - a), 'newest-first bleibt erhalten');
    assert.ok(prepared.full.articles.every(item => item.title.length <= 600));
});

test('gleiche Zeitstempel behalten ihre stabile Eingabereihenfolge', () => {
    const prepared = prepareNewsSnapshotPayloads([
        article('zuerst', 1_000),
        article('zweiter', 1_000),
        article('dritter', 1_000),
    ], {
        maxBytes: { full: 100_000, medium: 100_000, preview: 100_000 },
        safetyReserveBytes: 100,
    });

    assert.deepEqual(
        prepared.full.articles.map(item => item.id),
        ['zuerst', 'zweiter', 'dritter'],
    );
});

test('der Active-Pointer ist der letzte kritische Publish-Write', async () => {
    const memory = createMemoryStore();

    const result = await publishNewsSnapshot({
        store: memory.store,
        articles: [article('a', 2_000)],
        runId: 'gha-1',
        createdAt: new Date(2_000),
        ...PUBLISH_OPTIONS,
    });

    const criticalWrites = memory.writes.filter(entry => entry.key !== NEWS_SNAPSHOT_PUBLISH_LEASE_KEY);
    assert.equal(criticalWrites.at(-1).key, NEWS_SNAPSHOT_POINTER_KEY);
    assert.equal(
        normalizeSnapshotPointer(memory.data[NEWS_SNAPSHOT_POINTER_KEY]).snapshotId,
        result.pointer.snapshotId,
    );

    const read = await readBoundNewsSnapshot(memory.store);
    assert.deepEqual(read.articles.map(item => item.id), ['a']);
    assert.equal(read.snapshot.snapshotId, result.pointer.snapshotId);
});

test('bereits vorhandene Generations-Keys werden niemals ueberschrieben', async () => {
    const fullKey = newsSnapshotPayloadKey('1000-A', NEWS_SNAPSHOT_VARIANTS.FULL);
    const memory = createMemoryStore({ [fullKey]: [article('fremd', 500)] });

    await assert.rejects(
        publishNewsSnapshot({
            store: memory.store,
            articles: [article('A', 1_000)],
            runId: 'A',
            createdAt: new Date(1_000),
            ...PUBLISH_OPTIONS,
        }),
        NewsSnapshotPublishConflictError,
    );

    assert.deepEqual(memory.data[fullKey].map(item => item.id), ['fremd']);
    assert.equal(memory.data[NEWS_SNAPSHOT_POINTER_KEY], undefined);
});

test('Fault-Injection nach jedem KV-Write zeigt nie eine Teilgeneration', async () => {
    const seed = createMemoryStore();
    const old = await publishNewsSnapshot({
        store: seed.store,
        articles: [article('alt', 1_000)],
        runId: 'old',
        createdAt: new Date(1_000),
        ...PUBLISH_OPTIONS,
    });
    const seededData = structuredClone(seed.data);

    // Lease + Full + Preview + Medium + Manifest + drei Legacy-Keys + Pointer.
    for (let failingWrite = 1; failingWrite <= 9; failingWrite += 1) {
        const memory = createMemoryStore(seededData);
        memory.failAt(failingWrite);

        await assert.rejects(
            publishNewsSnapshot({
                store: memory.store,
                articles: [article('neu', 2_000)],
                runId: 'new',
                createdAt: new Date(2_000),
                ...PUBLISH_OPTIONS,
            }),
            `Write ${failingWrite}`,
        );

        const visible = await readBoundNewsSnapshot(memory.store);
        assert.deepEqual(
            visible.articles.map(item => item.id),
            ['alt'],
            `nach Write ${failingWrite} bleibt nur der alte komplette Stand sichtbar`,
        );
        assert.equal(visible.snapshot.snapshotId, old.pointer.snapshotId);
    }
});

test('ueberlappende Writer aktivieren am Ende immer die neuere Generation', async () => {
    const memory = createMemoryStore();
    let releaseOld;
    const oldMayContinue = new Promise(resolve => {
        releaseOld = resolve;
    });
    const oldFullKey = newsSnapshotPayloadKey('1000-old', NEWS_SNAPSHOT_VARIANTS.FULL);
    memory.pause(oldFullKey, oldMayContinue);

    const oldPublish = publishNewsSnapshot({
        store: memory.store,
        articles: [article('alt', 1_000)],
        runId: 'old',
        createdAt: new Date(1_000),
        ...PUBLISH_OPTIONS,
    });

    // Der alte Writer haelt jetzt die Lease und pausiert im ersten Payload.
    while (!Object.hasOwn(memory.data, NEWS_SNAPSHOT_PUBLISH_LEASE_KEY)) {
        await new Promise(resolve => setImmediate(resolve));
    }

    const newPublish = publishNewsSnapshot({
        store: memory.store,
        articles: [article('neu', 2_000)],
        runId: 'new',
        createdAt: new Date(2_000),
        ...PUBLISH_OPTIONS,
    });

    while (memory.leaseConflicts === 0) {
        await new Promise(resolve => setImmediate(resolve));
    }
    releaseOld();

    const [oldResult, newResult] = await Promise.all([oldPublish, newPublish]);
    const active = normalizeSnapshotPointer(memory.data[NEWS_SNAPSHOT_POINTER_KEY]);

    assert.equal(oldResult.pointer.snapshotId, '1000-old');
    assert.equal(newResult.pointer.snapshotId, '2000-new');
    assert.equal(active.snapshotId, '2000-new');
    assert.equal(memory.data[NEWS_SNAPSHOT_POINTER_KEY].previousSnapshotId, '1000-old');
});

test('eine abgelaufene Writer-Lease verhindert atomar die Pointer-Aktivierung', async () => {
    const memory = createMemoryStore();
    const old = await publishNewsSnapshot({
        store: memory.store,
        articles: [article('alt', 1_000)],
        runId: 'old',
        createdAt: new Date(1_000),
        ...PUBLISH_OPTIONS,
    });
    const originalEval = memory.store.eval.bind(memory.store);

    memory.store.eval = async (script, keys, args) => {
        if (keys.length === 2) {
            memory.data[NEWS_SNAPSHOT_PUBLISH_LEASE_KEY] = 'neuer-writer';
        }
        return originalEval(script, keys, args);
    };

    await assert.rejects(
        publishNewsSnapshot({
            store: memory.store,
            articles: [article('neu', 2_000)],
            runId: 'new',
            createdAt: new Date(2_000),
            ...PUBLISH_OPTIONS,
        }),
        NewsSnapshotPublishConflictError,
    );

    const active = normalizeSnapshotPointer(memory.data[NEWS_SNAPSHOT_POINTER_KEY]);
    const visible = await readBoundNewsSnapshot(memory.store);
    assert.equal(active.snapshotId, old.pointer.snapshotId);
    assert.deepEqual(visible.articles.map(item => item.id), ['alt']);
    assert.equal(
        memory.data[NEWS_SNAPSHOT_PUBLISH_LEASE_KEY],
        'neuer-writer',
        'der alte Writer darf die neue Lease beim Aufraeumen nicht loeschen',
    );
});

test('das Warten auf eine belegte Lease endet ohne echte Wartezeit am Budget', async () => {
    const memory = createMemoryStore({
        [NEWS_SNAPSHOT_PUBLISH_LEASE_KEY]: 'anderer-writer',
    });
    let now = 10_000;
    const waits = [];

    await assert.rejects(
        publishNewsSnapshot({
            store: memory.store,
            articles: [article('A', 1_000)],
            runId: 'A',
            createdAt: new Date(1_000),
            garbageCollect: false,
            logger: LEISE,
            leaseWaitMs: 500,
            leasePollMs: 200,
            clock: () => now,
            sleep: async ms => {
                waits.push(ms);
                now += ms;
            },
        }),
        NewsSnapshotPublishConflictError,
    );

    assert.deepEqual(waits, [200, 200, 100]);
    assert.equal(memory.data[NEWS_SNAPSHOT_POINTER_KEY], undefined);
});

test('ein spaeter ankommender aelterer Writer kann den Pointer nicht zurueckdrehen', async () => {
    const memory = createMemoryStore();
    await publishNewsSnapshot({
        store: memory.store,
        articles: [article('neu', 2_000)],
        runId: 'new',
        createdAt: new Date(2_000),
        ...PUBLISH_OPTIONS,
    });

    await assert.rejects(
        publishNewsSnapshot({
            store: memory.store,
            articles: [article('alt', 1_000)],
            runId: 'old',
            createdAt: new Date(1_000),
            ...PUBLISH_OPTIONS,
        }),
        NewsSnapshotPublishConflictError,
    );

    assert.equal(
        normalizeSnapshotPointer(memory.data[NEWS_SNAPSHOT_POINTER_KEY]).snapshotId,
        '2000-new',
    );
    assert.deepEqual(memory.data.news_cache.map(item => item.id), ['neu']);
});

test('Rollback schaltet aktive und Legacy-Leser gemeinsam auf die vorherige Generation', async () => {
    const memory = createMemoryStore();
    await publishNewsSnapshot({
        store: memory.store,
        articles: [article('A', 1_000)],
        runId: 'A',
        createdAt: new Date(1_000),
        ...PUBLISH_OPTIONS,
    });
    await publishNewsSnapshot({
        store: memory.store,
        articles: [article('B', 2_000)],
        runId: 'B',
        createdAt: new Date(2_000),
        ...PUBLISH_OPTIONS,
    });

    const rollback = await rollbackToPreviousNewsSnapshot({
        store: memory.store,
        logger: LEISE,
        leasePollMs: 1,
        leaseWaitMs: 2_000,
        sleep: PUBLISH_OPTIONS.sleep,
    });

    assert.equal(rollback.pointer.snapshotId, '1000-A');
    assert.equal(rollback.pointer.previousSnapshotId, '2000-B');
    assert.deepEqual(memory.data.news_cache.map(item => item.id), ['A']);

    const visible = await readBoundNewsSnapshot(memory.store);
    assert.deepEqual(visible.articles.map(item => item.id), ['A']);
    assert.equal(visible.snapshot.snapshotId, '1000-A');
});

test('Legacy-Fallback funktioniert ohne aktiven Pointer unveraendert', async () => {
    const memory = createMemoryStore({
        news_cache: [article('legacy', 1_000)],
        news_cache_16: [article('legacy', 1_000)],
        news_cache_64: [article('legacy', 1_000)],
    });

    const result = await readBoundNewsSnapshot(memory.store, {
        variant: NEWS_SNAPSHOT_VARIANTS.PREVIEW,
    });

    assert.equal(result.source, 'legacy');
    assert.equal(result.snapshot, null);
    assert.deepEqual(result.articles.map(item => item.id), ['legacy']);
});

test('Garbage Collection behaelt aktiv, vorherig und frische Teilgenerationen', async () => {
    const activeId = '200000000-active';
    const previousId = '100000000-previous';
    const expiredOrphan = '1-orphan';
    const freshOrphan = '250000000-fresh';
    const memory = createMemoryStore({
        [NEWS_SNAPSHOT_POINTER_KEY]: {
            schemaVersion: 1,
            snapshotId: activeId,
            createdAt: new Date(200_000_000).toISOString(),
            articleCount: 1,
            runId: 'active',
            previousSnapshotId: previousId,
        },
        [newsSnapshotMetadataKey(activeId)]: { keep: 'active' },
        [newsSnapshotPayloadKey(previousId, NEWS_SNAPSHOT_VARIANTS.FULL)]: ['previous'],
        [newsSnapshotPayloadKey(expiredOrphan, NEWS_SNAPSHOT_VARIANTS.FULL)]: ['orphan'],
        [newsSnapshotPayloadKey(expiredOrphan, NEWS_SNAPSHOT_VARIANTS.PREVIEW)]: ['orphan'],
        [newsSnapshotPayloadKey(freshOrphan, NEWS_SNAPSHOT_VARIANTS.FULL)]: ['fresh'],
    });

    const nowMs = 250_000_000 + NEWS_SNAPSHOT_GC_GRACE_MS - 1;
    const result = await garbageCollectNewsSnapshots(memory.store, {
        activePointer: memory.data[NEWS_SNAPSHOT_POINTER_KEY],
        graceMs: NEWS_SNAPSHOT_GC_GRACE_MS,
        now: () => new Date(nowMs),
        logger: LEISE,
    });

    assert.equal(result.removed, 2);
    assert.ok(Object.hasOwn(memory.data, newsSnapshotMetadataKey(activeId)));
    assert.ok(Object.hasOwn(
        memory.data,
        newsSnapshotPayloadKey(previousId, NEWS_SNAPSHOT_VARIANTS.FULL),
    ));
    assert.ok(Object.hasOwn(
        memory.data,
        newsSnapshotPayloadKey(freshOrphan, NEWS_SNAPSHOT_VARIANTS.FULL),
    ));
    assert.equal(Object.keys(memory.data).some(key => key.includes(expiredOrphan)), false);
});

test('Fehler von Lease-Freigabe und Garbage Collection werden bereinigt', async () => {
    const secret = 'token-sehr-geheim';
    const log = [];
    const logger = { log() {}, warn: line => log.push(String(line)) };
    const redact = message => String(message).replaceAll(secret, '[REDACTED]');
    const memory = createMemoryStore();
    const originalEval = memory.store.eval.bind(memory.store);
    memory.store.eval = async (script, keys, args) => {
        if (keys.length === 2) return originalEval(script, keys, args);
        throw new Error(`Lease API: ${secret}`);
    };

    const result = await publishNewsSnapshot({
        store: memory.store,
        articles: [article('A', 1_000)],
        runId: 'A',
        createdAt: new Date(1_000),
        garbageCollect: false,
        logger,
        redact,
    });

    assert.equal(result.pointer.snapshotId, '1000-A', 'der vollstaendige Publish bleibt gueltig');
    assert.ok(Object.hasOwn(memory.data, NEWS_SNAPSHOT_PUBLISH_LEASE_KEY), 'die Lease laeuft per TTL aus');

    memory.store.scan = async () => {
        throw new Error(`Scan API: ${secret}`);
    };
    const gc = await garbageCollectNewsSnapshots(memory.store, {
        activePointer: result.pointer,
        logger,
        redact,
    });

    assert.equal(gc.failed, true);
    assert.doesNotMatch(log.join('\n'), new RegExp(secret));
    assert.match(log.join('\n'), /\[REDACTED\]/);
});
