// scripts/fetch-feeds.js
// Fetches RSS feeds and saves to public/news-cache.json
// WITH image optimization and scraping support

import { sql } from '@vercel/postgres';
import fs from 'fs';
import path from 'path';
import { parseHTML } from 'linkedom';

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// --- Helper Functions ---

function stripHtmlAndTruncate(html, length = 150) {
    if (!html) return '';
    try {
        const { document } = parseHTML(`<body>${html}</body>`);
        // Remove known "read more" links
        document.querySelectorAll('a').forEach(a => {
            if (a.textContent.toLowerCase().includes('read more')) {
                a.parentElement.remove();
            }
        });
        const text = document.body.textContent.replace(/\s\s+/g, ' ').trim();
        if (text.length > length) {
            const truncated = text.substring(0, length);
            const lastSpace = truncated.lastIndexOf(' ');
            return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + '...';
        }
        return text;
    } catch (e) {
        return '';
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
        'enclosure', // Some feeds don't specify type
    ];

    for (const selector of selectors) {
        const element = itemElement.querySelector(selector);
        if (element) {
            imageUrl = element.getAttribute('url') || element.getAttribute('href');
            if (imageUrl) break;
        }
    }

    if (!imageUrl) {
        const contentSelectors = ['content\\:encoded', 'description', 'summary', 'content'];
        for (const selector of contentSelectors) {
            const contentNode = itemElement.querySelector(selector);
            if (contentNode && contentNode.textContent) {
                try {
                    const { document: contentDoc } = parseHTML(contentNode.textContent);
                    const images = Array.from(contentDoc.querySelectorAll('img'));
                    const bestImage = images.find(img => {
                        const src = img.getAttribute('src');
                        if (!src || src.includes('cpx.golem.de') || src.includes('feeds.feedburner.com')) return false; // Filter Golem tracking & feedburner

                        // Check for webp source as well
                        const parent = img.parentElement;
                        if (parent && parent.tagName === 'PICTURE') {
                            const webpSource = parent.querySelector('source[type="image/webp"]');
                            if (webpSource && webpSource.getAttribute('srcset')) {
                                imageUrl = webpSource.getAttribute('srcset').split(' ')[0]; // Take first url from srcset
                                return true;
                            }
                        }

                        const width = parseInt(img.getAttribute('width') || '0', 10);
                        const height = parseInt(img.getAttribute('height') || '0', 10);
                        if (width <= 10 || height <= 10) return false;

                        imageUrl = src;
                        return true;
                    });
                    if (bestImage) break;
                } catch (e) {
                    // ignore parsing errors
                }
            }
        }
    }

    if (!imageUrl) return null;

    // URL Post-processing
    try {
        let processedUrl = new URL(imageUrl, articleLink).href;
        const urlObject = new URL(processedUrl);

        if (urlObject.hostname.includes('gamespot.com')) {
            processedUrl = processedUrl.replace(/\/uploads\/[^\/]+\//, '/uploads/original/');
        } else if (urlObject.hostname.includes('cgames.de') || feed.name.includes('GameStar') || feed.name.includes('GamePro') || urlObject.hostname.includes('pcgames.de')) {
            if (processedUrl.match(/\/(\d{2,4})\//)) { // only replace if a dimension is in the path
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
        // if URL processing fails, return the original found URL.
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
            headers: { 'User-Agent': BROWSER_USER_AGENT, 'Accept': 'application/rss+xml, application/xml, application/atom+xml' },
            signal: AbortSignal.timeout(8000)
        });
        if (response.ok) xmlString = await response.text();
    } catch (e) { /* ignore and try proxies */ }

    // Try proxies if direct fetch failed
    if (!xmlString) {
        for (const proxyUrl of proxies) {
            try {
                const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
                if (response.ok) {
                    xmlString = await response.text();
                    break; // Success
                }
            } catch (error) {
                lastError = error.message;
            }
        }
    }

    if (!xmlString) {
        console.warn(`   ❌ Failed: ${feed.name}. Last error: ${lastError || 'Unknown fetch error'}`);
        return [];
    }

    const articles = [];
    try {
        const { document } = parseHTML(xmlString);
        const isAtom = !!document.querySelector('feed');
        const items = document.querySelectorAll(isAtom ? 'entry' : 'item');

        for (const item of items) {
            const title = (item.querySelector('title')?.textContent || '').trim();
            const linkNode = item.querySelector('link');
            const link = isAtom ? linkNode?.getAttribute('href') : linkNode?.textContent;
            const pubDate = item.querySelector(isAtom ? 'published, updated' : 'pubDate')?.textContent;

            if (!title || !link || !pubDate) continue;

            const summaryContent = item.querySelector('description, summary, content, content\\:encoded')?.textContent || '';

            articles.push({
                id: (item.querySelector('guid, id')?.textContent || link).trim(),
                title,
                source: feed.name,
                publicationDate: new Date(pubDate).toISOString(),
                summary: stripHtmlAndTruncate(summaryContent),
                link: link.trim(),
                imageUrl: extractImageUrlFromDOM(item, feed, link.trim()),
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


async function fetchArticles() {
    try {
        const { rows: feeds } = await sql`SELECT * FROM feeds ORDER BY priority, name;`;
        console.log(`\n🔍 Found ${feeds.length} feeds in database\n`);
        let allArticles = [];

        // Process feeds sequentially to be gentle on APIs
        for (const feed of feeds) {
            const feedArticles = await fetchAndProcessFeed(feed);
            allArticles.push(...feedArticles);
            await new Promise(r => setTimeout(r, 200)); // Small delay
        }

        console.log(`\n📰 Total articles fetched: ${allArticles.length}`);

        // Scrape missing images
        const articlesToScrape = allArticles.filter(a => a.needsScraping && !a.imageUrl);
        if (articlesToScrape.length > 0) {
            console.log(`\n🔎 Scraping images for ${articlesToScrape.length} articles...\n`);
            for (const article of articlesToScrape) {
                console.log(`   🖼️  Scraping: ${article.source} - ${article.title.substring(0, 40)}...`);
                article.imageUrl = await getOgImageFromUrl(article.link);
                console.log(article.imageUrl ? `      ✅ Found image` : `      ⚠️  No image found`);
                await new Promise(r => setTimeout(r, 500));
            }
        }

        // Add placeholders and clean up
        allArticles.forEach(article => {
            if (!article.imageUrl) {
                article.imageUrl = `https://placehold.co/600x400/374151/d1d5db?text=${encodeURIComponent(article.source.substring(0, 30))}`;
            }
            delete article.needsScraping;
        });

        // Deduplicate and sort
        const uniqueArticles = Array.from(new Map(allArticles.map(a => [a.id, a])).values());
        const sortedArticles = uniqueArticles.sort((a, b) => new Date(b.publicationDate) - new Date(a.publicationDate));

        // --- SAFETY CHECK ---
        // Prevents overwriting the cache with a bad fetch (e.g., due to proxy failures).
        // If we get fewer than this many articles, something is likely wrong.
        const MINIMUM_ARTICLES = 150;
        if (sortedArticles.length < MINIMUM_ARTICLES) {
            console.error(`\n❌ SAFETY CHECK FAILED: Fetched only ${sortedArticles.length} articles, which is below the threshold of ${MINIMUM_ARTICLES}.`);
            console.error('Aborting to prevent overwriting the cache with incomplete data.');
            process.exit(1); // Exit with a non-zero code to fail the GitHub Action.
        }

        // Save to cache
        const cacheDir = path.join(process.cwd(), 'public');
        if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

        fs.writeFileSync(path.join(cacheDir, 'news-cache.json'), JSON.stringify(sortedArticles, null, 2));
        console.log(`\n✅ Saved ${sortedArticles.length} unique articles to cache.\n`);
    } catch (error) {
        console.error('\n❌ Fatal error during feed fetch:', error);
        process.exit(1);
    }
}

fetchArticles();