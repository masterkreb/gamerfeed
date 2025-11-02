// scripts/fetch-feeds.js
// Fetches RSS feeds and saves to public/news-cache.json
// WITH image optimization and scraping support

import { sql } from '@vercel/postgres';
import fs from 'fs';
import path from 'path';
import { parseHTML } from 'linkedom';

// DOMParser is standard and available in the Node.js version used by the GitHub Action.
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// --- Helper Functions ---

/**
 * A robust function to clean raw text from RSS feeds. It handles:
 * 1. Using a DOM parser to correctly decode all HTML entities (e.g., &#8220; -> “).
 * 2. Stripping any remaining HTML tags.
 * 3. Truncating the text to a specified length.
 * 4. Normalizing whitespace.
 */
function stripHtmlAndTruncate(html, length = 200) {
    if (!html) return '';
    try {
        // Use linkedom's HTML parser to decode entities and strip tags.
        // It's effective even for XML content snippets.
        const { document } = parseHTML(`<body><div>${html}</div></body>`);
        const contentDiv = document.querySelector('div');

        if (contentDiv) {
            // Remove "read more" links before getting text content
            contentDiv.querySelectorAll('a').forEach(a => {
                if ((a.textContent || '').toLowerCase().includes('read more')) {
                    a.remove();
                }
            });
            // Get the clean text content and normalize whitespace.
            let text = contentDiv.textContent.replace(/\s+/g, ' ').trim();
            // Remove artifacts like trailing "[...]"
            text = text.replace(/\[\s*\.\.\.\s*\]$/, '').trim();
            // Truncate if necessary.
            if (length > 0 && text.length > length) {
                const truncated = text.substring(0, length);
                const lastSpace = truncated.lastIndexOf(' ');
                return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + '...';
            }
            return text;
        }
        return '';
    } catch (e) {
        console.warn('Error during text cleaning:', e);
        // Fallback for safety
        return (html.replace(/<[^>]+>/g, '').trim()).substring(0, length > 0 ? length : 500);
    }
}


async function getOgImageFromUrl(url) {
    const proxies = [
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    ];

    for (const proxyUrl of proxies) {
        try {
            const response = await fetch(proxyUrl, {
                signal: AbortSignal.timeout(8000),
                headers: { 'User-Agent': BROWSER_USER_AGENT }
            });
            if (!response.ok) continue;

            const html = await response.text();
            const { document: doc } = parseHTML(html);

            const ogImageMeta =
                doc.querySelector('meta[property="og:image"]') ||
                doc.querySelector('meta[property="og:image:url"]') ||
                doc.querySelector('meta[name="twitter:image"]');

            if (ogImageMeta) {
                const imageUrl = ogImageMeta.getAttribute('content');
                if (imageUrl) {
                    try {
                        return new URL(imageUrl, url).href;
                    } catch {
                        return imageUrl;
                    }
                }
            }
        } catch (e) {
            // Try next proxy
        }
    }
    return null;
}

function extractImageUrlFromDOM(itemElement, feed, articleLink) {
    let imageUrl = null;

    const selectors = [
        'media\\:content[medium="image"]',
        'media\\:thumbnail',
        'enclosure[type^="image/"]',
    ];

    for (const selector of selectors) {
        const element = itemElement.querySelector(selector);
        if (element) {
            imageUrl = element.getAttribute('url') || element.getAttribute('href');
            if (imageUrl) break;
        }
    }

    if (!imageUrl) {
        const contentSelectors = ['content\\:encoded', 'description', 'summary'];
        for (const selector of contentSelectors) {
            const contentNode = itemElement.querySelector(selector);
            if (contentNode && contentNode.textContent) {
                try {
                    const { document: contentDoc } = parseHTML(`<body>${contentNode.textContent}</body>`);
                    const img = contentDoc.querySelector('img');
                    if (img && img.src && !img.src.includes('feedburner')) {
                        imageUrl = img.src;
                        break;
                    }
                } catch (e) {
                    // ignore parsing errors
                }
            }
        }
    }

    if (!imageUrl) return null;

    try {
        let processedUrl = new URL(imageUrl, articleLink).href;
        const urlObject = new URL(processedUrl);

        if (urlObject.hostname.includes('gamespot.com')) {
            processedUrl = processedUrl.replace(/\/uploads\/[^\/]+\//, '/uploads/original/');
        } else if (urlObject.hostname.includes('cgames.de') || feed.name.includes('GameStar') || feed.name.includes('GamePro') || urlObject.hostname.includes('pcgames.de')) {
            if (processedUrl.match(/\/(\d{2,4})\//)) {
                processedUrl = processedUrl.replace(/\/(\d{2,4})\//, '/800/');
            }
        } else if (feed.name.includes('GamesWirtschaft')) {
            processedUrl = processedUrl.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|gif|webp)$)/i, '');
        } else if (urlObject.hostname.includes('nintendolife.com')) {
            processedUrl = processedUrl.replace('small.jpg', 'large.jpg');
        } else if (urlObject.hostname.includes('giantbomb.com')) {
            processedUrl = processedUrl.replace(/(\/scale_small\/|\/scale_medium\/|\/scale_large\/|\/scale_super\/)/, '/original/');
        }
        return processedUrl;
    } catch (e) {
        return imageUrl;
    }
}


async function fetchAndProcessFeed(feed) {
    console.log(`📡 Fetching: ${feed.name}...`);
    const proxies = [
        `https://corsproxy.io/?${encodeURIComponent(feed.url)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(feed.url)}`,
    ];
    let xmlString = null;
    let lastError = null;

    // Try direct fetch first
    try {
        const response = await fetch(feed.url, {
            headers: { 'User-Agent': BROWSER_USER_AGENT, 'Accept': 'application/rss+xml, application/xml, text/xml' },
            signal: AbortSignal.timeout(8000)
        });
        if (response.ok) {
            xmlString = await response.text();
        }
    } catch (e) { /* ignore and try proxies */ }

    if (!xmlString) {
        for (const proxyUrl of proxies) {
            try {
                const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
                if (response.ok) {
                    xmlString = await response.text();
                    if (xmlString) break;
                }
            } catch (error) {
                lastError = error.message;
            }
        }
    }

    if (!xmlString || !xmlString.trim().startsWith('<')) {
        console.warn(`   ❌ Failed: ${feed.name}. Last error: ${lastError || 'Invalid content received'}`);
        return [];
    }

    const articles = [];
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlString, "application/xml");

        const errorNode = doc.querySelector("parsererror");
        if (errorNode) {
            throw new Error(`XML Parsing Error for ${feed.name}: ${errorNode.textContent}`);
        }

        const isAtom = !!doc.querySelector('feed');
        const items = doc.querySelectorAll(isAtom ? 'entry' : 'item');

        for (const item of items) {
            const rawTitle = item.querySelector('title')?.innerHTML || '';
            const linkNode = item.querySelector('link');
            const link = (isAtom ? (Array.from(item.querySelectorAll('link')).find(l => l.getAttribute('rel') === 'alternate' || !l.getAttribute('rel'))?.getAttribute('href')) : linkNode?.textContent)?.trim();
            const pubDate = (item.querySelector(isAtom ? 'published, updated' : 'pubDate')?.textContent)?.trim();

            const title = stripHtmlAndTruncate(rawTitle, 0); // 0 means don't truncate

            if (!title || !link || !pubDate) continue;

            const rawSummary = item.querySelector('description, summary, content\\:encoded')?.innerHTML || '';
            const summary = stripHtmlAndTruncate(rawSummary, 200);

            articles.push({
                id: (item.querySelector('guid, id')?.textContent || link).trim(),
                title,
                source: feed.name,
                publicationDate: new Date(pubDate).toISOString(),
                summary: summary,
                link: link,
                imageUrl: extractImageUrlFromDOM(item, feed, link),
                needsScraping: feed.needs_scraping,
                language: feed.language
            });
        }
        console.log(`   ✅ ${feed.name}: ${articles.length} articles`);
        return articles;
    } catch (error) {
        console.error(`   ❌ Error parsing ${feed.name}: ${error.message}`);
        return [];
    }
}


async function main() {
    try {
        const { rows: feeds } = await sql`SELECT * FROM feeds ORDER BY priority, name;`;
        console.log(`\n🔍 Found ${feeds.length} feeds in database\n`);
        let allArticles = [];

        const feedPromises = feeds.map(feed => fetchAndProcessFeed(feed));
        const results = await Promise.all(feedPromises);
        results.forEach(feedArticles => allArticles.push(...feedArticles));

        console.log(`\n📰 Total articles fetched: ${allArticles.length}`);

        const articlesToScrape = allArticles.filter(a => a.needsScraping && !a.imageUrl);
        if (articlesToScrape.length > 0) {
            console.log(`\n🔎 Scraping images for ${articlesToScrape.length} articles...\n`);
            for (const article of articlesToScrape) {
                console.log(`   🖼️  Scraping: ${article.source} - ${article.title.substring(0, 40)}...`);
                article.imageUrl = await getOgImageFromUrl(article.link);
                console.log(article.imageUrl ? `      ✅ Found image` : `      ⚠️  No image found`);
                await new Promise(r => setTimeout(r, 300));
            }
        }

        allArticles.forEach(article => {
            if (!article.imageUrl) {
                article.imageUrl = `https://placehold.co/600x400/374151/d1d5db?text=${encodeURIComponent(article.source.substring(0, 30))}`;
            }
            delete article.needsScraping;
        });

        const uniqueArticles = Array.from(new Map(allArticles.map(a => [a.id, a])).values());
        const sortedArticles = uniqueArticles.sort((a, b) => new Date(b.publicationDate) - new Date(a.publicationDate));

        // Lowered threshold to avoid blocking updates if some feeds are down.
        const MINIMUM_ARTICLES = 50;
        if (sortedArticles.length < MINIMUM_ARTICLES) {
            console.error(`\n❌ SAFETY CHECK FAILED: Fetched only ${sortedArticles.length} articles, which is below the threshold of ${MINIMUM_ARTICLES}.`);
            console.error('Aborting to prevent overwriting the cache with incomplete data.');
            process.exit(1);
        }

        const cacheDir = path.join(process.cwd(), 'public');
        if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

        fs.writeFileSync(path.join(cacheDir, 'news-cache.json'), JSON.stringify(sortedArticles, null, 2));
        console.log(`\n✅ Saved ${sortedArticles.length} unique articles to cache.\n`);
    } catch (error) {
        console.error('\n❌ Fatal error during feed fetch:', error);
        process.exit(1);
    }
}

main();
