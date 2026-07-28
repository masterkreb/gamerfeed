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
import { readFeedRunConfiguration } from './feed-run-config.js';
import { parseGroqJsonContent, requestGroqCompletion } from './groq-client.js';
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
    isProxyEligibleSource,
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

function stripHtmlAndTruncate(html, length = 150, { logger = console } = {}) {
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
    } catch (error) {
        // Niemals das rohe Fehlerobjekt: sein Text kann den Artikelinhalt
        // enthalten, der hier gerade verarbeitet wird.
        logger.warn(`   ⚠️  Zusammenfassung konnte nicht gekürzt werden: ${redactMessage(
            error instanceof Error ? error.message : String(error),
        )}`);
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
 * Zerlegt einen Feed und meldet zusaetzlich, was dabei nicht geklappt hat.
 *
 * Ein einzelnes kaputtes Element darf den Feed nicht mitreissen: fruehere
 * Laeufe haben an einem ungueltigen `pubDate` die komplette Quelle verloren,
 * weil `new Date(...).toISOString()` aus der Schleife heraus geworfen hat.
 *
 * Die beiden Zaehler sind bewusst getrennt:
 *
 * - `skipped`  – das Element wurde **nicht** uebernommen. Gruende: `incomplete`,
 *                `invalid_date`, `invalid_link`, `item_error`.
 * - `warnings` – das Element **ist** im Ergebnis, aber ein Feld war unbrauchbar.
 *                Bislang einzig `invalid_image`; der Artikel bekommt spaeter
 *                einen Platzhalter.
 *
 * Beide enthalten nur Grund und Anzahl - niemals Titel, Adressen oder Inhalte.
 *
 * @param {string} xmlString
 * @param {object} feed
 * @param {{ logger?: { log?: Function, warn?: Function, error?: Function } }} [options]
 *   `logger` nimmt die Meldungen entgegen; ohne Angabe `console`.
 * @returns {{
 *   articles: object[],
 *   skipped: { total: number, reasons: Record<string, number> },
 *   warnings: { total: number, reasons: Record<string, number> },
 * }}
 */
export function parseFeedItems(xmlString, feed, { logger = console } = {}) {
    if (!isFeedXml(xmlString)) {
        throw new Error(`Response is not a valid RSS or Atom feed: ${feed.url}`);
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");
    const errorNode = doc.querySelector("parsererror");
    if (errorNode) {
        // Der Parserfehler kann Feedinhalte mitfuehren; nur der Name der Quelle
        // ist hier von Nutzen.
        logger.error(`   ❌ XML Parsing Error für ${feed?.name ?? 'Feed'}`);
        throw new Error(`Failed to parse XML for feed: ${feed.url}`);
    }

    const articles = [];
    // Zwei getrennte Zaehler, weil es zwei verschiedene Aussagen sind:
    //
    // - `skipped`  = das Element wurde **nicht** uebernommen;
    // - `warnings` = das Element ist drin, aber ein Feld war unbrauchbar
    //                (bisher einzig: eine abgelehnte Bildadresse).
    //
    // Vorher liefen beide in einen Zaehler. Der meldete dann „verworfen" fuer
    // Artikel, die sehr wohl im Cache landeten.
    //
    // Gespeichert wird nur der Grund - Titel, Adressen und Inhalte gehoeren
    // nicht in eine Fehlerauswertung.
    const skippedReasons = {};
    const warningReasons = {};
    const skip = reason => {
        skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
    };
    const warn = reason => {
        warningReasons[reason] = (warningReasons[reason] ?? 0) + 1;
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
        const summary = stripHtmlAndTruncate(description, 150, { logger });


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
            // Der Artikel bleibt erhalten und bekommt spaeter einen Platzhalter -
            // das ist keine Verwerfung.
            warn('invalid_image');
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
                        logger.warn(`Could not parse image URL for optimization: ${processedUrl}`);
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
                logger.warn(`   ⚠️  Bildadresse konnte nicht optimiert werden: ${redactMessage(e?.message ?? String(e))}`);
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

    const countReasons = reasons => Object.values(reasons).reduce((sum, count) => sum + count, 0);
    const describeReasons = reasons => Object.entries(reasons)
        .map(([reason, count]) => `${reason}: ${count}`)
        .join(', ');

    const skippedTotal = countReasons(skippedReasons);
    const warningTotal = countReasons(warningReasons);
    const feedLabel = feed?.name ?? 'Feed';

    if (skippedTotal > 0) {
        logger.warn(`   ⚠️  ${skippedTotal} Element(e) aus ${feedLabel} verworfen (${describeReasons(skippedReasons)})`);
    }
    if (warningTotal > 0) {
        logger.warn(`   ⚠️  ${warningTotal} Element(e) aus ${feedLabel} mit Feldwarnung übernommen (${describeReasons(warningReasons)})`);
    }

    return {
        articles,
        skipped: { total: skippedTotal, reasons: skippedReasons },
        warnings: { total: warningTotal, reasons: warningReasons },
    };
}

/**
 * Rueckwaertskompatible Fassung: liefert nur die Artikel.
 *
 * Bestehende Aufrufer und Tests arbeiten unveraendert weiter; wer die Zaehler
 * `skipped` und `warnings` braucht, nimmt `parseFeedItems`.
 *
 * @param {string} xmlString
 * @param {object} feed
 * @param {{ logger?: { log?: Function, warn?: Function, error?: Function } }} [options]
 * @returns {object[]}
 */
export function parseRssXml(xmlString, feed, options) {
    return parseFeedItems(xmlString, feed, options).articles;
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
async function generateDailyTrendsWithGroq(articles, { groqApiKey, groqFetch, logger = console } = {}) {
    // Der Schluessel kommt aus der Vorpruefung, nicht mehr direkt aus der
    // Umgebung: dort ist bereits entschieden, ob er brauchbar ist.
    const GROQ_API_KEY = groqApiKey;
    if (!GROQ_API_KEY) {
        logger.log('   ⚠️  GROQ_API_KEY not found. Skipping trend generation.');
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
        logger.log(`   🔄 Removed ${duplicatesRemoved} duplicate articles from same publisher groups for trend analysis`);
    }

    // WICHTIG: Limit auf 80 Titel, um das 6k Token Limit von Groq zu vermeiden
    const MAX_TITLES = 80;
    const titles = deduplicatedArticles.map(a => a.title).slice(0, MAX_TITLES);

    logger.log(`   📊 Analyzing ${titles.length} unique titles (from ${filteredArticles.length} articles) for daily trends...`);

    if (titles.length === 0) {
        logger.log('   ⚠️  No articles found for daily trends.');
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

    const { content } = await requestGroqCompletion({
        apiKey: GROQ_API_KEY,
        fetchImpl: groqFetch,
        messages: [
            { role: 'system', content: 'Du bist ein Gaming-News-Analyst. Antworte immer nur mit validem JSON, ohne Markdown-Formatierung oder Erklärungen.' },
            { role: 'user', content: prompt },
        ],
        maxTokens: 1500,
        logger,
        redact: redactMessage,
    });

    if (content === null) {
        return null;
    }

    const trends = parseGroqJsonContent(content);
    if (!Array.isArray(trends)) {
        logger.error('   ❌ Groq daily trends are not a JSON array. Skipping.');
        return null;
    }

    // Sort by articleCount descending (highest first)
    return trends
        .slice(0, 5)
        .sort((a, b) => b.articleCount - a.articleCount);
}

// Generate weekly trends by aggregating 7 days of archived daily trends
async function generateWeeklyTrendsFromArchive({ groqApiKey, groqFetch, logger = console, store } = {}) {
    logger.log('   🔄 Generating weekly trends from 7-day archive...');
    const GROQ_API_KEY = groqApiKey;

    if (!GROQ_API_KEY) {
        logger.log('   ⚠️  GROQ_API_KEY not found. Skipping weekly trend aggregation.');
        return null;
    }

    // 1. Load 7 days of archived daily trends
    const archiveData = [];
    const datesFound = [];
    for (let i = 0; i < 7; i++) {
        const dateKey = getDateKey(i);
        const cachedDay = await store.get(`daily_trends_archive:${dateKey}`);

        if (cachedDay && cachedDay.trends && cachedDay.trends.length > 0) {
            datesFound.push(dateKey);
            archiveData.push(...cachedDay.trends.map(t => ({
                ...t,
                date: dateKey
            })));
        }
    }

    if (archiveData.length < 5) {
        logger.log(`   ⚠️  Not enough archive data found (${archiveData.length} entries). Need at least 5 days.`);
        return null;
    }

    logger.log(`   📦 Loaded ${archiveData.length} trend entries from ${datesFound.length} days.`);

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

    logger.log(`   📊 Aggregated ${Object.keys(aggregatedTrends).length} unique topics for this week.`);

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

    const { content } = await requestGroqCompletion({
        apiKey: GROQ_API_KEY,
        fetchImpl: groqFetch,
        messages: [
            { role: 'system', content: 'Du bist ein Gaming-News-Analyst. Analysiere die Trends dieser Woche (NICHT kumulativ). Gib nur valides JSON zurück.' },
            { role: 'user', content: prompt },
        ],
        maxTokens: 2000,
        logger,
        redact: redactMessage,
    });

    if (content === null) {
        return null;
    }

    const weeklyData = parseGroqJsonContent(content);
    if (!weeklyData || typeof weeklyData !== 'object' || Array.isArray(weeklyData)) {
        logger.error('   ❌ Groq weekly trends are not a JSON object. Skipping.');
        return null;
    }

    // Return the full object with overallSummary, trends, and dateRange
    return {
        overallSummary: typeof weeklyData.overallSummary === 'string' ? weeklyData.overallSummary : '',
        trends: Array.isArray(weeklyData.trends) ? weeklyData.trends.slice(0, 5) : [],
        dateRange
    };
}

async function generateAndSaveTrends(articles, { groqApiKey, groqFetch, logger = console, store } = {}) {
    logger.log('\n🧠 Starting Groq AI Trend Analysis...');

    const GROQ_API_KEY = groqApiKey;
    if (!GROQ_API_KEY) {
        // Kein Schluessel heisst: keine Trends. Der Kernlauf ist davon
        // unberuehrt und bleibt erfolgreich.
        logger.log('   ⚠️  GROQ_API_KEY not configured. Skipping trend generation.');
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
        const cachedDaily = await store.get('daily_trends');
        const cachedArchive = await store.get(`daily_trends_archive:${todayKey}`);

        let shouldRegenerate = true;

        if (cachedDaily && cachedDaily.updatedAt) {
            const cacheAge = (now.getTime() - new Date(cachedDaily.updatedAt).getTime()) / 1000;
            if (cacheAge < DAILY_CACHE_TTL) {
                logger.log(`   📦 Daily trends cache still fresh (${Math.round(cacheAge / 60)} min old). Skipping.`);
                dailyTrends = cachedDaily.trends;
                dailyUpdatedAt = cachedDaily.updatedAt;
                shouldRegenerate = false;
            }
        }

        if (shouldRegenerate) {
            logger.log('   🔄 Daily trends cache expired or missing. Regenerating...');
            dailyTrends = await generateDailyTrendsWithGroq(articles, { groqApiKey, groqFetch, logger });
            dailyUpdatedAt = now.toISOString();

            if (dailyTrends) {
                // Save to LIVE cache
                await store.set('daily_trends', { trends: dailyTrends, updatedAt: dailyUpdatedAt });
                logger.log('   ✅ Daily trends saved to LIVE cache.');
            }
        }

        // Archive today's trends (only once per day)
        if (dailyTrends && dailyTrends.length > 0 && !cachedArchive) {
            await store.set(`daily_trends_archive:${todayKey}`, { trends: dailyTrends, updatedAt: dailyUpdatedAt });
            logger.log(`   📁 Daily trends archived: daily_trends_archive:${todayKey}`);
        } else if (cachedArchive) {
            logger.log(`   📦 Archive for ${todayKey} already exists. Skipping archive.`);
        }

    } catch (error) {
        logger.error(`   ❌ Error processing daily trends: ${redactMessage(error?.message ?? String(error))}`);
    }

    // --- WEEKLY TRENDS (from archive aggregation) ---
    try {
        const cachedWeekly = await store.get('weekly_trends');
        let shouldRegenerateWeekly = true;

        if (cachedWeekly && cachedWeekly.updatedAt) {
            const cacheAge = (now.getTime() - new Date(cachedWeekly.updatedAt).getTime()) / 1000;
            if (cacheAge < WEEKLY_CACHE_TTL) {
                logger.log(`   📦 Weekly trends cache still fresh (${Math.round(cacheAge / 60)} min old). Skipping.`);
                shouldRegenerateWeekly = false;
            }
        }

        if (shouldRegenerateWeekly) {
            logger.log('   🔄 Weekly trends cache expired or missing. Regenerating from archive...');
            const weeklyData = await generateWeeklyTrendsFromArchive({ groqApiKey, groqFetch, logger, store });

            if (weeklyData && weeklyData.trends) {
                await store.set('weekly_trends', {
                    trends: weeklyData.trends,
                    overallSummary: weeklyData.overallSummary || '',
                    dateRange: weeklyData.dateRange || null,
                    updatedAt: now.toISOString()
                });
                logger.log('   ✅ Weekly trends with summary aggregated and saved to KV.');
            } else {
                logger.log('   ⚠️  Weekly trends could not be generated. Keeping old cache if exists.');
            }
        }

    } catch (error) {
        logger.error(`   ❌ Error processing weekly trends: ${redactMessage(error?.message ?? String(error))}`);
    }

    logger.log('   🧠 Trend analysis complete!\n');
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

// Quelle der zu bereinigenden Werte.
//
// `redactMessage` wird an vielen Stellen als fertige Funktion weitergereicht
// (unter anderem an den Recorder und den Groq-Client) und kann die Umgebung
// deshalb nicht als Parameter bekommen. `main()` setzt sie stattdessen einmal
// zu Beginn - so wirkt die Bereinigung auch auf eine injizierte Umgebung.
let secretEnv = process.env;

// Fehlermeldungen von Postgres, KV, Groq oder dem Feed-Proxy tragen die
// Zieladresse oft im Klartext. Alles, was im Admin-Panel oder im Log landet,
// wird deshalb vorher um die konfigurierten Werte bereinigt.
function redactMessage(message) {
    const secrets = [
        secretEnv.POSTGRES_URL,
        secretEnv.KV_REST_API_URL,
        secretEnv.KV_REST_API_TOKEN,
        secretEnv.GROQ_API_KEY,
        secretEnv.FEED_PROXY_URL,
    ].filter(value => typeof value === 'string' && value !== '');

    return sanitizeErrorMessage(message, { secrets }) ?? '';
}

// === MAIN SCRIPT LOGIC ===
/**
 * Fuehrt einen vollstaendigen Cron-Lauf aus.
 *
 * Alle aeusseren Abhaengigkeiten sind injizierbar, damit die Orchestrierung
 * pruefbar ist - insbesondere die Zusage, dass vor einer gescheiterten
 * Konfigurationspruefung **kein** SQL-, KV-, Recorder- oder HTTP-Zugriff
 * stattfindet.
 */
export async function main({
    env = process.env,
    store = kv,
    database = sql,
    createRecorder = createFeedRunRecorder,
    // Ohne eigenes fetchImpl/lookup gilt der an geprüfte Adressen gebundene
    // Transport aus scripts/outbound-policy.js.
    fetchImpl,
    lookup,
    groqFetch,
    exit = code => process.exit(code),
    logger = console,
} = {}) {
    // === Vorpruefung: laeuft vor jeder Verbindung ===
    //
    // Bewusst als Allererstes, noch vor dem Heartbeat. Ein Lauf ohne
    // Core-Konfiguration soll gar nicht erst anfangen: er koennte weder lesen
    // noch speichern und wuerde nur einen halben Zustand hinterlassen.
    secretEnv = env;
    const configuration = readFeedRunConfiguration(env);
    if (!configuration.ok) {
        logger.error(`\n❌ ${configuration.fatalMessage}`);
        return exit(1);
    }

    for (const skipReason of configuration.skipped) {
        logger.log(`   ⚠️  Optionale Funktion übersprungen: ${skipReason}`);
    }

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
    // Secret laeuft der Abruf ohne Fallback, statt fehlzuschlagen; eine
    // unbrauchbare Adresse wurde oben bereits verworfen.
    const feedProxyUrl = configuration.feedProxyUrl;

    const runStartMs = Date.now();
    const durations = {};
    const recorder = createRecorder({
        store,
        runId: createRunId(),
        startedAt: new Date(),
        // Ohne diese Zeile faellt der Recorder auf `console` zurueck und seine
        // Warnungen ("Feed-Status wird nicht geschrieben ...") laufen an der
        // Injektion vorbei - genau daran scheitert jede Secret-Pruefung.
        logger,
        redact: redactMessage,
    });

    logger.log(`\n🫀 Lauf ${recorder.runId} gestartet um ${recorder.startedAt}`);
    await recorder.begin();

    try {
        // Diagnosedaten: ein Lesefehler darf den Kernlauf nicht verhindern. Er
        // verhindert nur, dass ein nicht sicher gelesener historischer Stand
        // spaeter mit Ersatzwerten ueberschrieben wird.
        await recorder.loadPreviousState();

        let oldArticles = [];
        try {
            const cachedData = await store.get('news_cache');

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
                logger.log(`\n📦 Loaded ${oldArticles.length} articles from existing KV cache.`);
                if (sanitizedImageCount > 0) {
                    logger.log(`   🧹 Replaced ${sanitizedImageCount} cached UI icon image(s) with placeholders.`);
                }

                // If cache is empty (null or undefined), it's safe to start fresh.
            } else if (!cachedData) {
                logger.log(`ℹ️  No existing cache found in KV. Starting fresh.`);

                // If cache exists but is NOT a valid array (corrupted), abort to prevent data loss.
            } else {
                throw new Error(`Existing cache data from KV is corrupted (not an array). Aborting to prevent data loss.`);
            }
        } catch (e) {
            // A failure to read the cache or finding a corrupted cache is a critical error.
            // Abort the script to prevent overwriting the existing cache with incomplete data.
            logger.error(`\n❌ CRITICAL: Failed to process Vercel KV cache. Aborting script to prevent data loss.`);
            logger.error(`   Error details: ${redactMessage(e?.message ?? String(e))}`);
            // Re-throw the error to ensure the GitHub Action fails and we get notified.
            throw e;
        }

        const { rows: feeds } = await database`SELECT * FROM feeds;`;
        logger.log(`\n🔍 Found ${feeds.length} feeds in database\n`);
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
            logger.log(`📡 Fetching: ${feed.name}...`);
            if (feedUrl !== feed.url) {
                logger.log(`   ℹ️  Using normalized feed URL for ${feed.name}: ${feedUrl}`);
            }

            const feedStartMs = Date.now();
            const { xmlString, lastError } = await fetchFeedXml({
                // Nur ausdrücklich vorgesehene Quellen dürfen über den Proxy.
                allowProxy: isProxyEligibleSource(feed),
                directTimeoutMs: FEED_FETCH_TIMEOUT_MS,
                feedName: feed.name,
                feedProxyUrl,
                feedUrl,
                fetchImpl,
                logger,
                lookup,
                proxyTimeoutMs: FEED_PROXY_TIMEOUT_MS,
                redact: redactMessage,
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
                    const { articles: feedArticles, skipped, warnings } = parseFeedItems(xmlString, feed, { logger });
                    // Nur Anzahl und Grund - keine Titel, Adressen oder Inhalte.
                    // Verworfene Elemente und Feldwarnungen bleiben getrennt:
                    // ein Artikel mit abgelehntem Bild ist im Cache, nur ohne Bild.
                    const describeCounts = reasons => Object.entries(reasons)
                        .map(([reason, count]) => `${reason}: ${count}`)
                        .join(', ');
                    const skippedNote = skipped.total > 0
                        ? ` ${skipped.total} item(s) skipped (${describeCounts(skipped.reasons)}).`
                        : '';
                    const warningNote = warnings.total > 0
                        ? ` ${warnings.total} item(s) kept with field warnings (${describeCounts(warnings.reasons)}).`
                        : '';

                    if (feedArticles.length === 0) {
                        feedHealthStatus[feed.id] = {
                            ...baseEntry,
                            status: 'warning',
                            message: `Feed fetched successfully, but no articles were found.${skippedNote}${warningNote}`,
                            articleCount: 0,
                            skippedItemCount: skipped.total,
                        };
                    } else {
                        feedHealthStatus[feed.id] = {
                            ...baseEntry,
                            status: 'success',
                            message: `Successfully fetched and parsed ${feedArticles.length} articles.${skippedNote}${warningNote}`,
                            lastSuccessAt: attemptAt,
                            articleCount: feedArticles.length,
                            skippedItemCount: skipped.total,
                        };
                    }
                    newlyFetchedArticles.push(...feedArticles);
                    logger.log(`   ✅ Parsed ${feedArticles.length} articles from ${feed.name} (${formatDuration(feedDurationMs)})${skippedNote}${warningNote}`);
                } catch (parseError) {
                    const message = parseError instanceof Error ? parseError.message : 'Unknown parse error';
                    logger.error(`   ❌ Error parsing ${feed.name}: ${redactMessage(message)}`);
                    feedHealthStatus[feed.id] = {
                        ...baseEntry,
                        status: 'error',
                        message: redactMessage(`Failed during parse. Error: ${message}`),
                    };
                }
            } else {
                logger.error(`   ❌ Fetch failed for ${feed.name}. Error: ${redactMessage(String(lastError))}`);
                feedHealthStatus[feed.id] = {
                    ...baseEntry,
                    status: 'error',
                    message: redactMessage(`Fetch failed. Error: ${lastError}`),
                };
            }
            await new Promise(r => setTimeout(r, 200));
        }

        durations.feedFetchMs = Date.now() - feedFetchStartMs;
        logger.log(`\n📰 Total new articles fetched: ${newlyFetchedArticles.length} (${formatDuration(durations.feedFetchMs)})`);

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
            logger.log(`\n♻️  Reused ${reusedCachedImageCount} valid cached image(s); skipped redundant page scraping.`);
        }

        const articlesNeedingScraping = newlyFetchedArticles.filter(a => a.needsScraping);
        const imageScrapeStartMs = Date.now();
        if (articlesNeedingScraping.length > 0) {
            logger.log(`\n🔎 Scraping images for ${articlesNeedingScraping.length} articles...\n`);
            const scrapeStats = { found: 0, missing: 0, failed: 0, totalMs: 0 };
            for (const article of articlesNeedingScraping) {
                const articleScrapeStart = Date.now();
                try {
                    logger.log(`   🖼️  Scraping: ${article.source} - ${article.title.substring(0, 40)}...`);
                    const scrapedImage = await getOgImageFromUrl(article.link, article.source, { fetchImpl, logger, lookup });
                    const articleScrapeDuration = Date.now() - articleScrapeStart;
                    scrapeStats.totalMs += articleScrapeDuration;
                    if (scrapedImage) {
                        article.imageUrl = scrapedImage;
                        article.needsScraping = false;
                        scrapeStats.found++;
                        logger.log(`      ✅ Found image (${formatDuration(articleScrapeDuration)})`);
                    } else {
                        scrapeStats.missing++;
                        logger.log(`      ⚠️  No image found, using placeholder (${formatDuration(articleScrapeDuration)})`);
                    }
                    await new Promise(r => setTimeout(r, 500));
                } catch (error) {
                    const articleScrapeDuration = Date.now() - articleScrapeStart;
                    scrapeStats.totalMs += articleScrapeDuration;
                    scrapeStats.failed++;
                    logger.error(`      ❌ Scraping failed after ${formatDuration(articleScrapeDuration)}: ${redactMessage(error?.message ?? String(error))}`);
                }
            }
            logger.log(`\n🔎 Image scraping summary: ${scrapeStats.found} found, ${scrapeStats.missing} placeholders, ${scrapeStats.failed} failed in ${formatDuration(scrapeStats.totalMs)} active scraping time.\n`);
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
            logger.log(`\n🧩 Backfilling images for ${imageBackfillArticles.length} old articles with missing or invalid images...\n`);
            const backfillStats = { found: 0, missing: 0, failed: 0, totalMs: 0 };
            for (const article of imageBackfillArticles) {
                const articleBackfillStart = Date.now();
                try {
                    logger.log(`   🖼️  Backfill: ${article.source} - ${article.title.substring(0, 40)}...`);
                    const scrapedImage = await getOgImageFromUrl(article.link, article.source, { fetchImpl, logger, lookup });
                    const articleBackfillDuration = Date.now() - articleBackfillStart;
                    backfillStats.totalMs += articleBackfillDuration;
                    if (scrapedImage) {
                        article.imageUrl = scrapedImage;
                        backfillStats.found++;
                        logger.log(`      ✅ Backfilled image (${formatDuration(articleBackfillDuration)})`);
                    } else {
                        backfillStats.missing++;
                        logger.log(`      ⚠️  Still no image found (${formatDuration(articleBackfillDuration)})`);
                    }
                    await new Promise(r => setTimeout(r, 500));
                } catch (error) {
                    const articleBackfillDuration = Date.now() - articleBackfillStart;
                    backfillStats.totalMs += articleBackfillDuration;
                    backfillStats.failed++;
                    logger.error(`      ❌ Backfill failed after ${formatDuration(articleBackfillDuration)}: ${redactMessage(error?.message ?? String(error))}`);
                }
            }
            logger.log(`\n🧩 Image backfill summary: ${backfillStats.found} found, ${backfillStats.missing} still missing, ${backfillStats.failed} failed in ${formatDuration(backfillStats.totalMs)} active backfill time.\n`);
        } else {
            logger.log(`\n🧩 No old articles need image backfill.\n`);
        }
        durations.imageBackfillMs = Date.now() - imageBackfillStartMs;

        logger.log('\n🔄 Merging, pruning, and sorting articles...');
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
        logger.log(`   - Total unique articles: ${uniqueArticlesMap.size}`);
        logger.log(`   - Articles after pruning (older than ${ARTICLE_RETENTION_DAYS} days): ${articlesToKeep.length}`);
        
        // Sort by publication date (newest first)
        let sortedArticles = articlesToKeep.sort((a, b) => new Date(b.publicationDate).getTime() - new Date(a.publicationDate).getTime());
        
        // Limit to MAX_ARTICLES to prevent Vercel KV size limit (10 MB)
        if (sortedArticles.length > MAX_ARTICLES) {
            logger.log(`   ⚠️  Limiting from ${sortedArticles.length} to ${MAX_ARTICLES} articles (KV size limit)`);
            sortedArticles = sortedArticles.slice(0, MAX_ARTICLES);
        }

        logger.log('\n💾 Saving data to Vercel KV...');
        const publishStartMs = Date.now();

        // Save full cache
        await store.set('news_cache', sortedArticles);
        logger.log(`   ✅ Saved ${sortedArticles.length} articles to KV key 'news_cache'`);

        // Save progressive loading caches for faster page load
        await store.set('news_cache_16', sortedArticles.slice(0, 16));
        logger.log(`   ⚡ Saved 16 preview articles to KV key 'news_cache_16'`);

        await store.set('news_cache_64', sortedArticles.slice(0, 64));
        logger.log(`   ⚡ Saved 64 medium articles to KV key 'news_cache_64'`);

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
            logger.log(
                `   🫀 Kern-Publish ${publish.lastCorePublishAt}, `
                + `Inhaltsstand ${publish.lastContentUpdateAt ?? 'unbekannt'}, `
                + `Feeds ${publish.feeds.success}/${publish.feeds.total} mit Artikeln`,
            );
        }

        // Generate trends with Groq AI (respects cache TTL).
        //
        // Trends sind eine optionale Zusatzfunktion und laufen nach dem
        // Kern-Publish. Ein Providerfehler darf einen bereits veroeffentlichten
        // Lauf nicht nachtraeglich zu `fatal` machen - deshalb endet die Phase
        // hier und nicht im aeusseren catch.
        const trendsStartMs = Date.now();
        try {
            await generateAndSaveTrends(sortedArticles, { groqApiKey: configuration.groqApiKey, groqFetch, logger, store });
        } catch (trendsError) {
            logger.warn(`   ⚠️  Trendphase übersprungen: ${redactMessage(
                trendsError instanceof Error ? trendsError.message : String(trendsError),
            )}`);
        }
        durations.trendsMs = Date.now() - trendsStartMs;

        // Erst jetzt ist der Lauf wirklich durch und bekommt sein `finishedAt`.
        await recorder.finish({
            feedHealth: feedHealthStatus,
            durations: { ...durations, totalMs: Date.now() - runStartMs },
        });

    } catch (error) {
        // Niemals das rohe Fehlerobjekt: ein SQL- oder KV-Fehler traegt
        // Verbindungszeichenfolge samt Zugangsdaten im Text und im Stack.
        logger.error(`\n❌ Fatal error in fetch script: ${redactMessage(
            error instanceof Error ? error.message : String(error),
        )}`);

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
            logger.error(`   ⚠️  Abbruch konnte nicht festgehalten werden: ${redactMessage(
                recorderError instanceof Error ? recorderError.message : String(recorderError),
            )}`);
        }
        return exit(1);
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    main();
}
