import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../scripts/fetch-feeds.js';
import {
    createSpies,
    feedFetch,
    runMain as startMain,
} from '../helpers/feed-run-harness.js';

// Charakterisierung des Laufs vor dem Zeit- und Scrape-Budget (Roadmap O2b).
//
// Festgehalten wird hier zuerst, was **erhalten bleiben muss**, und einmal
// ausdruecklich die heutige Luecke: die Zahl der Artikel-Seitenabrufe ist pro
// Lauf unbegrenzt. Genau diese Zusicherung dreht O2b anschliessend um.
//
// Kein Test wartet echt: `sleep` ist injiziert, alle Aussenkanten sind
// Attrappen.

const SCRAPE_FEED = Object.freeze({
    id: 'scrapequelle',
    name: 'Scrapequelle',
    url: 'https://scrape.example/feed.xml',
    language: 'de',
    priority: 'primary',
    needs_scraping: true,
});

/** RSS-Feed mit `anzahl` Artikeln ganz ohne Bild - jeder braucht einen Scrape. */
function rssOhneBilder(feed, anzahl, praefix = 'a') {
    const items = Array.from({ length: anzahl }, (_, index) => `
<item>
  <title>Artikel ${praefix}${index}</title>
  <link>${new URL(`/${praefix}${index}`, feed.url).href}</link>
  <guid isPermaLink="false">${praefix}${index}</guid>
  <pubDate>Sat, 25 Jul 2026 18:37:34 +0000</pubDate>
  <description>Text</description>
</item>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${feed.name}</title>${items}</channel></rss>`;
}

const ARTIKELSEITE = '<html><head><meta property="og:image" content="https://bilder.example/og.jpg"></head><body></body></html>';

function istArtikelseite(url) {
    return !url.includes('feed.xml') && !url.includes('proxy.example');
}

/** Zaehlt Artikel-Seitenabrufe und meldet die groesste Gleichzeitigkeit. */
function createNetz(spies, { feedAntwort }) {
    const zaehler = { seitenabrufe: 0, gleichzeitigMax: 0 };
    let gleichzeitig = 0;

    const fetchImpl = spies.makeFetchImpl(async url => {
        gleichzeitig += 1;
        zaehler.gleichzeitigMax = Math.max(zaehler.gleichzeitigMax, gleichzeitig);
        try {
            if (istArtikelseite(url)) {
                zaehler.seitenabrufe += 1;
                return new Response(ARTIKELSEITE, {
                    status: 200,
                    headers: { 'content-type': 'text/html' },
                });
            }
            return feedAntwort(url);
        } finally {
            gleichzeitig -= 1;
        }
    });

    return { fetchImpl, zaehler };
}

/** Kein Test darf echt warten - die Pausen werden nur gezaehlt. */
function createSchlaf() {
    const pausen = [];
    return { pausen, sleep: async ms => { pausen.push(ms); } };
}

async function runMain(spies, overrides = {}) {
    return startMain(main, spies, overrides);
}

const GROQ_LEER = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
    { status: 200 },
);

// === Heutige Luecke: unbegrenzte Seitenabrufe ===

test('heute ruft ein Lauf beliebig viele Artikelseiten ab', async () => {
    // Charakterisierung, kein Wunschverhalten: 40 Artikel ohne Bild ergeben
    // heute 40 Seitenabrufe. Bei 5 s Timeout je Seite ist das allein schon
    // laenger als drei Minuten - die Summe ist gegen das 30-Minuten-Hardlimit
    // des Workflows durch nichts gedeckelt.
    const spies = createSpies({ feeds: [SCRAPE_FEED] });
    const { sleep } = createSchlaf();
    const { fetchImpl, zaehler } = createNetz(spies, {
        feedAntwort: () => new Response(rssOhneBilder(SCRAPE_FEED, 40), { status: 200 }),
    });

    await runMain(spies, { fetchImpl, sleep, groqFetch: spies.makeGroqFetch(GROQ_LEER) });

    assert.deepEqual(spies.exitCodes, []);
    assert.equal(zaehler.seitenabrufe, 40, 'heute gibt es keine Obergrenze');
});

// === Zusicherungen, die O2b nicht verlieren darf ===

test('alte Artikel einer ausgefallenen Quelle bleiben erhalten', async () => {
    const spies = createSpies({ feeds: [SCRAPE_FEED] });
    const { sleep } = createSchlaf();

    // Bestand aus einem frueheren Lauf; die Quelle antwortet jetzt nicht mehr.
    spies.kvStore.news_cache = [{
        id: 'alt-1',
        title: 'Alter Artikel',
        source: 'Scrapequelle',
        publicationDate: new Date().toISOString(),
        summary: 'Bestand',
        link: 'https://scrape.example/alt-1',
        imageUrl: 'https://bilder.example/alt.jpg',
        language: 'de',
    }];

    await runMain(spies, {
        sleep,
        fetchImpl: spies.makeFetchImpl(async () => new Response('kaputt', { status: 500 })),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    const gespeichert = spies.kvStore.news_cache;
    assert.equal(gespeichert.length, 1, 'der Bestand ueberlebt einen Feed-Ausfall');
    assert.equal(gespeichert[0].link, 'https://scrape.example/alt-1');
    assert.equal(spies.kvStore.feed_health_status.scrapequelle.status, 'error');
});

test('ein vollstaendiger Lauf wird als success festgehalten', async () => {
    const spies = createSpies();
    const { sleep } = createSchlaf();

    await runMain(spies, {
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.deepEqual(spies.exitCodes, []);
    assert.equal(spies.kvStore.feed_run_status.result, 'success');
});

test('externe Abrufe laufen streng nacheinander', async () => {
    // Die Roadmap verbietet ungezuegelte Parallelisierung. Dieser Test haelt
    // fest, dass es heute genau einen offenen Request gibt - und faellt auf,
    // sobald jemand das unbemerkt aendert.
    const spies = createSpies({ feeds: [SCRAPE_FEED] });
    const { sleep } = createSchlaf();
    const { fetchImpl, zaehler } = createNetz(spies, {
        feedAntwort: () => new Response(rssOhneBilder(SCRAPE_FEED, 5), { status: 200 }),
    });

    await runMain(spies, { fetchImpl, sleep, groqFetch: spies.makeGroqFetch(GROQ_LEER) });

    assert.equal(zaehler.gleichzeitigMax, 1, 'nie mehr als ein offener Request');
});
