import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CORE_ENV_KEYS,
    checkCoreConfiguration,
    describeMissingCoreConfiguration,
    readCoreDeadlineMs,
    readFeedRunConfiguration,
    readOptionalGroqKey,
    readOptionalProxyUrl,
    readScrapeLimit,
} from '../../../scripts/feed-run-config.js';
import {
    CORE_DEADLINE_MS,
    MAX_ARTICLE_PAGE_FETCHES_PER_RUN,
    MAX_CORE_DEADLINE_MS,
    MIN_CORE_DEADLINE_MS,
} from '../../../scripts/feed-run-budget.js';

const VOLLSTAENDIG = Object.freeze({
    POSTGRES_URL: 'postgres://nutzer:geheim@db.example/main',
    KV_REST_API_URL: 'https://kv.example',
    KV_REST_API_TOKEN: 'kv-token-geheim',
    GROQ_API_KEY: 'gsk_geheim',
    FEED_PROXY_URL: 'https://proxy.example/feed-proxy.php',
});

test('die Core-Liste umfasst genau die drei Pflichtwerte', () => {
    assert.deepEqual([...CORE_ENV_KEYS], ['POSTGRES_URL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']);
});

test('eine vollständige Konfiguration ist in Ordnung', () => {
    const { ok, missingCore, groqApiKey, feedProxyUrl, skipped } = readFeedRunConfiguration(VOLLSTAENDIG);

    assert.equal(ok, true);
    assert.deepEqual(missingCore, []);
    assert.equal(groqApiKey, 'gsk_geheim');
    assert.equal(feedProxyUrl, 'https://proxy.example/feed-proxy.php');
    assert.deepEqual(skipped, []);
});

test('jeder einzelne fehlende Core-Wert wird erkannt', () => {
    for (const key of CORE_ENV_KEYS) {
        const env = { ...VOLLSTAENDIG };
        delete env[key];

        const { ok, missingCore } = readFeedRunConfiguration(env);

        assert.equal(ok, false, key);
        assert.deepEqual(missingCore, [key]);
    }
});

test('Leerzeichen gelten nicht als gültiger Wert', () => {
    // Ein versehentlich als " " gesetztes GitHub-Secret ist genauso unbrauchbar
    // wie ein fehlendes, würde aber jede Truthiness-Prüfung bestehen.
    for (const wert of ['', '   ', '\t', '\n']) {
        const { ok, missingCore } = readFeedRunConfiguration({
            ...VOLLSTAENDIG,
            KV_REST_API_TOKEN: wert,
        });

        assert.equal(ok, false, JSON.stringify(wert));
        assert.deepEqual(missingCore, ['KV_REST_API_TOKEN']);
    }
});

test('Werte, die keine Strings sind, gelten als fehlend', () => {
    for (const wert of [null, undefined, 42, true, {}, []]) {
        assert.equal(
            checkCoreConfiguration({ ...VOLLSTAENDIG, POSTGRES_URL: wert }).ok,
            false,
            String(wert),
        );
    }
});

test('mehrere fehlende Werte werden gemeinsam gemeldet', () => {
    const { missingCore } = readFeedRunConfiguration({ GROQ_API_KEY: 'gsk_geheim' });

    assert.deepEqual(missingCore, ['POSTGRES_URL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']);
});

test('die Fehlermeldung nennt nur Namen, niemals Werte', () => {
    const { fatalMessage } = readFeedRunConfiguration({
        ...VOLLSTAENDIG,
        KV_REST_API_TOKEN: '',
    });

    assert.match(fatalMessage, /KV_REST_API_TOKEN/);
    assert.doesNotMatch(fatalMessage, /geheim/);
    assert.doesNotMatch(fatalMessage, /postgres:\/\//);
    assert.doesNotMatch(fatalMessage, /kv\.example/);

    assert.match(describeMissingCoreConfiguration(['POSTGRES_URL']), /vor dem ersten externen Zugriff/);
});

// === Optionale Werte ===

test('ein fehlender Groq-Schlüssel verhindert den Lauf nicht', () => {
    const env = { ...VOLLSTAENDIG };
    delete env.GROQ_API_KEY;

    const { ok, groqApiKey, skipped } = readFeedRunConfiguration(env);

    assert.equal(ok, true);
    assert.equal(groqApiKey, null);
    assert.deepEqual(skipped, ['GROQ_API_KEY ist nicht gesetzt']);
});

test('ein leerer Groq-Schlüssel zählt als nicht gesetzt', () => {
    assert.deepEqual(readOptionalGroqKey({ GROQ_API_KEY: '   ' }), {
        value: null,
        skipReason: 'GROQ_API_KEY ist nicht gesetzt',
    });
});

test('eine fehlende Proxy-Adresse verhindert den Lauf nicht', () => {
    const env = { ...VOLLSTAENDIG };
    delete env.FEED_PROXY_URL;

    const { ok, feedProxyUrl, skipped } = readFeedRunConfiguration(env);

    assert.equal(ok, true);
    assert.equal(feedProxyUrl, null);
    assert.deepEqual(skipped, ['FEED_PROXY_URL ist nicht gesetzt']);
});

test('eine unbrauchbare Proxy-Adresse wird verworfen, nicht verwendet', () => {
    for (const adresse of [
        'kein-schema',
        'javascript:alert(1)',
        'file:///etc/passwd',
        'https://nutzer:geheim@proxy.example/feed-proxy.php',
        'http://proxy.example/feed-proxy.php',
    ]) {
        const { ok, feedProxyUrl, skipped } = readFeedRunConfiguration({
            ...VOLLSTAENDIG,
            FEED_PROXY_URL: adresse,
        });

        assert.equal(ok, true, `${adresse} darf den Kernlauf nicht verhindern`);
        assert.equal(feedProxyUrl, null, adresse);
        assert.equal(skipped.length, 1, adresse);
    }
});

test('die Begründung einer verworfenen Proxy-Adresse enthält die Adresse nicht', () => {
    // FEED_PROXY_URL ist ein GitHub-Secret; die Adresse selbst gehört in keine
    // Meldung, auch nicht in eine Fehlermeldung.
    const { skipped } = readFeedRunConfiguration({
        ...VOLLSTAENDIG,
        FEED_PROXY_URL: 'https://nutzer:geheim@versteckter-proxy.example/pfad?token=abc',
    });

    const begruendung = skipped.join(' ');
    assert.doesNotMatch(begruendung, /versteckter-proxy/);
    assert.doesNotMatch(begruendung, /geheim|token=abc/);
});

test('http wird als stiller Downgrade abgelehnt', () => {
    assert.deepEqual(readOptionalProxyUrl({ FEED_PROXY_URL: 'http://proxy.example/x.php' }), {
        value: null,
        skipReason: 'FEED_PROXY_URL muss https verwenden',
    });
});

test('bei fehlender Core-Konfiguration werden optionale Werte gar nicht erst gelesen', () => {
    const { groqApiKey, feedProxyUrl, skipped } = readFeedRunConfiguration({
        GROQ_API_KEY: 'gsk_geheim',
        FEED_PROXY_URL: 'https://proxy.example/x.php',
    });

    assert.equal(groqApiKey, null);
    assert.equal(feedProxyUrl, null);
    assert.deepEqual(skipped, []);
});

// === Zeit- und Scrape-Budget (O2b) ===

test('ohne Angabe gelten die dokumentierten Vorgaben', () => {
    const { coreDeadlineMs, scrapeLimit, skipped } = readFeedRunConfiguration(VOLLSTAENDIG);

    assert.equal(coreDeadlineMs, CORE_DEADLINE_MS);
    assert.equal(scrapeLimit, MAX_ARTICLE_PAGE_FETCHES_PER_RUN);
    assert.deepEqual(skipped, []);
});

test('eine gueltige Deadline aus der Umgebung wird uebernommen', () => {
    assert.deepEqual(readCoreDeadlineMs({ FEED_CORE_DEADLINE_MS: ' 600000 ' }), {
        value: 600_000,
        skipReason: null,
    });
});

test('die Grenzen des erlaubten Deadline-Bereichs gelten beidseitig', () => {
    assert.equal(readCoreDeadlineMs({ FEED_CORE_DEADLINE_MS: String(MIN_CORE_DEADLINE_MS) }).value, MIN_CORE_DEADLINE_MS);
    assert.equal(readCoreDeadlineMs({ FEED_CORE_DEADLINE_MS: String(MAX_CORE_DEADLINE_MS) }).value, MAX_CORE_DEADLINE_MS);
});

test('eine unbrauchbare Deadline faellt auf die Vorgabe zurueck, statt sie abzuschalten', () => {
    // Der gefaehrliche Fall: eine kaputte Zahl darf weder eine unbegrenzte noch
    // eine absurd kurze Laufzeit ergeben.
    for (const wert of ['keine-zahl', '0', '1.5', String(MAX_CORE_DEADLINE_MS + 1), '-5000']) {
        const { value, skipReason } = readCoreDeadlineMs({ FEED_CORE_DEADLINE_MS: wert });
        assert.equal(value, CORE_DEADLINE_MS, `${wert}: die Vorgabe bleibt`);
        assert.match(skipReason, /FEED_CORE_DEADLINE_MS/);
    }
});

test('das Scrape-Limit wird ebenso geprueft und darf null sein', () => {
    assert.equal(readScrapeLimit({ FEED_SCRAPE_LIMIT: '0' }).value, 0);
    assert.equal(readScrapeLimit({ FEED_SCRAPE_LIMIT: '25' }).value, 25);
    assert.equal(readScrapeLimit({ FEED_SCRAPE_LIMIT: '5000' }).value, MAX_ARTICLE_PAGE_FETCHES_PER_RUN);
    assert.match(readScrapeLimit({ FEED_SCRAPE_LIMIT: 'viele' }).skipReason, /FEED_SCRAPE_LIMIT/);
});

test('eine verworfene Grenze meldet nur den Variablennamen', () => {
    const { skipped } = readFeedRunConfiguration({
        ...VOLLSTAENDIG,
        FEED_CORE_DEADLINE_MS: '99999999',
        FEED_SCRAPE_LIMIT: 'viele',
    });

    const begruendung = skipped.join(' ');
    assert.match(begruendung, /FEED_CORE_DEADLINE_MS/);
    assert.match(begruendung, /FEED_SCRAPE_LIMIT/);
    assert.doesNotMatch(begruendung, /99999999|viele/);
});
