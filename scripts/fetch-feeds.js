// scripts/fetch-feeds.js
// Fetches RSS feeds and saves to public/news-cache.json
// WITH image optimization and scraping support
import 'dotenv/config'; // Load environment variables from .env file
import { sql } from '@vercel/postgres';
import fs from 'fs';
import path from 'path';
import { DOMParser } from 'linkedom'; // Provides DOMParser in Node.js environment

// === HTML ENTITY DECODING ===
function decodeHtmlEntities(text) {
    if (!text) return text;

    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&apos;': "'",
        '&nbsp;': ' ',
        '&rsquo;': "'",
        '&lsquo;': "'",
        '&rdquo;': '"',
        '&ldquo;': '"',
        '&ndash;': '–',
        '&mdash;': '—',
        // Deutsche Umlaute
        '&auml;': 'ä',
        '&ouml;': 'ö',
        '&uuml;': 'ü',
        '&Auml;': 'Ä',
        '&Ouml;': 'Ö',
        '&Uuml;': 'Ü',
        '&szlig;': 'ß',
    };

    let decoded = text;

    // CDATA-Marker entfernen (beide)
    decoded = decoded.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');

    for (const [entity, char] of Object.entries(entities)) {
        decoded = decoded.replaceAll(entity, char);
    }

    decoded = decoded.replace(/&#(\d+);/g, (match, dec) =>
        String.fromCharCode(parseInt(dec, 10))
    );

    decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (match, hex) =>
        String.fromCharCode(parseInt(hex, 16))
    );

    return decoded;
}

// === ENHANCED SUMMARY STRIPPING AND TRUNCATION ===
function stripHtmlAndTruncate(html, length = 150) {
    if (!html) return '';

    try {
        let text = decodeHtmlEntities(html);

        // Remove common boilerplate text like "[...]", "Der Beitrag...", or "Weiterlesen..." BEFORE stripping tags
        text = text.replace(/(\s*\[…\]\s*(Der Beitrag|Weiterlesen|Read more).*)/gi, '');

        // Now, strip tags
        text = text
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, '');

        // Normalize whitespace and remove any remaining or source-provided ellipses
        const stripped = text.replace(/\s+/g, ' ').replace(/\s*\.{3,}\s*$/, '').trim();

        if (stripped.length > length) {
            const truncated = stripped.substring(0, length);
            const lastSpace = truncated.lastIndexOf(' ');
            return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + '...';
        }
        return stripped;
    } catch (e) {
        console.warn('Error stripping HTML:', e);
        // Fallback for safety
        const basicStripped = (html.replace(/<[^>]+>/g, '') || '').substring(0, length);
        return basicStripped + (basicStripped.length === length ? '...' : '');
    }
}


// === IMAGE SCRAPING ===
async function getOgImageFromUrl(url, sourceName) {
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

            let imageUrl = ogImageMeta ? ogImageMeta.getAttribute('content') : null;

            // Rule for PlayStationInfo: if og:image is a WP emoji, discard and look for alternatives.
            if (sourceName === 'PlayStationInfo' && imageUrl && imageUrl.includes('s.w.org/images/core/emoji')) {
                imageUrl = null;
            }

            if (imageUrl) {
                try {
                    return new URL(imageUrl, url).href;
                } catch {
                    return imageUrl;
                }
            }

            // Fallback: If no valid og:image, look for YouTube iframe in body
            const youtubeIframe = doc.querySelector('iframe[src*="youtube.com/embed/"]');
            if (youtubeIframe) {
                const src = youtubeIframe.getAttribute('src');
                if (src) {
                    const videoIdMatch = src.match(/embed\/([^/?]+)/);
                    if (videoIdMatch && videoIdMatch[1]) {
                        return `https://img.youtube.com/vi/${videoIdMatch[1]}/hqdefault.jpg`;
                    }
                }
            }

            // Fallback 2: look for youtube link in `<a>` tag
            const youtubeLink = doc.querySelector('a[href*="youtube.com/watch"]');
            if (youtubeLink) {
                const href = youtubeLink.getAttribute('href');
                if (href) {
                    const videoIdMatch = href.match(/[?&]v=([^&]+)/);
                    if (videoIdMatch && videoIdMatch[1]) {
                        return `https://img.youtube.com/vi/${videoIdMatch[1]}/hqdefault.jpg`;
                    }
                }
            }
        } catch (e) {
            // Try next proxy
            console.warn(`Scraping error for ${url} via proxy:`, e.message);
        }
    }
    return null;
}

// === PARSE RSS/ATOM FEED ===
function parseRssXml(xmlString, feed) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");
    const errorNode = doc.querySelector("parsererror");
    if (errorNode) {
        console.error(`XML Parsing Error for ${feed.url}:`, errorNode.textContent);
        throw new Error(`Failed to parse XML for feed: ${feed.url}`);
    }

    const articles = [];
    const isAtom = doc.documentElement.nodeName === 'feed';
    const itemNodes = doc.querySelectorAll(isAtom ? "entry" : "item");

    itemNodes.forEach(node => {
        const getText = (selector) => node.querySelector(selector)?.textContent?.trim() || '';

        let link = '';
        if (isAtom) {
            const linkNode = Array.from(node.querySelectorAll('link')).find(l => l.getAttribute('rel') === 'alternate') || node.querySelector('link');
            link = linkNode?.getAttribute('href') || '';
        } else {
            link = getText('link');
        }

        const title = decodeHtmlEntities(getText('title'));
        const pubDate = getText(isAtom ? 'published' : 'pubDate') || getText('updated');

        if (!title || !link || !pubDate) return;

        const description = node.querySelector('description')?.textContent || node.querySelector('summary')?.textContent || '';
        const summary = stripHtmlAndTruncate(description);


        // --- More robust Image and Content Extraction ---
        let imageUrl = null;
        const isEmojiUrl = (url) => url && url.includes('s.w.org/images/core/emoji');

        // 1. Enclosure
        const enclosure = node.querySelector('enclosure[type^="image"]');
        if (enclosure) {
            const enclosureUrl = enclosure.getAttribute('url');
            if (enclosureUrl && !isEmojiUrl(enclosureUrl)) {
                imageUrl = enclosureUrl;
            }
        }

        // 2. media:content (iterating children to avoid namespace issues)
        if (!imageUrl) {
            const children = node.children;
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                if (child.tagName.toLowerCase() === 'media:content') {
                    const type = child.getAttribute('type');
                    const medium = child.getAttribute('medium');
                    if (medium === 'image' || (type && type.startsWith('image/'))) {
                        const url = child.getAttribute('url');
                        if (url && !isEmojiUrl(url)) {
                            imageUrl = url;
                            break; // Found it, stop searching
                        }
                    }
                }
            }
        }


        // 3. media:thumbnail (using getElementsByTagName)
        if (!imageUrl) {
            const mediaThumbnail = node.getElementsByTagName('media:thumbnail')[0];
            if (mediaThumbnail) {
                const thumbnailUrl = mediaThumbnail.getAttribute('url');
                if (thumbnailUrl && !isEmojiUrl(thumbnailUrl)) {
                    imageUrl = thumbnailUrl;
                }
            }
        }

        // 4. thumbnail[url]
        if (!imageUrl) {
            const thumbnail = node.querySelector('thumbnail[url]');
            if (thumbnail) {
                const thumbUrl = thumbnail.getAttribute('url');
                if (thumbUrl && !isEmojiUrl(thumbUrl)) {
                    imageUrl = thumbUrl;
                }
            }
        }

        // 5. Fallback to parsing content
        if (!imageUrl) {
            let contentText = '';
            const contentEncodedNode = node.getElementsByTagName('content:encoded')[0];
            if (contentEncodedNode) {
                contentText = contentEncodedNode.textContent || '';
            } else {
                contentText = node.querySelector('content')?.textContent || description;
            }

            if (contentText) {
                try {
                    const contentDoc = new DOMParser().parseFromString(contentText, 'text/html');
                    const images = Array.from(contentDoc.querySelectorAll('img'));
                    let bestImg = null;
                    let youtubeFallback = null;

                    for (const img of images) {
                        const src = img.getAttribute('data-src') || img.src;

                        if (
                            !src ||
                            src.startsWith('data:') ||
                            src.includes('s.w.org/images/core/emoji') ||
                            src.includes('placeholder.svg') ||
                            src.includes('cpx.golem.de') ||
                            src.includes('feedburner.com') ||
                            src.includes('feedsportal.com') ||
                            src.includes('gravatar.com')
                        ) {
                            continue;
                        }

                        const width = img.getAttribute('width');
                        const height = img.getAttribute('height');
                        if (width === '1' || height === '1') {
                            continue; // Skip 1-pixel trackers
                        }

                        const isYouTube = src.includes('ytimg.com');

                        if (isYouTube) {
                            if (!youtubeFallback) youtubeFallback = src;
                        } else {
                            if (!bestImg) bestImg = src;
                        }
                    }

                    if (feed.name === 'PlayStation.Blog') {
                        // For PS Blog, if we find a YT thumbnail, we take it.
                        // If not, we force scraping by not assigning any image, even if 'bestImg' exists.
                        if (youtubeFallback) {
                            imageUrl = youtubeFallback;
                        }
                    } else {
                        // For all other feeds, use the existing logic.
                        if (bestImg) {
                            imageUrl = bestImg;
                        } else if (youtubeFallback) {
                            imageUrl = youtubeFallback;
                        }
                    }

                } catch(e) { /* ignore HTML parsing errors inside XML content */ }
            }
        }

        let finalImageUrl = null;
        if (imageUrl) {
            try {
                // Start with a valid, absolute URL
                let processedUrl = new URL(imageUrl, link).href;

                // Source-specific optimizations
                const hostname = new URL(processedUrl).hostname;
                const feedName = feed.name;

                // PC Games, GameZone, Video Games Zone use URL params for resolution.
                if (['PC Games', 'GameZone', 'Video Games Zone'].includes(feedName)) {
                    try {
                        const url = new URL(processedUrl);
                        url.searchParams.delete('w');
                        url.searchParams.delete('h');
                        processedUrl = url.toString();
                    } catch (e) {
                        console.warn(`Could not parse image URL for optimization: ${processedUrl}`);
                    }
                }
                // GameStar uses a path segment for resolution.
                else if (feedName === 'GameStar' && hostname.includes('cgames.de')) {
                    processedUrl = processedUrl.replace(/(images\/gamestar\/)(\d+)(\/.*)/i, '$11200$3');
                }
                // GamePro uses a different path segment ('gsgp') for resolution.
                else if (feedName === 'GamePro' && hostname.includes('cgames.de')) {
                    processedUrl = processedUrl.replace(/(images\/gsgp\/)(\d+)(\/.*)/i, '$11200$3');
                }
                // GamesWirtschaft (WordPress standard)
                else if (feedName === 'GamesWirtschaft') {
                    processedUrl = processedUrl.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|webp)$)/i, '');
                }
                // Nintendo Life
                else if (hostname.includes('nintendolife.com')) {
                    processedUrl = processedUrl.replace('small.jpg', 'large.jpg');
                }
                // IMPORTANT: No specific rule for GameSpot to fix regressions. It will pass through unmodified.

                finalImageUrl = processedUrl;

            } catch (e) {
                // If URL processing fails, fall back to the original URL and try to make it absolute
                try {
                    finalImageUrl = new URL(imageUrl, link).href;
                } catch {
                    finalImageUrl = imageUrl;
                }
                console.warn(`Could not process image URL '${imageUrl}': ${e.message}`);
            }
        }


        articles.push({
            id: getText('guid') || link,
            title,
            source: feed.name,
            publicationDate: new Date(pubDate).toISOString(),
            summary,
            link,
            imageUrl: finalImageUrl || null,
            needsScraping: !finalImageUrl && feed.needs_scraping,
            language: feed.language
        });
    });

    return articles;
}

// === MAIN FETCH FUNCTION ===
async function fetchArticles() {
    const feedHealthStatus = {}; // Object to store health status
    const cacheDir = path.join(process.cwd(), 'public');
    const cachePath = path.join(cacheDir, 'news-cache.json');
    const healthStatusPath = path.join(cacheDir, 'feed-health-status.json');
    const ARTICLE_RETENTION_DAYS = 60;

    try {
        // STEP 0: Load existing cache
        let oldArticles = [];
        try {
            if (fs.existsSync(cachePath)) {
                const cachedData = fs.readFileSync(cachePath, 'utf-8');
                if (cachedData) { // Ensure file is not empty
                    oldArticles = JSON.parse(cachedData);
                    console.log(`\n📦 Loaded ${oldArticles.length} articles from existing cache.`);
                }
            }
        } catch (e) {
            console.warn(`⚠️  Could not read or parse existing cache. Starting fresh. Error: ${e.message}`);
            oldArticles = [];
        }

        // Get feeds from database
        const { rows: feeds } = await sql`SELECT * FROM feeds;`;
        console.log(`\n🔍 Found ${feeds.length} feeds in database\n`);

        // Initialize all feeds as unknown
        feeds.forEach(feed => {
            feedHealthStatus[feed.id] = { status: 'unknown', message: 'Not processed yet.' };
        });


        let newlyFetchedArticles = []; // Use a new array for newly fetched items

        // STEP 1: Fetch all feeds
        const proxies = (url) => [
            `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
            `https://corsproxy.io/?${encodeURIComponent(url)}`,
            `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        ];

        for (const feed of feeds) {
            let xmlString = null;
            let lastError = 'Unknown error';

            console.log(`📡 Fetching: ${feed.name}...`);

            // Attempt 1: Direct fetch
            try {
                const response = await fetch(feed.url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/rss+xml, application/xml, text/xml',
                        'Accept-Language': 'en-US,en;q=0.9,de-DE;q=0.8,de;q=0.7',
                    },
                    signal: AbortSignal.timeout(8000) // Slightly shorter timeout
                });
                if (response.ok) {
                    const text = await response.text();
                    if (text && text.trim().startsWith('<')) {
                        xmlString = text;
                        console.log(`   ✅ Direct fetch successful for ${feed.name}`);
                    } else {
                        lastError = `Direct fetch returned empty or invalid content. Status: ${response.status}`;
                    }
                } else {
                    lastError = `Direct fetch failed with status ${response.status}`;
                }
            } catch (e) {
                lastError = e instanceof Error ? e.message : String(e);
            }

            // Attempt 2: Proxies (if direct fetch failed)
            if (!xmlString) {
                console.log(`   ⚠️  Direct fetch failed for ${feed.name} (${lastError}). Trying proxies...`);
                for (const proxyUrl of proxies(feed.url)) {
                    try {
                        const proxyName = new URL(proxyUrl).hostname;
                        console.log(`      -> Trying proxy: ${proxyName}`);
                        const response = await fetch(proxyUrl, {
                            signal: AbortSignal.timeout(8000)
                        });
                        if (response.ok) {
                            const text = await response.text();
                            if (text && text.trim().startsWith('<')) {
                                xmlString = text;
                                console.log(`      ✅ Proxy fetch successful!`);
                                lastError = null; // Clear error on success
                                break; // Exit proxy loop
                            } else {
                                lastError = `Proxy ${proxyName} returned empty or invalid content.`;
                            }
                        } else {
                            lastError = `Proxy ${proxyName} failed with status ${response.status}`;
                        }
                    } catch (e) {
                        lastError = e instanceof Error ? e.message : String(e);
                    }
                }
            }

            if (xmlString) {
                try {
                    const feedArticles = parseRssXml(xmlString, feed);
                    if (feedArticles.length === 0) {
                        feedHealthStatus[feed.id] = { status: 'warning', message: 'Feed fetched successfully, but no articles were found.' };
                    } else {
                        feedHealthStatus[feed.id] = { status: 'success', message: `Successfully fetched and parsed ${feedArticles.length} articles.` };
                    }
                    newlyFetchedArticles.push(...feedArticles);
                    console.log(`   ✅ Parsed ${feedArticles.length} articles from ${feed.name}`);
                } catch(parseError) {
                    const message = parseError instanceof Error ? parseError.message : 'Unknown parse error';
                    console.error(`   ❌ Error parsing ${feed.name}: ${message}`);
                    feedHealthStatus[feed.id] = { status: 'error', message: `Failed during parse. Error: ${message}` };
                }
            } else {
                console.error(`   ❌ All fetch attempts failed for ${feed.name}. Last error: ${lastError}`);
                feedHealthStatus[feed.id] = { status: 'error', message: `All fetch attempts failed. Last error: ${lastError}` };
            }

            await new Promise(r => setTimeout(r, 200)); // Delay between feeds
        }


        console.log(`\n📰 Total new articles fetched: ${newlyFetchedArticles.length}`);

        // STEP 2: Scrape missing images
        const articlesNeedingScraping = newlyFetchedArticles.filter(a => a.needsScraping);
        if (articlesNeedingScraping.length > 0) {
            console.log(`\n🔎 Scraping images for ${articlesNeedingScraping.length} articles...\n`);

            for (const article of articlesNeedingScraping) {
                try {
                    console.log(`   🖼️  Scraping: ${article.source} - ${article.title.substring(0, 40)}...`);
                    const scrapedImage = await getOgImageFromUrl(article.link, article.source);

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

        // STEP 3: Add placeholders for newly fetched articles still without images
        newlyFetchedArticles = newlyFetchedArticles.map(article => {
            if (!article.imageUrl) {
                article.imageUrl = `https://placehold.co/600x400/374151/d1d5db?text=${encodeURIComponent(article.source.substring(0, 30))}`;
            }
            delete article.needsScraping;
            return article;
        });

        // STEP 4: Merge, Deduplicate, Prune, and Sort
        console.log('\n🔄 Merging, pruning, and sorting articles...');

        // Combine old and newly fetched articles
        const combinedArticles = [...oldArticles, ...newlyFetchedArticles];

        // Use a Map to deduplicate. New articles will overwrite old ones with the same ID.
        const uniqueArticlesMap = new Map();
        combinedArticles.forEach(article => {
            // Basic validation to prevent bad data from entering the cache
            if(article.id && article.title && article.publicationDate) {
                uniqueArticlesMap.set(article.id, article);
            }
        });

        // Prune articles older than ARTICLE_RETENTION_DAYS
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - ARTICLE_RETENTION_DAYS);

        const articlesToKeep = [];
        uniqueArticlesMap.forEach(article => {
            if (new Date(article.publicationDate) >= cutoffDate) {
                articlesToKeep.push(article);
            }
        });

        console.log(`   - Total unique articles: ${uniqueArticlesMap.size}`);
        console.log(`   - Articles after pruning (older than ${ARTICLE_RETENTION_DAYS} days): ${articlesToKeep.length}`);

        // Sort the final list by publication date (newest first)
        const sortedArticles = articlesToKeep.sort((a, b) => new Date(b.publicationDate).getTime() - new Date(a.publicationDate).getTime());

        // STEP 5: Save to cache
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        fs.writeFileSync(cachePath, JSON.stringify(sortedArticles, null, 2));

        console.log(`\n✅ Saved ${sortedArticles.length} articles to ${cachePath}`);

        fs.writeFileSync(healthStatusPath, JSON.stringify(feedHealthStatus, null, 2));
        console.log(`\n📊 Saved health status for ${Object.keys(feedHealthStatus).length} feeds to ${healthStatusPath}\n`);

    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        // Also try to write the (partial) health status on fatal error
        const cacheDir = path.join(process.cwd(), 'public');
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        const healthStatusPath = path.join(cacheDir, 'feed-health-status.json');
        fs.writeFileSync(healthStatusPath, JSON.stringify(feedHealthStatus, null, 2));
        console.log(`\n📊 Saved partial health status to ${healthStatusPath} before exiting.\n`);
        process.exit(1);
    }
}

fetchArticles();