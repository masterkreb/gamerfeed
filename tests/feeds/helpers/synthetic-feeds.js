// Synthetische Feeds fuer die Tests zu zu grossen Feed-Antworten.
//
// Alles ist erfunden: Namen, Adressen und Texte stammen von keiner echten
// Quelle. Jeder Feed kennt die Stelle, an der jeder seiner Eintraege
// vollstaendig ist - in Zeichen (fuer Schnitte im String) und in UTF-8-Bytes
// (fuer die Byte-Grenze). So berechnen die Tests die erwartete Zahl
// vollstaendiger Eintraege **unabhaengig** von der Rettung, die sie pruefen.
//
// Die Datei liegt unter `helpers/`, damit der Runner sie nicht selbst als
// Testdatei startet.

import { DOMParser } from 'linkedom';

/** RSS 2.0, RSS 1.0 (RDF), Atom und Atom mit Namensraum-Praefix. */
export const FEED_FORMATS = Object.freeze(['rss', 'rdf', 'atom', 'atom-prefixed']);

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt. ';

/** ASCII-Fuelltext aus genau `bytes` Bytes. */
function fillerText(bytes) {
    return LOREM.repeat(Math.ceil(bytes / LOREM.length)).slice(0, bytes);
}

// Heikle Inhalte (Option `tricky`), an denen eine einfache Textsuche nach Tags
// scheitert: Ende-Tags als Text in CDATA, im Kommentar und in einer
// Verarbeitungsanweisung, ein `>` im Attributwert und Zeichen, die in UTF-8 mehr
// als ein Byte brauchen.
const HEIKLER_CDATA_TEXT = 'Beispiel: </item> und </entry> und </channel></rss></feed> als Text';
const HEIKLE_NACHRICHT = 'Kurzfassung für € 🎮';

function heikelBlock(number, tricky) {
    return tricky
        ? `<!-- Kommentar mit </item> und </entry> -->\n<?hinweis </item> ${number} ?>\n`
        : '';
}

function fuellung(contentBytes, tricky) {
    return `<p>${fillerText(contentBytes)}${tricky ? ` ${HEIKLER_CDATA_TEXT}` : ''}</p>`;
}

const FORMAT_SPECS = {
    rss: {
        closers: '</channel></rss>',
        header: () => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>Beispielquelle</title>
<link>https://beispiel.example/</link>
<description>Synthetischer Testfeed</description>
`,
        entry: (number, { contentBytes, tricky }) => `<item>
${heikelBlock(number, tricky)}<title>Artikel ${number}</title>
<link>https://beispiel.example/artikel-${number}</link>
<guid isPermaLink="false">artikel-${number}</guid>
<pubDate>Sat, 25 Jul 2026 18:37:34 +0000</pubDate>
<description><![CDATA[${tricky ? HEIKLE_NACHRICHT : `Kurzfassung ${number}`}]]></description>
<enclosure url="https://bilder.example/artikel-${number}.jpg${tricky ? '?x=1>2' : ''}" type="image/jpeg" length="0"/>
${tricky ? `<source url="https://beispiel.example/quelle?a=1>2">Quelle</source>\n` : ''}<content:encoded><![CDATA[${fuellung(contentBytes, tricky)}]]></content:encoded>
<dc:content><![CDATA[${fuellung(contentBytes, tricky)}]]></dc:content>
</item>`,
        footer: '</channel>\n</rss>\n',
    },
    rdf: {
        closers: '</rdf:RDF>',
        header: entryCount => `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://beispiel.example/">
<title>Beispielquelle</title>
<link>https://beispiel.example/</link>
<description>Synthetischer Testfeed</description>
<items><rdf:Seq>${Array.from({ length: entryCount }, (_, index) => (
    `<rdf:li rdf:resource="https://beispiel.example/artikel-${index + 1}"/>`
)).join('')}</rdf:Seq></items>
</channel>
`,
        entry: (number, { contentBytes, tricky }) => `<item rdf:about="https://beispiel.example/artikel-${number}">
${heikelBlock(number, tricky)}<title>Artikel ${number}</title>
<link>https://beispiel.example/artikel-${number}</link>
<dc:date>2026-07-25T18:37:34Z</dc:date>
<description>${tricky ? HEIKLE_NACHRICHT : `Kurzfassung ${number}`}</description>
${tricky ? `<source url="https://beispiel.example/quelle?a=1>2">Quelle</source>\n` : ''}<content:encoded><![CDATA[${fuellung(contentBytes, tricky)}]]></content:encoded>
</item>`,
        footer: '</rdf:RDF>\n',
    },
    atom: {
        closers: '</feed>',
        header: () => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Beispielquelle</title>
<id>urn:beispiel:feed</id>
<updated>2026-07-25T18:37:34Z</updated>
`,
        entry: (number, { contentBytes, tricky }) => `<entry>
${heikelBlock(number, tricky)}<id>urn:beispiel:artikel-${number}</id>
<title>Artikel ${number}</title>
<link rel="alternate" href="https://beispiel.example/artikel-${number}"/>
${tricky ? `<link rel="related" href="https://beispiel.example/verwandt?a=1>2"/>\n` : ''}<published>2026-07-25T18:37:34Z</published>
<summary>${tricky ? HEIKLE_NACHRICHT : `Kurzfassung ${number}`}</summary>
<content type="html"><![CDATA[${fuellung(contentBytes, tricky)}]]></content>
</entry>`,
        footer: '</feed>\n',
    },
    'atom-prefixed': {
        closers: '</atom:feed>',
        header: () => `<?xml version="1.0" encoding="UTF-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
<atom:title>Beispielquelle</atom:title>
<atom:id>urn:beispiel:feed</atom:id>
<atom:updated>2026-07-25T18:37:34Z</atom:updated>
`,
        entry: (number, { contentBytes, tricky }) => `<atom:entry>
${heikelBlock(number, tricky)}<atom:id>urn:beispiel:artikel-${number}</atom:id>
<atom:title>Artikel ${number}</atom:title>
<atom:link rel="alternate" href="https://beispiel.example/artikel-${number}"/>
${tricky ? `<atom:link rel="related" href="https://beispiel.example/verwandt?a=1>2"/>\n` : ''}<atom:published>2026-07-25T18:37:34Z</atom:published>
<atom:summary>${tricky ? HEIKLE_NACHRICHT : `Kurzfassung ${number}`}</atom:summary>
<atom:content type="html"><![CDATA[${fuellung(contentBytes, tricky)}]]></atom:content>
</atom:entry>`,
        footer: '</atom:feed>\n',
    },
};

/**
 * Baut einen Feed mit `entryCount` Eintraegen.
 *
 * @param {'rss' | 'rdf' | 'atom' | 'atom-prefixed'} format
 * @param {number} entryCount
 * @param {{ contentBytes?: number, tricky?: boolean }} [options]
 *   `contentBytes` – Fuelltext je Inhaltsfeld; RSS 2.0 liefert den Inhalt wie
 *   eine Redaktion, die den Artikel zweimal sendet, in `content:encoded` und
 *   `dc:content`, ein Eintrag ist dort also gut doppelt so gross;
 *   `tricky` – Ende-Tags als Text, Kommentar, Anweisung, `>` im Attribut und
 *   Nicht-ASCII-Zeichen in jedem Eintrag.
 */
export function createSyntheticFeed(format, entryCount, { contentBytes = 0, tricky = false } = {}) {
    const spec = FORMAT_SPECS[format];
    if (!spec) throw new Error(`unbekanntes Format: ${format}`);

    let xml = spec.header(entryCount);
    const titles = [];
    const entryStartChars = [];
    const entryEndChars = [];

    for (let number = 1; number <= entryCount; number += 1) {
        titles.push(`Artikel ${number}`);
        entryStartChars.push(xml.length);
        xml += spec.entry(number, { contentBytes, tricky });
        entryEndChars.push(xml.length);
        xml += '\n';
    }
    xml += spec.footer;

    return {
        format,
        xml,
        titles,
        /** Index im String, an dem der jeweilige Eintrag beginnt. */
        entryStartChars,
        /** Index im String direkt hinter dem Ende-Tag des jeweiligen Eintrags. */
        entryEndChars,
        /** UTF-8-Bytes bis einschliesslich des Ende-Tags des jeweiligen Eintrags. */
        entryEndBytes: entryEndChars.map(end => Buffer.byteLength(xml.slice(0, end))),
        totalBytes: Buffer.byteLength(xml),
        /** Die Ende-Tags, die ein gekuerzter Feed dieses Formats bekommen muss. */
        closers: spec.closers,
    };
}

/** Wie viele Eintraege des Feeds sind innerhalb der Byte-Grenze vollstaendig? */
export function entriesCompleteWithin(feed, byteLimit) {
    return feed.entryEndBytes.filter(end => end <= byteLimit).length;
}

function localName(element) {
    return (element?.localName || element?.nodeName || '').toLowerCase().split(':').pop();
}

/**
 * Die Titel aller Eintraege (`item` beziehungsweise `entry`) - ueber linkedom
 * gelesen, also unabhaengig vom Scanner, der geprueft wird.
 */
export function readEntryTitles(xml) {
    const document = new DOMParser().parseFromString(xml, 'text/xml');
    const rootName = localName(document.documentElement);
    const entryName = rootName === 'feed' ? 'entry' : 'item';

    return Array.from(document.querySelectorAll('*'))
        .filter(element => localName(element) === entryName)
        .map(element => (
            Array.from(element.children).find(child => localName(child) === 'title')?.textContent ?? null
        ));
}

/**
 * Echte `Response`, deren Rumpf in Stuecken fester Groesse ausgeliefert wird und
 * keine `Content-Length` traegt - wie ein chunked uebertragener Feed.
 */
export function chunkedResponse(text, { chunkBytes = 64 * 1024, status = 200, headers = {} } = {}) {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;

    return new Response(new ReadableStream({
        pull(controller) {
            if (offset >= bytes.byteLength) {
                controller.close();
                return;
            }
            controller.enqueue(bytes.slice(offset, offset + chunkBytes));
            offset += chunkBytes;
        },
    }), { status, headers });
}

/**
 * Antwort-Attrappe mit Zaehler: wie viele Stuecke und Bytes wurden gelesen, und
 * wurde der Stream abgebrochen? Damit ist belegbar, dass nach der Grenze nichts
 * mehr gelesen wird.
 */
export function countingResponse(text, { chunkBytes = 1024, status = 200, headers = {} } = {}) {
    const bytes = new TextEncoder().encode(text);
    const state = { bytesRead: 0, cancelled: false, chunksRead: 0 };
    let offset = 0;

    const response = {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(headers),
        body: {
            getReader() {
                return {
                    async read() {
                        if (state.cancelled || offset >= bytes.byteLength) {
                            return { done: true, value: undefined };
                        }
                        const chunk = bytes.slice(offset, offset + chunkBytes);
                        offset += chunkBytes;
                        state.chunksRead += 1;
                        state.bytesRead += chunk.byteLength;
                        return { done: false, value: chunk };
                    },
                    async cancel() {
                        state.cancelled = true;
                    },
                    releaseLock() {},
                };
            },
            async cancel() {
                state.cancelled = true;
            },
        },
    };

    return { response, state };
}
