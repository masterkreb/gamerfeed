import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../scripts/fetch-feeds.js';
import { createFeedRunRecorder } from '../../../scripts/feed-run-recorder.js';
import { createRunBudget } from '../../../scripts/feed-run-budget.js';
import { needsStoredImageRepair } from '../../../scripts/feed-image-utils.js';
import {
    ALLE_SECRETS,
    FEED_ROW,
    createControlledClock,
    createSpies,
    feedFetch,
    createTimeoutSignalFactory,
    runMain as startMain,
} from '../helpers/feed-run-harness.js';

// Zeit- und Scrape-Budget des Cron-Laufs (Roadmap-Paket O2b).
//
// Kein Test wartet echt: Uhr, Deadline-Timer und Einzeltimeout sind gestellt,
// `sleep` ist injiziert, alle Aussenkanten sind Attrappen. Keiner beruehrt
// einen Feed, Groq, KV, PostgreSQL, Vercel, Cyon oder den Proxy.

const SCRAPE_FEED = Object.freeze({
    id: 'scrapequelle',
    name: 'Scrapequelle',
    url: 'https://scrape.example/feed.xml',
    language: 'de',
    priority: 'primary',
    needs_scraping: true,
});

function scrapeFeedRow(id, name, host) {
    return Object.freeze({
        id,
        name,
        url: `https://${host}/feed.xml`,
        language: 'de',
        priority: 'primary',
        needs_scraping: true,
    });
}

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
function createNetz(spies, { feedAntwort, seitenAntwort = () => new Response(ARTIKELSEITE, { status: 200, headers: { 'content-type': 'text/html' } }) }) {
    const zaehler = { seitenabrufe: 0, feedabrufe: 0, gleichzeitigMax: 0, seiten: [] };
    let gleichzeitig = 0;

    const fetchImpl = spies.makeFetchImpl(async (url, init) => {
        gleichzeitig += 1;
        zaehler.gleichzeitigMax = Math.max(zaehler.gleichzeitigMax, gleichzeitig);
        try {
            if (istArtikelseite(url)) {
                zaehler.seitenabrufe += 1;
                zaehler.seiten.push(url);
                return await seitenAntwort(url, init);
            }
            zaehler.feedabrufe += 1;
            return await feedAntwort(url, init);
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

/**
 * Budget mit gestellter Uhr.
 *
 * `createTimeoutSignal` liefert bewusst ein Signal, das **nie** von selbst
 * feuert. Damit kann nur der kontrollierte Gesamtabbruch eine haengende
 * Anfrage beenden - genau das ist die Zusage von O2b.
 */
function createTestBudget(uhr, optionen = {}) {
    const fabrik = createTimeoutSignalFactory();
    const budget = createRunBudget({
        now: uhr.now,
        setTimer: uhr.setTimer,
        clearTimer: uhr.clearTimer,
        createTimeoutSignal: fabrik.createTimeoutSignal,
        ...optionen,
    });
    return { budget, fabrik };
}

/** Anfrage, die nur ueber ihr Abbruchsignal endet. */
function haengendeAntwort(uhr, { vorMs }) {
    return (_url, init) => new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        // Sobald die Anfrage wirklich offen ist, laeuft die gestellte Uhr
        // weiter. Kein echtes Warten - nur ein Makrotask.
        setImmediate(() => uhr.vor(vorMs));
    });
}

async function runMain(spies, overrides = {}) {
    return startMain(main, spies, overrides);
}

const GROQ_LEER = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
    { status: 200 },
);

// === Kontrollierter Gesamtabbruch ===

test('ein haengender Feed endet vor CORE_DEADLINE_MS ueber den Gesamtabbruch', async () => {
    const spies = createSpies({ feeds: [FEED_ROW] });
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 60_000 });
    const { sleep } = createSchlaf();

    await runMain(spies, {
        budget,
        sleep,
        // Der Feed antwortet nie. Ohne Gesamtabbruch liefe der Lauf endlos:
        // das Einzeltimeout ist hier ausdrücklich abgeschaltet.
        fetchImpl: spies.makeFetchImpl(haengendeAntwort(uhr, { vorMs: 60_000 })),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.deepEqual(spies.exitCodes, [], 'der Lauf endet kontrolliert, nicht fatal');
    assert.equal(budget.signal.aborted, true, 'der Gesamtabbruch hat gegriffen');
    assert.ok(budget.elapsedMs() <= budget.deadlineMs + 1, 'nicht über die Deadline hinaus');
    assert.equal(spies.kvStore.feed_run_status.result, 'degraded');
    assert.equal(spies.kvStore.feed_health_status.gamestar.status, 'warning');
    assert.match(spies.kvStore.feed_health_status.gamestar.message, /Zeitbudget/);
});

test('ein haengender Bild-Scrape endet ebenfalls vor der Gesamtdeadline', async () => {
    const spies = createSpies({ feeds: [SCRAPE_FEED] });
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 60_000 });
    const { sleep } = createSchlaf();

    const { fetchImpl } = createNetz(spies, {
        feedAntwort: async () => new Response(rssOhneBilder(SCRAPE_FEED, 3), { status: 200 }),
        seitenAntwort: haengendeAntwort(uhr, { vorMs: 60_000 }),
    });

    await runMain(spies, { budget, sleep, fetchImpl, groqFetch: spies.makeGroqFetch(GROQ_LEER) });

    assert.deepEqual(spies.exitCodes, []);
    assert.equal(budget.signal.aborted, true);
    assert.ok(budget.elapsedMs() <= budget.deadlineMs + 1);
    assert.equal(spies.kvStore.feed_run_status.result, 'degraded');
    // Der Kern-Publish hat trotzdem stattgefunden.
    assert.ok(spies.kvSets.some(entry => entry.key === 'news_cache'));
});

test('auch ein abgebrochener letzter Scrape ergibt degraded, nicht success', async () => {
    // Der heikelste Fall: es bleibt nichts mehr übrig, das zurückgestellt
    // werden könnte. Ohne die Zurückstellung im Fehlerpfad meldete der Lauf
    // hier `success`, obwohl die Deadline eine Anfrage abgeschnitten hat.
    const spies = createSpies({ feeds: [SCRAPE_FEED] });
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 60_000, optionalPhaseMinRemainingMs: 0 });
    const { sleep } = createSchlaf();

    const { fetchImpl } = createNetz(spies, {
        feedAntwort: async () => new Response(rssOhneBilder(SCRAPE_FEED, 1), { status: 200 }),
        seitenAntwort: haengendeAntwort(uhr, { vorMs: 60_000 }),
    });

    await runMain(spies, { budget, sleep, fetchImpl, groqFetch: spies.makeGroqFetch(GROQ_LEER) });

    assert.deepEqual(spies.exitCodes, []);
    assert.equal(spies.kvStore.feed_run_status.result, 'degraded');
    assert.match(spies.kvStore.feed_run_status.degradedReason, /Zeitbudget/);
});

// === Scrape-Budget ===

test('die Zahl der Artikel-Seitenabrufe ueberschreitet das Limit nie', async () => {
    const spies = createSpies({ feeds: [SCRAPE_FEED] });
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 60 * 60 * 1000, scrapeLimit: 5 });
    const { sleep } = createSchlaf();

    const { fetchImpl, zaehler } = createNetz(spies, {
        feedAntwort: async () => new Response(rssOhneBilder(SCRAPE_FEED, 40), { status: 200 }),
    });

    await runMain(spies, { budget, sleep, fetchImpl, groqFetch: spies.makeGroqFetch(GROQ_LEER) });

    assert.equal(zaehler.seitenabrufe, 5, 'genau das Budget, kein Abruf mehr');
    assert.equal(budget.pageFetchesUsed, 5);
    assert.equal(spies.kvStore.feed_run_status.result, 'degraded');
});

test('Backfill und Neu-Scrape teilen sich dasselbe Seitenbudget', async () => {
    const spies = createSpies({ feeds: [SCRAPE_FEED] });
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 60 * 60 * 1000, scrapeLimit: 2 });
    const { sleep } = createSchlaf();

    // Bestand mit reparaturbedürftigen Bildern; er käme sonst zusätzlich in den
    // Backfill und würde das Limit umgehen.
    spies.kvStore.news_cache = Array.from({ length: 10 }, (_, index) => ({
        id: `alt-${index}`,
        title: `Alter Artikel ${index}`,
        source: 'Scrapequelle',
        publicationDate: new Date().toISOString(),
        summary: 'Bestand',
        link: `https://scrape.example/alt-${index}`,
        imageUrl: 'https://placehold.co/600x400/374151/d1d5db?text=Scrapequelle',
        language: 'de',
    }));

    const { fetchImpl, zaehler } = createNetz(spies, {
        feedAntwort: async () => new Response(rssOhneBilder(SCRAPE_FEED, 6), { status: 200 }),
    });

    await runMain(spies, { budget, sleep, fetchImpl, groqFetch: spies.makeGroqFetch(GROQ_LEER) });

    assert.equal(zaehler.seitenabrufe, 2, 'das Limit gilt für beide Phasen zusammen');
});

// === Ergebniszustaende ===

test('genug Zeit und nicht ausgeschoepftes Budget ergeben weiterhin success', async () => {
    const spies = createSpies();
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 60 * 60 * 1000, scrapeLimit: 50 });
    const { sleep } = createSchlaf();

    await runMain(spies, {
        budget,
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.deepEqual(spies.exitCodes, []);
    assert.equal(spies.kvStore.feed_run_status.result, 'success');
    assert.equal(spies.kvStore.feed_run_status.degradedReason, null);
    assert.equal(budget.isDegraded(), false);
});

test('ein erschoepftes Scrape-Budget ergibt deterministisch degraded', async () => {
    for (const durchlauf of [1, 2, 3]) {
        const spies = createSpies({ feeds: [SCRAPE_FEED] });
        const uhr = createControlledClock();
        const { budget } = createTestBudget(uhr, { deadlineMs: 60 * 60 * 1000, scrapeLimit: 1 });
        const { sleep } = createSchlaf();

        const { fetchImpl } = createNetz(spies, {
            feedAntwort: async () => new Response(rssOhneBilder(SCRAPE_FEED, 4), { status: 200 }),
        });

        await runMain(spies, { budget, sleep, fetchImpl, groqFetch: spies.makeGroqFetch(GROQ_LEER) });

        assert.equal(
            spies.kvStore.feed_run_status.result,
            'degraded',
            `Durchlauf ${durchlauf}: niemals stillschweigend success`,
        );
        assert.match(spies.kvStore.feed_run_status.degradedReason, /Scrape-Budget/);
    }
});

test('ein erschoepftes Zeitbudget ergibt degraded, nicht success', async () => {
    const spies = createSpies({ feeds: [FEED_ROW, SCRAPE_FEED] });
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 10_000 });
    const { sleep } = createSchlaf();

    let feedabrufe = 0;
    await runMain(spies, {
        budget,
        sleep,
        fetchImpl: spies.makeFetchImpl(async () => {
            feedabrufe += 1;
            // Der erste Abruf verbraucht das gesamte Zeitbudget.
            if (feedabrufe === 1) uhr.vor(10_000);
            return new Response(rssOhneBilder(FEED_ROW, 1), { status: 200 });
        }),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.equal(feedabrufe, 1, 'die zweite Quelle wird gar nicht mehr abgerufen');
    assert.equal(spies.kvStore.feed_run_status.result, 'degraded');
    assert.match(spies.kvStore.feed_run_status.degradedReason, /Zeitbudget/);
    assert.equal(spies.kvStore.feed_health_status.scrapequelle.status, 'warning');
});

test('eine zurueckgestellte Trendphase macht den Lauf degraded', async () => {
    const spies = createSpies();
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, {
        deadlineMs: 60_000,
        optionalPhaseMinRemainingMs: 30_000,
    });
    const { sleep } = createSchlaf();

    await runMain(spies, {
        budget,
        sleep,
        fetchImpl: spies.makeFetchImpl(async () => {
            // Der Kernlauf verbraucht so viel, dass die Reserve unterschritten
            // ist - aber die Deadline selbst noch nicht erreicht.
            uhr.vor(40_000);
            return new Response(rssOhneBilder(FEED_ROW, 1), { status: 200 });
        }),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.equal(spies.groqCalls.length, 0, 'Groq wird nicht mehr kontaktiert');
    assert.equal(spies.kvStore.feed_run_status.result, 'degraded');
    assert.ok(spies.kvSets.some(entry => entry.key === 'news_cache'), 'der Kern-Publish bleibt');
});

test('ein nicht mehr sicher abschliessbarer Kernlauf ergibt fatal', async () => {
    const spies = createSpies();
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 60 * 60 * 1000 });
    const { sleep } = createSchlaf();

    // Der News-Cache lässt sich nicht schreiben: ohne ihn gibt es keinen
    // vertrauenswürdigen Kernabschluss.
    const echterSet = spies.store.set;
    spies.store.set = async (key, value) => {
        if (key === 'news_cache') throw new Error('KV write abgelehnt');
        return echterSet(key, value);
    };

    await runMain(spies, {
        budget,
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.deepEqual(spies.exitCodes, [1]);
    assert.equal(spies.kvStore.feed_run_status.result, 'fatal');
    assert.ok(spies.recorderCalls.includes('recordFatal'));
});

test('ein fataler Lauf ueberschreibt einen neueren Kern-Publish nicht', async () => {
    // Bewusst der echte Recorder: nur er entscheidet, was ein Abbruch anfassen
    // darf.
    const spies = createSpies();
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 60 * 60 * 1000 });
    const { sleep } = createSchlaf();

    spies.kvStore.feed_publish_status = {
        schemaVersion: 1,
        runId: 'frueherer-lauf',
        lastCorePublishAt: '2026-07-28T11:00:00.000Z',
        lastContentUpdateAt: '2026-07-28T11:00:00.000Z',
        newestArticleAt: '2026-07-28T10:00:00.000Z',
        articleCount: 42,
        feeds: { total: 1, success: 1, warning: 0, error: 0, unknown: 0 },
        durations: {},
    };
    spies.kvStore.feed_health_status = {
        gamestar: {
            status: 'success',
            message: 'älterer Erfolg',
            lastAttemptAt: '2026-07-28T11:00:00.000Z',
            lastSuccessAt: '2026-07-28T11:00:00.000Z',
            durationMs: 10,
            articleCount: 5,
        },
    };

    await runMain(spies, {
        budget,
        sleep,
        createRecorder: createFeedRunRecorder,
        fetchImpl: spies.makeFetchImpl(async () => {
            throw new Error('Quelle nicht erreichbar');
        }),
        // Der Kernlauf scheitert erst beim Schreiben des Feed-Status.
        store: {
            ...spies.store,
            get: spies.store.get,
            set: async (key, value) => {
                if (key === 'feed_health_status') throw new Error('KV write abgelehnt');
                return spies.store.set(key, value);
            },
        },
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.deepEqual(spies.exitCodes, [1]);
    assert.equal(
        spies.kvStore.feed_publish_status.lastCorePublishAt,
        '2026-07-28T11:00:00.000Z',
        'der ältere, aber erfolgreiche Publish bleibt unangetastet',
    );
    assert.equal(spies.kvStore.feed_publish_status.runId, 'frueherer-lauf');
    assert.equal(
        spies.kvStore.feed_health_status.gamestar.lastSuccessAt,
        '2026-07-28T11:00:00.000Z',
        'auch der Feed-Erfolg bleibt stehen',
    );
});

// === Faire Verteilung und Reparierbarkeit ===

test('zurueckgestellte Bild-Scrapes verteilen sich ueber die Quellen', async () => {
    const quellen = [
        scrapeFeedRow('q1', 'Quelle Eins', 'eins.example'),
        scrapeFeedRow('q2', 'Quelle Zwei', 'zwei.example'),
        scrapeFeedRow('q3', 'Quelle Drei', 'drei.example'),
    ];
    const spies = createSpies({ feeds: quellen });
    const uhr = createControlledClock();
    // Genau ein Abruf je Quelle passt ins Budget.
    const { budget } = createTestBudget(uhr, { deadlineMs: 60 * 60 * 1000, scrapeLimit: 3 });
    const { sleep } = createSchlaf();

    const { fetchImpl, zaehler } = createNetz(spies, {
        feedAntwort: async url => {
            const quelle = quellen.find(feed => url.startsWith(new URL(feed.url).origin));
            return new Response(rssOhneBilder(quelle, 4, quelle.id), { status: 200 });
        },
    });

    await runMain(spies, { budget, sleep, fetchImpl, groqFetch: spies.makeGroqFetch(GROQ_LEER) });

    assert.equal(zaehler.seitenabrufe, 3);
    const bedienteQuellen = new Set(zaehler.seiten.map(url => new URL(url).hostname));
    assert.deepEqual(
        [...bedienteQuellen].sort(),
        ['drei.example', 'eins.example', 'zwei.example'],
        'jede Quelle bekommt einen Abruf, keine frisst das Budget auf',
    );
});

test('zurueckgestellte Bild-Scrapes bleiben fuer spaetere Laeufe reparierbar', async () => {
    const spies = createSpies({ feeds: [SCRAPE_FEED] });
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 60 * 60 * 1000, scrapeLimit: 1 });
    const { sleep } = createSchlaf();

    const { fetchImpl } = createNetz(spies, {
        feedAntwort: async () => new Response(rssOhneBilder(SCRAPE_FEED, 4), { status: 200 }),
    });

    await runMain(spies, { budget, sleep, fetchImpl, groqFetch: spies.makeGroqFetch(GROQ_LEER) });

    const gespeichert = spies.kvStore.news_cache;
    assert.equal(gespeichert.length, 4, 'kein Artikel geht verloren');

    const zurueckgestellt = gespeichert.filter(artikel => needsStoredImageRepair(artikel));
    assert.equal(zurueckgestellt.length, 3, 'die drei offenen Artikel tragen einen Platzhalter');
    assert.ok(
        zurueckgestellt.every(artikel => artikel.imageUrl?.includes('placehold.co')),
        'ein Platzhalter statt eines fehlenden Bildes',
    );
    assert.ok(
        gespeichert.every(artikel => !Object.hasOwn(artikel, 'needsScraping')),
        'das Zwischenfeld landet nicht im Cache',
    );
});

// === Bestand ===

test('alte Artikel einer ausgefallenen Quelle bleiben erhalten', async () => {
    const spies = createSpies({ feeds: [SCRAPE_FEED] });
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 60 * 60 * 1000 });
    const { sleep } = createSchlaf();

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
        budget,
        sleep,
        fetchImpl: spies.makeFetchImpl(async () => new Response('kaputt', { status: 500 })),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    const gespeichert = spies.kvStore.news_cache;
    assert.equal(gespeichert.length, 1, 'der Bestand überlebt einen Feed-Ausfall');
    assert.equal(gespeichert[0].link, 'https://scrape.example/alt-1');
    assert.equal(spies.kvStore.feed_health_status.scrapequelle.status, 'error');
});

test('alte Artikel einer zurueckgestellten Quelle bleiben ebenfalls erhalten', async () => {
    const spies = createSpies({ feeds: [FEED_ROW, SCRAPE_FEED] });
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 10_000 });
    const { sleep } = createSchlaf();

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
        budget,
        sleep,
        fetchImpl: spies.makeFetchImpl(async () => {
            uhr.vor(10_000);
            return new Response(rssOhneBilder(FEED_ROW, 1), { status: 200 });
        }),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.equal(spies.kvStore.feed_health_status.scrapequelle.status, 'warning');
    assert.ok(
        spies.kvStore.news_cache.some(artikel => artikel.link === 'https://scrape.example/alt-1'),
        'eine zurückgestellte Quelle verliert ihren Bestand nicht',
    );
});

// === Grenzfaelle mit kontrollierter Uhr ===

test('direkt vor der Deadline wird die naechste Quelle noch abgerufen', async () => {
    const spies = createSpies({ feeds: [FEED_ROW, SCRAPE_FEED] });
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 10_000 });
    const { sleep } = createSchlaf();

    let feedabrufe = 0;
    await runMain(spies, {
        budget,
        sleep,
        fetchImpl: spies.makeFetchImpl(async url => {
            if (!url.includes('feed.xml')) {
                return new Response(ARTIKELSEITE, { status: 200, headers: { 'content-type': 'text/html' } });
            }
            feedabrufe += 1;
            if (feedabrufe === 1) uhr.vor(9_999);
            return new Response(rssOhneBilder(FEED_ROW, 1), { status: 200 });
        }),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.equal(feedabrufe, 2, 'eine Millisekunde Restzeit genügt für den Versuch');
});

test('genau auf der Deadline wird die naechste Quelle zurueckgestellt', async () => {
    const spies = createSpies({ feeds: [FEED_ROW, SCRAPE_FEED] });
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 10_000 });
    const { sleep } = createSchlaf();

    let feedabrufe = 0;
    await runMain(spies, {
        budget,
        sleep,
        fetchImpl: spies.makeFetchImpl(async () => {
            feedabrufe += 1;
            if (feedabrufe === 1) uhr.vor(10_000);
            return new Response(rssOhneBilder(FEED_ROW, 1), { status: 200 });
        }),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.equal(feedabrufe, 1, 'genau auf der Deadline ist Schluss');
    assert.equal(spies.kvStore.feed_run_status.result, 'degraded');
});

test('das letzte Budget-Kontingent wird noch verbraucht, das naechste nicht mehr', async () => {
    const spies = createSpies({ feeds: [SCRAPE_FEED] });
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 60 * 60 * 1000, scrapeLimit: 3 });
    const { sleep } = createSchlaf();

    const { fetchImpl, zaehler } = createNetz(spies, {
        feedAntwort: async () => new Response(rssOhneBilder(SCRAPE_FEED, 3), { status: 200 }),
    });

    await runMain(spies, { budget, sleep, fetchImpl, groqFetch: spies.makeGroqFetch(GROQ_LEER) });

    assert.equal(zaehler.seitenabrufe, 3, 'ein exakt ausgeschöpftes Budget lässt alles zu');
    assert.equal(spies.kvStore.feed_run_status.result, 'success', 'ausgeschöpft ist nicht überschritten');
});

// === Nebenlaeufigkeit ===

test('externe Abrufe laufen streng nacheinander', async () => {
    // Die Roadmap verbietet ungezügelte Parallelisierung. Dieser Test hält
    // fest, dass es genau einen offenen Request gibt - und fällt auf, sobald
    // jemand das unbemerkt ändert.
    const spies = createSpies({ feeds: [SCRAPE_FEED] });
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 60 * 60 * 1000 });
    const { sleep } = createSchlaf();

    const { fetchImpl, zaehler } = createNetz(spies, {
        feedAntwort: async () => new Response(rssOhneBilder(SCRAPE_FEED, 5), { status: 200 }),
    });

    await runMain(spies, { budget, sleep, fetchImpl, groqFetch: spies.makeGroqFetch(GROQ_LEER) });

    assert.equal(zaehler.gleichzeitigMax, 1, 'nie mehr als ein offener Request');
});

// === Secrets im Budgetpfad ===

test('ein Budget-Abbruch gibt keine Secrets in Log oder Heartbeat', async () => {
    // Der echte Recorder, damit der Produktionspfad geprüft wird und nicht die
    // Attrappe.
    const spies = createSpies({ feeds: [FEED_ROW] });
    const uhr = createControlledClock();
    const { budget } = createTestBudget(uhr, { deadlineMs: 30_000 });
    const { sleep } = createSchlaf();

    const original = { log: console.log, warn: console.warn, error: console.error };
    const globaleAusgaben = [];
    console.log = (...args) => globaleAusgaben.push(args.map(String).join(' '));
    console.warn = console.log;
    console.error = console.log;

    try {
        await runMain(spies, {
            budget,
            sleep,
            createRecorder: createFeedRunRecorder,
            fetchImpl: spies.makeFetchImpl(async (_url, init) => {
                uhr.vor(30_000);
                const signal = init?.signal;
                if (signal?.aborted) throw signal.reason;
                throw new Error('Abbruch bei https://proxy.example/x.php?key=proxy-geheim');
            }),
            groqFetch: spies.makeGroqFetch(GROQ_LEER),
        });
    } finally {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
    }

    assert.deepEqual(globaleAusgaben, [], 'der Lauf schreibt nicht an der Injektion vorbei');

    const gespeichert = JSON.stringify(spies.kvStore);
    const protokoll = spies.logLines.join('\n');
    for (const secret of ALLE_SECRETS) {
        assert.doesNotMatch(gespeichert, new RegExp(secret), `${secret} steht im Heartbeat`);
        assert.doesNotMatch(protokoll, new RegExp(secret), `${secret} steht im Log`);
    }

    assert.equal(spies.kvStore.feed_run_status.result, 'degraded');
    assert.match(spies.kvStore.feed_run_status.degradedReason, /Zeitbudget/);
    assert.doesNotMatch(spies.kvStore.feed_run_status.degradedReason, /https?:|@/);
});
