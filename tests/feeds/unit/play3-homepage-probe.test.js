import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PLAY3_HOMEPAGE_URL,
    PLAY3_FEED_URL,
    PROBE_MAX_BYTES,
    PROBE_TIMEOUT_MS,
    inspectHomepage,
    probePlay3Homepage,
    formatProbeReport,
    main,
} from '../../../scripts/check-play3-homepage.js';
import { BROWSER_LIKE_HEADERS } from '../../../scripts/feed-fetch-utils.js';

const ARTICLE_A = 'https://www.play3.de/2026/10/03/artikel-a/';
const ARTICLE_B = 'https://www.play3.de/2026/10/03/artikel-b/';
const IMAGE = 'https://www.play3.de/wp-content/uploads/2026/10/bild.jpg';
const HTML = `<html><body><a href="${ARTICLE_A}"><img data-lazy-src="${IMAGE}" src="data:image/svg+xml,placeholder"></a></body></html>`;
const feed = (...links) => `<rss version="2.0"><channel>${links.map(link =>
    `<item><title>Gleicher Titel</title><link>${link}</link></item>`).join('')}</channel></rss>`;
const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
const response = (body, status = 200) => new Response(body, { status });

function harness(handler = url => response(url === PLAY3_HOMEPAGE_URL ? HTML : feed(ARTICLE_A, ARTICLE_B))) {
    const calls = [];
    const timeouts = [];
    let time = 0;
    return {
        calls,
        timeouts,
        options: {
            lookup,
            now: () => time += 10,
            createSignal: ms => {
                timeouts.push(ms);
                return new AbortController().signal;
            },
            fetchImpl: async (url, init) => {
                calls.push({ url: String(url), init });
                return handler(String(url), init);
            },
        },
    };
}

test('Play3-Diagnose ordnet Bilder exakt zu und ruft nur Startseite und Feed ab', async () => {
    const { calls, timeouts, options } = harness();
    const result = await probePlay3Homepage(options);
    assert.equal(result.outcome, 'images_found');
    assert.equal(result.feedItemCount, 2);
    assert.equal(result.matchedItemCount, 1);
    assert.equal(result.unmatchedItemCount, 1);
    assert.equal(result.invalidFeedLinkCount, 0);
    assert.equal(result.homepage.durationMs, 10);
    assert.equal(result.homepage.bytes, Buffer.byteLength(HTML));
    assert.deepEqual(calls.map(call => call.url), [PLAY3_HOMEPAGE_URL, PLAY3_FEED_URL]);
    assert.deepEqual(timeouts, [PROBE_TIMEOUT_MS, PROBE_TIMEOUT_MS]);
    for (const { init } of calls) {
        assert.deepEqual(init.headers, BROWSER_LIKE_HEADERS);
        assert.equal(init.redirect, 'manual');
    }
});

test('Play3-Diagnose erkennt lazy, normale und noscript-Bilder ohne doppelte Artikel', () => {
    const { articles, withImage } = inspectHomepage(`${HTML}
        <a href="${ARTICLE_A}"><img src="${IMAGE}"></a>
        <a href="/2026/10/03/artikel-b"><img src="data:image/svg+xml,leer"><noscript><img src="${IMAGE}"></noscript></a>
        <a href="/2026/10/03/artikel-c/"><img data-src="${IMAGE}"></a>
        <a href="/2026/10/03/artikel-d/"><img src="${IMAGE}"></a>`);
    assert.equal(articles.size, 4);
    assert.equal(withImage.size, 4);
});

test('Play3-Diagnose ignoriert fremde Links, unsichere Bilder, Logos und Nachbarkarten', () => {
    const { articles, withImage } = inspectHomepage(`
        <a href="${ARTICLE_A}">Titel</a><img src="${IMAGE}">
        <a href="${ARTICLE_B}"><img src="data:image/svg+xml,leer"><img src="/logo.svg"><img src="https://fremd.example/bild.jpg"><img src="https://user:pass@www.play3.de/wp-content/uploads/a.jpg"></a>
        <a href="https://fremd.example/2026/10/03/artikel-a/"><img src="${IMAGE}"></a>
        <a href="http://www.play3.de/2026/10/03/artikel-a/"><img src="${IMAGE}"></a>
        <a href="${ARTICLE_A}?anderer=artikel"><img src="${IMAGE}"></a>
        <a href="javascript:alert(1)"><img src="${IMAGE}"></a>`);
    assert.equal(articles.size, 2);
    assert.equal(withImage.size, 0);
});

test('Play3-Diagnose beendet bei 403 nach einer Anfrage und verwirft die Antwort', async () => {
    let cancelled = false;
    const { calls, options } = harness(() => new Response(new ReadableStream({
        cancel() { cancelled = true; },
    }), { status: 403 }));
    const result = await probePlay3Homepage(options);
    assert.equal(result.outcome, 'homepage_unavailable');
    assert.equal(result.homepage.status, 403);
    assert.equal(result.homepage.error, 'http');
    assert.equal(result.feed, null);
    assert.equal(result.matchedItemCount, null);
    assert.equal(calls.length, 1);
    assert.equal(cancelled, true);
    assert.match(formatProbeReport(result), /RSS-Feed \| nicht angefragt/);
});

test('Play3-Diagnose folgt keiner Weiterleitung, auch nicht auf eine andere Play3-Seite', async () => {
    const { calls, options } = harness(() => new Response(null, {
        status: 302, headers: { Location: ARTICLE_A },
    }));
    const result = await probePlay3Homepage(options);
    assert.equal(result.homepage.error, 'redirect');
    assert.equal(calls.length, 1);
});

test('Play3-Diagnose bewertet eine 200-Schutzseite nicht als lesbare Artikelliste', async () => {
    const { calls, options } = harness(() => response('<html><title>Just a moment...</title></html>'));
    const result = await probePlay3Homepage(options);
    assert.equal(result.outcome, 'homepage_not_recognized');
    assert.equal(result.homepage.status, 200);
    assert.equal(result.feedItemCount, null);
    assert.equal(calls.length, 1);
});

test('Play3-Diagnose behaelt bei gescheitertem RSS die Startseitenmessung', async () => {
    const { calls, options } = harness(url => response(url === PLAY3_HOMEPAGE_URL ? HTML : '', url === PLAY3_HOMEPAGE_URL ? 200 : 429));
    const result = await probePlay3Homepage(options);
    assert.equal(result.outcome, 'feed_unavailable');
    assert.equal(result.homepageImageArticleCount, 1);
    assert.equal(result.feed.status, 429);
    assert.equal(result.feedItemCount, null);
    assert.equal(calls.length, 2);
});

test('Play3-Diagnose unterscheidet falsches RSS-Format, leeren Feed und fehlende Zuordnungen', async () => {
    for (const [body, outcome, count] of [
        ['<html>kein Feed</html>', 'feed_not_recognized', null],
        [feed(), 'no_matches', 0],
        [feed(ARTICLE_B), 'no_matches', 1],
    ]) {
        const { options } = harness(url => response(url === PLAY3_HOMEPAGE_URL ? HTML : body));
        const result = await probePlay3Homepage(options);
        assert.equal(result.outcome, outcome);
        assert.equal(result.feedItemCount, count);
    }
});

test('Play3-Diagnose zaehlt ungueltige RSS-Links ohne sie abzurufen', async () => {
    const { calls, options } = harness(url => response(url === PLAY3_HOMEPAGE_URL ? HTML : feed(ARTICLE_A, 'http://127.0.0.1/secret')));
    const result = await probePlay3Homepage(options);
    assert.equal(result.invalidFeedLinkCount, 1);
    assert.equal(result.matchedItemCount, 1);
    assert.equal(calls.length, 2);
});

test('Play3-Diagnose begrenzt auch gestreamte Antworten ohne Content-Length', async () => {
    const { calls, options } = harness(() => response('a'.repeat(PROBE_MAX_BYTES + 1)));
    const result = await probePlay3Homepage(options);
    assert.equal(result.homepage.status, 200);
    assert.equal(result.homepage.error, 'too_large');
    assert.equal(result.homepage.bytes, null);
    assert.equal(result.feed, null);
    assert.equal(calls.length, 1);
});

test('Play3-Diagnose klassifiziert Timeout ohne Retry oder Ausgabe fremder Fehlertexte', async () => {
    const { calls, options } = harness(() => { throw new DOMException('vertraulicher Text', 'TimeoutError'); });
    const result = await probePlay3Homepage(options);
    assert.equal(result.homepage.error, 'timeout');
    assert.equal(result.homepage.status, null);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(formatProbeReport(result), /vertraulicher/);
});

test('Play3-Diagnose prueft DNS vor dem ersten Netzwerkzugriff', async () => {
    const { calls, options } = harness();
    const result = await probePlay3Homepage({ ...options, lookup: async () => [{ address: '127.0.0.1', family: 4 }] });
    assert.equal(result.homepage.error, 'network');
    assert.equal(calls.length, 0);
});

test('Play3-Bericht gibt nur Messungen aus, keine Artikeltexte oder Bildadressen', async () => {
    const { options } = harness();
    const result = await probePlay3Homepage(options);
    const report = formatProbeReport(result);
    assert.match(report, /RSS-Artikel mit passender Bildadresse: 1/);
    assert.doesNotMatch(report, /artikel-a|bild\.jpg|Gleicher Titel/);
    assert.match(report, /Bilder und Artikelseiten wurden nicht abgerufen/);
});

test('Play3-CLI schreibt nur die optionale Step-Summary und nutzt keine Secrets', async () => {
    const { options, calls } = harness();
    const writes = [];
    const logs = [];
    const result = await main({
        ...options,
        env: { GITHUB_STEP_SUMMARY: 'summary.md', FEED_PROXY_URL: 'https://geheim.example', KV_REST_API_TOKEN: 'geheim' },
        logger: { log: message => logs.push(message) },
        writeSummary: async (...args) => writes.push(args),
    });
    assert.equal(result.outcome, 'images_found');
    assert.deepEqual(writes, [['summary.md', logs[0]]]);
    assert.doesNotMatch(logs[0], /geheim/);
    assert.equal(calls.length, 2);
});

test('Play3-CLI schreibt ohne Summary-Pfad keine Datei', async () => {
    const { options } = harness();
    await main({
        ...options, env: {}, logger: { log() {} },
        writeSummary: () => assert.fail('kein Schreibzugriff erwartet'),
    });
});

test('Play3-CLI behaelt den Bericht bei einem Summary-Schreibfehler im Log', async () => {
    const { options } = harness();
    const errors = [];
    const result = await main({
        ...options, env: { GITHUB_STEP_SUMMARY: 'summary.md' },
        logger: { log() {}, error: message => errors.push(message) },
        writeSummary: async () => { throw new Error('geheimer Dateipfad'); },
    });
    assert.equal(result.outcome, 'images_found');
    assert.equal(errors.length, 1);
    assert.doesNotMatch(errors[0], /geheimer/);
});
