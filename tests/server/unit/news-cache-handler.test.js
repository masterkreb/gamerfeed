import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsCacheHandler } from '../../../server/news-cache-handler.ts';

function createArticle(id) {
    return {
        id,
        title: `Artikel ${id}`,
        source: 'GameStar',
        publicationDate: '2026-07-26T12:00:00.000Z',
        summary: `Zusammenfassung ${id}`,
        link: `https://example.com/${id}`,
        imageUrl: `https://example.com/${id}.jpg`,
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
                if (error !== null) {
                    throw error;
                }
                return Object.hasOwn(values, key) ? values[key] : null;
            },
        },
    };
}

function createLogger() {
    const calls = [];
    return {
        calls,
        logger: {
            error(...args) {
                calls.push(args);
            },
        },
    };
}

async function readJson(response) {
    return response.json();
}

function assertSuccessHeaders(response) {
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(
        response.headers.get('cache-control'),
        's-maxage=60, stale-while-revalidate=300',
    );
}

function assertErrorHeaders(response) {
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(response.headers.get('cache-control'), 'no-cache');
}

test('liefert den vollständigen Cache mit unveränderten Response-Headern', async () => {
    const articles = [createArticle('one'), createArticle('two')];
    const cache = createCache({ news_cache: articles });
    const handler = createNewsCacheHandler(cache.client, {
        cacheKey: 'news_cache',
        endpointPath: '/api/get-news',
    });

    const response = await handler(new Request('https://gamerfeed.example/api/get-news'));

    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), articles);
    assert.deepEqual(cache.calls, ['news_cache']);
    assertSuccessHeaders(response);
});

test('verwendet einen vorhandenen Teilcache ohne unnötigen Fallback-Abruf', async () => {
    const previewArticles = [createArticle('preview')];
    const cache = createCache({
        news_cache_16: previewArticles,
        news_cache: [createArticle('full')],
    });
    const handler = createNewsCacheHandler(cache.client, {
        cacheKey: 'news_cache_16',
        endpointPath: '/api/get-news-preview',
        fallback: {
            cacheKey: 'news_cache',
            limit: 16,
        },
    });

    const response = await handler(new Request('https://gamerfeed.example/api/get-news-preview'));

    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), previewArticles);
    assert.deepEqual(cache.calls, ['news_cache_16']);
    assertSuccessHeaders(response);
});

test('schneidet bei fehlendem Teilcache den vollständigen Cache auf das Limit zu', async () => {
    const fullArticles = [
        createArticle('one'),
        createArticle('two'),
        createArticle('three'),
    ];
    const cache = createCache({
        news_cache_16: null,
        news_cache: fullArticles,
    });
    const handler = createNewsCacheHandler(cache.client, {
        cacheKey: 'news_cache_16',
        endpointPath: '/api/get-news-preview',
        fallback: {
            cacheKey: 'news_cache',
            limit: 2,
        },
    });

    const response = await handler(new Request('https://gamerfeed.example/api/get-news-preview'));

    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), fullArticles.slice(0, 2));
    assert.deepEqual(cache.calls, ['news_cache_16', 'news_cache']);
    assertSuccessHeaders(response);
});

test('behandelt einen vorhandenen leeren Teilcache weiterhin als gültige Antwort', async () => {
    const cache = createCache({
        news_cache_64: [],
        news_cache: [createArticle('full')],
    });
    const handler = createNewsCacheHandler(cache.client, {
        cacheKey: 'news_cache_64',
        endpointPath: '/api/get-news-medium',
        fallback: {
            cacheKey: 'news_cache',
            limit: 64,
        },
    });

    const response = await handler(new Request('https://gamerfeed.example/api/get-news-medium'));

    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), []);
    assert.deepEqual(cache.calls, ['news_cache_64']);
    assertSuccessHeaders(response);
});

test('liefert bei vollständig fehlendem Cache weiterhin 404', async () => {
    const cache = createCache();
    const handler = createNewsCacheHandler(cache.client, {
        cacheKey: 'news_cache_16',
        endpointPath: '/api/get-news-preview',
        fallback: {
            cacheKey: 'news_cache',
            limit: 16,
        },
    });

    const response = await handler(new Request('https://gamerfeed.example/api/get-news-preview'));

    assert.equal(response.status, 404);
    assert.deepEqual(await readJson(response), {
        error: 'Cache is empty or not available.',
    });
    assert.deepEqual(cache.calls, ['news_cache_16', 'news_cache']);
    assertErrorHeaders(response);
});

test('protokolliert KV-Fehler und liefert deren Fehlermeldung mit Status 500', async () => {
    const error = new Error('KV nicht erreichbar');
    const cache = createCache({}, error);
    const log = createLogger();
    const handler = createNewsCacheHandler(
        cache.client,
        {
            cacheKey: 'news_cache',
            endpointPath: '/api/get-news',
        },
        log.logger,
    );

    const response = await handler(new Request('https://gamerfeed.example/api/get-news'));

    assert.equal(response.status, 500);
    assert.deepEqual(await readJson(response), { error: 'KV nicht erreichbar' });
    assert.deepEqual(log.calls, [[
        'API Error in /api/get-news:',
        error,
    ]]);
    assertErrorHeaders(response);
});

test('verwendet bei unbekannten Fehlerwerten die bisherige generische Meldung', async () => {
    const cache = createCache({}, 'kaputt');
    const log = createLogger();
    const handler = createNewsCacheHandler(
        cache.client,
        {
            cacheKey: 'news_cache',
            endpointPath: '/api/get-news',
        },
        log.logger,
    );

    const response = await handler(new Request('https://gamerfeed.example/api/get-news'));

    assert.equal(response.status, 500);
    assert.deepEqual(await readJson(response), {
        error: 'An unknown server error occurred.',
    });
    assertErrorHeaders(response);
});
