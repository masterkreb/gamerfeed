import test from 'node:test';
import assert from 'node:assert/strict';
import { getOgImageFromUrl, parseRssXml } from '../../../scripts/fetch-feeds.js';

const FEED = {
    id: 'destructoid',
    name: 'Destructoid',
    language: 'en',
    needs_scraping: false,
};

const HEART_ICON = '/wp-content/themes/destructoid2025/assets/img/icons/likes-off.png';
const UPLOAD_IMAGE = '/wp-content/uploads/2026/07/article-image.jpg';

function createRssItem(content, metadata = '') {
    return `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
            <channel>
                <title>Destructoid</title>
                <item>
                    <title>Test article</title>
                    <link>https://www.destructoid.com/test-article/</link>
                    <guid isPermaLink="false">https://www.destructoid.com/?p=123</guid>
                    <pubDate>Sat, 25 Jul 2026 18:37:34 +0000</pubDate>
                    ${metadata}
                    <description><![CDATA[<p>Summary</p>]]></description>
                    <content:encoded><![CDATA[${content}]]></content:encoded>
                </item>
            </channel>
        </rss>`;
}

test('Destructoid-Icon allein löst den OG-Fallback aus', () => {
    const xml = createRssItem(`<button><img src="${HEART_ICON}"></button>`);
    const [article] = parseRssXml(xml, FEED);

    assert.equal(article.imageUrl, null);
    assert.equal(article.needsScraping, true);
});

test('echtes Destructoid-Uploadbild gewinnt vor einem späteren Like-Icon', () => {
    const xml = createRssItem(`
        <img src="${UPLOAD_IMAGE}">
        <button><img src="${HEART_ICON}"></button>
    `);
    const [article] = parseRssXml(xml, FEED);

    assert.equal(article.imageUrl, `https://www.destructoid.com${UPLOAD_IMAGE}`);
    assert.equal(article.needsScraping, false);
});

test('Parser prüft nach einem ungültigen data-src noch das gültige src', () => {
    const xml = createRssItem(`<img data-src="${HEART_ICON}" src="${UPLOAD_IMAGE}">`);
    const [article] = parseRssXml(xml, FEED);

    assert.equal(article.imageUrl, `https://www.destructoid.com${UPLOAD_IMAGE}`);
    assert.equal(article.needsScraping, false);
});

test('ungültiges Destructoid-Enclosure blockiert kein echtes Inhaltsbild', () => {
    const xml = createRssItem(
        `<img src="${UPLOAD_IMAGE}">`,
        `<enclosure url="https://www.destructoid.com${HEART_ICON}" type="image/png" />`,
    );
    const [article] = parseRssXml(xml, FEED);

    assert.equal(article.imageUrl, `https://www.destructoid.com${UPLOAD_IMAGE}`);
    assert.equal(article.needsScraping, false);
});

test('OG-Scraper überspringt ein Icon-Metafeld und nutzt den nächsten gültigen Kandidaten', async () => {
    // Der Abruf läuft über den gebundenen Transport; das fetchImpl wird deshalb
    // ausdrücklich übergeben statt globalThis.fetch zu ersetzen.
    const fetchImpl = async () => ({
        ok: true,
        status: 200,
        text: async () => `
            <html>
                <head>
                    <meta property="og:image" content="${HEART_ICON}">
                    <meta property="og:image:url" content="${UPLOAD_IMAGE}">
                </head>
            </html>
        `,
    });

    const imageUrl = await getOgImageFromUrl(
        'https://www.destructoid.com/test-article/',
        'Destructoid',
        // Gestellter Resolver: der Test soll ohne echtes DNS auskommen.
        { fetchImpl, lookup: async () => [{ address: '93.184.216.34', family: 4 }] },
    );

    assert.equal(imageUrl, `https://www.destructoid.com${UPLOAD_IMAGE}`);
});

test('Parser verarbeitet auch präfixiertes Atom vollständig', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
            <atom:title>Example</atom:title>
            <atom:entry>
                <atom:id>article-1</atom:id>
                <atom:title>Prefixed Atom article</atom:title>
                <atom:link rel="alternate" href="https://example.com/article-1" />
                <atom:published>2026-07-27T10:00:00Z</atom:published>
                <atom:summary>Summary</atom:summary>
            </atom:entry>
        </atom:feed>`;

    const [article] = parseRssXml(xml, {
        id: 'example',
        name: 'Example',
        language: 'en',
        needs_scraping: false,
        url: 'https://example.com/feed.xml',
    });

    assert.equal(article.id, 'article-1');
    assert.equal(article.title, 'Prefixed Atom article');
    assert.equal(article.link, 'https://example.com/article-1');
    assert.equal(article.summary, 'Summary');
});

// --- S1b: Ausgabe-Policy für Artikel- und Bildadressen ---

const POLICY_FEED = {
    id: 'beispiel',
    name: 'Beispiel',
    language: 'de',
    needs_scraping: false,
    url: 'https://beispiel.example/feed.xml',
};

function createFeedWithLinks(links) {
    const items = links.map((link, index) => `
                <item>
                    <title>Artikel ${index + 1}</title>
                    <link>${link}</link>
                    <pubDate>Sat, 25 Jul 2026 18:37:34 +0000</pubDate>
                    <description><![CDATA[Zusammenfassung]]></description>
                </item>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0"><channel><title>Beispiel</title>${items}</channel></rss>`;
}

test('verwirft Artikel mit unzulässigem Link und behält den Rest des Feeds', () => {
    const articles = parseRssXml(createFeedWithLinks([
        'https://beispiel.example/gut-1',
        'javascript:alert(1)',
        'data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;',
        'https://nutzer:geheim@beispiel.example/mit-zugangsdaten',
        'nicht::parsebar',
        'https://beispiel.example/gut-2',
    ]), POLICY_FEED);

    assert.deepEqual(
        articles.map(article => article.link),
        ['https://beispiel.example/gut-1', 'https://beispiel.example/gut-2'],
    );
});

test('löst relative Artikel-Links gegen die Feed-Adresse auf', () => {
    const articles = parseRssXml(
        createFeedWithLinks(['/artikel/relativ', '../hoch/eine-ebene']),
        POLICY_FEED,
    );

    assert.deepEqual(articles.map(article => article.link), [
        'https://beispiel.example/artikel/relativ',
        'https://beispiel.example/hoch/eine-ebene',
    ]);
});

test('behält einen Artikel, dessen Bildadresse abgelehnt wird', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0"><channel><title>Beispiel</title>
            <item>
                <title>Mit unzulässigem Bild</title>
                <link>https://beispiel.example/artikel</link>
                <pubDate>Sat, 25 Jul 2026 18:37:34 +0000</pubDate>
                <enclosure url="javascript:alert(1)" type="image/jpeg" />
                <description><![CDATA[Zusammenfassung]]></description>
            </item>
        </channel></rss>`;

    const articles = parseRssXml(xml, POLICY_FEED);

    assert.equal(articles.length, 1);
    assert.equal(articles[0].link, 'https://beispiel.example/artikel');
    assert.equal(articles[0].imageUrl, null);
});

test('löst relative Bildadressen gegen den Artikel-Link auf', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
            <channel><title>Beispiel</title>
            <item>
                <title>Mit relativem Bild</title>
                <link>https://beispiel.example/artikel/eins</link>
                <pubDate>Sat, 25 Jul 2026 18:37:34 +0000</pubDate>
                <description><![CDATA[Zusammenfassung]]></description>
                <content:encoded><![CDATA[<img src="/bilder/titel.jpg" />]]></content:encoded>
            </item>
        </channel></rss>`;

    const [article] = parseRssXml(xml, POLICY_FEED);
    assert.equal(article.imageUrl, 'https://beispiel.example/bilder/titel.jpg');
});

test('lässt gültige absolute Artikel- und Bildadressen unverändert', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0"><channel><title>Beispiel</title>
            <item>
                <title>Unverändert</title>
                <link>https://beispiel.example/artikel?a=1&amp;b=2</link>
                <pubDate>Sat, 25 Jul 2026 18:37:34 +0000</pubDate>
                <enclosure url="https://bilder.example/titel.jpg" type="image/jpeg" />
                <description><![CDATA[Zusammenfassung]]></description>
            </item>
        </channel></rss>`;

    const [article] = parseRssXml(xml, POLICY_FEED);
    assert.equal(article.link, 'https://beispiel.example/artikel?a=1&b=2');
    assert.equal(article.imageUrl, 'https://bilder.example/titel.jpg');
});

test('OG-Scraper kontaktiert keine internen Artikeladressen', async () => {
    let fetchCalls = 0;
    const fetchImpl = async () => {
        fetchCalls += 1;
        return { ok: true, status: 200, text: async () => '<html></html>' };
    };

    for (const articleUrl of [
        'http://169.254.169.254/latest/meta-data/',
        'http://127.0.0.1/artikel',
        'https://intern.example/artikel',
    ]) {
        const imageUrl = await getOgImageFromUrl(articleUrl, 'Beispiel', {
            fetchImpl,
            lookup: async () => [{ address: '10.0.0.5', family: 4 }],
        });
        assert.equal(imageUrl, null, `${articleUrl} lieferte ein Bild`);
    }

    assert.equal(fetchCalls, 0, 'eine interne Adresse wurde kontaktiert');
});
