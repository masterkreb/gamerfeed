import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';

// SEO1: Das ausgelieferte `index.html` ist der einzige Inhalt, den ein Crawler
// ohne JavaScript sieht. Diese Suite prueft die Quelldatei; das erzeugte
// Production-HTML wird zusaetzlich in `tests/e2e/seo-entry.spec.ts` ohne
// JavaScript im Browser geprueft.

const INDEX_HTML = fs.readFileSync(
    path.join(process.cwd(), 'index.html'),
    'utf8',
);

const { document } = parseHTML(INDEX_HTML);

/** Textquellen, die Google statisch ausliest - ohne Bildmasse und Adressen. */
function staticSeoTexts(doc) {
    const texts = [doc.querySelector('title')?.textContent ?? ''];

    const metaSelectors = [
        'meta[name="description"]',
        'meta[name="keywords"]',
        'meta[property="og:title"]',
        'meta[property="og:description"]',
        'meta[property="og:image:alt"]',
        'meta[name="twitter:title"]',
        'meta[name="twitter:description"]',
        'meta[name="twitter:image:alt"]',
    ];
    for (const selector of metaSelectors) {
        texts.push(doc.querySelector(selector)?.getAttribute('content') ?? '');
    }

    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
        texts.push(script.textContent ?? '');
    }

    texts.push(doc.getElementById('root')?.textContent ?? '');

    return texts.filter(Boolean);
}

/**
 * Verstecken heisst hier: fuer Menschen unsichtbar oder aus dem
 * Accessibility-Tree entfernt. Genau das darf ein Crawler-Fallback nicht sein.
 */
function hidingReason(element) {
    for (let node = element; node && node.getAttribute; node = node.parentElement) {
        if (node.hasAttribute('hidden')) {
            return `${node.tagName} traegt hidden`;
        }
        if (node.getAttribute('aria-hidden') === 'true') {
            return `${node.tagName} traegt aria-hidden`;
        }
        if ((node.getAttribute('class') ?? '').split(/\s+/).includes('sr-only')) {
            return `${node.tagName} traegt sr-only`;
        }

        const style = (node.getAttribute('style') ?? '').toLowerCase();
        if (/display\s*:\s*none/.test(style)) {
            return `${node.tagName} ist display:none`;
        }
        if (/visibility\s*:\s*hidden/.test(style)) {
            return `${node.tagName} ist visibility:hidden`;
        }
        if (/opacity\s*:\s*0(?!\.)/.test(style)) {
            return `${node.tagName} ist opacity:0`;
        }
        if (/(left|top|right|bottom|text-indent)\s*:\s*-\d/.test(style)) {
            return `${node.tagName} liegt ausserhalb des Viewports`;
        }
        if (/(width|height)\s*:\s*(0|1)px/.test(style)) {
            return `${node.tagName} ist auf Pixelgroesse geschrumpft`;
        }
    }

    return null;
}

test('index.html liefert ohne JavaScript genau eine H1', () => {
    const headings = document.querySelectorAll('h1');

    assert.equal(
        headings.length,
        1,
        `erwartet genau eine H1, gefunden ${headings.length}`,
    );
    assert.ok(
        document.getElementById('root').contains(headings[0]),
        'die H1 liegt nicht im React-Container und wuerde beim App-Start nicht ersetzt',
    );
    assert.ok(
        (headings[0].textContent ?? '').trim().length >= 10,
        'die H1 ist zu kurz, um den Zweck der Seite zu benennen',
    );
});

test('index.html liefert ohne JavaScript eine eigene Beschreibung', () => {
    const root = document.getElementById('root');
    const paragraphs = [...root.querySelectorAll('p')]
        .map(node => (node.textContent ?? '').trim())
        .filter(text => text.length > 0);

    assert.ok(paragraphs.length > 0, 'der Fallback enthaelt keinen Beschreibungstext');

    const description = paragraphs.find(text => text.length >= 80);
    assert.ok(
        description,
        `kein Absatz mit mindestens 80 Zeichen: ${JSON.stringify(paragraphs)}`,
    );

    const metaDescription = document
        .querySelector('meta[name="description"]')
        ?.getAttribute('content')
        ?.trim();
    assert.notEqual(
        description,
        metaDescription,
        'der sichtbare Text ist eine wortgleiche Kopie der Meta-Description',
    );
});

test('index.html verlinkt /gaming-news als gewoehnlichen Link', () => {
    const root = document.getElementById('root');
    const links = [...root.querySelectorAll('a')];
    const link = links.find(node => {
        const href = node.getAttribute('href') ?? '';
        return href === '/gaming-news' || href.endsWith('/gaming-news');
    });

    assert.ok(link, 'kein Link auf /gaming-news im Fallback gefunden');
    assert.ok(
        (link.textContent ?? '').trim().length >= 5,
        'der Link hat keinen sprechenden Text',
    );
    assert.equal(
        link.getAttribute('onclick'),
        null,
        'der Link darf kein Skript brauchen',
    );
});

test('der Fallback ist weder versteckt noch aus dem Viewport geschoben', () => {
    const root = document.getElementById('root');
    assert.ok(root, '#root fehlt');

    const reason = hidingReason(root);
    assert.equal(reason, null, `der Fallback ist verborgen: ${reason}`);

    for (const element of root.querySelectorAll('*')) {
        const elementReason = hidingReason(element);
        assert.equal(
            elementReason,
            null,
            `Fallback-Element ${element.tagName} ist verborgen: ${elementReason}`,
        );
    }
});

test('der Fallback kopiert keine Artikelliste in das HTML', () => {
    const root = document.getElementById('root');

    assert.equal(
        root.querySelectorAll('article').length,
        0,
        'der Fallback enthaelt Artikelelemente',
    );
    assert.equal(
        root.querySelectorAll('ul, ol').length,
        0,
        'der Fallback enthaelt eine Liste, die wie eine Artikelliste wirkt',
    );

    const externalLinks = [...root.querySelectorAll('a')].filter(node => {
        const href = node.getAttribute('href') ?? '';
        return /^https?:\/\//i.test(href)
            && !href.startsWith('https://gamerfeed.vercel.app');
    });
    assert.deepEqual(
        externalLinks.map(node => node.getAttribute('href')),
        [],
        'der Fallback verlinkt fremde Artikel',
    );
});

test('kein statischer SEO-Text nennt eine feste Quellenzahl', () => {
    const offenders = [];

    for (const text of staticSeoTexts(document)) {
        // "aus 15 Quellen", "ueber 15 deutschen und englischen Quellen",
        // "from 20+ sources" - jede fest verdrahtete Zahl vor Quellen/sources.
        const match = text.match(
            /\d+\s*\+?\s*(?:[\p{L}]+[\s,]+){0,4}(?:quellen|sources)/iu,
        );
        if (match) {
            offenders.push(match[0]);
        }
    }

    assert.deepEqual(offenders, [], `feste Quellenzahl gefunden: ${offenders.join(' | ')}`);
});

test('kein statischer SEO-Text verspricht "alle Quellen"', () => {
    const offenders = [];

    for (const text of staticSeoTexts(document)) {
        // GamerFeed deckt genau die konfigurierten Feeds ab - nie "alle".
        // Dasselbe gilt fuer "jede Quelle" und "all sources".
        const match = text.match(
            /\b(?:alle[nmr]?|jede[nmrs]?|s(?:ä|ae)mtliche[nmrs]?|all|every)\s+(?:[\p{L}-]+\s+){0,3}(?:[\p{L}]+-)?(?:quellen|redaktionen|sources)\b/iu,
        );
        if (match) {
            offenders.push(match[0]);
        }
    }

    assert.deepEqual(
        offenders,
        [],
        `Vollstaendigkeitsversprechen gefunden: ${offenders.join(' | ')}`,
    );
});

test('die strukturierten Daten enthalten keine SearchAction', () => {
    assert.ok(
        !/SearchAction/i.test(INDEX_HTML),
        'SearchAction ist noch vorhanden, obwohl ?search= keine URL-Suche ist',
    );

    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        const data = JSON.parse(script.textContent);
        assert.equal(
            data.potentialAction,
            undefined,
            'potentialAction verspricht eine Aktion, die die App nicht anbietet',
        );
    }
});

test('die strukturierten Daten bleiben gueltiges JSON mit Kernangaben', () => {
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
    assert.equal(scripts.length, 1, 'erwartet genau einen JSON-LD-Block');

    const data = JSON.parse(scripts[0].textContent);
    assert.equal(data['@context'], 'https://schema.org');
    assert.equal(data['@type'], 'WebSite');
    assert.equal(data.url, 'https://gamerfeed.vercel.app/');
    assert.ok(data.description, 'die strukturierten Daten haben keine Beschreibung');
});

test('das Social-Preview-Bild hat die geforderten 1200x630 Pixel', () => {
    const file = path.join(process.cwd(), 'public', 'social-preview.png');
    const bytes = fs.readFileSync(file);

    assert.deepEqual(
        [...bytes.subarray(0, 8)],
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        'social-preview.png ist keine PNG-Datei',
    );
    // IHDR steht immer als erster Chunk: 8 Byte Signatur, 4 Byte Laenge,
    // 4 Byte Typ, dann Breite und Hoehe als 32-Bit-Werte.
    assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
    assert.equal(bytes.readUInt32BE(16), 1200, 'Breite weicht ab');
    assert.equal(bytes.readUInt32BE(20), 630, 'Hoehe weicht ab');
});

test('Open Graph und Twitter verweisen auf dasselbe vorhandene Vorschaubild', () => {
    const sources = [
        document.querySelector('meta[property="og:image"]')?.getAttribute('content'),
        document.querySelector('meta[name="twitter:image"]')?.getAttribute('content'),
    ];

    for (const source of sources) {
        assert.ok(source, 'ein Vorschaubild-Verweis fehlt');
        const name = source.split('/').pop();
        assert.ok(
            fs.existsSync(path.join(process.cwd(), 'public', name)),
            `${name} liegt nicht in public/`,
        );
    }

    assert.equal(sources[0], sources[1], 'die Verweise zeigen auf verschiedene Bilder');
    assert.equal(
        document.querySelector('meta[property="og:image:width"]')?.getAttribute('content'),
        '1200',
    );
    assert.equal(
        document.querySelector('meta[property="og:image:height"]')?.getAttribute('content'),
        '630',
    );
});

test('Canonical, Robots und Sprache bleiben unveraendert', () => {
    assert.equal(document.documentElement.getAttribute('lang'), 'de');
    assert.equal(
        document.querySelector('link[rel="canonical"]').getAttribute('href'),
        'https://gamerfeed.vercel.app/',
    );
    assert.equal(
        document.querySelector('meta[name="robots"]').getAttribute('content'),
        'index, follow',
    );
    assert.ok(
        document.querySelector('script[type="module"][src="/index.tsx"]'),
        'der React-Einstiegspunkt fehlt',
    );
});
