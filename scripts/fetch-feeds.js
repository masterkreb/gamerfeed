// scripts/fetch-feeds.js
// Fetches RSS feeds and saves them to Vercel KV.
import 'dotenv/config'; // Load environment variables from .env file
import { kv } from '@vercel/kv';
import { sql } from '@vercel/postgres';
import { DOMParser } from 'linkedom';
import { escape } from 'html-escaper';

// === HELPER FUNCTIONS (DECODING, STRIPPING, ETC.) ===
function decodeHtmlEntities(text) {
    if (!text) return text;
    const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&rsquo;': "'", '&lsquo;': "'", '&rdquo;': '"', '&ldquo;': '"', '&ndash;': '–', '&mdash;': '—', '&auml;': 'ä', '&ouml;': 'ö', '&uuml;': 'ü', '&Auml;': 'Ä', '&Ouml;': 'Ö', '&Uuml;': 'Ü', '&szlig;': 'ß' };
    let decoded = text.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');
    for (const [entity, char] of Object.entries(entities)) {
        decoded = decoded.replaceAll(entity, char);
    }
    decoded = decoded.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 10)));
    decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
    return decoded;
}

function stripHtmlAndTruncate(html, length = 150) {
    if (!html) return '';
    try {
        let text = decodeHtmlEntities(html)
            .replace(/(\s*\[…\]\s*(Der Beitrag|Weiterlesen|Read more).*)/gi, '')
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, '');
        const stripped = text.replace(/\s+/g, ' ').replace(/\s*\.{3,}\s*$/, '').trim();
        if (stripped.length > length) {
            const truncated = stripped.substring(0, length);
            const lastSpace = truncated.lastIndexOf(' ');
            return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + '...';
        }
        return stripped;
    } catch (e) {
        console.warn('Error stripping HTML:', e);
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

                    // Standard logic for all feeds
                    if (bestImg) {
                        imageUrl = bestImg;
                    } else if (youtubeFallback) {
                        imageUrl = youtubeFallback;
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
                else if (feedName === 'GameStar' && hostname.includes('cgames.de')) {
                    processedUrl = processedUrl.replace(/(images\/gamestar\/)(\d+)(\/.*)/i, '$11200$3');
                }
                else if (feedName === 'GamePro' && hostname.includes('cgames.de')) {
                    processedUrl = processedUrl.replace(/(images\/gsgp\/)(\d+)(\/.*)/i, '$11200$3');
                }
                else if (feedName === 'GamesWirtschaft') {
                    processedUrl = processedUrl.replace(/-\d+x\d+(?=\.(jpg|jpeg|png|webp)$)/i, '');
                }
                else if (hostname.includes('nintendolife.com')) {
                    processedUrl = processedUrl.replace('small.jpg', 'large.jpg');
                }

                finalImageUrl = processedUrl;

            } catch (e) {
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


// === TREND GENERATION WITH GROQ ===
async function generateTrendsWithGroq(articles, period) {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) {
        console.log('   ⚠️  GROQ_API_KEY not found. Skipping trend generation.');
        return null;
    }

    const now = new Date();
    let filteredArticles;
    let periodText;
    let focusText;

    if (period === 'daily') {
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        filteredArticles = articles.filter(a => new Date(a.publicationDate) >= oneDayAgo);
        periodText = 'der letzten 24 Stunden';
        focusText = 'Fokus auf aktuelle Hypes und Breaking News.';
    } else {
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        filteredArticles = articles.filter(a => new Date(a.publicationDate) >= oneWeekAgo);
        periodText = 'der letzten Woche';
        focusText = 'Fokus auf die wichtigsten Themen, die die ganze Woche relevant waren.';
    }

    const titles = filteredArticles.map(a => a.title).slice(0, period === 'daily' ? 50 : 100);
    if (titles.length === 0) {
        console.log(`   ⚠️  No articles found for ${period} trends.`);
        return [];
    }

    const titlesText = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');

    const prompt = `Analysiere diese ${titles.length} Gaming-News-Titel ${periodText} und finde die 5 wichtigsten Themen/Trends.

${focusText}

Regeln:
- Suche nach SPEZIFISCHEN Themen (Spielenamen, Events, Hardware)
- Wenn "PlayStation/Xbox/Nintendo/Steam/PC" nur die Plattform ist (z.B. "Spiel X auf PlayStation") → ignorieren
- Wenn es ÜBER die Plattform selbst geht (z.B. "PS6 angekündigt") → ist ein Trend
- Zähle wie oft jedes Thema ungefähr vorkommt
- Schreibe eine KURZE Zusammenfassung (max 10 Wörter) was die News zu diesem Thema berichten
- Antworte NUR im JSON-Format, keine Erklärungen

Titel:
${titlesText}

Antworte exakt in diesem JSON-Format:
[
  {"topic": "GTA 6", "summary": "Release-Termin bekannt, neue Gameplay-Details enthüllt", "articleCount": 5},
  {"topic": "Steam Sale", "summary": "Herbst-Sale mit großen Rabatten gestartet", "articleCount": 3}
]`;

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [
                    { role: 'system', content: 'Du bist ein Gaming-News-Analyst. Antworte immer nur mit validem JSON, ohne Markdown-Formatierung oder Erklärungen.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 1500,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`   ❌ Groq API error: ${response.status} - ${errorText}`);
            return null;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
            console.error('   ❌ No content in Groq response');
            return null;
        }

        let jsonString = content.trim();
        if (jsonString.startsWith('```')) {
            jsonString = jsonString.replace(/```json?\n?/g, '').replace(/```/g, '');
        }

        const trends = JSON.parse(jsonString);
        return trends.slice(0, 5);

    } catch (error) {
        console.error(`   ❌ Error calling Groq API:`, error.message);
        return null;
    }
}

async function generateAndSaveTrends(articles) {
    console.log('\n🧠 Starting Groq AI Trend Analysis...');

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) {
        console.log('   ⚠️  GROQ_API_KEY not configured. Skipping trend generation.');
        return;
    }

    const now = new Date();
    const DAILY_CACHE_TTL = 2 * 60 * 60; // 2 hours
    const WEEKLY_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days

    // --- DAILY TRENDS (check if cache expired) ---
    let dailyTrends = [];
    let dailyUpdatedAt = '';

    try {
        const cachedDaily = await kv.get('daily_trends');

        if (cachedDaily && cachedDaily.updatedAt) {
            const cacheAge = (now.getTime() - new Date(cachedDaily.updatedAt).getTime()) / 1000;
            if (cacheAge < DAILY_CACHE_TTL) {
                console.log(`   📦 Daily trends cache still fresh (${Math.round(cacheAge / 60)} min old). Skipping.`);
                dailyTrends = cachedDaily.trends;
                dailyUpdatedAt = cachedDaily.updatedAt;
            } else {
                console.log('   🔄 Daily trends cache expired. Regenerating...');
                dailyTrends = await generateTrendsWithGroq(articles, 'daily');
                dailyUpdatedAt = now.toISOString();
                if (dailyTrends) {
                    await kv.set('daily_trends', { trends: dailyTrends, updatedAt: dailyUpdatedAt });
                    console.log('   ✅ Daily trends saved to KV.');
                }
            }
        } else {
            console.log('   🆕 No daily trends cache found. Generating...');
            dailyTrends = await generateTrendsWithGroq(articles, 'daily');
            dailyUpdatedAt = now.toISOString();
            if (dailyTrends) {
                await kv.set('daily_trends', { trends: dailyTrends, updatedAt: dailyUpdatedAt });
                console.log('   ✅ Daily trends saved to KV.');
            }
        }
    } catch (error) {
        console.error('   ❌ Error processing daily trends:', error.message);
    }

    // --- WEEKLY TRENDS (only update on Sunday or if empty) ---
    let weeklyTrends = [];
    let weeklyUpdatedAt = '';
    const isSunday = now.getUTCDay() === 0;

    try {
        const cachedWeekly = await kv.get('weekly_trends');

        if (cachedWeekly && cachedWeekly.updatedAt) {
            weeklyTrends = cachedWeekly.trends;
            weeklyUpdatedAt = cachedWeekly.updatedAt;

            if (isSunday) {
                const cacheDate = new Date(cachedWeekly.updatedAt);
                const todayStart = new Date(now);
                todayStart.setUTCHours(0, 0, 0, 0);

                if (cacheDate < todayStart) {
                    console.log('   🔄 It\'s Sunday! Regenerating weekly trends...');
                    weeklyTrends = await generateTrendsWithGroq(articles, 'weekly');
                    weeklyUpdatedAt = now.toISOString();
                    if (weeklyTrends) {
                        await kv.set('weekly_trends', { trends: weeklyTrends, updatedAt: weeklyUpdatedAt });
                        console.log('   ✅ Weekly trends saved to KV.');
                    }
                } else {
                    console.log('   📦 Weekly trends already updated today. Skipping.');
                }
            } else {
                console.log('   📦 Weekly trends cache exists (updates only on Sunday). Skipping.');
            }
        } else {
            console.log('   🆕 No weekly trends cache found. Generating...');
            weeklyTrends = await generateTrendsWithGroq(articles, 'weekly');
            weeklyUpdatedAt = now.toISOString();
            if (weeklyTrends) {
                await kv.set('weekly_trends', { trends: weeklyTrends, updatedAt: weeklyUpdatedAt });
                console.log('   ✅ Weekly trends saved to KV.');
            }
        }
    } catch (error) {
        console.error('   ❌ Error processing weekly trends:', error.message);
    }

    console.log('   🧠 Trend analysis complete!\n');
}

// === MAIN SCRIPT LOGIC ===
async function main() {
    const feedHealthStatus = {};
    const ARTICLE_RETENTION_DAYS = 60;

    try {
        let oldArticles = [];
        try {
            const cachedData = await kv.get('news_cache');

            // If cache exists and is a valid array, use it.
            if (cachedData && Array.isArray(cachedData)) {
                oldArticles = cachedData;
                console.log(`\n📦 Loaded ${oldArticles.length} articles from existing KV cache.`);

                // If cache is empty (null or undefined), it's safe to start fresh.
            } else if (!cachedData) {
                console.log(`ℹ️  No existing cache found in KV. Starting fresh.`);

                // If cache exists but is NOT a valid array (corrupted), abort to prevent data loss.
            } else {
                throw new Error(`Existing cache data from KV is corrupted (not an array). Aborting to prevent data loss.`);
            }
        } catch (e) {
            // A failure to read the cache or finding a corrupted cache is a critical error.
            // Abort the script to prevent overwriting the existing cache with incomplete data.
            console.error(`\n❌ CRITICAL: Failed to process Vercel KV cache. Aborting script to prevent data loss.`);
            console.error(`   Error details: ${e.message}`);
            // Re-throw the error to ensure the GitHub Action fails and we get notified.
            throw e;
        }

        const { rows: feeds } = await sql`SELECT * FROM feeds;`;
        console.log(`\n🔍 Found ${feeds.length} feeds in database\n`);
        feeds.forEach(feed => {
            feedHealthStatus[feed.id] = { status: 'unknown', message: 'Not processed yet.' };
        });

        let newlyFetchedArticles = [];

        const proxies = (url) => [ `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, `https://corsproxy.io/?${encodeURIComponent(url)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` ];

        for (const feed of feeds) {
            let xmlString = null;
            let lastError = 'Unknown error';
            console.log(`📡 Fetching: ${feed.name}...`);

            // Attempt 1: Direct fetch
            try {
                const response = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/rss+xml, application/xml, text/xml', 'Accept-Language': 'en-US,en;q=0.9,de-DE;q=0.8,de;q=0.7' }, signal: AbortSignal.timeout(8000) });
                if (response.ok) {
                    const text = await response.text();
                    if (text && text.trim().startsWith('<')) {
                        xmlString = text;
                        console.log(`   ✅ Direct fetch successful for ${feed.name}`);
                    } else { lastError = `Direct fetch returned empty or invalid content. Status: ${response.status}`; }
                } else { lastError = `Direct fetch failed with status ${response.status}`; }
            } catch (e) { lastError = e instanceof Error ? e.message : String(e); }

            // Attempt 2: Proxies (if direct fetch failed)
            if (!xmlString) {
                console.log(`   ⚠️  Direct fetch failed for ${feed.name} (${lastError}). Trying proxies...`);
                for (const proxyUrl of proxies(feed.url)) {
                    try {
                        const proxyName = new URL(proxyUrl).hostname;
                        console.log(`      -> Trying proxy: ${proxyName}`);
                        const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
                        if (response.ok) {
                            const text = await response.text();
                            if (text && text.trim().startsWith('<')) {
                                xmlString = text;
                                console.log(`      ✅ Proxy fetch successful!`);
                                lastError = null; break;
                            } else { lastError = `Proxy ${proxyName} returned empty or invalid content.`; }
                        } else { lastError = `Proxy ${proxyName} failed with status ${response.status}`; }
                    } catch (e) { lastError = e instanceof Error ? e.message : String(e); }
                }
            }
            if (xmlString) {
                try {
                    const feedArticles = parseRssXml(xmlString, feed);
                    if (feedArticles.length === 0) { feedHealthStatus[feed.id] = { status: 'warning', message: 'Feed fetched successfully, but no articles were found.' };
                    } else { feedHealthStatus[feed.id] = { status: 'success', message: `Successfully fetched and parsed ${feedArticles.length} articles.` }; }
                    newlyFetchedArticles.push(...feedArticles);
                    console.log(`   ✅ Parsed ${feedArticles.length} articles from ${feed.name}`);
                } catch (parseError) {
                    const message = parseError instanceof Error ? parseError.message : 'Unknown parse error';
                    console.error(`   ❌ Error parsing ${feed.name}: ${message}`);
                    feedHealthStatus[feed.id] = { status: 'error', message: `Failed during parse. Error: ${message}` };
                }
            } else {
                console.error(`   ❌ All fetch attempts failed for ${feed.name}. Last error: ${lastError}`);
                feedHealthStatus[feed.id] = { status: 'error', message: `All fetch attempts failed. Last error: ${lastError}` };
            }
            await new Promise(r => setTimeout(r, 200));
        }

        console.log(`\n📰 Total new articles fetched: ${newlyFetchedArticles.length}`);

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
                    } else { console.log(`      ⚠️  No image found, using placeholder`); }
                    await new Promise(r => setTimeout(r, 500));
                } catch (error) { console.error(`      ❌ Scraping failed: ${error.message}`); }
            }
        }

        newlyFetchedArticles = newlyFetchedArticles.map(article => {
            if (!article.imageUrl) { article.imageUrl = `https://placehold.co/600x400/374151/d1d5db?text=${encodeURIComponent(article.source.substring(0, 30))}`; }
            delete article.needsScraping;
            return article;
        });

        console.log('\n🔄 Merging, pruning, and sorting articles...');
        const uniqueArticlesMap = new Map();
        [...oldArticles, ...newlyFetchedArticles].forEach(article => {
            if (article.id && article.title && article.publicationDate) {
                const key = `${article.source}|${article.title}`;
                const existing = uniqueArticlesMap.get(key);
                if (!existing || (article.imageUrl && !existing.imageUrl.includes('placehold'))) { uniqueArticlesMap.set(key, article); }
            }
        });
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - ARTICLE_RETENTION_DAYS);
        const articlesToKeep = Array.from(uniqueArticlesMap.values()).filter(article => new Date(article.publicationDate) >= cutoffDate);
        console.log(`   - Total unique articles: ${uniqueArticlesMap.size}`);
        console.log(`   - Articles after pruning (older than ${ARTICLE_RETENTION_DAYS} days): ${articlesToKeep.length}`);
        const sortedArticles = articlesToKeep.sort((a, b) => new Date(b.publicationDate).getTime() - new Date(a.publicationDate).getTime());

        console.log('\n💾 Saving data to Vercel KV...');
        await kv.set('news_cache', sortedArticles);
        console.log(`   ✅ Saved ${sortedArticles.length} articles to KV key 'news_cache'`);

        await kv.set('feed_health_status', feedHealthStatus);
        console.log(`   📊 Saved health status for ${Object.keys(feedHealthStatus).length} feeds to KV key 'feed_health_status'`);

        // Generate trends with Groq AI (respects cache TTL)
        await generateAndSaveTrends(sortedArticles);

    } catch (error) {
        console.error('\n❌ Fatal error in fetch script:', error);
        // Still try to save the partial health status on error
        await kv.set('feed_health_status', feedHealthStatus);
        console.log(`\n📊 Saved partial health status to Vercel KV before exiting.\n`);
        process.exit(1);
    }
}

main();