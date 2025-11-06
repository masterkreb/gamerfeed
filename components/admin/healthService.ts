import type { FeedSource } from '../../types';

export interface HealthState {
    status: 'unknown' | 'checking' | 'ok' | 'warning' | 'error';
    detail: string | null;
}

// --- Start of functions copied from newsService.ts ---

function parseRssXml(xmlString: string, feedUrl: string): { items: any[] } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "application/xml");

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

    itemNodes.forEach(node => {
        let link: string | null = '';
        if (isAtom) {
            const linkNode = Array.from(node.querySelectorAll('link')).find(l => l.getAttribute('rel') === 'alternate') || node.querySelector('link');
            link = linkNode?.getAttribute('href');
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
        const mediaThumbnail = node.querySelector('media\\:thumbnail, thumbnail[url]');
        const enclosure = node.querySelector('enclosure[url]');

        items.push({
            title: title,
            link: link,
            pubDate: pubDate,
            guid: getQueryText(node, 'guid') || getQueryText(node, 'id') || link,
            description: description,
            content: contentEncoded || description,
            'media:thumbnail': { url: mediaThumbnail?.getAttribute('url') },
            enclosure: { link: enclosure?.getAttribute('url'), type: enclosure?.getAttribute('type') },
        });
    });

    return { items };
}


function extractInitialData(item: any, feed: FeedSource): { imageUrl: string; needsScraping: boolean } {
    let imageUrl: string | undefined;

    // 1. enclosure (priority)
    if (item.enclosure && item.enclosure.link && item.enclosure.type && item.enclosure.type.startsWith('image')) {
        imageUrl = item.enclosure.link;
    }

    // 2. media:thumbnail
    if (!imageUrl && item['media:thumbnail'] && item['media:thumbnail'].url) {
        imageUrl = item['media:thumbnail'].url;
    }

    // 3. thumbnail fallback
    if (!imageUrl && item.thumbnail && typeof item.thumbnail === 'string') {
        imageUrl = item.thumbnail;
    }

    // 4. Parse HTML content for images (same logic as fetch-feeds.js)
    if (!imageUrl) {
        const content = item.content || item.description || '';
        if (content) {
            try {
                const doc = new DOMParser().parseFromString(content, 'text/html');
                const images = Array.from(doc.querySelectorAll('img'));

                let bestImage: HTMLImageElement | null = null;
                let maxSize = 0;

                for (const img of images) {
                    const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
                    if (!src) continue;

                    // Tracking filter (same as fetch-feeds.js)
                    if (
                        src.includes('cpx.golem.de') ||
                        src.includes('feedburner.com') ||
                        src.includes('feedsportal.com') ||
                        src.includes('tracking') ||
                        src.includes('count.php') ||
                        src.includes('vgc.php') ||
                        src.includes('pixel') ||
                        src.match(/[?&]width=1[&$]/) ||
                        src.match(/[?&]height=1[&$]/) ||
                        src.endsWith('1x1.gif') ||
                        src.endsWith('1x1.png')
                    ) {
                        continue;
                    }

                    const width = parseInt(img.getAttribute('width') || '200', 10);
                    const height = parseInt(img.getAttribute('height') || '200', 10);

                    if (width <= 1 || height <= 1) continue;

                    const size = width * height;
                    if (size > maxSize) {
                        maxSize = size;
                        bestImage = img;
                    }
                }

                if (bestImage) {
                    const src = bestImage.getAttribute('data-src') || bestImage.getAttribute('data-lazy-src') || bestImage.getAttribute('src');
                    if (src) imageUrl = src;
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
            const urlObject = new URL(processedUrl);

            // URL optimizations (same as fetch-feeds.js)
            if (urlObject.hostname.includes('giantbomb.com')) {
                processedUrl = processedUrl.replace(/\/[^\/]+_(\d+)\.(jpg|jpeg|png)/, '/original.$2');
            }
            else if (urlObject.hostname.includes('gamespot.com')) {
                processedUrl = processedUrl.replace(/\/uploads\/[^\/]+\//, '/uploads/original/');
            }
            else if (urlObject.hostname.includes('gameswirtschaft.de')) {
                processedUrl = processedUrl.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|gif|webp)($|\?))/i, '');
            }
            else if (urlObject.hostname.includes('heise.de')) {
                processedUrl = processedUrl.replace(/\/geometry\/\d+\//, '/geometry/800/');
            }
            else if (urlObject.hostname.includes('pcgames.de')) {
                // Preserve original
            }
            else if (urlObject.hostname.includes('cgames.de')) {
                processedUrl = processedUrl.replace(/\/\d{2,4}\//, '/800/');
            }
            else if (urlObject.hostname.includes('4players.de')) {
                processedUrl = processedUrl.replace(/\/\d+\//, '/800/');
            }

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