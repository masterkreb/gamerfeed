import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ARTICLE_IMAGE_ROUTES,
    DIRECT_STOP_STATUSES,
    PROXY_MAX_CONSECUTIVE_FAILURES,
    PROXY_STOP_STATUSES,
    createArticleImageBrake,
} from '../../../scripts/article-image-brake.js';

// Die Bremse des Play3-Bildpfads ist reine Zustandslogik: kein Netz, keine Uhr,
// kein Log. Wie sie im Abruf verwendet wird, prüfen og-image-fetch.test.js und
// der Lauf-Test play3-image-fallback.test.js.

const { DIRECT, PROXY } = ARTICLE_IMAGE_ROUTES;

test('die dokumentierten Statuslisten und Grenzen sind gesetzt', () => {
    assert.deepEqual([...DIRECT_STOP_STATUSES], [401, 403, 429]);
    assert.deepEqual([...PROXY_STOP_STATUSES], [401, 403, 422, 429]);
    assert.equal(PROXY_MAX_CONSECUTIVE_FAILURES, 3);
});

test('ein neuer Lauf beginnt ohne Bremse', () => {
    const brake = createArticleImageBrake();

    assert.equal(brake.isStopped(DIRECT), false);
    assert.equal(brake.isStopped(PROXY), false);
});

test('der Direktweg stoppt bei 401, 403 und 429 - und meldet es genau einmal', () => {
    for (const status of [401, 403, 429]) {
        const brake = createArticleImageBrake();

        assert.deepEqual(
            brake.record(DIRECT, { status }),
            { route: DIRECT, reason: 'status', status, failures: 0 },
            `HTTP ${status}`,
        );
        assert.equal(brake.isStopped(DIRECT), true, `HTTP ${status}`);
        assert.equal(brake.isStopped(PROXY), false, 'der Proxyweg bleibt offen');

        // Ein zweites Ergebnis desselben Wegs erzeugt keine zweite Meldung.
        assert.equal(brake.record(DIRECT, { status }), null, `HTTP ${status} erneut`);
    }
});

test('der Direktweg bleibt bei allen anderen Antworten offen', () => {
    const brake = createArticleImageBrake();

    for (const status of [200, 301, 404, 410, 422, 500, 502, 503]) {
        assert.equal(brake.record(DIRECT, { status }), null, `HTTP ${status}`);
    }
    assert.equal(brake.record(DIRECT, { failed: true }), null, 'ein Netzwerkfehler bremst den Direktweg nicht');
    assert.equal(brake.record(DIRECT, { failed: true }), null);
    assert.equal(brake.record(DIRECT, { failed: true }), null);

    assert.equal(brake.isStopped(DIRECT), false);
});

test('der Proxyweg stoppt sofort bei 401, 403, 422 und 429', () => {
    for (const status of [401, 403, 422, 429]) {
        const brake = createArticleImageBrake();

        assert.deepEqual(
            brake.record(PROXY, { status }),
            { route: PROXY, reason: 'status', status, failures: 0 },
            `HTTP ${status}`,
        );
        assert.equal(brake.isStopped(PROXY), true, `HTTP ${status}`);
        assert.equal(brake.isStopped(DIRECT), false, 'der Direktweg bleibt offen');
        assert.equal(brake.record(PROXY, { status }), null, `HTTP ${status} erneut`);
    }
});

test('der Proxyweg stoppt erst nach drei Netzwerkfehlern in Folge', () => {
    const brake = createArticleImageBrake();

    assert.equal(brake.record(PROXY, { failed: true }), null);
    assert.equal(brake.isStopped(PROXY), false, 'ein Fehler bremst noch nicht');
    assert.equal(brake.record(PROXY, { failed: true }), null);
    assert.equal(brake.isStopped(PROXY), false, 'zwei Fehler bremsen noch nicht');

    assert.deepEqual(
        brake.record(PROXY, { failed: true }),
        { route: PROXY, reason: 'failures', status: null, failures: 3 },
    );
    assert.equal(brake.isStopped(PROXY), true);
    assert.equal(brake.record(PROXY, { failed: true }), null, 'danach keine weitere Meldung');
});

test('auch 5xx-Antworten zählen als Fehlschlag in Folge', () => {
    const brake = createArticleImageBrake();

    assert.equal(brake.record(PROXY, { status: 502 }), null);
    assert.equal(brake.record(PROXY, { failed: true }), null);
    assert.deepEqual(
        brake.record(PROXY, { status: 503 }),
        { route: PROXY, reason: 'failures', status: 503, failures: 3 },
        'der zuletzt gemeldete Status steht in der Meldung',
    );
});

test('jede verwertbare Antwort setzt den Fehlerzähler zurück', () => {
    const brake = createArticleImageBrake();

    brake.record(PROXY, { failed: true });
    brake.record(PROXY, { failed: true });
    // Zwei Fehler, dann eine Antwort der Gegenstelle: der Zähler beginnt neu.
    assert.equal(brake.record(PROXY, { status: 404 }), null);
    brake.record(PROXY, { failed: true });
    assert.equal(brake.record(PROXY, { failed: true }), null);
    assert.equal(brake.isStopped(PROXY), false, 'es waren nie drei in Folge');

    assert.equal(brake.record(PROXY, { status: 200 }), null);
    brake.record(PROXY, { failed: true });
    brake.record(PROXY, { failed: true });
    assert.equal(brake.isStopped(PROXY), false);

    assert.notEqual(brake.record(PROXY, { failed: true }), null, 'jetzt sind es drei in Folge');
    assert.equal(brake.isStopped(PROXY), true);
});

test('404, 413 und 415 betreffen nur den einzelnen Artikel und bremsen nie', () => {
    const brake = createArticleImageBrake();

    for (let durchlauf = 0; durchlauf < 10; durchlauf += 1) {
        for (const status of [200, 404, 413, 415]) {
            assert.equal(brake.record(PROXY, { status }), null, `HTTP ${status}`);
        }
    }

    assert.equal(brake.isStopped(PROXY), false);
});

test('die beiden Wege bremsen unabhängig voneinander', () => {
    const brake = createArticleImageBrake();

    brake.record(DIRECT, { status: 403 });
    assert.equal(brake.isStopped(DIRECT), true);
    assert.equal(brake.isStopped(PROXY), false);

    brake.record(PROXY, { status: 429 });
    assert.equal(brake.isStopped(DIRECT), true);
    assert.equal(brake.isStopped(PROXY), true);
});

test('der Zustand gehört zu genau einer Bremse, also zu genau einem Lauf', () => {
    const ersterLauf = createArticleImageBrake();
    ersterLauf.record(DIRECT, { status: 403 });
    ersterLauf.record(PROXY, { status: 422 });

    const zweiterLauf = createArticleImageBrake();

    assert.equal(zweiterLauf.isStopped(DIRECT), false, 'jeder Lauf prüft den Direktweg neu');
    assert.equal(zweiterLauf.isStopped(PROXY), false);
});

test('ein unbekannter Weg wird weder gebremst noch gemeldet', () => {
    const brake = createArticleImageBrake();

    assert.equal(brake.isStopped('irgendwas'), false);
    assert.equal(brake.record('irgendwas', { status: 403 }), null);
    assert.equal(brake.isStopped('irgendwas'), false);
});
