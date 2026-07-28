// Gemeinsame Attrappen fuer die Integrationstests des Cron-Laufs.
//
// Kein Test dieser Suite darf eine echte Datenbank, einen echten KV-Speicher,
// einen echten Feed, Groq, das Hosting oder eine echte Wartezeit beruehren.
// Diese Datei buendelt deshalb alle Aussenkanten von `main()` an einer Stelle:
// SQL, KV, Netz, Groq, Exit und Logger.
//
// Sie liegt bewusst unter `helpers/` und nicht als `*.test.js`, damit der
// Runner sie nicht selbst als Testdatei startet.

export const VOLLSTAENDIGE_ENV = Object.freeze({
    POSTGRES_URL: 'postgres://nutzer:pg-geheim@db.example/main',
    KV_REST_API_URL: 'https://kv.example',
    KV_REST_API_TOKEN: 'kv-token-geheim',
    GROQ_API_KEY: 'gsk-groq-geheim',
    FEED_PROXY_URL: 'https://proxy.example/feed-proxy.php?key=proxy-geheim',
});

export const ALLE_SECRETS = Object.freeze([
    'pg-geheim',
    'kv-token-geheim',
    'gsk-groq-geheim',
    'proxy-geheim',
]);

export const FEED_ROW = Object.freeze({
    id: 'gamestar',
    name: 'GameStar',
    url: 'https://www.gamestar.de/feed.xml',
    language: 'de',
    priority: 'primary',
    needs_scraping: false,
});

export const GAMEPRO_ROW = Object.freeze({
    id: 'gamepro',
    name: 'GamePro',
    url: 'https://www.gamepro.de/feed.xml',
    language: 'de',
    priority: 'primary',
    needs_scraping: false,
});

export function rssFeed(titel = 'Erster Artikel') {
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

export function createSpies({ feeds = [FEED_ROW], sqlError = null } = {}) {
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
            async finish({ durations, result = 'success', degradedReason = null }) {
                recorderCalls.push('finish');
                await options.store.set('feed_run_status', { result, degradedReason, durations });
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
export function feedFetch(spies, { xml = rssFeed(), status = 200 } = {}) {
    return spies.makeFetchImpl(async () => new Response(xml, { status }));
}

// Gestellter Resolver: die Outbound-Policy prüft jedes Ziel vor dem Abruf, die
// Testadressen existieren im DNS aber nicht.
export const lookupStub = async () => [{ address: '93.184.216.34', family: 4 }];

/**
 * Startet `main()` mit vollständig injizierten Aussenkanten.
 *
 * @param {(options: object) => Promise<unknown>} main
 * @param {ReturnType<typeof createSpies>} spies
 * @param {object} [overrides]
 */
export async function runMain(main, spies, overrides = {}) {
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
