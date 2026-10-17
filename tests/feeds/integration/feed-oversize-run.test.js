import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../scripts/fetch-feeds.js';
import { MAX_FEED_RESPONSE_BYTES } from '../../../scripts/feed-fetch-utils.js';
import {
    ALLE_SECRETS,
    FEED_ROW,
    createSpies,
    runMain as startMain,
} from '../helpers/feed-run-harness.js';
import {
    chunkedResponse,
    createSyntheticFeed,
    entriesCompleteWithin,
} from '../helpers/synthetic-feeds.js';

// Ein Lauf mit einem Feed ueber der 5-MiB-Grenze: die vollstaendig gelesenen
// Eintraege kommen an, der Rest entfaellt, und der Lauf sagt es genau einmal.
// Der Feed ist synthetisch; kein Test beruehrt Netz, KV, Datenbank oder Groq.

async function runMain(spies, overrides = {}) {
    return startMain(main, spies, overrides);
}

const GROQ_LEER = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
    { status: 200 },
);

function liefereFeed(spies, feed) {
    return spies.makeFetchImpl(async () => chunkedResponse(feed.xml));
}

function assertKeineSecrets(spies) {
    const gespeichert = JSON.stringify(spies.kvStore);
    const protokoll = spies.logLines.join('\n');

    for (const secret of ALLE_SECRETS) {
        assert.doesNotMatch(gespeichert, new RegExp(secret), `${secret} steht im Heartbeat`);
        assert.doesNotMatch(protokoll, new RegExp(secret), `${secret} steht im Log`);
    }
}

test('ein Feed über der Grenze liefert seine vollständigen Einträge und bleibt eine erfolgreiche Quelle', async () => {
    // Sieben Einträge zu je rund 900 KiB (Inhalt doppelt, wie bei einer Redaktion,
    // die den Artikel zweimal liefert): zusammen über 5 MiB, der Schnitt fällt
    // in den sechsten Eintrag.
    const feed = createSyntheticFeed('rss', 7, { contentBytes: 450 * 1024 });
    const erwartet = entriesCompleteWithin(feed, MAX_FEED_RESPONSE_BYTES);
    assert.ok(feed.totalBytes > MAX_FEED_RESPONSE_BYTES, 'Voraussetzung: der Feed ist zu groß');
    assert.ok(erwartet >= 1 && erwartet < 7, `Voraussetzung: ein Teil passt hinein (${erwartet})`);

    const spies = createSpies({ feeds: [FEED_ROW] });
    await runMain(spies, {
        fetchImpl: liefereFeed(spies, feed),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.deepEqual(spies.exitCodes, [], 'der Lauf endet nicht fatal');
    assert.equal(
        spies.fetchCalls.filter(call => call.url === FEED_ROW.url).length,
        1,
        'ein zu großer Feed wird nicht wiederholt',
    );

    // Die Quelle ist erfolgreich, denn es wurden Artikel geliefert.
    const gesundheit = spies.kvStore.feed_health_status.testquelle;
    assert.equal(gesundheit.status, 'success');
    assert.equal(gesundheit.articleCount, erwartet);
    assert.equal(gesundheit.skippedItemCount, 0);
    assert.match(gesundheit.message, new RegExp(`^Successfully fetched and parsed ${erwartet} articles\\.`));
    assert.equal(spies.kvStore.feed_run_status.result, 'success');

    // Genau die vollständigen Einträge sind veröffentlicht - nicht der angeschnittene.
    assert.deepEqual(
        spies.kvStore.news_cache.map(artikel => artikel.title).sort(),
        feed.titles.slice(0, erwartet).sort(),
    );

    // Genau eine Zeile je betroffener Quelle, ohne Adresse, und gleich danach die
    // übliche Parse-Zeile.
    const grenzzeilen = spies.logLines.filter(zeile => zeile.includes(String(MAX_FEED_RESPONSE_BYTES)));
    assert.equal(grenzzeilen.length, 1, spies.logLines.join('\n'));
    const [grenzzeile] = grenzzeilen;
    assert.match(grenzzeile, /Testquelle/);
    assert.match(grenzzeile, new RegExp(`\\(${erwartet}\\)`));
    assert.doesNotMatch(grenzzeile, /https?:|testquelle\.example|beispiel\.example/);
    assert.match(
        spies.logLines[spies.logLines.indexOf(grenzzeile) + 1],
        new RegExp(`Parsed ${erwartet} articles from Testquelle`),
    );

    assertKeineSecrets(spies);
});

test('liegt die Grenze schon im ersten Eintrag, bleibt die Quelle wie bisher ein Fehler', async () => {
    // Ein einziger Eintrag von rund 5,6 MB: nichts davon ist vollständig gelesen.
    const feed = createSyntheticFeed('rss', 1, { contentBytes: 2_800_000 });
    assert.equal(entriesCompleteWithin(feed, MAX_FEED_RESPONSE_BYTES), 0, 'Voraussetzung');

    const spies = createSpies({ feeds: [FEED_ROW] });
    await runMain(spies, {
        fetchImpl: liefereFeed(spies, feed),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.deepEqual(spies.exitCodes, [], 'ein Quellenfehler ist nicht fatal');
    assert.equal(spies.fetchCalls.filter(call => call.url === FEED_ROW.url).length, 1, 'keine Wiederholung');

    const gesundheit = spies.kvStore.feed_health_status.testquelle;
    assert.equal(gesundheit.status, 'error');
    assert.equal(
        gesundheit.message,
        `Fetch failed. Error: Direct fetch response could not be read: response exceeds the ${MAX_FEED_RESPONSE_BYTES} byte limit`,
    );
    assert.equal(gesundheit.articleCount, null);

    assert.ok(
        spies.logLines.every(zeile => !zeile.includes('abgeschnittene Rest')),
        'ohne Rettung keine Meldung über eine Rettung',
    );
    assertKeineSecrets(spies);
});

test('ein Feed innerhalb der Grenze läuft unverändert und ohne Grenzmeldung', async () => {
    const feed = createSyntheticFeed('rss', 3, { contentBytes: 10_000 });
    assert.ok(feed.totalBytes < MAX_FEED_RESPONSE_BYTES, 'Voraussetzung');

    const spies = createSpies({ feeds: [FEED_ROW] });
    await runMain(spies, {
        fetchImpl: liefereFeed(spies, feed),
        groqFetch: spies.makeGroqFetch(GROQ_LEER),
    });

    assert.deepEqual(spies.exitCodes, []);
    assert.equal(spies.kvStore.feed_health_status.testquelle.status, 'success');
    assert.equal(spies.kvStore.feed_health_status.testquelle.articleCount, 3);
    assert.ok(
        spies.logLines.every(zeile => !zeile.includes(String(MAX_FEED_RESPONSE_BYTES))),
        'keine Grenzmeldung für einen Feed innerhalb der Grenze',
    );
    assert.equal(spies.kvStore.news_cache.length, 3);
});
