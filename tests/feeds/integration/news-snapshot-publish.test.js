import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../scripts/fetch-feeds.js';
import { publishNewsSnapshot } from '../../../scripts/news-snapshot-publisher.js';
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
import {
    createSpies,
    feedFetch,
    runMain as startMain,
} from '../helpers/feed-run-harness.js';

const GROQ_LEER = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
    { status: 200 },
);

const LEISE = Object.freeze({ log() {}, warn() {} });

function article(id, dateMs = Date.parse('2026-07-25T18:37:34.000Z')) {
    return {
        id,
        title: `Artikel ${id}`,
        source: 'GameStar',
        publicationDate: new Date(dateMs).toISOString(),
        summary: 'Text',
        link: `https://example.com/${id}`,
        imageUrl: `https://example.com/${id}.jpg`,
        language: 'de',
    };
}

async function runMain(spies, overrides = {}) {
    return startMain(main, spies, {
        sleep: async () => {},
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
        ...overrides,
    });
}

async function seedSnapshot(spies) {
    const result = await publishNewsSnapshot({
        store: spies.store,
        articles: [article('alt')],
        runId: 'old',
        createdAt: new Date('2026-07-28T11:00:00.000Z'),
        garbageCollect: false,
        logger: LEISE,
        sleep: async () => {},
    });
    spies.kvSets.length = 0;
    return result;
}

test('ein erfolgreicher Lauf aktiviert eine vollstaendige unveraenderliche Generation', async () => {
    const spies = createSpies();

    await runMain(spies);

    assert.deepEqual(spies.exitCodes, []);
    const pointer = normalizeSnapshotPointer(spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY]);
    assert.ok(pointer, 'der Active-Pointer ist gueltig');

    const metadataKey = newsSnapshotMetadataKey(pointer.snapshotId);
    assert.equal(spies.kvStore[metadataKey].complete, true);

    for (const variant of Object.values(NEWS_SNAPSHOT_VARIANTS)) {
        const key = newsSnapshotPayloadKey(pointer.snapshotId, variant);
        assert.ok(Array.isArray(spies.kvStore[key]), `${variant} ist unveraenderlich gespeichert`);
    }

    const visible = await readBoundNewsSnapshot(spies.store);
    assert.equal(visible.snapshot.snapshotId, pointer.snapshotId);
    assert.deepEqual(visible.articles, spies.kvStore.news_cache);
});

test('der Pointer folgt Manifest und allen Legacy-Writes als letzter kritischer Write', async () => {
    const spies = createSpies();

    await runMain(spies);

    const pointer = normalizeSnapshotPointer(spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY]);
    const keys = spies.kvSets.map(entry => entry.key);
    const pointerIndex = keys.lastIndexOf(NEWS_SNAPSHOT_POINTER_KEY);

    assert.ok(pointerIndex >= 0);
    for (const key of [
        newsSnapshotPayloadKey(pointer.snapshotId, NEWS_SNAPSHOT_VARIANTS.FULL),
        newsSnapshotPayloadKey(pointer.snapshotId, NEWS_SNAPSHOT_VARIANTS.PREVIEW),
        newsSnapshotPayloadKey(pointer.snapshotId, NEWS_SNAPSHOT_VARIANTS.MEDIUM),
        newsSnapshotMetadataKey(pointer.snapshotId),
        'news_cache',
        'news_cache_16',
        'news_cache_64',
    ]) {
        assert.ok(keys.indexOf(key) < pointerIndex, `${key} steht vor dem Pointer`);
    }
});

test('die aktive Generation ist die Merge-Basis, nicht ein abweichender Legacy-Key', async () => {
    const spies = createSpies();
    const old = await seedSnapshot(spies);
    spies.kvStore.news_cache = [article('falscher-legacy-stand')];

    await runMain(spies);

    const active = await readBoundNewsSnapshot(spies.store);
    const ids = active.articles.map(item => item.id);
    assert.ok(ids.includes('alt'), 'der gebundene alte Artikel bleibt in der Merge-Basis');
    assert.equal(ids.includes('falscher-legacy-stand'), false);
    assert.equal(
        spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY].previousSnapshotId,
        old.pointer.snapshotId,
    );
});

test('ein Fehler in einer Teilgeneration laesst den alten Pointer aktiv und beendet den Lauf fatal', async () => {
    const spies = createSpies();
    const old = await seedSnapshot(spies);
    const candidateId = `${Date.parse('2026-07-28T12:00:00.000Z')}-test-run`;
    const failingKey = newsSnapshotPayloadKey(candidateId, NEWS_SNAPSHOT_VARIANTS.PREVIEW);
    const realSet = spies.store.set;
    spies.store.set = async (key, value, options) => {
        if (key === failingKey) throw new Error('KV write abgelehnt');
        return realSet(key, value, options);
    };

    await runMain(spies);

    assert.deepEqual(spies.exitCodes, [1]);
    assert.equal(
        normalizeSnapshotPointer(spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY]).snapshotId,
        old.pointer.snapshotId,
    );
    const visible = await readBoundNewsSnapshot(spies.store);
    assert.deepEqual(visible.articles.map(item => item.id), ['alt']);
});

test('ein Fehler vor dem Publish laesst Snapshot und Legacy-Stand unangetastet', async () => {
    const spies = createSpies({ sqlError: new Error('Datenbank nicht erreichbar') });
    const old = await seedSnapshot(spies);
    const legacyBefore = structuredClone(spies.kvStore.news_cache);

    await runMain(spies);

    assert.deepEqual(spies.exitCodes, [1]);
    assert.equal(
        normalizeSnapshotPointer(spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY]).snapshotId,
        old.pointer.snapshotId,
    );
    assert.deepEqual(spies.kvStore.news_cache, legacyBefore);
});

test('Publish-Fehler geben keine konfigurierten Secrets aus', async () => {
    const spies = createSpies();
    const realSet = spies.store.set;
    spies.store.set = async (key, value, options) => {
        if (String(key).endsWith(':full')) {
            throw new Error('KV offline: https://kv.example/pipeline?token=kv-token-geheim');
        }
        return realSet(key, value, options);
    };

    await runMain(spies);

    assert.deepEqual(spies.exitCodes, [1]);
    const log = spies.logLines.join('\n');
    for (const secret of ['pg-geheim', 'kv-token-geheim', 'gsk-groq-geheim', 'proxy-geheim']) {
        assert.doesNotMatch(log, new RegExp(secret), secret);
    }
});
