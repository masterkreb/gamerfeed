import type { Article, FeedSource } from '../types';

function stripHtmlAndTruncate(html: string, length: number = 150): string {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Security hardening: explicitly remove script and style tags
    doc.querySelectorAll('script, style').forEach(el => el.remove());

    // Remove any "read more" links entirely
    doc.querySelectorAll('a').forEach(a => {
        const linkText = a.textContent?.toLowerCase() || '';
        if (linkText.includes('continue reading') || linkText.includes('read more')) {
            a.closest('p')?.remove();
        }
    });

    let text = (doc.body.textContent || "").trim();

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

    // 1. Try media:content (used by many feeds like GameSpot, IGN, Rock Paper Shotgun, VG247, etc.)
    if (item['media:content'] && item['media:content'].url) {
        imageUrl = item['media:content'].url;
    }
    // 2. Try enclosure tag (used by PCGames, IGN, etc.)
    else if (item.enclosure && item.enclosure.link) {
        // Accept any enclosure, not just images
        imageUrl = item.enclosure.link;
    }
    // 3. Try media:thumbnail
    else if (item['media:thumbnail'] && item['media:thumbnail'].url) {
        imageUrl = item['media:thumbnail'].url;
    }
    // 4. Try thumbnail attribute
    else if (item.thumbnail && typeof item.thumbnail === 'string') {
        imageUrl = item.thumbnail;
    }
    // 5. Parse HTML content for images
    else {
        const content = item.content || item.description || item.summary || '';
        if (content) {
            try {
                // Decode HTML entities first (for feeds like GamersGlobal, Golem, Heise)
                const decodedContent = content
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&#39;/g, "'");

                const doc = new DOMParser().parseFromString(decodedContent, 'text/html');
                const images = Array.from(doc.querySelectorAll('img'));

                // Find the first valid content image
                const bestImage = images.find(img => {
                    const src = img.getAttribute('src');
                    if (!src) return false;

                    // Filter out known tracking pixels
                    if (src.includes('cpx.golem.de') ||
                        src.includes('count.php') ||
                        src.includes('tracking')) {
                        return false;
                    }

                    // Parse dimensions
                    const width = parseInt(img.getAttribute('width') || '0', 10);
                    const height = parseInt(img.getAttribute('height') || '0', 10);

                    // Filter out 1x1 tracking pixels
                    if ((width === 1 && height === 1) || (width <= 1 || height <= 1)) {
                        return false;
                    }

                    return true;
                });

                if (bestImage) {
                    const src = bestImage.getAttribute('data-src') ||
                        bestImage.getAttribute('data-lazy-src') ||
                        bestImage.getAttribute('src');
                    if (src) imageUrl = src;
                }
            } catch (e) {
                console.warn("DOMParser failed for content:", e);
            }
        }
    }

    const needsScraping = !imageUrl && !!feed.needsScraping;

    if (imageUrl) {
        try {
            // Handle relative URLs (e.g., GamersGlobal)
            let processedUrl = new URL(imageUrl, item.link).href;
            const urlObject = new URL(processedUrl);

            // GameSpot: Use original quality
            if (urlObject.hostname.includes('gamespot.com')) {
                processedUrl = processedUrl.replace(/\/uploads\/[^\/]+\//, '/uploads/original/');
            }
            // GameStar, GamePro: Use 800px resolution
            else if (urlObject.hostname.includes('cgames.de') || feed.name.includes('GameStar') || feed.name.includes('GamePro')) {
                processedUrl = processedUrl.replace(/\/(\d{2,4})\//, '/800/');
            }
            // GamesWirtschaft: Remove size suffix
            else if (feed.name.includes('GamesWirtschaft')) {
                processedUrl = processedUrl.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|gif|webp)$)/i, '');
            }
            // Nintendo Life: Use large instead of small
            else if (urlObject.hostname.includes('nintendolife.com')) {
                processedUrl = processedUrl.replace('small.jpg', 'large.jpg');
            }
            // Eurogamer: Optimize image quality
            else if (urlObject.hostname.includes('gnwcdn.com')) {
                processedUrl = processedUrl.replace(/width=\d+/, 'width=800').replace(/quality=\d+/, 'quality=90');
            }
            // Giant Bomb: Use original image
            else if (urlObject.hostname.includes('giantbomb.com')) {
                processedUrl = processedUrl.replace(/\/[^\/]+_(\d+)\.jpg/, '/original.jpg');
            }

            return { imageUrl: processedUrl, needsScraping: false };
        } catch (e) {
            console.warn('Error processing image URL:', e);
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
        return context.querySelector(selector)?.textContent?.trim() || '';
    };

    const getHtmlContent = (node: Element, selector: string): string => {
        const el = node.querySelector(selector);
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
            return;
        }

        const description = getHtmlContent(node, 'description') || getHtmlContent(node, 'summary');
        const contentEncoded = getHtmlContent(node, 'content\\:encoded') || getHtmlContent(node, 'content');

        const mediaThumbnail = node.querySelector('media\\:thumbnail, thumbnail[url]');
        const mediaContent = node.querySelector('media\\:content, content[url]');
        const enclosure = node.querySelector('enclosure[url]');

        items.push({
            title: title,
            link: link,
            pubDate: pubDate,
            guid: getQueryText(node, 'guid') || getQueryText(node, 'id') || link,
            description: description,
            content: contentEncoded || description,
            summary: description,
            'media:thumbnail': {
                url: mediaThumbnail?.getAttribute('url'),
            },
            'media:content': {
                url: mediaContent?.getAttribute('url'),
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