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
//
// Der Kern der Zusage: `news_cache`, `news_cache_16` und `news_cache_64` sind
// **veraenderliche** Schluessel. Ein Zeiger daneben kann nicht belegen, dass
// gelesener Inhalt zu ihm gehoert. Deshalb schreibt dieser Lauf keinen Zeiger -
// er entwertet einen vorhandenen, bevor er die Keys anfasst.
//
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

const ALTER_ZEIGER = Object.freeze({
    schemaVersion: 1,
    snapshotId: '1000-frueherer-lauf',
    createdAt: new Date(1000).toISOString(),
    articleCount: 42,
    runId: 'frueherer-lauf',
});

test('ein erfolgreicher Lauf veroeffentlicht keinen Generationszeiger', async () => {
    // Eine Kennung neben veraenderlichen Keys waere eine Zusage, die niemand
    // einhalten kann. Aktiviert wird das Protokoll mit O3b.
    const spies = createSpies();
    const { sleep } = createSchlaf();

    await runMain(spies, {
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.deepEqual(spies.exitCodes, []);
    assert.equal(
        normalizeSnapshotPointer(spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY]),
        null,
        'nach dem Lauf gibt es keine gueltige Generation',
    );
    assert.equal(
        spies.kvSets.some(entry => entry.key === NEWS_SNAPSHOT_POINTER_KEY
            && normalizeSnapshotPointer(entry.value) !== null),
        false,
        'es wird auch keine geschrieben',
    );
});

test('ein vorhandener Zeiger wird entwertet, bevor die Keys ueberschrieben werden', async () => {
    // Genau der Reviewbefund: sonst beschriftete `1000-frueherer-lauf` neue
    // Artikel - und ein gepinnter Edge-Cache haette das festgeschrieben.
    const spies = createSpies();
    const { sleep } = createSchlaf();

    spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY] = { ...ALTER_ZEIGER };

    const reihenfolge = [];
    const echterSet = spies.store.set;
    const echterDel = spies.store.del;
    spies.store.set = async (key, value) => {
        reihenfolge.push(`set:${key}`);
        return echterSet(key, value);
    };
    spies.store.del = async key => {
        reihenfolge.push(`del:${key}`);
        return echterDel(key);
    };

    await runMain(spies, {
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    const entwertung = reihenfolge.indexOf(`del:${NEWS_SNAPSHOT_POINTER_KEY}`);
    assert.ok(entwertung >= 0, 'der Zeiger wird entwertet');

    for (const key of ['news_cache', 'news_cache_16', 'news_cache_64']) {
        const index = reihenfolge.indexOf(`set:${key}`);
        assert.ok(index >= 0, `${key} wird geschrieben`);
        assert.ok(index > entwertung, `${key} wird erst nach der Entwertung geschrieben`);
    }

    assert.equal(
        normalizeSnapshotPointer(spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY]),
        null,
        'die alte Generation ist weg',
    );
});

test('neue Artikel tragen nie die Kennung eines frueheren Laufs', async () => {
    // Der Nachweis in Datenform: nach dem Lauf steht der neue Inhalt im Cache,
    // und es gibt keine Generation mehr, die ihn falsch beschriften koennte.
    const spies = createSpies();
    const { sleep } = createSchlaf();

    spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY] = { ...ALTER_ZEIGER };

    await runMain(spies, {
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.equal(spies.kvStore.news_cache.length, 1, 'der neue Stand steht');
    assert.equal(normalizeSnapshotPointer(spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY]), null);
});

test('eine gescheiterte Entwertung stoppt den Publish nicht, wird aber gemeldet', async () => {
    // Die Artikel sind wichtiger als das Etikett. Der Fall muss trotzdem
    // sichtbar sein - der naechste Lauf versucht es erneut.
    const spies = createSpies();
    const { sleep } = createSchlaf();

    spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY] = { ...ALTER_ZEIGER };
    spies.store.del = async () => {
        throw new Error('KV lehnt das Loeschen ab');
    };

    await runMain(spies, {
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.deepEqual(spies.exitCodes, [], 'der Lauf bleibt erfolgreich');
    assert.ok(spies.kvSets.some(entry => entry.key === 'news_cache'), 'der Kern-Publish steht');
    assert.ok(
        spies.logLines.some(line => line.includes('Generationszeiger konnte nicht entwertet werden')),
        'der Ausfall wird gemeldet',
    );
});

test('ein gescheiterter Lauf laesst den gespeicherten Stand unangetastet', async () => {
    // Ohne Kern-Publish wird auch nichts entwertet: die Keys bleiben, wie sie
    // sind, und ein etwaiger Zeiger passt weiterhin zu ihnen.
    const spies = createSpies({ sqlError: new Error('Datenbank nicht erreichbar') });
    const { sleep } = createSchlaf();

    spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY] = { ...ALTER_ZEIGER };

    await runMain(spies, {
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.deepEqual(spies.exitCodes, [1]);
    assert.deepEqual(
        spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY],
        ALTER_ZEIGER,
        'der bisherige Zeiger bleibt unveraendert',
    );
});

test('die Entwertung gibt keine Secrets aus', async () => {
    const spies = createSpies();
    const { sleep } = createSchlaf();

    spies.kvStore[NEWS_SNAPSHOT_POINTER_KEY] = { ...ALTER_ZEIGER };
    spies.store.del = async () => {
        throw new Error('KV offline: https://kv.example/pipeline?token=kv-token-geheim');
    };

    await runMain(spies, {
        sleep,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    const protokoll = spies.logLines.join('\n');
    for (const secret of ['pg-geheim', 'kv-token-geheim', 'gsk-groq-geheim', 'proxy-geheim']) {
        assert.doesNotMatch(protokoll, new RegExp(secret), secret);
    }
});
