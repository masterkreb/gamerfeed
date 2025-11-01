export const config = {
    runtime: 'edge',
};

import type { Article, FeedSource } from '../types';
import { sql } from '@vercel/postgres';

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

// --- Helper Functions ---

function stripHtmlAndTruncate(html: string, length: number = 150): string {
    if (!html) return '';

    try {
        // Use a more robust approach with try-catch
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        // Remove script and style tags
        const scripts = tempDiv.querySelectorAll('script, style');
        scripts.forEach(el => el.remove());

        let text = (tempDiv.textContent || tempDiv.innerText || "").trim();

        if (text.length > length) {
            const truncated = text.substring(0, length);
            const lastSpace = truncated.lastIndexOf(' ');
            return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + '...';
        }
        return text;
    } catch (e) {
        console.warn('Error stripping HTML:', e);
        // Fallback: simple regex-based stripping
        const stripped = html.replace(/<[^>]*>/g, '');
        return stripped.substring(0, length) + (stripped.length > length ? '...' : '');
    }
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

            // Use regex-based extraction instead of DOM parsing for OG images
            const ogImageMatch = html.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["']([^"']+)["']/i) ||
                html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:image|twitter:image)["']/i);

            if (ogImageMatch && ogImageMatch[1]) {
                const imageUrl = ogImageMatch[1];
                try {
                    return new URL(imageUrl, url).href;
                } catch {
                    return imageUrl;
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

    // Try different image sources
    if (item.enclosure?.link && item.enclosure?.type?.startsWith('image')) {
        imageUrl = item.enclosure.link;
    } else if (item.thumbnail && typeof item.thumbnail === 'string') {
        imageUrl = item.thumbnail;
    } else if (item['media:thumbnail']?.url) {
        imageUrl = item['media:thumbnail'].url;
    } else {
        // Extract from content/description using regex
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

            // Domain-specific image optimization
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

function parseRssXml(xmlString: string, feedUrl: string): { items: any[] } {
    try {
        // Use regex-based parsing as fallback for Edge Runtime compatibility
        const items: any[] = [];

        // Detect if it's Atom or RSS
        const isAtom = xmlString.includes('<feed') || xmlString.includes('xmlns="http://www.w3.org/2005/Atom"');

        // Extract items using regex
        const itemPattern = isAtom
            ? /<entry[^>]*>([\s\S]*?)<\/entry>/gi
            : /<item[^>]*>([\s\S]*?)<\/item>/gi;

        const itemMatches = xmlString.matchAll(itemPattern);

        for (const match of itemMatches) {
            const itemXml = match[1];

            // Extract fields using regex
            const titleMatch = itemXml.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/is);
            const linkMatch = isAtom
                ? itemXml.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i) || itemXml.match(/<link[^>]*>([^<]+)<\/link>/i)
                : itemXml.match(/<link[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/is);
            const pubDateMatch = isAtom
                ? itemXml.match(/<(?:published|updated)[^>]*>([^<]+)<\/(?:published|updated)>/i)
                : itemXml.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/i);
            const guidMatch = isAtom
                ? itemXml.match(/<id[^>]*>([^<]+)<\/id>/i)
                : itemXml.match(/<guid[^>]*>([^<]+)<\/guid>/i);
            const descMatch = itemXml.match(/<(?:description|summary)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary)>/is);
            const contentMatch = itemXml.match(/<(?:content:encoded|content)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:content:encoded|content)>/is);
            const mediaThumbnailMatch = itemXml.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i) ||
                itemXml.match(/<thumbnail[^>]+url=["']([^"']+)["']/i);
            const enclosureMatch = itemXml.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']([^"']+)["']/i);

            const title = titleMatch ? titleMatch[1].trim() : '';
            const link = linkMatch ? linkMatch[1].trim() : '';
            const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';

            if (!title || !link || !pubDate) {
                continue; // Skip invalid items
            }

            items.push({
                title,
                link,
                pubDate,
                guid: guidMatch ? guidMatch[1].trim() : link,
                description: descMatch ? descMatch[1].trim() : '',
                content: contentMatch ? contentMatch[1].trim() : '',
                'media:thumbnail': { url: mediaThumbnailMatch ? mediaThumbnailMatch[1] : null },
                enclosure: enclosureMatch ? {
                    link: enclosureMatch[1],
                    type: enclosureMatch[2]
                } : null,
            });
        }

        if (items.length === 0) {
            throw new Error(`No valid items found in feed: ${feedUrl}`);
        }

        return { items };
    } catch (error) {
        console.error(`Error parsing RSS XML for ${feedUrl}:`, error);
        throw new Error(`Failed to parse XML for feed: ${feedUrl}`);
    }
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
                const errorMessage = error instanceof Error
                    ? (error.name === 'TimeoutError' || error.name === 'AbortError')
                        ? 'timeout'
                        : error.message
                    : 'unknown error';
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
                    id: item.guid || item.link,
                    title: item.title.trim(),
                    source: feed.name,
                    publicationDate: new Date(item.pubDate).toISOString(),
                    summary: stripHtmlAndTruncate(item.description || item.content || ''),
                    link: item.link,
                    imageUrl,
                    needsScraping,
                    language: feed.language,
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
        errorSummary += errorEntries.slice(0, 5).join('; ');
        if (errorEntries.length > 5) errorSummary += '...';
        throw new Error(errorSummary);
    }

    return allArticles;
}

function processArticles(articles: Article[]): Article[] {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const uniqueArticles = new Map<string, Article>();

    // Deduplicate by title
    articles.forEach(article => {
        const normalizedTitle = article.title.toLowerCase().replace(/[^a-z0-9]/g, '');
        const key = normalizedTitle.substring(0, 80);

        if (!uniqueArticles.has(key) || (article.imageUrl && !uniqueArticles.get(key)?.imageUrl.includes('placehold'))) {
            uniqueArticles.set(key, article);
        }
    });

    return Array.from(uniqueArticles.values())
        .filter(article => new Date(article.publicationDate).getTime() >= sevenDaysAgo)
        .sort((a, b) => new Date(b.publicationDate).getTime() - new Date(a.publicationDate).getTime());
}

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
                        updatedArticlesMap.set(article.id, {
                            ...existing,
                            imageUrl: scrapedUrl,
                            needsScraping: false
                        });
                    }
                }
            })
        );
        if (i + BATCH_SIZE < articlesToScrape.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    return Array.from(updatedArticlesMap.values());
}

// --- Main API Handler ---

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
                'Cache-Control': 'no-cache',
            },
        });
    }
}