import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../scripts/fetch-feeds.js';
import {
    NEWS_SNAPSHOT_POINTER_KEY,
    normalizeSnapshotPointer,
} from '../../../shared/news-snapshot.js';
import {
    createSpies,
    feedFetch,
    runMain as startMain,
} from '../helpers/feed-run-harness.js';

// Veroeffentlichungsseite des generationsgebundenen Protokolls (Roadmap O3a).
// Keine Datenbank, kein KV, kein Netz, keine Wartezeit.

const GROQ_LEER = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
    { status: 200 },
);

function createSchlaf() {
    return { sleep: async () => {} };
}

async function runMain(spies, overrides = {}) {
    return startMain(main, spies, overrides);
}

test('ein erfolgreicher Lauf veroeffentlicht einen Generationszeiger', async () => {
    const spies = createSpies();
    const { sleep } = createSchlaf();

    await runMain(spies, {
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    const zeiger = normalizeSnapshotPointer(spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY]);

    assert.ok(zeiger, 'der Zeiger ist lesbar');
    assert.equal(zeiger.schemaVersion, 1);
    assert.match(zeiger.snapshotId, /^\d+-/);
    assert.ok(zeiger.createdAt, 'der Zeitpunkt ist gesetzt');
    assert.equal(zeiger.articleCount, 1);
    assert.equal(zeiger.runId, 'test-run');
});

test('der Zeiger wird erst nach allen drei News-Caches geschrieben', async () => {
    // Die Reihenfolge ist der Kern der Zusage: ein Zeiger darf nie auf Daten
    // zeigen, die noch gar nicht vollständig geschrieben sind.
    const spies = createSpies();
    const { sleep } = createSchlaf();

    await runMain(spies, {
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    const reihenfolge = spies.kvSets.map(entry => entry.key);
    const zeigerIndex = reihenfolge.indexOf(NEWS_SNAPSHOT_POINTER_KEY);

    assert.ok(zeigerIndex > 0, 'der Zeiger wird überhaupt geschrieben');
    for (const key of ['news_cache', 'news_cache_16', 'news_cache_64']) {
        const index = reihenfolge.indexOf(key);
        assert.ok(index >= 0, `${key} wird geschrieben`);
        assert.ok(index < zeigerIndex, `${key} steht vor dem Zeiger`);
    }
});

test('zwei aufeinanderfolgende Laeufe erzeugen aufsteigende Kennungen', async () => {
    const kennungen = [];

    for (const _lauf of [1, 2]) {
        const spies = createSpies();
        const { sleep } = createSchlaf();

        await runMain(spies, {
            sleep,
            fetchImpl: feedFetch(spies),
            groqFetch: spies.makeGroqFetch(GROQ_LEER),
        });

        kennungen.push(normalizeSnapshotPointer(spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY]));
    }

    assert.ok(
        Date.parse(kennungen[0].createdAt) <= Date.parse(kennungen[1].createdAt),
        'der zweite Lauf ist nicht älter als der erste',
    );
});

test('ein Schreibfehler am Zeiger laesst den Kern-Publish bestehen', async () => {
    // Die drei News-Caches stehen bereits. Ein Leser ohne Zeiger fällt
    // kontrolliert auf Legacy zurück - den Lauf deshalb scheitern zu lassen
    // wäre der schlechtere Tausch.
    const spies = createSpies();
    const { sleep } = createSchlaf();

    const echterSet = spies.store.set;
    spies.store.set = async (key, value) => {
        if (key === NEWS_SNAPSHOT_POINTER_KEY) {
            throw new Error('KV lehnt den Zeiger ab');
        }
        return echterSet(key, value);
    };

    await runMain(spies, {
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.deepEqual(spies.exitCodes, [], 'der Lauf bleibt erfolgreich');
    assert.ok(spies.kvSets.some(entry => entry.key === 'news_cache'), 'der Kern-Publish steht');
    assert.equal(spies.kvStore.feed_run_status.result, 'success');
    assert.ok(
        spies.logLines.some(line => line.includes('Generationszeiger konnte nicht gespeichert werden')),
        'der Ausfall wird gemeldet',
    );
});

test('ein gescheiterter Lauf veroeffentlicht keinen neuen Zeiger', async () => {
    // Sonst zeigte eine Generation auf einen Stand, den es nie gab.
    const spies = createSpies({ sqlError: new Error('Datenbank nicht erreichbar') });
    const { sleep } = createSchlaf();

    spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY] = {
        schemaVersion: 1,
        snapshotId: '1000-frueherer-lauf',
        createdAt: '2026-07-29T10:00:00.000Z',
        articleCount: 42,
        runId: 'frueherer-lauf',
    };

    await runMain(spies, {
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.deepEqual(spies.exitCodes, [1]);
    assert.equal(
        spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY].snapshotId,
        '1000-frueherer-lauf',
        'der bisherige Zeiger bleibt unangetastet',
    );
});

test('der Zeiger enthaelt keine Secrets', async () => {
    const spies = createSpies();
    const { sleep } = createSchlaf();

    await runMain(spies, {
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    const gespeichert = JSON.stringify(spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY]);
    for (const secret of ['pg-geheim', 'kv-token-geheim', 'gsk-groq-geheim', 'proxy-geheim']) {
        assert.doesNotMatch(gespeichert, new RegExp(secret), secret);
    }
});

test('Kennung und Zeitpunkt des Zeigers stammen aus demselben Moment', async () => {
    // Zwei getrennte `new Date()`-Aufrufe koennten sich um eine Millisekunde
    // unterscheiden - dann passten der sortierbare Zeitanteil der Kennung und
    // `createdAt` nicht mehr zueinander.
    const spies = createSpies();
    const { sleep } = createSchlaf();

    await runMain(spies, {
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    const zeiger = normalizeSnapshotPointer(spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY]);
    const zeitanteil = Number(zeiger.snapshotId.split('-')[0]);

    assert.equal(zeitanteil, Date.parse(zeiger.createdAt));
});
