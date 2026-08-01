import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_SOURCE_IMAGE_API_BYTES,
    SOURCE_IMAGE_API_TIMEOUT_MS,
    XBOXDYNASTY_IMAGE_API_URL,
    buildXboxDynastyImageMap,
    fetchXboxDynastyImageMap,
    getXboxDynastyArticleKey,
} from '../../../scripts/source-image-resolvers.js';
import { isXboxDynastySource } from '../../../scripts/feed-image-utils.js';
import { ResponseTooLargeError } from '../../../scripts/limited-response.js';

const lookup = async () => [{ address: '93.184.216.34', family: 4 }];

function post(link, imageUrl) {
    return {
        link,
        yoast_head_json: {
            og_image: imageUrl === undefined ? [] : [{ url: imageUrl }],
        },
    };
}

test('erkennt XboxDynasty ohne die Schreibweise an mehreren Stellen zu duplizieren', () => {
    assert.equal(isXboxDynastySource('XboxDynasty'), true);
    assert.equal(isXboxDynastySource(' xboxdynasty '), true);
    assert.equal(isXboxDynastySource('Xbox Wire'), false);
});

test('ordnet gültige WordPress-Bilder über die kanonische Artikeladresse zu', () => {
    const result = buildXboxDynastyImageMap([
        post(
            'https://www.xboxdynasty.de/news/spiel/ein-artikel/',
            'https://www.xboxdynasty.de/wp-content/uploads/2026/08/bild.jpg',
        ),
        post('https://www.xboxdynasty.de/news/ohne-bild/', undefined),
        post('javascript:alert(1)', 'https://www.xboxdynasty.de/bild.jpg'),
        post('https://www.xboxdynasty.de/news/boese/', 'data:image/png;base64,abc'),
    ]);

    assert.deepEqual([...result.entries()], [[
        '/news/spiel/ein-artikel',
        'https://www.xboxdynasty.de/wp-content/uploads/2026/08/bild.jpg',
    ]]);
});

test('gleicht Slash und Querystring aus, aber nie eine fremde Domain', () => {
    assert.equal(
        getXboxDynastyArticleKey('https://www.xboxdynasty.de/news/Spiel/Artikel/?utm_source=rss'),
        '/news/spiel/artikel',
    );
    assert.equal(
        getXboxDynastyArticleKey('https://xboxdynasty.de/news/Spiel/Artikel'),
        '/news/spiel/artikel',
    );
    assert.equal(getXboxDynastyArticleKey('https://example.com/news/spiel/artikel'), null);
});

test('ruft genau den kompakten HTTPS-Batch ab und gibt die Bildzuordnung zurück', async () => {
    const calls = [];
    const timeouts = [];
    const result = await fetchXboxDynastyImageMap({
        lookup,
        createSignal(timeoutMs) {
            timeouts.push(timeoutMs);
            return new AbortController().signal;
        },
        async fetchImpl(url, init) {
            calls.push({ url: String(url), init });
            return new Response(JSON.stringify([
                post(
                    'https://www.xboxdynasty.de/news/spiel/ein-artikel/',
                    'https://www.xboxdynasty.de/wp-content/uploads/2026/08/bild.jpg',
                ),
            ]), { status: 200, headers: { 'content-type': 'application/json' } });
        },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, XBOXDYNASTY_IMAGE_API_URL);
    assert.equal(new URL(calls[0].url).protocol, 'https:');
    assert.equal(calls[0].init.headers.Accept, 'application/json');
    assert.deepEqual(timeouts, [SOURCE_IMAGE_API_TIMEOUT_MS]);
    assert.equal(
        result.get('/news/spiel/ein-artikel'),
        'https://www.xboxdynasty.de/wp-content/uploads/2026/08/bild.jpg',
    );
});

test('HTTP-Fehler, ungültiges JSON und unerwartete Nutzlasten werden nicht als leerer Erfolg ausgegeben', async () => {
    for (const response of [
        new Response('Unauthorized', { status: 401 }),
        new Response('{kaputt', { status: 200 }),
        new Response('{"posts":[]}', { status: 200 }),
    ]) {
        await assert.rejects(
            fetchXboxDynastyImageMap({
                lookup,
                fetchImpl: async () => response,
            }),
            /XboxDynasty image API/,
        );
    }
});

test('auch eine WordPress-Antwort ohne Content-Length bleibt größenbegrenzt', async () => {
    const payload = JSON.stringify([post(
        'https://www.xboxdynasty.de/news/zu-gross/',
        `https://www.xboxdynasty.de/${'x'.repeat(MAX_SOURCE_IMAGE_API_BYTES)}`,
    )]);

    await assert.rejects(
        fetchXboxDynastyImageMap({
            lookup,
            maxBytes: 100,
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                headers: new Headers(),
                body: null,
                text: async () => payload,
            }),
        }),
        ResponseTooLargeError,
    );
});
