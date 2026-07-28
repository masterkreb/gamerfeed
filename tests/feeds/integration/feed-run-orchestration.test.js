import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../scripts/fetch-feeds.js';

// Der komplette Lauf gegen Attrappen: keine Datenbank, kein KV, kein Netz.
// Geprüft wird vor allem die Reihenfolge - insbesondere, dass eine
// gescheiterte Vorprüfung *vor* jedem externen Zugriff greift.

const VOLLSTAENDIGE_ENV = Object.freeze({
    POSTGRES_URL: 'postgres://nutzer:pg-geheim@db.example/main',
    KV_REST_API_URL: 'https://kv.example',
    KV_REST_API_TOKEN: 'kv-token-geheim',
    GROQ_API_KEY: 'gsk-groq-geheim',
    FEED_PROXY_URL: 'https://proxy.example/feed-proxy.php?key=proxy-geheim',
});

const FEED_ROW = Object.freeze({
    id: 'gamestar',
    name: 'GameStar',
    url: 'https://www.gamestar.de/feed.xml',
    language: 'de',
    priority: 'primary',
    needs_scraping: false,
});

const GAMEPRO_ROW = Object.freeze({
    id: 'gamepro',
    name: 'GamePro',
    url: 'https://www.gamepro.de/feed.xml',
    language: 'de',
    priority: 'primary',
    needs_scraping: false,
});

function rssFeed(titel = 'Erster Artikel') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Quelle</title>
<item>
  <title>${titel}</title>
  <link>https://www.gamestar.de/a1</link>
  <guid isPermaLink="false">a1</guid>
  <pubDate>Sat, 25 Jul 2026 18:37:34 +0000</pubDate>
  <description><![CDATA[<p>Text</p>]]></description>
</item>
</channel></rss>`;
}

function createSpies({ feeds = [FEED_ROW], sqlError = null } = {}) {
    const kvGets = [];
    const kvSets = [];
    const sqlQueries = [];
    const fetchCalls = [];
    const groqCalls = [];
    const recorderCalls = [];
    const logLines = [];
    const exitCodes = [];
    const kvStore = {};

    const store = {
        async get(key) {
            kvGets.push(key);
            return Object.hasOwn(kvStore, key) ? kvStore[key] : null;
        },
        async set(key, value) {
            kvSets.push({ key, value });
            kvStore[key] = value;
            return 'OK';
        },
        async del(key) {
            delete kvStore[key];
            return 1;
        },
    };

    const database = async (strings, ...values) => {
        sqlQueries.push({ text: strings.join('?'), values });
        if (sqlError) throw sqlError;
        return { rows: feeds };
    };

    // Der Recorder wird mitgezählt: auch er schreibt nach KV.
    const createRecorder = options => {
        recorderCalls.push('created');
        return {
            runId: 'test-run',
            startedAt: '2026-07-28T12:00:00.000Z',
            async begin() {
                recorderCalls.push('begin');
                await options.store.set('feed_run_status', { result: 'running' });
            },
            async loadPreviousState() {
                recorderCalls.push('loadPreviousState');
                await options.store.get('feed_health_status');
                return { health: {}, publish: null };
            },
            lastSuccessAtFor: () => null,
            markFeedListLoaded() {
                recorderCalls.push('markFeedListLoaded');
            },
            async recordCorePublish({ feedHealth }) {
                recorderCalls.push('recordCorePublish');
                await options.store.set('feed_health_status', feedHealth);
                const publish = {
                    lastCorePublishAt: '2026-07-28T12:01:00.000Z',
                    lastContentUpdateAt: '2026-07-28T12:01:00.000Z',
                    feeds: { success: 1, total: 1 },
                };
                await options.store.set('feed_publish_status', publish);
                return publish;
            },
            async finish({ durations }) {
                recorderCalls.push('finish');
                await options.store.set('feed_run_status', { result: 'success', durations });
            },
            async recordFatal({ error }) {
                recorderCalls.push('recordFatal');
                await options.store.set('feed_run_status', {
                    result: 'fatal',
                    fatalError: options.redact(error?.message ?? String(error)),
                });
            },
        };
    };

    return {
        kvGets, kvSets, sqlQueries, fetchCalls, groqCalls, recorderCalls, logLines, exitCodes, kvStore,
        store,
        database,
        createRecorder,
        exit: code => {
            exitCodes.push(code);
            return code;
        },
        logger: {
            log: line => logLines.push(String(line)),
            warn: line => logLines.push(String(line)),
            error: (...args) => logLines.push(args.map(String).join(' ')),
        },
        /** Netzabruf der Feeds und Artikelseiten. */
        makeFetchImpl(handler) {
            return async (url, init) => {
                fetchCalls.push({ url: String(url), init });
                return handler(String(url), init);
            };
        },
        makeGroqFetch(handler = async () => {
            throw new Error('Groq sollte nicht aufgerufen werden');
        }) {
            return async (url, init) => {
                groqCalls.push({ url: String(url), init });
                return handler(url, init);
            };
        },
    };
}

/** Standardablauf: ein Feed liefert gültiges RSS. */
function feedFetch(spies, { xml = rssFeed(), status = 200 } = {}) {
    return spies.makeFetchImpl(async () => new Response(xml, { status }));
}

// Gestellter Resolver: die Outbound-Policy prüft jedes Ziel vor dem Abruf, die
// Testadressen existieren im DNS aber nicht.
const lookupStub = async () => [{ address: '93.184.216.34', family: 4 }];

async function runMain(spies, overrides = {}) {
    return main({
        env: VOLLSTAENDIGE_ENV,
        store: spies.store,
        database: spies.database,
        createRecorder: spies.createRecorder,
        exit: spies.exit,
        logger: spies.logger,
        lookup: lookupStub,
        // Sicherheitsnetz: ohne ausdrücklichen fetchImpl würde main() den echten
        // Transport verwenden. Diese Attrappe fällt statt dessen auf.
        fetchImpl: spies.makeFetchImpl(async url => {
            throw new Error(`unerwarteter Netzzugriff auf ${url}`);
        }),
        groqFetch: spies.makeGroqFetch(),
        ...overrides,
    });
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

const ALLE_SECRETS = ['pg-geheim', 'kv-token-geheim', 'gsk-groq-geheim', 'proxy-geheim'];

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
