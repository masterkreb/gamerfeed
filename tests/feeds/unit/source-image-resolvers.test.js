import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_PLAY3_HOMEPAGE_BYTES,
    MAX_SOURCE_IMAGE_API_BYTES,
    PLAY3_HOMEPAGE_URL,
    PLAY3_IMAGE_TIMEOUT_MS,
    SOURCE_IMAGE_API_TIMEOUT_MS,
    XBOXDYNASTY_IMAGE_API_URL,
    buildXboxDynastyImageMap,
    fetchPlay3ImageMap,
    fetchXboxDynastyImageMap,
    getPlay3ArticleKey,
    getXboxDynastyArticleKey,
    parsePlay3Homepage,
} from '../../../scripts/source-image-resolvers.js';
import { isXboxDynastySource } from '../../../scripts/feed-image-utils.js';
import { ResponseTooLargeError } from '../../../scripts/limited-response.js';
import { BROWSER_LIKE_HEADERS } from '../../../scripts/feed-fetch-utils.js';

const lookup = async () => [{ address: '93.184.216.34', family: 4 }];

const PLAY3_ARTICLE = 'https://www.play3.de/2026/10/03/ein-artikel/';
const PLAY3_IMAGE = 'https://www.play3.de/wp-content/uploads/2026/10/bild-800x450.jpg';
const PLAY3_HTML = `<html><body><a href="${PLAY3_ARTICLE}"><picture><img src="data:image/svg+xml,leer" data-lazy-src="${PLAY3_IMAGE}"></picture></a></body></html>`;

test('Play3 ordnet nur kanonische HTTPS-Artikellinks zu, ohne Titelraten', () => {
    assert.equal(getPlay3ArticleKey(PLAY3_ARTICLE), '/2026/10/03/ein-artikel');
    assert.equal(getPlay3ArticleKey('/2026/10/03/ein-artikel'), '/2026/10/03/ein-artikel');
    for (const url of [
        null, '', 'javascript:alert(1)', 'http://127.0.0.1/2026/10/03/ein-artikel/',
        PLAY3_ARTICLE.replace('https:', 'http:'),
        PLAY3_ARTICLE.replace('www.play3.de', 'www.play3.de.evil.example'),
        PLAY3_ARTICLE.replace('www.play3.de', 'user:pass@www.play3.de'),
        PLAY3_ARTICLE.replace('www.play3.de', 'www.play3.de:8443'),
        `${PLAY3_ARTICLE}?preview=1`, `${PLAY3_ARTICLE}#comments`, PLAY3_HOMEPAGE_URL,
    ]) assert.equal(getPlay3ArticleKey(url), null, String(url));
});

test('Play3 liefert die echte Lazy-Bildadresse und behaelt die erste belegte Zuordnung', () => {
    const { articles, imageByArticleKey } = parsePlay3Homepage(`${PLAY3_HTML}
        <a href="${PLAY3_ARTICLE}"><img src="/wp-content/uploads/klein.jpg"></a>
        <a href="/2026/10/03/zweiter/"><img src="data:image/svg+xml,leer"><noscript><img src="/wp-content/uploads/zweiter.webp"></noscript></a>
        <a href="/2026/10/03/dritter/"><img data-src="/wp-content/uploads/dritter.png"></a>
        <a href="/2026/10/03/vierter/"><img src="/wp-content/uploads/vierter.avif"></a>
        <a href="/2026/10/03/ohne-bild/">Nur Text</a><img src="${PLAY3_IMAGE}">`);
    assert.equal(articles.size, 5);
    assert.equal(imageByArticleKey.size, 4);
    assert.equal(imageByArticleKey.get(getPlay3ArticleKey(PLAY3_ARTICLE)), PLAY3_IMAGE);
    assert.equal(imageByArticleKey.get('/2026/10/03/zweiter'), 'https://www.play3.de/wp-content/uploads/zweiter.webp');
    assert.equal(imageByArticleKey.get('/2026/10/03/ohne-bild'), undefined);
});

test('Play3 verwirft Logos, SVGs und unsichere Bildadressen auch innerhalb eines Artikellinks', () => {
    for (const image of [
        'javascript:alert(1)', 'data:image/png;base64,aaa', '/wp-content/uploads/leer.svg',
        '/wp-content/themes/play3/logo.jpg', 'https://evil.example/bild.jpg',
        'https://www.play3.de:8443/wp-content/uploads/bild.jpg',
        'https://user:pass@www.play3.de/wp-content/uploads/bild.jpg',
        'http://www.play3.de/wp-content/uploads/bild.jpg',
    ]) {
        const result = parsePlay3Homepage(`<a href="${PLAY3_ARTICLE}"><img src="${image}"></a>`);
        assert.equal(result.articles.size, 1);
        assert.equal(result.imageByArticleKey.size, 0, image);
    }
});

test('Play3-Batch ruft ausschliesslich die feste Startseite mit bestehenden Headern und Zeitlimit ab', async () => {
    const calls = [];
    const timeouts = [];
    const result = await fetchPlay3ImageMap({
        lookup,
        createSignal(ms) { timeouts.push(ms); return new AbortController().signal; },
        fetchImpl: async (url, init) => {
            calls.push({ url: String(url), init });
            return new Response(PLAY3_HTML, { headers: { 'content-type': 'text/html' } });
        },
    });
    assert.equal(result.get(getPlay3ArticleKey(PLAY3_ARTICLE)), PLAY3_IMAGE);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, PLAY3_HOMEPAGE_URL);
    assert.equal(calls[0].init.redirect, 'manual');
    assert.deepEqual(calls[0].init.headers, BROWSER_LIKE_HEADERS);
    assert.deepEqual(timeouts, [PLAY3_IMAGE_TIMEOUT_MS]);
});

test('Play3-Batch schliesst eine Fehlerantwort ohne Retry und meldet den beobachteten Status', async () => {
    let cancelled = false;
    let calls = 0;
    await assert.rejects(fetchPlay3ImageMap({
        lookup,
        fetchImpl: async () => {
            calls++;
            return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 403 });
        },
    }), /HTTP 403/);
    assert.equal(calls, 1);
    assert.equal(cancelled, true);
});

test('Play3-Batch folgt auch einer Weiterleitung auf demselben Host nicht', async () => {
    let calls = 0;
    await assert.rejects(fetchPlay3ImageMap({
        lookup,
        fetchImpl: async () => {
            calls++;
            return new Response(null, { status: 302, headers: { Location: PLAY3_ARTICLE } });
        },
    }), error => error.code === 'too_many_redirects');
    assert.equal(calls, 1);
});

test('Play3-Batch verwirft zu grosse Antworten komplett, auch bei einem fruehen Bildtreffer', async () => {
    for (const headers of [undefined, { 'content-length': String(MAX_PLAY3_HOMEPAGE_BYTES + 1) }]) {
        await assert.rejects(fetchPlay3ImageMap({
            lookup,
            fetchImpl: async () => new Response(PLAY3_HTML + 'x'.repeat(MAX_PLAY3_HOMEPAGE_BYTES), { headers }),
        }), ResponseTooLargeError);
    }
});

test('Play3-Batch unterscheidet unbekannte 200-Seiten von einer Artikelliste ohne Bilder', async () => {
    await assert.rejects(fetchPlay3ImageMap({
        lookup, fetchImpl: async () => new Response('<html><title>Just a moment...</title></html>'),
    }), /no recognizable article links/);
    const result = await fetchPlay3ImageMap({
        lookup, fetchImpl: async () => new Response(`<a href="${PLAY3_ARTICLE}">Artikel ohne Bild</a>`),
    });
    assert.equal(result.size, 0);
});

test('Play3-Batch uebergibt das Abbruchsignal und beendet einen haengenden Abruf ohne Retry', async () => {
    const controller = new AbortController();
    let calls = 0;
    const pending = fetchPlay3ImageMap({
        lookup,
        createSignal: () => controller.signal,
        fetchImpl: async (_url, init) => {
            calls++;
            assert.equal(init.signal, controller.signal);
            return new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
                controller.abort(new DOMException('Zeitlimit', 'TimeoutError'));
            });
        },
    });
    await assert.rejects(pending, { name: 'TimeoutError' });
    assert.equal(calls, 1);
});

test('Play3-Batch erreicht bei abgelehnter DNS-Adresse das Netz nicht', async () => {
    await assert.rejects(fetchPlay3ImageMap({
        lookup: async () => [{ address: '127.0.0.1', family: 4 }],
        fetchImpl: async () => assert.fail('kein Zugriff auf interne Netze'),
    }), error => error.code === 'blocked_address');
});

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
