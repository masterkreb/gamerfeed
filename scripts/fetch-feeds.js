import { sql } from '@vercel/postgres';
import { INITIAL_FEEDS } from '../services/feeds.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { stripHtmlAndTruncate, extractInitialData, parseRssXml, processArticles } from '../services/newsLogic.js';

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// --- Helper Functions adapted for Node.js script ---

async function fetchDirectly(url) {
    return fetch(url, {
        headers: { 'User-Agent': BROWSER_USER_AGENT },
        signal: AbortSignal.timeout(10000)
    });
}

async function getOgImageFromUrl(url) {
    try {
        const response = await fetchDirectly(url);
        if (!response.ok) return null;

        const html = await response.text();
        const ogImageMatch = html.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image)["']\s+content=["']([^"']+)["']/i) ||
            html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:image|twitter:image)["']/i);

        if (ogImageMatch && ogImageMatch[1]) {
            try {
                return new URL(ogImageMatch[1], url).href;
            } catch {
                return ogImageMatch[1];
            }
        }
    } catch (e) {
        console.warn(`Error scraping OG Image for ${url}:`, e);
    }
    return null;
}

async function fetchArticlesFromFeeds(feeds) {
    const feedErrors = new Map();
    const allArticles = [];
    const BATCH_SIZE = 5;

    for (let i = 0; i < feeds.length; i += BATCH_SIZE) {
        const batch = feeds.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(feed => (async () => {
            try {
                console.log(`Fetching: ${feed.name}...`);
                const response = await fetchDirectly(feed.url);
                if (response.ok) {
                    const xmlString = await response.text();
                    if (xmlString && xmlString.trim().startsWith('<')) {
                        const parsed = parseRssXml(xmlString, feed.url);
                        console.log(`✓ ${feed.name}: ${parsed.items.length} articles`);
                        return { ...parsed, feed, status: 'ok' };
                    }
                    throw new Error("Received empty or invalid XML");
                }
                console.log(`Failed: ${feed.name} (${response.status})`);
                throw new Error(`Fetch failed with status ${response.status}`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'unknown error';
                if (!error.message.includes('status')) { // Don't double-log status failures
                    console.log(`Failed: ${feed.name} (${errorMessage})`);
                }
                feedErrors.set(feed.name, [errorMessage]);
                return null;
            }
        })());

        const results = await Promise.allSettled(batchPromises);
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value?.status === 'ok') {
                const { feed, items } = result.value;
                items.forEach((item) => {
                    if (!item.title || !item.link || !item.pubDate) return;
                    const { imageUrl, needsScraping } = extractInitialData(item, feed);
                    allArticles.push({
                        id: item.guid || item.link, title: item.title.trim(), source: feed.name,
                        publicationDate: new Date(item.pubDate).toISOString(),
                        summary: stripHtmlAndTruncate(item.description || item.content || ''), link: item.link, imageUrl,
                        needsScraping, language: feed.language,
                    });
                });
            }
        });
        if (i + BATCH_SIZE < feeds.length) await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.log(`\nTotal articles fetched: ${allArticles.length}`);
    if (allArticles.length > 0) return allArticles;
    if (feedErrors.size > 0) {
        let errorSummary = "Could not fetch from any source. Diagnostics: ";
        const errorEntries = [];
        feedErrors.forEach((errors, feedName) => errorEntries.push(`${feedName} (${errors.join(", ")})`));
        errorSummary += errorEntries.slice(0, 5).join('; ');
        if (errorEntries.length > 5) errorSummary += '...';
        throw new Error(errorSummary);
    }
    throw new Error("No feeds could be fetched");
}

async function runImageScraper(articles) {
    const articlesToScrape = articles.filter(a => a.needsScraping || a.imageUrl.includes('placehold.co'));
    if (articlesToScrape.length === 0) return articles;
    const BATCH_SIZE = 5;
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
        if (i + BATCH_SIZE < articlesToScrape.length) await new Promise(resolve => setTimeout(resolve, 300));
    }
    return Array.from(updatedArticlesMap.values());
}

// --- Main Execution ---

async function main() {
    let feedsToFetch = [];
    try {
        console.log("Attempting to fetch feeds from database...");
        const { rows: feedsFromDb } = await sql`SELECT * FROM feeds;`;
        if (feedsFromDb && feedsFromDb.length > 0) {
            console.log(`Found ${feedsFromDb.length} feeds in database`);
            feedsToFetch = feedsFromDb;
        } else {
            console.log("No feeds found in the database. Falling back to initial feeds list.");
            feedsToFetch = INITIAL_FEEDS;
        }
    } catch (dbError) {
        console.warn(`Could not connect to database: ${dbError.message}. Falling back to initial feeds list.`);
        feedsToFetch = INITIAL_FEEDS;
    }

    try {
        if (feedsToFetch.length === 0) throw new Error("No feeds are configured to be fetched.");

        const articles = await fetchArticlesFromFeeds(feedsToFetch);
        const articlesWithImages = await runImageScraper(articles);
        const finalArticles = processArticles(articlesWithImages);

        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        // Correct path: saves the file inside the project's root, overwriting the fallback.
        const cacheFilePath = path.join(__dirname, '..', 'news-cache.json');

        await fs.writeFile(cacheFilePath, JSON.stringify(finalArticles, null, 2));
        console.log(`Saved to ${cacheFilePath}`);

    } catch (error) {
        console.error("Failed to update feeds cache:", error);
        process.exit(1); // Exit with an error code to fail the GitHub Action step
    }
}

main();