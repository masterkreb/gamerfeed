// Verhalten von tools/feed-proxy.php selbst (Roadmap-Paket O4d).
//
// Die Datei wird als PHP-CLI-Prozess ausgeführt, damit die Zusagen am echten
// Skript hängen und nicht an einer Nachbildung. Kein Test ruft dabei einen
// Feed-Anbieter, den Produktionscache oder eine Datenbank auf:
//
// - Der Fingerprint-Zweig liest ausschließlich die eigene Datei.
// - Die übrigen Fälle enden in der Allowlist beziehungsweise der
//   Methodenprüfung, also noch vor jedem cURL-Aufruf.
//
// Ein erfolgreicher Upstream-Abruf wird hier bewusst **nicht** geprüft; er
// bräuchte einen echten Feed-Anbieter. Diese Seite deckt
// tests/feeds/unit/feed-fetch-utils.js mit gestelltem Transport ab.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    PROXY_FINGERPRINT_ALGORITHM,
    PROXY_FINGERPRINT_SCHEMA_VERSION,
    PROXY_FINGERPRINT_SERVICE,
    computeProxyFingerprint,
} from '../../../scripts/proxy-fingerprint.js';

const execFileAsync = promisify(execFile);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PROXY_SOURCE_PATH = resolve(REPO_ROOT, 'tools/feed-proxy.php');

/** Ohne PHP im Pfad werden diese Fälle übersprungen statt fälschlich grün. */
const phpAvailable = await (async () => {
    try {
        await execFileAsync('php', ['--version']);
        return true;
    } catch {
        return false;
    }
})();

/**
 * Ruft das Proxy-Skript mit gestellten Superglobals auf.
 *
 * `$_GET` und die Anfragemethode werden im Prelude gesetzt; danach wird die
 * echte Datei eingebunden. `header()` ist in der CLI wirkungslos, der Rumpf und
 * `http_response_code()` sind es nicht.
 *
 * @param {{ get?: Record<string, string>, method?: string, phpArgs?: string[] }} [options]
 */
async function runProxy({ get = {}, method = 'GET', phpArgs = [] } = {}) {
    const prelude = [
        // Der Statuscode geht über einen Shutdown-Handler nach stderr: das
        // Skript beendet sich mit `exit`, danach liefe kein nachgestellter Code
        // mehr. stdout bleibt dadurch genau der Antwortrumpf.
        `register_shutdown_function(static function (): void { fwrite(STDERR, "STATUS=" . http_response_code()); });`,
        `$_SERVER['REQUEST_METHOD'] = ${JSON.stringify(method)};`,
        `$_GET = json_decode(${JSON.stringify(JSON.stringify(get))}, true);`,
        `include ${JSON.stringify(PROXY_SOURCE_PATH)};`,
    ].join(' ');

    const { stdout, stderr } = await execFileAsync(
        'php',
        [...phpArgs, '-r', prelude],
        { cwd: REPO_ROOT, timeout: 20_000 },
    );

    const status = Number(/STATUS=(\d+)/.exec(stderr)?.[1] ?? 0);
    return { body: stdout, status, stderr };
}

test('der Fingerprint-Modus meldet denselben Hash, den Node erwartet', { skip: !phpAvailable }, async () => {
    const { body, status } = await runProxy({ get: { mode: 'fingerprint' } });

    assert.equal(status, 200);

    const payload = JSON.parse(body);
    assert.equal(payload.schemaVersion, PROXY_FINGERPRINT_SCHEMA_VERSION);
    assert.equal(payload.service, PROXY_FINGERPRINT_SERVICE);
    assert.equal(payload.algorithm, PROXY_FINGERPRINT_ALGORITHM);

    const erwartet = computeProxyFingerprint(await readFile(PROXY_SOURCE_PATH, 'utf8'));
    assert.equal(payload.fingerprint, erwartet, 'PHP und Node kanonisieren identisch');
});

test('der Fingerprint-Modus kommt ohne cURL aus', { skip: !phpAvailable }, async () => {
    // Der eigentliche Beweis, dass dieser Zweig den Upstream nie abruft: mit
    // abgeschaltetem cURL liefert er trotzdem seine Antwort. Läge er hinter der
    // cURL-Prüfung, käme hier HTTP 500.
    const { body, status } = await runProxy({
        get: { mode: 'fingerprint' },
        phpArgs: ['-d', 'disable_functions=curl_init'],
    });

    assert.equal(status, 200);
    assert.match(JSON.parse(body).fingerprint, /^[0-9a-f]{64}$/);
});

test('der Fingerprint-Modus ignoriert einen mitgegebenen url-Parameter', { skip: !phpAvailable }, async () => {
    // Selbst mit einer erlaubten Feed-Adresse darf kein Abruf entstehen: der
    // Modus gewinnt, die Allowlist wird gar nicht erst erreicht.
    const { body, status } = await runProxy({
        get: { mode: 'fingerprint', url: 'https://www.gamepro.de/rss/gamepro.rss' },
        phpArgs: ['-d', 'disable_functions=curl_init'],
    });

    assert.equal(status, 200);
    assert.equal(JSON.parse(body).service, PROXY_FINGERPRINT_SERVICE);
});

test('ein unbekannter Modus fällt in den gewöhnlichen Abrufpfad zurück', { skip: !phpAvailable }, async () => {
    const { body, status } = await runProxy({ get: { mode: 'irgendwas', url: 'https://example.com/feed.xml' } });

    assert.equal(status, 422, 'die Allowlist entscheidet wie bisher');
    assert.match(body, /Not allowed/);
});

test('die Allowlist bleibt unverändert streng', { skip: !phpAvailable }, async () => {
    for (const url of [
        'https://example.com/feed.xml',
        'https://www.gamepro.de/rss/gamepro.rss?extra=1',
        'https://www.gamepro.de/rss/gamepro.rss/../andere',
        // Die weiterleitende Play3-Adresse: erlaubt ist nur ihr Ziel.
        'https://www.play3.de/feed/rss/',
        // Auch für die übrigen Einträge zählt der exakte Vergleich, nicht eine
        // ähnliche Schreibweise von Query, Slash oder Host.
        'https://www.gamestar.de/rss/gamestar.rss?extra=1',
        'https://www.play3.de/feed',
        'https://www.playfront.de/feed/',
        '',
    ]) {
        const { status } = await runProxy({ get: { url } });
        assert.equal(status, 422, url || '(leer)');
    }
});

test('nicht-GET wird weiterhin abgelehnt, auch im Fingerprint-Modus', { skip: !phpAvailable }, async () => {
    const { body, status } = await runProxy({ get: { mode: 'fingerprint' }, method: 'POST' });

    assert.equal(status, 405);
    assert.match(body, /Method not allowed/);
});

test('der Fingerprint-Zweig steht vor jedem cURL-Aufruf', { skip: !phpAvailable }, async () => {
    // Strukturelle Absicherung gegen ein späteres Verschieben: sonst könnte der
    // Modus unbemerkt hinter die Abruflogik rutschen.
    const source = await readFile(PROXY_SOURCE_PATH, 'utf8');

    const fingerprintIndex = source.indexOf("=== 'fingerprint'");
    const curlIndex = source.indexOf('curl_init');

    assert.ok(fingerprintIndex > 0, 'der Fingerprint-Zweig existiert');
    assert.ok(curlIndex > 0, 'die Abruflogik existiert');
    assert.ok(fingerprintIndex < curlIndex, 'der Fingerprint-Zweig kommt zuerst');
});

/**
 * Liest die Einträge von `$allowed` aus dem Quelltext.
 *
 * Rein statisch: Die beiden folgenden Tests führen kein PHP aus und tragen
 * deshalb bewusst kein `skip` - die Allowlist ist der sicherheitsrelevante Kern
 * dieses Skripts und soll auch ohne PHP-CLI geprüft sein.
 */
async function leseAllowlist() {
    const source = await readFile(PROXY_SOURCE_PATH, 'utf8');
    const allowlist = /\$allowed = \[(.*?)\];/s.exec(source)?.[1] ?? '';
    return [...allowlist.matchAll(/'([^']+)'/g)].map(match => match[1]);
}

test('die Allowlist enthält genau die vier freigegebenen Adressen', async () => {
    // Jede Adresse muss exakt der Adresse in der Feed-Verwaltung entsprechen; die
    // Quellennamen dazu stehen in PROXY_ELIGIBLE_SOURCES (feed-fetch-utils.test.js).
    assert.deepEqual(await leseAllowlist(), [
        'https://www.gamepro.de/rss/gamepro.rss',
        'https://www.gamestar.de/rss/gamestar.rss',
        'https://www.play3.de/feed/',
        'https://playfront.de/feed/',
    ]);
});

test('die weiterleitende Play3-Adresse steht nicht in der Allowlist, ihr Ziel schon', async () => {
    // https://www.play3.de/feed/rss/ antwortet mit 301 auf https://www.play3.de/feed/.
    // Der Proxy folgt keinen Redirects (CURLOPT_FOLLOWLOCATION => false) und
    // würde nur das 301 durchreichen. Erlaubt ist deshalb ausschließlich das
    // Weiterleitungsziel, und nur dieses gehört auch in die Feed-Verwaltung.
    const eintraege = await leseAllowlist();

    assert.ok(eintraege.includes('https://www.play3.de/feed/'), 'das Weiterleitungsziel ist erlaubt');
    assert.equal(
        eintraege.includes('https://www.play3.de/feed/rss/'),
        false,
        'die alte Adresse würde vom Proxy nur als 301 zurückkommen',
    );
});

test('das Skript ist syntaktisch fehlerfrei', { skip: !phpAvailable }, async () => {
    const { stdout } = await execFileAsync('php', ['-l', PROXY_SOURCE_PATH], { cwd: REPO_ROOT });
    assert.match(stdout, /No syntax errors detected/);
});
