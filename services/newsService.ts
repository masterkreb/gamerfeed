import type { Article, FeedSource } from '../types';

function stripHtmlAndTruncate(html: string, length: number = 150): string {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Security hardening: explicitly remove script and style tags
    // to prevent any possibility of XSS if this function's output were ever mishandled.
    doc.querySelectorAll('script, style').forEach(el => el.remove());

    // Remove any "read more" links entirely, as they are not part of the summary.
    doc.querySelectorAll('a').forEach(a => {
        const linkText = a.textContent?.toLowerCase() || '';
        if (linkText.includes('continue reading') || linkText.includes('read more')) {
            // Remove the whole paragraph containing the link, as it's usually boilerplate.
            a.closest('p')?.remove();
        }
    });

    let text = (doc.body.textContent || "").trim();

    // If, after cleaning, the text is just '...' or empty, return an empty string.
    if (text === '...') {
        return '';
    }

    if (text.length > length) {
        const truncated = text.substring(0, length);
        const lastSpace = truncated.lastIndexOf(' ');
        return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + '...';
    }
    return text;
}

export async function getOgImageFromUrl(url: string): Promise<string | null> {
    const proxies = [
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    ];

    for (const proxyUrl of proxies) {
        try {
            const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(5000) });
            if (!response.ok) continue;

            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            const ogImageMeta =
                doc.querySelector('meta[property="og:image"]') ||
                doc.querySelector('meta[property="og:image:url"]') ||
                doc.querySelector('meta[name="twitter:image"]');

            if (ogImageMeta) {
                const imageUrl = ogImageMeta.getAttribute('content');
                if (imageUrl) return new URL(imageUrl, url).href;
            }
        } catch (e) {
            console.warn(`Error with proxy for ${url}:`, e);
        }
    }
    return null;
}

function extractInitialData(item: any, feed: FeedSource): { imageUrl: string; needsScraping: boolean } {
    let imageUrl: string | undefined;

    if (item.enclosure && item.enclosure.link && item.enclosure.type && item.enclosure.type.startsWith('image')) {
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

                // Find the first image that is likely a real content image, not a tracking pixel.
                const bestImage = images.find(img => {
                    const src = img.getAttribute('src');
                    if (!src || src.includes('cpx.golem.de')) {
                        return false; // No src or it's a known tracking domain.
                    }
                    // Parse width/height, defaulting to 0. This way, images without dimensions are filtered out.
                    const width = parseInt(img.getAttribute('width') || '0', 10);
                    const height = parseInt(img.getAttribute('height') || '0', 10);

                    // Ignore tiny images which are likely trackers (e.g., 1x1, 0x0).
                    if (width <= 1 || height <= 1) {
                        return false;
                    }
                    return true;
                });

                if (bestImage) {
                    const src = bestImage.getAttribute('data-src') || bestImage.getAttribute('data-lazy-src') || bestImage.getAttribute('src');
                    if(src) imageUrl = src;
                }
            } catch (e) {
                console.warn("DOMParser failed for content, scraping will be attempted.", e);
            }
        }
    }

    const needsScraping = !imageUrl && !!feed.needsScraping;

    if (imageUrl) {
        try {
            let processedUrl = new URL(imageUrl, item.link).href;
            const urlObject = new URL(processedUrl);

            if (urlObject.hostname.includes('gamespot.com')) {
                // Replace any resolution-specific path segment like 'square_small' or 'square_avatar'
                // with 'original' for the highest quality image.
                processedUrl = processedUrl.replace(/\/uploads\/[^\/]+\//, '/uploads/original/');
            } else if (urlObject.hostname.includes('pcgames.de') && !urlObject.hostname.includes('pcgameshardware.de')) {
                // pcgames.de doesn't support /800/ resize - leave as-is
            } else if (urlObject.hostname.includes('pcgameshardware.de')) {
                // pcgameshardware.de also doesn't need /800/ - leave as-is
            } else if (urlObject.hostname.includes('cgames.de') || feed.name.includes('GameStar') || feed.name.includes('GamePro')) {
                processedUrl = processedUrl.replace(/\/(\d{2,4})\//, '/800/');
            }
            if (feed.name.includes('GamesWirtschaft')) {
                processedUrl = processedUrl.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|gif|webp)$)/i, '');
            }
            if (urlObject.hostname.includes('nintendolife.com')) {
                // Thumbnails in the feed are often low-res (e.g., small.jpg).
                // Attempt to get a larger version. 'large.jpg' is typically available and better quality.
                processedUrl = processedUrl.replace('small.jpg', 'large.jpg');
            }
            return { imageUrl: processedUrl, needsScraping: false };
        } catch (e) {
            // Fallthrough to placeholder on error
        }
    }

    const placeholderUrl = `https://placehold.co/600x400/374151/d1d5db?text=${encodeURIComponent(feed.name.substring(0, 30))}`;
    return { imageUrl: placeholderUrl, needsScraping };
}

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
        // Using textContent is robust: it works for regular text nodes and decodes entities automatically.
        return context.querySelector(selector)?.textContent?.trim() || '';
    };

    const getHtmlContent = (node: Element, selector: string): string => {
        const el = node.querySelector(selector);
        // Using textContent is robust: it correctly decodes HTML entities from the XML
        // and also correctly reads content from CDATA sections, providing the raw HTML string for parsing.
        return el?.textContent?.trim() || '';
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
            return; // Skip items with missing essential fields
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
            'media:thumbnail': {
                url: mediaThumbnail?.getAttribute('url'),
            },
            enclosure: {
                link: enclosure?.getAttribute('url'),
                type: enclosure?.getAttribute('type'),
            },
        });
    });

    if (itemNodes.length > 0 && items.length === 0) {
        console.warn(`Feed parsed but no valid items extracted for ${feedUrl}. Check selectors.`);
    }

    return { items };
}

export const fetchArticlesFromFeeds = async (feeds: FeedSource[]): Promise<Article[]> => {
    const proxies = (url: string) => [
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    ];

    const fetchPromises = feeds.map((feed) =>
        (async () => {
            for (const proxyUrl of proxies(feed.url)) {
                try {
                    const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
                    if (!response.ok) continue;

                    const xmlString = await response.text();

                    if (!xmlString || !xmlString.trim().startsWith('<')) {
                        console.warn(`Received invalid XML from ${proxyUrl} for ${feed.url}`);
                        continue;
                    }

                    const data = parseRssXml(xmlString, feed.url);
                    return { ...data, feed, status: 'ok' };
                } catch (error) {
                    console.warn(`Error with proxy ${proxyUrl} for ${feed.url}:`, error);
                }
            }
            console.error(`Error fetching or parsing feed ${feed.url}: All proxies failed.`);
            return null;
        })()
    );

    const results = await Promise.allSettled(fetchPromises);
    const allArticles: Article[] = [];

    results.forEach(result => {
        if (result.status === 'fulfilled' && result.value && result.value.status === 'ok') {
            const feedData = result.value;
            const sourceName = feedData.feed.name;
            const language = feedData.feed.language;

            feedData.items.forEach((item: any) => {
                if (!item.title || !item.link || !item.pubDate) return;

                const { imageUrl, needsScraping } = extractInitialData(item, feedData.feed);

                allArticles.push({
                    id: item.guid || item.link,
                    title: item.title.trim(),
                    source: sourceName,
                    publicationDate: new Date(item.pubDate).toISOString(),
                    summary: stripHtmlAndTruncate(item.description || item.content || ''),
                    link: item.link,
                    imageUrl: imageUrl,
                    needsScraping: needsScraping,
                    language: language,
                });
            });
        }
    });

    if (allArticles.length === 0 && results.length > 0) {
        const failedCount = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)).length;
        if (failedCount === results.length) {
            throw new Error("Could not fetch news from any source. Please check your internet connection or try again later.");
        }
    }

    return allArticles;
};
