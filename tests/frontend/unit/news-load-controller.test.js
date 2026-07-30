import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsLoadController } from '../../../services/news-load-controller.ts';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function article(id) {
    return {
        id,
        title: `Artikel ${id}`,
        source: 'Testquelle',
        publicationDate: '2026-07-29T12:00:00.000Z',
        summary: `Zusammenfassung ${id}`,
        link: `https://example.com/${id}`,
        imageUrl: `https://example.com/${id}.jpg`,
        language: 'de',
    };
}

function pointer(epoch, runId) {
    return {
        schemaVersion: 1,
        snapshotId: `${epoch}-${runId}`,
        createdAt: new Date(epoch).toISOString(),
        articleCount: 0,
        runId: null,
    };
}

function response(articles, snapshot = null, status = 200) {
    const headers = { 'content-type': 'application/json' };
    if (snapshot) {
        headers['x-gamerfeed-snapshot-id'] = snapshot.snapshotId;
        headers['x-gamerfeed-snapshot-schema'] = '1';
        headers['x-gamerfeed-snapshot-created-at'] = snapshot.createdAt;
    }
    return new Response(JSON.stringify(articles), { headers, status });
}

function requestPath(request) {
    return new URL(request.url, 'https://gamerfeed.test').pathname;
}

async function waitForRequest(requests, index) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (requests[index]) return requests[index];
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail(`Request ${index} wurde nicht gestartet`);
}

function createHarness({ initialPinned = null } = {}) {
    const requests = [];
    const committed = [];
    const persisted = [];
    const blockingErrors = [];
    const backgroundErrors = [];
    const blockingLoading = [];
    const refreshing = [];
    const warnings = [];
    let pinned = initialPinned;
    let visibleArticles = [];

    const controller = createNewsLoadController({
        fetchImpl: (url, init = {}) => {
            const pending = deferred();
            requests.push({
                ...pending,
                signal: init.signal,
                url,
            });
            return pending.promise;
        },
        getPinnedSnapshot: () => pinned,
        setPinnedSnapshot: snapshot => {
            pinned = snapshot;
        },
        commitArticles: (articles, snapshot, stage) => {
            visibleArticles = articles;
            committed.push({ articles, snapshot, stage });
            persisted.push({ articles, snapshot });
        },
        setBlockingLoading: value => blockingLoading.push(value),
        setRefreshing: value => refreshing.push(value),
        clearBlockingError: () => {
            blockingErrors.length = 0;
        },
        clearBackgroundError: () => {
            backgroundErrors.length = 0;
        },
        reportBlockingError: failure => blockingErrors.push(failure),
        reportBackgroundError: failure => backgroundErrors.push(failure),
        logger: {
            log() {},
            warn: (...args) => warnings.push(args),
        },
    });

    return {
        backgroundErrors,
        blockingErrors,
        blockingLoading,
        committed,
        controller,
        get pinned() {
            return pinned;
        },
        get visibleArticles() {
            return visibleArticles;
        },
        persisted,
        refreshing,
        requests,
        warnings,
    };
}

function snapshotParam(url) {
    return new URL(url, 'https://gamerfeed.test').searchParams.get('snapshot');
}

/**
 * Bildet das produktiv beobachtete Serververhalten nach.
 *
 * Die direkt vorherige Generation bleibt lesbar (O3b). Eine Anfrage mit
 * `?snapshot=A` bekommt deshalb weiterhin A - nur eine **ungepinnte** Anfrage
 * beantwortet der Server mit der aktiven Generation B.
 */
function serveActiveOrPinned(url, { alt, aktiv }) {
    return snapshotParam(url) === alt.snapshotId
        ? response([article('aus-alt')], alt)
        : response([article('aus-aktiv')], aktiv);
}

test('eine verspaetete Full-Antwort ueberschreibt keinen neueren manuellen Refresh', async () => {
    const alt = pointer(Date.parse('2026-07-29T10:00:00.000Z'), 'alt');
    const neu = pointer(Date.parse('2026-07-29T10:20:00.000Z'), 'neu');
    const harness = createHarness();

    const initialLoad = harness.controller.load();
    (await waitForRequest(harness.requests, 0)).resolve(response([article('preview-alt')], alt));
    (await waitForRequest(harness.requests, 1)).resolve(response([article('medium-alt')], alt));
    const oldFull = await waitForRequest(harness.requests, 2);

    const refresh = harness.controller.load({ manualRefresh: true, hasVisibleArticles: true });
    assert.equal(oldFull.signal.aborted, true);
    const newFull = await waitForRequest(harness.requests, 3);
    newFull.resolve(response([article('full-neu')], neu));
    await refresh;

    oldFull.resolve(response([article('full-alt')], alt));
    await initialLoad;

    assert.deepEqual(harness.visibleArticles.map(item => item.id), ['full-neu']);
    assert.deepEqual(harness.persisted.at(-1).articles.map(item => item.id), ['full-neu']);
    assert.equal(harness.pinned.snapshotId, neu.snapshotId);
    assert.equal(harness.committed.some(entry => entry.articles[0]?.id === 'full-alt'), false);
});

test('ein neuer Refresh invalidiert auch eine noch wartende Medium-Antwort', async () => {
    const harness = createHarness();
    const initialLoad = harness.controller.load();
    (await waitForRequest(harness.requests, 0)).resolve(response([article('preview')]));
    const oldMedium = await waitForRequest(harness.requests, 1);

    const refresh = harness.controller.load({ manualRefresh: true, hasVisibleArticles: true });
    const refreshed = await waitForRequest(harness.requests, 2);
    refreshed.resolve(response([article('refresh')]));
    await refresh;

    oldMedium.resolve(response([article('medium-alt')]));
    await initialLoad;

    assert.equal(oldMedium.signal.aborted, true);
    assert.deepEqual(harness.visibleArticles.map(item => item.id), ['refresh']);
    assert.equal(
        harness.persisted.some(entry => entry.articles[0]?.id === 'medium-alt'),
        false,
    );
});

test('ein Medium-Fehler verhindert den Full-Versuch nicht', async () => {
    const harness = createHarness();
    const load = harness.controller.load();

    (await waitForRequest(harness.requests, 0)).resolve(response([article('preview')]));
    (await waitForRequest(harness.requests, 1)).resolve(response(
        { error: 'Medium nicht erreichbar' },
        null,
        503,
    ));
    const full = await waitForRequest(harness.requests, 2);
    full.resolve(response([article('full')]));
    await load;

    assert.deepEqual(harness.requests.map(requestPath), [
        '/api/get-news-preview',
        '/api/get-news-medium',
        '/api/get-news',
    ]);
    assert.deepEqual(harness.visibleArticles.map(item => item.id), ['full']);
    assert.equal(harness.backgroundErrors.length, 0);
    assert.equal(harness.blockingErrors.length, 0);
});

test('Unmount verhindert nachtraegliche State-, Cache- und Pin-Aenderungen', async () => {
    const snapshot = pointer(Date.parse('2026-07-29T10:00:00.000Z'), 'alt');
    const harness = createHarness();
    const load = harness.controller.load();
    const preview = await waitForRequest(harness.requests, 0);

    harness.controller.cancel();
    const stateAtUnmount = {
        blockingErrors: harness.blockingErrors.length,
        committed: harness.committed.length,
        persisted: harness.persisted.length,
    };
    preview.resolve(response([article('zu-spaet')], snapshot));
    await load;

    assert.equal(preview.signal.aborted, true);
    assert.equal(harness.committed.length, stateAtUnmount.committed);
    assert.equal(harness.persisted.length, stateAtUnmount.persisted);
    assert.equal(harness.blockingErrors.length, stateAtUnmount.blockingErrors);
    assert.equal(harness.pinned, null);
});

test('eine aeltere Snapshot-Antwort veraendert weder Pin noch sichtbare Daten', async () => {
    const alt = pointer(Date.parse('2026-07-29T10:00:00.000Z'), 'alt');
    const neu = pointer(Date.parse('2026-07-29T10:20:00.000Z'), 'neu');
    const harness = createHarness({ initialPinned: neu });
    const refresh = harness.controller.load({ manualRefresh: true, hasVisibleArticles: true });

    (await waitForRequest(harness.requests, 0)).resolve(response([article('alt')], alt));
    await refresh;

    assert.equal(harness.committed.length, 0);
    assert.equal(harness.persisted.length, 0);
    assert.equal(harness.pinned.snapshotId, neu.snapshotId);
    assert.equal(harness.warnings.length, 1);
});

test('Hintergrundfehler behalten die bereits sichtbare Preview', async () => {
    const harness = createHarness();
    const load = harness.controller.load();

    (await waitForRequest(harness.requests, 0)).resolve(response([article('preview')]));
    (await waitForRequest(harness.requests, 1)).resolve(response(
        { error: 'Medium kaputt' },
        null,
        500,
    ));
    (await waitForRequest(harness.requests, 2)).resolve(response(
        { error: 'Full kaputt' },
        null,
        500,
    ));
    await load;

    assert.deepEqual(harness.visibleArticles.map(item => item.id), ['preview']);
    assert.equal(harness.blockingErrors.length, 0);
    assert.deepEqual(
        harness.backgroundErrors.map(failure => failure.stage),
        ['full'],
    );
});

test('ohne verwendbare Daten bleibt ein gescheiterter Fallback blockierend', async () => {
    const harness = createHarness();
    const load = harness.controller.load();

    (await waitForRequest(harness.requests, 0)).resolve(response(
        { error: 'Preview kaputt' },
        null,
        503,
    ));
    const fallback = await waitForRequest(harness.requests, 1);
    fallback.resolve(response({ error: 'Full kaputt' }, null, 503));
    await load;

    assert.deepEqual(harness.requests.map(requestPath), [
        '/api/get-news-preview',
        '/api/get-news',
    ]);
    assert.equal(harness.visibleArticles.length, 0);
    assert.equal(harness.blockingErrors.length, 1);
    assert.equal(harness.blockingErrors[0].stage, 'fallback');
    assert.equal(harness.backgroundErrors.length, 0);
    assert.equal(harness.blockingLoading.at(-1), false);
});

test('eine ausgefallene Preview faellt einmalig auf Full zurueck', async () => {
    const harness = createHarness();
    const load = harness.controller.load();

    (await waitForRequest(harness.requests, 0)).resolve(response(
        { error: 'Preview nicht verfuegbar' },
        null,
        404,
    ));
    (await waitForRequest(harness.requests, 1)).resolve(response([article('fallback-full')]));
    await load;

    assert.deepEqual(harness.requests.map(requestPath), [
        '/api/get-news-preview',
        '/api/get-news',
    ]);
    assert.deepEqual(harness.visibleArticles.map(item => item.id), ['fallback-full']);
    assert.equal(harness.blockingErrors.length, 0);
    assert.equal(harness.backgroundErrors.length, 0);
});

test('ein fehlgeschlagener Refresh bleibt mit sichtbaren Daten nicht blockierend', async () => {
    const harness = createHarness();
    const refresh = harness.controller.load({
        manualRefresh: true,
        hasVisibleArticles: true,
    });

    (await waitForRequest(harness.requests, 0)).resolve(response(
        { error: 'Refresh voruebergehend fehlgeschlagen' },
        null,
        503,
    ));
    await refresh;

    assert.equal(harness.blockingErrors.length, 0);
    assert.deepEqual(harness.backgroundErrors.map(failure => failure.stage), ['manual']);
    assert.equal(harness.refreshing.at(-1), false);
});

test('ein abgebrochener Request erscheint nicht als Benutzerfehler', async () => {
    const harness = createHarness();
    const load = harness.controller.load();
    const preview = await waitForRequest(harness.requests, 0);

    harness.controller.cancel();
    preview.reject(new DOMException('Abgebrochen', 'AbortError'));
    await load;

    assert.equal(harness.blockingErrors.length, 0);
    assert.equal(harness.backgroundErrors.length, 0);
});

test('ein Refresh bricht eine laufende passive Auto-Update-Abfrage ab', async () => {
    const harness = createHarness();
    const poll = harness.controller.beginPassiveRequest();
    assert.ok(poll);
    assert.equal(poll.isCurrent(), true);

    const refresh = harness.controller.load({ manualRefresh: true, hasVisibleArticles: true });

    assert.equal(poll.signal.aborted, true);
    assert.equal(poll.isCurrent(), false);
    (await waitForRequest(harness.requests, 0)).resolve(response([article('refresh')]));
    await refresh;
});

// --- F5: ungebundene Entdeckung der aktiven Generation -----------------------

const ALT_GEN = pointer(Date.parse('2026-07-30T10:00:00.000Z'), 'alt');
const AKTIV_GEN = pointer(Date.parse('2026-07-30T10:20:00.000Z'), 'aktiv');

test('eine Ladung entdeckt die inzwischen aktive Generation trotz gepinnter alter Kopie', async () => {
    // Der produktiv beobachtete Fall: sichtbar und lokal gespeichert ist A,
    // aktiv ist laengst B. Solange die Entdeckung `?snapshot=A` mitschickt,
    // antwortet der Server zulaessigerweise weiter mit A - der Browser bleibt
    // dauerhaft auf dem alten Stand.
    const harness = createHarness({ initialPinned: ALT_GEN });

    const load = harness.controller.load();
    const entdeckung = await waitForRequest(harness.requests, 0);
    assert.equal(
        snapshotParam(entdeckung.url),
        null,
        'der erste Versuch einer Ladung darf nicht gepinnt sein',
    );

    entdeckung.resolve(serveActiveOrPinned(entdeckung.url, { alt: ALT_GEN, aktiv: AKTIV_GEN }));
    for (const index of [1, 2]) {
        const stufe = await waitForRequest(harness.requests, index);
        stufe.resolve(serveActiveOrPinned(stufe.url, { alt: ALT_GEN, aktiv: AKTIV_GEN }));
    }
    await load;

    assert.equal(harness.pinned.snapshotId, AKTIV_GEN.snapshotId, 'B wird entdeckt und uebernommen');
    assert.deepEqual(harness.visibleArticles.map(item => item.id), ['aus-aktiv']);
    assert.equal(harness.persisted.at(-1).snapshot.snapshotId, AKTIV_GEN.snapshotId);
});

test('nach der Annahme tragen alle Folgestufen genau die angenommene Generation', async () => {
    const harness = createHarness({ initialPinned: ALT_GEN });

    const load = harness.controller.load();
    const entdeckung = await waitForRequest(harness.requests, 0);
    entdeckung.resolve(response([article('preview')], AKTIV_GEN));

    const medium = await waitForRequest(harness.requests, 1);
    assert.equal(snapshotParam(medium.url), AKTIV_GEN.snapshotId);
    medium.resolve(response([article('medium')], AKTIV_GEN));

    const full = await waitForRequest(harness.requests, 2);
    assert.equal(snapshotParam(full.url), AKTIV_GEN.snapshotId);
    full.resolve(response([article('full')], AKTIV_GEN));
    await load;

    assert.deepEqual(
        harness.requests.map(item => snapshotParam(item.url)),
        [null, AKTIV_GEN.snapshotId, AKTIV_GEN.snapshotId],
    );
});

test('ohne angenommene Antwort bleibt auch der Full-Fallback ungepinnt', async () => {
    const harness = createHarness({ initialPinned: ALT_GEN });

    const load = harness.controller.load();
    (await waitForRequest(harness.requests, 0)).reject(new Error('Preview nicht erreichbar'));

    const fallback = await waitForRequest(harness.requests, 1);
    assert.equal(snapshotParam(fallback.url), null, 'der Fallback ist der erste echte Versuch');
    fallback.resolve(serveActiveOrPinned(fallback.url, { alt: ALT_GEN, aktiv: AKTIV_GEN }));
    await load;

    assert.equal(harness.pinned.snapshotId, AKTIV_GEN.snapshotId);
    assert.deepEqual(harness.visibleArticles.map(item => item.id), ['aus-aktiv']);
});

test('ein manueller Refresh entdeckt die aktive Generation ungepinnt', async () => {
    const harness = createHarness({ initialPinned: ALT_GEN });

    const refresh = harness.controller.load({ manualRefresh: true, hasVisibleArticles: true });
    const request = await waitForRequest(harness.requests, 0);
    assert.equal(snapshotParam(request.url), null);

    request.resolve(serveActiveOrPinned(request.url, { alt: ALT_GEN, aktiv: AKTIV_GEN }));
    await refresh;

    assert.equal(harness.pinned.snapshotId, AKTIV_GEN.snapshotId);
    assert.deepEqual(harness.visibleArticles.map(item => item.id), ['aus-aktiv']);
});

test('eine ungepinnt entdeckte aeltere Generation aendert weder Pin noch Daten', async () => {
    // Gegenprobe: Die ungebundene Entdeckung darf keinen Rueckschritt oeffnen.
    // Ein Edge-Cache kann durchaus noch die alte Generation ausliefern.
    const harness = createHarness({ initialPinned: AKTIV_GEN });

    const load = harness.controller.load();
    const entdeckung = await waitForRequest(harness.requests, 0);
    entdeckung.resolve(response([article('aus-alt')], ALT_GEN));

    for (const index of [1, 2]) {
        (await waitForRequest(harness.requests, index)).resolve(response([article('aus-alt')], ALT_GEN));
    }
    await load;

    assert.equal(harness.pinned.snapshotId, AKTIV_GEN.snapshotId, 'der Pin bleibt auf der neueren Generation');
    assert.deepEqual(harness.visibleArticles, []);
    assert.equal(harness.persisted.length, 0, 'die lokale Kopie bleibt unberuehrt');
});

test('eine ungepinnt entdeckte headerlose Antwort bleibt ohne Rollback verworfen', async () => {
    const harness = createHarness({ initialPinned: AKTIV_GEN });

    const load = harness.controller.load();
    (await waitForRequest(harness.requests, 0)).resolve(response([article('legacy')]));
    for (const index of [1, 2]) {
        (await waitForRequest(harness.requests, index)).resolve(response([article('legacy')]));
    }
    await load;

    assert.equal(harness.pinned.snapshotId, AKTIV_GEN.snapshotId);
    assert.deepEqual(harness.visibleArticles, []);
});

test('ein ausdruecklicher Rollback wirkt auch bei ungepinnter Entdeckung', async () => {
    const harness = createHarness({ initialPinned: AKTIV_GEN });

    const load = harness.controller.load();
    const entdeckung = await waitForRequest(harness.requests, 0);
    const rollback = response([article('legacy')]);
    rollback.headers.set('x-gamerfeed-snapshot-rollback', 'legacy');
    entdeckung.resolve(rollback);

    for (const index of [1, 2]) {
        const stufe = await waitForRequest(harness.requests, index);
        assert.equal(snapshotParam(stufe.url), null, 'nach dem Rollback gibt es nichts zu pinnen');
        const weitere = response([article('legacy')]);
        weitere.headers.set('x-gamerfeed-snapshot-rollback', 'legacy');
        stufe.resolve(weitere);
    }
    await load;

    assert.equal(harness.pinned, null, 'die gepinnte Generation wird geloescht');
    assert.deepEqual(harness.visibleArticles.map(item => item.id), ['legacy']);
});
