// scripts/fetch-feeds.js
// Fetches RSS feeds and saves to public/news-cache.json
// WITH image optimization and scraping support

import { sql } from '@vercel/postgres';
import fs from 'fs';
import path from 'path';
import { parseHTML } from 'linkedom';

// === IMAGE SCRAPING ===
async function getOgImageFromUrl(url) {
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

// === EXTRACT IMAGE FROM FEED ITEM ===
function extractImageUrl(itemXml, feed, articleLink) {
    let imageUrl = null;

    // 1. Try media:content (used by many feeds)
    const mediaContentMatch = itemXml.match(/<(?:media:)?content[^>]+url=["']([^"']+)["'][^>]*medium=["']image["']/i) ||
        itemXml.match(/<(?:media:)?content[^>]+medium=["']image["'][^>]*url=["']([^"']+)["']/i);
    if (mediaContentMatch) {
        imageUrl = mediaContentMatch[1];
    }

    // 2. Try media:thumbnail
    if (!imageUrl) {
        const mediaThumbnailMatch = itemXml.match(/<(?:media:)?thumbnail[^>]+url=["']([^"']+)["']/i);
        if (mediaThumbnailMatch) {
            imageUrl = mediaThumbnailMatch[1];
        }
    }

    // 3. Try enclosure (accept any, not just image type)
    if (!imageUrl) {
        const enclosureMatch = itemXml.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
        if (enclosureMatch) {
            imageUrl = enclosureMatch[1];
        }
    }

    // 4. Parse HTML content for images
    if (!imageUrl) {
        const descMatch = itemXml.match(/<(?:description|summary|content)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary|content)>/is);
        if (descMatch) {
            let content = descMatch[1];

            // Decode HTML entities
            content = content
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#39;/g, "'");

            const imgMatches = content.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);

            for (const imgMatch of imgMatches) {
                const src = imgMatch[1];

                // Skip tracking pixels
                if (src.includes('cpx.golem.de') ||
                    src.includes('1x1') ||
                    src.includes('pixel') ||
                    src.includes('count.php') ||
                    src.includes('tracking')) {
                    continue;
                }

                // Check dimensions
                const widthMatch = imgMatch[0].match(/width=["']?(\d+)/i);
                const heightMatch = imgMatch[0].match(/height=["']?(\d+)/i);
                const width = widthMatch ? parseInt(widthMatch[1]) : 0;
                const height = heightMatch ? parseInt(heightMatch[1]) : 0;

                // Skip 1x1 tracking pixels
                if ((width === 1 && height === 1) || (width <= 1 || height <= 1)) {
                    continue;
                }

                imageUrl = src;
                break;
            }
        }
    }

    if (!imageUrl) {
        return null;
    }

    // === IMAGE URL OPTIMIZATION ===
    try {
        let processedUrl = new URL(imageUrl, articleLink).href;
        const urlObject = new URL(processedUrl);

        // GameSpot: Use 'original' quality
        if (urlObject.hostname.includes('gamespot.com')) {
            processedUrl = processedUrl.replace(/\/uploads\/[^\/]+\//, '/uploads/original/');
        }
        // GameStar, GamePro: Use /800/ resolution
        else if (urlObject.hostname.includes('cgames.de') || feed.name.includes('GameStar') || feed.name.includes('GamePro')) {
            processedUrl = processedUrl.replace(/\/(\d{2,4})\//, '/800/');
        }
        // GamesWirtschaft: Remove size suffix
        else if (feed.name.includes('GamesWirtschaft')) {
            processedUrl = processedUrl.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|gif|webp)$)/i, '');
        }
        // Nintendo Life: Use 'large' instead of 'small'
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

        return processedUrl;
    } catch (e) {
        return imageUrl;
    }
}

// === PARSE RSS/ATOM FEED ===
function parseRssXml(xmlString, feed) {
    const articles = [];
    const isAtom = xmlString.includes('<feed');
    const itemPattern = isAtom ? /<entry[^>]*>([\s\S]*?)<\/entry>/gi : /<item[^>]*>([\s\S]*?)<\/item>/gi;
    const matches = xmlString.matchAll(itemPattern);

    for (const match of matches) {
        const itemXml = match[1];

        const title = itemXml.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/is)?.[1]?.trim();
        const link = isAtom
            ? itemXml.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1]
            : itemXml.match(/<link[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/is)?.[1]?.trim();
        const pubDate = isAtom
            ? itemXml.match(/<(?:published|updated)[^>]*>([^<]+)<\/(?:published|updated)>/i)?.[1]
            : itemXml.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/i)?.[1];

        if (!title || !link || !pubDate) continue;

        const desc = itemXml.match(/<(?:description|summary)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary)>/is)?.[1]?.trim() || '';
        const summary = desc.replace(/<[^>]+>/g, '').substring(0, 150);

        // Extract image
        const imageUrl = extractImageUrl(itemXml, feed, link);

        articles.push({
            id: link,
            title,
            source: feed.name,
            publicationDate: new Date(pubDate).toISOString(),
            summary,
            link,
            imageUrl: imageUrl || null,
            needsScraping: !imageUrl && feed.needs_scraping,
            language: feed.language
        });
    }

    return articles;
}

// === MAIN FETCH FUNCTION ===
async function fetchArticles() {
    try {
        // Get feeds from database
        const { rows: feeds } = await sql`SELECT * FROM feeds;`;
        console.log(`\n🔍 Found ${feeds.length} feeds in database\n`);

        let articles = [];

        // STEP 1: Fetch all feeds
        for (const feed of feeds) {
            try {
                console.log(`📡 Fetching: ${feed.name}...`);

                const response = await fetch(feed.url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/rss+xml, application/xml'
                    },
                    signal: AbortSignal.timeout(10000)
                });

                if (!response.ok) {
                    console.warn(`   ❌ Failed: ${feed.name} (${response.status})`);
                    continue;
                }

                const xmlString = await response.text();
                const feedArticles = parseRssXml(xmlString, feed);
                articles.push(...feedArticles);
                console.log(`   ✅ ${feed.name}: ${feedArticles.length} articles`);

                await new Promise(r => setTimeout(r, 200));

            } catch (error) {
                console.error(`   ❌ Error: ${feed.name} - ${error.message}`);
            }
        }

        console.log(`\n📰 Total articles fetched: ${articles.length}`);

        // STEP 2: Scrape missing images
        const articlesNeedingScraping = articles.filter(a => a.needsScraping);
        if (articlesNeedingScraping.length > 0) {
            console.log(`\n🔎 Scraping images for ${articlesNeedingScraping.length} articles...\n`);

            for (const article of articlesNeedingScraping) {
                try {
                    console.log(`   🖼️  Scraping: ${article.source} - ${article.title.substring(0, 40)}...`);
                    const scrapedImage = await getOgImageFromUrl(article.link);

                    if (scrapedImage) {
                        article.imageUrl = scrapedImage;
                        article.needsScraping = false;
                        console.log(`      ✅ Found image`);
                    } else {
                        console.log(`      ⚠️  No image found, using placeholder`);
                    }

                    await new Promise(r => setTimeout(r, 500));
                } catch (error) {
                    console.error(`      ❌ Scraping failed: ${error.message}`);
                }
            }
        }

        // STEP 3: Add placeholders for articles still without images
        articles = articles.map(article => {
            if (!article.imageUrl) {
                article.imageUrl = `https://placehold.co/600x400/374151/d1d5db?text=${encodeURIComponent(article.source.substring(0, 30))}`;
            }
            delete article.needsScraping;
            return article;
        });

        // STEP 4: Deduplicate and sort
        const uniqueArticles = new Map();
        articles.forEach(a => {
            if (!uniqueArticles.has(a.id)) {
                uniqueArticles.set(a.id, a);
            }
        });

        const sortedArticles = Array.from(uniqueArticles.values())
            .sort((a, b) => new Date(b.publicationDate) - new Date(a.publicationDate));

        // STEP 5: Save to cache
        const cacheDir = path.join(process.cwd(), 'public');
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        const cachePath = path.join(cacheDir, 'news-cache.json');
        fs.writeFileSync(cachePath, JSON.stringify(sortedArticles, null, 2));

        console.log(`\n✅ Saved ${sortedArticles.length} articles to ${cachePath}\n`);

    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    }
}

fetchArticles();