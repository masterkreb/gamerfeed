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
