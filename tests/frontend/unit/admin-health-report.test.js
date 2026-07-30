import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createServer } from 'vite';
import {
    click,
    renderAdminPanel,
    silenceConsole,
} from '../helpers/admin-panel-harness.js';

const vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    logLevel: 'silent',
    server: {
        middlewareMode: true,
    },
});

const { buildAdminHealthReport, buildUnavailableHealthReport } = await vite.ssrLoadModule(
    '/services/admin-health-report.ts',
);
const {
    LOCAL_NEWS_CACHE_KEY,
    LOCAL_NEWS_CACHE_TTL_MS,
    readLocalNewsCache,
} = await vite.ssrLoadModule('/shared/local-news-cache.ts');

test.after(async () => {
    await vite.close();
});

const NOW = Date.parse('2026-07-30T12:00:00.000Z');
const ACTIVE_CREATED_AT = '2026-07-30T11:50:00.000Z';
// Bewusst innerhalb der 30-Minuten-Frist, aber aus einem älteren Lauf.
const LOCAL_CREATED_AT = '2026-07-30T11:45:00.000Z';

function snapshotPointer(createdAt, runId) {
    return {
        schemaVersion: 1,
        snapshotId: `${Date.parse(createdAt)}-${runId}`,
        createdAt,
        articleCount: 120,
        runId,
    };
}

const ACTIVE_SNAPSHOT = snapshotPointer(ACTIVE_CREATED_AT, 'lauf-b');
const LOCAL_SNAPSHOT = snapshotPointer(LOCAL_CREATED_AT, 'lauf-a');

function feed(id, name, language = 'de') {
    return {
        id,
        name,
        url: `https://${id}.example/feed.xml`,
        language,
        priority: 'secondary',
        needsScraping: false,
    };
}

// Fünf konfigurierte Feeds, drei Quellen im aktiven Snapshot, zwei in der
// älteren lokalen Browserkopie.
const FEEDS = Object.freeze([
    feed('feed-gamestar', 'GameStar'),
    feed('feed-vg247', 'VG247', 'en'),
    feed('feed-golem', 'Golem'),
    feed('feed-pcgames', 'PC Games'),
    feed('feed-eurogamer', 'Eurogamer', 'en'),
]);

const ACTIVE_SOURCES = Object.freeze(['GameStar', 'Golem.de', 'Eurogamer']);

const BACKEND_HEALTH = Object.freeze({
    'feed-gamestar': { status: 'success', message: 'ok' },
    'feed-vg247': { status: 'success', message: 'ok' },
    'feed-golem': { status: 'success', message: 'ok' },
    'feed-pcgames': { status: 'error', message: 'HTTP 500 von upstream-db' },
    'feed-eurogamer': { status: 'success', message: 'ok' },
});

function article(source, index) {
    return {
        id: `${source}-${index}`,
        title: `Artikel ${index}`,
        source,
        publicationDate: '2026-07-30T10:00:00.000Z',
        summary: 'Zusammenfassung',
        link: `https://beispiel.example/${source}/${index}`,
        imageUrl: `https://beispiel.example/${source}.jpg`,
        language: 'de',
    };
}

function localCacheEntry({
    sources = ['Eurogamer', 'Golem.de'],
    timestamp = Date.parse(LOCAL_CREATED_AT),
    snapshot = LOCAL_SNAPSHOT,
    omitSnapshot = false,
} = {}) {
    return JSON.stringify({
        articles: sources.map((source, index) => article(source, index)),
        timestamp,
        ...(omitSnapshot ? {} : { snapshot }),
    });
}

const usableLocalCache = (overrides) => readLocalNewsCache(localCacheEntry(overrides), NOW);

const rowOf = (report, feedId) => report.rows.find(row => row.feedId === feedId);

// --- Reine Ableitung ---------------------------------------------------------

test('liest die lokale Browserkopie mit demselben Decoder und derselben Frist wie das Frontend', () => {
    assert.equal(readLocalNewsCache(null, NOW).status, 'missing');
    assert.equal(readLocalNewsCache('{kein json', NOW).status, 'unreadable');
    assert.equal(readLocalNewsCache('{"articles":"nein","timestamp":1}', NOW).status, 'unreadable');
    assert.equal(
        readLocalNewsCache(JSON.stringify({ articles: [{ id: 'x' }], timestamp: NOW }), NOW).status,
        'unreadable',
        'ein unvollständiger Artikel macht die ganze Kopie unbrauchbar',
    );

    const gerade = readLocalNewsCache(
        localCacheEntry({ timestamp: NOW - LOCAL_NEWS_CACHE_TTL_MS + 1 }),
        NOW,
    );
    assert.equal(gerade.status, 'usable', 'knapp innerhalb der Frist bleibt verwendbar');

    const abgelaufen = readLocalNewsCache(
        localCacheEntry({ timestamp: NOW - LOCAL_NEWS_CACHE_TTL_MS }),
        NOW,
    );
    assert.equal(abgelaufen.status, 'expired', 'genau auf der Frist gilt nicht mehr als frisch');

    const usable = usableLocalCache();
    assert.equal(usable.status, 'usable');
    assert.deepEqual(usable.sources, ['Eurogamer', 'Golem.de']);
    assert.equal(usable.snapshot.snapshotId, LOCAL_SNAPSHOT.snapshotId);

    const legacy = readLocalNewsCache(localCacheEntry({ omitSnapshot: true }), NOW);
    assert.equal(legacy.status, 'usable');
    assert.equal(legacy.snapshot, null, 'ohne Angabe bleibt die Generation unbekannt');
});

test('zählt die drei Kennzahlen getrennt und vergleicht nur belegbare Generationen', () => {
    const report = buildAdminHealthReport({
        feeds: FEEDS,
        backendHealth: BACKEND_HEALTH,
        sourcesInCache: [...ACTIVE_SOURCES],
        activeSnapshot: ACTIVE_SNAPSHOT,
        localCache: usableLocalCache(),
    });

    assert.equal(report.configuredFeedCount, 5);
    assert.equal(report.activeSnapshotSourceCount, 3);
    assert.equal(report.localCacheSourceCount, 2);
    assert.equal(report.activeSnapshotId, ACTIVE_SNAPSHOT.snapshotId);
    assert.equal(report.localSnapshotId, LOCAL_SNAPSHOT.snapshotId);
    assert.equal(report.snapshotComparison, 'different');
    assert.equal(report.localCacheStatus, 'usable');
    assert.equal(report.rows.length, 5, 'jeder konfigurierte Feed bleibt eine eigene Zeile');
});

test('gleiche Generationen gelten als gleich, fehlende niemals', () => {
    const gleich = buildAdminHealthReport({
        feeds: FEEDS,
        backendHealth: BACKEND_HEALTH,
        sourcesInCache: [...ACTIVE_SOURCES],
        activeSnapshot: ACTIVE_SNAPSHOT,
        localCache: usableLocalCache({ snapshot: ACTIVE_SNAPSHOT }),
    });
    assert.equal(gleich.snapshotComparison, 'same');

    const legacyLokal = buildAdminHealthReport({
        feeds: FEEDS,
        backendHealth: BACKEND_HEALTH,
        sourcesInCache: [...ACTIVE_SOURCES],
        activeSnapshot: ACTIVE_SNAPSHOT,
        localCache: usableLocalCache({ omitSnapshot: true }),
    });
    assert.equal(
        legacyLokal.snapshotComparison,
        'unknown',
        'eine fehlende lokale Kennung heißt unbekannt, nicht gleich',
    );

    const legacyAktiv = buildAdminHealthReport({
        feeds: FEEDS,
        backendHealth: BACKEND_HEALTH,
        sourcesInCache: [...ACTIVE_SOURCES],
        activeSnapshot: null,
        localCache: usableLocalCache(),
    });
    assert.equal(legacyAktiv.snapshotComparison, 'unknown');
    assert.equal(legacyAktiv.activeSnapshotId, null);
});

test('kaputte, abgelaufene und fehlende lokale Kopien erfinden keine Zuordnung', () => {
    for (const localCache of [
        readLocalNewsCache(null, NOW),
        readLocalNewsCache('{kaputt', NOW),
        readLocalNewsCache(localCacheEntry({ timestamp: NOW - LOCAL_NEWS_CACHE_TTL_MS }), NOW),
    ]) {
        const report = buildAdminHealthReport({
            feeds: FEEDS,
            backendHealth: BACKEND_HEALTH,
            sourcesInCache: [...ACTIVE_SOURCES],
            activeSnapshot: ACTIVE_SNAPSHOT,
            localCache,
        });

        assert.equal(report.localCacheSourceCount, null);
        assert.equal(report.localSnapshotId, null);
        assert.equal(report.snapshotComparison, 'unknown');
        assert.equal(
            report.rows.every(row => row.inLocalCache === null),
            true,
            'ohne verwendbare Kopie gibt es keine lokale Aussage je Feed',
        );
        // Die aktive Aussage bleibt davon unberührt.
        assert.equal(rowOf(report, 'feed-vg247').status, 'warning');
        assert.equal(rowOf(report, 'feed-gamestar').status, 'ok');
    }
});

test('VG247 fehlt aktiv, GameStar fehlt nur lokal, Golem wird nicht unscharf gesund gemeldet', () => {
    const report = buildAdminHealthReport({
        feeds: FEEDS,
        backendHealth: BACKEND_HEALTH,
        sourcesInCache: [...ACTIVE_SOURCES],
        activeSnapshot: ACTIVE_SNAPSHOT,
        localCache: usableLocalCache(),
    });

    const vg247 = rowOf(report, 'feed-vg247');
    assert.equal(vg247.status, 'warning', 'erfolgreicher Abruf ohne Artikel im aktiven Snapshot');
    assert.equal(vg247.detailKey, 'admin.health.detailNotInActiveSnapshot');
    assert.equal(vg247.inActiveSnapshot, false);

    const gamestar = rowOf(report, 'feed-gamestar');
    assert.equal(gamestar.status, 'ok', 'eine ältere lokale Kopie ist kein Feed-Ausfall');
    assert.equal(gamestar.inActiveSnapshot, true);
    assert.equal(gamestar.inLocalCache, false);
    assert.equal(gamestar.detailKey, 'admin.health.detailOkNotInLocalCopy');

    const golem = rowOf(report, 'feed-golem');
    assert.equal(golem.status, 'warning', '"Golem" ist nicht "Golem.de"');
    assert.equal(golem.inActiveSnapshot, false);

    const eurogamer = rowOf(report, 'feed-eurogamer');
    assert.equal(eurogamer.status, 'ok');
    assert.equal(eurogamer.detailKey, 'admin.health.detailOk');

    const pcgames = rowOf(report, 'feed-pcgames');
    assert.equal(pcgames.status, 'error');
    assert.equal(pcgames.detailKey, 'admin.health.detailBackendError');

    assert.deepEqual(
        report.unmatchedSnapshotSources,
        ['Golem.de'],
        'der unzuordenbare Snapshot-Name verschwindet nicht stillschweigend',
    );
});

test('ohne gelesenen Snapshot bleibt die Präsenz unbekannt statt geraten', () => {
    const report = buildAdminHealthReport({
        feeds: FEEDS,
        backendHealth: BACKEND_HEALTH,
        sourcesInCache: null,
        activeSnapshot: null,
        localCache: usableLocalCache(),
    });

    assert.equal(report.activeSnapshotSourceCount, null);
    assert.deepEqual(report.unmatchedSnapshotSources, []);
    assert.equal(rowOf(report, 'feed-gamestar').status, 'unknown');
    assert.equal(rowOf(report, 'feed-gamestar').detailKey, 'admin.health.detailSnapshotUnknown');
    assert.equal(rowOf(report, 'feed-gamestar').inActiveSnapshot, null);
    // Ein echter Backend-Fehler bleibt trotzdem ein Fehler.
    assert.equal(rowOf(report, 'feed-pcgames').status, 'error');
});

test('ein nicht gelesener Bericht macht jede Zeile unbekannt statt still gesund', () => {
    const report = buildAdminHealthReport({
        feeds: FEEDS,
        backendHealth: null,
        sourcesInCache: null,
        activeSnapshot: null,
        localCache: readLocalNewsCache(null, NOW),
    });

    assert.equal(report.rows.every(row => row.status === 'unknown'), true);
    assert.equal(report.rows.length, 5);

    const unavailable = buildUnavailableHealthReport(FEEDS, readLocalNewsCache(null, NOW));
    assert.equal(unavailable.rows.every(row => row.status === 'error'), true);
    assert.equal(unavailable.rows.every(row => row.detailKey === 'admin.health.detailFetchError'), true);
    assert.equal(unavailable.activeSnapshotSourceCount, null);
});

// --- Darstellung im Admin ----------------------------------------------------

async function renderHealthTab() {
    const testRoot = await renderAdminPanel(vite, {
        feeds: FEEDS,
        healthResponse: {
            healthStatus: BACKEND_HEALTH,
            sourcesInCache: [...ACTIVE_SOURCES],
            heartbeat: null,
            snapshot: ACTIVE_SNAPSHOT,
        },
        // Die gerenderte Komponente liest die echte Uhr; der Eintrag muss
        // deshalb relativ dazu innerhalb der 30-Minuten-Frist liegen.
        localStorageEntries: {
            [LOCAL_NEWS_CACHE_KEY]: localCacheEntry({ timestamp: Date.now() - 5 * 60 * 1000 }),
        },
    });

    await act(async () => {
        click(testRoot.window, testRoot.container.querySelector('#admin-tab-health'));
    });

    return testRoot;
}

test('das Health Center zeigt die drei Kennzahlen mit ihrer Bedeutung', async () => {
    const restoreConsole = silenceConsole();
    const testRoot = await renderHealthTab();

    try {
        const panel = testRoot.container.querySelector('#admin-panel-health');

        assert.equal(panel.querySelector('#admin-metric-configured').textContent, '5');
        assert.equal(panel.querySelector('#admin-metric-snapshot').textContent, '3');
        assert.equal(panel.querySelector('#admin-metric-local').textContent, '2');

        assert.match(panel.textContent, /Konfigurierte Feeds/);
        assert.match(panel.textContent, /Quellen im aktiven News-Snapshot/);
        assert.match(panel.textContent, /Quellen in der lokalen Browserkopie/);
        // Herkunft und Schwankung müssen erklärt sein.
        assert.match(panel.textContent, /Datenbank/);
        assert.match(panel.textContent, /schwankt/);
        assert.match(panel.textContent, /30 Minuten/);

        // Beide Generationen werden benannt.
        assert.match(panel.textContent, new RegExp(ACTIVE_SNAPSHOT.snapshotId));
        assert.match(panel.textContent, new RegExp(LOCAL_SNAPSHOT.snapshotId));
        assert.match(panel.textContent, /anderen Snapshot/);
        assert.match(panel.textContent, /kein Feed-Ausfall/);
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('jede konfigurierte Quelle bleibt sichtbar und wird korrekt eingeordnet', async () => {
    const restoreConsole = silenceConsole();
    const testRoot = await renderHealthTab();

    try {
        const panel = testRoot.container.querySelector('#admin-panel-health');
        const rows = Array.from(panel.querySelectorAll('tbody tr'));
        assert.equal(rows.length, 5, 'keine Zeile verschwindet');

        const rowFor = name => rows.find(row => row.textContent.startsWith(name));

        assert.match(rowFor('VG247').textContent, /Warnung/);
        assert.match(rowFor('VG247').textContent, /keine Artikel im aktiven News-Snapshot/);

        assert.match(rowFor('GameStar').textContent, /OK/);
        assert.doesNotMatch(rowFor('GameStar').textContent, /Fehler/);
        assert.match(rowFor('GameStar').textContent, /lokalen Kopie dieses Browsers/);

        assert.match(rowFor('Golem').textContent, /Warnung/, 'ähnliche Namen werden nicht gesund gemeldet');
        assert.match(rowFor('Eurogamer').textContent, /OK/);
        assert.match(rowFor('PC Games').textContent, /Fehler/);

        // Nicht zugeordnete Snapshot-Quellennamen werden vollständig genannt.
        const unmatched = panel.querySelector('#admin-unmatched-snapshot-sources');
        assert.ok(unmatched !== null, 'die Liste nicht zugeordneter Namen existiert');
        assert.deepEqual(
            Array.from(unmatched.querySelectorAll('li')).map(item => item.textContent),
            ['Golem.de'],
        );
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('die Aktualisierung nennt sich erneutes Laden des gespeicherten Berichts', async () => {
    const restoreConsole = silenceConsole();
    const testRoot = await renderHealthTab();

    try {
        const panel = testRoot.container.querySelector('#admin-panel-health');
        const reloadButton = Array.from(panel.querySelectorAll('button'))
            .find(button => button.textContent.includes('Gespeicherten Statusbericht neu laden'));

        assert.ok(reloadButton !== null, 'der zentrale Button ist eindeutig beschriftet');
        assert.match(panel.textContent, /kein RSS-Abruf/);
        assert.match(panel.textContent, /kein.*GitHub-Action-Lauf/);

        const before = testRoot.requests.filter(request => request.url.startsWith('/api/get-health-data')).length;
        await act(async () => {
            click(testRoot.window, reloadButton);
        });
        await act(async () => {
            await new Promise(resolve => setImmediate(resolve));
        });
        const after = testRoot.requests.filter(request => request.url.startsWith('/api/get-health-data')).length;
        assert.equal(after, before + 1, 'es wird nur der gespeicherte Bericht erneut geladen');
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('die Feed-Verwaltung behauptet keinen manuellen Einzelabruf mehr', async () => {
    const restoreConsole = silenceConsole();
    const testRoot = await renderHealthTab();

    try {
        // Die früheren Aktualisieren-Symbole je Zeile führten denselben
        // globalen Abruf aus und suggerierten eine Einzelprüfung.
        assert.equal(
            testRoot.container.querySelectorAll('button[aria-label*="Status für"]').length,
            0,
        );
        assert.doesNotMatch(testRoot.container.textContent, /Feed wird live geprüft/);
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('ein fehlgeschlagener Berichtsabruf zeigt keinen internen Fehlertext', async () => {
    const restoreConsole = silenceConsole();
    const testRoot = await renderAdminPanel(vite, {
        feeds: FEEDS,
        healthResponse: { error: 'Interner KV-Fehler bei kv://gamerfeed', code: 'internal_error' },
        healthStatusCode: 500,
        localStorageEntries: {},
    });

    try {
        await act(async () => {
            click(testRoot.window, testRoot.container.querySelector('#admin-tab-health'));
        });

        const panel = testRoot.container.querySelector('#admin-panel-health');
        assert.equal(panel.querySelectorAll('tbody tr').length, 5, 'alle Zeilen bleiben sichtbar');
        assert.doesNotMatch(panel.textContent, /Interner KV-Fehler/);
        assert.doesNotMatch(panel.textContent, /kv:\/\//);
        assert.equal(panel.querySelector('#admin-metric-configured').textContent, '5');
        assert.match(panel.textContent, /Konfigurierte Feeds/);
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});
