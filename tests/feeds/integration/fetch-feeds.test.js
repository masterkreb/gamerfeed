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

test('OG-Scraper überspringt ein Icon-Metafeld und nutzt den nächsten gültigen Kandidaten', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = originalFetch;
    });

    globalThis.fetch = async () => ({
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
