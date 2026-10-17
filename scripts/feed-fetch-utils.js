import { DOMParser } from 'linkedom';
import { readLimitedResponseText, ResponseTooLargeError } from './limited-response.js';
import {
    fetchWithOutboundPolicy,
    OutboundPolicyError,
    UrlPolicyError,
} from './outbound-policy.js';

export const BROWSER_LIKE_HEADERS = Object.freeze({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    // Deliberately without zstd: undici cannot decode it, Chrome offers it.
    'Accept-Encoding': 'gzip, deflate, br',
    'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
});

export const MAX_FEED_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * Quellen, fuer die der externe PHP-Proxy ueberhaupt versucht werden darf.
 *
 * GamePro, GameStar, Play3 und PlayFront beantworten Anfragen aus dem
 * GitHub-Actions-Netz mit HTTP 403 - dafuer gibt es den Proxy. Alle anderen
 * Quellen sind direkt erreichbar; ein
 * gewoehnlicher Timeout ist dort ein voruebergehendes Problem der Quelle und
 * kein Grund, den Umweg ueber fremdes Hosting zu nehmen.
 *
 * Grundregel: nur gelistete Quellen duerfen den Proxy nutzen, und auch sie erst
 * nach einem fehlgeschlagenen Direktabruf. Die Eintraege sind klein
 * geschrieben, weil isProxyEligibleSource id und name getrimmt und klein
 * geschrieben vergleicht. Eine neue Quelle braucht zusaetzlich einen exakten
 * Eintrag in der Allowlist von tools/feed-proxy.php.
 *
 * Die Liste steht bewusst hier und nicht im PHP-Skript: die Entscheidung gehoert
 * auf diese Seite und darf nicht von der Gegenstelle abhaengen. Die exakte
 * Allowlist des Proxys bleibt davon unberuehrt und zusaetzlich wirksam.
 */
export const PROXY_ELIGIBLE_SOURCES = Object.freeze(['gamepro', 'gamestar', 'play3', 'playfront']);

/**
 * Darf fuer diese Quelle der Proxy versucht werden?
 *
 * @param {{ id?: unknown, name?: unknown } | string | null | undefined} feed
 * @returns {boolean}
 */
export function isProxyEligibleSource(feed) {
    const identifiers = typeof feed === 'string'
        ? [feed]
        : [feed?.id, feed?.name];

    return identifiers.some(identifier => (
        typeof identifier === 'string'
        && PROXY_ELIGIBLE_SOURCES.includes(identifier.trim().toLowerCase())
    ));
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429]);

// Der Hosting-Edge vor tools/feed-proxy.php weist Anfragen sporadisch mit 415 ab,
// bevor PHP ueberhaupt laeuft (beobachtet: identische Anfrage 415, sechs Minuten
// spaeter 200). Das Skript selbst erzeugt diesen Status nie - es antwortet mit
// 405, 422, 413, 500, 502 oder dem Status der Quelle. Auf dem Proxy-Weg gilt 415
// deshalb als voruebergehend, beim Direktabruf einer Quelle weiterhin nicht.
const PROXY_RETRYABLE_HTTP_STATUSES = new Set([...RETRYABLE_HTTP_STATUSES, 415]);

function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function isRetryableHttpStatus(status, retryableStatuses) {
    return retryableStatuses.has(status) || status >= 500;
}

function getRetryDelayMs(response, fallbackDelayMs) {
    const retryAfter = response.headers?.get?.('retry-after')?.trim();
    if (!retryAfter) return fallbackDelayMs;

    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, 5000);
    }

    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) {
        return Math.min(Math.max(retryAt - Date.now(), 0), 5000);
    }

    return fallbackDelayMs;
}

export function isFeedXml(value) {
    if (typeof value !== 'string' || !value.trim()) return false;

    try {
        const document = new DOMParser().parseFromString(value, 'text/xml');
        if (!document.documentElement || document.querySelector('parsererror')) {
            return false;
        }

        const rootName = document.documentElement.nodeName.toLowerCase();
        const hasFeedRoot = rootName === 'rss'
            || rootName === 'feed'
            || rootName.endsWith(':feed')
            || rootName === 'rdf:rdf';
        if (!hasFeedRoot) return false;

        const escapedRootName = rootName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hasClosingRoot = new RegExp(`</${escapedRootName}\\s*>`, 'i').test(value);
        const isSelfClosingRoot = new RegExp(`<${escapedRootName}\\b[^>]*\\/\\s*>`, 'i').test(value);
        return hasClosingRoot || isSelfClosingRoot;
    } catch {
        return false;
    }
}

// === Rettung abgeschnittener Feeds ===
//
// Ein Feed ueber der Byte-Grenze ist nicht zwingend unbrauchbar: liefert eine
// Redaktion jeden Artikel doppelt (`content:encoded` und `dc:content`), liegen
// schon 50 Eintraege knapp darueber, und die allermeisten davon sind bis zur
// Grenze vollstaendig gelesen. Statt den ganzen Feed zu verwerfen, werden genau
// diese Eintraege ausgewertet; nur der abgeschnittene Rest faellt weg.
//
// Die Rettung kuerzt den gelesenen Anfang auf das Ende des letzten
// vollstaendigen Eintrags und schliesst die noch offenen Elemente. Sie ist rein:
// kein Netz, keine Uhr, kein Log. Ein einfaches `lastIndexOf('</item>')` genuegt
// dafuer nicht, denn ein `</item>` kann als Text in einem CDATA-Abschnitt, in
// einem Kommentar oder in einer Verarbeitungsanweisung stehen; dort zu schneiden
// lieferte kaputtes XML. Ein kleiner lexikalischer Scanner liest den Text deshalb
// einmal von vorn und fuehrt einen Stapel der offenen Elemente. Nur ein echtes
// Ende-Tag auf der richtigen Ebene zaehlt als Schnittstelle.
//
// Im Zweifel gilt: lieber nichts als etwas Halbes. Was der Scanner nicht sicher
// lesen kann, beendet das Lesen an dieser Stelle; geschnitten wird nur an einem
// Eintragsende davor. Gibt es keines, ist das Ergebnis `null`, und es bleibt beim
// bisherigen Fehler.

// Leerraum nach XML 1.0: Leerzeichen, Tabulator, CR, LF.
function skipXmlWhitespace(text, index) {
    while (index < text.length) {
        const code = text.charCodeAt(index);
        if (code !== 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) break;
        index += 1;
    }
    return index;
}

// Namen: ASCII-Buchstaben, `_`, `:` und alles ausserhalb von ASCII am Anfang;
// dazu Ziffern, `.` und `-` im Rest. Absichtlich enger als ein nachsichtiger
// Parser: ein `<` vor etwas anderem ist hier kein Tag.
function isXmlNameStart(code) {
    return (code >= 0x41 && code <= 0x5A)
        || (code >= 0x61 && code <= 0x7A)
        || code === 0x5F
        || code === 0x3A
        || code >= 0x80;
}

function isXmlNameChar(code) {
    return isXmlNameStart(code)
        || (code >= 0x30 && code <= 0x39)
        || code === 0x2E
        || code === 0x2D;
}

// Index hinter dem Namen, der an `index` beginnt; `index` selbst, wenn dort keiner steht.
function readXmlName(text, index) {
    if (index >= text.length || !isXmlNameStart(text.charCodeAt(index))) return index;

    let end = index + 1;
    while (end < text.length && isXmlNameChar(text.charCodeAt(end))) end += 1;
    return end;
}

// Liest das Start-Tag, dessen `<` an `start` steht. Liefert { name, selfClosing,
// end } oder `null`, wenn es sich nicht bis zum Ende lesen laesst. Dass der Text
// mitten im Tag endet, ist beim abgeschnittenen Feed der Normalfall, ein
// unquotiertes Attribut ein Formfehler; beide beenden das Lesen gleich.
function readStartTag(text, start) {
    const nameEnd = readXmlName(text, start + 1);
    if (nameEnd === start + 1) return null;
    const name = text.slice(start + 1, nameEnd);

    let index = nameEnd;
    for (;;) {
        const afterSpace = skipXmlWhitespace(text, index);
        const hadWhitespace = afterSpace > index;
        index = afterSpace;
        if (index >= text.length) return null;

        const char = text[index];
        if (char === '>') return { name, selfClosing: false, end: index + 1 };
        if (char === '/') {
            return text[index + 1] === '>'
                ? { name, selfClosing: true, end: index + 2 }
                : null;
        }

        // Ein Attribut braucht Leerraum davor, einen Namen, `=` und einen Wert in
        // Anfuehrungszeichen. Alles andere ist nicht wohlgeformt.
        if (!hadWhitespace) return null;
        const attributeEnd = readXmlName(text, index);
        if (attributeEnd === index) return null;

        index = skipXmlWhitespace(text, attributeEnd);
        if (text[index] !== '=') return null;

        index = skipXmlWhitespace(text, index + 1);
        const quote = text[index];
        if (quote !== '"' && quote !== "'") return null;

        const valueEnd = text.indexOf(quote, index + 1);
        if (valueEnd === -1) return null;
        // Ein `<` im Attributwert ist in XML verboten. Hier deutet es meist auf
        // ein fehlendes schliessendes Anfuehrungszeichen hin; der Scanner hielte
        // dann Teile des Dokuments fuer den Wert.
        if (text.slice(index + 1, valueEnd).includes('<')) return null;
        index = valueEnd + 1;
    }
}

// Liest das Ende-Tag, dessen `</` an `start` steht. Liefert { name, end } oder
// `null`, wenn es sich nicht bis zum Ende lesen laesst.
function readEndTag(text, start) {
    const nameEnd = readXmlName(text, start + 2);
    if (nameEnd === start + 2) return null;

    const closing = skipXmlWhitespace(text, nameEnd);
    return text[closing] === '>'
        ? { name: text.slice(start + 2, nameEnd), end: closing + 1 }
        : null;
}

// Index hinter einer einfachen DOCTYPE-Deklaration (`<!DOCTYPE` steht an
// `start`), sonst -1. Ein internes Subset in `[...]` bleibt unberuecksichtigt:
// darin koennen Entities stehen, die der Scanner nicht kennt.
function skipDoctype(text, start) {
    let index = start + '<!DOCTYPE'.length;
    while (index < text.length) {
        const char = text[index];
        if (char === '>') return index + 1;
        if (char === '[') return -1;
        if (char === '"' || char === "'") {
            const closing = text.indexOf(char, index + 1);
            if (closing === -1) return -1;
            index = closing + 1;
        } else {
            index += 1;
        }
    }
    return -1;
}

function getXmlLocalName(qualifiedName) {
    return qualifiedName.toLowerCase().split(':').pop();
}

const CDATA_OPEN = '<![CDATA[';
const COMMENT_OPEN = '<!--';

/**
 * Sucht im abgeschnittenen Text das Ende des letzten vollstaendigen Eintrags.
 *
 * Ein Eintrag ist `item` (RSS, RDF) beziehungsweise `entry` (Atom) direkt unter
 * der Wurzel oder unter deren `channel`. Der Stapel der offenen Elemente an dieser
 * Stelle liefert die Ende-Tags, die das Dokument wieder schliessen: bei RSS 2.0
 * `</channel></rss>`, bei RDF nur das Wurzel-Tag (dort steht `channel` neben den
 * Eintraegen), bei Atom `</feed>`. Alle Namen stammen aus dem Text selbst, also
 * in dessen Schreibweise und mit dessen Praefix.
 *
 * @param {string} text
 * @returns {{ cutIndex: number, closers: string, entryCount: number } | null}
 */
function scanFeedEntries(text) {
    // --- Prolog: Leerraum, XML-Deklaration, Kommentare, Anweisungen, DOCTYPE ---
    let index = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
    for (;;) {
        index = skipXmlWhitespace(text, index);
        if (text.startsWith('<?', index)) {
            const end = text.indexOf('?>', index + 2);
            if (end === -1) return null;
            index = end + 2;
        } else if (text.startsWith(COMMENT_OPEN, index)) {
            const end = text.indexOf('-->', index + COMMENT_OPEN.length);
            if (end === -1) return null;
            index = end + 3;
        } else if (text.startsWith('<!DOCTYPE', index)) {
            index = skipDoctype(text, index);
            if (index === -1) return null;
        } else {
            break;
        }
    }

    if (text[index] !== '<') return null;
    const rootTag = readStartTag(text, index);
    if (rootTag === null || rootTag.selfClosing) return null;

    // Dieselbe Wurzelpruefung wie in isFeedXml.
    const rootLowerName = rootTag.name.toLowerCase();
    const isAtom = rootLowerName === 'feed' || rootLowerName.endsWith(':feed');
    if (!isAtom && rootLowerName !== 'rss' && rootLowerName !== 'rdf:rdf') return null;
    const entryName = isAtom ? 'entry' : 'item';

    const openElements = [rootTag.name];
    let cutIndex = -1;
    let closers = '';
    let entryCount = 0;

    // `openElements` enthaelt bei jedem Aufruf nur die Vorfahren des Eintrags.
    const registerEntryEnd = end => {
        const isDirectChild = openElements.length === 1;
        const isChannelChild = openElements.length === 2
            && getXmlLocalName(openElements[1]) === 'channel';
        if (!isDirectChild && !isChannelChild) return;

        entryCount += 1;
        cutIndex = end;
        closers = openElements.map(name => `</${name}>`).reverse().join('');
    };

    index = rootTag.end;
    while (index < text.length) {
        const tagStart = text.indexOf('<', index);
        if (tagStart === -1) break;

        // Abschnitte, in denen `<` und `</item>` nur Text sind, werden als Ganzes
        // uebersprungen. Fehlt ihr Ende, ist der Text mitten darin abgeschnitten.
        if (text.startsWith(COMMENT_OPEN, tagStart)) {
            const end = text.indexOf('-->', tagStart + COMMENT_OPEN.length);
            if (end === -1) break;
            index = end + 3;
        } else if (text.startsWith(CDATA_OPEN, tagStart)) {
            const end = text.indexOf(']]>', tagStart + CDATA_OPEN.length);
            if (end === -1) break;
            index = end + 3;
        } else if (text.startsWith('<?', tagStart)) {
            const end = text.indexOf('?>', tagStart + 2);
            if (end === -1) break;
            index = end + 2;
        } else if (text.startsWith('<!', tagStart)) {
            // Der Text kann mitten im Markierer enden (`<![CD`); jede andere
            // Deklaration im Dokument ist unerwartet.
            break;
        } else if (text.startsWith('</', tagStart)) {
            const tag = readEndTag(text, tagStart);
            if (tag === null) break;
            // Ein anderes Element als das zuletzt geoeffnete: die Schachtelung
            // stimmt nicht mehr, ab hier ist dem Text nicht zu trauen.
            if (tag.name !== openElements[openElements.length - 1]) break;

            openElements.pop();
            if (openElements.length === 0) {
                // Die Wurzel ist geschlossen: der Text enthaelt den ganzen Feed.
                // Das passiert, wenn nur Leerraum hinter ihm die Grenze sprengt.
                cutIndex = tag.end;
                closers = '';
                break;
            }
            if (getXmlLocalName(tag.name) === entryName) registerEntryEnd(tag.end);
            index = tag.end;
        } else {
            const tag = readStartTag(text, tagStart);
            if (tag === null) break;

            if (!tag.selfClosing) {
                openElements.push(tag.name);
            } else if (getXmlLocalName(tag.name) === entryName) {
                registerEntryEnd(tag.end);
            }
            index = tag.end;
        }
    }

    return cutIndex === -1 ? null : { cutIndex, closers, entryCount };
}

/**
 * Kuerzt einen abgeschnittenen Feed auf seine vollstaendigen Eintraege.
 *
 * Wie {@link salvageTruncatedFeedXml}, nennt aber zusaetzlich die Zahl der
 * Eintraege im Ergebnis. Wirft nie: Die Rettung laeuft im Fehlerpfad einer
 * Antwort, und eine Ausnahme dort wuerde als Netzwerkfehler gewertet und den
 * Abruf wiederholen.
 *
 * @param {unknown} partialText der bis zur Grenze gelesene Anfang der Antwort
 * @returns {{ xml: string, entryCount: number } | null}
 */
export function salvageTruncatedFeed(partialText) {
    if (typeof partialText !== 'string' || partialText.length === 0) return null;

    try {
        const scan = scanFeedEntries(partialText);
        if (!scan || scan.entryCount === 0) return null;

        const xml = partialText.slice(0, scan.cutIndex) + scan.closers;
        return isFeedXml(xml) ? { xml, entryCount: scan.entryCount } : null;
    } catch {
        return null;
    }
}

/**
 * Macht aus dem Anfang eines zu grossen Feeds ein gueltiges, vollstaendiges
 * Feed-XML, das nur die Eintraege enthaelt, die bis dahin ganz gelesen wurden.
 *
 * - RSS 2.0: bis zum letzten `</item>`, dann `</channel>` und das Wurzel-Tag.
 * - RSS 1.0 (RDF): bis zum letzten `</item>`, dann das Wurzel-Tag in der
 *   Schreibweise des Dokuments, etwa `</rdf:RDF>`.
 * - Atom: bis zum letzten `</entry>`, dann `</feed>`; traegt die Wurzel ein
 *   Praefix (`atom:feed`), tragen es die Ende-Tags auch.
 *
 * Das Ergebnis besteht {@link isFeedXml} und enthaelt mindestens einen
 * vollstaendigen Eintrag. Sonst - kein Feed, kein vollstaendiger Eintrag, Schnitt
 * im Prolog - ist es `null`.
 *
 * @param {unknown} partialText der bis zur Grenze gelesene Anfang der Antwort
 * @returns {string | null}
 */
export function salvageTruncatedFeedXml(partialText) {
    return salvageTruncatedFeed(partialText)?.xml ?? null;
}

export function buildFeedProxyRequestUrl(feedProxyUrl, feedUrl) {
    const proxyRequestUrl = new URL(feedProxyUrl);
    proxyRequestUrl.hash = '';
    proxyRequestUrl.searchParams.delete('mode');
    proxyRequestUrl.searchParams.set('url', feedUrl);
    return proxyRequestUrl.href;
}

/**
 * Baut den eng begrenzten Proxy-Abruf einer Play3-Artikelseite.
 *
 * Die Node-Seite entscheidet nur, wann dieser Modus verwendet wird. Ob die
 * Zieladresse wirklich eine erlaubte Play3-Artikelseite ist, prueft der
 * externe PHP-Endpunkt nochmals selbst.
 */
export function buildArticleImageProxyRequestUrl(feedProxyUrl, articleUrl) {
    const proxyRequestUrl = new URL(feedProxyUrl);
    proxyRequestUrl.hash = '';
    proxyRequestUrl.searchParams.set('mode', 'article-image');
    proxyRequestUrl.searchParams.set('url', articleUrl);
    return proxyRequestUrl.href;
}

/**
 * Quelltext des regulaeren Ausdrucks, den der Bildmodus von tools/feed-proxy.php
 * auf die Zieladresse anwendet (ohne Trennzeichen und Modifikatoren).
 *
 * Er steht hier ein zweites Mal, damit die Node-Seite keine Adresse an den Proxy
 * schickt, die er ohnehin mit 422 abweisen wuerde. Ein 422 soll ausschliesslich
 * heissen, dass die PHP-Datei den Bildmodus nicht kennt - nicht, dass ein
 * einzelner Artikel eine ungewoehnliche Adresse hat. Ein Test vergleicht beide
 * Fassungen Zeichen fuer Zeichen, damit sie nicht auseinanderlaufen.
 */
export const PLAY3_ARTICLE_URL_PATTERN = '^https://www\\.play3\\.de/[0-9]{4}/[0-9]{2}/[0-9]{2}/[a-z0-9-]+/$';

const PLAY3_ARTICLE_URL_REGEX = new RegExp(PLAY3_ARTICLE_URL_PATTERN);

/**
 * Ist das eine kanonische Play3-Artikeladresse, die der Bildmodus annimmt?
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPlay3ArticleUrl(value) {
    return typeof value === 'string' && PLAY3_ARTICLE_URL_REGEX.test(value);
}

// Eine Ablehnung durch die Outbound-Policy ist deterministisch: erneutes
// Versuchen kann nichts ändern und würde die Diagnose nur verschleiern.
function isPolicyRejection(error) {
    return error instanceof OutboundPolicyError || error instanceof UrlPolicyError;
}

async function fetchTextWithRetry({
    attempts,
    createSignal,
    feedName,
    fetchImpl,
    hasTimeFor,
    headers,
    logger,
    lookup,
    maxBytes,
    redact,
    requestLabel,
    requestUrl,
    retryableStatuses = RETRYABLE_HTTP_STATUSES,
    retryDelayMs,
    sleep,
    timeoutMs,
}) {
    let lastError = `${requestLabel} failed`;

    // Ist das Gesamtbudget des Laufs aufgebraucht, ist Wiederholen keine
    // Belastbarkeit mehr, sondern nur noch Zeit, die woanders fehlt. Die Frage
    // wird deshalb vor jedem Versuch und vor jeder Wartezeit gestellt - vor der
    // Wartezeit mit ihrer tatsaechlichen Dauer, denn eine Pause, die ueber die
    // Deadline hinausreicht, kostet nur und bringt nichts.
    const budgetExhausted = () => ({
        error: `${requestLabel} skipped: run budget exhausted`,
        budgetExhausted: true,
        status: null,
        text: null,
    });

    for (let attempt = 1; attempt <= attempts; attempt++) {
        if (!hasTimeFor()) return budgetExhausted();

        // Das Signal verbindet Einzeltimeout und Gesamtbudget: eine bereits
        // laufende Anfrage wird beim Erreichen der Deadline mit abgebrochen.
        const signal = createSignal(timeoutMs);

        try {
            const response = await fetchWithOutboundPolicy(requestUrl, {
                fetchImpl,
                headers,
                lookup,
                signal,
            });

            if (!response.ok) {
                lastError = `${requestLabel} failed with status ${response.status}`;
                const retryDelay = getRetryDelayMs(response, retryDelayMs);
                await response.body?.cancel().catch(() => {});
                if (attempt < attempts && isRetryableHttpStatus(response.status, retryableStatuses)) {
                    // Auch ein `Retry-After` der Gegenstelle darf die Deadline
                    // nicht ueberschreiten.
                    if (!hasTimeFor(retryDelay)) return budgetExhausted();
                    logger?.log?.(`   ↻ ${requestLabel} failed for ${feedName} (${redact(lastError)}). Retrying once...`);
                    await sleep(retryDelay);
                    continue;
                }
                return { error: lastError, status: response.status, text: null };
            }

            try {
                // `keepPartialText` liest nichts zusaetzlich: Grenze und
                // Bytezaehlung bleiben dieselben. Der Anfang wird nur gebraucht,
                // wenn die Antwort zu gross ist (siehe unten).
                const text = await readLimitedResponseText(response, maxBytes, { keepPartialText: true });
                return { error: null, status: response.status, text };
            } catch (error) {
                lastError = `${requestLabel} response could not be read: ${getErrorMessage(error)}`;
                await response.body?.cancel().catch(() => {});

                if (error instanceof ResponseTooLargeError) {
                    // Zu gross: nicht wiederholen, aber auch nicht alles verwerfen.
                    // Lassen sich aus dem bis zur Grenze gelesenen Anfang saubere,
                    // vollstaendige Eintraege gewinnen, ist das ein Erfolg - mit
                    // Kennzeichen, damit der Aufrufer ihn melden kann. Sonst bleibt
                    // es beim bisherigen Fehler. Eine schon per `Content-Length`
                    // abgelehnte Antwort wurde nicht gelesen und hat keinen Anfang.
                    const salvaged = salvageTruncatedFeed(error.partialText);
                    if (salvaged) {
                        return {
                            error: null,
                            salvagedEntryCount: salvaged.entryCount,
                            status: response.status,
                            text: salvaged.xml,
                            truncated: true,
                        };
                    }
                } else if (attempt < attempts) {
                    if (!hasTimeFor(retryDelayMs)) return budgetExhausted();
                    logger?.log?.(`   ↻ ${requestLabel} failed for ${feedName} (${redact(lastError)}). Retrying once...`);
                    await sleep(retryDelayMs);
                    continue;
                }
                return { error: lastError, status: response.status, text: null };
            }
        } catch (error) {
            lastError = getErrorMessage(error);
            if (isPolicyRejection(error)) {
                return { error: lastError, policyRejected: true, status: null, text: null };
            }
            // Der Abbruch kann vom Gesamtbudget kommen; dann war das hier der
            // letzte Versuch dieser Quelle.
            if (!hasTimeFor()) return budgetExhausted();
            if (attempt < attempts) {
                // Eine Wiederholung, deren Pause nicht mehr hineinpasst, ist
                // keine. Die Pruefung gehoert **in** diesen Zweig: nach dem
                // letzten Versuch folgt gar keine Pause mehr, und ein echter
                // Fehler der Quelle darf dort nicht als Zurueckstellung
                // erscheinen - sonst verdeckt knappe Restzeit eine kaputte
                // Quelle.
                if (!hasTimeFor(retryDelayMs)) return budgetExhausted();
                logger?.log?.(`   ↻ ${requestLabel} failed for ${feedName} (${redact(lastError)}). Retrying once...`);
                await sleep(retryDelayMs);
                continue;
            }
        }
    }

    return { error: lastError, status: null, text: null };
}

export async function fetchFeedXml({
    // Der Proxy ist die Ausnahme, nicht die Regel: ohne ausdrueckliche Freigabe
    // der Quelle wird er selbst bei einem Direktfehler nicht versucht.
    allowProxy = false,
    // Baut das Abbruchsignal einer einzelnen Anfrage. Vorgabe ist das reine
    // Einzeltimeout aus O2a; der Cron-Lauf reicht hier das Signal seines
    // Gesamtbudgets herein, damit die Deadline auch eine bereits laufende
    // Anfrage beendet (O2b).
    createSignal = timeoutMs => AbortSignal.timeout(timeoutMs),
    directAttempts = 2,
    directTimeoutMs = 15000,
    feedName,
    feedProxyUrl,
    feedUrl,
    // Meldet, ob der Lauf noch mehr als `ms` Millisekunden Gesamtbudget hat -
    // gefragt vor jedem Versuch (`ms = 0`) und vor jeder Wiederholungspause mit
    // deren tatsaechlicher Dauer. Ohne Angabe gilt das bisherige Verhalten: es
    // gibt kein Gesamtbudget.
    hasTimeFor = () => true,
    // Bewusst **ohne** Vorgabe: nur ein ausdruecklich injiziertes fetchImpl
    // (Tests) ersetzt den Transport. Bleibt es undefined, verwendet
    // fetchWithOutboundPolicy seinen an die geprueften Adressen gebundenen
    // Standardtransport - genau der schuetzt vor DNS-Rebinding.
    fetchImpl,
    logger = console,
    lookup,
    maxResponseBytes = MAX_FEED_RESPONSE_BYTES,
    proxyAttempts = 2,
    proxyTimeoutMs = 20000,
    // Fehlertexte einer Gegenstelle koennen Verbindungsdaten enthalten. Der
    // Aufrufer kennt die konfigurierten Secrets und reicht die Bereinigung
    // herein; ohne sie bleibt der Text unveraendert.
    redact = message => String(message),
    retryDelayMs = 1000,
    sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
}) {
    const directResult = await fetchTextWithRetry({
        attempts: directAttempts,
        createSignal,
        feedName,
        fetchImpl,
        hasTimeFor,
        headers: BROWSER_LIKE_HEADERS,
        logger,
        lookup,
        maxBytes: maxResponseBytes,
        redact,
        requestLabel: 'Direct fetch',
        requestUrl: feedUrl,
        retryDelayMs,
        sleep,
        timeoutMs: directTimeoutMs,
    });

    if (directResult.text !== null && isFeedXml(directResult.text)) {
        logger?.log?.(`   ✅ Direct fetch successful for ${feedName}`);
        return {
            directError: null,
            httpStatus: directResult.status ?? null,
            lastError: null,
            proxyError: null,
            // `truncated` heisst: die Antwort war ueber der Grenze, `xmlString`
            // enthaelt nur ihre vollstaendig gelesenen Eintraege (siehe
            // salvageTruncatedFeed). Beide Felder stehen nur bei einem Erfolg.
            salvagedEntryCount: directResult.salvagedEntryCount ?? null,
            transport: 'direct',
            truncated: directResult.truncated === true,
            usedProxy: false,
            xmlString: directResult.text,
        };
    }

    const directError = directResult.text !== null
        ? `Direct fetch returned content that is not an RSS or Atom feed (status ${directResult.status})`
        : directResult.error;

    // Ein von der Outbound-Policy abgelehntes Ziel darf auch nicht
    // stellvertretend über den Proxy abgerufen werden. Die exakte Allowlist des
    // PHP-Proxys würde es zwar ebenfalls zurückweisen, aber die Entscheidung
    // gehört auf diese Seite und darf nicht von der Gegenstelle abhängen.
    //
    // `allowProxy` kommt aus der Quellenliste: nur wer den Umweg wirklich
    // braucht, bekommt ihn. Sonst würde jeder gewöhnliche Timeout einer
    // beliebigen Quelle fremdes Hosting belasten.
    // Ein aufgebrauchtes Gesamtbudget schliesst den Umweg ebenfalls aus: der
    // Proxy waere der teuerste Weg zur selben Antwort und die Zeit fehlt
    // anschliessend beim Kern-Publish.
    if (!allowProxy || !feedProxyUrl?.trim() || directResult.policyRejected || directResult.budgetExhausted) {
        return {
            budgetExhausted: directResult.budgetExhausted === true,
            directError,
            // Ein zurueckgestellter Abruf hat keinen Status; `fetchTextWithRetry`
            // liefert dort ausdruecklich `null` statt einer geratenen Zahl.
            httpStatus: directResult.status ?? null,
            lastError: directError,
            proxyError: null,
            transport: 'none',
            usedProxy: false,
            xmlString: null,
        };
    }

    logger?.log?.(`   ⚠️  Direct fetch failed for ${feedName} (${redact(directError)}). Trying feed proxy...`);

    let proxyRequestUrl;
    try {
        proxyRequestUrl = buildFeedProxyRequestUrl(feedProxyUrl, feedUrl);
    } catch (error) {
        const proxyError = `feed proxy URL is invalid: ${getErrorMessage(error)}`;
        return {
            directError,
            httpStatus: directResult.status ?? null,
            lastError: `${directError} / ${proxyError}`,
            proxyError,
            transport: 'none',
            usedProxy: false,
            xmlString: null,
        };
    }

    const proxyResult = await fetchTextWithRetry({
        attempts: proxyAttempts,
        createSignal,
        feedName,
        fetchImpl,
        hasTimeFor,
        headers: undefined,
        logger,
        lookup,
        maxBytes: maxResponseBytes,
        redact,
        requestLabel: 'Feed proxy',
        requestUrl: proxyRequestUrl,
        retryableStatuses: PROXY_RETRYABLE_HTTP_STATUSES,
        retryDelayMs,
        sleep,
        timeoutMs: proxyTimeoutMs,
    });

    if (proxyResult.text !== null && isFeedXml(proxyResult.text)) {
        logger?.log?.(`   ✅ Feed proxy fetch successful for ${feedName}`);
        return {
            directError,
            httpStatus: proxyResult.status ?? null,
            lastError: null,
            proxyError: null,
            salvagedEntryCount: proxyResult.salvagedEntryCount ?? null,
            transport: 'proxy',
            truncated: proxyResult.truncated === true,
            usedProxy: true,
            xmlString: proxyResult.text,
        };
    }

    let proxyError;
    if (proxyResult.status === 422) {
        proxyError = 'feed proxy refused this URL (not in its allowlist)';
    } else if (proxyResult.text !== null) {
        proxyError = `feed proxy returned content that is not an RSS or Atom feed (status ${proxyResult.status})`;
    } else {
        proxyError = proxyResult.error;
    }

    return {
        budgetExhausted: proxyResult.budgetExhausted === true,
        directError,
        // Der Proxy war der zuletzt versuchte Weg; sein Status ist der letzte
        // wirklich beobachtete. Ohne Antwort bleibt es bei `null`.
        httpStatus: proxyResult.status ?? null,
        lastError: `${directError} / ${proxyError}`,
        proxyError,
        transport: 'none',
        usedProxy: false,
        xmlString: null,
    };
}
