import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CORE_ENV_KEYS,
    checkCoreConfiguration,
    describeMissingCoreConfiguration,
    readFeedRunConfiguration,
    readOptionalGroqKey,
    readOptionalProxyUrl,
} from '../../../scripts/feed-run-config.js';

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
