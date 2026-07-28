import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BROWSER_LIKE_HEADERS,
    PROXY_ELIGIBLE_SOURCES,
    buildFeedProxyRequestUrl,
    fetchFeedXml,
    isFeedXml,
    isProxyEligibleSource,
} from '../../../scripts/feed-fetch-utils.js';

const FEED_URL = 'https://feeds.example.com/news.xml';
const RSS_XML = `<?xml version="1.0"?>
<rss version="2.0">
    <channel>
        <title>Example</title>
        <item><title>News</title></item>
    </channel>
</rss>`;
const ATOM_XML = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Example</title>
    <entry><title>News</title></entry>
</feed>`;

function response(body, status = 200, headers = {}) {
    return new Response(body, { status, headers });
}

function createFetchSequence(...results) {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ options, url: String(url) });
        const result = results.shift();
        if (result instanceof Error) throw result;
        if (typeof result === 'function') return result();
        if (!result) throw new Error('Unexpected fetch call');
        return result;
    };

    return { calls, fetchImpl };
}

function fetchTestFeed(options = {}) {
    return fetchFeedXml({
        // Die Proxy-Tests unten beschreiben eine ausdrücklich freigegebene
        // Quelle; die Freigabe selbst prüft der Abschnitt „Proxy-Freigabe".
        allowProxy: true,
        feedName: 'Example',
        feedUrl: FEED_URL,
        logger: null,
        // Gestellter Resolver: die Outbound-Policy prüft jedes Ziel vor dem
        // Abruf, die Testadressen existieren aber im DNS nicht.
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        retryDelayMs: 1,
        sleep: async () => {},
        ...options,
    });
}

test('erkennt RSS, Atom und RDF, aber keine HTML-Challenge als Feed', () => {
    assert.equal(isFeedXml(RSS_XML), true);
    assert.equal(isFeedXml(ATOM_XML), true);
    assert.equal(isFeedXml(`
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
            <item><title>News</title></item>
        </rdf:RDF>
    `), true);
    assert.equal(isFeedXml('<html><title>Just a moment...</title></html>'), false);
    assert.equal(isFeedXml('<rss><channel>'), false);
    assert.equal(isFeedXml('not xml'), false);
});

test('verwendet einen gültigen Direktabruf ohne Proxy', async () => {
    const fetcher = createFetchSequence(response(RSS_XML));
    const result = await fetchTestFeed({
        feedProxyUrl: 'https://proxy.example.com/feed-proxy.php',
        fetchImpl: fetcher.fetchImpl,
    });

    assert.equal(result.xmlString, RSS_XML);
    assert.equal(result.usedProxy, false);
    assert.equal(result.lastError, null);
    assert.equal(fetcher.calls.length, 1);
    assert.equal(
        fetcher.calls[0].options.headers['User-Agent'],
        BROWSER_LIKE_HEADERS['User-Agent'],
    );
});

test('wiederholt einen Netzwerkfehler genau einmal', async () => {
    const sleepCalls = [];
    const fetcher = createFetchSequence(
        new Error('socket closed'),
        response(RSS_XML),
    );

    const result = await fetchTestFeed({
        fetchImpl: fetcher.fetchImpl,
        sleep: async delay => sleepCalls.push(delay),
    });

    assert.equal(result.xmlString, RSS_XML);
    assert.equal(fetcher.calls.length, 2);
    assert.deepEqual(sleepCalls, [1]);
});

test('wiederholt einen Stream-Abbruch nach erfolgreichen HTTP-Headern', async () => {
    const interruptedResponse = new Response(new ReadableStream({
        start(controller) {
            controller.error(new Error('body interrupted'));
        },
    }));
    const fetcher = createFetchSequence(
        interruptedResponse,
        response(RSS_XML),
    );

    const result = await fetchTestFeed({ fetchImpl: fetcher.fetchImpl });

    assert.equal(result.xmlString, RSS_XML);
    assert.equal(fetcher.calls.length, 2);
});

test('wiederholt temporäre HTTP-Fehler mit begrenztem Retry-After', async () => {
    const sleepCalls = [];
    const fetcher = createFetchSequence(
        response('busy', 429, { 'Retry-After': '9' }),
        response(ATOM_XML),
    );

    const result = await fetchTestFeed({
        fetchImpl: fetcher.fetchImpl,
        sleep: async delay => sleepCalls.push(delay),
    });

    assert.equal(result.xmlString, ATOM_XML);
    assert.equal(fetcher.calls.length, 2);
    assert.deepEqual(sleepCalls, [5000]);
});

test('wiederholt temporäre Serverfehler auch beim Proxy', async () => {
    const fetcher = createFetchSequence(
        response('missing', 404),
        response('temporarily unavailable', 503),
        response(RSS_XML),
    );
    const result = await fetchTestFeed({
        feedProxyUrl: 'https://proxy.example.com/feed-proxy.php',
        fetchImpl: fetcher.fetchImpl,
    });

    assert.equal(result.xmlString, RSS_XML);
    assert.equal(result.usedProxy, true);
    assert.equal(fetcher.calls.length, 3);
});

test('wiederholt ein 415 des Proxy-Hostings, aber nicht beim Direktabruf', async () => {
    // Der Edge vor dem PHP-Proxy weist sporadisch mit 415 ab; das Skript selbst
    // erzeugt diesen Status nie.
    const proxyFetcher = createFetchSequence(
        response('blocked', 403),
        response('<html><title>415 Unsupported Media Type</title></html>', 415),
        response(RSS_XML),
    );
    const proxyResult = await fetchTestFeed({
        feedProxyUrl: 'https://proxy.example.com/feed-proxy.php',
        fetchImpl: proxyFetcher.fetchImpl,
    });

    assert.equal(proxyResult.xmlString, RSS_XML);
    assert.equal(proxyResult.usedProxy, true);
    assert.equal(proxyFetcher.calls.length, 3);

    // Beim Direktabruf bleibt 415 eine endgueltige Absage der Quelle.
    const directFetcher = createFetchSequence(response('nope', 415));
    const directResult = await fetchTestFeed({ fetchImpl: directFetcher.fetchImpl });

    assert.equal(directResult.xmlString, null);
    assert.equal(directResult.lastError, 'Direct fetch failed with status 415');
    assert.equal(directFetcher.calls.length, 1);
});

test('wiederholt permanente HTTP-Fehler nicht', async () => {
    let bodyCanceled = false;
    const notFoundResponse = {
        body: {
            cancel: async () => {
                bodyCanceled = true;
            },
        },
        headers: new Headers(),
        ok: false,
        status: 404,
    };
    const fetcher = createFetchSequence(notFoundResponse);
    const result = await fetchTestFeed({ fetchImpl: fetcher.fetchImpl });

    assert.equal(result.xmlString, null);
    assert.equal(result.lastError, 'Direct fetch failed with status 404');
    assert.equal(fetcher.calls.length, 1);
    assert.equal(bodyCanceled, true);
});

test('nutzt bei einer HTML-Challenge den Proxy und erhält bestehende Query-Parameter', async () => {
    const fetcher = createFetchSequence(
        response('<html><title>Cloudflare challenge</title></html>'),
        response(ATOM_XML),
    );
    const result = await fetchTestFeed({
        feedProxyUrl: 'https://proxy.example.com/feed-proxy.php?instance=main#ignored',
        fetchImpl: fetcher.fetchImpl,
    });

    assert.equal(result.xmlString, ATOM_XML);
    assert.equal(result.usedProxy, true);
    assert.equal(fetcher.calls.length, 2);

    const proxyUrl = new URL(fetcher.calls[1].url);
    assert.equal(proxyUrl.hash, '');
    assert.equal(proxyUrl.searchParams.get('instance'), 'main');
    assert.equal(proxyUrl.searchParams.get('url'), FEED_URL);
});

test('unterscheidet die Proxy-Allowlist von einem Upstream-403', async () => {
    const refusedFetcher = createFetchSequence(
        response('missing', 404),
        response('Not allowed', 422),
    );
    const refused = await fetchTestFeed({
        feedProxyUrl: 'https://proxy.example.com/feed-proxy.php',
        fetchImpl: refusedFetcher.fetchImpl,
    });
    assert.match(refused.lastError, /not in its allowlist/);

    const upstreamFetcher = createFetchSequence(
        response('missing', 404),
        response('Forbidden', 403),
    );
    const upstream = await fetchTestFeed({
        feedProxyUrl: 'https://proxy.example.com/feed-proxy.php',
        fetchImpl: upstreamFetcher.fetchImpl,
    });
    assert.match(upstream.lastError, /Feed proxy failed with status 403/);
    assert.doesNotMatch(upstream.lastError, /allowlist/);
});

test('lehnt HTML und übergroße Antworten auch vom Proxy ab', async () => {
    const htmlFetcher = createFetchSequence(
        response('missing', 404),
        response('<html><body>Challenge</body></html>'),
    );
    const htmlResult = await fetchTestFeed({
        feedProxyUrl: 'https://proxy.example.com/feed-proxy.php',
        fetchImpl: htmlFetcher.fetchImpl,
    });
    assert.match(htmlResult.lastError, /not an RSS or Atom feed/);

    const oversizedFetcher = createFetchSequence(response(
        RSS_XML,
        200,
        { 'Content-Length': '101' },
    ));
    const oversizedResult = await fetchTestFeed({
        fetchImpl: oversizedFetcher.fetchImpl,
        maxResponseBytes: 100,
    });
    assert.match(oversizedResult.lastError, /exceeds the 100 byte limit/);
    assert.equal(oversizedFetcher.calls.length, 1);
});

test('meldet leere erfolgreiche Antworten als ungültigen Feed', async () => {
    const fetcher = createFetchSequence(
        response(''),
        response(''),
    );
    const result = await fetchTestFeed({
        feedProxyUrl: 'https://proxy.example.com/feed-proxy.php',
        fetchImpl: fetcher.fetchImpl,
    });

    assert.equal(result.xmlString, null);
    assert.match(result.directError, /not an RSS or Atom feed/);
    assert.match(result.proxyError, /not an RSS or Atom feed/);
    assert.doesNotMatch(result.lastError, /null/);
});

test('lehnt interne Feed-Ziele ab, ohne sie zu kontaktieren oder zu wiederholen', async () => {
    for (const feedUrl of [
        'http://169.254.169.254/latest/meta-data/',
        'http://127.0.0.1/feed',
        'file:///etc/passwd',
        'https://nutzer:pw@example.com/feed',
    ]) {
        const fetcher = createFetchSequence(response(RSS_XML));
        const result = await fetchTestFeed({
            feedProxyUrl: 'https://proxy.example.com/feed-proxy.php',
            feedUrl,
            fetchImpl: fetcher.fetchImpl,
        });

        assert.equal(result.xmlString, null, `${feedUrl} wurde abgerufen`);
        assert.equal(fetcher.calls.length, 0, `${feedUrl} hat das Netzwerk erreicht`);
        assert.match(result.lastError, /nicht erlaubt|gesperrten Bereich|Nur http und https/);
    }
});

test('nutzt bei einem abgelehnten Direktziel auch den Proxy nicht', async () => {
    // Der Proxy würde das interne Ziel sonst stellvertretend abrufen.
    const fetcher = createFetchSequence(response(RSS_XML), response(RSS_XML));
    const result = await fetchTestFeed({
        feedProxyUrl: 'https://proxy.example.com/feed-proxy.php',
        feedUrl: 'http://10.0.0.5/feed',
        fetchImpl: fetcher.fetchImpl,
    });

    assert.equal(result.xmlString, null);
    assert.equal(result.usedProxy, false);
    assert.equal(fetcher.calls.length, 0);
});

test('baut Proxy-URLs ohne fehlerhafte doppelte Fragezeichen', () => {
    const result = new URL(buildFeedProxyRequestUrl(
        'https://proxy.example.com/feed-proxy.php?instance=main',
        FEED_URL,
    ));

    assert.equal(result.searchParams.get('instance'), 'main');
    assert.equal(result.searchParams.get('url'), FEED_URL);
});

// === Proxy-Freigabe (O2a) ===

test('nur ausdrücklich vorgesehene Quellen sind für den Proxy freigegeben', () => {
    assert.deepEqual([...PROXY_ELIGIBLE_SOURCES], ['gamepro']);

    assert.equal(isProxyEligibleSource({ id: 'gamepro', name: 'GamePro' }), true);
    assert.equal(isProxyEligibleSource({ id: 'GamePro' }), true);
    assert.equal(isProxyEligibleSource({ name: '  gamepro  ' }), true);
    assert.equal(isProxyEligibleSource('GamePro'), true);
});

test('XboxDynasty und andere Quellen sind nicht freigegeben', () => {
    // Der einmalig beobachtete Timeout ist ein vorübergehendes Problem der
    // Quelle und kein Grund, fremdes Hosting zu belasten.
    for (const feed of [
        { id: 'xboxdynasty', name: 'XboxDynasty' },
        { id: 'gamestar', name: 'GameStar' },
        { id: 'golem', name: 'Golem' },
        { id: 'gamepro-news', name: 'GamePro News' },
        {},
        null,
        undefined,
        '',
    ]) {
        assert.equal(isProxyEligibleSource(feed), false, JSON.stringify(feed));
    }
});

test('eine nicht freigegebene Quelle erzeugt trotz Direktfehler keinen Proxy-Aufruf', async () => {
    const fetcher = createFetchSequence(
        response('Forbidden', 403),
        // Läge hier ein Proxy-Aufruf an, käme dieser gültige Feed zurück.
        response(RSS_XML),
    );

    const result = await fetchTestFeed({
        allowProxy: false,
        feedName: 'XboxDynasty',
        feedProxyUrl: 'https://proxy.example.com/feed-proxy.php',
        fetchImpl: fetcher.fetchImpl,
    });

    assert.equal(result.xmlString, null);
    assert.equal(result.usedProxy, false);
    assert.equal(result.proxyError, null);
    // 403 ist endgültig, deshalb gibt es nur einen Direktversuch - und keinen
    // Proxy-Aufruf, obwohl eine Proxy-Adresse konfiguriert ist.
    assert.equal(fetcher.calls.length, 1);
    for (const call of fetcher.calls) {
        assert.equal(String(call.url).includes('proxy.example.com'), false);
    }
});

test('auch ein Timeout einer nicht freigegebenen Quelle führt nicht zum Proxy', async () => {
    let aufrufe = 0;
    const fetchImpl = async () => {
        aufrufe += 1;
        throw new Error('The operation was aborted due to timeout');
    };

    const result = await fetchTestFeed({
        allowProxy: false,
        feedName: 'XboxDynasty',
        feedProxyUrl: 'https://proxy.example.com/feed-proxy.php',
        fetchImpl,
    });

    assert.equal(result.xmlString, null);
    assert.equal(result.usedProxy, false);
    assert.equal(aufrufe, 2, 'zwei Direktversuche, kein Proxy');
});

test('eine freigegebene Quelle darf den Proxy nach einem 403 versuchen', async () => {
    // Genau der beobachtete Produktionsfall: GamePro antwortet dem
    // Actions-Netz mit 403, der Proxy holt den Feed stellvertretend.
    const fetcher = createFetchSequence(
        response('Forbidden', 403),
        response(RSS_XML),
    );

    const result = await fetchTestFeed({
        allowProxy: true,
        feedName: 'GamePro',
        feedProxyUrl: 'https://proxy.example.com/feed-proxy.php',
        fetchImpl: fetcher.fetchImpl,
    });

    assert.equal(result.usedProxy, true);
    assert.equal(result.xmlString, RSS_XML);
    assert.equal(fetcher.calls.length, 2);
    assert.equal(String(fetcher.calls.at(-1).url).includes('proxy.example.com'), true);
});

test('ohne konfigurierte Proxy-Adresse bleibt es beim Direktabruf', async () => {
    const fetcher = createFetchSequence(response('Forbidden', 403));

    const result = await fetchTestFeed({
        allowProxy: true,
        feedName: 'GamePro',
        feedProxyUrl: undefined,
        fetchImpl: fetcher.fetchImpl,
    });

    assert.equal(result.usedProxy, false);
    assert.equal(result.proxyError, null);
    assert.equal(fetcher.calls.length, 1);
});

// === Gebundener Transport (O2a-Review) ===

test('ohne injiziertes fetchImpl bleibt der gebundene Standardtransport zuständig', async () => {
    // Eine Vorgabe wie `fetchImpl = globalThis.fetch` würde immer ein fetchImpl
    // an fetchWithOutboundPolicy übergeben und dessen DNS-gebundenen Transport
    // stilllegen - genau den Schutz gegen DNS-Rebinding.
    const originalFetch = globalThis.fetch;
    let globaleAufrufe = 0;
    globalThis.fetch = async () => {
        globaleAufrufe += 1;
        throw new Error('globalThis.fetch darf hier nicht verwendet werden');
    };

    try {
        const aufgeloesteHosts = [];
        const result = await fetchFeedXml({
            feedName: 'Example',
            feedUrl: FEED_URL,
            logger: null,
            // Der Resolver meldet ein gesperrtes Ziel: die Policy lehnt ab,
            // bevor überhaupt eine Verbindung aufgebaut wird.
            lookup: async hostname => {
                aufgeloesteHosts.push(hostname);
                return [{ address: '10.0.0.5', family: 4 }];
            },
            retryDelayMs: 1,
            sleep: async () => {},
        });

        assert.equal(globaleAufrufe, 0, 'globalThis.fetch wurde verwendet');
        assert.ok(aufgeloesteHosts.length > 0, 'der eigene Resolver wird befragt');
        assert.equal(result.xmlString, null);
        assert.match(result.lastError, /gesperrte Adresse/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('ein injiziertes fetchImpl wird weiterhin verwendet', async () => {
    const originalFetch = globalThis.fetch;
    let globaleAufrufe = 0;
    globalThis.fetch = async () => {
        globaleAufrufe += 1;
        throw new Error('globalThis.fetch darf hier nicht verwendet werden');
    };

    try {
        const fetcher = createFetchSequence(response(RSS_XML));
        const result = await fetchTestFeed({ fetchImpl: fetcher.fetchImpl });

        assert.equal(result.xmlString, RSS_XML);
        assert.equal(fetcher.calls.length, 1);
        assert.equal(globaleAufrufe, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
