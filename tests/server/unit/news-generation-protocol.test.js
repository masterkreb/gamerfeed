import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsCacheHandler } from '../../../server/news-cache-handler.ts';
import {
    NEWS_SNAPSHOT_POINTER_KEY,
    SNAPSHOT_CREATED_AT_HEADER,
    SNAPSHOT_ID_HEADER,
    SNAPSHOT_ROLLBACK_HEADER,
    SNAPSHOT_SCHEMA_HEADER,
    buildSnapshotPointer,
    decideSnapshotAcceptance,
    planPendingAdoption,
    readSnapshotHeaders,
    readSnapshotRollback,
    withSnapshotQuery,
} from '../../../shared/news-snapshot.js';

// Contract-Tests des generationsgebundenen Leseprotokolls an den drei
// News-Endpunkten (Roadmap O3a). Kein Netz, kein KV, keine Uhr.
//
// **Wichtig:** Diese Tests reichen den Endpunkten ausdruecklich eine
// Snapshot-Quelle herein (`readSnapshot`). In Produktion gibt es die bis O3b
// nicht - die veraenderlichen News-Keys koennen die Zugehoerigkeit einer
// Kennung nicht belegen. Geprueft wird hier also die **Bereitschaft** des
// Leseprotokolls, nicht das heutige Produktionsverhalten. Letzteres steht in
// news-generation-binding.test.js und news-cache-handler.test.js.

function createArticle(id, source = 'GameZone') {
    return {
        id,
        title: `Artikel ${id}`,
        source,
        publicationDate: '2026-07-29T12:00:00.000Z',
        summary: `Zusammenfassung ${id}`,
        link: `https://example.com/${id}`,
        imageUrl: `https://example.com/${id}.jpg`,
        language: 'de',
    };
}

/**
 * Zeiger, dessen Kennung zum Zeitstempel passt.
 *
 * `normalizeSnapshotPointer` verlangt genau das - der Zeitanteil der Kennung
 * ist die Sortiergrundlage des Vergleichs.
 */
function pointerFor(millis, lauf, articleCount = 3) {
    const createdAt = new Date(millis).toISOString();
    return buildSnapshotPointer({
        snapshotId: `${millis}-${lauf}`,
        createdAt,
        articleCount,
        runId: lauf,
    });
}

function createCache(values = {}, { pointerError = null } = {}) {
    const calls = [];
    return {
        calls,
        client: {
            async get(key) {
                calls.push(key);
                if (key === NEWS_SNAPSHOT_POINTER_KEY && pointerError !== null) {
                    throw pointerError;
                }
                return Object.hasOwn(values, key) ? values[key] : null;
            },
        },
    };
}

const ENDPOINTS = Object.freeze({
    preview: { cacheKey: 'news_cache_16', endpointPath: '/api/get-news-preview', fallback: { cacheKey: 'news_cache', limit: 16 } },
    medium: { cacheKey: 'news_cache_64', endpointPath: '/api/get-news-medium', fallback: { cacheKey: 'news_cache', limit: 64 } },
    full: { cacheKey: 'news_cache', endpointPath: '/api/get-news' },
});

/**
 * Ruft einen Endpunkt mit injizierter Snapshot-Quelle auf.
 *
 * Die Quelle liest denselben Attrappen-Cache; in Produktion uebernimmt diese
 * Rolle erst O3b mit unveraenderlichen Generationen.
 */
function callEndpoint(cache, name, { snapshot = null, logger } = {}) {
    const endpoint = ENDPOINTS[name];
    const handler = createNewsCacheHandler(cache.client, endpoint, logger, {
        readSnapshot: () => cache.client.get(NEWS_SNAPSHOT_POINTER_KEY),
    });
    const url = withSnapshotQuery(`https://gamerfeed.example${endpoint.endpointPath}`, snapshot);
    return handler(new Request(url));
}

// === Jeder Consumer trägt seine Generation ===

test('alle drei News-Endpunkte melden dieselbe aktive Generation', async () => {
    const zeiger = pointerFor(2000, 'gha-2');
    const artikel = [createArticle('a1'), createArticle('a2')];
    const cache = createCache({
        [NEWS_SNAPSHOT_POINTER_KEY]: zeiger,
        news_cache: artikel,
        news_cache_16: artikel.slice(0, 1),
        news_cache_64: artikel,
    });

    for (const name of ['preview', 'medium', 'full']) {
        const response = await callEndpoint(cache, name);

        assert.equal(response.status, 200, name);
        assert.equal(response.headers.get(SNAPSHOT_ID_HEADER), '2000-gha-2', name);
        assert.equal(response.headers.get(SNAPSHOT_SCHEMA_HEADER), '1', name);
        assert.equal(
            response.headers.get(SNAPSHOT_CREATED_AT_HEADER),
            new Date(2000).toISOString(),
            name,
        );
        assert.ok(Array.isArray(await response.json()), `${name}: der Rumpf bleibt ein Array`);
    }
});

test('die Snapshot-Quelle sieht die tatsaechlich gelesenen Artikel', async () => {
    // Die Quelle bekommt die Artikel gereicht. Nur so kann eine spaetere
    // Implementierung (O3b) belegen, dass Kennung und Inhalt zusammengehoeren -
    // eine blosse Lesereihenfolge kann das nicht.
    const artikel = [createArticle('a1')];
    const cache = createCache({
        [NEWS_SNAPSHOT_POINTER_KEY]: pointerFor(1000, 'gha-1'),
        news_cache: artikel,
    });

    let gesehen = null;
    const handler = createNewsCacheHandler(cache.client, ENDPOINTS.full, undefined, {
        readSnapshot: gelesen => {
            gesehen = gelesen;
            return cache.client.get(NEWS_SNAPSHOT_POINTER_KEY);
        },
    });
    await handler(new Request('https://gamerfeed.example/api/get-news'));

    assert.deepEqual(gesehen, artikel);
    assert.deepEqual(cache.calls, ['news_cache', NEWS_SNAPSHOT_POINTER_KEY]);
});

test('auch der Fallback auf den Full-Cache behaelt die Generation', async () => {
    const cache = createCache({
        [NEWS_SNAPSHOT_POINTER_KEY]: pointerFor(1000, 'gha-1'),
        news_cache_16: null,
        news_cache: [createArticle('a1'), createArticle('a2')],
    });

    const response = await callEndpoint(cache, 'preview');

    assert.equal(response.headers.get(SNAPSHOT_ID_HEADER), '1000-gha-1');
    assert.deepEqual(cache.calls, ['news_cache_16', 'news_cache', NEWS_SNAPSHOT_POINTER_KEY]);
});

// === Generationsspezifische Cache-Keys ===

test('eine passende gepinnte Anfrage behaelt die uebliche Cache-Dauer', async () => {
    // Bewusst **kein** verlaengerter Edge-Cache: der Inhalt unter einer Kennung
    // ist nicht unveraenderlich, solange die News-Keys ueberschrieben werden.
    // Eine laengere Frist wuerde eine Zusage geben, die niemand einhaelt.
    const zeiger = pointerFor(1000, 'gha-1');
    const cache = createCache({
        [NEWS_SNAPSHOT_POINTER_KEY]: zeiger,
        news_cache: [createArticle('a1')],
    });

    const response = await callEndpoint(cache, 'full', { snapshot: zeiger });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 's-maxage=60, stale-while-revalidate=300');
});

test('eine abweichende gepinnte Anfrage wird nicht am Edge konserviert', async () => {
    // Sonst läge die Antwort einer anderen Generation dauerhaft unter der
    // angefragten Kennung - die Verwechslung wäre damit festgeschrieben.
    const cache = createCache({
        [NEWS_SNAPSHOT_POINTER_KEY]: pointerFor(2000, 'gha-2'),
        news_cache: [createArticle('a1')],
    });

    const response = await callEndpoint(cache, 'full', { snapshot: { snapshotId: '1000-gha-1' } });

    assert.equal(response.status, 200, 'geliefert wird trotzdem');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(
        response.headers.get(SNAPSHOT_ID_HEADER),
        '2000-gha-2',
        'die Header nennen die tatsächlich vorliegende Generation',
    );
});

test('eine ungepinnte Anfrage behaelt den bisherigen kurzlebigen Cache', async () => {
    const cache = createCache({
        [NEWS_SNAPSHOT_POINTER_KEY]: pointerFor(1000, 'gha-1'),
        news_cache: [createArticle('a1')],
    });

    const response = await callEndpoint(cache, 'full');

    assert.equal(response.headers.get('cache-control'), 's-maxage=60, stale-while-revalidate=300');
});

test('ein leerer Snapshot-Parameter zaehlt als ungepinnt', async () => {
    const cache = createCache({
        [NEWS_SNAPSHOT_POINTER_KEY]: pointerFor(1000, 'gha-1'),
        news_cache: [createArticle('a1')],
    });
    const handler = createNewsCacheHandler(cache.client, ENDPOINTS.full);

    const response = await handler(new Request('https://gamerfeed.example/api/get-news?snapshot='));

    assert.equal(response.headers.get('cache-control'), 's-maxage=60, stale-while-revalidate=300');
});

// === Fehlender, kaputter und unlesbarer Zeiger ===

test('ein fehlender Zeiger faellt kontrolliert auf Legacy zurueck', async () => {
    const cache = createCache({ news_cache: [createArticle('a1')] });

    const response = await callEndpoint(cache, 'full');

    assert.equal(response.status, 200, 'die News kommen trotzdem');
    assert.equal(response.headers.get(SNAPSHOT_ID_HEADER), null);
    assert.equal(response.headers.get('cache-control'), 's-maxage=60, stale-while-revalidate=300');
});

test('ein fehlerhafter Zeiger faellt ebenfalls auf Legacy zurueck', async () => {
    for (const kaputt of [
        'kein objekt',
        [],
        {},
        { schemaVersion: 1 },
        { schemaVersion: 99, snapshotId: '1000-gha-1' },
    ]) {
        const cache = createCache({
            [NEWS_SNAPSHOT_POINTER_KEY]: kaputt,
            news_cache: [createArticle('a1')],
        });

        const response = await callEndpoint(cache, 'full');

        assert.equal(response.status, 200, JSON.stringify(kaputt));
        assert.equal(response.headers.get(SNAPSHOT_ID_HEADER), null, JSON.stringify(kaputt));
    }
});

test('eine unlesbare Snapshot-Quelle verhindert die News nicht', async () => {
    // Die Quelle kann ausfallen, ohne dass die Artikel betroffen sind. Dann
    // gilt Legacy - die News zu verweigern waere die schlechtere Antwort.
    const logCalls = [];
    const cache = createCache({ news_cache: [createArticle('a1')] });

    const handler = createNewsCacheHandler(
        cache.client,
        ENDPOINTS.full,
        { error: (...args) => logCalls.push(args) },
        { readSnapshot: () => { throw new Error('KV nicht erreichbar'); } },
    );
    const response = await handler(new Request('https://gamerfeed.example/api/get-news'));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get(SNAPSHOT_ID_HEADER), null);
    assert.equal(logCalls.length, 1, 'der Ausfall wird protokolliert');
    assert.match(String(logCalls[0][0]), /Snapshot unavailable/);
});

test('eine gepinnte Anfrage ohne lesbaren Zeiger wird nicht am Edge konserviert', async () => {
    const cache = createCache({ news_cache: [createArticle('a1')] });

    const response = await callEndpoint(cache, 'full', { snapshot: { snapshotId: '1000-gha-1' } });

    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get(SNAPSHOT_ID_HEADER), null);
});

// === Der Ladeketten-Ablauf über alle Consumer ===

/**
 * Spielt die progressive Ladekette gegen die echten Endpunkt-Handler durch.
 *
 * `stages` beschreibt je Stufe, welchen Cache-Stand der Edge zurückgibt.
 */
async function runLoadingChain(stages) {
    let pinned = null;
    let sichtbar = [];
    const verlauf = [];

    for (const stage of stages) {
        const response = await callEndpoint(stage.cache, stage.endpoint, { snapshot: pinned });
        const artikel = await response.json();
        const incoming = readSnapshotHeaders(response.headers);
        const entscheidung = decideSnapshotAcceptance({ pinned, incoming });

        pinned = entscheidung.pin;
        if (entscheidung.accept) sichtbar = artikel;
        verlauf.push({ endpoint: stage.endpoint, reason: entscheidung.reason });
    }

    return { pinned, sichtbar, verlauf, quellen: new Set(sichtbar.map(a => a.source)) };
}

function cacheMitGeneration(millis, lauf, artikel) {
    return createCache({
        [NEWS_SNAPSHOT_POINTER_KEY]: pointerFor(millis, lauf, artikel.length),
        news_cache: artikel,
        news_cache_16: artikel.slice(0, 16),
        news_cache_64: artikel.slice(0, 64),
    });
}

const OHNE_GAMESTAR = [createArticle('a1', 'GameZone'), createArticle('a2', 'PC Games')];
const MIT_GAMESTAR = [...OHNE_GAMESTAR, createArticle('a3', 'GameStar')];

test('ein Pointerwechsel zwischen Preview, Medium und Full mischt keine Generation', async () => {
    const alt = cacheMitGeneration(1000, 'gha-1', OHNE_GAMESTAR);
    const neu = cacheMitGeneration(2000, 'gha-2', MIT_GAMESTAR);

    const ergebnis = await runLoadingChain([
        { endpoint: 'preview', cache: alt },
        { endpoint: 'medium', cache: neu },
        { endpoint: 'full', cache: neu },
    ]);

    assert.equal(ergebnis.pinned.snapshotId, '2000-gha-2', 'die neuere Generation gewinnt');
    assert.deepEqual(ergebnis.verlauf.map(e => e.reason), [
        'first_generation',
        'newer_generation',
        'same_generation',
    ]);
    assert.deepEqual([...ergebnis.quellen].sort(), ['GameStar', 'GameZone', 'PC Games']);
});

test('eine verspaetete aeltere Antwort dreht den sichtbaren Stand nicht zurueck', async () => {
    // Der Edge liefert für die letzte Stufe eine ältere Kopie. Ohne das
    // Protokoll überschriebe sie den bereits neueren Stand.
    const alt = cacheMitGeneration(1000, 'gha-1', OHNE_GAMESTAR);
    const neu = cacheMitGeneration(2000, 'gha-2', MIT_GAMESTAR);

    const ergebnis = await runLoadingChain([
        { endpoint: 'preview', cache: neu },
        { endpoint: 'medium', cache: neu },
        { endpoint: 'full', cache: alt },
    ]);

    assert.equal(ergebnis.pinned.snapshotId, '2000-gha-2');
    assert.equal(ergebnis.verlauf.at(-1).reason, 'older_generation');
    assert.ok(ergebnis.quellen.has('GameStar'), 'GameStar bleibt sichtbar');
});

test('unterschiedlich alte HTTP-Caches erzeugen keine gemischte Generation', async () => {
    // Jede Stufe kommt aus einem anders alten Edge-Cache. Sichtbar bleibt
    // trotzdem genau eine Generation.
    const g1 = cacheMitGeneration(1000, 'gha-1', OHNE_GAMESTAR);
    const g2 = cacheMitGeneration(2000, 'gha-2', MIT_GAMESTAR);
    const g3 = cacheMitGeneration(3000, 'gha-3', MIT_GAMESTAR);

    const ergebnis = await runLoadingChain([
        { endpoint: 'preview', cache: g2 },
        { endpoint: 'medium', cache: g1 },
        { endpoint: 'full', cache: g3 },
    ]);

    assert.equal(ergebnis.pinned.snapshotId, '3000-gha-3');
    assert.deepEqual(ergebnis.verlauf.map(e => e.reason), [
        'first_generation',
        'older_generation',
        'newer_generation',
    ]);
    assert.ok(ergebnis.quellen.has('GameStar'));
});

// === Der dokumentierte GameStar-Fall ===

test('der GameStar-Fall vom 29. Juli 2026 endet auf der vollstaendigen Generation', async () => {
    // Beobachtung: Das Frontend zeigte dauerhaft 25 deutsche Quellen, der
    // direkt abgerufene Full-Cache enthielt 26. GameStar stand im Full-Cache,
    // fehlte aber im sichtbaren Stand des Browsers; VG247 fehlte in beiden.
    //
    // Nachgebaut mit genau diesen Zahlen: der Browser startet auf einem älteren
    // Stand ohne GameStar und muss nach der Aktualisierung die vollständige
    // gepinnte Generation übernehmen.
    const deutscheQuellen = Array.from({ length: 25 }, (_, index) => `DE-Quelle ${index + 1}`);
    const englischeQuellen = Array.from({ length: 13 }, (_, index) => `EN-Quelle ${index + 1}`);

    const artikelFuer = eintraege => eintraege.map(([quelle, sprache], index) => ({
        ...createArticle(`${quelle}-${index}`, quelle),
        language: sprache,
    }));

    const alterStand = artikelFuer([
        ...deutscheQuellen.map(quelle => [quelle, 'de']),
        ...englischeQuellen.map(quelle => [quelle, 'en']),
    ]);
    const neuerStand = artikelFuer([
        ...deutscheQuellen.map(quelle => [quelle, 'de']),
        ['GameStar', 'de'],
        ...englischeQuellen.map(quelle => [quelle, 'en']),
    ]);

    const alt = cacheMitGeneration(1000, 'gha-1', alterStand);
    const neu = cacheMitGeneration(2000, 'gha-2', neuerStand);

    const zaehleSprachen = ergebnis => ({
        de: new Set(ergebnis.sichtbar.filter(a => a.language === 'de').map(a => a.source)),
        en: new Set(ergebnis.sichtbar.filter(a => a.language === 'en').map(a => a.source)),
    });

    // Richtung 1 – Aktualisierung: der Browser startet auf dem älteren Stand
    // ohne GameStar und muss die vollständige neuere Generation übernehmen.
    const aktualisiert = await runLoadingChain([
        { endpoint: 'preview', cache: alt },
        { endpoint: 'medium', cache: alt },
        { endpoint: 'full', cache: neu },
    ]);
    const nachAktualisierung = zaehleSprachen(aktualisiert);

    assert.equal(nachAktualisierung.de.size, 26, 'nach der Aktualisierung 26 statt dauerhaft 25 deutsche Quellen');
    assert.equal(nachAktualisierung.en.size, 13, 'die englischen Quellen bleiben unverändert');
    assert.ok(nachAktualisierung.de.has('GameStar'), 'GameStar ist jetzt sichtbar');
    assert.equal(aktualisiert.pinned.snapshotId, '2000-gha-2');

    // Richtung 2 – genau der beobachtete Dauerzustand: die letzte Stufe kommt
    // aus einem älteren Edge-Cache und würde ohne das Protokoll den bereits
    // vollständigen Stand wieder auf 25 zurückdrehen.
    const zurueckgedreht = await runLoadingChain([
        { endpoint: 'preview', cache: neu },
        { endpoint: 'medium', cache: neu },
        { endpoint: 'full', cache: alt },
    ]);
    const nachRueckfall = zaehleSprachen(zurueckgedreht);

    assert.equal(nachRueckfall.de.size, 26, 'eine ältere Kopie darf nicht auf 25 zurückdrehen');
    assert.ok(nachRueckfall.de.has('GameStar'));
    assert.equal(zurueckgedreht.verlauf.at(-1).reason, 'older_generation');
    assert.equal(zurueckgedreht.pinned.snapshotId, '2000-gha-2');

    // VG247 fehlte auch im Full-Cache. Das ist kein Protokollfehler und darf
    // vom Protokoll auch nicht kaschiert werden.
    assert.equal(aktualisiert.quellen.has('VG247'), false);
    assert.equal(zurueckgedreht.quellen.has('VG247'), false);
});

test('ein Browser auf einem Legacy-Stand uebernimmt die erste echte Generation', async () => {
    // Migrationsrichtung: der erste Abruf trifft noch einen Edge-Cache von vor
    // O3a, der zweite bereits eine Generation.
    const legacy = createCache({
        news_cache: OHNE_GAMESTAR,
        news_cache_16: OHNE_GAMESTAR,
        news_cache_64: OHNE_GAMESTAR,
    });
    const neu = cacheMitGeneration(2000, 'gha-2', MIT_GAMESTAR);

    const ergebnis = await runLoadingChain([
        { endpoint: 'preview', cache: legacy },
        { endpoint: 'full', cache: neu },
    ]);

    assert.deepEqual(ergebnis.verlauf.map(e => e.reason), ['legacy', 'first_generation']);
    assert.equal(ergebnis.pinned.snapshotId, '2000-gha-2');
    assert.ok(ergebnis.quellen.has('GameStar'));
});

// === Rollback ===

test('ein Rollback auf Legacy laesst bestehende Clients weiterarbeiten', async () => {
    // Rollback-Fall: der Zeiger wird entfernt (etwa weil eine Generation
    // fehlerhaft war). Alle Endpunkte antworten dann wie vor O3a.
    const legacy = createCache({
        news_cache: MIT_GAMESTAR,
        news_cache_16: MIT_GAMESTAR,
        news_cache_64: MIT_GAMESTAR,
    });

    const ergebnis = await runLoadingChain([
        { endpoint: 'preview', cache: legacy },
        { endpoint: 'medium', cache: legacy },
        { endpoint: 'full', cache: legacy },
    ]);

    assert.equal(ergebnis.pinned, null, 'ohne Zeiger wird nichts gepinnt');
    assert.deepEqual(ergebnis.verlauf.map(e => e.reason), ['legacy', 'legacy', 'legacy']);
    assert.ok(ergebnis.quellen.has('GameStar'), 'die Artikel kommen unverändert an');
});

test('nach einem Rollback auf eine aeltere Generation gewinnt der neueste gesehene Stand', async () => {
    // Wird der Zeiger auf eine ältere Generation zurückgesetzt, während ein
    // Client bereits auf der neueren steht, verwirft er die ältere Antwort und
    // behält seinen konsistenten Stand. Ein Reload beginnt sauber auf der
    // zurückgesetzten Generation.
    const alt = cacheMitGeneration(1000, 'gha-1', OHNE_GAMESTAR);
    const neu = cacheMitGeneration(2000, 'gha-2', MIT_GAMESTAR);

    const laufenderClient = await runLoadingChain([
        { endpoint: 'preview', cache: neu },
        { endpoint: 'full', cache: alt },
    ]);
    assert.equal(laufenderClient.pinned.snapshotId, '2000-gha-2');
    assert.ok(laufenderClient.quellen.has('GameStar'));

    const neuerClient = await runLoadingChain([
        { endpoint: 'preview', cache: alt },
        { endpoint: 'full', cache: alt },
    ]);
    assert.equal(neuerClient.pinned.snapshotId, '1000-gha-1');
    assert.equal(neuerClient.quellen.has('GameStar'), false, 'der Rollback-Stand ist konsistent');
});

// === Auto-Update: Pinnen erst bei der Uebernahme ===
//
// Getestet wird `planPendingAdoption` - genau die Funktion, die `App.tsx`
// aufruft. Eine nachgebaute Simulation waere gruen geblieben, wenn App.tsx die
// Pruefung wieder verliert.

test('eine inzwischen aeltere Warteschlange wird beim Klick verworfen', async () => {
    // Der Reviewbefund: B wird vorgemerkt, der sichtbare Stand erreicht C, und
    // der Klick setzte die Anwendung auf B zurueck.
    const B = pointerFor(2000, 'gha-2');
    const C = pointerFor(3000, 'gha-3');

    const plan = planPendingAdoption({
        pinned: C,
        pending: { articles: [createArticle('b1')], snapshot: B },
    });

    assert.equal(plan.adopt, false);
    assert.equal(plan.snapshot.snapshotId, C.snapshotId, 'der sichtbare Stand bleibt C');
    assert.equal(plan.reason, 'older_generation');
});

test('eine neuere Warteschlange wird uebernommen und gepinnt', async () => {
    const A = pointerFor(1000, 'gha-1');
    const B = pointerFor(2000, 'gha-2');

    const plan = planPendingAdoption({
        pinned: A,
        pending: { articles: [createArticle('b1')], snapshot: B },
    });

    assert.equal(plan.adopt, true);
    assert.equal(plan.snapshot.snapshotId, B.snapshotId);
    assert.equal(plan.reason, 'newer_generation');
});

test('dieselbe Generation in der Warteschlange wird uebernommen', async () => {
    const B = pointerFor(2000, 'gha-2');

    const plan = planPendingAdoption({
        pinned: B,
        pending: { articles: [createArticle('b1')], snapshot: pointerFor(2000, 'gha-2') },
    });

    assert.equal(plan.adopt, true);
    assert.equal(plan.snapshot.snapshotId, B.snapshotId);
});

test('eine Legacy-Warteschlange setzt eine echte Generation nicht zurueck', async () => {
    const B = pointerFor(2000, 'gha-2');

    const plan = planPendingAdoption({
        pinned: B,
        pending: { articles: [createArticle('x1')], snapshot: null },
    });

    assert.equal(plan.adopt, false);
    assert.equal(plan.snapshot.snapshotId, B.snapshotId);
    assert.equal(plan.reason, 'legacy_after_generation');
});

test('eine Legacy-Warteschlange ohne gepinnte Generation wird uebernommen', async () => {
    const plan = planPendingAdoption({
        pinned: null,
        pending: { articles: [createArticle('x1')], snapshot: null },
    });

    assert.equal(plan.adopt, true);
    assert.equal(plan.snapshot, null);
});

test('eine leere Warteschlange aendert nichts', async () => {
    const B = pointerFor(2000, 'gha-2');

    for (const pending of [null, undefined, { articles: [], snapshot: B }]) {
        const plan = planPendingAdoption({ pinned: B, pending });

        assert.equal(plan.adopt, false, JSON.stringify(pending));
        assert.equal(plan.snapshot.snapshotId, B.snapshotId, JSON.stringify(pending));
    }
});

// === Ausdruecklicher Legacy-Rollback ===

test('ein Rollback-Signal gibt eine gepinnte Generation wieder frei', async () => {
    // Ohne dieses Signal koennte ein laufender Client einen Rollback auf Legacy
    // nie annehmen - er bliebe bis zum Ablauf seiner lokalen Kopie auf dem
    // alten Stand.
    const B = pointerFor(2000, 'gha-2');

    const entscheidung = decideSnapshotAcceptance({ pinned: B, incoming: null, rollback: true });

    assert.equal(entscheidung.accept, true);
    assert.equal(entscheidung.pin, null, 'die Generation wird geloescht, nicht behalten');
    assert.equal(entscheidung.reason, 'legacy_rollback');
});

test('ohne Signal bleibt eine headerlose Antwort eine alte Kopie', async () => {
    const B = pointerFor(2000, 'gha-2');

    const entscheidung = decideSnapshotAcceptance({ pinned: B, incoming: null });

    assert.equal(entscheidung.accept, false);
    assert.equal(entscheidung.pin.snapshotId, B.snapshotId);
    assert.equal(entscheidung.reason, 'legacy_after_generation');
});

test('der Endpunkt sendet das Rollback-Signal nur auf Anweisung', async () => {
    const cache = createCache({
        [NEWS_SNAPSHOT_POINTER_KEY]: pointerFor(2000, 'gha-2'),
        news_cache: [createArticle('a1')],
    });

    const ohne = createNewsCacheHandler(cache.client, ENDPOINTS.full, undefined, {
        readSnapshot: () => cache.client.get(NEWS_SNAPSHOT_POINTER_KEY),
    });
    const ohneAntwort = await ohne(new Request('https://gamerfeed.example/api/get-news'));
    assert.equal(ohneAntwort.headers.get(SNAPSHOT_ROLLBACK_HEADER), null);
    assert.equal(ohneAntwort.headers.get(SNAPSHOT_ID_HEADER), '2000-gha-2');

    const mit = createNewsCacheHandler(cache.client, ENDPOINTS.full, undefined, {
        readSnapshot: () => cache.client.get(NEWS_SNAPSHOT_POINTER_KEY),
        legacyRollback: true,
    });
    const mitAntwort = await mit(new Request('https://gamerfeed.example/api/get-news'));
    assert.equal(mitAntwort.headers.get(SNAPSHOT_ROLLBACK_HEADER), 'legacy');
    assert.equal(
        mitAntwort.headers.get(SNAPSHOT_ID_HEADER),
        null,
        'ein Rollback nennt keine Generation - er gibt sie auf',
    );
    assert.equal(mitAntwort.status, 200);
    assert.ok(Array.isArray(await mitAntwort.json()));
});

test('ein laufender Client folgt einem ausdruecklichen Rollback', async () => {
    // Der vollstaendige Ablauf: der Client steht auf einer Generation, der
    // Server faellt auf Legacy zurueck, der Client uebernimmt und ist danach
    // ungepinnt - auch ein Reload beginnt damit sauber.
    const neu = cacheMitGeneration(2000, 'gha-2', MIT_GAMESTAR);
    const legacy = createCache({
        news_cache: OHNE_GAMESTAR,
        news_cache_16: OHNE_GAMESTAR,
        news_cache_64: OHNE_GAMESTAR,
    });

    let pinned = null;
    let sichtbar = [];

    const ersteAntwort = await callEndpoint(neu, 'full', { snapshot: pinned });
    const ersteArtikel = await ersteAntwort.json();
    const ersteEntscheidung = decideSnapshotAcceptance({
        pinned,
        incoming: readSnapshotHeaders(ersteAntwort.headers),
        rollback: readSnapshotRollback(ersteAntwort.headers),
    });
    pinned = ersteEntscheidung.pin;
    if (ersteEntscheidung.accept) sichtbar = ersteArtikel;

    assert.equal(pinned.snapshotId, '2000-gha-2');

    const rollbackHandler = createNewsCacheHandler(legacy.client, ENDPOINTS.full, undefined, {
        legacyRollback: true,
    });
    const zweiteAntwort = await rollbackHandler(
        new Request(withSnapshotQuery('https://gamerfeed.example/api/get-news', pinned)),
    );
    const zweiteArtikel = await zweiteAntwort.json();
    const zweiteEntscheidung = decideSnapshotAcceptance({
        pinned,
        incoming: readSnapshotHeaders(zweiteAntwort.headers),
        rollback: readSnapshotRollback(zweiteAntwort.headers),
    });
    pinned = zweiteEntscheidung.pin;
    if (zweiteEntscheidung.accept) sichtbar = zweiteArtikel;

    assert.equal(zweiteEntscheidung.accept, true, 'der Rollback wird angenommen');
    assert.equal(pinned, null, 'danach ist nichts mehr gepinnt');
    assert.deepEqual(sichtbar, OHNE_GAMESTAR, 'der Legacy-Stand ist sichtbar');
});
