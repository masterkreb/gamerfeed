import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../scripts/fetch-feeds.js';
import { createFeedRunRecorder } from '../../../scripts/feed-run-recorder.js';
import {
    ALLE_SECRETS,
    FEED_ROW,
    GAMEPRO_ROW,
    VOLLSTAENDIGE_ENV,
    createSpies,
    feedFetch,
    rssFeed,
    runMain as startMain,
} from '../helpers/feed-run-harness.js';

// Der komplette Lauf gegen Attrappen: keine Datenbank, kein KV, kein Netz.
// Geprüft wird vor allem die Reihenfolge - insbesondere, dass eine
// gescheiterte Vorprüfung *vor* jedem externen Zugriff greift.

async function runMain(spies, overrides = {}) {
    return startMain(main, spies, overrides);
}

// === Core-Konfiguration: nichts passiert davor ===

test('jedes fehlende Core-Secret beendet den Lauf vor allen externen Zugriffen', async () => {
    for (const key of ['POSTGRES_URL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) {
        const spies = createSpies();
        const env = { ...VOLLSTAENDIGE_ENV };
        delete env[key];

        await runMain(spies, {
            env,
            groqFetch: spies.makeGroqFetch(),
        });

        assert.deepEqual(spies.exitCodes, [1], `${key}: der Lauf endet fatal`);
        assert.equal(spies.sqlQueries.length, 0, `${key}: kein SQL`);
        assert.equal(spies.kvGets.length, 0, `${key}: kein KV-Lesen`);
        assert.equal(spies.kvSets.length, 0, `${key}: kein KV-Schreiben`);
        assert.equal(spies.recorderCalls.length, 0, `${key}: kein Recorder`);
        assert.equal(spies.fetchCalls.length, 0, `${key}: kein HTTP`);
        assert.equal(spies.groqCalls.length, 0, `${key}: kein Groq`);
    }
});

test('ein leerer Core-Wert zählt genauso wie ein fehlender', async () => {
    const spies = createSpies();

    await runMain(spies, {
        env: { ...VOLLSTAENDIGE_ENV, POSTGRES_URL: '   ' },
        groqFetch: spies.makeGroqFetch(),
    });

    assert.deepEqual(spies.exitCodes, [1]);
    assert.equal(spies.recorderCalls.length, 0);
    assert.equal(spies.kvSets.length, 0);
});

test('die Abbruchmeldung nennt den Namen, aber keinen Wert', async () => {
    const spies = createSpies();
    const env = { ...VOLLSTAENDIGE_ENV };
    delete env.KV_REST_API_TOKEN;

    await runMain(spies, { env, groqFetch: spies.makeGroqFetch() });

    const protokoll = spies.logLines.join('\n');
    assert.match(protokoll, /KV_REST_API_TOKEN/);
    assert.doesNotMatch(protokoll, /pg-geheim|kv-token-geheim|gsk-groq-geheim/);
});

// === Optionale Werte blockieren den Kernlauf nicht ===

test('ein fehlender GROQ_API_KEY verhindert den News-Publish nicht', async () => {
    const spies = createSpies();
    const env = { ...VOLLSTAENDIGE_ENV };
    delete env.GROQ_API_KEY;

    await runMain(spies, {
        env,
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(),
    });

    assert.deepEqual(spies.exitCodes, [], 'der Lauf endet nicht fatal');
    assert.ok(spies.kvSets.some(entry => entry.key === 'news_cache'), 'der News-Cache wird geschrieben');
    assert.ok(spies.recorderCalls.includes('recordCorePublish'));
    assert.ok(spies.recorderCalls.includes('finish'));
    assert.equal(spies.groqCalls.length, 0, 'ohne Schlüssel wird Groq nicht kontaktiert');
});

test('eine fehlende oder unbrauchbare FEED_PROXY_URL verhindert Direktabruf und Publish nicht', async () => {
    for (const proxyWert of [undefined, '', 'kein-schema', 'http://proxy.example/x.php']) {
        const spies = createSpies();
        const env = { ...VOLLSTAENDIGE_ENV };
        if (proxyWert === undefined) {
            delete env.FEED_PROXY_URL;
        } else {
            env.FEED_PROXY_URL = proxyWert;
        }

        await runMain(spies, {
            env,
            fetchImpl: feedFetch(spies),
            groqFetch: spies.makeGroqFetch(async () => new Response(
                JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
                { status: 200 },
            )),
        });

        assert.deepEqual(spies.exitCodes, [], String(proxyWert));
        assert.ok(
            spies.kvSets.some(entry => entry.key === 'news_cache'),
            `${proxyWert}: der Kern-Publish findet statt`,
        );
        assert.ok(
            spies.fetchCalls.every(call => !call.url.includes('proxy.example')),
            `${proxyWert}: kein Proxy-Aufruf`,
        );
    }
});

// === Proxy nur für vorgesehene Quellen ===

test('GamePro darf nach einem Direktfehler den Proxy versuchen', async () => {
    const spies = createSpies({ feeds: [GAMEPRO_ROW] });

    await runMain(spies, {
        fetchImpl: spies.makeFetchImpl(async url => (
            url.includes('proxy.example')
                ? new Response(rssFeed('Über den Proxy'), { status: 200 })
                : new Response('Forbidden', { status: 403 })
        )),
        groqFetch: spies.makeGroqFetch(async () => new Response(
            JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
            { status: 200 },
        )),
    });

    assert.ok(
        spies.fetchCalls.some(call => call.url.includes('proxy.example')),
        'der Proxy wird versucht',
    );
    assert.ok(spies.kvSets.some(entry => entry.key === 'news_cache'));
});

test('eine andere Quelle erzeugt trotz Direktfehler keinen Proxy-Aufruf', async () => {
    const spies = createSpies({ feeds: [FEED_ROW] });

    await runMain(spies, {
        fetchImpl: spies.makeFetchImpl(async url => (
            url.includes('proxy.example')
                ? new Response(rssFeed('Sollte nie geholt werden'), { status: 200 })
                : new Response('Forbidden', { status: 403 })
        )),
        groqFetch: spies.makeGroqFetch(async () => new Response(
            JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
            { status: 200 },
        )),
    });

    assert.equal(
        spies.fetchCalls.filter(call => call.url.includes('proxy.example')).length,
        0,
        'GameStar ist nicht für den Proxy freigegeben',
    );
});

// === Optionale Trendfehler ===

test('ein Groq-Fehler macht einen erfolgreichen Kern-Publish nicht fatal oder alt', async () => {
    const spies = createSpies();

    await runMain(spies, {
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(async () => {
            throw new Error('Groq nicht erreichbar');
        }),
    });

    assert.deepEqual(spies.exitCodes, [], 'der Lauf bleibt erfolgreich');
    assert.ok(spies.recorderCalls.includes('recordCorePublish'));
    assert.ok(spies.recorderCalls.includes('finish'));
    assert.equal(spies.recorderCalls.includes('recordFatal'), false);

    // Der Kern-Publish bleibt unverändert stehen.
    assert.equal(spies.kvStore.feed_publish_status.lastCorePublishAt, '2026-07-28T12:01:00.000Z');
    assert.equal(spies.kvStore.feed_run_status.result, 'success');
});

test('auch eine unbrauchbare Groq-Antwort lässt den Lauf erfolgreich', async () => {
    for (const antwort of [
        new Response('kein json', { status: 200 }),
        new Response(JSON.stringify({ choices: [] }), { status: 200 }),
        new Response('Rate limited', { status: 429 }),
    ]) {
        const spies = createSpies();

        await runMain(spies, {
            fetchImpl: feedFetch(spies),
            groqFetch: spies.makeGroqFetch(async () => antwort.clone()),
        });

        assert.deepEqual(spies.exitCodes, []);
        assert.equal(spies.kvStore.feed_run_status.result, 'success');
    }
});

// === Fehlerpfad des Kernlaufs ===

test('ein SQL-Fehler beendet den Lauf fatal, ohne Secrets zu zeigen', async () => {
    const spies = createSpies({
        sqlError: new Error('connect failed to postgres://nutzer:pg-geheim@db.example/main'),
    });

    await runMain(spies, {
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(),
    });

    assert.deepEqual(spies.exitCodes, [1]);
    assert.ok(spies.recorderCalls.includes('recordFatal'));
    assert.equal(spies.kvStore.feed_run_status.result, 'fatal');
    assert.doesNotMatch(spies.kvStore.feed_run_status.fatalError, /pg-geheim/);
});

// === Secrets ===

function assertKeineSecrets(spies, kontext) {
    const gespeichert = JSON.stringify(spies.kvStore);
    const protokoll = spies.logLines.join('\n');

    for (const secret of ALLE_SECRETS) {
        assert.doesNotMatch(gespeichert, new RegExp(secret), `${kontext}: ${secret} steht im Heartbeat`);
        assert.doesNotMatch(protokoll, new RegExp(secret), `${kontext}: ${secret} steht im Log`);
    }
}

test('kein Secret erscheint im gespeicherten Heartbeat oder im Log', async () => {
    const spies = createSpies();

    await runMain(spies, {
        fetchImpl: spies.makeFetchImpl(async () => {
            throw new Error(
                'kaputt: postgres://nutzer:pg-geheim@db.example/main und kv-token-geheim',
            );
        }),
        groqFetch: spies.makeGroqFetch(async () => {
            throw new Error('Groq abgelehnt für gsk-groq-geheim');
        }),
    });

    assertKeineSecrets(spies, 'Feed- und Groq-Fehler');
});

test('ein SQL-Fehler mit Verbindungszeichenfolge landet in keiner Ausgabe', async () => {
    // Der gefährlichste Fall: POSTGRES_URL steht vollständig im Fehlertext und
    // wurde vorher als rohes Error-Objekt geloggt.
    const spies = createSpies({
        sqlError: new Error('connect ECONNREFUSED postgres://nutzer:pg-geheim@db.example/main'),
    });

    await runMain(spies, { fetchImpl: feedFetch(spies) });

    assert.deepEqual(spies.exitCodes, [1]);
    assertKeineSecrets(spies, 'SQL-Fehler');
    assert.ok(
        spies.logLines.some(line => line.includes('Fatal error in fetch script')),
        'der Abbruch wird trotzdem gemeldet',
    );
});

test('ein KV-Lesefehler landet in keiner Ausgabe', async () => {
    const spies = createSpies();
    spies.store.get = async () => {
        throw new Error('KV offline: https://kv.example/pipeline?token=kv-token-geheim');
    };

    await runMain(spies, { fetchImpl: feedFetch(spies) });

    assert.deepEqual(spies.exitCodes, [1]);
    assertKeineSecrets(spies, 'KV-Lesefehler');
});

test('ein Proxyfehler einer freigegebenen Quelle landet in keiner Ausgabe', async () => {
    // Der Retry-Pfad in feed-fetch-utils.js loggte den Fehlertext bisher roh.
    const spies = createSpies({ feeds: [GAMEPRO_ROW] });

    await runMain(spies, {
        fetchImpl: spies.makeFetchImpl(async url => {
            if (url.includes('proxy.example')) {
                throw new Error('Proxy kaputt: https://proxy.example/x.php?key=proxy-geheim');
            }
            return new Response('Forbidden', { status: 403 });
        }),
    });

    assertKeineSecrets(spies, 'Proxyfehler');
});

test('ein Scrape-Fehler landet in keiner Ausgabe', async () => {
    const spies = createSpies();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Quelle</title>
<item><title>Ohne Bild</title><link>https://www.gamestar.de/a1</link><pubDate>Sat, 25 Jul 2026 18:37:34 +0000</pubDate></item>
</channel></rss>`;

    await runMain(spies, {
        // Der Feed liefert Artikel ohne Bild; der Scrape-Versuch scheitert mit
        // einem Fehlertext, der ein Secret mitführt.
        fetchImpl: spies.makeFetchImpl(async url => {
            if (url.includes('/a1')) {
                throw new Error('Scrape kaputt: kv-token-geheim');
            }
            return new Response(xml, { status: 200 });
        }),
    });

    assertKeineSecrets(spies, 'Scrape-Fehler');
});

test('ein Trendfehler landet in keiner Ausgabe und bleibt folgenlos', async () => {
    const spies = createSpies();

    await runMain(spies, {
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(async () => {
            throw new Error('Groq abgelehnt: Bearer gsk-groq-geheim');
        }),
    });

    assert.deepEqual(spies.exitCodes, [], 'der Kernlauf bleibt erfolgreich');
    assert.equal(spies.kvStore.feed_run_status.result, 'success');
    assertKeineSecrets(spies, 'Trendfehler');
});

test('auch Warnungen des echten Recorders landen nur im injizierten Logger', async () => {
    // Bewusst der echte createFeedRunRecorder statt der Attrappe: nur er zeigt,
    // ob main() ihm den Logger überhaupt mitgibt. Ohne Weitergabe fällt er auf
    // `console` zurück und seine Warnungen laufen an der Injektion vorbei.
    const spies = createSpies();

    // Nur der Feed-Status ist unlesbar. Der Recorder gilt seinen Vorzustand
    // damit als unbekannt und warnt beim Schreiben - der reproduzierte Fall.
    const echterGet = spies.store.get;
    spies.store.get = async key => {
        if (key === 'feed_health_status') {
            throw new Error('KV offline für kv-token-geheim');
        }
        return echterGet(key);
    };

    const original = { log: console.log, warn: console.warn, error: console.error };
    const globaleAusgaben = [];
    console.log = (...args) => globaleAusgaben.push(args.map(String).join(' '));
    console.warn = console.log;
    console.error = console.log;

    try {
        await runMain(spies, {
            createRecorder: createFeedRunRecorder,
            fetchImpl: feedFetch(spies),
        });
    } finally {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
    }

    assert.ok(
        spies.logLines.some(line => line.includes('Feed-Status wird nicht geschrieben')),
        'die Recorder-Warnung muss im injizierten Logger auftauchen',
    );
    assert.deepEqual(globaleAusgaben, [], 'der Recorder schreibt nicht an der Injektion vorbei');
    assertKeineSecrets(spies, 'echter Recorder');
});

test('die Ausgabe des Laufs geht ausschließlich über den injizierten Logger', async () => {
    // Ohne diese Zusage würden globale console-Aufrufe an jedem Secret-Test
    // vorbeilaufen - genau das war vorher der Fall.
    const spies = createSpies();
    const original = { log: console.log, warn: console.warn, error: console.error };
    const globaleAusgaben = [];
    console.log = (...args) => globaleAusgaben.push(args.map(String).join(' '));
    console.warn = console.log;
    console.error = console.log;

    try {
        await runMain(spies, {
            fetchImpl: spies.makeFetchImpl(async () => {
                throw new Error('kaputt: postgres://nutzer:pg-geheim@db.example/main');
            }),
        });
    } finally {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
    }

    assert.deepEqual(globaleAusgaben, [], 'der Lauf schreibt nicht an der Injektion vorbei');
    assert.ok(spies.logLines.length > 0, 'stattdessen landet alles im injizierten Logger');
});

// === Reihenfolge ===

test('die Vorprüfung läuft vor Recorder, KV und SQL', async () => {
    const spies = createSpies();

    await runMain(spies, {
        fetchImpl: feedFetch(spies),
        groqFetch: spies.makeGroqFetch(async () => new Response(
            JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
            { status: 200 },
        )),
    });

    // Bei gültiger Konfiguration läuft alles in der erwarteten Reihenfolge an.
    assert.equal(spies.recorderCalls[0], 'created');
    assert.equal(spies.recorderCalls[1], 'begin');
    assert.equal(spies.recorderCalls[2], 'loadPreviousState');
    assert.ok(spies.recorderCalls.indexOf('markFeedListLoaded') > 0);
    assert.equal(spies.recorderCalls.at(-1), 'finish');
});

test('ein einzelnes fehlerhaftes Item verwirft den Feed nicht', async () => {
    const spies = createSpies();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Quelle</title>
<item><title>Gut</title><link>https://www.gamestar.de/a1</link><pubDate>Sat, 25 Jul 2026 18:37:34 +0000</pubDate></item>
<item><title>Kaputtes Datum</title><link>https://www.gamestar.de/a2</link><pubDate>irgendwann</pubDate></item>
<item><title>Auch gut</title><link>https://www.gamestar.de/a3</link><pubDate>Sun, 26 Jul 2026 09:00:00 +0000</pubDate></item>
</channel></rss>`;

    await runMain(spies, {
        fetchImpl: feedFetch(spies, { xml }),
        groqFetch: spies.makeGroqFetch(async () => new Response(
            JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
            { status: 200 },
        )),
    });

    const newsCache = spies.kvSets.find(entry => entry.key === 'news_cache');
    assert.equal(newsCache.value.length, 2, 'die gültigen Artikel bleiben erhalten');

    const health = spies.kvStore.feed_health_status;
    assert.equal(health.gamestar.status, 'success');
    assert.equal(health.gamestar.skippedItemCount, 1);
    assert.match(health.gamestar.message, /invalid_date: 1/);
});

// === GitHub-Step-Summary (O4a) ===============================================
//
// Der Bericht ist reine Beobachtbarkeit. Geprüft wird gegen das echte `main()`
// mit injizierten Außenkanten - insbesondere, dass er nichts am Ergebnis ändert.

/** Sammelt die Schreibversuche der Zusammenfassung. */
function summaryWriter({ fail = false } = {}) {
    const versuche = [];
    return {
        versuche,
        get markdown() {
            return versuche.map(eintrag => eintrag.markdown).join('\n');
        },
        writeSummary: async (path, markdown) => {
            versuche.push({ path, markdown });
            if (fail) {
                // So sieht ein echter Fehler aus: die vollständige
                // Verbindungszeichenfolge, nicht ein bloßes Token.
                throw new Error('ENOSPC while writing postgres://nutzer:pg-geheim@db.example/main');
            }
        },
    };
}

const SUMMARY_ENV = Object.freeze({
    ...VOLLSTAENDIGE_ENV,
    GITHUB_STEP_SUMMARY: '/tmp/step-summary.md',
});

test('ein erfolgreicher Lauf schreibt eine Zusammenfassung mit Ergebnis und Snapshot', async () => {
    const spies = createSpies();
    const writer = summaryWriter();

    await runMain(spies, {
        env: SUMMARY_ENV,
        createRecorder: createFeedRunRecorder,
        fetchImpl: feedFetch(spies),
        writeSummary: writer.writeSummary,
    });

    assert.equal(writer.versuche.length, 1, 'genau ein Schreibvorgang');
    assert.equal(writer.versuche[0].path, '/tmp/step-summary.md');

    const markdown = writer.markdown;
    assert.match(markdown, /GamerFeed-Lauf/);
    assert.match(markdown, /success/);
    assert.match(markdown, /Aktive Generation/);
    assert.match(markdown, /\| GameStar \|/, 'die Quelle steht in der Tabelle');
    assert.match(markdown, /\bdirect\b/, 'der Direktabruf wird als Transport genannt');
    assert.match(markdown, /Fehlerquote/);
    assert.deepEqual(spies.exitCodes, [], 'ein erfolgreicher Lauf endet ohne Exit-Code');
});

test('die Zusammenfassung nennt weder Feed-Adressen noch Secrets', async () => {
    const spies = createSpies();
    const writer = summaryWriter();

    await runMain(spies, {
        env: SUMMARY_ENV,
        createRecorder: createFeedRunRecorder,
        fetchImpl: feedFetch(spies),
        writeSummary: writer.writeSummary,
    });

    const markdown = writer.markdown;
    for (const secret of ALLE_SECRETS) {
        assert.doesNotMatch(markdown, new RegExp(secret), `${secret} steht in der Zusammenfassung`);
    }
    assert.doesNotMatch(markdown, /https?:\/\//, 'keine Adressen in der Zusammenfassung');
    assert.doesNotMatch(markdown, /Erster Artikel/, 'keine Artikeltitel');
});

test('ein erfolgreicher Proxy-Abruf erscheint als Transport proxy', async () => {
    const spies = createSpies({ feeds: [GAMEPRO_ROW] });
    const writer = summaryWriter();

    await runMain(spies, {
        env: SUMMARY_ENV,
        createRecorder: createFeedRunRecorder,
        fetchImpl: spies.makeFetchImpl(async url => (
            url.includes('proxy.example')
                ? new Response(rssFeed(), { status: 200 })
                : new Response('blocked', { status: 403 })
        )),
        writeSummary: writer.writeSummary,
    });

    assert.match(writer.markdown, /\| GamePro \| success \|[^|]*\|[^|]*\|[^|]*\| proxy \| 200 \|/);
});

test('ein endgültiger Abruffehler erscheint mit Transport none und seinem Status', async () => {
    const spies = createSpies();
    const writer = summaryWriter();

    await runMain(spies, {
        env: SUMMARY_ENV,
        createRecorder: createFeedRunRecorder,
        fetchImpl: spies.makeFetchImpl(async () => new Response('kaputt', { status: 500 })),
        writeSummary: writer.writeSummary,
    });

    assert.match(writer.markdown, /\| GameStar \| error \|[^|]*\|[^|]*\|[^|]*\| none \| 500 \|/);
});

test('ohne GITHUB_STEP_SUMMARY entsteht kein Schreibversuch', async () => {
    const spies = createSpies();
    const writer = summaryWriter();

    await runMain(spies, {
        createRecorder: createFeedRunRecorder,
        fetchImpl: feedFetch(spies),
        writeSummary: writer.writeSummary,
    });

    assert.deepEqual(writer.versuche, [], 'kein Schreibversuch ohne gesetzten Pfad');
    assert.deepEqual(spies.exitCodes, []);
});

test('ein Schreibfehler der Zusammenfassung ändert Ergebnis und Exit-Code nicht', async () => {
    const spies = createSpies();
    const writer = summaryWriter({ fail: true });

    await runMain(spies, {
        env: SUMMARY_ENV,
        createRecorder: createFeedRunRecorder,
        fetchImpl: feedFetch(spies),
        writeSummary: writer.writeSummary,
    });

    assert.deepEqual(spies.exitCodes, [], 'der Lauf bleibt erfolgreich');
    assert.equal(spies.kvStore.feed_run_status.result, 'success');

    const warnung = spies.logLines.find(line => line.includes('Zusammenfassung'));
    assert.ok(warnung, 'der Fehlschlag wird protokolliert');
    assert.doesNotMatch(warnung, /pg-geheim/, 'auch die Warnung bleibt bereinigt');
});

test('auch ein fataler Abbruch bekommt eine Zusammenfassung, ohne den Exit-Code zu ändern', async () => {
    const spies = createSpies({
        // So sieht ein echter Fehler aus: die vollstaendige
        // Verbindungszeichenfolge, nicht ein blosses Token.
        sqlError: new Error('connect ECONNREFUSED postgres://nutzer:pg-geheim@db.example/main'),
    });
    const writer = summaryWriter();

    await runMain(spies, {
        env: SUMMARY_ENV,
        createRecorder: createFeedRunRecorder,
        fetchImpl: feedFetch(spies),
        writeSummary: writer.writeSummary,
    });

    assert.deepEqual(spies.exitCodes, [1], 'der Abbruch bleibt ein Abbruch');
    assert.equal(writer.versuche.length, 1);
    assert.match(writer.markdown, /fatal/);
    assert.doesNotMatch(writer.markdown, /pg-geheim/);
    assert.doesNotMatch(writer.markdown, /Aktive Generation/, 'ohne Publish gibt es keine Generation');
    assert.match(writer.markdown, /Kein Kern-Publish/);
});

test('ein Schreibfehler im Fatalpfad überdeckt den ursprünglichen Fehler nicht', async () => {
    const spies = createSpies({
        // So sieht ein echter Fehler aus: die vollstaendige
        // Verbindungszeichenfolge, nicht ein blosses Token.
        sqlError: new Error('connect ECONNREFUSED postgres://nutzer:pg-geheim@db.example/main'),
    });
    const writer = summaryWriter({ fail: true });

    await runMain(spies, {
        env: SUMMARY_ENV,
        createRecorder: createFeedRunRecorder,
        fetchImpl: feedFetch(spies),
        writeSummary: writer.writeSummary,
    });

    assert.deepEqual(spies.exitCodes, [1]);
    assert.equal(spies.kvStore.feed_run_status.result, 'fatal');
});

// === Zusammenfassung auch bei gescheiterter Vorprüfung ========================
//
// „Jeder Lauf bekommt eine Zusammenfassung" muss auch für den Fatalfall gelten,
// der noch vor Recorder und Feed-Liste greift. Sie bleibt dabei minimal: es gibt
// schlicht nichts zu berichten außer dem Konfigurationsfehler.

test('ein fehlendes Core-Secret erzeugt trotzdem genau eine fatale Zusammenfassung', async () => {
    for (const key of ['POSTGRES_URL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) {
        const spies = createSpies();
        const writer = summaryWriter();
        const env = { ...SUMMARY_ENV };
        delete env[key];

        await runMain(spies, {
            env,
            groqFetch: spies.makeGroqFetch(),
            writeSummary: writer.writeSummary,
        });

        assert.deepEqual(spies.exitCodes, [1], `${key}: der Lauf endet fatal`);
        assert.equal(writer.versuche.length, 1, `${key}: genau ein Schreibversuch`);

        // Die Vorprüfung bleibt vor jedem externen Zugriff.
        assert.equal(spies.sqlQueries.length, 0, `${key}: kein SQL`);
        assert.equal(spies.kvGets.length, 0, `${key}: kein KV-Lesen`);
        assert.equal(spies.kvSets.length, 0, `${key}: kein KV-Schreiben`);
        assert.equal(spies.recorderCalls.length, 0, `${key}: kein Recorder`);
        assert.equal(spies.fetchCalls.length, 0, `${key}: kein HTTP`);
        assert.equal(spies.groqCalls.length, 0, `${key}: kein Groq`);

        const markdown = writer.markdown;
        assert.match(markdown, /fatal/, `${key}: das Ergebnis steht drin`);
        assert.match(markdown, new RegExp(key), `${key}: der Variablenname steht drin`);
        for (const secret of ALLE_SECRETS) {
            assert.doesNotMatch(markdown, new RegExp(secret), `${key}: ${secret} steht in der Ausgabe`);
        }
    }
});

test('die Zusammenfassung der Vorprüfung erfindet weder Feeds noch Snapshot', async () => {
    const spies = createSpies();
    const writer = summaryWriter();
    const env = { ...SUMMARY_ENV };
    delete env.POSTGRES_URL;

    await runMain(spies, { env, groqFetch: spies.makeGroqFetch(), writeSummary: writer.writeSummary });

    const markdown = writer.markdown;
    assert.doesNotMatch(markdown, /### Quellen/, 'keine Quellentabelle ohne Feed-Liste');
    assert.doesNotMatch(markdown, /### Feeds/, 'keine erfundenen Feed-Zähler');
    assert.doesNotMatch(markdown, /Aktive Generation/, 'kein Snapshot');
    assert.doesNotMatch(markdown, /Fehlerquote/, 'keine Quote ohne bewertete Feeds');
    assert.match(markdown, /Vorprüfung/, 'der Grund ist benannt');
});

test('ein nur aus Leerzeichen bestehender Core-Wert verhält sich genauso', async () => {
    const spies = createSpies();
    const writer = summaryWriter();

    await runMain(spies, {
        env: { ...SUMMARY_ENV, POSTGRES_URL: '   ' },
        groqFetch: spies.makeGroqFetch(),
        writeSummary: writer.writeSummary,
    });

    assert.deepEqual(spies.exitCodes, [1]);
    assert.equal(spies.recorderCalls.length, 0);
    assert.equal(writer.versuche.length, 1);
    assert.match(writer.markdown, /POSTGRES_URL/);
});

test('ein Writer-Fehler in der Vorprüfung ändert Exit-Code und Reihenfolge nicht', async () => {
    const spies = createSpies();
    const writer = summaryWriter({ fail: true });
    // Bewusst nicht POSTGRES_URL: dessen Wert ist dann gar nicht konfiguriert
    // und kann deshalb auch nicht bereinigt werden. Der Test prüft die
    // Bereinigung, also muss die Variable gesetzt bleiben.
    const env = { ...SUMMARY_ENV };
    delete env.KV_REST_API_URL;

    await runMain(spies, { env, groqFetch: spies.makeGroqFetch(), writeSummary: writer.writeSummary });

    assert.deepEqual(spies.exitCodes, [1], 'der Lauf endet weiterhin fatal');
    assert.equal(spies.recorderCalls.length, 0, 'die Vorprüfung bleibt vor dem Recorder');
    assert.equal(spies.sqlQueries.length, 0);
    assert.equal(spies.kvSets.length, 0);

    const warnung = spies.logLines.find(line => line.includes('Zusammenfassung'));
    assert.ok(warnung, 'der Fehlschlag wird protokolliert');
    assert.doesNotMatch(warnung, /pg-geheim/);
});

test('ohne GITHUB_STEP_SUMMARY schreibt auch die Vorprüfung nichts', async () => {
    const spies = createSpies();
    const writer = summaryWriter();
    const env = { ...VOLLSTAENDIGE_ENV };
    delete env.POSTGRES_URL;

    await runMain(spies, { env, groqFetch: spies.makeGroqFetch(), writeSummary: writer.writeSummary });

    assert.deepEqual(spies.exitCodes, [1]);
    assert.deepEqual(writer.versuche, []);
});

test('ein Abbruch nach geladener Feed-Liste erfindet für unbearbeitete Quellen keine Null', async () => {
    // Der Lauf bricht nach der ersten Quelle ab. GamePro wurde dadurch nie
    // angefasst und steht noch auf `unknown`; seine Items hat niemand
    // untersucht. „0 übersprungen" wäre eine unbelegte Aussage.
    const spies = createSpies({ feeds: [FEED_ROW, GAMEPRO_ROW] });
    const writer = summaryWriter();

    await runMain(spies, {
        env: SUMMARY_ENV,
        createRecorder: createFeedRunRecorder,
        fetchImpl: feedFetch(spies),
        // Die Höflichkeitspause nach der ersten Quelle beendet den Lauf.
        sleep: async () => {
            throw new Error('Abbruch nach der ersten Quelle');
        },
        writeSummary: writer.writeSummary,
    });

    assert.deepEqual(spies.exitCodes, [1]);

    const zeile = writer.markdown.split('\n').find(line => line.startsWith('| GamePro |'));
    assert.ok(zeile, 'die nie bearbeitete Quelle steht in der Tabelle');
    assert.match(zeile, /\| unknown \|/, 'sie ist als unbewertet erkennbar');
    assert.doesNotMatch(zeile, /\| 0 \|/, 'keine erfundene Null für nie untersuchte Items');
    assert.match(zeile, /\| – \| – \| – \|/, 'Dauer, Artikel und Übersprungene bleiben leer');
});
