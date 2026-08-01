import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../scripts/fetch-feeds.js';
import { XBOXDYNASTY_IMAGE_API_URL } from '../../../scripts/source-image-resolvers.js';
import {
    createSpies,
    runMain as startMain,
} from '../helpers/feed-run-harness.js';

const XBOXDYNASTY_ROW = Object.freeze({
    id: 'xboxdynasty',
    name: 'XboxDynasty',
    url: 'https://www.xboxdynasty.de/feed/',
    language: 'de',
    priority: 'secondary',
    // Der Quellenadapter muss auch nach einem versehentlich entfernten
    // Datenbank-Flag weiter greifen.
    needs_scraping: false,
});

const ARTICLE_LINKS = Object.freeze([
    'https://www.xboxdynasty.de/news/spiel/erster-artikel/',
    'https://www.xboxdynasty.de/news/spiel/zweiter-artikel/',
]);

const ARTICLE_IMAGES = Object.freeze([
    'https://www.xboxdynasty.de/wp-content/uploads/2026/08/erstes-bild.jpg',
    'https://www.xboxdynasty.de/wp-content/uploads/2026/08/zweites-bild.jpg',
]);

function xboxRss() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>XboxDynasty</title>
${ARTICLE_LINKS.map((link, index) => `<item>
  <title>Xbox-Artikel ${index + 1}</title>
  <link>${link}</link>
  <guid isPermaLink="false">xbox-${index + 1}</guid>
  <pubDate>Sat, 01 Aug 2026 10:0${index}:00 +0000</pubDate>
  <description><![CDATA[<p>Text ohne Bild</p>]]></description>
</item>`).join('\n')}
</channel></rss>`;
}

function wordpressPosts() {
    return ARTICLE_LINKS.map((link, index) => ({
        link: index === 0 ? link.slice(0, -1) : `${link}?utm_source=api`,
        yoast_head_json: { og_image: [{ url: ARTICLE_IMAGES[index] }] },
    }));
}

const GROQ_EMPTY = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
    { status: 200 },
);

async function runXboxMain(spies, fetchImpl) {
    return startMain(main, spies, {
        sleep: async () => {},
        fetchImpl,
        groqFetch: spies.makeGroqFetch(GROQ_EMPTY),
    });
}

test('ein WordPress-Batch liefert alle XboxDynasty-Bilder ohne einzelne Artikelseiten abzurufen', async () => {
    const spies = createSpies({ feeds: [XBOXDYNASTY_ROW] });
    const fetchImpl = spies.makeFetchImpl(async url => {
        if (url === XBOXDYNASTY_ROW.url) return new Response(xboxRss(), { status: 200 });
        if (url === XBOXDYNASTY_IMAGE_API_URL) {
            return new Response(JSON.stringify(wordpressPosts()), { status: 200 });
        }
        throw new Error(`einzelner Artikelabruf ist unzulässig: ${url}`);
    });

    await runXboxMain(spies, fetchImpl);

    assert.deepEqual(spies.exitCodes, []);
    assert.deepEqual(
        spies.fetchCalls.map(call => call.url),
        [XBOXDYNASTY_ROW.url, XBOXDYNASTY_IMAGE_API_URL],
        'ein RSS-Abruf und ein Bildbatch, keine zwei Artikelseiten',
    );
    const imagesByLink = new Map(
        spies.kvStore.news_cache.map(article => [article.link, article.imageUrl]),
    );
    assert.equal(imagesByLink.get(ARTICLE_LINKS[0]), ARTICLE_IMAGES[0]);
    assert.equal(imagesByLink.get(ARTICLE_LINKS[1]), ARTICLE_IMAGES[1]);
    assert.equal(spies.kvStore.feed_health_status.xboxdynasty.articleCount, 2);
    assert.equal(spies.kvStore.feed_health_status.xboxdynasty.usableImageCount, 2);
    assert.equal(spies.kvStore.feed_health_status.xboxdynasty.placeholderImageCount, 0);
});

test('ein API-Fehler erzeugt nur einen kleinen Versuch und macht die Platzhalter messbar', async () => {
    const spies = createSpies({ feeds: [XBOXDYNASTY_ROW] });
    const fetchImpl = spies.makeFetchImpl(async url => {
        if (url === XBOXDYNASTY_ROW.url) return new Response(xboxRss(), { status: 200 });
        if (url === XBOXDYNASTY_IMAGE_API_URL) return new Response('Unauthorized', { status: 401 });
        throw new Error(`einzelner Artikelabruf ist unzulässig: ${url}`);
    });

    await runXboxMain(spies, fetchImpl);

    assert.deepEqual(spies.exitCodes, []);
    assert.equal(spies.fetchCalls.length, 2, 'kein 401-Sturm gegen einzelne Artikelseiten');
    assert.equal(
        spies.kvStore.news_cache.every(article => article.imageUrl.includes('placehold.co')),
        true,
    );
    assert.equal(spies.kvStore.feed_health_status.xboxdynasty.usableImageCount, 0);
    assert.equal(spies.kvStore.feed_health_status.xboxdynasty.placeholderImageCount, 2);
    assert.ok(
        spies.logLines.some(line => line.includes('XboxDynasty image batch unavailable')),
        'der einzelne Batchfehler bleibt im Laufprotokoll sichtbar',
    );
});
