import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsCacheHandler } from '../../../server/news-cache-handler.ts';

// Charakterisierung des Leseverhaltens **vor** dem generationsgebundenen
// Protokoll (Roadmap-Paket O3a).
//
// Festgehalten wird beides: was erhalten bleiben muss (Rumpfformat, Status,
// Fallback, Cache-Control fuer bestehende Clients) und die heutige Luecke -
// eine Antwort sagt nicht, aus welcher Cache-Generation sie stammt. Genau
// deshalb kann die progressive Ladekette Preview, Medium und Full aus drei
// verschiedenen Generationen mischen, ohne dass es irgendwo auffaellt.

function createArticle(id, source = 'GameStar') {
    return {
        id,
        title: `Artikel ${id}`,
        source,
        publicationDate: '2026-07-29T12:00:00.000Z',
        summary: `Zusammenfassung ${id}`,
        link: `https://example.com/${id}`,
        imageUrl: `https://example.com/${id}.jpg`,
        language: 'de',
    };
}

function createCache(values = {}) {
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

function handlerFor(cache, cacheKey, endpointPath, fallback) {
    return createNewsCacheHandler(cache.client, { cacheKey, endpointPath, fallback });
}

// === Was erhalten bleiben muss ===

test('der Rumpf ist ein nacktes Array, kein Umschlag', async () => {
    // Bestehende Clients erwarten genau das. Ein Umschlag waere ein Bruch
    // mitten in der Migration.
    const articles = [createArticle('a1'), createArticle('a2')];
    const cache = createCache({ news_cache: articles });

    const response = await handlerFor(cache, 'news_cache', '/api/get-news')(
        new Request('https://gamerfeed.example/api/get-news'),
    );

    const body = await response.json();
    assert.ok(Array.isArray(body), 'der Rumpf bleibt ein Array');
    assert.deepEqual(body, articles);
});

test('ein Client ohne Generationswissen bekommt unveraenderte Cache-Header', async () => {
    const cache = createCache({ news_cache: [createArticle('a1')] });

    const response = await handlerFor(cache, 'news_cache', '/api/get-news')(
        new Request('https://gamerfeed.example/api/get-news'),
    );

    assert.equal(response.status, 200);
    assert.equal(
        response.headers.get('cache-control'),
        's-maxage=60, stale-while-revalidate=300',
    );
});

// === Die heutige Luecke ===

test('heute verraet keine Antwort, aus welcher Generation sie stammt', async () => {
    // Charakterisierung, kein Wunschverhalten: ohne diese Angabe kann ein
    // Client zwei Antworten nicht vergleichen.
    const cache = createCache({ news_cache: [createArticle('a1')] });

    const response = await handlerFor(cache, 'news_cache', '/api/get-news')(
        new Request('https://gamerfeed.example/api/get-news'),
    );

    assert.equal(response.headers.get('x-gamerfeed-snapshot-id'), null);
});

test('heute koennen Preview, Medium und Full aus drei Generationen stammen', async () => {
    // Der Cron schreibt die drei Schluessel nacheinander. Faellt ein Lauf
    // dazwischen aus oder liefert der Edge unterschiedlich alte Kopien, sieht
    // der Browser eine Mischung - und nichts im Protokoll bemerkt es.
    //
    // Der dokumentierte Fall vom 29. Juli 2026: GameStar steht im Full-Cache,
    // fehlt aber im aelteren Teilcache, den der Browser sichtbar behielt.
    const alt = [createArticle('alt-1', 'GameZone')];
    const neu = [createArticle('alt-1', 'GameZone'), createArticle('neu-1', 'GameStar')];

    const cache = createCache({
        news_cache_16: alt,
        news_cache_64: alt,
        news_cache: neu,
    });

    const preview = await handlerFor(cache, 'news_cache_16', '/api/get-news-preview', {
        cacheKey: 'news_cache',
        limit: 16,
    })(new Request('https://gamerfeed.example/api/get-news-preview'));
    const full = await handlerFor(cache, 'news_cache', '/api/get-news')(
        new Request('https://gamerfeed.example/api/get-news'),
    );

    const previewQuellen = new Set((await preview.json()).map(a => a.source));
    const fullQuellen = new Set((await full.json()).map(a => a.source));

    assert.equal(previewQuellen.has('GameStar'), false, 'die aeltere Kopie kennt GameStar nicht');
    assert.equal(fullQuellen.has('GameStar'), true, 'der Full-Cache kennt GameStar');

    // Und genau hier fehlt heute die Information, die den Unterschied
    // erklaeren wuerde.
    assert.equal(preview.headers.get('x-gamerfeed-snapshot-id'), null);
    assert.equal(full.headers.get('x-gamerfeed-snapshot-id'), null);
});
