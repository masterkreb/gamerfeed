import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../scripts/fetch-feeds.js';
import { createRunBudget } from '../../../scripts/feed-run-budget.js';
import { needsStoredImageRepair } from '../../../scripts/feed-image-utils.js';
import { PLAY3_HOMEPAGE_URL } from '../../../scripts/source-image-resolvers.js';
import {
    ALLE_SECRETS,
    VOLLSTAENDIGE_ENV,
    createControlledClock,
    createSpies,
    createTimeoutSignalFactory,
    runMain as startMain,
} from '../helpers/feed-run-harness.js';

// Vollstaendiger Feed-Lauf mit gestelltem Netz, Speicher, Uhr und Pausen.
// Play3 nutzt ausschliesslich den Startseiten-Batch, auch beim Backfill.
const PLAY3_ROW = Object.freeze({
    id: 'play3-1758000000002', name: 'Play3', url: 'https://www.play3.de/feed/',
    language: 'de', priority: 'primary', needs_scraping: false,
});
const OTHER_ROW = Object.freeze({
    id: 'andere', name: 'Andere', url: 'https://andere.example/feed/',
    language: 'de', priority: 'primary', needs_scraping: true,
});
const link = number => `https://www.play3.de/2026/10/03/artikel-${number}/`;
const image = number => `https://www.play3.de/wp-content/uploads/2026/10/bild-${number}.jpg`;
const placeholder = 'https://placehold.co/600x400?text=Play3';

function rss(links, images = []) {
    return `<rss version="2.0"><channel>${links.map((url, index) => `<item>
        <title>Artikel ${index + 1}</title><link>${url}</link><guid>${url}</guid>
        <pubDate>${new Date().toUTCString()}</pubDate><description>Text</description>
        ${images[index] ? `<enclosure url="${images[index]}" type="image/jpeg"/>` : ''}
    </item>`).join('')}</channel></rss>`;
}
const homepage = (...numbers) => `<html><body>${numbers.map(number =>
    `<a href="${link(number)}"><picture><img src="data:image/svg+xml,leer" data-lazy-src="${image(number)}"></picture></a>`
).join('')}</body></html>`;
const stored = (number, imageUrl = placeholder) => ({
    id: `alt-${number}`, title: `Alter Artikel ${number}`, source: 'Play3',
    publicationDate: new Date().toISOString(), summary: 'Bestand',
    link: link(number), imageUrl, language: 'de',
});

function testBudget(options = {}) {
    const clock = createControlledClock();
    const timeouts = createTimeoutSignalFactory();
    const budget = createRunBudget({
        now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
        createTimeoutSignal: timeouts.createTimeoutSignal,
        deadlineMs: 60 * 60 * 1000, optionalPhaseMinRemainingMs: 0, ...options,
    });
    return { budget, clock, timeouts };
}

function network(spies, { xml = rss([1, 2, 3].map(link)), page = () => new Response(homepage(1, 2, 3)), other } = {}) {
    return spies.makeFetchImpl(async (url, init) => {
        if (url === PLAY3_ROW.url) return new Response(xml);
        if (url === PLAY3_HOMEPAGE_URL) return page(init);
        if (other) return other(url, init);
        throw new Error(`Unerwarteter Abruf: ${url}`);
    });
}

async function run(spies, options = {}) {
    const budget = options.budget ?? testBudget().budget;
    const pauses = [];
    await startMain(main, spies, {
        budget, sleep: async ms => { pauses.push(ms); },
        groqFetch: spies.makeGroqFetch(async () => new Response(JSON.stringify({
            choices: [{ message: { content: '[]' } }],
        }))),
        ...options,
    });
    return { budget, pauses };
}
const articles = spies => spies.kvStore.news_cache.filter(article => article.source === 'Play3');
const health = spies => spies.kvStore.feed_health_status[PLAY3_ROW.id];

test('Play3: ein Startseitenabruf liefert alle Bilder ohne einzelne Artikel oder Proxy', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const { budget, pauses } = await run(spies, { fetchImpl: network(spies) });
    assert.deepEqual(spies.exitCodes, []);
    assert.deepEqual(spies.fetchCalls.map(call => call.url), [PLAY3_ROW.url, PLAY3_HOMEPAGE_URL]);
    assert.equal(budget.pageFetchesUsed, 1);
    assert.equal(pauses.filter(ms => ms === 500).length, 1);
    const images = new Map(articles(spies).map(article => [article.link, article.imageUrl]));
    for (const number of [1, 2, 3]) assert.equal(images.get(link(number)), image(number));
    assert.equal(health(spies).usableImageCount, 3);
    assert.equal(health(spies).placeholderImageCount, 0);
    assert.equal(spies.kvStore.feed_run_status.result, 'success');
    assert.ok(spies.logLines.some(line => line.includes('Play3 homepage image batch: 3/3 current')));
});

test('Play3: ein fehlender Treffer bleibt Platzhalter, ohne weitere Abrufe', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    await run(spies, { fetchImpl: network(spies, { page: () => new Response(homepage(1, 2)) }) });
    assert.equal(spies.fetchCalls.length, 2);
    assert.equal(articles(spies).length, 3);
    assert.equal(health(spies).usableImageCount, 2);
    assert.equal(health(spies).placeholderImageCount, 1);
    assert.ok(needsStoredImageRepair(articles(spies).find(article => article.link === link(3))));
});

for (const status of [401, 403, 429, 500]) {
    test(`Play3: HTTP ${status} der Startseite erzeugt nur einen Versuch und keinen Bildproxy`, async () => {
        const spies = createSpies({ feeds: [PLAY3_ROW] });
        const { budget } = await run(spies, { fetchImpl: network(spies, { page: () => new Response('Nein', { status }) }) });
        assert.deepEqual(spies.exitCodes, []);
        assert.equal(budget.pageFetchesUsed, 1);
        assert.deepEqual(spies.fetchCalls.map(call => call.url), [PLAY3_ROW.url, PLAY3_HOMEPAGE_URL]);
        assert.equal(articles(spies).length, 3);
        assert.ok(articles(spies).every(needsStoredImageRepair));
        assert.equal(health(spies).placeholderImageCount, 3);
        assert.ok(spies.logLines.some(line => line.includes(`Play3 homepage responded with HTTP ${status}`)));
    });
}

test('Play3: ein Einzeltimeout laesst Artikel und Publish bestehen', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    await run(spies, { fetchImpl: network(spies, { page: () => { throw new DOMException('Timeout', 'TimeoutError'); } }) });
    assert.equal(spies.fetchCalls.length, 2);
    assert.equal(articles(spies).length, 3);
    assert.equal(spies.kvStore.feed_run_status.result, 'success');
    assert.equal(health(spies).placeholderImageCount, 3);
});

test('Play3: dieselbe Startseite repariert alte Platzhalter, aber ueberschreibt keine echten Bilder', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const unchanged = 'https://www.play3.de/wp-content/uploads/bereits-gespeichert.jpg';
    spies.kvStore.news_cache = [stored(8), stored(9), stored(10, unchanged)];
    await run(spies, { fetchImpl: network(spies, {
        page: () => new Response(homepage(1, 2, 3, 8, 10)),
    }) });
    assert.equal(spies.fetchCalls.length, 2, 'kein eigener Backfill-Abruf');
    const byLink = new Map(articles(spies).map(article => [article.link, article]));
    assert.equal(byLink.get(link(8)).imageUrl, image(8));
    assert.ok(needsStoredImageRepair(byLink.get(link(9))), 'nicht mehr gelisteter Artikel bleibt reparierbar');
    assert.equal(byLink.get(link(10)).imageUrl, unchanged);
    assert.ok(spies.logLines.some(line => line.includes('1 stored image(s) repaired')));
});

test('Play3: RSS-Bilder und gespeicherte Bilder vermeiden den Batch, alte Platzhalter allein loesen ihn nicht aus', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    spies.kvStore.news_cache = [stored(1, image(1)), stored(9)];
    const { budget } = await run(spies, { fetchImpl: network(spies, {
        xml: rss([link(1), link(2)], [null, image(2)]),
    }) });
    assert.deepEqual(spies.fetchCalls.map(call => call.url), [PLAY3_ROW.url]);
    assert.equal(budget.pageFetchesUsed, 0);
    assert.equal(health(spies).usableImageCount, 2);
    assert.ok(needsStoredImageRepair(articles(spies).find(article => article.link === link(9))));
});

test('Play3: ein leeres RSS mit altem Bestand fuehrt zu keinem Startseiten- oder Artikelabruf', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    spies.kvStore.news_cache = [stored(9)];
    await run(spies, { fetchImpl: network(spies, { xml: rss([]) }) });
    assert.deepEqual(spies.fetchCalls.map(call => call.url), [PLAY3_ROW.url]);
    assert.equal(articles(spies).length, 1);
});

test('Play3: ohne Bildbudget bleiben alle Kandidaten genau einmal zurueckgestellt', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const { budget } = testBudget({ scrapeLimit: 0 });
    await run(spies, { budget, fetchImpl: network(spies) });
    assert.deepEqual(spies.fetchCalls.map(call => call.url), [PLAY3_ROW.url]);
    assert.equal(budget.pageFetchesUsed, 0);
    assert.deepEqual(budget.deferrals(), [{ reason: 'scrape_budget', kind: 'image_scrape', count: 3 }]);
    assert.equal(spies.kvStore.feed_run_status.result, 'degraded');
    assert.equal(articles(spies).length, 3);
    assert.ok(articles(spies).every(needsStoredImageRepair));
});

test('Play3: eine Budgeteinheit reicht fuer alle Bilder des Batches', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const { budget } = testBudget({ scrapeLimit: 1 });
    await run(spies, { budget, fetchImpl: network(spies) });
    assert.equal(budget.pageFetchesUsed, 1);
    assert.equal(health(spies).usableImageCount, 3);
    assert.equal(spies.kvStore.feed_run_status.result, 'success');
    assert.deepEqual(budget.deferrals(), []);
});

test('Play3: vor dem Batch abgelaufene Deadline startet keinen Abruf', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const { budget, clock } = testBudget({ deadlineMs: 60_000 });
    await run(spies, {
        budget, fetchImpl: network(spies),
        sleep: async ms => { if (ms === 200) clock.vor(60_000); },
    });
    assert.deepEqual(spies.fetchCalls.map(call => call.url), [PLAY3_ROW.url]);
    assert.deepEqual(budget.deferrals(), [{ reason: 'deadline', kind: 'image_scrape', count: 3 }]);
    assert.equal(budget.pageFetchesUsed, 0);
    assert.equal(spies.kvStore.feed_run_status.result, 'degraded');
});

test('Play3: eine waehrend des Batches erreichte Deadline beendet die Anfrage und markiert alle Kandidaten als zurueckgestellt', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const { budget, clock } = testBudget({ deadlineMs: 60_000 });
    await run(spies, {
        budget,
        fetchImpl: network(spies, { page: init => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
            setImmediate(() => clock.vor(60_000));
        }) }),
    });
    assert.equal(spies.fetchCalls.length, 2);
    assert.equal(budget.pageFetchesUsed, 1);
    assert.deepEqual(budget.deferrals(), [{ reason: 'deadline', kind: 'image_scrape', count: 3 }]);
    assert.equal(spies.kvStore.feed_run_status.result, 'degraded');
    assert.equal(articles(spies).length, 3);
});

test('Play3: ein spaeterer Lauf versucht fehlende RSS-Bilder erneut und ersetzt die Platzhalter', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    await run(spies, { fetchImpl: network(spies, { page: () => new Response('Forbidden', { status: 403 }) }) });
    assert.ok(articles(spies).every(needsStoredImageRepair));
    await run(spies, {
        fetchImpl: network(spies),
        // Wie in Produktion ist der zweite Lauf eine eigene, neuere Generation.
        createRecorder: options => ({
            ...spies.createRecorder(options), runId: 'second-test-run', startedAt: '2026-07-28T12:20:00.000Z',
        }),
    });
    assert.deepEqual(spies.exitCodes, [], spies.logLines.join('\n'));
    assert.equal(spies.fetchCalls.filter(call => call.url === PLAY3_HOMEPAGE_URL).length, 2);
    assert.equal(health(spies).usableImageCount, 3);
    assert.ok(articles(spies).every(article => !needsStoredImageRepair(article)));
});

test('Play3: ohne Proxy-Konfiguration funktioniert derselbe Startseiten-Batch', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const { FEED_PROXY_URL, ...env } = VOLLSTAENDIGE_ENV;
    assert.ok(FEED_PROXY_URL);
    await run(spies, { env, fetchImpl: network(spies) });
    assert.equal(spies.fetchCalls.length, 2);
    assert.equal(health(spies).usableImageCount, 3);
});

test('Play3: der RSS-Proxy bleibt unabhaengig vom proxyfreien Bildbatch verfuegbar', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    await run(spies, { fetchImpl: spies.makeFetchImpl(async url => {
        if (url === PLAY3_ROW.url) return new Response('Forbidden', { status: 403 });
        if (url === PLAY3_HOMEPAGE_URL) return new Response(homepage(1, 2, 3));
        const parsed = new URL(url);
        assert.equal(parsed.origin, 'https://proxy.example');
        assert.equal(parsed.searchParams.get('url'), PLAY3_ROW.url);
        assert.equal(parsed.searchParams.get('mode'), null, 'kein article-image');
        return new Response(rss([1, 2, 3].map(link)));
    }) });
    assert.equal(spies.fetchCalls.length, 3);
    assert.equal(health(spies).usableImageCount, 3);
});

test('Play3: Fehler des Batches veraendern die Bildabrufe anderer Quellen nicht', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW, OTHER_ROW] });
    const otherLink = 'https://andere.example/artikel';
    const otherImage = 'https://andere.example/bild.jpg';
    const { budget } = await run(spies, { fetchImpl: network(spies, {
        page: () => new Response('Forbidden', { status: 403 }),
        other: url => url === OTHER_ROW.url ? new Response(rss([otherLink]))
            : new Response(`<meta property="og:image" content="${otherImage}">`),
    }) });
    assert.equal(budget.pageFetchesUsed, 2);
    assert.deepEqual(spies.fetchCalls.map(call => call.url), [PLAY3_ROW.url, OTHER_ROW.url, PLAY3_HOMEPAGE_URL, otherLink]);
    assert.equal(spies.kvStore.news_cache.find(article => article.link === otherLink).imageUrl, otherImage);
});

test('Play3: Bildbudget des Batches und anderer Quellen ist gemeinsam begrenzt', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW, OTHER_ROW] });
    const { budget } = testBudget({ scrapeLimit: 1 });
    await run(spies, { budget, fetchImpl: network(spies, {
        other: url => {
            assert.equal(url, OTHER_ROW.url);
            return new Response(rss(['https://andere.example/artikel']));
        },
    }) });
    assert.equal(spies.fetchCalls.length, 3);
    assert.equal(budget.pageFetchesUsed, 1);
    assert.equal(health(spies).usableImageCount, 3);
    assert.deepEqual(budget.deferrals(), [{ reason: 'scrape_budget', kind: 'image_scrape', count: 1 }]);
});

test('Play3: nicht kanonische RSS-Artikel loesen weder Startseite noch Einzelabrufe aus', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    await run(spies, { fetchImpl: network(spies, { xml: rss(['https://andere.example/artikel']) }) });
    assert.deepEqual(spies.fetchCalls.map(call => call.url), [PLAY3_ROW.url]);
    assert.equal(articles(spies).length, 1);
});

test('Play3: mehrfache Quellenkonfiguration erzeugt trotzdem nur einen Bildbatch', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW, { ...PLAY3_ROW, id: 'play3-zweite' }] });
    await run(spies, { fetchImpl: network(spies) });
    assert.equal(spies.fetchCalls.filter(call => call.url === PLAY3_HOMEPAGE_URL).length, 1);
    assert.equal(articles(spies).length, 3);
});

test('Play3: Batch-Fehlermeldungen enthalten keine Secrets oder eingebetteten Zugangsdaten', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    await run(spies, { fetchImpl: network(spies, { page: () => {
        throw new Error(`Fehler ${Object.values(VOLLSTAENDIGE_ENV).join(' ')} https://name:passwort@host.example/?token=versteckt`);
    } }) });
    const output = spies.logLines.join('\n') + JSON.stringify(spies.kvStore.feed_run_status);
    for (const secret of [...ALLE_SECRETS, 'passwort', 'versteckt']) assert.ok(!output.includes(secret), secret);
});
