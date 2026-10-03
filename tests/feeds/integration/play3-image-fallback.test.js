import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../scripts/fetch-feeds.js';
import { createRunBudget } from '../../../scripts/feed-run-budget.js';
import { needsStoredImageRepair } from '../../../scripts/feed-image-utils.js';
import {
    ALLE_SECRETS,
    VOLLSTAENDIGE_ENV,
    createControlledClock,
    createSpies,
    createTimeoutSignalFactory,
    runMain as startMain,
} from '../helpers/feed-run-harness.js';

// Bildpfad von Play3 im vollständigen Lauf: Direktabruf, Proxy-Bildmodus,
// Budget je Anfrage und Bremse pro Lauf.
//
// Kein Test wartet echt oder berührt ein echtes System: Uhr, Timer und `sleep`
// sind gestellt, alle Außenkanten sind Attrappen. Den Proxy gibt es nur als
// Adresse in der Konfiguration; kein Test ruft Play3, Cyon oder eine andere
// Gegenstelle auf.

const PLAY3_ROW = Object.freeze({
    id: 'play3-1758000000002',
    name: 'Play3',
    url: 'https://www.play3.de/feed/',
    language: 'de',
    priority: 'primary',
    needs_scraping: true,
});

const ANDERE_ROW = Object.freeze({
    id: 'scrapequelle',
    name: 'Scrapequelle',
    url: 'https://scrape.example/feed.xml',
    language: 'de',
    priority: 'primary',
    needs_scraping: true,
});

const PLAY3_BILD = 'https://bilder.play3.de/artikel.jpg';
const ANDERES_BILD = 'https://bilder.example/andere.jpg';
const PROXY_BASIS = 'https://proxy.example/feed-proxy.php';

const seite = bild => `<html><head><meta property="og:image" content="${bild}"></head><body></body></html>`;

function play3Link(nummer) {
    return `https://www.play3.de/2026/10/03/artikel-${nummer}/`;
}

/** RSS-Feed ohne jedes Bild: jeder Artikel braucht einen Seitenabruf. */
function rssOhneBilder(name, links) {
    const items = links.map((link, index) => `
<item>
  <title>Artikel ${name} ${index + 1}</title>
  <link>${link}</link>
  <guid isPermaLink="false">${name}-${index + 1}</guid>
  <pubDate>Sat, 25 Jul 2026 18:37:34 +0000</pubDate>
  <description>Text</description>
</item>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${name}</title>${items}</channel></rss>`;
}

const play3Feed = anzahl => rssOhneBilder(
    'Play3',
    Array.from({ length: anzahl }, (_, index) => play3Link(index + 1)),
);

const andererFeed = anzahl => rssOhneBilder(
    'Scrapequelle',
    Array.from({ length: anzahl }, (_, index) => `https://scrape.example/a${index + 1}`),
);

const verweigert = (status = 403) => new Response('Nein', { status });
const seiteMitBild = () => new Response(seite(PLAY3_BILD), { status: 200, headers: { 'content-type': 'text/html' } });
// So antwortet der Bildmodus des Proxys: derselbe Rumpf, aber als text/plain.
const proxySeiteMitBild = () => new Response(seite(PLAY3_BILD), {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
});

/**
 * Netz des Laufs. Jede Anfrage wird dem Weg zugeordnet, auf dem sie ankommt:
 * Feed, Direktabruf einer Play3-Seite, Proxy-Bildmodus oder Seite einer anderen
 * Quelle. Die Antwortfunktionen bekommen die laufende Nummer ihres Wegs (ab 1).
 */
function createNetz(spies, {
    feeds,
    play3Direkt = () => verweigert(403),
    play3Proxy = proxySeiteMitBild,
    andereSeite = () => new Response(seite(ANDERES_BILD), { status: 200 }),
}) {
    const zaehler = {
        andere: 0,
        direkt: 0,
        direktAdressen: [],
        proxy: 0,
        proxyAdressen: [],
    };

    const fetchImpl = spies.makeFetchImpl(async (url, init) => {
        if (Object.hasOwn(feeds, url)) return new Response(feeds[url], { status: 200 });

        if (url.startsWith(PROXY_BASIS)) {
            const anfrage = new URL(url);
            assert.equal(anfrage.searchParams.get('mode'), 'article-image', 'der Proxy dient hier nur dem Bildmodus');
            zaehler.proxy += 1;
            zaehler.proxyAdressen.push(anfrage.searchParams.get('url'));
            return play3Proxy(zaehler.proxy);
        }

        if (url.startsWith('https://www.play3.de/')) {
            zaehler.direkt += 1;
            zaehler.direktAdressen.push(url);
            return play3Direkt(zaehler.direkt, init);
        }

        zaehler.andere += 1;
        return andereSeite(zaehler.andere);
    });

    return { fetchImpl, zaehler };
}

/** Budget mit gestellter Uhr; kein Timer feuert von selbst. */
function createTestBudgetMitUhr(optionen = {}) {
    const uhr = createControlledClock();
    const fabrik = createTimeoutSignalFactory();
    const budget = createRunBudget({
        now: uhr.now,
        setTimer: uhr.setTimer,
        clearTimer: uhr.clearTimer,
        createTimeoutSignal: fabrik.createTimeoutSignal,
        deadlineMs: 60 * 60 * 1000,
        ...optionen,
    });
    return { budget, uhr };
}

const createTestBudget = optionen => createTestBudgetMitUhr(optionen).budget;

/** Anfrage, die nur über ihr Abbruchsignal endet; währenddessen läuft die Uhr weiter. */
function haengendeAntwort(uhr, { vorMs }) {
    return (_nummer, init) => new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        // Sobald die Anfrage wirklich offen ist, läuft die gestellte Uhr weiter.
        // Kein echtes Warten - nur ein Makrotask.
        setImmediate(() => uhr.vor(vorMs));
    });
}

/** Kein Test darf echt warten - die Pausen werden nur gezählt. */
function createSchlaf() {
    const pausen = [];
    return { pausen, sleep: async ms => { pausen.push(ms); } };
}

const GROQ_LEER = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
    { status: 200 },
);

async function runMain(spies, { budget = createTestBudget(), sleep, ...overrides } = {}) {
    const schlaf = sleep ? { sleep } : createSchlaf();
    await startMain(main, spies, {
        budget,
        sleep: schlaf.sleep,
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
        ...overrides,
    });
    return { budget, pausen: schlaf.pausen ?? [] };
}

function bremsenZeilen(spies) {
    return spies.logLines.filter(line => line.includes('ausgesetzt'));
}

function gespeicherteArtikel(spies, quelle) {
    return spies.kvStore.news_cache.filter(artikel => artikel.source === quelle);
}

// === Budget je Anfrage und Bremse des Direktwegs ===

test('Play3: ein Direkt-403 bremst den Rest des Laufs, jeder Proxyversuch kostet eine Einheit', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const { fetchImpl, zaehler } = createNetz(spies, {
        feeds: { [PLAY3_ROW.url]: play3Feed(4) },
    });

    const { budget } = await runMain(spies, { fetchImpl });

    assert.deepEqual(spies.exitCodes, []);
    assert.equal(zaehler.direkt, 1, 'der Direktweg wird im Lauf genau einmal geprüft');
    assert.equal(zaehler.proxy, 4, 'alle vier Artikel gehen über den Proxy');
    assert.deepEqual(
        zaehler.proxyAdressen,
        [1, 2, 3, 4].map(play3Link),
        'der Proxy bekommt genau die Artikeladressen',
    );
    assert.equal(budget.pageFetchesUsed, 5, 'eine Einheit je Anfrage: ein Direkt- plus vier Proxyversuche');

    const artikel = gespeicherteArtikel(spies, 'Play3');
    assert.equal(artikel.length, 4);
    assert.ok(artikel.every(eintrag => eintrag.imageUrl === PLAY3_BILD), 'jeder Artikel hat sein Bild');

    assert.equal(spies.kvStore.feed_run_status.result, 'success');
    assert.equal(budget.isDegraded(), false);

    const zeilen = bremsenZeilen(spies);
    assert.equal(zeilen.length, 1, 'genau eine Zeile für die Bremse');
    assert.match(zeilen[0], /Play3/);
    assert.match(zeilen[0], /Direktabruf/);
    assert.match(zeilen[0], /HTTP 403/);
});

test('Play3: Protokoll und Heartbeat enthalten weder Proxy-Adresse noch Secrets', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const { fetchImpl } = createNetz(spies, {
        feeds: { [PLAY3_ROW.url]: play3Feed(3) },
        play3Proxy: nummer => (nummer === 2 ? verweigert(403) : proxySeiteMitBild()),
    });

    await runMain(spies, { fetchImpl });

    // Beide Bremsen haben gegriffen: der Direktweg beim ersten, der Proxy beim
    // zweiten Artikel.
    assert.equal(bremsenZeilen(spies).length, 2);

    const protokoll = spies.logLines.join('\n');
    const gespeichert = JSON.stringify(spies.kvStore);
    for (const secret of ALLE_SECRETS) {
        assert.doesNotMatch(protokoll, new RegExp(secret), `${secret} steht im Log`);
        assert.doesNotMatch(gespeichert, new RegExp(secret), `${secret} steht im Heartbeat`);
    }
    for (const zeile of bremsenZeilen(spies)) {
        assert.doesNotMatch(zeile, /https?:|proxy\.example|play3\.de/, 'keine Adresse in der Bremsenzeile');
    }
});

test('Play3: ist das Budget nach dem Direktversuch leer, entfällt der Proxyversuch und der Artikel gilt als zurückgestellt', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const budget = createTestBudget({ scrapeLimit: 1 });
    const { fetchImpl, zaehler } = createNetz(spies, {
        feeds: { [PLAY3_ROW.url]: play3Feed(1) },
    });

    await runMain(spies, { budget, fetchImpl });

    assert.equal(zaehler.direkt, 1);
    assert.equal(zaehler.proxy, 0, 'ohne Einheit kein Proxyversuch');
    assert.equal(budget.pageFetchesUsed, 1);
    assert.deepEqual(
        budget.deferrals(),
        [{ reason: 'scrape_budget', kind: 'image_scrape', count: 1 }],
        'der Artikel ist als zurückgestelltes Scrape gezählt',
    );

    assert.equal(spies.kvStore.feed_run_status.result, 'degraded', 'zurückgestellt ist nicht success');
    assert.match(spies.kvStore.feed_run_status.degradedReason, /Scrape-Budget/);

    // Wie jeder Budgetmangel: Platzhalter, im nächsten Lauf wieder Kandidat.
    const artikel = gespeicherteArtikel(spies, 'Play3');
    assert.equal(artikel.length, 1, 'der Artikel geht nicht verloren');
    assert.ok(needsStoredImageRepair(artikel[0]), 'er bleibt Kandidat für den nächsten Lauf');
});

test('Play3: jeder Artikel wird bei Budgetmangel genau einmal als zurückgestellt gezählt', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const budget = createTestBudget({ scrapeLimit: 1 });
    const { fetchImpl, zaehler } = createNetz(spies, {
        feeds: { [PLAY3_ROW.url]: play3Feed(3) },
    });

    await runMain(spies, { budget, fetchImpl });

    // Der erste Artikel scheitert mitten im Artikel (Direktversuch ja, Proxy
    // nein), die beiden anderen an der Vorprüfung der Schleife.
    assert.equal(zaehler.direkt + zaehler.proxy, 1);
    const gezaehlt = budget.deferrals()
        .filter(eintrag => eintrag.kind === 'image_scrape')
        .reduce((summe, eintrag) => summe + eintrag.count, 0);
    assert.equal(gezaehlt, 3, 'drei Artikel, drei Zurückstellungen - keine doppelte Zählung');
    assert.equal(gespeicherteArtikel(spies, 'Play3').length, 3);
});

test('Play3: nach der Deadline beginnt kein Proxyversuch mehr und kostet keine Einheit', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const { budget, uhr } = createTestBudgetMitUhr({ deadlineMs: 60_000, optionalPhaseMinRemainingMs: 0 });
    const { fetchImpl, zaehler } = createNetz(spies, {
        feeds: { [PLAY3_ROW.url]: play3Feed(1) },
        // Der Direktversuch hängt, bis die Deadline des Laufs ihn abbricht.
        play3Direkt: haengendeAntwort(uhr, { vorMs: 60_000 }),
    });

    await runMain(spies, { budget, fetchImpl });

    assert.equal(budget.signal.aborted, true, 'der Gesamtabbruch hat gegriffen');
    assert.equal(zaehler.direkt, 1);
    assert.equal(zaehler.proxy, 0, 'nach der Deadline entsteht keine neue Anfrage');
    assert.equal(budget.pageFetchesUsed, 1, 'der Proxyversuch hat keine Einheit verbraucht');
    assert.deepEqual(
        budget.deferrals(),
        [{ reason: 'deadline', kind: 'image_scrape', count: 1 }],
        'es ist eine Zurückstellung wegen der Deadline, nicht wegen des Scrape-Budgets',
    );
    assert.equal(spies.kvStore.feed_run_status.result, 'degraded');
    assert.match(spies.kvStore.feed_run_status.degradedReason, /Zeitbudget/);
    assert.deepEqual(bremsenZeilen(spies), [], 'ein Abbruch durch die Deadline ist kein Fehlschlag der Gegenstelle');
});

test('Play3: Direktversuch plus Proxyversuch passen genau in ein Budget von zwei Einheiten', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const budget = createTestBudget({ scrapeLimit: 2 });
    const { fetchImpl, zaehler } = createNetz(spies, {
        feeds: { [PLAY3_ROW.url]: play3Feed(1) },
    });

    await runMain(spies, { budget, fetchImpl });

    assert.equal(zaehler.direkt, 1);
    assert.equal(zaehler.proxy, 1);
    assert.equal(budget.pageFetchesUsed, 2);
    assert.equal(spies.kvStore.feed_run_status.result, 'success', 'ausgeschöpft ist nicht überschritten');
    assert.equal(gespeicherteArtikel(spies, 'Play3')[0].imageUrl, PLAY3_BILD);
});

test('Play3: der Backfill nutzt dieselbe Bremse wie der Neu-Scrape', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    // Alter Bestand mit Platzhaltern: er kommt zusätzlich in den Backfill.
    spies.kvStore.news_cache = Array.from({ length: 3 }, (_, index) => ({
        id: `alt-${index}`,
        title: `Alter Artikel ${index}`,
        source: 'Play3',
        publicationDate: new Date().toISOString(),
        summary: 'Bestand',
        link: `https://www.play3.de/2026/09/01/alt-${index}/`,
        imageUrl: 'https://placehold.co/600x400/374151/d1d5db?text=Play3',
        language: 'de',
    }));
    const { fetchImpl, zaehler } = createNetz(spies, {
        feeds: { [PLAY3_ROW.url]: play3Feed(1) },
    });

    const { budget } = await runMain(spies, { fetchImpl });

    assert.equal(zaehler.direkt, 1, 'Neu-Scrape und Backfill zusammen prüfen den Direktweg nur einmal');
    assert.equal(zaehler.proxy, 4, 'ein neuer plus drei alte Artikel');
    assert.equal(budget.pageFetchesUsed, 5);
    assert.ok(
        gespeicherteArtikel(spies, 'Play3').every(artikel => artikel.imageUrl === PLAY3_BILD),
        'auch der Bestand ist repariert',
    );
    assert.equal(bremsenZeilen(spies).length, 1);
});

test('Play3: kehrt der Direktweg zurück, braucht der Lauf den Proxy nicht mehr', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const { fetchImpl, zaehler } = createNetz(spies, {
        feeds: { [PLAY3_ROW.url]: play3Feed(3) },
        play3Direkt: seiteMitBild,
    });

    const { budget } = await runMain(spies, { fetchImpl });

    assert.equal(zaehler.direkt, 3);
    assert.equal(zaehler.proxy, 0);
    assert.equal(budget.pageFetchesUsed, 3, 'eine Einheit je Artikel, wie bei jeder anderen Quelle');
    assert.deepEqual(bremsenZeilen(spies), []);
});

test('Play3: ohne Proxy-Adresse kostet nur der erste Direkt-403 eine Anfrage und eine Pause', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const { FEED_PROXY_URL, ...ohneProxy } = VOLLSTAENDIGE_ENV;
    assert.ok(FEED_PROXY_URL, 'Vorbedingung: die Vollkonfiguration kennt einen Proxy');
    const { fetchImpl, zaehler } = createNetz(spies, {
        feeds: { [PLAY3_ROW.url]: play3Feed(4) },
    });

    const { budget, pausen } = await runMain(spies, { env: ohneProxy, fetchImpl });

    assert.equal(zaehler.direkt, 1);
    assert.equal(zaehler.proxy, 0);
    assert.equal(budget.pageFetchesUsed, 1);
    assert.equal(
        pausen.filter(ms => ms === 500).length,
        1,
        'Artikel ohne jede Anfrage lösen keine Höflichkeitspause aus',
    );
    assert.equal(bremsenZeilen(spies).length, 1);
    assert.ok(gespeicherteArtikel(spies, 'Play3').every(artikel => needsStoredImageRepair(artikel)));
});

// === Bremse des Proxywegs ===

for (const status of [403, 429, 422]) {
    test(`Play3: HTTP ${status} vom Proxy setzt den Proxyweg für den Rest des Laufs aus`, async () => {
        const spies = createSpies({ feeds: [PLAY3_ROW] });
        const { fetchImpl, zaehler } = createNetz(spies, {
            feeds: { [PLAY3_ROW.url]: play3Feed(4) },
            // Ein 404 betrifft nur den Artikel: der Direktweg bleibt offen.
            play3Direkt: () => verweigert(404),
            play3Proxy: () => verweigert(status),
        });

        const { budget } = await runMain(spies, { fetchImpl });

        assert.equal(zaehler.proxy, 1, 'nach dem ersten Treffer folgt kein Proxyabruf mehr');
        assert.equal(zaehler.direkt, 4);
        assert.equal(budget.pageFetchesUsed, 5);

        const zeilen = bremsenZeilen(spies);
        assert.equal(zeilen.length, 1);
        assert.match(zeilen[0], /Proxyabruf/);
        assert.match(zeilen[0], new RegExp(`HTTP ${status}`));
        assert.ok(
            gespeicherteArtikel(spies, 'Play3').every(artikel => needsStoredImageRepair(artikel)),
            'die Artikel behalten ihren Platzhalter und bleiben Kandidaten',
        );
    });
}

test('Play3: Netzwerkfehler des Proxys stoppen ihn erst nach drei Fehlschlägen in Folge', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const { fetchImpl, zaehler } = createNetz(spies, {
        feeds: { [PLAY3_ROW.url]: play3Feed(5) },
        play3Direkt: () => verweigert(404),
        play3Proxy: () => {
            throw new Error('Verbindung abgebrochen');
        },
    });

    await runMain(spies, { fetchImpl });

    assert.equal(zaehler.proxy, 3);
    assert.equal(zaehler.direkt, 5);
    const zeilen = bremsenZeilen(spies);
    assert.equal(zeilen.length, 1);
    assert.match(zeilen[0], /3 Fehlschläge in Folge/);
});

test('Play3: 404 und Seiten ohne Bild bremsen den Lauf nicht', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW] });
    const ohneBild = nummer => (
        nummer % 2 === 1
            ? verweigert(404)
            : new Response('<html><head></head></html>', { status: 200 })
    );
    const { fetchImpl, zaehler } = createNetz(spies, {
        feeds: { [PLAY3_ROW.url]: play3Feed(4) },
        play3Direkt: ohneBild,
        play3Proxy: ohneBild,
    });

    const { budget } = await runMain(spies, { fetchImpl });

    assert.equal(zaehler.direkt, 4);
    assert.equal(zaehler.proxy, 4);
    assert.equal(budget.pageFetchesUsed, 8);
    assert.deepEqual(bremsenZeilen(spies), []);
});

// === Andere Quellen bleiben unverändert ===

test('andere Quellen: kein Proxyversuch, keine Bremse, eine Einheit je Artikel', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW, ANDERE_ROW] });
    const { fetchImpl, zaehler } = createNetz(spies, {
        feeds: {
            [PLAY3_ROW.url]: play3Feed(3),
            [ANDERE_ROW.url]: andererFeed(3),
        },
        // Der Direktweg von Play3 ist ausgesetzt, die andere Quelle antwortet
        // dagegen jedes Mal mit 403: sie bekommt trotzdem jedes Mal ihren Versuch.
        play3Direkt: () => verweigert(403),
        andereSeite: () => verweigert(403),
    });

    const { budget } = await runMain(spies, { fetchImpl });

    assert.equal(zaehler.andere, 3, 'jeder Artikel der anderen Quelle wird einzeln versucht');
    assert.equal(zaehler.direkt, 1, 'Play3 prüft seinen Direktweg im Lauf einmal');
    assert.equal(zaehler.proxy, 3, 'nur Play3 nutzt den Proxy');
    assert.equal(budget.pageFetchesUsed, 3 + 1 + 3);
    assert.equal(bremsenZeilen(spies).length, 1, 'die einzige Bremse gilt Play3');
    assert.match(bremsenZeilen(spies)[0], /Play3/);

    const andere = gespeicherteArtikel(spies, 'Scrapequelle');
    assert.equal(andere.length, 3);
    assert.ok(andere.every(artikel => needsStoredImageRepair(artikel)), 'ihre Artikel behalten den Platzhalter');
});

test('andere Quellen: ein Proxy-Stopp von Play3 betrifft sie nicht', async () => {
    const spies = createSpies({ feeds: [PLAY3_ROW, ANDERE_ROW] });
    const { fetchImpl, zaehler } = createNetz(spies, {
        feeds: {
            [PLAY3_ROW.url]: play3Feed(3),
            [ANDERE_ROW.url]: andererFeed(3),
        },
        play3Direkt: () => verweigert(404),
        play3Proxy: () => verweigert(403),
    });

    await runMain(spies, { fetchImpl });

    assert.equal(zaehler.proxy, 1);
    assert.equal(zaehler.andere, 3);
    assert.ok(
        gespeicherteArtikel(spies, 'Scrapequelle').every(artikel => artikel.imageUrl === ANDERES_BILD),
        'die andere Quelle bekommt ihre Bilder wie bisher',
    );
});
