import { DOMParser } from 'linkedom';

export const BROWSER_LIKE_HEADERS = Object.freeze({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    // Deliberately without zstd: undici cannot decode it, Chrome offers it.
    'Accept-Encoding': 'gzip, deflate, br',
    'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
});

export const MAX_FEED_RESPONSE_BYTES = 5 * 1024 * 1024;

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);

// Der Hosting-Edge vor tools/feed-proxy.php weist Anfragen sporadisch mit 415 ab,
// bevor PHP ueberhaupt laeuft (beobachtet: identische Anfrage 415, sechs Minuten
// spaeter 200). Das Skript selbst erzeugt diesen Status nie - es antwortet mit
// 405, 422, 413, 500, 502 oder dem Status der Quelle. Auf dem Proxy-Weg gilt 415
// deshalb als voruebergehend, beim Direktabruf einer Quelle weiterhin nicht.
const PROXY_RETRYABLE_HTTP_STATUSES = new Set([...RETRYABLE_HTTP_STATUSES, 415]);

class ResponseTooLargeError extends Error {}

function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function isRetryableHttpStatus(status, retryableStatuses) {
    return retryableStatuses.has(status) || status >= 500;
}

function getRetryDelayMs(response, fallbackDelayMs) {
    const retryAfter = response.headers?.get?.('retry-after')?.trim();
    if (!retryAfter) return fallbackDelayMs;

    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, 5000);
    }

    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) {
        return Math.min(Math.max(retryAt - Date.now(), 0), 5000);
    }

    return fallbackDelayMs;
}

async function readLimitedResponseText(response, maxBytes) {
    const contentLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new ResponseTooLargeError(`response exceeds the ${maxBytes} byte limit`);
    }

    if (!response.body || typeof response.body.getReader !== 'function') {
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > maxBytes) {
            throw new ResponseTooLargeError(`response exceeds the ${maxBytes} byte limit`);
        }
        return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let text = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
                await reader.cancel();
                throw new ResponseTooLargeError(`response exceeds the ${maxBytes} byte limit`);
            }
            text += decoder.decode(value, { stream: true });
        }

        return text + decoder.decode();
    } finally {
        reader.releaseLock();
    }
}

export function isFeedXml(value) {
    if (typeof value !== 'string' || !value.trim()) return false;

    try {
        const document = new DOMParser().parseFromString(value, 'text/xml');
        if (!document.documentElement || document.querySelector('parsererror')) {
            return false;
        }

        const rootName = document.documentElement.nodeName.toLowerCase();
        const hasFeedRoot = rootName === 'rss'
            || rootName === 'feed'
            || rootName.endsWith(':feed')
            || rootName === 'rdf:rdf';
        if (!hasFeedRoot) return false;

        const escapedRootName = rootName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hasClosingRoot = new RegExp(`</${escapedRootName}\\s*>`, 'i').test(value);
        const isSelfClosingRoot = new RegExp(`<${escapedRootName}\\b[^>]*\\/\\s*>`, 'i').test(value);
        return hasClosingRoot || isSelfClosingRoot;
    } catch {
        return false;
    }
}

export function buildFeedProxyRequestUrl(feedProxyUrl, feedUrl) {
    const proxyRequestUrl = new URL(feedProxyUrl);
    proxyRequestUrl.hash = '';
    proxyRequestUrl.searchParams.set('url', feedUrl);
    return proxyRequestUrl.href;
}

async function fetchTextWithRetry({
    attempts,
    feedName,
    fetchImpl,
    headers,
    logger,
    maxBytes,
    requestLabel,
    requestUrl,
    retryableStatuses = RETRYABLE_HTTP_STATUSES,
    retryDelayMs,
    sleep,
    timeoutMs,
}) {
    let lastError = `${requestLabel} failed`;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = await fetchImpl(requestUrl, {
                headers,
                signal: AbortSignal.timeout(timeoutMs),
            });

            if (!response.ok) {
                lastError = `${requestLabel} failed with status ${response.status}`;
                const retryDelay = getRetryDelayMs(response, retryDelayMs);
                await response.body?.cancel().catch(() => {});
                if (attempt < attempts && isRetryableHttpStatus(response.status, retryableStatuses)) {
                    logger?.log?.(`   ↻ ${requestLabel} failed for ${feedName} (${lastError}). Retrying once...`);
                    await sleep(retryDelay);
                    continue;
                }
                return { error: lastError, status: response.status, text: null };
            }

            try {
                const text = await readLimitedResponseText(response, maxBytes);
                return { error: null, status: response.status, text };
            } catch (error) {
                lastError = `${requestLabel} response could not be read: ${getErrorMessage(error)}`;
                await response.body?.cancel().catch(() => {});
                if (!(error instanceof ResponseTooLargeError) && attempt < attempts) {
                    logger?.log?.(`   ↻ ${requestLabel} failed for ${feedName} (${lastError}). Retrying once...`);
                    await sleep(retryDelayMs);
                    continue;
                }
                return { error: lastError, status: response.status, text: null };
            }
        } catch (error) {
            lastError = getErrorMessage(error);
            if (attempt < attempts) {
                logger?.log?.(`   ↻ ${requestLabel} failed for ${feedName} (${lastError}). Retrying once...`);
                await sleep(retryDelayMs);
                continue;
            }
        }
    }

    return { error: lastError, status: null, text: null };
}

export async function fetchFeedXml({
    directAttempts = 2,
    directTimeoutMs = 15000,
    feedName,
    feedProxyUrl,
    feedUrl,
    fetchImpl = globalThis.fetch,
    logger = console,
    maxResponseBytes = MAX_FEED_RESPONSE_BYTES,
    proxyAttempts = 2,
    proxyTimeoutMs = 20000,
    retryDelayMs = 1000,
    sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
}) {
    const directResult = await fetchTextWithRetry({
        attempts: directAttempts,
        feedName,
        fetchImpl,
        headers: BROWSER_LIKE_HEADERS,
        logger,
        maxBytes: maxResponseBytes,
        requestLabel: 'Direct fetch',
        requestUrl: feedUrl,
        retryDelayMs,
        sleep,
        timeoutMs: directTimeoutMs,
    });

    if (directResult.text !== null && isFeedXml(directResult.text)) {
        logger?.log?.(`   ✅ Direct fetch successful for ${feedName}`);
        return {
            directError: null,
            lastError: null,
            proxyError: null,
            usedProxy: false,
            xmlString: directResult.text,
        };
    }

    const directError = directResult.text !== null
        ? `Direct fetch returned content that is not an RSS or Atom feed (status ${directResult.status})`
        : directResult.error;

    if (!feedProxyUrl?.trim()) {
        return {
            directError,
            lastError: directError,
            proxyError: null,
            usedProxy: false,
            xmlString: null,
        };
    }

    logger?.log?.(`   ⚠️  Direct fetch failed for ${feedName} (${directError}). Trying feed proxy...`);

    let proxyRequestUrl;
    try {
        proxyRequestUrl = buildFeedProxyRequestUrl(feedProxyUrl, feedUrl);
    } catch (error) {
        const proxyError = `feed proxy URL is invalid: ${getErrorMessage(error)}`;
        return {
            directError,
            lastError: `${directError} / ${proxyError}`,
            proxyError,
            usedProxy: false,
            xmlString: null,
        };
    }

    const proxyResult = await fetchTextWithRetry({
        attempts: proxyAttempts,
        feedName,
        fetchImpl,
        headers: undefined,
        logger,
        maxBytes: maxResponseBytes,
        requestLabel: 'Feed proxy',
        requestUrl: proxyRequestUrl,
        retryableStatuses: PROXY_RETRYABLE_HTTP_STATUSES,
        retryDelayMs,
        sleep,
        timeoutMs: proxyTimeoutMs,
    });

    if (proxyResult.text !== null && isFeedXml(proxyResult.text)) {
        logger?.log?.(`   ✅ Feed proxy fetch successful for ${feedName}`);
        return {
            directError,
            lastError: null,
            proxyError: null,
            usedProxy: true,
            xmlString: proxyResult.text,
        };
    }

    let proxyError;
    if (proxyResult.status === 422) {
        proxyError = 'feed proxy refused this URL (not in its allowlist)';
    } else if (proxyResult.text !== null) {
        proxyError = `feed proxy returned content that is not an RSS or Atom feed (status ${proxyResult.status})`;
    } else {
        proxyError = proxyResult.error;
    }

    return {
        directError,
        lastError: `${directError} / ${proxyError}`,
        proxyError,
        usedProxy: false,
        xmlString: null,
    };
}
