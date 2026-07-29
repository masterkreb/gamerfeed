import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsCacheHandler } from '../../../server/news-cache-handler.ts';
import { createHealthDataHandler } from '../../../server/health-data-handler.ts';
import {
    NEWS_SNAPSHOT_POINTER_KEY,
    SNAPSHOT_ID_HEADER,
    buildSnapshotPointer,
} from '../../../shared/news-snapshot.js';

// Bindung zwischen Kennung und Inhalt (Roadmap O3a, Reviewrunde).
//
// Eine Snapshot-ID darf nur Inhalt kennzeichnen, der nachweisbar zu genau
// dieser Generation gehoert. Die drei News-Keys sind bis O3b **veraenderlich**:
// der Cron ueberschreibt sie, waehrend ein Endpunkt liest. Eine blosse
// Lesereihenfolge kann daraus keine Bindung machen - diese Datei haelt genau
// das fest.

function artikel(id, quelle = 'GameZone') {
    return {
        id,
        title: `Artikel ${id}`,
        source: quelle,
        publicationDate: '2026-07-29T12:00:00.000Z',
        summary: `Zusammenfassung ${id}`,
        link: `https://example.com/${id}`,
        imageUrl: `https://example.com/${id}.jpg`,
        language: 'de',
    };
}

const ALTER_STAND = [artikel('a1')];
const NEUER_STAND = [artikel('a1'), artikel('a2', 'GameStar')];

const ALTER_ZEIGER = buildSnapshotPointer({
    snapshotId: '1000-gha-1',
    createdAt: new Date(1000).toISOString(),
    articleCount: ALTER_STAND.length,
    runId: 'gha-1',
});

/**
 * Cache, in dem der Cron **zwischen** zwei Lesevorgaengen schreibt.
 *
 * Genau der Ablauf aus dem Review: der Endpunkt liest den alten Zeiger, danach
 * kippt der Lauf die veraenderlichen Keys auf den neuen Stand, und erst dann
 * liest der Endpunkt die Artikel.
 */
function createCacheMitSchreibvorgang({ pointer = ALTER_ZEIGER } = {}) {
    const calls = [];
    let umgeschrieben = false;

    return {
        calls,
        client: {
            async get(key) {
                calls.push(key);

                if (key === NEWS_SNAPSHOT_POINTER_KEY) {
                    return pointer;
                }

                // Der erste Artikelabruf nach dem Zeigerlesen trifft bereits
                // den neuen Stand - der Zeiger ist zu diesem Zeitpunkt noch
                // nicht fortgeschrieben.
                umgeschrieben = true;
                return NEUER_STAND;
            },
            get umgeschrieben() {
                return umgeschrieben;
            },
        },
    };
}

test('eine Kennung kennzeichnet niemals Inhalt, der ihr nicht nachweisbar gehoert', async () => {
    // Der Handler liest den Zeiger zuerst und die Artikel danach. Faellt der
    // Schreibvorgang dazwischen, gehoert der Rumpf zur *neuen* Generation,
    // waehrend der Zeiger noch die alte nennt. Weil sich das mit
    // veraenderlichen Keys nicht ausschliessen laesst, darf die Antwort
    // ueberhaupt keine Kennung tragen.
    const cache = createCacheMitSchreibvorgang();
    const handler = createNewsCacheHandler(cache.client, {
        cacheKey: 'news_cache',
        endpointPath: '/api/get-news',
    });

    const response = await handler(new Request('https://gamerfeed.example/api/get-news'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, NEUER_STAND, 'geliefert wird der neue Stand');
    assert.equal(
        response.headers.get(SNAPSHOT_ID_HEADER),
        null,
        'aber ohne Kennung - „1000-gha-1" auf neuem Inhalt waere eine Falschaussage',
    );
});

test('eine gepinnte Anfrage wird nicht unter einer fremden Kennung zwischengespeichert', async () => {
    // Der gefaehrlichste Teil des Befunds: die Antwort trug die angefragte
    // alte Kennung und wurde damit fuenf Minuten am Edge festgeschrieben.
    const cache = createCacheMitSchreibvorgang();
    const handler = createNewsCacheHandler(cache.client, {
        cacheKey: 'news_cache',
        endpointPath: '/api/get-news',
    });

    const response = await handler(
        new Request('https://gamerfeed.example/api/get-news?snapshot=1000-gha-1'),
    );

    assert.equal(response.headers.get(SNAPSHOT_ID_HEADER), null);
    assert.notEqual(
        response.headers.get('cache-control'),
        's-maxage=300, stale-while-revalidate=600',
        'kein verlaengerter Edge-Cache unter einer Kennung, die nichts belegt',
    );
});

test('auch mit vorhandenem Zeiger bleiben die Legacy-Antworten unveraendert nutzbar', async () => {
    // Die Dual-Read-Zusage: ohne belegbare Generation verhaelt sich alles
    // exakt wie vor O3a.
    const cache = createCacheMitSchreibvorgang();
    const handler = createNewsCacheHandler(cache.client, {
        cacheKey: 'news_cache',
        endpointPath: '/api/get-news',
    });

    const response = await handler(new Request('https://gamerfeed.example/api/get-news'));

    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(
        response.headers.get('cache-control'),
        's-maxage=60, stale-while-revalidate=300',
    );
    assert.ok(Array.isArray(await response.json()));
});

// === Health-API ===

function healthStore(pointerFolge) {
    let index = 0;
    const calls = [];

    return {
        calls,
        client: {
            async get(key) {
                calls.push(key);
                if (key === NEWS_SNAPSHOT_POINTER_KEY) {
                    const wert = pointerFolge[Math.min(index, pointerFolge.length - 1)];
                    index += 1;
                    return wert;
                }
                if (key === 'news_cache') return NEUER_STAND;
                if (key === 'feed_health_status') {
                    return { gamezone: { status: 'success', message: 'ok', lastAttemptAt: null, lastSuccessAt: null, durationMs: 1, articleCount: 1 } };
                }
                return null;
            },
        },
    };
}

test('die Health-API meldet ohne gebundene Quelle gar keine Generation', async () => {
    // Der gespeicherte Zeiger wird nicht einmal gelesen: `sourcesInCache` und
    // `snapshot` muessen denselben Stand beschreiben, und das kann neben
    // veraenderlichen Keys niemand belegen.
    const store = healthStore([ALTER_ZEIGER]);

    const handler = createHealthDataHandler(store.client, { now: () => new Date(5000) });
    const body = await (await handler(new Request('https://example.com/x'))).json();

    assert.equal(body.snapshot, null, 'kontrolliert Legacy statt einer geratenen Zuordnung');
    assert.deepEqual(body.sourcesInCache, ['GameZone', 'GameStar']);
    assert.equal(
        store.calls.includes(NEWS_SNAPSHOT_POINTER_KEY),
        false,
        'der Zeiger wird gar nicht erst gelesen',
    );
});

test('eine passende Artikelzahl macht aus einem alten Zeiger keine Zuordnung', async () => {
    // Der Reviewbefund: `1000-old` mit articleCount 2 und zwei voellig anderen
    // Artikeln. Eine Artikelzahl belegt nichts - zwei Generationen koennen
    // dieselbe haben.
    const passenderAlterZeiger = buildSnapshotPointer({
        snapshotId: '1000-old',
        createdAt: new Date(1000).toISOString(),
        articleCount: NEUER_STAND.length,
        runId: 'old',
    });
    const store = healthStore([passenderAlterZeiger]);

    const handler = createHealthDataHandler(store.client, { now: () => new Date(5000) });
    const body = await (await handler(new Request('https://example.com/x'))).json();

    assert.equal(body.snapshot, null);
    assert.deepEqual(body.sourcesInCache, ['GameZone', 'GameStar']);
});
