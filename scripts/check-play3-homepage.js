// Isolierte, rein lesende Diagnose. Kein Import des schreibenden Feed-Laufs.
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from 'linkedom';
import { BROWSER_LIKE_HEADERS } from './feed-fetch-utils.js';
import { readLimitedResponseText } from './limited-response.js';
import { fetchWithOutboundPolicy } from './outbound-policy.js';
import { PLAY3_HOMEPAGE_URL, getPlay3ArticleKey, parsePlay3Homepage } from './source-image-resolvers.js';

export { PLAY3_HOMEPAGE_URL };
export const PLAY3_FEED_URL = 'https://www.play3.de/feed/';
export const PROBE_TIMEOUT_MS = 15000;
export const PROBE_MAX_BYTES = 2 * 1024 * 1024;

export function inspectHomepage(html) {
    const { articles, imageByArticleKey } = parsePlay3Homepage(html);
    return { articles, withImage: new Set(imageByArticleKey.keys()) };
}

function inspectFeed(xml) {
    const document = new DOMParser().parseFromString(xml, 'text/xml');
    const channel = document.querySelector('rss > channel');
    if (!channel) return null;
    const items = [...channel.children].filter(element => element.tagName === 'item');
    return items.map(item => getPlay3ArticleKey(item.querySelector('link')?.textContent?.trim()));
}

const ERROR_LABELS = {
    http: 'HTTP-Ablehnung',
    timeout: 'Zeitlimit erreicht',
    too_large: 'Antwort groesser als 2 MiB',
    redirect: 'Weiterleitung nicht verfolgt',
    network: 'Netzwerk- oder Adresspruefung fehlgeschlagen',
};

async function requestDocument(url, { fetchImpl, lookup, createSignal, now }) {
    const started = now();
    const observation = { status: null, bytes: null, durationMs: null, error: null };
    let body = null;
    try {
        const response = await fetchWithOutboundPolicy(url, {
            fetchImpl,
            lookup,
            headers: BROWSER_LIKE_HEADERS,
            signal: createSignal(PROBE_TIMEOUT_MS),
            maxRedirects: 0,
        });
        observation.status = response.status;
        if (!response.ok) {
            observation.error = 'http';
            await response.body?.cancel?.().catch(() => {});
        } else {
            body = await readLimitedResponseText(response, PROBE_MAX_BYTES);
            observation.bytes = Buffer.byteLength(body);
        }
    } catch (error) {
        observation.error = error?.name === 'ResponseTooLargeError' ? 'too_large'
            : ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout'
                : error?.code === 'too_many_redirects' ? 'redirect' : 'network';
    }
    observation.durationMs = Math.max(0, Math.round(now() - started));
    return { observation, body };
}

export async function probePlay3Homepage({
    fetchImpl,
    lookup,
    createSignal = timeoutMs => AbortSignal.timeout(timeoutMs),
    now = () => performance.now(),
} = {}) {
    const options = { fetchImpl, lookup, createSignal, now };
    const result = {
        outcome: 'homepage_unavailable',
        homepage: null,
        feed: null,
        homepageArticleCount: null,
        homepageImageArticleCount: null,
        feedItemCount: null,
        invalidFeedLinkCount: null,
        matchedItemCount: null,
        unmatchedItemCount: null,
    };
    const homepage = await requestDocument(PLAY3_HOMEPAGE_URL, options);
    result.homepage = homepage.observation;
    if (homepage.body === null) return result;

    const { articles, withImage } = inspectHomepage(homepage.body);
    result.homepageArticleCount = articles.size;
    result.homepageImageArticleCount = withImage.size;
    if (!articles.size) return { ...result, outcome: 'homepage_not_recognized' };

    const feed = await requestDocument(PLAY3_FEED_URL, options);
    result.feed = feed.observation;
    if (feed.body === null) return { ...result, outcome: 'feed_unavailable' };
    const keys = inspectFeed(feed.body);
    if (keys === null) return { ...result, outcome: 'feed_not_recognized' };
    result.feedItemCount = keys.length;
    result.invalidFeedLinkCount = keys.filter(key => !key).length;
    result.matchedItemCount = keys.filter(key => withImage.has(key)).length;
    result.unmatchedItemCount = keys.length - result.matchedItemCount;
    result.outcome = result.matchedItemCount > 0 ? 'images_found' : 'no_matches';
    return result;
}

export function formatProbeReport(result) {
    const measured = value => value ?? 'nicht gemessen';
    const requestRow = (name, observation) => observation
        ? `| ${name} | ${measured(observation.status)} | ${observation.durationMs} ms | ${measured(observation.bytes)} | ${ERROR_LABELS[observation.error] ?? 'keiner'} |`
        : `| ${name} | nicht angefragt | - | - | - |`;
    return [
        '# Play3-Startseiten-Diagnose',
        '',
        `Ergebnis: ${result.outcome}`,
        '',
        '| Abruf | HTTP | Dauer | Gelesene Bytes | Fehler |',
        '| --- | --- | --- | --- | --- |',
        requestRow('Startseite', result.homepage),
        requestRow('RSS-Feed', result.feed),
        '',
        `- Eindeutige Artikellinks auf der Startseite: ${measured(result.homepageArticleCount)}`,
        `- Davon mit zugeordneter Bildadresse: ${measured(result.homepageImageArticleCount)}`,
        `- RSS-Artikel: ${measured(result.feedItemCount)}`,
        `- RSS-Artikel mit passender Bildadresse: ${measured(result.matchedItemCount)}`,
        `- RSS-Artikel ohne passende Bildadresse: ${measured(result.unmatchedItemCount)}`,
        `- Nicht zuordenbare RSS-Links: ${measured(result.invalidFeedLinkCount)}`,
        '',
        'Nur Bildadressen erkannt. Bilder und Artikelseiten wurden nicht abgerufen.',
        'Keine Retries, Weiterleitungen, Proxies, Secrets, Datenbank- oder Cache-Zugriffe.',
        'Dieses Ergebnis gilt nur fuer diesen Lauf und dessen Netzwerkstandort.',
        '',
    ].join('\n');
}

export async function main({
    env = process.env,
    logger = console,
    writeSummary = (path, report) => appendFile(path, report, 'utf8'),
    ...options
} = {}) {
    const result = await probePlay3Homepage(options);
    const report = formatProbeReport(result);
    logger.log(report);
    if (typeof env.GITHUB_STEP_SUMMARY === 'string' && env.GITHUB_STEP_SUMMARY.trim()) {
        try {
            await writeSummary(env.GITHUB_STEP_SUMMARY, report);
        } catch {
            logger.error('Step-Summary nicht geschrieben; der Bericht steht im Log.');
        }
    }
    return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    main().then(result => {
        process.exitCode = result.outcome === 'images_found' ? 0 : 1;
    }).catch(() => {
        console.error('Play3-Diagnose unerwartet fehlgeschlagen. Keine Produktionsdaten geaendert.');
        process.exitCode = 1;
    });
}
