import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedsHandler } from '../../../server/feeds-handler.ts';
import {
    ADMIN_ENV,
    adminRequest,
    createLoggerStub,
    createSqlStub,
    fixedClock,
    readJson,
} from '../helpers/admin-api.js';

const FEED_ROW = Object.freeze({
    id: 'gamestar-1785240000000',
    name: 'GameStar',
    url: 'https://www.gamestar.de/feed.xml',
    language: 'de',
    priority: 'primary',
    needs_scraping: false,
    update_interval: 20,
});

const VALID_FEED = Object.freeze({
    name: 'GameStar',
    url: 'https://www.gamestar.de/feed.xml',
    language: 'de',
    priority: 'primary',
    needsScraping: false,
});

function createHandler(responses = [], options = {}) {
    const { sql, calls } = createSqlStub(responses);
    const { logger, errors } = createLoggerStub();

    return {
        calls,
        errors,
        handler: createFeedsHandler({
            sql,
            env: ADMIN_ENV,
            now: fixedClock(),
            logger,
            ...options,
        }),
    };
}

// === Gültige Admin-Abläufe: diese müssen unverändert nutzbar bleiben ===

test('GET liefert die Feed-Liste in der Frontend-Form', async () => {
    const { handler, calls } = createHandler([{ rows: [FEED_ROW] }]);

    const response = await handler(adminRequest('/api/feeds'));
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.deepEqual(body, [{
        id: FEED_ROW.id,
        url: FEED_ROW.url,
        name: FEED_ROW.name,
        language: 'de',
        priority: 'primary',
        needsScraping: false,
    }]);
    assert.match(calls[0].text, /SELECT \* FROM feeds ORDER BY name/);
});

test('POST legt einen Feed an und liefert 201 mit der erzeugten ID', async () => {
    const { handler, calls } = createHandler([{ rows: [FEED_ROW] }]);

    const response = await handler(adminRequest('/api/feeds', {
        method: 'POST',
        body: VALID_FEED,
    }));
    const body = await readJson(response);

    assert.equal(response.status, 201);
    assert.equal(body.id, FEED_ROW.id);
    assert.match(calls[0].text, /INSERT INTO feeds/);
    // Die ID wird aus dem Namen und der injizierten Uhr gebildet.
    assert.equal(calls[0].values[0], 'gamestar-1785240000000');
    assert.equal(calls[0].values[6], 20, 'update_interval bleibt bei 20 Minuten');
});

test('PUT aktualisiert einen bestehenden Feed', async () => {
    const { handler, calls } = createHandler([{ rows: [{ ...FEED_ROW, name: 'GameStar DE' }] }]);

    const response = await handler(adminRequest('/api/feeds', {
        method: 'PUT',
        body: { ...VALID_FEED, id: FEED_ROW.id, name: 'GameStar DE' },
    }));
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.name, 'GameStar DE');
    assert.match(calls[0].text, /UPDATE feeds/);
    assert.equal(calls[0].values.at(-1), FEED_ROW.id);
});

test('DELETE entfernt einen Feed und antwortet mit 204 ohne Inhalt', async () => {
    const { handler, calls } = createHandler([{ rows: [] }]);

    const response = await handler(adminRequest('/api/feeds', {
        method: 'DELETE',
        body: { id: FEED_ROW.id },
    }));

    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.match(calls[0].text, /DELETE FROM feeds/);
    assert.deepEqual(calls[0].values, [FEED_ROW.id]);
});

test('PUT auf einen unbekannten Feed ergibt 404', async () => {
    const { handler } = createHandler([{ rows: [] }]);

    const response = await handler(adminRequest('/api/feeds', {
        method: 'PUT',
        body: { ...VALID_FEED, id: 'gibt-es-nicht' },
    }));

    assert.equal(response.status, 404);
});

test('unbekannte Methoden ergeben 405 mit Allow-Header', async () => {
    const { handler } = createHandler();

    const response = await handler(adminRequest('/api/feeds', { method: 'PATCH' }));

    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, POST, PUT, DELETE');
});

// === Auth- und Origin-Grenzen ===

test('ohne Zugangsdaten wird keine Methode bedient', async () => {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const { handler, calls } = createHandler();
        const response = await handler(adminRequest('/api/feeds', {
            method,
            authenticated: false,
            body: method === 'GET' ? undefined : VALID_FEED,
        }));

        assert.equal(response.status, 401, method);
        assert.equal(response.headers.get('www-authenticate')?.startsWith('Basic'), true, method);
        assert.equal(calls.length, 0, `${method} hat trotzdem SQL abgesetzt`);
    }
});

test('mutierende Methoden verlangen zusätzlich eine passende Origin', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
        for (const origin of [null, 'https://boese.example']) {
            const { handler, calls } = createHandler();
            const response = await handler(adminRequest('/api/feeds', {
                method,
                origin,
                body: { ...VALID_FEED, id: FEED_ROW.id },
            }));

            assert.equal(response.status, 403, `${method} / ${origin}`);
            assert.equal(calls.length, 0, `${method} hat trotzdem SQL abgesetzt`);
        }
    }
});

test('GET braucht keine Origin, weil es nichts verändert', async () => {
    const { handler } = createHandler([{ rows: [] }]);

    const response = await handler(adminRequest('/api/feeds', { origin: null }));

    assert.equal(response.status, 200);
});

test('fehlende Zugangsdaten in der Umgebung ergeben 503 statt eines offenen Endpunkts', async () => {
    const { handler, calls } = createHandler([], { env: {} });

    const response = await handler(adminRequest('/api/feeds'));

    assert.equal(response.status, 503);
    assert.equal(calls.length, 0);
});

// === Bestehende Feldprüfung ===

test('die bestehende Feed-Validierung greift bei POST und PUT', async () => {
    for (const method of ['POST', 'PUT']) {
        const { handler, calls } = createHandler();
        const response = await handler(adminRequest('/api/feeds', {
            method,
            body: { ...VALID_FEED, id: FEED_ROW.id, url: 'javascript:alert(1)' },
        }));
        const body = await readJson(response);

        assert.equal(response.status, 400, method);
        assert.match(body.error, /Die Feed-Adresse wurde abgelehnt/, method);
        assert.equal(calls.length, 0, `${method} hat trotzdem SQL abgesetzt`);
    }
});

test('PUT ohne ID wird abgelehnt, bevor SQL läuft', async () => {
    const { handler, calls } = createHandler();

    const response = await handler(adminRequest('/api/feeds', {
        method: 'PUT',
        body: VALID_FEED,
    }));

    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
});

test('DELETE ohne ID wird abgelehnt, bevor SQL läuft', async () => {
    const { handler, calls } = createHandler();

    const response = await handler(adminRequest('/api/feeds', {
        method: 'DELETE',
        body: {},
    }));

    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
});

// === Laufzeitverträge (S2) ===

test('kaputtes JSON ergibt eine kontrollierte 400 statt eines Serverfehlers', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
        const { handler, calls } = createHandler();
        const response = await handler(adminRequest('/api/feeds', {
            method,
            rawBody: '{"name": ',
        }));
        const body = await readJson(response);

        assert.equal(response.status, 400, method);
        assert.equal(body.code, 'invalid_json', method);
        assert.equal(calls.length, 0, `${method} hat trotzdem SQL abgesetzt`);
    }
});

test('JSON, das kein Objekt ist, bekommt einen eigenen Code', async () => {
    for (const rawBody of ['[]', '"feed"', '42', 'null']) {
        const { handler } = createHandler();
        const response = await handler(adminRequest('/api/feeds', { method: 'POST', rawBody }));

        assert.equal(response.status, 400, rawBody);
        assert.equal((await readJson(response)).code, 'invalid_payload', rawBody);
    }
});

test('Feldfehler nennen Code und betroffenes Feld', async () => {
    const cases = [
        [{ ...VALID_FEED, name: 42 }, 'name'],
        [{ ...VALID_FEED, name: '' }, 'name'],
        [{ ...VALID_FEED, url: 'javascript:alert(1)' }, 'url'],
        [{ ...VALID_FEED, url: 'http://127.0.0.1/feed' }, 'url'],
        [{ ...VALID_FEED, language: 'fr' }, 'language'],
        [{ ...VALID_FEED, priority: 'wichtig' }, 'priority'],
        [{ ...VALID_FEED, needsScraping: 'ja' }, 'needsScraping'],
    ];

    for (const [payload, field] of cases) {
        const { handler, calls } = createHandler();
        const response = await handler(adminRequest('/api/feeds', { method: 'POST', body: payload }));
        const body = await readJson(response);

        assert.equal(response.status, 400, field);
        assert.equal(body.code, 'validation_failed', field);
        assert.equal(body.field, field);
        assert.equal(typeof body.error, 'string');
        assert.equal(calls.length, 0);
    }
});

test('eine überlange Feed-ID erreicht die Datenbank nicht', async () => {
    for (const method of ['PUT', 'DELETE']) {
        const { handler, calls } = createHandler();
        const response = await handler(adminRequest('/api/feeds', {
            method,
            body: { ...VALID_FEED, id: 'x'.repeat(161) },
        }));
        const body = await readJson(response);

        assert.equal(response.status, 400, method);
        assert.equal(body.field, 'id', method);
        assert.equal(calls.length, 0, method);
    }
});

test('needsScraping landet nur als echtes Boolean in der Datenbank', async () => {
    const { handler, calls } = createHandler([{ rows: [FEED_ROW] }]);

    await handler(adminRequest('/api/feeds', {
        method: 'POST',
        body: { ...VALID_FEED, needsScraping: true },
    }));

    assert.equal(calls[0].values[5], true);
});

test('needsScraping: null wird abgelehnt und erreicht die Datenbank nicht', async () => {
    // Nur ein fehlendes Feld darf zum Default werden; ein ausdrückliches null
    // ist eine Aussage des Absenders und wird nicht stillschweigend ersetzt.
    for (const method of ['POST', 'PUT']) {
        const { handler, calls } = createHandler();
        const response = await handler(adminRequest('/api/feeds', {
            method,
            body: { ...VALID_FEED, id: FEED_ROW.id, needsScraping: null },
        }));
        const body = await readJson(response);

        assert.equal(response.status, 400, method);
        assert.equal(body.code, 'validation_failed', method);
        assert.equal(body.field, 'needsScraping', method);
        assert.equal(calls.length, 0, `${method} hat trotzdem SQL abgesetzt`);
    }
});

test('ein fehlendes needsScraping bleibt der dokumentierte Default', async () => {
    const { handler, calls } = createHandler([{ rows: [FEED_ROW] }]);
    const { needsScraping: _weg, ...ohneFeld } = VALID_FEED;

    const response = await handler(adminRequest('/api/feeds', { method: 'POST', body: ohneFeld }));

    assert.equal(response.status, 201);
    assert.equal(calls[0].values[5], false);
});

test('unbekannte Zusatzfelder werden ignoriert statt abgelehnt', async () => {
    const { handler, calls } = createHandler([{ rows: [FEED_ROW] }]);

    const response = await handler(adminRequest('/api/feeds', {
        method: 'POST',
        body: { ...VALID_FEED, updateInterval: 5, unbekannt: 'egal' },
    }));

    assert.equal(response.status, 201);
    assert.equal(calls[0].values[6], 20, 'update_interval bleibt serverseitig gesetzt');
});

test('der Name wird für ID und Datenbank normalisiert', async () => {
    const { handler, calls } = createHandler([{ rows: [FEED_ROW] }]);

    await handler(adminRequest('/api/feeds', {
        method: 'POST',
        body: { ...VALID_FEED, name: '  GameStar  ' },
    }));

    assert.equal(calls[0].values[0], 'gamestar-1785240000000');
    assert.equal(calls[0].values[1], 'GameStar');
});

// === Interne Fehler ===

test('ein SQL-Fehler wird protokolliert, aber nie ausgeliefert', async () => {
    const dbError = new Error('connect ECONNREFUSED postgres://nutzer:geheim@db.example/main');

    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        const { handler, errors } = createHandler([dbError]);
        const response = await handler(adminRequest('/api/feeds', {
            method,
            body: method === 'GET' ? undefined : { ...VALID_FEED, id: FEED_ROW.id },
        }));
        const body = await readJson(response);

        assert.equal(response.status, 500, method);
        assert.equal(body.code, 'internal_error', method);
        assert.equal(body.error, 'Es ist ein interner Serverfehler aufgetreten.', method);
        assert.doesNotMatch(JSON.stringify(body), /ECONNREFUSED|postgres|geheim/, method);
        assert.equal(errors.length, 1, `${method}: der Originaltext gehört ins Log`);
    }
});

// === Cache-Schutz ===

test('jede Antwort des geschützten Endpunkts ist unspeicherbar', async () => {
    const faelle = [
        ['GET', {}, [{ rows: [] }]],
        ['POST', { body: VALID_FEED }, [{ rows: [FEED_ROW] }]],
        ['PUT', { body: { ...VALID_FEED, id: FEED_ROW.id } }, [{ rows: [FEED_ROW] }]],
        ['PUT', { body: { ...VALID_FEED, id: 'weg' } }, [{ rows: [] }]],
        ['DELETE', { body: { id: FEED_ROW.id } }, [{ rows: [] }]],
        ['POST', { body: { ...VALID_FEED, language: 'fr' } }, []],
        ['POST', { rawBody: '{' }, []],
        ['PATCH', {}, []],
        ['GET', { authenticated: false }, []],
        ['POST', { origin: 'https://boese.example', body: VALID_FEED }, []],
        ['GET', {}, [new Error('kaputt')]],
    ];

    for (const [method, options, responses] of faelle) {
        const { handler } = createHandler(responses);
        const response = await handler(adminRequest('/api/feeds', { method, ...options }));

        assert.equal(
            response.headers.get('cache-control'),
            'private, no-store',
            `${method} ${response.status}`,
        );
    }
});

test('405 und 404 tragen stabile Codes', async () => {
    const { handler: methodHandler } = createHandler();
    const methodResponse = await methodHandler(adminRequest('/api/feeds', { method: 'PATCH' }));
    assert.equal((await readJson(methodResponse)).code, 'method_not_allowed');
    assert.equal(methodResponse.headers.get('allow'), 'GET, POST, PUT, DELETE');

    const { handler: notFoundHandler } = createHandler([{ rows: [] }]);
    const notFoundResponse = await notFoundHandler(adminRequest('/api/feeds', {
        method: 'PUT',
        body: { ...VALID_FEED, id: 'gibt-es-nicht' },
    }));
    assert.equal((await readJson(notFoundResponse)).code, 'not_found');
});

test('das Löschen bleibt idempotent und meldet keinen Fehler', async () => {
    // Bewusst so: ein zweiter Löschversuch soll im Admin keine Fehlermeldung
    // erzeugen. Nur PUT unterscheidet zwischen vorhanden und nicht vorhanden.
    const { handler } = createHandler([{ rows: [] }]);

    const response = await handler(adminRequest('/api/feeds', {
        method: 'DELETE',
        body: { id: 'schon-weg' },
    }));

    assert.equal(response.status, 204);
});
