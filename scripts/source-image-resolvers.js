// Quellspezifische Bildauflösung für Feeds, die keine Artikelbilder liefern.
//
// XboxDynasty liefert im RSS derzeit nur ein allgemeines 32x32-Feed-Icon.
// Die normalen Artikelseiten weisen automatisierte Abrufe seit Ende Juli 2026
// mit HTTP 401 ab, die öffentliche WordPress-REST-API stellt das jeweilige
// Yoast-OG-Bild aber weiterhin bereit. Ein einziger kleiner Batchabruf ersetzt
// deshalb bis zu hundert einzelne Seitenabrufe.

import { normalizeContentUrl } from '../shared/url-policy.js';
import { BROWSER_LIKE_HEADERS } from './feed-fetch-utils.js';
import { readLimitedResponseText } from './limited-response.js';
import { fetchWithOutboundPolicy } from './outbound-policy.js';

export const XBOXDYNASTY_IMAGE_API_URL =
    'https://www.xboxdynasty.de/wp-json/wp/v2/posts?per_page=100&_fields=link,yoast_head_json.og_image';
export const SOURCE_IMAGE_API_TIMEOUT_MS = 5000;
export const MAX_SOURCE_IMAGE_API_BYTES = 128 * 1024;

/**
 * WordPress gibt kanonische Links mit abschließendem Slash aus; ein RSS-Link
 * kann denselben Artikel ohne Slash oder mit einem irrelevanten Querystring
 * nennen. Für diese eine Quelle ist der Pfad deshalb der stabile Schlüssel.
 */
export function getXboxDynastyArticleKey(rawUrl) {
    const normalized = normalizeContentUrl(rawUrl);
    if (!normalized) return null;

    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'xboxdynasty.de' && hostname !== 'www.xboxdynasty.de') return null;

    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    return pathname.toLowerCase();
}

/**
 * Baut eine Zuordnung aus kanonischer Artikeladresse und OG-Bild.
 * Ungültige Einzelzeilen werden übersprungen; sie dürfen den ganzen Batch
 * nicht unbrauchbar machen.
 *
 * @param {unknown} rawPosts
 * @returns {Map<string, string>}
 */
export function buildXboxDynastyImageMap(rawPosts) {
    const imageByArticleKey = new Map();
    if (!Array.isArray(rawPosts)) return imageByArticleKey;

    for (const post of rawPosts) {
        const articleUrl = normalizeContentUrl(post?.link);
        const articleKey = getXboxDynastyArticleKey(articleUrl);
        const candidates = Array.isArray(post?.yoast_head_json?.og_image)
            ? post.yoast_head_json.og_image
            : [];
        const imageUrl = candidates
            .map(candidate => normalizeContentUrl(candidate?.url, { base: articleUrl ?? undefined }))
            .find(Boolean);

        if (articleKey && imageUrl) {
            imageByArticleKey.set(articleKey, imageUrl);
        }
    }

    return imageByArticleKey;
}

/**
 * Liest den kompakten WordPress-Batch mit denselben Netzwerkgrenzen wie die
 * übrigen fremden Antworten des Cron-Laufs.
 *
 * @param {{
 *   createSignal?: (timeoutMs: number) => AbortSignal,
 *   fetchImpl?: Function,
 *   lookup?: Function,
 *   maxBytes?: number,
 *   timeoutMs?: number,
 * }} [options]
 * @returns {Promise<Map<string, string>>}
 */
export async function fetchXboxDynastyImageMap({
    createSignal = timeoutMs => AbortSignal.timeout(timeoutMs),
    fetchImpl,
    lookup,
    maxBytes = MAX_SOURCE_IMAGE_API_BYTES,
    timeoutMs = SOURCE_IMAGE_API_TIMEOUT_MS,
} = {}) {
    const response = await fetchWithOutboundPolicy(XBOXDYNASTY_IMAGE_API_URL, {
        fetchImpl,
        lookup,
        headers: {
            ...BROWSER_LIKE_HEADERS,
            Accept: 'application/json',
        },
        signal: createSignal(timeoutMs),
    });

    if (!response.ok) {
        await response.body?.cancel?.().catch(() => {});
        throw new Error(`XboxDynasty image API responded with HTTP ${response.status}.`);
    }

    const body = await readLimitedResponseText(response, maxBytes);
    let posts;
    try {
        posts = JSON.parse(body);
    } catch {
        throw new Error('XboxDynasty image API returned invalid JSON.');
    }

    if (!Array.isArray(posts)) {
        throw new Error('XboxDynasty image API returned an unexpected payload.');
    }

    return buildXboxDynastyImageMap(posts);
}
