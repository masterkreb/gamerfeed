import test from 'node:test';
import assert from 'node:assert/strict';
import { createGamingNewsHandler } from '../../../api/gaming-news.ts';
import { createNewsCacheHandler } from '../../../server/news-cache-handler.ts';
import {
    NEWS_SNAPSHOT_POINTER_KEY,
    SNAPSHOT_ID_HEADER,
    buildSnapshotPointer,
} from '../../../shared/news-snapshot.js';
import {
    NEWS_SNAPSHOT_VARIANTS,
    legacySnapshotRollbackEnabled,
    newsSnapshotMetadataKey,
    newsSnapshotPayloadKey,
    readActiveNewsSnapshotMetadata,
    readBoundNewsSnapshot,
} from '../../../shared/news-snapshot-store.js';

function article(id) {
    return {
        id,
        title: `Artikel ${id}`,
        source: 'GameStar',
        publicationDate: '2026-07-29T12:00:00.000Z',
        summary: 'Zusammenfassung',
        link: `https://example.com/${id}`,
        imageUrl: `https://example.com/${id}.jpg`,
        language: 'de',
    };
}

function addGeneration(values, millis, runId, articles) {
    const pointer = buildSnapshotPointer({
        snapshotId: `${millis}-${runId}`,
        createdAt: new Date(millis),
        articleCount: articles.length,
        runId,
    });
    const payloads = {
        full: articles,
        preview: articles.slice(0, 16),
        medium: articles.slice(0, 64),
    };
    const descriptors = {};

    for (const [variant, value] of Object.entries(payloads)) {
        const key = newsSnapshotPayloadKey(pointer.snapshotId, variant);
        values[key] = value;
        descriptors[variant] = {
            key,
            count: value.length,
            bytes: Buffer.byteLength(JSON.stringify(value)),
        };
    }

    values[newsSnapshotMetadataKey(pointer.snapshotId)] = {
        ...pointer,
        complete: true,
        sources: [...new Set(articles.map(item => item.source))],
        payloads: descriptors,
    };
    return pointer;
}

function createCache(values) {
    const calls = [];
    return {
        calls,
        client: {
            async get(key) {
                calls.push(key);
                return Object.hasOwn(values, key) ? values[key] : null;
            },
        },
    };
}

test('ein gepinnter Client kann die direkt vorherige unveraenderliche Generation lesen', async () => {
    const values = {};
    const previous = addGeneration(values, 1_000, 'A', [article('A')]);
    const active = addGeneration(values, 2_000, 'B', [article('B')]);
    values[NEWS_SNAPSHOT_POINTER_KEY] = {
        ...active,
        previousSnapshotId: previous.snapshotId,
    };
    const cache = createCache(values);

    const result = await readBoundNewsSnapshot(cache.client, {
        variant: NEWS_SNAPSHOT_VARIANTS.FULL,
        requestedSnapshotId: previous.snapshotId,
    });

    assert.deepEqual(result.articles.map(item => item.id), ['A']);
    assert.equal(result.snapshot.snapshotId, previous.snapshotId);
});

test('eine unbekannte angefragte Generation liefert aktiv und wird nicht falsch gecacht', async () => {
    const values = {};
    const active = addGeneration(values, 2_000, 'B', [article('B')]);
    values[NEWS_SNAPSHOT_POINTER_KEY] = active;
    const cache = createCache(values);
    const handler = createNewsCacheHandler(
        cache.client,
        { cacheKey: 'news_cache', endpointPath: '/api/get-news' },
        undefined,
        {
            readBoundSnapshot: requestedSnapshotId => readBoundNewsSnapshot(cache.client, {
                requestedSnapshotId,
            }),
        },
    );

    const response = await handler(
        new Request('https://example.com/api/get-news?snapshot=1000-unbekannt'),
    );

    assert.equal(response.headers.get(SNAPSHOT_ID_HEADER), active.snapshotId);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await response.json()).map(item => item.id), ['B']);
});

test('eine unvollstaendige aktive Generation faellt ohne falschen Header auf Legacy zurueck', async () => {
    const values = {
        news_cache: [article('legacy')],
    };
    const active = buildSnapshotPointer({
        snapshotId: '2000-B',
        createdAt: new Date(2_000),
        articleCount: 1,
        runId: 'B',
    });
    values[NEWS_SNAPSHOT_POINTER_KEY] = active;
    values[newsSnapshotPayloadKey(active.snapshotId, NEWS_SNAPSHOT_VARIANTS.FULL)] = [article('teil')];
    // Das Manifest fehlt absichtlich: ein Teilpayload ist keine Generation.
    const cache = createCache(values);

    const result = await readBoundNewsSnapshot(cache.client);

    assert.equal(result.source, 'legacy');
    assert.equal(result.snapshot, null);
    assert.deepEqual(result.articles.map(item => item.id), ['legacy']);
});

test('die Metadatenquelle liest keinen Full-Payload', async () => {
    const values = {};
    const active = addGeneration(values, 2_000, 'B', [article('B')]);
    values[NEWS_SNAPSHOT_POINTER_KEY] = active;
    const cache = createCache(values);

    const metadata = await readActiveNewsSnapshotMetadata(cache.client);

    assert.equal(metadata.snapshotId, active.snapshotId);
    assert.deepEqual(metadata.sources, ['GameStar']);
    assert.deepEqual(cache.calls, [
        NEWS_SNAPSHOT_POINTER_KEY,
        newsSnapshotMetadataKey(active.snapshotId),
    ]);
});

test('/gaming-news nennt die Generation desselben unveraenderlichen Full-Payloads', async () => {
    const values = {};
    const active = addGeneration(values, 2_000, 'B', [article('B')]);
    values[NEWS_SNAPSHOT_POINTER_KEY] = active;
    const cache = createCache(values);
    const handler = createGamingNewsHandler(cache.client);

    const response = await handler(new Request('https://example.com/gaming-news'));
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get(SNAPSHOT_ID_HEADER), active.snapshotId);
    assert.match(html, new RegExp(`<meta name="gamerfeed:snapshot" content="${active.snapshotId}">`));
    assert.match(html, /Artikel B/);
});

test('die Legacy-Rollback-Flagge akzeptiert nur true oder 1', () => {
    assert.equal(legacySnapshotRollbackEnabled('true'), true);
    assert.equal(legacySnapshotRollbackEnabled(' TRUE '), true);
    assert.equal(legacySnapshotRollbackEnabled('1'), true);
    assert.equal(legacySnapshotRollbackEnabled('false'), false);
    assert.equal(legacySnapshotRollbackEnabled('yes'), false);
    assert.equal(legacySnapshotRollbackEnabled(undefined), false);
});

test('/gaming-news folgt einem ausdruecklichen Legacy-Rollback ohne Snapshot-Angabe', async () => {
    const values = { news_cache: [article('legacy')] };
    const active = addGeneration(values, 2_000, 'B', [article('B')]);
    values[NEWS_SNAPSHOT_POINTER_KEY] = active;
    const cache = createCache(values);
    const handler = createGamingNewsHandler(cache.client, { legacyRollback: true });

    const response = await handler(new Request('https://example.com/gaming-news'));
    const html = await response.text();

    assert.equal(response.headers.get(SNAPSHOT_ID_HEADER), null);
    assert.doesNotMatch(html, /gamerfeed:snapshot/);
    assert.match(html, /Artikel legacy/);
});
