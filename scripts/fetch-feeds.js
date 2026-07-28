// scripts/fetch-feeds.js
// Fetches RSS feeds and saves them to Vercel KV.
import 'dotenv/config'; // Load environment variables from .env file
import { kv } from '@vercel/kv';
import { sql } from '@vercel/postgres';
import { DOMParser } from 'linkedom';
import { escape } from 'html-escaper';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeContentUrl } from '../shared/url-policy.js';
import { sanitizeErrorMessage } from '../shared/feed-health-model.js';
import { createFeedRunRecorder } from './feed-run-recorder.js';
import { readLimitedResponseText } from './limited-response.js';
import { fetchWithOutboundPolicy } from './outbound-policy.js';
import {
    chooseMergedImageUrl,
    hasUsableStoredImage,
    isKnownNonArticleImageUrl,
    needsStoredImageRepair,
    selectRssContentImageUrl,
    shouldScrapeMissingImage,
} from './feed-image-utils.js';
import {
    BROWSER_LIKE_HEADERS,
    fetchFeedXml,
    isFeedXml,
} from './feed-fetch-utils.js';

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
function formatDuration(ms) {
    return `${(ms / 1000).toFixed(1)}s`;
}

function getPlaceholderImageUrl(sourceName) {
    const label = String(sourceName || 'Unknown').substring(0, 30);
    return `https://placehold.co/600x400/374151/d1d5db?text=${encodeURIComponent(label)}`;
}

function getFetchUrlForFeed(feed) {
    if ((feed.id === 'golem' || feed.name === 'Golem') && feed.url.includes('rss.golem.de') && feed.url.includes('feed=ATOM1.0')) {
        return feed.url.replace('feed=ATOM1.0', 'feed=RSS2.0');
    }
    return feed.url;
}

// Eine Artikelseite ist HTML mit ein paar Meta-Tags. Alles darueber hinaus ist
// fuer die Bildsuche wertlos und nur ein Speicherrisiko.
export const HTML_SCRAPE_TIMEOUT_MS = 5000;
export const MAX_HTML_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function getOgImageFromUrl(url, sourceName, {
    fetchImpl,
    lookup,
    logger = console,
    maxBytes = MAX_HTML_RESPONSE_BYTES,
    timeoutMs = HTML_SCRAPE_TIMEOUT_MS,
} = {}) {
    const fetchAttempts = [
        {
            name: 'direct',
            requestUrl: url,
            options: { headers: BROWSER_LIKE_HEADERS },
        },
    ];

    const scrapeStart = Date.now();
    for (const attempt of fetchAttempts) {
        const attemptStart = Date.now();
        let response = null;
        try {
            logger.log(`      -> Trying image fetch: ${attempt.name}`);
            // Artikelseiten stammen aus Feed-Inhalten und sind damit fremde
            // Eingaben: derselbe Schutz wie beim Feed-Abruf selbst. Der
            // Abort-Timeout begrenzt zusaetzlich eine haengende Gegenstelle.
            response = await fetchWithOutboundPolicy(attempt.requestUrl, {
                ...attempt.options,
                fetchImpl,
                lookup,
                signal: AbortSignal.timeout(timeoutMs),
            });
            const attemptDuration = Date.now() - attemptStart;
            logger.log(`         ${attempt.name} responded with ${response.status} in ${formatDuration(attemptDuration)}`);
            if (!response.ok) {
                await response.body?.cancel?.().catch(() => {});
                continue;
            }

            // Begrenzt gelesen: eine Seite ohne Content-Length koennte sonst
            // beliebig lange streamen.
            const html = await readLimitedResponseText(response, maxBytes);
            const doc = new DOMParser().parseFromString(html, 'text/html');

            let imageUrl = null;
            const imageMetaSelectors = [
                'meta[property="og:image"]',
                'meta[property="og:image:url"]',
                'meta[name="twitter:image"]',
            ];

            for (const selector of imageMetaSelectors) {
                const imageMetas = doc.querySelectorAll(selector);
                for (const imageMeta of imageMetas) {
                    const candidate = imageMeta.getAttribute('content')?.trim();
                    if (candidate && !isKnownNonArticleImageUrl(candidate, sourceName)) {
                        imageUrl = candidate;
                        break;
                    }
                }
                if (imageUrl) break;
            }

            if (imageUrl) {
                logger.log(`         ✅ Found meta image via ${attempt.name} in ${formatDuration(Date.now() - scrapeStart)}`);
                // Auch gescrapte Adressen unterliegen der Ausgabe-Policy.
                return normalizeContentUrl(imageUrl, { base: url });
            }

            // Fallback: If no valid og:image, look for YouTube iframe in body
            const youtubeIframe = doc.querySelector('iframe[src*="youtube.com/embed/"]');
            if (youtubeIframe) {
                const src = youtubeIframe.getAttribute('src');
                if (src) {
                    const videoIdMatch = src.match(/embed\/([^/?]+)/);
                    if (videoIdMatch && videoIdMatch[1]) {
                        logger.log(`         ✅ Found YouTube iframe image via ${attempt.name} in ${formatDuration(Date.now() - scrapeStart)}`);
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
                        logger.log(`         ✅ Found YouTube link image via ${attempt.name} in ${formatDuration(Date.now() - scrapeStart)}`);
                        return `https://img.youtube.com/vi/${videoIdMatch[1]}/hqdefault.jpg`;
                    }
                }
            }
            logger.log(`         ⚠️  No image candidate via ${attempt.name}`);
        } catch (error) {
            // Auch hier gilt: der Rumpf wird geschlossen, damit eine
            // abgebrochene Antwort keine offene Verbindung hinterlaesst.
            await response?.body?.cancel?.().catch(() => {});
            logger.log(`         ❌ ${attempt.name} failed after ${formatDuration(Date.now() - attemptStart)}: ${redactMessage(error?.message ?? String(error))}`);
        }
    }
    logger.log(`      -> No image found after ${formatDuration(Date.now() - scrapeStart)} across all image fetch attempts`);
    return null;
}

// === PARSE RSS/ATOM FEED ===
function getElementLocalName(element) {
    const qualifiedName = element?.localName || element?.nodeName || '';
    return qualifiedName.toLowerCase().split(':').pop();
}

function getElementsByLocalName(root, localName) {
    const normalizedName = localName.toLowerCase();
    return Array.from(root.querySelectorAll('*'))
        .filter(element => getElementLocalName(element) === normalizedName);
}

function getFirstElementByLocalName(root, localName) {
    return getElementsByLocalName(root, localName)[0] || null;
}

/**
 * Zerlegt einen Feed und meldet zusaetzlich, was dabei verworfen wurde.
 *
 * Ein einzelnes kaputtes Element darf den Feed nicht mitreissen: fruehere
 * Laeufe haben an einem ungueltigen `pubDate` die komplette Quelle verloren,
 * weil `new Date(...).toISOString()` aus der Schleife heraus geworfen hat.
 *
 * @param {string} xmlString
 * @param {object} feed
 * @returns {{ articles: object[], skipped: { total: number, reasons: Record<string, number> } }}
 */
export function parseFeedItems(xmlString, feed) {
    if (!isFeedXml(xmlString)) {
        throw new Error(`Response is not a valid RSS or Atom feed: ${feed.url}`);
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");
    const errorNode = doc.querySelector("parsererror");
    if (errorNode) {
        console.error(`XML Parsing Error for ${feed.url}:`, errorNode.textContent);
        throw new Error(`Failed to parse XML for feed: ${feed.url}`);
    }

    const articles = [];
    // Abgelehnte Items werden gesammelt und einmal gebuendelt gemeldet, statt
    // pro Item eine Zeile ins Log zu schreiben. Gespeichert wird nur der Grund -
    // Titel, Adressen und Inhalte gehoeren nicht in eine Fehlerauswertung.
    const skippedReasons = {};
    const skip = reason => {
        skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
    };
    const isAtom = getElementLocalName(doc.documentElement) === 'feed';
    const itemNodes = getElementsByLocalName(doc, isAtom ? 'entry' : 'item');

    itemNodes.forEach(node => {
      // Klammer um das gesamte Element: was hier drin schiefgeht, kostet genau
      // dieses Element und nicht den Rest des Feeds.
      try {
        const getText = (localName) => (
            getFirstElementByLocalName(node, localName)?.textContent?.trim() || ''
        );

        let link = '';
        if (isAtom) {
            const linkNodes = getElementsByLocalName(node, 'link');
            const linkNode = linkNodes.find(element => element.getAttribute('rel') === 'alternate')
                || linkNodes[0];
            link = linkNode?.getAttribute('href') || '';
        } else {
            link = getText('link');
        }

        const title = decodeHtmlEntities(getText('title'));
        const pubDate = getText(isAtom ? 'published' : 'pubDate') || getText('updated');

        if (!title || !link || !pubDate) {
            skip('incomplete');
            return;
        }

        // Ein unlesbares Datum ist der haeufigste Einzelfehler und war bisher
        // der teuerste: er hat den ganzen Feed gekostet.
        const publishedAt = new Date(pubDate);
        if (Number.isNaN(publishedAt.getTime())) {
            skip('invalid_date');
            return;
        }

        // Ausgabe-Policy: relative Angaben werden gegen die Feed-Adresse
        // aufgeloest, alles andere als http/https und URLs mit Zugangsdaten
        // fallen weg. Ein solches Item wird isoliert uebersprungen, damit es
        // weder den Cache noch den restlichen Feed beschaedigt.
        const normalizedLink = normalizeContentUrl(link, { base: feed?.url });
        if (!normalizedLink) {
            skip('invalid_link');
            return;
        }
        link = normalizedLink;

        const description = getFirstElementByLocalName(node, 'description')?.textContent
            || getFirstElementByLocalName(node, 'summary')?.textContent
            || '';
        const summary = stripHtmlAndTruncate(description);


        // --- More robust Image and Content Extraction ---
        let imageUrl = null;

        // 1. Enclosure
        const enclosure = node.querySelector('enclosure[type^="image"]');
        if (enclosure) {
            const enclosureUrl = enclosure.getAttribute('url');
            if (enclosureUrl && !isKnownNonArticleImageUrl(enclosureUrl, feed)) {
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
                        if (url && !isKnownNonArticleImageUrl(url, feed)) {
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
                if (thumbnailUrl && !isKnownNonArticleImageUrl(thumbnailUrl, feed)) {
                    imageUrl = thumbnailUrl;
                }
            }
        }

        // 4. thumbnail[url]
        if (!imageUrl) {
            const thumbnail = node.querySelector('thumbnail[url]');
            if (thumbnail) {
                const thumbUrl = thumbnail.getAttribute('url');
                if (thumbUrl && !isKnownNonArticleImageUrl(thumbUrl, feed)) {
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
                contentText = getFirstElementByLocalName(node, 'content')?.textContent || description;
            }

            if (contentText) {
                try {
                    const contentDoc = new DOMParser().parseFromString(contentText, 'text/html');
                    const images = Array.from(contentDoc.querySelectorAll('img'));
                    let bestImg = null;
                    let youtubeFallback = null;

                    for (const img of images) {
                        const src = selectRssContentImageUrl([
                            img.getAttribute('data-src'),
                            img.getAttribute('data-lazy-src'),
                            img.getAttribute('src'),
                            img.src,
                        ], feed);
                        if (!src) continue;

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
        // Dieselbe Ausgabe-Policy wie beim Artikel-Link. Ein abgelehntes Bild
        // laesst den Artikel bestehen; er bekommt spaeter einen Platzhalter.
        const normalizedImageUrl = normalizeContentUrl(imageUrl, { base: link });
        if (imageUrl && !normalizedImageUrl) {
            skip('invalid_image');
        }
        if (normalizedImageUrl && !isKnownNonArticleImageUrl(normalizedImageUrl, feed)) {
            try {
                let processedUrl = normalizedImageUrl;

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
                // Die quellenspezifische Optimierung ist fehlgeschlagen; die
                // bereits normalisierte Adresse bleibt gueltig.
                finalImageUrl = normalizedImageUrl;
                console.warn(`Could not process image URL '${normalizedImageUrl}': ${e.message}`);
            }
        }


        articles.push({
            id: getText('guid') || getText('id') || link,
            title,
            source: feed.name,
            publicationDate: publishedAt.toISOString(),
            summary,
            link,
            imageUrl: finalImageUrl || null,
            needsScraping: !finalImageUrl && shouldScrapeMissingImage(feed),
            language: feed.language
        });
      } catch {
        // Unerwarteter Fehler in genau diesem Element. Die Ursache steht nicht
        // im Zaehler: eine Ausnahme kann Inhalte oder Adressen des Elements
        // mitfuehren, und die gehoeren weder ins Log noch in den Feed-Status.
        skip('item_error');
      }
    });

    const skippedTotal = Object.values(skippedReasons).reduce((sum, count) => sum + count, 0);
    if (skippedTotal > 0) {
        const summary = Object.entries(skippedReasons)
            .map(([reason, count]) => `${reason}: ${count}`)
            .join(', ');
        console.warn(`   ⚠️  ${skippedTotal} Element(e) aus ${feed?.name ?? 'Feed'} verworfen (${summary})`);
    }

    return { articles, skipped: { total: skippedTotal, reasons: skippedReasons } };
}

/**
 * Rueckwaertskompatible Fassung: liefert nur die Artikel.
 *
 * Bestehende Aufrufer und Tests arbeiten unveraendert weiter; wer den
 * Skip-Zaehler braucht, nimmt `parseFeedItems`.
 *
 * @param {string} xmlString
 * @param {object} feed
 * @returns {object[]}
 */
export function parseRssXml(xmlString, feed) {
    return parseFeedItems(xmlString, feed).articles;
}


// === TREND GENERATION WITH GROQ ===

// Helper: Get date key in YYYY-MM-DD format
function getDateKey(daysAgo = 0) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return d.toISOString().substring(0, 10);
}

// Sources that belong to the same publisher group (likely share content)
// Only count once per group for trend analysis to avoid inflation
const SOURCE_GROUPS = [
    ['PC Games', 'GameZone', 'Video Games Zone'], // Computec Media Group
];

// Get group ID for a source, or null if not in a group
function getSourceGroup(sourceName) {
    for (let i = 0; i < SOURCE_GROUPS.length; i++) {
        if (SOURCE_GROUPS[i].some(s => sourceName.includes(s) || s.includes(sourceName))) {
            return i;
        }
    }
    return null;
}

// Normalize title for comparison (remove common variations)
function normalizeTitle(title) {
    return title
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ')    // Normalize whitespace
        .trim();
}

// Generate daily trends using AI (sends titles to Groq)
async function generateDailyTrendsWithGroq(articles) {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) {
        console.log('   ⚠️  GROQ_API_KEY not found. Skipping trend generation.');
        return null;
    }

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const filteredArticles = articles.filter(a => new Date(a.publicationDate) >= oneDayAgo);

    // Deduplicate articles from same publisher groups
    // If multiple sources in the same group have similar titles, only count once
    const seenTitles = new Map(); // normalizedTitle -> { groupId, article }
    const deduplicatedArticles = [];
    let duplicatesRemoved = 0;

    for (const article of filteredArticles) {
        const normalizedTitle = normalizeTitle(article.title);
        const groupId = getSourceGroup(article.source);
        
        if (seenTitles.has(normalizedTitle)) {
            const existing = seenTitles.get(normalizedTitle);
            // If both are from grouped sources OR titles are identical, skip
            if (existing.groupId !== null && groupId !== null) {
                duplicatesRemoved++;
                continue; // Skip - same content from same publisher group
            }
            // If exact same title from different publishers, also skip
            if (existing.normalizedTitle === normalizedTitle) {
                duplicatesRemoved++;
                continue;
            }
        }
        
        seenTitles.set(normalizedTitle, { groupId, article, normalizedTitle });
        deduplicatedArticles.push(article);
    }

    if (duplicatesRemoved > 0) {
        console.log(`   🔄 Removed ${duplicatesRemoved} duplicate articles from same publisher groups for trend analysis`);
    }

    // WICHTIG: Limit auf 80 Titel, um das 6k Token Limit von Groq zu vermeiden
    const MAX_TITLES = 80;
    const titles = deduplicatedArticles.map(a => a.title).slice(0, MAX_TITLES);

    console.log(`   📊 Analyzing ${titles.length} unique titles (from ${filteredArticles.length} articles) for daily trends...`);

    if (titles.length === 0) {
        console.log('   ⚠️  No articles found for daily trends.');
        return [];
    }

    const titlesText = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');

    const prompt = `Analysiere diese ${titles.length} Gaming-News-Titel der letzten 24 Stunden und finde die 5 wichtigsten Themen/Trends.

Regeln:
- Suche nach SPEZIFISCHEN Themen (Spielenamen, Events, Hardware)
- **Wenn eine Plattform (PlayStation, Xbox, PC, Nintendo, Steam etc.) nur als Ort der Veröffentlichung für ein Spiel genannt wird (z.B. "Spiel X auf PlayStation") → IGNORIEREN.**
- **Wenn es um Hardware, Service-Änderungen oder große Neuigkeiten ZUR Plattform selbst geht (z.B. "PS5 Pro vorgestellt", "Xbox Game Pass Preiserhöhung") → IST EIN TREND.**
- Zähle wie oft jedes Thema ungefähr vorkommt
- Schreibe eine KURZE Zusammenfassung (max 10 Wörter) was die News zu diesem Thema berichten
- Fokus auf aktuelle Hypes und Breaking News

Titel:
${titlesText}

Antworte NUR im JSON-Format, keine Erklärungen:
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
        // Sort by articleCount descending (highest first)
        return trends
            .slice(0, 5)
            .sort((a, b) => b.articleCount - a.articleCount);

    } catch (error) {
        console.error(`   ❌ Error calling Groq API:`, error.message);
        return null;
    }
}

// Generate weekly trends by aggregating 7 days of archived daily trends
async function generateWeeklyTrendsFromArchive() {
    console.log('   🔄 Generating weekly trends from 7-day archive...');
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    if (!GROQ_API_KEY) {
        console.log('   ⚠️  GROQ_API_KEY not found. Skipping weekly trend aggregation.');
        return null;
    }

    // 1. Load 7 days of archived daily trends
    const archiveData = [];
    const datesFound = [];
    for (let i = 0; i < 7; i++) {
        const dateKey = getDateKey(i);
        const cachedDay = await kv.get(`daily_trends_archive:${dateKey}`);

        if (cachedDay && cachedDay.trends && cachedDay.trends.length > 0) {
            datesFound.push(dateKey);
            archiveData.push(...cachedDay.trends.map(t => ({
                ...t,
                date: dateKey
            })));
        }
    }

    if (archiveData.length < 5) {
        console.log(`   ⚠️  Not enough archive data found (${archiveData.length} entries). Need at least 5 days.`);
        return null;
    }

    console.log(`   📦 Loaded ${archiveData.length} trend entries from ${datesFound.length} days.`);

    // Calculate date range
    const dateRange = {
        from: datesFound[datesFound.length - 1], // oldest
        to: datesFound[0] // newest (today)
    };

    // 2. Aggregate trends for CURRENT WEEK ONLY (not cumulative)
    // Group by topic and sum articleCount only for this week's data
    const aggregatedTrends = {};
    archiveData.forEach(t => {
        if (!aggregatedTrends[t.topic]) {
            aggregatedTrends[t.topic] = { topic: t.topic, articleCount: 0, summaries: [] };
        }
        aggregatedTrends[t.topic].articleCount += t.articleCount;
        if (t.summary && !aggregatedTrends[t.topic].summaries.includes(t.summary)) {
            aggregatedTrends[t.topic].summaries.push(t.summary);
        }
    });

    const weeklyTrendsData = Object.values(aggregatedTrends)
        .sort((a, b) => b.articleCount - a.articleCount)
        .slice(0, 10); // Top 10 for Groq aggregation

    console.log(`   📊 Aggregated ${Object.keys(aggregatedTrends).length} unique topics for this week.`);

    // 3. Create prompt for Groq to generate summary of THIS WEEK's trends
    const trendsList = weeklyTrendsData.map((t, idx) => 
        `${idx + 1}. ${t.topic} (${t.articleCount} Artikel diese Woche)`
    ).join('\n');

    const prompt = `Analysiere die Top-Trends dieser Gaming-Woche und schreibe eine prägnante Zusammenfassung.

Top-Themen diese Woche:
${trendsList}

Aufgabe:
1. Schreibe eine **Wochen-Zusammenfassung** (2-3 Sätze) über die wichtigsten Hypes und News DIESER WOCHE
2. Fokussiere auf die TOP-Themen oben
3. Beschreibe für jedes der TOP 5 Themen, WAS in dieser Woche passiert ist (max 15 Wörter pro Thema)
4. Zähle NICHT kumulativ – nur DIESE WOCHE zählt!

Antworte NUR im JSON-Format:
{
  "overallSummary": "Diese Woche war geprägt von X und Y. Besonders hervorzuheben ist Z.",
  "trends": [
    {"topic": "GTA 6", "summary": "Neue Trailer-Details und Release-Spekulationen beherrschen die Woche.", "articleCount": 33},
    {"topic": "PS5 Pro", "summary": "Hardware-Updates und technische Verbesserungen im Fokus.", "articleCount": 15}
  ]
}`;

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
                    { role: 'system', content: 'Du bist ein Gaming-News-Analyst. Analysiere die Trends dieser Woche (NICHT kumulativ). Gib nur valides JSON zurück.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 2000,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`   ❌ Groq API error during Weekly Aggregation: ${response.status} - ${errorText}`);
            return null;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
            console.error('   ❌ No content in Groq response for weekly trends');
            return null;
        }

        let jsonString = content.trim();
        if (jsonString.startsWith('```')) {
            jsonString = jsonString.replace(/```json?\n?/g, '').replace(/```/g, '');
        }

        const weeklyData = JSON.parse(jsonString);

        // Return the full object with overallSummary, trends, and dateRange
        return {
            overallSummary: weeklyData.overallSummary || '',
            trends: (weeklyData.trends || []).slice(0, 5),
            dateRange
        };

    } catch (error) {
        console.error(`   ❌ Error calling Groq API for Weekly Aggregation:`, error.message);
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
    const todayKey = getDateKey();
    const DAILY_CACHE_TTL = 2 * 60 * 60; // 2 hours
    const WEEKLY_CACHE_TTL = 2 * 60 * 60; // 2 hours (häufigere Updates für aktuelle Woche)

    // --- DAILY TRENDS ---
    let dailyTrends = [];
    let dailyUpdatedAt = '';

    try {
        const cachedDaily = await kv.get('daily_trends');
        const cachedArchive = await kv.get(`daily_trends_archive:${todayKey}`);

        let shouldRegenerate = true;

        if (cachedDaily && cachedDaily.updatedAt) {
            const cacheAge = (now.getTime() - new Date(cachedDaily.updatedAt).getTime()) / 1000;
            if (cacheAge < DAILY_CACHE_TTL) {
                console.log(`   📦 Daily trends cache still fresh (${Math.round(cacheAge / 60)} min old). Skipping.`);
                dailyTrends = cachedDaily.trends;
                dailyUpdatedAt = cachedDaily.updatedAt;
                shouldRegenerate = false;
            }
        }

        if (shouldRegenerate) {
            console.log('   🔄 Daily trends cache expired or missing. Regenerating...');
            dailyTrends = await generateDailyTrendsWithGroq(articles);
            dailyUpdatedAt = now.toISOString();

            if (dailyTrends) {
                // Save to LIVE cache
                await kv.set('daily_trends', { trends: dailyTrends, updatedAt: dailyUpdatedAt });
                console.log('   ✅ Daily trends saved to LIVE cache.');
            }
        }

        // Archive today's trends (only once per day)
        if (dailyTrends && dailyTrends.length > 0 && !cachedArchive) {
            await kv.set(`daily_trends_archive:${todayKey}`, { trends: dailyTrends, updatedAt: dailyUpdatedAt });
            console.log(`   📁 Daily trends archived: daily_trends_archive:${todayKey}`);
        } else if (cachedArchive) {
            console.log(`   📦 Archive for ${todayKey} already exists. Skipping archive.`);
        }

    } catch (error) {
        console.error('   ❌ Error processing daily trends:', error.message);
    }

    // --- WEEKLY TRENDS (from archive aggregation) ---
    try {
        const cachedWeekly = await kv.get('weekly_trends');
        let shouldRegenerateWeekly = true;

        if (cachedWeekly && cachedWeekly.updatedAt) {
            const cacheAge = (now.getTime() - new Date(cachedWeekly.updatedAt).getTime()) / 1000;
            if (cacheAge < WEEKLY_CACHE_TTL) {
                console.log(`   📦 Weekly trends cache still fresh (${Math.round(cacheAge / 60)} min old). Skipping.`);
                shouldRegenerateWeekly = false;
            }
        }

        if (shouldRegenerateWeekly) {
            console.log('   🔄 Weekly trends cache expired or missing. Regenerating from archive...');
            const weeklyData = await generateWeeklyTrendsFromArchive();

            if (weeklyData && weeklyData.trends) {
                await kv.set('weekly_trends', {
                    trends: weeklyData.trends,
                    overallSummary: weeklyData.overallSummary || '',
                    dateRange: weeklyData.dateRange || null,
                    updatedAt: now.toISOString()
                });
                console.log('   ✅ Weekly trends with summary aggregated and saved to KV.');
            } else {
                console.log('   ⚠️  Weekly trends could not be generated. Keeping old cache if exists.');
            }
        }

    } catch (error) {
        console.error('   ❌ Error processing weekly trends:', error.message);
    }

    console.log('   🧠 Trend analysis complete!\n');
}

// === HEARTBEAT (Roadmap O1) ===

// Die Actions-Run-ID ist nicht geheim und laesst einen Lauf im Admin direkt dem
// Workflow-Protokoll zuordnen. Lokale Laeufe bekommen eine eigene Kennung.
function createRunId() {
    const actionsRunId = process.env.GITHUB_RUN_ID;
    if (actionsRunId) {
        const attempt = process.env.GITHUB_RUN_ATTEMPT;
        return `gha-${actionsRunId}${attempt ? `-${attempt}` : ''}`;
    }
    return `local-${randomUUID()}`;
}

// Fehlermeldungen von Postgres, KV, Groq oder dem Feed-Proxy tragen die
// Zieladresse oft im Klartext. Alles, was im Admin-Panel landet, wird deshalb
// vorher um die konfigurierten Werte bereinigt.
function redactMessage(message) {
    const secrets = [
        process.env.POSTGRES_URL,
        process.env.KV_REST_API_URL,
        process.env.KV_REST_API_TOKEN,
        process.env.GROQ_API_KEY,
        process.env.FEED_PROXY_URL,
    ].filter(value => typeof value === 'string' && value !== '');

    return sanitizeErrorMessage(message, { secrets }) ?? '';
}

// === MAIN SCRIPT LOGIC ===
async function main() {
    const feedHealthStatus = {};
    const ARTICLE_RETENTION_DAYS = 60; // Artikel werden 60 Tage gespeichert
    const MAX_ARTICLES = 10000; // Maximale Anzahl Artikel (verhindert KV Limit-Überschreitung)
    const IMAGE_BACKFILL_LIMIT = 30;
    const IMAGE_BACKFILL_PER_SOURCE_LIMIT = 5;
    // 8s waren zu knapp: langsame Feeds liefen aus dem Actions-Netz gelegentlich
    // ins Timeout, obwohl sie erreichbar waren.
    const FEED_FETCH_TIMEOUT_MS = 15000;
    const FEED_PROXY_TIMEOUT_MS = 20000;
    // Endpunkt von tools/feed-proxy.php auf dem externen Hosting. Ohne dieses
    // Secret laeuft der Abruf ohne Fallback, statt fehlzuschlagen.
    const feedProxyUrl = process.env.FEED_PROXY_URL;

    const runStartMs = Date.now();
    const durations = {};
    const recorder = createFeedRunRecorder({
        store: kv,
        runId: createRunId(),
        startedAt: new Date(),
        redact: redactMessage,
    });

    console.log(`\n🫀 Lauf ${recorder.runId} gestartet um ${recorder.startedAt}`);
    await recorder.begin();

    try {
        // Diagnosedaten: ein Lesefehler darf den Kernlauf nicht verhindern. Er
        // verhindert nur, dass ein nicht sicher gelesener historischer Stand
        // spaeter mit Ersatzwerten ueberschrieben wird.
        await recorder.loadPreviousState();

        let oldArticles = [];
        try {
            const cachedData = await kv.get('news_cache');

            // If cache exists and is a valid array, use it.
            if (cachedData && Array.isArray(cachedData)) {
                let sanitizedImageCount = 0;
                oldArticles = cachedData.map(article => {
                    if (isKnownNonArticleImageUrl(article?.imageUrl, article?.source)) {
                        sanitizedImageCount++;
                        return {
                            ...article,
                            imageUrl: getPlaceholderImageUrl(article.source),
                        };
                    }
                    return article;
                });
                console.log(`\n📦 Loaded ${oldArticles.length} articles from existing KV cache.`);
                if (sanitizedImageCount > 0) {
                    console.log(`   🧹 Replaced ${sanitizedImageCount} cached UI icon image(s) with placeholders.`);
                }

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
        // Ab hier gilt die Feed-Liste als bekannt: eine leere Liste darf den
        // gespeicherten Status jetzt leeren, ein Abbruch davor nicht.
        recorder.markFeedListLoaded();
        feeds.forEach(feed => {
            feedHealthStatus[feed.id] = {
                status: 'unknown',
                message: 'Not processed yet.',
                lastAttemptAt: null,
                lastSuccessAt: recorder.lastSuccessAtFor(feed.id),
                durationMs: null,
                articleCount: null,
            };
        });

        let newlyFetchedArticles = [];
        const feedFetchStartMs = Date.now();

        for (const feed of feeds) {
            const feedUrl = getFetchUrlForFeed(feed);
            console.log(`📡 Fetching: ${feed.name}...`);
            if (feedUrl !== feed.url) {
                console.log(`   ℹ️  Using normalized feed URL for ${feed.name}: ${feedUrl}`);
            }

            const feedStartMs = Date.now();
            const { xmlString, lastError } = await fetchFeedXml({
                directTimeoutMs: FEED_FETCH_TIMEOUT_MS,
                feedName: feed.name,
                feedProxyUrl,
                feedUrl,
                proxyTimeoutMs: FEED_PROXY_TIMEOUT_MS,
            });

            // Minimale Feed-Dauer: sie beantwortet spaeter, welche Quelle das
            // Zeitbudget aufbraucht (O2b), ohne heute schon zu regeln.
            const attemptAt = new Date().toISOString();
            const feedDurationMs = Date.now() - feedStartMs;
            const baseEntry = {
                lastAttemptAt: attemptAt,
                lastSuccessAt: recorder.lastSuccessAtFor(feed.id),
                durationMs: feedDurationMs,
                articleCount: null,
                skippedItemCount: 0,
            };

            if (xmlString) {
                try {
                    const { articles: feedArticles, skipped } = parseFeedItems(xmlString, feed);
                    // Nur Anzahl und Grund - keine Titel, Adressen oder Inhalte.
                    const skippedNote = skipped.total > 0
                        ? ` ${skipped.total} item(s) skipped (${Object.entries(skipped.reasons)
                            .map(([reason, count]) => `${reason}: ${count}`)
                            .join(', ')}).`
                        : '';

                    if (feedArticles.length === 0) {
                        feedHealthStatus[feed.id] = {
                            ...baseEntry,
                            status: 'warning',
                            message: `Feed fetched successfully, but no articles were found.${skippedNote}`,
                            articleCount: 0,
                            skippedItemCount: skipped.total,
                        };
                    } else {
                        feedHealthStatus[feed.id] = {
                            ...baseEntry,
                            status: 'success',
                            message: `Successfully fetched and parsed ${feedArticles.length} articles.${skippedNote}`,
                            lastSuccessAt: attemptAt,
                            articleCount: feedArticles.length,
                            skippedItemCount: skipped.total,
                        };
                    }
                    newlyFetchedArticles.push(...feedArticles);
                    console.log(`   ✅ Parsed ${feedArticles.length} articles from ${feed.name} (${formatDuration(feedDurationMs)})${skippedNote}`);
                } catch (parseError) {
                    const message = parseError instanceof Error ? parseError.message : 'Unknown parse error';
                    console.error(`   ❌ Error parsing ${feed.name}: ${message}`);
                    feedHealthStatus[feed.id] = {
                        ...baseEntry,
                        status: 'error',
                        message: redactMessage(`Failed during parse. Error: ${message}`),
                    };
                }
            } else {
                console.error(`   ❌ Fetch failed for ${feed.name}. Error: ${lastError}`);
                feedHealthStatus[feed.id] = {
                    ...baseEntry,
                    status: 'error',
                    message: redactMessage(`Fetch failed. Error: ${lastError}`),
                };
            }
            await new Promise(r => setTimeout(r, 200));
        }

        durations.feedFetchMs = Date.now() - feedFetchStartMs;
        console.log(`\n📰 Total new articles fetched: ${newlyFetchedArticles.length} (${formatDuration(durations.feedFetchMs)})`);

        const cachedArticlesByIdentity = new Map();
        oldArticles.forEach(article => {
            if (article?.link) cachedArticlesByIdentity.set(`link:${article.link}`, article);
            if (article?.id) {
                const sourceKey = String(article.source || '').trim().toLowerCase();
                cachedArticlesByIdentity.set(`id:${sourceKey}:${article.id}`, article);
            }
        });

        let reusedCachedImageCount = 0;
        newlyFetchedArticles.forEach(article => {
            if (!article.needsScraping) return;

            const sourceKey = String(article.source || '').trim().toLowerCase();
            const cachedArticle =
                cachedArticlesByIdentity.get(`link:${article.link}`)
                || cachedArticlesByIdentity.get(`id:${sourceKey}:${article.id}`);

            if (cachedArticle && hasUsableStoredImage(cachedArticle)) {
                article.imageUrl = cachedArticle.imageUrl;
                article.needsScraping = false;
                reusedCachedImageCount++;
            }
        });
        if (reusedCachedImageCount > 0) {
            console.log(`\n♻️  Reused ${reusedCachedImageCount} valid cached image(s); skipped redundant page scraping.`);
        }

        const articlesNeedingScraping = newlyFetchedArticles.filter(a => a.needsScraping);
        const imageScrapeStartMs = Date.now();
        if (articlesNeedingScraping.length > 0) {
            console.log(`\n🔎 Scraping images for ${articlesNeedingScraping.length} articles...\n`);
            const scrapeStats = { found: 0, missing: 0, failed: 0, totalMs: 0 };
            for (const article of articlesNeedingScraping) {
                const articleScrapeStart = Date.now();
                try {
                    console.log(`   🖼️  Scraping: ${article.source} - ${article.title.substring(0, 40)}...`);
                    const scrapedImage = await getOgImageFromUrl(article.link, article.source);
                    const articleScrapeDuration = Date.now() - articleScrapeStart;
                    scrapeStats.totalMs += articleScrapeDuration;
                    if (scrapedImage) {
                        article.imageUrl = scrapedImage;
                        article.needsScraping = false;
                        scrapeStats.found++;
                        console.log(`      ✅ Found image (${formatDuration(articleScrapeDuration)})`);
                    } else {
                        scrapeStats.missing++;
                        console.log(`      ⚠️  No image found, using placeholder (${formatDuration(articleScrapeDuration)})`);
                    }
                    await new Promise(r => setTimeout(r, 500));
                } catch (error) {
                    const articleScrapeDuration = Date.now() - articleScrapeStart;
                    scrapeStats.totalMs += articleScrapeDuration;
                    scrapeStats.failed++;
                    console.error(`      ❌ Scraping failed after ${formatDuration(articleScrapeDuration)}: ${error.message}`);
                }
            }
            console.log(`\n🔎 Image scraping summary: ${scrapeStats.found} found, ${scrapeStats.missing} placeholders, ${scrapeStats.failed} failed in ${formatDuration(scrapeStats.totalMs)} active scraping time.\n`);
        }
        durations.imageScrapeMs = Date.now() - imageScrapeStartMs;

        newlyFetchedArticles = newlyFetchedArticles.map(article => {
            if (!article.imageUrl) article.imageUrl = getPlaceholderImageUrl(article.source);
            delete article.needsScraping;
            return article;
        });

        const newlyFetchedLinks = new Set(newlyFetchedArticles.map(article => article.link).filter(Boolean));
        const backfillSourceCounts = new Map();
        const imageBackfillArticles = oldArticles
            .filter(article => article?.link && needsStoredImageRepair(article) && !newlyFetchedLinks.has(article.link))
            .filter(article => {
                const source = article.source || 'Unknown';
                const currentCount = backfillSourceCounts.get(source) || 0;
                if (currentCount >= IMAGE_BACKFILL_PER_SOURCE_LIMIT) return false;
                backfillSourceCounts.set(source, currentCount + 1);
                return true;
            })
            .slice(0, IMAGE_BACKFILL_LIMIT);

        const imageBackfillStartMs = Date.now();
        if (imageBackfillArticles.length > 0) {
            console.log(`\n🧩 Backfilling images for ${imageBackfillArticles.length} old articles with missing or invalid images...\n`);
            const backfillStats = { found: 0, missing: 0, failed: 0, totalMs: 0 };
            for (const article of imageBackfillArticles) {
                const articleBackfillStart = Date.now();
                try {
                    console.log(`   🖼️  Backfill: ${article.source} - ${article.title.substring(0, 40)}...`);
                    const scrapedImage = await getOgImageFromUrl(article.link, article.source);
                    const articleBackfillDuration = Date.now() - articleBackfillStart;
                    backfillStats.totalMs += articleBackfillDuration;
                    if (scrapedImage) {
                        article.imageUrl = scrapedImage;
                        backfillStats.found++;
                        console.log(`      ✅ Backfilled image (${formatDuration(articleBackfillDuration)})`);
                    } else {
                        backfillStats.missing++;
                        console.log(`      ⚠️  Still no image found (${formatDuration(articleBackfillDuration)})`);
                    }
                    await new Promise(r => setTimeout(r, 500));
                } catch (error) {
                    const articleBackfillDuration = Date.now() - articleBackfillStart;
                    backfillStats.totalMs += articleBackfillDuration;
                    backfillStats.failed++;
                    console.error(`      ❌ Backfill failed after ${formatDuration(articleBackfillDuration)}: ${error.message}`);
                }
            }
            console.log(`\n🧩 Image backfill summary: ${backfillStats.found} found, ${backfillStats.missing} still missing, ${backfillStats.failed} failed in ${formatDuration(backfillStats.totalMs)} active backfill time.\n`);
        } else {
            console.log(`\n🧩 No old articles need image backfill.\n`);
        }
        durations.imageBackfillMs = Date.now() - imageBackfillStartMs;

        console.log('\n🔄 Merging, pruning, and sorting articles...');
        const uniqueArticlesMap = new Map();
        [...oldArticles, ...newlyFetchedArticles].forEach(article => {
            if (article.id && article.title && article.publicationDate) {
                // Use link (URL) as key to avoid duplicates when title changes
                const key = article.link;
                const existing = uniqueArticlesMap.get(key);
                if (!existing) {
                    uniqueArticlesMap.set(key, article); 
                } else {
                    // Keep updated article metadata, but do not replace a real image with a placeholder.
                    uniqueArticlesMap.set(key, {
                        ...existing,
                        ...article,
                        imageUrl: chooseMergedImageUrl(existing, article),
                    });
                }
            }
        });
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - ARTICLE_RETENTION_DAYS);
        const articlesToKeep = Array.from(uniqueArticlesMap.values()).filter(article => new Date(article.publicationDate) >= cutoffDate);
        console.log(`   - Total unique articles: ${uniqueArticlesMap.size}`);
        console.log(`   - Articles after pruning (older than ${ARTICLE_RETENTION_DAYS} days): ${articlesToKeep.length}`);
        
        // Sort by publication date (newest first)
        let sortedArticles = articlesToKeep.sort((a, b) => new Date(b.publicationDate).getTime() - new Date(a.publicationDate).getTime());
        
        // Limit to MAX_ARTICLES to prevent Vercel KV size limit (10 MB)
        if (sortedArticles.length > MAX_ARTICLES) {
            console.log(`   ⚠️  Limiting from ${sortedArticles.length} to ${MAX_ARTICLES} articles (KV size limit)`);
            sortedArticles = sortedArticles.slice(0, MAX_ARTICLES);
        }

        console.log('\n💾 Saving data to Vercel KV...');
        const publishStartMs = Date.now();

        // Save full cache
        await kv.set('news_cache', sortedArticles);
        console.log(`   ✅ Saved ${sortedArticles.length} articles to KV key 'news_cache'`);

        // Save progressive loading caches for faster page load
        await kv.set('news_cache_16', sortedArticles.slice(0, 16));
        console.log(`   ⚡ Saved 16 preview articles to KV key 'news_cache_16'`);

        await kv.set('news_cache_64', sortedArticles.slice(0, 64));
        console.log(`   ⚡ Saved 64 medium articles to KV key 'news_cache_64'`);

        durations.publishMs = Date.now() - publishStartMs;
        durations.totalMs = Date.now() - runStartMs;

        // Erst ab hier gilt der Kern-Publish als erfolgt. Der Versuch bleibt
        // trotzdem `running`, weil die Trendphase noch aussteht.
        const publish = await recorder.recordCorePublish({
            feedHealth: feedHealthStatus,
            articleCount: sortedArticles.length,
            newestArticleAt: sortedArticles[0]?.publicationDate ?? null,
            durations,
        });

        if (publish) {
            console.log(
                `   🫀 Kern-Publish ${publish.lastCorePublishAt}, `
                + `Inhaltsstand ${publish.lastContentUpdateAt ?? 'unbekannt'}, `
                + `Feeds ${publish.feeds.success}/${publish.feeds.total} mit Artikeln`,
            );
        }

        // Generate trends with Groq AI (respects cache TTL)
        const trendsStartMs = Date.now();
        await generateAndSaveTrends(sortedArticles);
        durations.trendsMs = Date.now() - trendsStartMs;

        // Erst jetzt ist der Lauf wirklich durch und bekommt sein `finishedAt`.
        await recorder.finish({
            feedHealth: feedHealthStatus,
            durations: { ...durations, totalMs: Date.now() - runStartMs },
        });

    } catch (error) {
        console.error('\n❌ Fatal error in fetch script:', error);

        // Ein gescheiterter Versuch fasst den gespeicherten Kern-Publish nie an
        // und schreibt den Feed-Status nur, wenn die Feed-Liste geladen war.
        // Scheitert auch das Festhalten des Abbruchs, bleibt es beim
        // urspruenglichen Fehler: der Exit-Code ist wichtiger als das Protokoll.
        try {
            await recorder.recordFatal({
                error,
                feedHealth: feedHealthStatus,
                durations: { ...durations, totalMs: Date.now() - runStartMs },
            });
        } catch (recorderError) {
            console.error(`   ⚠️  Abbruch konnte nicht festgehalten werden: ${redactMessage(
                recorderError instanceof Error ? recorderError.message : String(recorderError),
            )}`);
        }
        process.exit(1);
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    main();
}
