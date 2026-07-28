import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_HTML_RESPONSE_BYTES,
    getOgImageFromUrl,
} from '../../../scripts/fetch-feeds.js';

const ARTICLE_URL = 'https://www.gamestar.de/artikel/test';
const encoder = new TextEncoder();

// Der Outbound-Schutz löst den Host auf; im Test liefert der Resolver eine
// unverfängliche öffentliche Adresse, ohne echtes DNS zu befragen.
const lookup = async () => [{ address: '93.184.216.34', family: 4 }];

function silentLogger() {
    const lines = [];
    return { lines, logger: { log: line => lines.push(String(line)) } };
}

function htmlResponse(html, { headers = {}, status = 200 } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: name => headers[name.toLowerCase()] ?? null },
        body: null,
        async text() {
            return html;
        },
    };
}

/** Antwort, die den Rumpf stückweise streamt – ohne Content-Length. */
function streamingHtmlResponse(chunks) {
    let cancelled = false;
    let index = 0;

    return {
        wasCancelled: () => cancelled,
        deliveredChunks: () => index,
        response: {
            ok: true,
            status: 200,
            headers: { get: () => null },
            body: {
                getReader: () => ({
                    async read() {
                        if (index >= chunks.length) return { done: true, value: undefined };
                        return { done: false, value: encoder.encode(chunks[index++]) };
                    },
                    async cancel() {
                        cancelled = true;
                    },
                    releaseLock() {},
                }),
                async cancel() {
                    cancelled = true;
                },
            },
        },
    };
}

test('findet das og:image einer normalen Artikelseite', async () => {
    const { logger } = silentLogger();
    const fetchImpl = async () => htmlResponse(
        '<html><head><meta property="og:image" content="https://bilder.example/a.jpg"></head></html>',
    );

    const image = await getOgImageFromUrl(ARTICLE_URL, 'GameStar', { fetchImpl, lookup, logger });

    assert.equal(image, 'https://bilder.example/a.jpg');
});

test('ein hängender Abruf endet über das Abort-Signal', async () => {
    const { logger, lines } = silentLogger();
    let signalGesehen = null;

    // Antwortet nie von selbst – nur das Signal beendet den Abruf.
    const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
        signalGesehen = init.signal;
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });

    // AbortSignal.timeout() verwendet einen unref'd Timer: er feuert zwar, hält
    // die Event-Loop aber nicht selbst offen. Ohne diesen Anker würde der Test
    // enden, bevor das Signal überhaupt auslösen kann.
    const anker = setTimeout(() => {}, 5000);
    const start = Date.now();
    let image;
    try {
        image = await getOgImageFromUrl(ARTICLE_URL, 'GameStar', {
            fetchImpl,
            lookup,
            logger,
            timeoutMs: 25,
        });
    } finally {
        clearTimeout(anker);
    }

    assert.equal(image, null);
    assert.ok(signalGesehen, 'dem Abruf wird ein Abort-Signal mitgegeben');
    assert.equal(signalGesehen.aborted, true);
    assert.ok(Date.now() - start < 2000, 'der Aufruf endet über das Signal, nicht durch Warten');
    assert.ok(lines.some(line => line.includes('failed after')));
});

test('eine zu große Content-Length wird abgelehnt, ohne den Rumpf zu lesen', async () => {
    const { logger } = silentLogger();
    let textGelesen = false;

    const fetchImpl = async () => ({
        ok: true,
        status: 200,
        headers: { get: name => (name.toLowerCase() === 'content-length' ? '9999999' : null) },
        body: null,
        async text() {
            textGelesen = true;
            return '<html></html>';
        },
    });

    const image = await getOgImageFromUrl(ARTICLE_URL, 'GameStar', {
        fetchImpl,
        lookup,
        logger,
        maxBytes: 1000,
    });

    assert.equal(image, null);
    assert.equal(textGelesen, false);
});

test('ein Stream ohne Content-Length wird beim Byte-Limit beendet', async () => {
    const { logger, lines } = silentLogger();
    const stream = streamingHtmlResponse([
        '<html><head>',
        'x'.repeat(400),
        'y'.repeat(400),
        'z'.repeat(4000),
        '<meta property="og:image" content="https://bilder.example/spaet.jpg">',
    ]);

    const image = await getOgImageFromUrl(ARTICLE_URL, 'GameStar', {
        fetchImpl: async () => stream.response,
        lookup,
        logger,
        maxBytes: 500,
    });

    assert.equal(image, null, 'eine abgeschnittene Seite liefert kein Bild');
    assert.equal(stream.wasCancelled(), true, 'der Stream wird geschlossen');
    assert.ok(stream.deliveredChunks() < 5, 'es wird nicht bis zum Ende gelesen');
    assert.ok(lines.some(line => line.includes('byte limit')));
});

test('eine Seite knapp unter dem Limit wird noch ausgewertet', async () => {
    const { logger } = silentLogger();
    const fuellung = 'x'.repeat(200);
    const stream = streamingHtmlResponse([
        `<html><head><meta property="og:image" content="https://bilder.example/ok.jpg"></head><body>${fuellung}</body></html>`,
    ]);

    const image = await getOgImageFromUrl(ARTICLE_URL, 'GameStar', {
        fetchImpl: async () => stream.response,
        lookup,
        logger,
        maxBytes: 5000,
    });

    assert.equal(image, 'https://bilder.example/ok.jpg');
    assert.equal(stream.wasCancelled(), false);
});

test('die dokumentierten Vorgaben sind gesetzt', () => {
    assert.equal(MAX_HTML_RESPONSE_BYTES, 2 * 1024 * 1024);
});

test('eine Fehlerantwort schließt den Rumpf und liefert kein Bild', async () => {
    const { logger } = silentLogger();
    let geschlossen = false;

    const fetchImpl = async () => ({
        ok: false,
        status: 403,
        headers: { get: () => null },
        body: {
            async cancel() {
                geschlossen = true;
            },
        },
    });

    assert.equal(
        await getOgImageFromUrl(ARTICLE_URL, 'GameStar', { fetchImpl, lookup, logger }),
        null,
    );
    assert.equal(geschlossen, true);
});

test('ein von der Outbound-Policy abgelehntes Ziel erreicht das Netz nicht', async () => {
    const { logger } = silentLogger();
    let aufrufe = 0;
    const fetchImpl = async () => {
        aufrufe += 1;
        return htmlResponse('<html></html>');
    };

    const image = await getOgImageFromUrl('http://127.0.0.1/artikel', 'GameStar', {
        fetchImpl,
        lookup,
        logger,
    });

    assert.equal(image, null);
    assert.equal(aufrufe, 0, 'der Schutz greift vor dem Verbindungsaufbau');
});

test('Fehlermeldungen des Scrapings werden bereinigt protokolliert', async () => {
    const { logger, lines } = silentLogger();
    const fetchImpl = async () => {
        throw new Error('kaputt: https://nutzer:geheim@innen.example/pfad?token=abc');
    };

    await getOgImageFromUrl(ARTICLE_URL, 'GameStar', { fetchImpl, lookup, logger });

    const protokoll = lines.join('\n');
    assert.doesNotMatch(protokoll, /geheim/);
    assert.doesNotMatch(protokoll, /token=abc/);
});
