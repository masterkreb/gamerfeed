import type { FeedSource } from '../../types';

export interface HealthState {
    status: 'unknown' | 'checking' | 'ok' | 'warning' | 'error';
    detail: string | null;
}

// --- Start of functions copied from newsService.ts ---

function parseRssXml(xmlString: string, feedUrl: string): { items: any[] } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");

    const errorNode = doc.querySelector("parsererror");
    if (errorNode) {
        console.error("XML Parsing Error:", errorNode.textContent, "for feed:", feedUrl);
        throw new Error(`Failed to parse XML for feed: ${feedUrl}`);
    }

    const isAtom = doc.documentElement.nodeName === 'feed';

    const getQueryText = (context: Element | Document, selector: string): string => {
        return context.querySelector(selector)?.textContent?.trim() || '';
    };

    const getHtmlContent = (node: Element, selector: string): string => {
        return node.querySelector(selector)?.textContent?.trim() || '';
    };

    const items: any[] = [];
    const itemNodes = doc.querySelectorAll(isAtom ? "entry" : "item");

    itemNodes.forEach(item => {
        const node = item as Element;

        let link: string | null = '';
        if (isAtom) {
            const linkNode = Array.from(node.querySelectorAll('link')).find(l => (l as Element).getAttribute('rel') === 'alternate') || node.querySelector('link');
            link = (linkNode as Element)?.getAttribute('href');
        } else {
            link = getQueryText(node, 'link');
        }

        const title = getQueryText(node, 'title');
        const pubDate = getQueryText(node, isAtom ? 'published' : 'pubDate') || getQueryText(node, 'updated');

        if (!title || !link || !pubDate) {
            return;
        }

        const description = getHtmlContent(node, 'description') || getHtmlContent(node, 'summary');
        const contentEncoded = getHtmlContent(node, 'content\\:encoded') || getHtmlContent(node, 'content');
        const mediaThumbnail = node.querySelector('media\\:thumbnail, thumbnail[url]') as Element;
        const enclosure = node.querySelector('enclosure[url]') as Element;

        items.push({
            title: title,
            link: link,
            pubDate: pubDate,
            guid: getQueryText(node, 'guid') || getQueryText(node, 'id') || link,
            description: description,
            content: contentEncoded || description,
            'media:thumbnail': mediaThumbnail ? { url: mediaThumbnail.getAttribute('url') } : null,
            enclosure: enclosure ? { link: enclosure.getAttribute('url'), type: enclosure.getAttribute('type') } : null,
        });
    });

    return { items };
}


function extractInitialData(item: any, feed: FeedSource): { imageUrl: string; needsScraping: boolean } {
    let imageUrl: string | undefined;

    if (item.enclosure && item.enclosure.link && item.enclosure.type?.startsWith('image')) {
        imageUrl = item.enclosure.link;
    }
    else if (item.thumbnail && typeof item.thumbnail === 'string') {
        imageUrl = item.thumbnail;
    }
    else if (item['media:thumbnail'] && item['media:thumbnail'].url) {
        imageUrl = item['media:thumbnail'].url;
    }
    else {
        const content = item.content || item.description || '';
        if (content) {
            try {
                const doc = new DOMParser().parseFromString(content, 'text/html');
                const images = Array.from(doc.querySelectorAll('img'));
                const bestImage = images.find(img => {
                    const src = img.getAttribute('src');
                    if (!src || src.includes('cpx.golem.de')) return false;
                    const width = parseInt(img.getAttribute('width') || '0', 10);
                    const height = parseInt(img.getAttribute('height') || '0', 10);
                    if (width <= 1 || height <= 1) return false;
                    return true;
                });
                if (bestImage) {
                    const src = bestImage.getAttribute('data-src') || bestImage.getAttribute('data-lazy-src') || bestImage.getAttribute('src');
                    if(src) imageUrl = src;
                }
            } catch (e) {
                console.warn("DOMParser failed for content.", e);
            }
        }
    }

    const needsScraping = !imageUrl && !!feed.needsScraping;

    if (imageUrl) {
        try {
            let processedUrl = new URL(imageUrl, item.link).href;
            // Simplified version for health check: no domain-specific URL cleaning
            return { imageUrl: processedUrl, needsScraping: false };
        } catch (e) {
            // Fallthrough on invalid URL
        }
    }

    const placeholderUrl = `https://placehold.co/600x400/374151/d1d5db?text=${encodeURIComponent(feed.name.substring(0, 30))}`;
    return { imageUrl: placeholderUrl, needsScraping };
}

// --- End of copied functions ---


export async function checkFeedHealth(feed: FeedSource): Promise<HealthState> {
    const proxies = (url: string) => [
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    ];

    // 1. Check feed URL
    let xmlString: string | null = null;
    let feedError: string | null = null;
    for (const proxyUrl of proxies(feed.url)) {
        try {
            const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
            if (response.ok) {
                const text = await response.text();
                if (text && text.trim().startsWith('<')) {
                    xmlString = text;
                    feedError = null;
                    break;
                }
            } else {
                feedError = `Proxy returned status ${response.status}`;
            }
        } catch (e) {
            feedError = e instanceof Error ? e.message : 'Unknown fetch error';
        }
    }

    if (!xmlString) {
        return { status: 'error', detail: `Feed URL is unreachable. Last error: ${feedError}` };
    }

    // 2. Parse XML
    let parsedData;
    try {
        parsedData = parseRssXml(xmlString, feed.url);
        if (!parsedData || !parsedData.items) {
            throw new Error("Parsing did not return items array.");
        }
    } catch (e) {
        return { status: 'error', detail: `Failed to parse XML. Error: ${e instanceof Error ? e.message : 'Unknown'}` };
    }

    const firstItem = parsedData.items[0];
    if (!firstItem) {
        return { status: 'warning', detail: 'Feed is valid but contains no articles to check.' };
    }

    // 3. Extract Image URL
    const { imageUrl, needsScraping } = extractInitialData(firstItem, feed);

    if (needsScraping) {
        return { status: 'warning', detail: 'Feed OK. Image requires scraping (cannot be checked directly).' };
    }
    if (imageUrl.includes('placehold.co')) {
        return { status: 'warning', detail: 'Feed OK. Could not find an image, uses a placeholder.' };
    }

    // 4. Check Image URL
    let imageIsOk = false;
    let imageError: string | null = null;

    for (const proxyUrl of proxies(imageUrl)) {
        try {
            const controller = new AbortController();
            const signal = controller.signal;
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(proxyUrl, { signal, method: 'GET' });
            clearTimeout(timeoutId);

            if (response.ok) {
                imageIsOk = true;
                controller.abort(); // We got a success header, stop downloading the body
                break;
            } else {
                imageError = `Proxy returned status ${response.status}`;
            }
        } catch (e) {
            if ((e as Error).name !== 'AbortError') {
                imageError = e instanceof Error ? e.message : 'Unknown fetch error';
            }
        }
    }

    if (!imageIsOk) {
        return { status: 'error', detail: `Feed OK, but first image URL seems broken. Last error: ${imageError}` };
    }

    return { status: 'ok', detail: 'Feed and first image appear to be working.' };
}