import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assertOutboundTargetAllowed,
    fetchWithOutboundPolicy,
    isBlockedIpAddress,
    MAX_OUTBOUND_REDIRECTS,
    OutboundPolicyError,
} from '../../../scripts/outbound-policy.js';

const PUBLIC_V4 = { address: '93.184.216.34', family: 4 };
const PUBLIC_V6 = { address: '2606:4700:4700::1111', family: 6 };

/** Fester Resolver: bildet Hostnamen auf vorgegebene Adressen ab. */
function createLookup(map) {
    return async hostname => {
        if (!(hostname in map)) {
            throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
        }
        return map[hostname];
    };
}

function createFetchRecorder(responder) {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ options, url: String(url) });
        return responder(String(url), calls.length);
    };
    return { calls, fetchImpl };
}

function redirectTo(location, status = 302) {
    return {
        body: null,
        headers: new Headers(location === null ? {} : { location }),
        status,
    };
}

const OK_RESPONSE = { body: null, headers: new Headers(), status: 200 };

async function expectPolicyError(promise, code) {
    await assert.rejects(
        promise,
        error => error.code === code,
        `erwartet wurde der Fehlercode "${code}"`,
    );
}

test('erkennt gesperrte IPv4-Bereiche einschließlich alternativer Notationen', () => {
    for (const address of [
        '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254',
        '172.16.0.1', '172.31.255.255', '192.0.2.5', '192.168.1.1', '198.18.0.1',
        '198.51.100.7', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    ]) {
        assert.equal(isBlockedIpAddress(address), true, `${address} muss gesperrt sein`);
    }

    for (const address of ['8.8.8.8', '93.184.216.34', '1.1.1.1', '172.32.0.1', '100.63.255.255']) {
        assert.equal(isBlockedIpAddress(address), false, `${address} darf nicht gesperrt sein`);
    }
});

test('erkennt gesperrte IPv6-Bereiche und IPv4-mapped Adressen', () => {
    for (const address of [
        '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
        '2001:db8::1', '64:ff9b::7f00:1', '2002:7f00:1::',
        '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1',
        'fe80::1%eth0',
    ]) {
        assert.equal(isBlockedIpAddress(address), true, `${address} muss gesperrt sein`);
    }

    for (const address of ['2606:4700:4700::1111', '2a00:1450:4001:80f::200e']) {
        assert.equal(isBlockedIpAddress(address), false, `${address} darf nicht gesperrt sein`);
    }
});

test('behandelt unbrauchbare Eingaben als gesperrt', () => {
    for (const value of ['', 'kein-ip', undefined, null, 42, {}, '999.999.999.999']) {
        assert.equal(isBlockedIpAddress(value), true, `${String(value)} muss als gesperrt gelten`);
    }
});

test('lehnt numerisch geschriebene interne Ziele ab, bevor DNS befragt wird', async () => {
    let lookupCalls = 0;
    const lookup = async () => { lookupCalls += 1; return [PUBLIC_V4]; };

    // Dezimal, oktal, hexadezimal und IPv4-mapped IPv6 zeigen alle auf 127.0.0.1.
    for (const rawUrl of [
        'http://127.0.0.1/',
        'http://2130706433/',
        'http://0177.0.0.1/',
        'http://0x7f000001/',
        'http://[::ffff:127.0.0.1]/',
        'http://[::1]/',
        'http://169.254.169.254/latest/meta-data/',
    ]) {
        await expectPolicyError(assertOutboundTargetAllowed(rawUrl, { lookup }), 'blocked_address');
    }

    assert.equal(lookupCalls, 0, 'für IP-Literale darf kein DNS befragt werden');
});

test('lässt öffentliche Ziele mit IPv4 und IPv6 zu', async () => {
    const lookup = createLookup({
        'nur-v4.example': [PUBLIC_V4],
        'nur-v6.example': [PUBLIC_V6],
        'dual.example': [PUBLIC_V4, PUBLIC_V6],
    });

    for (const hostname of ['nur-v4.example', 'nur-v6.example', 'dual.example']) {
        const result = await assertOutboundTargetAllowed(`https://${hostname}/feed`, { lookup });
        assert.equal(result.url.hostname, hostname);
        assert.ok(result.addresses.length > 0);
    }

    // Ein öffentliches IP-Literal ist ebenfalls erlaubt.
    const literal = await assertOutboundTargetAllowed('https://93.184.216.34/feed', { lookup });
    assert.deepEqual(literal.addresses, [{ address: '93.184.216.34', family: 4 }]);
});

test('lehnt gemischte DNS-Antworten ab, sobald eine Adresse gesperrt ist', async () => {
    const lookup = createLookup({
        'privat.example': [{ address: '10.0.0.5', family: 4 }],
        'gemischt-v4.example': [PUBLIC_V4, { address: '127.0.0.1', family: 4 }],
        'gemischt-v6.example': [PUBLIC_V6, { address: 'fd00::1', family: 6 }],
        'gemischt-mapped.example': [PUBLIC_V4, { address: '::ffff:169.254.169.254', family: 6 }],
        'leer.example': [],
    });

    await expectPolicyError(assertOutboundTargetAllowed('https://privat.example/', { lookup }), 'blocked_address');
    await expectPolicyError(assertOutboundTargetAllowed('https://gemischt-v4.example/', { lookup }), 'blocked_address');
    await expectPolicyError(assertOutboundTargetAllowed('https://gemischt-v6.example/', { lookup }), 'blocked_address');
    await expectPolicyError(assertOutboundTargetAllowed('https://gemischt-mapped.example/', { lookup }), 'blocked_address');
    await expectPolicyError(assertOutboundTargetAllowed('https://leer.example/', { lookup }), 'dns_empty');
    await expectPolicyError(assertOutboundTargetAllowed('https://unbekannt.example/', { lookup }), 'dns_failed');
});

test('reicht syntaktische Ablehnungen der gemeinsamen Policy durch', async () => {
    const lookup = createLookup({});
    await expectPolicyError(assertOutboundTargetAllowed('javascript:alert(1)', { lookup }), 'protocol_not_allowed');
    await expectPolicyError(assertOutboundTargetAllowed('https://nutzer:pw@example.com/', { lookup }), 'credentials_not_allowed');
    await expectPolicyError(assertOutboundTargetAllowed('nicht-parsebar', { lookup }), 'invalid_syntax');
});

test('erreicht bei einem abgelehnten Ziel niemals das Netzwerk', async () => {
    const lookup = createLookup({ 'privat.example': [{ address: '192.168.0.10', family: 4 }] });
    const recorder = createFetchRecorder(() => OK_RESPONSE);

    for (const rawUrl of [
        'http://127.0.0.1/',
        'https://privat.example/feed',
        'javascript:alert(1)',
        'https://nutzer:pw@example.com/',
    ]) {
        await assert.rejects(fetchWithOutboundPolicy(rawUrl, {
            fetchImpl: recorder.fetchImpl,
            lookup,
        }));
    }

    assert.equal(recorder.calls.length, 0, 'es wurde trotz Ablehnung eine Anfrage abgesetzt');
});

test('folgt Weiterleitungen nur nach erneuter Prüfung jedes Ziels', async () => {
    const lookup = createLookup({
        'start.example': [PUBLIC_V4],
        'ziel.example': [PUBLIC_V4],
    });
    const recorder = createFetchRecorder(url => (
        url.startsWith('https://start.example')
            ? redirectTo('https://ziel.example/feed.xml')
            : OK_RESPONSE
    ));

    const response = await fetchWithOutboundPolicy('https://start.example/feed', {
        fetchImpl: recorder.fetchImpl,
        lookup,
    });

    assert.equal(response.status, 200);
    assert.equal(recorder.calls.length, 2);
    assert.equal(recorder.calls[1].url, 'https://ziel.example/feed.xml');
    // Automatisches Folgen bleibt abgeschaltet, sonst entstünde ein ungeprüfter Hop.
    for (const call of recorder.calls) {
        assert.equal(call.options.redirect, 'manual');
    }
});

test('löst relative Weiterleitungsziele gegen den aktuellen Hop auf', async () => {
    const lookup = createLookup({ 'start.example': [PUBLIC_V4] });
    const recorder = createFetchRecorder((url, callNumber) => (
        callNumber === 1 ? redirectTo('/woanders/feed.xml') : OK_RESPONSE
    ));

    const response = await fetchWithOutboundPolicy('https://start.example/pfad/feed', {
        fetchImpl: recorder.fetchImpl,
        lookup,
    });

    assert.equal(response.status, 200);
    assert.equal(recorder.calls[1].url, 'https://start.example/woanders/feed.xml');
});

test('bricht bei einer Weiterleitung auf ein internes Ziel ab', async () => {
    const lookup = createLookup({
        'start.example': [PUBLIC_V4],
        'intern.example': [{ address: '169.254.169.254', family: 4 }],
    });

    for (const location of [
        'http://169.254.169.254/latest/meta-data/',
        'https://intern.example/geheim',
        'http://[::1]/',
        'file:///etc/passwd',
    ]) {
        const recorder = createFetchRecorder(() => redirectTo(location));
        await assert.rejects(
            fetchWithOutboundPolicy('https://start.example/feed', {
                fetchImpl: recorder.fetchImpl,
                lookup,
            }),
            error => error instanceof OutboundPolicyError || error.name === 'UrlPolicyError',
        );
        // Der erste Hop war erlaubt, der zweite wurde nicht mehr abgesetzt.
        assert.equal(recorder.calls.length, 1, `Ziel ${location} wurde kontaktiert`);
    }
});

test('erkennt Weiterleitungsschleifen und begrenzt die Anzahl der Hops', async () => {
    const lookup = createLookup({
        'a.example': [PUBLIC_V4],
        'b.example': [PUBLIC_V4],
    });

    // Direkte Schleife auf sich selbst.
    const selfLoop = createFetchRecorder(() => redirectTo('https://a.example/feed'));
    await expectPolicyError(
        fetchWithOutboundPolicy('https://a.example/feed', { fetchImpl: selfLoop.fetchImpl, lookup }),
        'redirect_loop',
    );
    assert.equal(selfLoop.calls.length, 1);

    // Schleife über zwei Stationen.
    const pingPong = createFetchRecorder(url => redirectTo(
        url.startsWith('https://a.example') ? 'https://b.example/feed' : 'https://a.example/feed',
    ));
    await expectPolicyError(
        fetchWithOutboundPolicy('https://a.example/feed', { fetchImpl: pingPong.fetchImpl, lookup }),
        'redirect_loop',
    );
    assert.equal(pingPong.calls.length, 2);

    // Kette ohne Wiederholung, aber über der Obergrenze.
    let counter = 0;
    const chain = createFetchRecorder(() => {
        counter += 1;
        return redirectTo(`https://a.example/schritt-${counter}`);
    });
    await expectPolicyError(
        fetchWithOutboundPolicy('https://a.example/start', { fetchImpl: chain.fetchImpl, lookup }),
        'too_many_redirects',
    );
    assert.equal(chain.calls.length, MAX_OUTBOUND_REDIRECTS + 1);
});

test('behandelt eine Weiterleitung ohne Ziel als Endantwort', async () => {
    const lookup = createLookup({ 'a.example': [PUBLIC_V4] });
    const recorder = createFetchRecorder(() => redirectTo(null, 302));

    const response = await fetchWithOutboundPolicy('https://a.example/feed', {
        fetchImpl: recorder.fetchImpl,
        lookup,
    });

    assert.equal(response.status, 302);
    assert.equal(recorder.calls.length, 1);
});

test('lehnt ein syntaktisch kaputtes Weiterleitungsziel ab', async () => {
    const lookup = createLookup({ 'a.example': [PUBLIC_V4] });
    const recorder = createFetchRecorder(() => redirectTo('http://'));

    await assert.rejects(fetchWithOutboundPolicy('https://a.example/feed', {
        fetchImpl: recorder.fetchImpl,
        lookup,
    }));
    assert.equal(recorder.calls.length, 1);
});

test('charakterisiert die aktuell verwendeten öffentlichen Feed-Adressen', async () => {
    // Read-only-Charakterisierung: diese Adressen stammen aus dem laufenden
    // Betrieb und müssen die Policy syntaktisch passieren. DNS wird gestellt,
    // damit der Test ohne Netzwerk läuft.
    const productionFeedUrls = [
        'https://www.gamepro.de/rss/gamepro.rss',
        'https://www.gamestar.de/news/rss/news.rss',
        'https://rss.golem.de/rss.php?feed=RSS2.0',
        'https://www.destructoid.com/feed/',
        'https://www.pcgames.de/feed.cfm?menu_alias=home',
        'https://www.nintendolife.com/feeds/latest',
        'https://www.gameswirtschaft.de/feed/',
        'https://www.xboxdynasty.de/feed/',
        'https://playfront.de/feed/',
    ];

    const lookup = async () => [PUBLIC_V4];
    for (const rawUrl of productionFeedUrls) {
        const result = await assertOutboundTargetAllowed(rawUrl, { lookup });
        assert.equal(result.url.protocol, 'https:', `${rawUrl} wurde verändert`);
    }
});

test('der gebundene Lookup gibt nur geprüfte Adressen an den Transport', async () => {
    const { createPinnedLookup } = await import('../../../scripts/outbound-policy.js');

    const call = (lookup, hostname, options) => new Promise((resolve, reject) => {
        lookup(hostname, options, (error, ...result) => {
            if (error) reject(error);
            else resolve(result);
        });
    });

    // Erlaubtes Ziel: die geprüfte Adresse wird durchgereicht.
    const allowed = createPinnedLookup(createLookup({ 'gut.example': [PUBLIC_V4] }));
    assert.deepEqual(await call(allowed, 'gut.example', {}), ['93.184.216.34', 4]);
    assert.deepEqual(await call(allowed, 'gut.example', { all: true }), [[PUBLIC_V4]]);

    // Gesperrtes Ziel: der Transport bekommt gar keine Adresse, sondern einen
    // Fehler - damit entsteht zwischen Prüfung und Verbindung kein Zeitfenster.
    const blocked = createPinnedLookup(createLookup({
        'rebind.example': [{ address: '127.0.0.1', family: 4 }],
        'gemischt.example': [PUBLIC_V4, { address: '169.254.169.254', family: 4 }],
        'leer.example': [],
    }));

    for (const [hostname, code] of [
        ['rebind.example', 'blocked_address'],
        ['gemischt.example', 'blocked_address'],
        ['leer.example', 'dns_empty'],
    ]) {
        await assert.rejects(
            call(blocked, hostname, {}),
            error => error.code === code,
            `${hostname} hätte mit "${code}" scheitern müssen`,
        );
    }
});
