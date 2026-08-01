import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';

// Die SPA startet bewusst mit einem leeren React-Container. Damit blitzt auf
// langsamen Mobilgeraeten keine zweite Textseite auf, bevor die App uebernimmt.
// Crawlbare Artikel bleiben unter `/gaming-news` servergerendert verfuegbar.

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

test('index.html startet mit einem leeren React-Container', () => {
    const root = document.getElementById('root');
    assert.ok(root, '#root fehlt');
    assert.equal(root.childElementCount, 0, '#root enthaelt sichtbare Elemente vor dem App-Start');
    assert.equal((root.textContent ?? '').trim(), '', '#root enthaelt sichtbaren Zwischentext');
});

test('index.html enthaelt keinen alten sichtbaren SEO-Fallback mehr', () => {
    assert.equal(document.querySelector('[data-seo="fallback"]'), null);
    assert.equal(document.querySelector('.app-fallback'), null);
    assert.ok(!INDEX_HTML.includes('.app-fallback'), 'Fallback-CSS ist noch vorhanden');
});

test('index.html zeigt ohne JavaScript keine vorgeschaltete Inhaltsseite', () => {
    const bodyText = (document.body.textContent ?? '').trim();
    assert.equal(bodyText, '', `unerwarteter sichtbarer Body-Text: ${bodyText}`);
    assert.equal(document.body.querySelectorAll('h1, p, a').length, 0);
});

test('der leere Einstieg kopiert keine Artikel oder Navigation in das HTML', () => {
    const root = document.getElementById('root');

    assert.equal(
        root.querySelectorAll('article').length,
        0,
        'der Einstieg enthaelt Artikelelemente',
    );
    assert.equal(
        root.querySelectorAll('ul, ol').length,
        0,
        'der Einstieg enthaelt eine Liste',
    );
    assert.equal(root.querySelectorAll('a').length, 0, 'der Einstieg enthaelt Navigation');
});

test('SEO-Kernangaben bleiben im Head vorhanden', () => {
    assert.ok((document.querySelector('title')?.textContent ?? '').trim());
    assert.ok(document.querySelector('meta[name="description"]')?.getAttribute('content'));
    assert.ok(document.querySelector('link[rel="canonical"]')?.getAttribute('href'));
    assert.ok(document.querySelector('script[type="application/ld+json"]'));
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
