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
// Ein erfolgreicher Upstream-Abruf wird hier bewusst **nicht** gegen einen
// echten Anbieter geprüft. Die Antwortlogik des Skripts - Content-Type,
// Statusweitergabe, Accept-Header - läuft trotzdem am echten Skript:
// runProxyMitAttrappen() ersetzt ausschließlich cURL und header() durch
// Attrappen. Den Abruf selbst deckt tests/feeds/unit/feed-fetch-utils.js mit
// gestelltem Transport ab.

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
import { PLAY3_ARTICLE_URL_PATTERN } from '../../../scripts/feed-fetch-utils.js';

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
 * @param {{ get?: Record<string, string | string[]>, method?: string, phpArgs?: string[] }} [options]
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

/**
 * Führt das Skript bis zur fertigen Antwort aus - mit Attrappen statt cURL und
 * header().
 *
 * Ein echter Abruf kommt nicht in Frage, und die CLI behält keine
 * Antwort-Header: `headers_list()` bleibt dort leer. Beide Funktionsgruppen
 * werden deshalb abgeschaltet und im Prelude durch eigene Fassungen ersetzt. Sie
 * halten fest, was das Skript senden *würde*, und liefern die vorgegebene
 * Antwort der Gegenstelle. Alles Übrige - Moduswahl, Allowlist, Header,
 * Statusweitergabe - läuft unverändert am echten Skript.
 *
 * Alle Werte reisen als Base64, damit weder Anführungszeichen noch `$` im
 * Antworttext die Kommandozeile oder PHP-Zeichenketten stören.
 *
 * @param {{
 *   get: Record<string, string | string[]>,
 *   upstreamBody?: string,
 *   upstreamStatus?: number,
 * }} options
 */
async function runProxyMitAttrappen({ get, upstreamBody = '', upstreamStatus = 200 }) {
    const base64 = wert => Buffer.from(JSON.stringify(wert)).toString('base64');
    // Ohne die cURL-Erweiterung gibt es diese Konstanten nicht. Ihre Werte sind
    // hier beliebig, weil nur die Attrappen sie lesen.
    const konstanten = [
        'CURLOPT_FOLLOWLOCATION', 'CURLOPT_PROTOCOLS', 'CURLPROTO_HTTPS', 'CURLOPT_CONNECTTIMEOUT',
        'CURLOPT_TIMEOUT', 'CURLOPT_ENCODING', 'CURLOPT_WRITEFUNCTION', 'CURLOPT_HTTPHEADER',
        'CURLINFO_HTTP_CODE',
    ].map(name => `'${name}'`).join(', ');

    const prelude = [
        `$GLOBALS['attrappe'] = json_decode(base64_decode('${base64({ body: upstreamBody, status: upstreamStatus })}'), true);`,
        `$GLOBALS['gesendet'] = [];`,
        `$GLOBALS['curl'] = [];`,
        `foreach ([${konstanten}] as $__index => $__name) { if (!defined($__name)) { define($__name, 90000 + $__index); } }`,
        `function header($zeile, $ersetzen = true, $code = 0) { $GLOBALS['gesendet'][strtolower(trim(explode(':', $zeile, 2)[0]))] = $zeile; }`,
        `function curl_init($url = null) { $GLOBALS['curl']['url'] = $url; return new stdClass(); }`,
        `function curl_setopt_array($ch, $optionen) { $GLOBALS['curl']['optionen'] = $optionen; return true; }`,
        `function curl_exec($ch) { $schreiben = $GLOBALS['curl']['optionen'][CURLOPT_WRITEFUNCTION]; $schreiben($ch, $GLOBALS['attrappe']['body']); return true; }`,
        `function curl_getinfo($ch, $option = 0) { return $GLOBALS['attrappe']['status']; }`,
        `function curl_error($ch) { return ''; }`,
        `function curl_close($ch) { }`,
        // Der Bericht geht über einen Shutdown-Handler nach stderr: das Skript
        // beendet sich mit `exit`, danach liefe kein nachgestellter Code mehr.
        // stdout bleibt dadurch genau der Antwortrumpf.
        `register_shutdown_function(static function (): void {`
            + ` $optionen = $GLOBALS['curl']['optionen'] ?? [];`
            + ` $bericht = ['status' => http_response_code(), 'header' => $GLOBALS['gesendet'],`
            + ` 'curlUrl' => $GLOBALS['curl']['url'] ?? null, 'httpHeader' => $optionen[CURLOPT_HTTPHEADER] ?? null,`
            + ` 'redirects' => $optionen[CURLOPT_FOLLOWLOCATION] ?? null,`
            + ` 'nurHttps' => ($optionen[CURLOPT_PROTOCOLS] ?? null) === CURLPROTO_HTTPS];`
            + ` fwrite(STDERR, 'BERICHT=' . base64_encode(json_encode($bericht)) . "\\n"); });`,
        `$_SERVER['REQUEST_METHOD'] = 'GET';`,
        `$_GET = json_decode(base64_decode('${base64(get)}'), true);`,
        `include ${JSON.stringify(PROXY_SOURCE_PATH)};`,
    ].join(' ');

    const abgeschaltet = [
        'curl_init', 'curl_setopt_array', 'curl_exec', 'curl_getinfo', 'curl_error', 'curl_close', 'header',
    ].join(',');

    const { stdout, stderr } = await execFileAsync(
        'php',
        ['-d', `disable_functions=${abgeschaltet}`, '-r', prelude],
        { cwd: REPO_ROOT, timeout: 20_000 },
    );

    const bericht = JSON.parse(Buffer.from(/BERICHT=(\S+)/.exec(stderr)?.[1] ?? '', 'base64').toString('utf8'));
    return { body: stdout, bericht, stderr };
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

test('der Bildmodus akzeptiert nur kanonische Play3-Artikelseiten', { skip: !phpAvailable }, async () => {
    const articleUrl = 'https://www.play3.de/2026/10/03/test-artikel/';
    const accepted = await runProxy({
        get: { mode: 'article-image', url: articleUrl },
        // HTTP 500 statt 422 belegt ohne Netzwerkzugriff, dass die Adresse die
        // Modus-Allowlist passiert und erst an der cURL-Pruefung endet.
        phpArgs: ['-d', 'disable_functions=curl_init'],
    });

    assert.equal(accepted.status, 500);
    assert.match(accepted.body, /not configured correctly/);

    for (const url of [
        'http://www.play3.de/2026/10/03/test-artikel/',
        'https://play3.de/2026/10/03/test-artikel/',
        'https://www.play3.de.evil.example/2026/10/03/test-artikel/',
        'https://www.play3.de:443/2026/10/03/test-artikel/',
        // Ein leerer Port ist kein Port im Sinn von parse_url(); die Adresse
        // muss trotzdem als Ganzes dem kanonischen Muster entsprechen.
        'https://www.play3.de:/2026/10/03/test-artikel/',
        'https://nutzer:pass@www.play3.de/2026/10/03/test-artikel/',
        'https://www.play3.de/2026/10/03/test-artikel/?ref=rss',
        'https://www.play3.de/2026/10/03/test-artikel/#inhalt',
        'https://www.play3.de/feed/',
        'https://www.play3.de/2026/10/03/test-artikel',
        'https://www.play3.de/2026/10/03/../feed/',
        'https://www.play3.de/2026/10/03/test-artikel/\n',
        '',
    ]) {
        const refused = await runProxy({ get: { mode: 'article-image', url } });
        assert.equal(refused.status, 422, JSON.stringify(url) || '(leer)');
        assert.match(refused.body, /Not allowed/);
    }
});

test('der Bildmodus weist ein Array als Adresse ab, statt mit einem Fehler zu enden', { skip: !phpAvailable }, async () => {
    // ?url[]=... ergibt in PHP ein Array. Mit strict_types=1 wäre das bei einer
    // string-Signatur ein TypeError samt Fehlertext in der Antwort gewesen.
    const refused = await runProxy({
        get: { mode: 'article-image', url: ['https://www.play3.de/2026/10/03/test-artikel/'] },
    });

    assert.equal(refused.status, 422);
    assert.match(refused.body, /Not allowed/);
    assert.doesNotMatch(refused.body, /Fatal error|TypeError|feed-proxy\.php/);
});

// === Antwortlogik mit gestelltem cURL ===

const PLAY3_ARTIKEL = 'https://www.play3.de/2026/10/03/test-artikel/';
const FEED_ACCEPT = 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const BILD_ACCEPT = 'Accept: text/html,application/xhtml+xml';
// Eine Seite mit eingebettetem Skript: genau das darf ein Browser unter der
// Domain des Proxys nie als Webseite ausführen.
const FREMDE_SEITE = '<!doctype html><html><head><meta property="og:image" content="https://bilder.play3.de/a.jpg"><script>window.name = 1;</script></head><body>Artikel</body></html>';

test('der Bildmodus liefert fremdes HTML ausschließlich als text/plain mit nosniff', { skip: !phpAvailable }, async () => {
    const { body, bericht } = await runProxyMitAttrappen({
        get: { mode: 'article-image', url: PLAY3_ARTIKEL },
        upstreamBody: FREMDE_SEITE,
    });

    assert.equal(bericht.status, 200);
    assert.equal(bericht.header['content-type'], 'Content-Type: text/plain; charset=utf-8');
    assert.equal(bericht.header['x-content-type-options'], 'X-Content-Type-Options: nosniff');
    assert.equal(bericht.header['cache-control'], 'Cache-Control: no-store');
    assert.equal(body, FREMDE_SEITE, 'der Rumpf kommt unverändert an');
    assert.equal(bericht.curlUrl, PLAY3_ARTIKEL, 'abgerufen wird genau die angefragte Artikelseite');
});

test('der Bildmodus reicht den Status der Quelle durch - ebenfalls als text/plain', { skip: !phpAvailable }, async () => {
    for (const upstreamStatus of [403, 404, 429, 503]) {
        const { bericht } = await runProxyMitAttrappen({
            get: { mode: 'article-image', url: PLAY3_ARTIKEL },
            upstreamBody: FREMDE_SEITE,
            upstreamStatus,
        });

        assert.equal(bericht.status, upstreamStatus);
        assert.equal(bericht.header['content-type'], 'Content-Type: text/plain; charset=utf-8', `HTTP ${upstreamStatus}`);
        assert.equal(bericht.header['x-content-type-options'], 'X-Content-Type-Options: nosniff');
    }
});

test('der Bildmodus fragt nur nach HTML und ruft ausschließlich per HTTPS ohne Redirects ab', { skip: !phpAvailable }, async () => {
    const { bericht } = await runProxyMitAttrappen({
        get: { mode: 'article-image', url: PLAY3_ARTIKEL },
        upstreamBody: FREMDE_SEITE,
    });

    assert.ok(bericht.httpHeader.includes(BILD_ACCEPT), 'eigener Accept-Header des Bildmodus');
    assert.equal(bericht.httpHeader.includes(FEED_ACCEPT), false);
    assert.equal(bericht.redirects, false, 'keine Redirects');
    assert.equal(bericht.nurHttps, true, 'nur HTTPS');
});

test('der Feed-Modus bleibt unverändert: application/rss+xml und der bisherige Accept-Header', { skip: !phpAvailable }, async () => {
    const feed = '<?xml version="1.0"?><rss version="2.0"><channel><title>Play3</title></channel></rss>';

    for (const upstreamStatus of [200, 403]) {
        const { body, bericht } = await runProxyMitAttrappen({
            get: { url: 'https://www.play3.de/feed/' },
            upstreamBody: feed,
            upstreamStatus,
        });

        assert.equal(bericht.status, upstreamStatus);
        assert.equal(bericht.header['content-type'], 'Content-Type: application/rss+xml; charset=utf-8');
        assert.equal(bericht.header['x-content-type-options'], 'X-Content-Type-Options: nosniff');
        assert.equal(body, feed);
        assert.equal(bericht.curlUrl, 'https://www.play3.de/feed/');
        assert.ok(bericht.httpHeader.includes(FEED_ACCEPT), 'exakt der bisherige Accept-Header');
        assert.equal(bericht.httpHeader.includes(BILD_ACCEPT), false);
        assert.equal(bericht.redirects, false);
        assert.equal(bericht.nurHttps, true);
    }
});

test('ein unbekannter Modus liefert wie bisher application/rss+xml', { skip: !phpAvailable }, async () => {
    const { bericht } = await runProxyMitAttrappen({
        get: { mode: 'irgendwas', url: 'https://www.gamepro.de/rss/gamepro.rss' },
        upstreamBody: '<rss version="2.0"></rss>',
    });

    assert.equal(bericht.header['content-type'], 'Content-Type: application/rss+xml; charset=utf-8');
    assert.ok(bericht.httpHeader.includes(FEED_ACCEPT));
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

test('das Play3-Muster des Bildmodus ist in PHP und Node dasselbe', async () => {
    // Die Node-Seite schickt nur Adressen an den Proxy, die er annimmt. Das
    // klappt nur, solange beide Fassungen übereinstimmen - sonst löste eine
    // abweichende Adresse ein 422 aus, und das hieße fälschlich, die PHP-Datei
    // kenne den Bildmodus nicht.
    const source = await readFile(PROXY_SOURCE_PATH, 'utf8');
    const phpMuster = /preg_match\('~(.+?)~D', \$candidate\)/.exec(source)?.[1];

    assert.ok(phpMuster, 'das Muster steht im Quelltext von isAllowedPlay3ArticleUrl()');
    assert.equal(phpMuster, PLAY3_ARTICLE_URL_PATTERN);
});

test('keine Antwort liefert fremden Inhalt als text/html aus', async () => {
    // Statisch, damit die Zusage auch ohne PHP-CLI geprüft ist: Der Accept-Header
    // der Anfrage nennt text/html (er beschreibt, was erwartet wird); ein
    // Content-Type der Antwort darf es nie nennen.
    const source = await readFile(PROXY_SOURCE_PATH, 'utf8');

    assert.doesNotMatch(source, /Content-Type:[^'"\r\n]*text\/html/i);
    assert.match(source, /header\('Content-Type: text\/plain; charset=utf-8'\);\s*\} else \{\s*header\('Content-Type: application\/rss\+xml; charset=utf-8'\);/);

    const nosniff = source.indexOf("header('X-Content-Type-Options: nosniff');");
    assert.ok(nosniff > 0, 'nosniff wird gesetzt');
    assert.ok(nosniff < source.indexOf('exit;'), 'nosniff gilt vor der ersten möglichen Antwort');
});

test('das Skript ist syntaktisch fehlerfrei', { skip: !phpAvailable }, async () => {
    const { stdout } = await execFileAsync('php', ['-l', PROXY_SOURCE_PATH], { cwd: REPO_ROOT });
    assert.match(stdout, /No syntax errors detected/);
});
