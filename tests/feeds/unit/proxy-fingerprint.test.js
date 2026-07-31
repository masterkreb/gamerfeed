// Isolierter Proxy-Fingerprint (Roadmap-Paket O4d).
//
// Kein Test dieser Datei berührt einen Feed-Anbieter, den Produktionscache, die
// Datenbank oder ein echtes Hosting: der Abruf läuft ausschließlich über eine
// injizierte Attrappe, und Zeitgrenzen werden gestellt statt abgewartet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    PROXY_FINGERPRINT_ALGORITHM,
    PROXY_FINGERPRINT_MAX_BYTES,
    PROXY_FINGERPRINT_SCHEMA_VERSION,
    PROXY_FINGERPRINT_SERVICE,
    PROXY_FINGERPRINT_TIMEOUT_MS,
    buildFingerprintRequestUrl,
    canonicalizeProxySource,
    checkProxyFingerprint,
    computeProxyFingerprint,
    normalizeFingerprintPayload,
    redactProxyMessage,
} from '../../../scripts/proxy-fingerprint.js';
import { main as checkerMain } from '../../../scripts/check-proxy-fingerprint.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PROXY_SOURCE_PATH = resolve(REPO_ROOT, 'tools/feed-proxy.php');

// Eine Adresse mit Querystring: genau die Form, die als GitHub-Secret gepflegt
// wird und in keiner Meldung auftauchen darf.
const PROXY_URL = 'https://proxy.example/gamerfeed/feed-proxy.php?key=proxy-geheim';

const QUELLTEXT = "<?php\ndeclare(strict_types=1);\necho 'hallo';\n";

/** Gestellter Resolver: die Outbound-Policy prüft jedes Ziel vor dem Abruf. */
const lookupStub = async () => [{ address: '93.184.216.34', family: 4 }];

function jsonAntwort(payload, { status = 200 } = {}) {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return new Response(body, {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function gueltigeAntwort(fingerprint) {
    return jsonAntwort({
        schemaVersion: PROXY_FINGERPRINT_SCHEMA_VERSION,
        service: PROXY_FINGERPRINT_SERVICE,
        algorithm: PROXY_FINGERPRINT_ALGORITHM,
        fingerprint,
    });
}

/** Zeichnet jede Anfrage auf und beantwortet sie aus einer Attrappe. */
function createFetchStub(handler) {
    const calls = [];
    return {
        calls,
        fetchImpl: async (url, init) => {
            calls.push({ url: String(url), init });
            return handler(String(url), init);
        },
    };
}

async function pruefe(handler, overrides = {}) {
    const stub = createFetchStub(handler);
    const result = await checkProxyFingerprint({
        feedProxyUrl: PROXY_URL,
        expectedFingerprint: computeProxyFingerprint(QUELLTEXT),
        fetchImpl: stub.fetchImpl,
        lookup: lookupStub,
        ...overrides,
    });
    return { result, stub };
}

// === Fingerprint-Berechnung ===

test('dieselbe Datei ergibt denselben Fingerprint', () => {
    assert.equal(computeProxyFingerprint(QUELLTEXT), computeProxyFingerprint(QUELLTEXT));
    assert.match(computeProxyFingerprint(QUELLTEXT), /^[0-9a-f]{64}$/);
});

test('CRLF und LF ergeben denselben Fingerprint', () => {
    const mitLf = "<?php\n$a = 1;\n$b = 2;\n";
    const mitCrlf = "<?php\r\n$a = 1;\r\n$b = 2;\r\n";
    const mitCr = "<?php\r$a = 1;\r$b = 2;\r";

    assert.equal(computeProxyFingerprint(mitCrlf), computeProxyFingerprint(mitLf));
    assert.equal(computeProxyFingerprint(mitCr), computeProxyFingerprint(mitLf));
    assert.equal(canonicalizeProxySource(mitCrlf), mitLf);
});

test('eine echte Inhaltsänderung ergibt einen anderen Fingerprint', () => {
    const geaendert = QUELLTEXT.replace("echo 'hallo';", "echo 'hallo welt';");

    assert.notEqual(computeProxyFingerprint(geaendert), computeProxyFingerprint(QUELLTEXT));
});

test('auch eine geänderte Allowlist verändert den Fingerprint', async () => {
    const echt = await readFile(PROXY_SOURCE_PATH, 'utf8');
    const manipuliert = echt.replace(
        'https://www.gamepro.de/rss/gamepro.rss',
        'https://www.example.com/rss/fremd.rss',
    );

    assert.notEqual(manipuliert, echt, 'die Ersetzung muss greifen');
    assert.notEqual(computeProxyFingerprint(manipuliert), computeProxyFingerprint(echt));
});

test('leere und unbrauchbare Eingaben stürzen nicht ab', () => {
    for (const eingabe of ['', null, undefined]) {
        assert.match(computeProxyFingerprint(eingabe), /^[0-9a-f]{64}$/, String(eingabe));
    }
});

// === Adresse des Fingerprint-Modus ===

test('die Anfrageadresse setzt den Modus und behält vorhandene Parameter', () => {
    const gebaut = new URL(buildFingerprintRequestUrl(PROXY_URL));

    assert.equal(gebaut.searchParams.get('mode'), 'fingerprint');
    assert.equal(gebaut.searchParams.get('key'), 'proxy-geheim', 'konfigurierte Parameter bleiben');
    assert.equal(gebaut.pathname, '/gamerfeed/feed-proxy.php');
});

test('ein mitgeschleppter url-Parameter wird entfernt', () => {
    const gebaut = new URL(buildFingerprintRequestUrl(
        'https://proxy.example/feed-proxy.php?url=https%3A%2F%2Fwww.gamepro.de%2Frss%2Fgamepro.rss',
    ));

    assert.equal(gebaut.searchParams.get('url'), null, 'der Fingerprint-Modus holt keinen Feed');
    assert.equal(gebaut.searchParams.get('mode'), 'fingerprint');
});

// === Schema der Antwort ===

test('nur eine vollständige Antwort dieses Dienstes wird angenommen', () => {
    const gueltig = {
        schemaVersion: PROXY_FINGERPRINT_SCHEMA_VERSION,
        service: PROXY_FINGERPRINT_SERVICE,
        algorithm: PROXY_FINGERPRINT_ALGORITHM,
        fingerprint: 'a'.repeat(64),
    };
    assert.deepEqual(normalizeFingerprintPayload(gueltig), gueltig);

    const unbrauchbar = [
        null,
        'kein Objekt',
        [gueltig],
        { ...gueltig, schemaVersion: 2 },
        { ...gueltig, schemaVersion: undefined },
        { ...gueltig, service: 'fremder-dienst' },
        { ...gueltig, algorithm: 'md5' },
        { ...gueltig, fingerprint: 'zz' },
        { ...gueltig, fingerprint: 'A'.repeat(64) },
        { ...gueltig, fingerprint: 'a'.repeat(63) },
    ];

    for (const raw of unbrauchbar) {
        assert.equal(normalizeFingerprintPayload(raw), null, JSON.stringify(raw));
    }
});

// === Erfolgreicher Vergleich ===

test('eine korrekte Remote-Antwort besteht die Prüfung', async () => {
    const erwartet = computeProxyFingerprint(QUELLTEXT);
    const { result, stub } = await pruefe(async () => gueltigeAntwort(erwartet));

    assert.equal(result.ok, true);
    assert.equal(result.outcome, 'ok');
    assert.equal(result.actual, erwartet);

    assert.equal(stub.calls.length, 1, 'genau eine Anfrage');
    const angefragt = new URL(stub.calls[0].url);
    assert.equal(angefragt.searchParams.get('mode'), 'fingerprint');
    assert.equal((stub.calls[0].init?.method ?? 'GET').toUpperCase(), 'GET');
});

test('die Fingerprint-Anfrage erreicht weder Feed-Anbieter noch Cache oder Datenbank', async () => {
    const { stub } = await pruefe(async () => gueltigeAntwort(computeProxyFingerprint(QUELLTEXT)));

    for (const call of stub.calls) {
        const ziel = new URL(call.url);
        assert.equal(ziel.host, 'proxy.example', 'nur der konfigurierte Endpunkt');
        assert.equal(ziel.searchParams.get('url'), null, 'kein Feed-Auftrag');
        assert.doesNotMatch(call.url, /gamepro|gamestar/i, 'kein Feed-Anbieter');
    }
});

// === Kontrollierte Fehlerfälle ===

test('eine Abweichung wird als solche gemeldet', async () => {
    const { result } = await pruefe(async () => gueltigeAntwort('b'.repeat(64)));

    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'mismatch');
    assert.equal(result.expected, computeProxyFingerprint(QUELLTEXT));
    assert.equal(result.actual, 'b'.repeat(64));
    assert.match(result.message, /erneut hochgeladen/);
});

test('ein Timeout schlägt kontrolliert fehl, ohne zu werfen', async () => {
    const { result } = await pruefe(async () => {
        const fehler = new Error('The operation was aborted due to timeout');
        fehler.name = 'TimeoutError';
        throw fehler;
    });

    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'request_failed');
    assert.match(result.message, /nicht erreichbar/);
});

test('eine zu große Antwort wird verworfen', async () => {
    const { result } = await pruefe(
        async () => new Response('x'.repeat(500), { status: 200 }),
        { maxBytes: 64 },
    );

    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'response_too_large');
    assert.match(result.message, /64 Byte/);
});

test('ungültiges JSON schlägt kontrolliert fehl', async () => {
    const { result } = await pruefe(async () => new Response('<html>Fehlerseite</html>', { status: 200 }));

    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'invalid_json');
});

test('ein fremdes oder späteres Schema wird abgelehnt', async () => {
    for (const payload of [
        { schemaVersion: 2, service: PROXY_FINGERPRINT_SERVICE, algorithm: 'sha256', fingerprint: 'a'.repeat(64) },
        { schemaVersion: 1, service: 'anderer-dienst', algorithm: 'sha256', fingerprint: 'a'.repeat(64) },
        { hallo: 'welt' },
    ]) {
        const { result } = await pruefe(async () => jsonAntwort(payload));
        assert.equal(result.outcome, 'invalid_schema', JSON.stringify(payload));
    }
});

test('ein HTTP-Fehler schlägt kontrolliert fehl und übernimmt keinen Fremdtext', async () => {
    const { result } = await pruefe(
        async () => new Response('<html>Not Found bei proxy.example</html>', { status: 404 }),
    );

    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'http_error');
    assert.match(result.message, /HTTP 404/);
    assert.doesNotMatch(result.message, /proxy\.example/);
});

test('eine fehlende Konfiguration wird von einem Ausfall unterschieden', async () => {
    for (const feedProxyUrl of ['', '   ', null, undefined]) {
        const result = await checkProxyFingerprint({
            feedProxyUrl,
            expectedFingerprint: computeProxyFingerprint(QUELLTEXT),
            fetchImpl: async () => {
                throw new Error('es darf gar nicht erst abgerufen werden');
            },
        });

        assert.equal(result.outcome, 'missing_configuration', String(feedProxyUrl));
    }
});

test('eine unbrauchbare Adresse wird gemeldet, ohne sie zu nennen', async () => {
    const result = await checkProxyFingerprint({
        feedProxyUrl: 'kein-schema-proxy-geheim',
        expectedFingerprint: computeProxyFingerprint(QUELLTEXT),
        fetchImpl: async () => {
            throw new Error('es darf gar nicht erst abgerufen werden');
        },
    });

    assert.equal(result.outcome, 'missing_configuration');
    assert.doesNotMatch(result.message, /kein-schema-proxy-geheim/);
});

test('ein nicht berechenbarer Fingerprint wird als unlesbare Quelle gemeldet', async () => {
    const result = await checkProxyFingerprint({
        feedProxyUrl: PROXY_URL,
        expectedFingerprint: 'unbrauchbar',
        fetchImpl: async () => {
            throw new Error('es darf gar nicht erst abgerufen werden');
        },
    });

    assert.equal(result.outcome, 'unreadable_source');
});

// === Keine Secrets in Meldungen ===

test('keine Meldung enthält die Proxy-Adresse oder ihren Querystring', async () => {
    const faelle = [
        async () => {
            throw new Error(`connect ECONNREFUSED ${PROXY_URL}`);
        },
        async () => new Response(PROXY_URL, { status: 500 }),
        async () => new Response(`<html>${PROXY_URL}</html>`, { status: 200 }),
        async () => jsonAntwort({ schemaVersion: 9, hinweis: PROXY_URL }),
        async () => gueltigeAntwort('c'.repeat(64)),
    ];

    for (const handler of faelle) {
        const { result } = await pruefe(handler);
        const gesamt = JSON.stringify(result);

        assert.doesNotMatch(gesamt, /proxy-geheim/, 'kein Querystring-Token');
        assert.doesNotMatch(gesamt, /proxy\.example/, 'kein Host');
        assert.doesNotMatch(gesamt, /gamerfeed\/feed-proxy\.php/, 'kein Pfad');
    }
});

test('die Bereinigung entfernt Adresse, Host und Querystring', () => {
    const bereinigt = redactProxyMessage(
        `Fehler bei ${PROXY_URL} über proxy.example, siehe https://proxy.example/pfad?token=abc`,
        PROXY_URL,
    );

    assert.doesNotMatch(bereinigt, /proxy-geheim/);
    assert.doesNotMatch(bereinigt, /proxy\.example/);
    assert.doesNotMatch(bereinigt, /token=abc/);
});

test('ohne konfigurierte Adresse bleibt die Bereinigung trotzdem wirksam', () => {
    const bereinigt = redactProxyMessage('Fehler bei https://irgendwo.example/pfad?token=geheim', null);

    assert.doesNotMatch(bereinigt, /token=geheim/);
    assert.match(bereinigt, /\[redacted\]/);
});

// === Konstanten und Grenzen ===

test('Frist und Byte-Limit sind klein und festgelegt', () => {
    assert.equal(PROXY_FINGERPRINT_TIMEOUT_MS, 10_000);
    assert.equal(PROXY_FINGERPRINT_MAX_BYTES, 4096);
    assert.equal(PROXY_FINGERPRINT_SCHEMA_VERSION, 1);
    assert.equal(PROXY_FINGERPRINT_SERVICE, 'gamerfeed-feed-proxy');
    assert.equal(PROXY_FINGERPRINT_ALGORITHM, 'sha256');
});

// === Der Checker als Ganzes ===

function createLogger() {
    const zeilen = [];
    return {
        zeilen,
        logger: {
            log: (...args) => zeilen.push(args.map(String).join(' ')),
            error: (...args) => zeilen.push(args.map(String).join(' ')),
        },
    };
}

test('der Checker endet bei Übereinstimmung mit Exit-Code 0', async () => {
    const { logger, zeilen } = createLogger();
    const codes = [];

    await checkerMain({
        env: { FEED_PROXY_URL: PROXY_URL },
        readSource: async () => QUELLTEXT,
        check: async () => ({ ok: true, outcome: 'ok', message: 'passt', expected: null, actual: null }),
        logger,
        exit: code => codes.push(code),
    });

    assert.deepEqual(codes, [0]);
    assert.ok(zeilen.some(zeile => zeile.includes(computeProxyFingerprint(QUELLTEXT))));
});

test('der Checker endet bei einer Abweichung mit Exit-Code 1 und nennt beide Werte', async () => {
    const { logger, zeilen } = createLogger();
    const codes = [];

    await checkerMain({
        env: { FEED_PROXY_URL: PROXY_URL },
        readSource: async () => QUELLTEXT,
        check: async () => ({
            ok: false,
            outcome: 'mismatch',
            message: 'weicht ab',
            expected: 'a'.repeat(64),
            actual: 'b'.repeat(64),
        }),
        logger,
        exit: code => codes.push(code),
    });

    assert.deepEqual(codes, [1]);
    const ausgabe = zeilen.join('\n');
    assert.match(ausgabe, /a{64}/);
    assert.match(ausgabe, /b{64}/);
    assert.match(ausgabe, /feed-proxy\.md/);
});

test('der Checker meldet eine unlesbare Quelldatei und ruft gar nichts ab', async () => {
    const { logger, zeilen } = createLogger();
    const codes = [];
    let abgerufen = false;

    await checkerMain({
        env: { FEED_PROXY_URL: PROXY_URL },
        readSource: async () => {
            throw new Error(`EACCES beim Lesen, konfiguriert war ${PROXY_URL}`);
        },
        check: async () => {
            abgerufen = true;
            return { ok: true, outcome: 'ok', message: 'passt' };
        },
        logger,
        exit: code => codes.push(code),
    });

    assert.deepEqual(codes, [1]);
    assert.equal(abgerufen, false, 'ohne erwarteten Fingerprint wird nichts abgerufen');
    assert.doesNotMatch(zeilen.join('\n'), /proxy-geheim|proxy\.example/);
});

test('die Ausgabe des Checkers enthält in keinem Ausgang ein Secret', async () => {
    for (const outcome of ['missing_configuration', 'request_failed', 'http_error', 'invalid_schema']) {
        const { logger, zeilen } = createLogger();

        await checkerMain({
            env: { FEED_PROXY_URL: PROXY_URL },
            readSource: async () => QUELLTEXT,
            check: async () => ({
                ok: false,
                outcome,
                // Ein Ergebnis, das die Adresse doch durchreicht: der Checker
                // bereinigt selbst noch einmal.
                message: `Fehler bei ${PROXY_URL}`,
                expected: null,
                actual: null,
            }),
            logger,
            exit: () => {},
        });

        const ausgabe = zeilen.join('\n');
        assert.doesNotMatch(ausgabe, /proxy-geheim/, outcome);
        assert.doesNotMatch(ausgabe, /proxy\.example/, outcome);
    }
});

test('der Checker gibt bei fehlender Konfiguration keinen leeren Platzhalter aus', async () => {
    const { logger, zeilen } = createLogger();
    const codes = [];

    await checkerMain({
        env: {},
        readSource: async () => QUELLTEXT,
        logger,
        exit: code => codes.push(code),
        fetchImpl: async () => {
            throw new Error('es darf gar nicht erst abgerufen werden');
        },
    });

    assert.deepEqual(codes, [1]);
    assert.match(zeilen.join('\n'), /missing_configuration/);
});
