import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_HTML_RESPONSE_BYTES,
    getOgImageFromUrl,
} from '../../../scripts/fetch-feeds.js';
import { createArticleImageBrake } from '../../../scripts/article-image-brake.js';

const ARTICLE_URL = 'https://www.gamestar.de/artikel/test';
const PLAY3_ARTICLE_URL = 'https://www.play3.de/2026/10/03/test-artikel/';
const PROXY_URL = 'https://proxy.example.com/feed-proxy.php';
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

// === Hilfen für den Play3-Bildpfad ===

const SEITE_MIT_BILD = '<html><head><meta property="og:image" content="https://bilder.play3.de/artikel.jpg"></head></html>';
const SEITE_OHNE_BILD = '<html><head><title>Artikel</title></head><body></body></html>';
const PLAY3_BILD = 'https://bilder.play3.de/artikel.jpg';

/** Adresse des n-ten Artikels in der kanonischen Form, die der Bildmodus annimmt. */
function play3Artikel(nummer) {
    return `https://www.play3.de/2026/10/03/artikel-${nummer}/`;
}

/**
 * Netz mit zwei Wegen: Anfragen an die Artikelseite und Anfragen an den Proxy.
 *
 * Beide Antworten sind Funktionen der laufenden Nummer des jeweiligen Wegs
 * (ab 1), damit sich Abfolgen wie "zweimal Fehler, dann eine Antwort" einfach
 * schreiben lassen. Eine Funktion darf auch werfen - das ist ein Netzwerkfehler.
 */
function createPlay3Netz({ direkt, proxy = () => htmlResponse(SEITE_MIT_BILD) }) {
    const aufrufe = { direkt: 0, proxy: 0, adressen: [] };
    const fetchImpl = async (url, options) => {
        const adresse = String(url);
        const weg = adresse.startsWith(PROXY_URL) ? 'proxy' : 'direkt';
        aufrufe[weg] += 1;
        aufrufe.adressen.push(adresse);
        return (weg === 'proxy' ? proxy : direkt)(aufrufe[weg], options);
    };
    return { aufrufe, fetchImpl };
}

/** Bucht Budgeteinheiten wie das Laufbudget: eine je Anfrage, danach false. */
function createReservierung(limit = Number.POSITIVE_INFINITY) {
    const stand = { abgelehnt: 0, genutzt: 0 };
    return {
        stand,
        reserveRequest() {
            if (stand.genutzt >= limit) {
                stand.abgelehnt += 1;
                return false;
            }
            stand.genutzt += 1;
            return true;
        },
    };
}

/** Ruft nacheinander `anzahl` Play3-Artikel eines Laufs ab - mit gemeinsamer Bremse. */
async function scrapePlay3Lauf(anzahl, { brake = createArticleImageBrake(), ...optionen }) {
    const bilder = [];
    for (let nummer = 1; nummer <= anzahl; nummer += 1) {
        bilder.push(await getOgImageFromUrl(play3Artikel(nummer), 'Play3', {
            imageBrake: brake,
            lookup,
            proxyUrl: PROXY_URL,
            ...optionen,
        }));
    }
    return bilder;
}

/** Die Logzeilen, die melden, dass eine Bremse einen Weg ausgesetzt hat. */
function bremsenZeilen(lines) {
    return lines.filter(line => line.includes('ausgesetzt'));
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

    assert.equal(image, null, 'ein Bild hinter der Grenze bleibt unsichtbar');
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

// === Zu große Seiten: der gelesene Anfang wird ausgewertet ===
//
// og:image steht fast immer ganz am Anfang im <head>. Eine Seite, die die
// Grenze überschreitet, verliert ihr Bild deshalb nicht mehr mit dem Rest.

// Neutrale Quelle und Adresse: es geht um die Größe der Seite, nicht um ihren Absender.
const GROSSE_SEITE_URL = 'https://www.beispiel.example/artikel/gross';

/** Ein Abruf, der zählt, wie oft das Netz angefragt wurde. */
function zaehlenderAbruf(antwort) {
    const stand = { anfragen: 0 };
    return {
        stand,
        fetchImpl: async () => {
            stand.anfragen += 1;
            return antwort;
        },
    };
}

test('eine Seite über dem Limit wird mit dem gelesenen Anfang ausgewertet', async () => {
    const { logger, lines } = silentLogger();
    const reservierung = createReservierung();
    const stream = streamingHtmlResponse([
        '<html><head><title>Große Seite</title>'
            + '<meta property="og:image" content="https://bilder.example/gross.jpg"></head><body>',
        'x'.repeat(2000),
        'y'.repeat(2000),
        'z'.repeat(2000),
    ]);
    const abruf = zaehlenderAbruf(stream.response);

    const image = await getOgImageFromUrl(GROSSE_SEITE_URL, 'Beispiel', {
        fetchImpl: abruf.fetchImpl,
        logger,
        lookup,
        maxBytes: 1000,
        reserveRequest: reservierung.reserveRequest,
    });

    assert.equal(image, 'https://bilder.example/gross.jpg');
    assert.equal(abruf.stand.anfragen, 1, 'es bleibt bei einer einzigen Anfrage');
    assert.deepEqual(reservierung.stand, { abgelehnt: 0, genutzt: 1 }, 'und bei einer Budgeteinheit');
    assert.equal(stream.wasCancelled(), true, 'der Stream wird geschlossen');
    assert.equal(stream.deliveredChunks(), 2, 'nach der Überschreitung wird nicht weitergelesen');
    assert.ok(
        lines.some(line => line.includes('1000 byte limit')),
        'die gekürzte Auswertung steht im Log',
    );
    assert.ok(!lines.some(line => line.includes('failed after')), 'es ist kein Fehlschlag');
});

test('eine Seite über dem Limit ohne Bild im gelesenen Anfang liefert kein Bild und keinen Absturz', async () => {
    const { logger, lines } = silentLogger();
    const reservierung = createReservierung();
    const stream = streamingHtmlResponse([
        '<html><head><title>Große Seite</title>',
        'x'.repeat(2000),
        // Hinter der Grenze: wird nie gelesen.
        '<meta property="og:image" content="https://bilder.example/zu-spaet.jpg">',
    ]);
    const abruf = zaehlenderAbruf(stream.response);

    const image = await getOgImageFromUrl(GROSSE_SEITE_URL, 'Beispiel', {
        fetchImpl: abruf.fetchImpl,
        logger,
        lookup,
        maxBytes: 1000,
        reserveRequest: reservierung.reserveRequest,
    });

    assert.equal(image, null);
    assert.equal(abruf.stand.anfragen, 1);
    assert.equal(reservierung.stand.genutzt, 1);
    assert.equal(stream.deliveredChunks(), 2, 'der Chunk mit dem späten Tag wird nicht mehr gelesen');
    assert.ok(lines.some(line => line.includes('No image candidate')), 'die Suche läuft regulär zu Ende');
    assert.ok(!lines.some(line => line.includes('failed after')), 'es ist kein Fehlschlag');
});

test('ausgewertet wird höchstens die Grenze, auch im Chunk, der sie überschreitet', async () => {
    const { logger } = silentLogger();
    const kopf = '<html><head><title>Große Seite</title>';
    const seite = kopf + 'x'.repeat(50)
        + '<meta property="og:image" content="https://bilder.example/hinter-der-grenze.jpg">';
    const grenze = encoder.encode(kopf).byteLength + 50;

    // Ein einziger Chunk überschreitet die Grenze. Das vollständige Meta-Tag
    // liegt dahinter und damit schon im Speicher - gesehen werden darf es nicht.
    const gekuerzt = await getOgImageFromUrl(GROSSE_SEITE_URL, 'Beispiel', {
        fetchImpl: async () => streamingHtmlResponse([seite]).response,
        logger,
        lookup,
        maxBytes: grenze,
    });
    assert.equal(gekuerzt, null);

    // Kontrolle: dieselbe Seite innerhalb einer ausreichenden Grenze liefert das Bild.
    const vollstaendig = await getOgImageFromUrl(GROSSE_SEITE_URL, 'Beispiel', {
        fetchImpl: async () => streamingHtmlResponse([seite]).response,
        logger,
        lookup,
        maxBytes: 100_000,
    });
    assert.equal(vollstaendig, 'https://bilder.example/hinter-der-grenze.jpg');
});

test('ein von der Grenze mitten im Tag abgeschnittenes og:image liefert kein halbes Bild', async () => {
    const { logger } = silentLogger();
    const kopf = '<html><head><meta property="og:image" content="https://bilder.example/halb';
    const seite = `${kopf}.jpg"></head><body>${'x'.repeat(500)}</body></html>`;
    // Die Grenze fällt mitten in die Adresse.
    const grenze = encoder.encode(kopf).byteLength - 3;

    const image = await getOgImageFromUrl(GROSSE_SEITE_URL, 'Beispiel', {
        fetchImpl: async () => streamingHtmlResponse([seite.slice(0, 40), seite.slice(40)]).response,
        logger,
        lookup,
        maxBytes: grenze,
    });

    assert.equal(image, null, 'eine abgeschnittene Adresse wäre ein kaputtes Bild');
});

test('ein an der Grenze zerschnittenes UTF-8-Zeichen führt nicht zum Absturz', async () => {
    const { logger } = silentLogger();
    const davor = '<html><head><meta property="og:image" content="https://bilder.example/umlaut.jpg"><title>Gr';
    // Die Grenze fällt in die Mitte des zweibyteigen ö.
    const grenze = encoder.encode(davor).byteLength + 1;

    const image = await getOgImageFromUrl(GROSSE_SEITE_URL, 'Beispiel', {
        fetchImpl: async () => streamingHtmlResponse([
            `${davor}öße der Welt</title></head><body>${'x'.repeat(500)}`,
        ]).response,
        logger,
        lookup,
        maxBytes: grenze,
    });

    assert.equal(image, 'https://bilder.example/umlaut.jpg');
});

test('auch der YouTube-Fallback arbeitet auf dem gelesenen Anfang', async () => {
    const { logger } = silentLogger();
    const stream = streamingHtmlResponse([
        '<html><head><title>Video</title></head><body>'
            + '<iframe src="https://www.youtube.com/embed/abc123XYZ"></iframe>',
        'x'.repeat(3000),
    ]);

    const image = await getOgImageFromUrl(GROSSE_SEITE_URL, 'Beispiel', {
        fetchImpl: async () => stream.response,
        logger,
        lookup,
        maxBytes: 1000,
    });

    assert.equal(image, 'https://img.youtube.com/vi/abc123XYZ/hqdefault.jpg');
});

test('auch eine Antwort ohne Stream wird über dem Limit mit ihrem Anfang ausgewertet', async () => {
    const { logger } = silentLogger();
    // Attrappen und manche Runtimes liefern den fertigen Text statt eines Streams.
    const seite = '<html><head><meta property="og:image" content="https://bilder.example/ohne-stream.jpg">'
        + `</head><body>${'x'.repeat(5000)}</body></html>`;

    const image = await getOgImageFromUrl(GROSSE_SEITE_URL, 'Beispiel', {
        fetchImpl: async () => htmlResponse(seite),
        logger,
        lookup,
        maxBytes: 1000,
    });

    assert.equal(image, 'https://bilder.example/ohne-stream.jpg');
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

test('Play3 nutzt den Bild-Proxy erst nach dem erfolglosen Direktabruf und bucht beide Anfragen', async () => {
    const { logger } = silentLogger();
    const reservierung = createReservierung();
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ options, url: String(url) });
        if (calls.length === 1) return htmlResponse('Forbidden', { status: 403 });
        // Der Proxy liefert die Seite als text/plain aus. Ausgewertet wird nur
        // der Rumpf, unabhängig vom Content-Type.
        return htmlResponse(SEITE_MIT_BILD, {
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
    };

    const image = await getOgImageFromUrl(PLAY3_ARTICLE_URL, 'Play3', {
        fetchImpl,
        logger,
        lookup,
        proxyUrl: 'https://proxy.example.com/feed-proxy.php?instance=main#ignored',
        reserveRequest: reservierung.reserveRequest,
    });

    assert.equal(image, PLAY3_BILD);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, PLAY3_ARTICLE_URL, 'der Direktabruf bleibt erster Versuch');
    assert.deepEqual(
        reservierung.stand,
        { abgelehnt: 0, genutzt: 2 },
        'Direktabruf und Proxyversuch kosten je eine Budgeteinheit',
    );

    const proxyRequest = new URL(calls[1].url);
    assert.equal(proxyRequest.hash, '');
    assert.equal(proxyRequest.searchParams.get('instance'), 'main');
    assert.equal(proxyRequest.searchParams.get('mode'), 'article-image');
    assert.equal(proxyRequest.searchParams.get('url'), PLAY3_ARTICLE_URL);
});

test('findet der Direktabruf ein Bild, kostet er genau eine Einheit und der Proxy bleibt unberührt', async () => {
    const { logger } = silentLogger();
    const reservierung = createReservierung();
    const netz = createPlay3Netz({ direkt: () => htmlResponse(SEITE_MIT_BILD) });

    const image = await getOgImageFromUrl(PLAY3_ARTICLE_URL, 'Play3', {
        fetchImpl: netz.fetchImpl,
        logger,
        lookup,
        proxyUrl: PROXY_URL,
        reserveRequest: reservierung.reserveRequest,
    });

    assert.equal(image, PLAY3_BILD);
    assert.deepEqual(netz.aufrufe.adressen, [PLAY3_ARTICLE_URL]);
    assert.equal(reservierung.stand.genutzt, 1);
});

test('andere Quellen verwenden weder den Play3-Bildmodus noch die Bremse', async () => {
    const { logger, lines } = silentLogger();
    const reservierung = createReservierung();
    // Beide Wege der Bremse sind bereits ausgesetzt. Eine andere Quelle darf
    // davon nichts merken und bucht wie bisher genau eine Einheit je Artikel.
    const brake = createArticleImageBrake();
    brake.record('direct', { status: 403 });
    brake.record('proxy', { status: 403 });
    let aufrufe = 0;
    const fetchImpl = async () => {
        aufrufe += 1;
        return htmlResponse('Forbidden', { status: 403 });
    };

    for (let durchlauf = 1; durchlauf <= 3; durchlauf += 1) {
        const image = await getOgImageFromUrl(ARTICLE_URL, 'GameStar', {
            fetchImpl,
            imageBrake: brake,
            logger,
            lookup,
            proxyUrl: PROXY_URL,
            reserveRequest: reservierung.reserveRequest,
        });

        assert.equal(image, null);
    }

    assert.equal(aufrufe, 3, 'jeder Artikel genau ein Direktversuch, nie ein Proxyversuch');
    assert.equal(reservierung.stand.genutzt, 3, 'eine Einheit je Artikel, wie bisher');
    assert.deepEqual(bremsenZeilen(lines), [], 'eine andere Quelle löst keine Bremse aus');
});

test('ohne übergebene Bremse und ohne Budgetrückfrage verhält sich der Abruf wie bisher', async () => {
    const { logger, lines } = silentLogger();
    const netz = createPlay3Netz({ direkt: () => htmlResponse('Forbidden', { status: 403 }) });

    const bilder = await scrapePlay3Lauf(3, {
        brake: null,
        fetchImpl: netz.fetchImpl,
        logger,
    });

    assert.deepEqual(bilder, [PLAY3_BILD, PLAY3_BILD, PLAY3_BILD]);
    assert.equal(netz.aufrufe.direkt, 3, 'ohne Bremse versucht jeder Artikel den Direktweg');
    assert.equal(netz.aufrufe.proxy, 3);
    assert.deepEqual(bremsenZeilen(lines), []);
});

// === Budget je Anfrage ===

test('ist das Budget nach dem Direktversuch erschöpft, entfällt der Proxyversuch', async () => {
    const { logger, lines } = silentLogger();
    const reservierung = createReservierung(1);
    const netz = createPlay3Netz({ direkt: () => htmlResponse('Forbidden', { status: 403 }) });

    const image = await getOgImageFromUrl(PLAY3_ARTICLE_URL, 'Play3', {
        fetchImpl: netz.fetchImpl,
        logger,
        lookup,
        proxyUrl: PROXY_URL,
        reserveRequest: reservierung.reserveRequest,
    });

    assert.equal(image, null);
    assert.equal(netz.aufrufe.direkt, 1);
    assert.equal(netz.aufrufe.proxy, 0, 'kein Proxyversuch ohne Budgeteinheit');
    assert.deepEqual(reservierung.stand, { abgelehnt: 1, genutzt: 1 });
    assert.ok(lines.some(line => line.includes('skipped')), 'der entfallene Versuch ist im Log erkennbar');
});

test('ohne Budgeteinheit entsteht gar keine Anfrage', async () => {
    const { logger } = silentLogger();
    const reservierung = createReservierung(0);
    const netz = createPlay3Netz({ direkt: () => htmlResponse(SEITE_MIT_BILD) });

    const image = await getOgImageFromUrl(PLAY3_ARTICLE_URL, 'Play3', {
        fetchImpl: netz.fetchImpl,
        logger,
        lookup,
        proxyUrl: PROXY_URL,
        reserveRequest: reservierung.reserveRequest,
    });

    assert.equal(image, null);
    assert.deepEqual(netz.aufrufe.adressen, []);
});

test('ein ausgesetzter Weg kostet keine Budgeteinheit', async () => {
    const { logger } = silentLogger();
    const reservierung = createReservierung();
    const netz = createPlay3Netz({ direkt: () => htmlResponse('Forbidden', { status: 403 }) });

    await scrapePlay3Lauf(4, {
        fetchImpl: netz.fetchImpl,
        logger,
        reserveRequest: reservierung.reserveRequest,
    });

    // Erster Artikel: Direktversuch und Proxyversuch. Die übrigen drei gehen
    // nach der Bremse direkt an den Proxy - eine Einheit je Artikel.
    assert.equal(reservierung.stand.genutzt, 2 + 3);
    assert.equal(reservierung.stand.genutzt, netz.aufrufe.direkt + netz.aufrufe.proxy, 'jede Einheit entspricht einer Anfrage');
});

// === Bremse des Direktwegs ===

test('bei mehreren Play3-Artikeln mit Direkt-403 gibt es nur einen Direktversuch pro Lauf', async () => {
    const { logger, lines } = silentLogger();
    const reservierung = createReservierung();
    const netz = createPlay3Netz({ direkt: () => htmlResponse('Forbidden', { status: 403 }) });

    const bilder = await scrapePlay3Lauf(5, {
        fetchImpl: netz.fetchImpl,
        logger,
        reserveRequest: reservierung.reserveRequest,
    });

    assert.deepEqual(bilder, Array(5).fill(PLAY3_BILD), 'alle Artikel bekommen ihr Bild über den Proxy');
    assert.equal(netz.aufrufe.direkt, 1, 'der Direktweg wird im Lauf genau einmal geprüft');
    assert.equal(netz.aufrufe.proxy, 5);
    assert.equal(netz.aufrufe.adressen[0], play3Artikel(1), 'der eine Direktversuch gilt dem ersten Artikel');
    assert.equal(reservierung.stand.genutzt, 6, 'ein Direktversuch plus fünf Proxyversuche');

    const zeilen = bremsenZeilen(lines);
    assert.equal(zeilen.length, 1, 'genau eine Zeile für die Bremse');
    assert.match(zeilen[0], /Play3/);
    assert.match(zeilen[0], /Direktabruf/);
    assert.match(zeilen[0], /HTTP 403/);
    assert.doesNotMatch(zeilen[0], /https?:|proxy\.example|play3\.de/, 'weder Adresse noch Proxy');
});

test('Direktweg: auch 401 und 429 setzen ihn für den Rest des Laufs aus', async () => {
    for (const status of [401, 429]) {
        const { logger, lines } = silentLogger();
        const netz = createPlay3Netz({ direkt: () => htmlResponse('Nein', { status }) });

        await scrapePlay3Lauf(3, { fetchImpl: netz.fetchImpl, logger });

        assert.equal(netz.aufrufe.direkt, 1, `HTTP ${status}`);
        assert.equal(netz.aufrufe.proxy, 3, `HTTP ${status}`);
        assert.match(bremsenZeilen(lines).join('\n'), new RegExp(`HTTP ${status}`));
    }
});

test('jeder neue Lauf prüft den Direktweg wieder und kehrt zu ihm zurück, sobald er klappt', async () => {
    const { logger } = silentLogger();

    // Erster Lauf: der Direktweg liefert 403.
    const ersterLauf = createPlay3Netz({ direkt: () => htmlResponse('Forbidden', { status: 403 }) });
    await scrapePlay3Lauf(3, { fetchImpl: ersterLauf.fetchImpl, logger });
    assert.equal(ersterLauf.aufrufe.direkt, 1);
    assert.equal(ersterLauf.aufrufe.proxy, 3);

    // Zweiter Lauf, neue Bremse: der Direktweg funktioniert wieder. Der Proxy
    // wird nicht mehr gebraucht.
    const zweiterLauf = createPlay3Netz({ direkt: () => htmlResponse(SEITE_MIT_BILD) });
    const bilder = await scrapePlay3Lauf(3, { fetchImpl: zweiterLauf.fetchImpl, logger });
    assert.deepEqual(bilder, [PLAY3_BILD, PLAY3_BILD, PLAY3_BILD]);
    assert.equal(zweiterLauf.aufrufe.direkt, 3);
    assert.equal(zweiterLauf.aufrufe.proxy, 0);
});

test('ohne Proxy-Adresse setzt der erste Direkt-403 den Direktweg für den Rest des Laufs aus', async () => {
    const { logger, lines } = silentLogger();
    const reservierung = createReservierung();
    const netz = createPlay3Netz({ direkt: () => htmlResponse('Forbidden', { status: 403 }) });

    const bilder = await scrapePlay3Lauf(3, {
        fetchImpl: netz.fetchImpl,
        logger,
        proxyUrl: null,
        reserveRequest: reservierung.reserveRequest,
    });

    assert.deepEqual(bilder, [null, null, null]);
    assert.equal(netz.aufrufe.direkt, 1);
    assert.equal(netz.aufrufe.proxy, 0);
    assert.equal(reservierung.stand.genutzt, 1, 'Artikel ohne jede Anfrage kosten nichts');
    assert.equal(bremsenZeilen(lines).length, 1);
});

// === Bremse des Proxywegs ===

for (const status of [401, 403, 422, 429]) {
    test(`Proxyweg: HTTP ${status} setzt ihn für den Rest des Laufs aus`, async () => {
        const { logger, lines } = silentLogger();
        const reservierung = createReservierung();
        // 404 beim Direktabruf betrifft nur den Artikel und bremst nicht - so
        // bleibt der Proxyweg hier der einzige, der angehalten wird.
        const netz = createPlay3Netz({
            direkt: () => htmlResponse('Nicht gefunden', { status: 404 }),
            proxy: () => htmlResponse('Nein', { status }),
        });

        const bilder = await scrapePlay3Lauf(3, {
            fetchImpl: netz.fetchImpl,
            logger,
            reserveRequest: reservierung.reserveRequest,
        });

        assert.deepEqual(bilder, [null, null, null]);
        assert.equal(netz.aufrufe.proxy, 1, 'nach dem ersten Treffer folgt kein Proxyabruf mehr');
        assert.equal(netz.aufrufe.direkt, 3, 'der Direktweg bleibt davon unberührt');
        assert.equal(reservierung.stand.genutzt, 4);

        const zeilen = bremsenZeilen(lines);
        assert.equal(zeilen.length, 1, 'genau eine Zeile für die Bremse');
        assert.match(zeilen[0], /Play3/);
        assert.match(zeilen[0], /Proxyabruf/);
        assert.match(zeilen[0], new RegExp(`HTTP ${status}`));
        assert.doesNotMatch(zeilen[0], /https?:|proxy\.example|play3\.de/, 'weder Adresse noch Proxy');
    });
}

test('Proxyweg: Netzwerkfehler stoppen ihn erst nach drei Fehlschlägen in Folge', async () => {
    const { logger, lines } = silentLogger();
    const netz = createPlay3Netz({
        direkt: () => htmlResponse('Nicht gefunden', { status: 404 }),
        proxy: () => {
            throw new Error('connect ECONNRESET https://nutzer:geheim@proxy.example.com/x?token=abc');
        },
    });

    const bilder = await scrapePlay3Lauf(5, { fetchImpl: netz.fetchImpl, logger });

    assert.deepEqual(bilder, Array(5).fill(null));
    assert.equal(netz.aufrufe.proxy, 3, 'drei Versuche, dann ist der Proxyweg ausgesetzt');
    assert.equal(netz.aufrufe.direkt, 5);

    const zeilen = bremsenZeilen(lines);
    assert.equal(zeilen.length, 1, 'genau eine Zeile für die Bremse');
    assert.match(zeilen[0], /Proxyabruf/);
    assert.match(zeilen[0], /3 Fehlschläge in Folge/);
    assert.match(zeilen[0], /ohne HTTP-Status/);

    const protokoll = lines.join('\n');
    assert.doesNotMatch(protokoll, /geheim/, 'keine Zugangsdaten im Log');
    assert.doesNotMatch(protokoll, /token=abc/, 'kein Querystring im Log');
});

test('Proxyweg: Zeitüberschreitungen zählen wie Netzwerkfehler', async () => {
    const { logger, lines } = silentLogger();
    // Ein Signal, das kurz nach der Anfrage mit einem Timeout endet - ohne echtes Warten.
    const createSignal = () => {
        const controller = new AbortController();
        setImmediate(() => controller.abort(new DOMException('timeout', 'TimeoutError')));
        return controller.signal;
    };
    const netz = createPlay3Netz({
        direkt: () => htmlResponse('Nicht gefunden', { status: 404 }),
        proxy: (_nummer, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        }),
    });

    await scrapePlay3Lauf(5, { createSignal, fetchImpl: netz.fetchImpl, logger });

    assert.equal(netz.aufrufe.proxy, 3);
    assert.equal(bremsenZeilen(lines).length, 1);
});

test('Proxyweg: 5xx-Antworten zählen als Fehlschlag in Folge', async () => {
    const { logger, lines } = silentLogger();
    const netz = createPlay3Netz({
        direkt: () => htmlResponse('Nicht gefunden', { status: 404 }),
        proxy: () => htmlResponse('Upstream fetch failed', { status: 502 }),
    });

    await scrapePlay3Lauf(5, { fetchImpl: netz.fetchImpl, logger });

    assert.equal(netz.aufrufe.proxy, 3);
    assert.match(bremsenZeilen(lines).join('\n'), /zuletzt HTTP 502/);
});

test('Proxyweg: eine Antwort zwischen den Fehlern setzt den Zähler zurück', async () => {
    const { logger, lines } = silentLogger();
    const ablauf = ['fehler', 'fehler', 404, 'fehler', 'fehler', 'fehler'];
    const netz = createPlay3Netz({
        direkt: () => htmlResponse('Nicht gefunden', { status: 404 }),
        proxy: nummer => {
            const schritt = ablauf[nummer - 1];
            if (schritt === 'fehler') throw new Error('Netz weg');
            return htmlResponse('Nicht gefunden', { status: schritt });
        },
    });

    await scrapePlay3Lauf(8, { fetchImpl: netz.fetchImpl, logger });

    // Fehler, Fehler, Antwort (Zähler zurück), dann erst drei Fehler in Folge.
    assert.equal(netz.aufrufe.proxy, 6);
    assert.equal(bremsenZeilen(lines).length, 1);
});

test('Proxyweg: ein Fehler beim Lesen der Antwort ist kein Netzwerkfehler', async () => {
    const { logger, lines } = silentLogger();
    // Der Proxy hat bei "zu gross" geantwortet, die Seite ist nur größer als
    // erlaubt. Das belegt, dass der Weg funktioniert: der Zähler beginnt neu und
    // das Lesen selbst zählt nicht als weiterer Fehlschlag. Würde es zählen,
    // wären die Netzwerkfehler 4 und 5 schon der dritte und vierte in Folge.
    //
    // Hier kündigt schon die Content-Length eine Größe über der Grenze an. Streamt
    // eine Seite erst während des Lesens über die Grenze, wird ihr Anfang
    // ausgewertet und es entsteht gar kein Lesefehler mehr (siehe "Zu große
    // Seiten" oben).
    const ablauf = ['fehler', 'fehler', 'zu gross', 'fehler', 'fehler', 'antwort'];
    const netz = createPlay3Netz({
        direkt: () => htmlResponse('Nicht gefunden', { status: 404 }),
        proxy: nummer => {
            const schritt = ablauf[nummer - 1];
            if (schritt === 'fehler') throw new Error('Netz weg');
            if (schritt === 'zu gross') {
                return htmlResponse('x'.repeat(500), { headers: { 'content-length': '500' } });
            }
            return htmlResponse('Nicht gefunden', { status: 404 });
        },
    });

    await scrapePlay3Lauf(6, { fetchImpl: netz.fetchImpl, logger, maxBytes: 100 });

    assert.equal(netz.aufrufe.proxy, 6, 'jede Seite wird einzeln versucht');
    assert.deepEqual(bremsenZeilen(lines), []);
});

// === Einzelartikel bremsen nie ===

test('404 und "kein Bild gefunden" bremsen weder den Direkt- noch den Proxyweg', async () => {
    const { logger, lines } = silentLogger();
    const reservierung = createReservierung();
    const ohneErfolg = nummer => (
        nummer % 2 === 1
            ? htmlResponse('Nicht gefunden', { status: 404 })
            : htmlResponse(SEITE_OHNE_BILD)
    );
    const netz = createPlay3Netz({ direkt: ohneErfolg, proxy: ohneErfolg });

    const bilder = await scrapePlay3Lauf(6, {
        fetchImpl: netz.fetchImpl,
        logger,
        reserveRequest: reservierung.reserveRequest,
    });

    assert.deepEqual(bilder, Array(6).fill(null));
    assert.equal(netz.aufrufe.direkt, 6, 'jeder Artikel bekommt seinen Direktversuch');
    assert.equal(netz.aufrufe.proxy, 6, 'und seinen Proxyversuch');
    assert.equal(reservierung.stand.genutzt, 12);
    assert.deepEqual(bremsenZeilen(lines), []);
});

test('eine nicht kanonische Play3-Adresse geht nie an den Proxy und bremst nichts', async () => {
    const { logger, lines } = silentLogger();
    const brake = createArticleImageBrake();
    const netz = createPlay3Netz({ direkt: () => htmlResponse('Nicht gefunden', { status: 404 }) });
    const ungewoehnlich = [
        'https://www.play3.de/2026/10/03/gr%C3%B6%C3%9Fe-sache/',
        'https://www.play3.de/2026/10/03/mit_unterstrich/',
        'https://www.play3.de/magazin/artikel/',
        'https://www.play3.de/2026/10/03/artikel/?utm_source=rss',
    ];

    for (const adresse of ungewoehnlich) {
        const image = await getOgImageFromUrl(adresse, 'Play3', {
            fetchImpl: netz.fetchImpl,
            imageBrake: brake,
            logger,
            lookup,
            proxyUrl: PROXY_URL,
        });
        assert.equal(image, null);
    }

    assert.equal(netz.aufrufe.proxy, 0, 'der Proxy würde jede dieser Adressen mit 422 abweisen');
    assert.equal(netz.aufrufe.direkt, ungewoehnlich.length, 'der Direktversuch bleibt');
    assert.deepEqual(bremsenZeilen(lines), []);
    assert.equal(brake.isStopped('proxy'), false);

    // Der nächste kanonische Artikel nutzt den Proxy wie gewohnt.
    const image = await getOgImageFromUrl(play3Artikel(1), 'Play3', {
        fetchImpl: netz.fetchImpl,
        imageBrake: brake,
        logger,
        lookup,
        proxyUrl: PROXY_URL,
    });
    assert.equal(image, PLAY3_BILD);
    assert.equal(netz.aufrufe.proxy, 1);
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
