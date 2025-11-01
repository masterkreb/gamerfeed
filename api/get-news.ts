import { DOMParser } from 'linkedom';

export const config = {
    runtime: 'edge',
};

import type { Article, FeedSource } from '../types';
import { sql } from '@vercel/postgres';

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

// --- Server-Side Implementations of News Service Logic ---

function stripHtmlAndTruncate(html: string, length: number = 150): string {
    if (!html) return '';
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
    const proxies = [
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    ];

    for (const proxyUrl of proxies) {
        try {
            const response = await fetch(proxyUrl, {
                signal: AbortSignal.timeout(5000),
                headers: { 'User-Agent': BROWSER_USER_AGENT }
            });
            if (!response.ok) continue;

            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            const ogImageMeta =
                doc.querySelector('meta[property="og:image"]') as Element | null ||
                doc.querySelector('meta[property="og:image:url"]') as Element | null ||
                doc.querySelector('meta[name="twitter:image"]') as Element | null;

            if (ogImageMeta) {
                const imageUrl = ogImageMeta.getAttribute('content');
                if (imageUrl) {
                    return new URL(imageUrl, url).href;
                }
            }
        } catch (e) {
            console.warn(`Error scraping OG Image for ${url} via proxy:`, e);
        }
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
            const img = doc.querySelector('img') as Element | null;
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
    // FIX: Changed from "application/xml" to "text/xml" to satisfy the DOMParser's type constraints.
    // "text/xml" is a valid and compatible MIME type for parsing RSS/Atom feeds.
    const doc = parser.parseFromString(xmlString, "text/xml");
    const errorNode = doc.querySelector("parsererror");
    if (errorNode) {
        // linkedom's parsererror might not have useful textContent, so we construct a more generic message.
        console.error(`XML Parsing Error for feed: ${feedUrl}. The XML might be malformed.`);
        throw new Error(`Failed to parse XML for feed: ${feedUrl}`);
    }

    const isAtom = doc.documentElement.nodeName === 'feed';
    const getQueryText = (ctx: Element | Document, sel: string): string => ctx.querySelector(sel)?.textContent?.trim() || '';
    const items: any[] = [];
    doc.querySelectorAll(isAtom ? "entry" : "item").forEach(node => {
        const itemElement = node as Element;
        let link: string | null | undefined = '';

        if (isAtom) {
            const linkNodes = itemElement.querySelectorAll('link');
            let alternateLinkNode: Element | null = null;
            // Explicitly iterate with a type guard to be safe in the Edge runtime.
            for (let i = 0; i < linkNodes.length; i++) {
                const lNode = linkNodes[i];
                if (lNode.nodeType === 1) { // Node.ELEMENT_NODE
                    const lElement = lNode as Element;
                    if (lElement.getAttribute('rel') === 'alternate') {
                        alternateLinkNode = lElement;
                        break;
                    }
                }
            }
            // Fallback to the first link if no 'alternate' is found
            const firstLinkNode = linkNodes[0];
            const linkNode = alternateLinkNode || (firstLinkNode && firstLinkNode.nodeType === 1 ? firstLinkNode as Element : null);
            link = linkNode?.getAttribute('href');
        } else {
            link = getQueryText(itemElement, 'link');
        }

        const title = getQueryText(itemElement, 'title');
        const pubDate = getQueryText(itemElement, isAtom ? 'published' : 'pubDate') || getQueryText(itemElement, 'updated');
        if (!title || !link || !pubDate) return;

        items.push({
            title, link, pubDate,
            guid: getQueryText(itemElement, 'guid') || getQueryText(itemElement, 'id') || link,
            description: getQueryText(itemElement, 'description') || getQueryText(itemElement, 'summary'),
            content: getQueryText(itemElement, 'content\\:encoded') || getQueryText(itemElement, 'content'),
            'media:thumbnail': { url: (itemElement.querySelector('media\\:thumbnail, thumbnail[url]') as Element | null)?.getAttribute('url') },
            enclosure: { link: (itemElement.querySelector('enclosure[url]') as Element | null)?.getAttribute('url'), type: (itemElement.querySelector('enclosure[url]') as Element | null)?.getAttribute('type') },
        });
    });
    return { items };
}

async function fetchArticlesFromFeeds(feeds: FeedSource[]): Promise<Article[]> {
    const proxies = (url: string) => [
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    ];

    const feedErrors = new Map<string, string[]>();

    const fetchPromises = feeds.map(feed => (async () => {
        const errorsForFeed: string[] = [];
        for (const proxyUrl of proxies(feed.url)) {
            try {
                const response = await fetch(proxyUrl, {
                    signal: AbortSignal.timeout(8000),
                    headers: { 'User-Agent': BROWSER_USER_AGENT }
                });

                if (!response.ok) {
                    const errorText = `status ${response.status}`;
                    console.warn(`Proxy for ${feed.url} returned ${errorText}`);
                    errorsForFeed.push(errorText);
                    continue;
                }
                const xmlString = await response.text();
                if (!xmlString || !xmlString.trim().startsWith('<')) {
                    const errorText = 'invalid XML content';
                    console.warn(`Proxy for ${feed.url} returned ${errorText}`);
                    errorsForFeed.push(errorText);
                    continue;
                }
                return { ...parseRssXml(xmlString, feed.url), feed, status: 'ok' };
            } catch (error) {
                const errorMessage = error instanceof Error ? (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : error.message : 'unknown error';
                console.warn(`Proxy for ${feed.url} failed:`, errorMessage);
                errorsForFeed.push(errorMessage);
            }
        }
        console.error(`All proxies failed for feed ${feed.url}`);
        feedErrors.set(feed.name, errorsForFeed);
        return null;
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
        let errorSummary = "Could not fetch from any source. Diagnostics: ";
        const errorEntries: string[] = [];
        feedErrors.forEach((errors, feedName) => {
            errorEntries.push(`${feedName} (${errors.join(", ")})`);
        });
        errorSummary += errorEntries.slice(0, 5).join('; '); // Limit to first 5 to avoid huge error messages
        if (errorEntries.length > 5) errorSummary += '...';
        throw new Error(errorSummary);
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

    const BATCH_SIZE = 10;
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
        const { rows: feedsFromDb } = await sql<FeedSource>`SELECT * FROM feeds;`;

        const articles = await fetchArticlesFromFeeds(feedsFromDb);
        const articlesWithImages = await runImageScraper(articles);
        const finalArticles = processArticles(articlesWithImages);

        return new Response(JSON.stringify(finalArticles), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                // Cache on Vercel's Edge network for 15 minutes
                'Cache-Control': 's-maxage=900, stale-while-revalidate=1800',
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