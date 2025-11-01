/**
 * @typedef {import('../types').Article} Article
 * @typedef {import('../types').FeedSource} FeedSource
 */

/**
 * Strips HTML tags from a string and truncates it.
 * @param {string} html The HTML string to clean.
 * @param {number} [length=150] The maximum length of the output string.
 * @returns {string} The cleaned and truncated string.
 */
export function stripHtmlAndTruncate(html, length = 150) {
    if (!html) return '';
    try {
        const stripped = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (stripped.length > length) {
            const truncated = stripped.substring(0, length);
            const lastSpace = truncated.lastIndexOf(' ');
            return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + '...';
        }
        return stripped;
    } catch (e) {
        console.warn('Error stripping HTML:', e);
        return '';
    }
}

/**
 * Extracts an image URL and scraping requirement from a feed item.
 * @param {any} item The parsed feed item.
 * @param {FeedSource} feed The source feed configuration.
 * @returns {{imageUrl: string, needsScraping: boolean}}
 */
export function extractInitialData(item, feed) {
    let imageUrl;
    if (item.enclosure?.link && item.enclosure?.type?.startsWith('image')) {
        imageUrl = item.enclosure.link;
    } else if (item.thumbnail && typeof item.thumbnail === 'string') {
        imageUrl = item.thumbnail;
    } else if (item['media:thumbnail']?.url) {
        imageUrl = item['media:thumbnail'].url;
    } else {
        const content = item.content || item.description || '';
        if (content) {
            const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (imgMatch && imgMatch[1]) {
                imageUrl = imgMatch[1];
            }
        }
    }
    const needsScraping = !imageUrl && !!feed.needsScraping;
    if (imageUrl) {
        try {
            let processedUrl = new URL(imageUrl, item.link).href;
            const urlObject = new URL(processedUrl);
            if (urlObject.hostname.includes('gamespot.com')) {
                processedUrl = processedUrl.replace(/\/uploads\/[^\/]+\//, '/uploads/original/');
            } else if (urlObject.hostname.includes('cgames.de') || feed.name.includes('GameStar') || feed.name.includes('GamePro')) {
                processedUrl = processedUrl.replace(/\/(\d{2,4})\//, '/800/');
            } else if (feed.name.includes('GamesWirtschaft')) {
                processedUrl = processedUrl.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|gif|webp)$)/i, '');
            } else if (urlObject.hostname.includes('nintendolife.com')) {
                processedUrl = processedUrl.replace('small.jpg', 'large.jpg');
            }
            return { imageUrl: processedUrl, needsScraping: false };
        } catch (e) {
            console.warn('Error processing image URL:', e);
        }
    }
    const placeholderUrl = `https://placehold.co/600x400/374151/d1d5db?text=${encodeURIComponent(feed.name.substring(0, 30))}`;
    return { imageUrl: placeholderUrl, needsScraping };
}

/**
 * Parses an RSS/Atom XML string into a list of items using regex.
 * @param {string} xmlString The XML content as a string.
 * @param {string} feedUrl The URL of the feed for context.
 * @returns {{items: any[]}}
 */
export function parseRssXml(xmlString, feedUrl) {
    try {
        const items = [];
        const isAtom = xmlString.includes('<feed') || xmlString.includes('xmlns="http://www.w3.org/2005/Atom"');
        const itemPattern = isAtom ? /<entry[^>]*>([\s\S]*?)<\/entry>/gi : /<item[^>]*>([\s\S]*?)<\/item>/gi;
        const itemMatches = xmlString.matchAll(itemPattern);

        for (const match of itemMatches) {
            const itemXml = match[1];
            const titleMatch = itemXml.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/is);
            const linkMatch = isAtom
                ? itemXml.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i) || itemXml.match(/<link[^>]*>([^<]+)<\/link>/i)
                : itemXml.match(/<link[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/is);
            const pubDateMatch = isAtom
                ? itemXml.match(/<(?:published|updated)[^>]*>([^<]+)<\/(?:published|updated)>/i)
                : itemXml.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/i);
            const guidMatch = isAtom ? itemXml.match(/<id[^>]*>([^<]+)<\/id>/i) : itemXml.match(/<guid[^>]*>([^<]+)<\/guid>/i);
            const descMatch = itemXml.match(/<(?:description|summary)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary)>/is);
            const contentMatch = itemXml.match(/<(?:content:encoded|content)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:content:encoded|content)>/is);
            const mediaThumbnailMatch = itemXml.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i) || itemXml.match(/<thumbnail[^>]+url=["']([^"']+)["']/i);
            const enclosureMatch = itemXml.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']([^"']+)["']/i);
            const title = titleMatch ? titleMatch[1].trim() : '';
            const link = linkMatch ? linkMatch[1].trim() : '';
            const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
            if (!title || !link || !pubDate) continue;
            items.push({
                title, link, pubDate,
                guid: guidMatch ? guidMatch[1].trim() : link,
                description: descMatch ? descMatch[1].trim() : '',
                content: contentMatch ? contentMatch[1].trim() : '',
                'media:thumbnail': { url: mediaThumbnailMatch ? mediaThumbnailMatch[1] : null },
                enclosure: enclosureMatch ? { link: enclosureMatch[1], type: enclosureMatch[2] } : null,
            });
        }
        if (items.length === 0) throw new Error(`No valid items found in feed: ${feedUrl}`);
        return { items };
    } catch (error) {
        console.error(`Error parsing RSS XML for ${feedUrl}:`, error);
        throw new Error(`Failed to parse XML for feed: ${feedUrl}`);
    }
}

/**
 * Processes a list of articles to filter old ones and remove duplicates.
 * @param {Article[]} articles The list of articles to process.
 * @returns {Article[]} The processed and sorted list of articles.
 */
export function processArticles(articles) {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const uniqueArticles = new Map();
    articles.forEach(article => {
        const normalizedTitle = article.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        // FIX: Create a more unique key by combining source and title to prevent
        // different news outlets reporting on the same event from being de-duplicated.
        const key = `${article.source}:${normalizedTitle.substring(0, 80)}`;
        if (!uniqueArticles.has(key) || (article.imageUrl && !uniqueArticles.get(key)?.imageUrl.includes('placehold'))) {
            uniqueArticles.set(key, article);
        }
    });
    return Array.from(uniqueArticles.values())
        .filter(article => new Date(article.publicationDate).getTime() >= sevenDaysAgo)
        .sort((a, b) => new Date(b.publicationDate).getTime() - new Date(a.publicationDate).getTime());
}
