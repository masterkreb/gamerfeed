// Vercel Edge Functions are web-compatible, so we can use web APIs like DOMParser.
export const config = {
    runtime: 'edge',
};

import type { Article, FeedSource } from '../types';
import { INITIAL_FEEDS } from '../services/feeds';

// --- Server-Side Implementations of News Service Logic ---

function stripHtmlAndTruncate(html: string, length: number = 150): string {
    if (!html) return '';
    // A simple regex might be more performant and safer on the server than a full DOM parser.
    // However, since Edge functions support DOMParser, we can keep the logic for consistency.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style').forEach(el => el.remove());
    let text = (doc.body.textContent || "").trim();
    if (text.length > length) {
        const truncated = text.substring(0, length);
        const lastSpace = truncated.lastIndexOf(' ');
        return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + '...';
    }
    return text;
}

async function getOgImageFromUrl(url: string): Promise<string | null> {
    // Server-side fetching doesn't need a CORS proxy.
    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(5000),
            // Set a user-agent to be a good internet citizen.
            headers: { 'User-Agent': 'GamerFeedBot/1.0 (+https://gamerfeed.dev/bot.html)' }
        });
        if (!response.ok) return null;

        const html = await response.text();

        // Use a regex for performance on the server; it's often faster than parsing a full DOM.
        const ogImageMatch = html.match(/<meta\s+(?:name|property)\s*=\s*"(?:og:image|og:image:url|twitter:image)"\s+content\s*=\s*"([^"]+)"\s*\/?>/i);

        if (ogImageMatch && ogImageMatch[1]) {
            const imageUrl = ogImageMatch[1];
            // Resolve relative URLs to be absolute.
            return new URL(imageUrl, url).href;
        }
    } catch (e) {
        console.warn(`Error fetching OG Image for ${url}:`, e);
    }
    return null;
}

function extractInitialData(item: any, feed: FeedSource): { imageUrl: string; needsScraping: boolean } {
    let imageUrl: string | undefined;

    if (item.enclosure && item.enclosure.link && item.enclosure.type && item.enclosure.type.startsWith('image')) {
        imageUrl = item.enclosure.link;
    } else if (item.thumbnail && typeof item.thumbnail === 'string') {
        imageUrl = item.thumbnail;
    } else if (item['media:thumbnail'] && item['media:thumbnail'].url) {
        imageUrl = item['media:thumbnail'].url;
    } else {
        const content = item.content || item.description || '';
        if (content) {
            const doc = new DOMParser().parseFromString(content, 'text/html');
            const img = doc.querySelector('img');
            if (img) imageUrl = img.getAttribute('src') || undefined;
        }
    }

    const needsScraping = !imageUrl && !!feed.needsScraping;

    if (imageUrl) {
        try {
            let processedUrl = new URL(imageUrl, item.link).href;
            const urlObject = new URL(processedUrl);

            // Keep domain-specific image cleaning logic
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
        } catch (e) { /* Fallthrough on invalid URL */ }
    }

    const placeholderUrl = `https://placehold.co/600x400/374151/d1d5db?text=${encodeURIComponent(feed.name.substring(0, 30))}`;
    return { imageUrl: placeholderUrl, needsScraping };
}

function parseRssXml(xmlString: string, feedUrl: string): { items: any[] } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "application/xml");
    const errorNode = doc.querySelector("parsererror");
    if (errorNode) throw new Error(`Failed to parse XML for feed: ${feedUrl}`);

    const isAtom = doc.documentElement.nodeName === 'feed';
    const getQueryText = (ctx: Element | Document, sel: string): string => ctx.querySelector(sel)?.textContent?.trim() || '';
    const items: any[] = [];
    doc.querySelectorAll(isAtom ? "entry" : "item").forEach(node => {
        let link = isAtom
            ? (Array.from(node.querySelectorAll('link')).find(l => l.getAttribute('rel') === 'alternate') || node.querySelector('link'))?.getAttribute('href')
            : getQueryText(node, 'link');

        const title = getQueryText(node, 'title');
        const pubDate = getQueryText(node, isAtom ? 'published' : 'pubDate') || getQueryText(node, 'updated');
        if (!title || !link || !pubDate) return;

        items.push({
            title, link, pubDate,
            guid: getQueryText(node, 'guid') || getQueryText(node, 'id') || link,
            description: getQueryText(node, 'description') || getQueryText(node, 'summary'),
            content: getQueryText(node, 'content\\:encoded') || getQueryText(node, 'content'),
            'media:thumbnail': { url: node.querySelector('media\\:thumbnail, thumbnail[url]')?.getAttribute('url') },
            enclosure: { link: node.querySelector('enclosure[url]')?.getAttribute('url'), type: node.querySelector('enclosure[url]')?.getAttribute('type') },
        });
    });
    return { items };
}

async function fetchArticlesFromFeeds(feeds: FeedSource[]): Promise<Article[]> {
    const fetchPromises = feeds.map(feed => (async () => {
        try {
            const response = await fetch(feed.url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'GamerFeedBot/1.0' }});
            if (!response.ok) throw new Error(`Status ${response.status}`);
            const xmlString = await response.text();
            if (!xmlString || !xmlString.trim().startsWith('<')) throw new Error('Invalid XML');
            return { ...parseRssXml(xmlString, feed.url), feed, status: 'ok' };
        } catch (error) {
            console.warn(`Failed to fetch feed ${feed.url}:`, error);
            return null;
        }
    })());

    const results = await Promise.allSettled(fetchPromises);
    const allArticles: Article[] = [];

    results.forEach(result => {
        if (result.status === 'fulfilled' && result.value?.status === 'ok') {
            const { feed, items } = result.value;
            items.forEach((item: any) => {
                if (!item.title || !item.link || !item.pubDate) return;
                const { imageUrl, needsScraping } = extractInitialData(item, feed);
                allArticles.push({
                    id: item.guid || item.link, title: item.title.trim(), source: feed.name,
                    publicationDate: new Date(item.pubDate).toISOString(),
                    summary: stripHtmlAndTruncate(item.description || item.content || ''),
                    link: item.link, imageUrl, needsScraping, language: feed.language,
                });
            });
        }
    });

    const successfulFetches = results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
    if (successfulFetches === 0 && feeds.length > 0) {
        throw new Error("Could not fetch from any source.");
    }

    return allArticles;
};

// --- API Endpoint Logic ---

function processArticles(articles: Article[]): Article[] {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const uniqueArticles = new Map<string, Article>();

    // Deduplicate by title to avoid near-identical articles from different sources
    articles.forEach(article => {
        const normalizedTitle = article.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        const key = normalizedTitle.substring(0, 80);

        // Prioritize articles that have a proper image over placeholders
        if (!uniqueArticles.has(key) || (article.imageUrl && !uniqueArticles.get(key)?.imageUrl.includes('placehold'))) {
            uniqueArticles.set(key, article);
        }
    });

    return Array.from(uniqueArticles.values())
        .filter(article => new Date(article.publicationDate).getTime() >= sevenDaysAgo)
        .sort((a, b) => new Date(b.publicationDate).getTime() - new Date(a.publicationDate).getTime());
};

async function runImageScraper(articles: Article[]): Promise<Article[]> {
    const articlesToScrape = articles.filter(a => a.needsScraping || a.imageUrl.includes('placehold.co'));
    if (articlesToScrape.length === 0) return articles;

    const BATCH_SIZE = 10; // Can be larger on the server than in the browser
    const updatedArticlesMap = new Map(articles.map(a => [a.id, a]));

    for (let i = 0; i < articlesToScrape.length; i += BATCH_SIZE) {
        const batch = articlesToScrape.slice(i, i + BATCH_SIZE);
        await Promise.all(
            batch.map(async article => {
                const scrapedUrl = await getOgImageFromUrl(article.link);
                if (scrapedUrl) {
                    const existing = updatedArticlesMap.get(article.id);
                    if (existing) {
                        updatedArticlesMap.set(article.id, { ...existing, imageUrl: scrapedUrl, needsScraping: false });
                    }
                }
            })
        );
        if (i + BATCH_SIZE < articlesToScrape.length) {
            await new Promise(resolve => setTimeout(resolve, 200)); // Be respectful to servers
        }
    }
    return Array.from(updatedArticlesMap.values());
};

export default async function handler(req: Request) {
    try {
        const articles = await fetchArticlesFromFeeds(INITIAL_FEEDS);
        const articlesWithImages = await runImageScraper(articles);
        const finalArticles = processArticles(articlesWithImages);

        return new Response(JSON.stringify(finalArticles), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                // 5 min fresh, 10 min stale-while-revalidate for Vercel's Edge Cache
                'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
            },
        });

    } catch (error) {
        console.error("API Error in /api/get-news:", error);
        const message = error instanceof Error ? error.message : "An unknown server error occurred.";
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache', // Do not cache errors
            },
        });
    }
}