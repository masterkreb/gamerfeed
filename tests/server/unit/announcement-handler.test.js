import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ANNOUNCEMENT_ADMIN_PARAM,
    ANNOUNCEMENT_ADMIN_VALUE,
    ANNOUNCEMENT_KV_KEY,
    createAnnouncementHandler,
} from '../../../server/announcement-handler.ts';
import { ANNOUNCEMENT_MESSAGE_MAX_LENGTH } from '../../../shared/announcement-contract.js';
import {
    ADMIN_ENV,
    adminRequest,
    createKvStub,
    createLoggerStub,
    fixedClock,
    readJson,
} from '../helpers/admin-api.js';

const ACTIVE_ANNOUNCEMENT = Object.freeze({
    id: 'announcement-1785239000000',
    message: 'Wartungsarbeiten am Sonntag.',
    type: 'maintenance',
    isActive: true,
    createdAt: '2026-07-28T11:43:20.000Z',
});

const INACTIVE_ANNOUNCEMENT = Object.freeze({
    ...ACTIVE_ANNOUNCEMENT,
    isActive: false,
});

function createHandler({ values, error, ...options } = {}) {
    const { kv, store, calls } = createKvStub({ values, error });
    const { logger, errors } = createLoggerStub();

    return {
        store,
        calls,
        errors,
        handler: createAnnouncementHandler({
            kv,
            env: ADMIN_ENV,
            now: fixedClock(),
            logger,
            ...options,
        }),
    };
}

function publicRequest(path = '/api/announcement') {
    return new Request(`https://gamerfeed.example${path}`);
}

// === Öffentlicher Abruf ===

test('öffentlich wird eine aktive Ankündigung ausgeliefert', async () => {
    const { handler } = createHandler({ values: { [ANNOUNCEMENT_KV_KEY]: ACTIVE_ANNOUNCEMENT } });

    const response = await handler(publicRequest());
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.deepEqual(body, ACTIVE_ANNOUNCEMENT);
    assert.equal(
        response.headers.get('cache-control'),
        's-maxage=60, stale-while-revalidate=120',
        'die öffentliche Cache-Semantik bleibt erhalten',
    );
});

test('öffentlich liefert eine inaktive Ankündigung null', async () => {
    const { handler } = createHandler({ values: { [ANNOUNCEMENT_KV_KEY]: INACTIVE_ANNOUNCEMENT } });

    const response = await handler(publicRequest());

    assert.equal(response.status, 200);
    assert.equal(await readJson(response), null);
});

test('öffentlich liefert ohne gespeicherte Ankündigung null', async () => {
    const { handler } = createHandler();

    const response = await handler(publicRequest());

    assert.equal(await readJson(response), null);
});

// === Geschützte Mutationen ===

test('POST speichert eine Ankündigung mit erzeugter ID und Zeitstempel', async () => {
    const { handler, store } = createHandler();

    const response = await handler(adminRequest('/api/announcement', {
        method: 'POST',
        body: { message: 'Neue Funktion ist live.', type: 'celebration', isActive: true },
    }));
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(body.id, 'announcement-1785240000000');
    assert.equal(body.createdAt, '2026-07-28T12:00:00.000Z');
    assert.equal(body.message, 'Neue Funktion ist live.');
    assert.equal(body.type, 'celebration');
    assert.equal(body.isActive, true);
    assert.deepEqual(store[ANNOUNCEMENT_KV_KEY], body);
});

test('POST ohne isActive legt die Ankündigung aktiv an', async () => {
    const { handler } = createHandler();

    const response = await handler(adminRequest('/api/announcement', {
        method: 'POST',
        body: { message: 'Kurzer Hinweis.', type: 'info' },
    }));

    assert.equal((await readJson(response)).isActive, true);
});

test('POST kann eine Ankündigung ausdrücklich inaktiv speichern', async () => {
    const { handler, store } = createHandler();

    const response = await handler(adminRequest('/api/announcement', {
        method: 'POST',
        body: { message: 'Später wieder einblenden.', type: 'info', isActive: false },
    }));

    assert.equal((await readJson(response)).isActive, false);
    assert.equal(store[ANNOUNCEMENT_KV_KEY].isActive, false);
});

test('DELETE entfernt die Ankündigung', async () => {
    const { handler, store, calls } = createHandler({
        values: { [ANNOUNCEMENT_KV_KEY]: ACTIVE_ANNOUNCEMENT },
    });

    const response = await handler(adminRequest('/api/announcement', { method: 'DELETE' }));

    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), { success: true });
    assert.equal(Object.hasOwn(store, ANNOUNCEMENT_KV_KEY), false);
    assert.deepEqual(calls, [{ operation: 'del', key: ANNOUNCEMENT_KV_KEY }]);
});

test('unbekannte Methoden ergeben 405', async () => {
    const { handler } = createHandler();

    const response = await handler(adminRequest('/api/announcement', { method: 'PUT' }));

    assert.equal(response.status, 405);
});

// === Auth- und Origin-Grenzen ===

test('mutierende Methoden verlangen Zugangsdaten', async () => {
    for (const method of ['POST', 'DELETE']) {
        const { handler, calls } = createHandler();
        const response = await handler(adminRequest('/api/announcement', {
            method,
            authenticated: false,
            body: method === 'POST' ? { message: 'x', type: 'info' } : undefined,
        }));

        assert.equal(response.status, 401, method);
        assert.equal(calls.length, 0, `${method} hat trotzdem KV berührt`);
    }
});

test('mutierende Methoden verlangen eine passende Origin', async () => {
    for (const method of ['POST', 'DELETE']) {
        for (const origin of [null, 'https://boese.example']) {
            const { handler, calls } = createHandler();
            const response = await handler(adminRequest('/api/announcement', {
                method,
                origin,
                body: method === 'POST' ? { message: 'x', type: 'info' } : undefined,
            }));

            assert.equal(response.status, 403, `${method} / ${origin}`);
            assert.equal(calls.length, 0);
        }
    }
});

test('der öffentliche GET braucht weiterhin keine Zugangsdaten', async () => {
    const { handler } = createHandler({ values: { [ANNOUNCEMENT_KV_KEY]: ACTIVE_ANNOUNCEMENT } });

    assert.equal((await handler(publicRequest())).status, 200);
});

// === Bestehende Feldprüfung ===

test('POST ohne Nachricht oder Typ wird abgelehnt', async () => {
    for (const body of [
        { type: 'info' },
        { message: 'Ohne Typ' },
        { message: '', type: 'info' },
    ]) {
        const { handler, calls } = createHandler();
        const response = await handler(adminRequest('/api/announcement', { method: 'POST', body }));

        assert.equal(response.status, 400, JSON.stringify(body));
        assert.equal(calls.length, 0, 'es darf nichts gespeichert werden');
    }
});

// === Geschützter Admin-Abruf (S2) ===

const ADMIN_QUERY = `/api/announcement?${ANNOUNCEMENT_ADMIN_PARAM}=${ANNOUNCEMENT_ADMIN_VALUE}`;

test('der authentifizierte Admin sieht eine inaktive Ankündigung vollständig', async () => {
    const { handler } = createHandler({ values: { [ANNOUNCEMENT_KV_KEY]: INACTIVE_ANNOUNCEMENT } });

    const response = await handler(adminRequest(ADMIN_QUERY));
    const body = await readJson(response);

    assert.equal(response.status, 200);
    assert.deepEqual(body, INACTIVE_ANNOUNCEMENT);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('der Admin-Abruf sieht auch eine aktive Ankündigung', async () => {
    const { handler } = createHandler({ values: { [ANNOUNCEMENT_KV_KEY]: ACTIVE_ANNOUNCEMENT } });

    assert.deepEqual(await readJson(await handler(adminRequest(ADMIN_QUERY))), ACTIVE_ANNOUNCEMENT);
});

test('ohne gespeicherte Ankündigung liefert auch der Admin-Abruf null', async () => {
    const { handler } = createHandler();

    assert.equal(await readJson(await handler(adminRequest(ADMIN_QUERY))), null);
});

test('eine öffentliche Anfrage kommt über den Admin-Parameter nicht an Inaktives heran', async () => {
    const { handler, calls } = createHandler({
        values: { [ANNOUNCEMENT_KV_KEY]: INACTIVE_ANNOUNCEMENT },
    });

    const response = await handler(new Request(`https://gamerfeed.example${ADMIN_QUERY}`));

    assert.equal(response.status, 401, 'der Admin-Modus ist auch beim GET geschützt');
    assert.equal(calls.length, 0, 'ohne Berechtigung wird KV gar nicht erst gelesen');
    assert.doesNotMatch(await response.text(), /Wartungsarbeiten/);
});

test('ein falscher Wert des Admin-Parameters bleibt der öffentliche Pfad', async () => {
    for (const query of ['?admin=0', '?admin=true', '?admin', '?Admin=1', '?x=1']) {
        const { handler } = createHandler({ values: { [ANNOUNCEMENT_KV_KEY]: INACTIVE_ANNOUNCEMENT } });
        const response = await handler(new Request(`https://gamerfeed.example/api/announcement${query}`));

        assert.equal(response.status, 200, query);
        assert.equal(await readJson(response), null, `${query} hat Inaktives ausgeliefert`);
        assert.equal(
            response.headers.get('cache-control'),
            's-maxage=60, stale-while-revalidate=120',
            query,
        );
    }
});

test('der Admin kann eine inaktive Ankündigung wieder aktivieren', async () => {
    const { handler, store } = createHandler({
        values: { [ANNOUNCEMENT_KV_KEY]: INACTIVE_ANNOUNCEMENT },
    });

    // Laden, bearbeiten, aktivieren – der Ablauf des Admin-Panels.
    const geladen = await readJson(await handler(adminRequest(ADMIN_QUERY)));
    assert.equal(geladen.isActive, false);

    const gespeichert = await handler(adminRequest('/api/announcement', {
        method: 'POST',
        body: { message: geladen.message, type: geladen.type, isActive: true },
    }));

    assert.equal(gespeichert.status, 200);
    assert.equal(store[ANNOUNCEMENT_KV_KEY].isActive, true);

    // Und ist danach öffentlich sichtbar.
    const oeffentlich = await handler(publicRequest());
    assert.equal((await readJson(oeffentlich)).isActive, true);
});

test('der Admin kann eine inaktive Ankündigung löschen', async () => {
    const { handler, store } = createHandler({
        values: { [ANNOUNCEMENT_KV_KEY]: INACTIVE_ANNOUNCEMENT },
    });

    const response = await handler(adminRequest('/api/announcement', { method: 'DELETE' }));

    assert.equal(response.status, 200);
    assert.equal(Object.hasOwn(store, ANNOUNCEMENT_KV_KEY), false);
});

// === Laufzeitverträge (S2) ===

test('kaputtes JSON ergibt eine kontrollierte 400', async () => {
    const { handler, calls } = createHandler();

    const response = await handler(adminRequest('/api/announcement', {
        method: 'POST',
        rawBody: '{"message":',
    }));

    assert.equal(response.status, 400);
    assert.equal((await readJson(response)).code, 'invalid_json');
    assert.equal(calls.length, 0);
});

test('JSON, das kein Objekt ist, bekommt einen eigenen Code', async () => {
    for (const rawBody of ['[]', '"hallo"', '42', 'null']) {
        const { handler } = createHandler();
        const response = await handler(adminRequest('/api/announcement', { method: 'POST', rawBody }));

        assert.equal((await readJson(response)).code, 'invalid_payload', rawBody);
    }
});

test('Feldfehler nennen Code und betroffenes Feld', async () => {
    const cases = [
        [{ type: 'info' }, 'message'],
        [{ message: 42, type: 'info' }, 'message'],
        [{ message: '   ', type: 'info' }, 'message'],
        [{ message: 'x'.repeat(ANNOUNCEMENT_MESSAGE_MAX_LENGTH + 1), type: 'info' }, 'message'],
        [{ message: 'Hinweis', type: 'kritisch' }, 'type'],
        [{ message: 'Hinweis', type: 42 }, 'type'],
        [{ message: 'Hinweis' }, 'type'],
        [{ message: 'Hinweis', type: 'info', isActive: 'true' }, 'isActive'],
        [{ message: 'Hinweis', type: 'info', isActive: 1 }, 'isActive'],
    ];

    for (const [payload, field] of cases) {
        const { handler, calls } = createHandler();
        const response = await handler(adminRequest('/api/announcement', {
            method: 'POST',
            body: payload,
        }));
        const body = await readJson(response);

        assert.equal(response.status, 400, JSON.stringify(payload));
        assert.equal(body.code, 'validation_failed', JSON.stringify(payload));
        assert.equal(body.field, field, JSON.stringify(payload));
        assert.equal(calls.length, 0);
    }
});

test('untergeschobene id und createdAt werden nicht übernommen', async () => {
    const { handler, store } = createHandler();

    await handler(adminRequest('/api/announcement', {
        method: 'POST',
        body: {
            message: 'Hinweis',
            type: 'info',
            id: 'untergeschoben',
            createdAt: '1999-01-01T00:00:00.000Z',
        },
    }));

    assert.equal(store[ANNOUNCEMENT_KV_KEY].id, 'announcement-1785240000000');
    assert.equal(store[ANNOUNCEMENT_KV_KEY].createdAt, '2026-07-28T12:00:00.000Z');
});

// === Interne Fehler ===

test('ein KV-Fehler wird protokolliert, aber nie ausgeliefert', async () => {
    const kvError = new Error('KV offline: https://kv.example/pipeline?token=geheim');

    for (const [method, options] of [
        ['GET', {}],
        ['POST', { body: { message: 'Hinweis', type: 'info' } }],
        ['DELETE', {}],
    ]) {
        const { handler, errors } = createHandler({ error: kvError });
        const request = method === 'GET'
            ? publicRequest()
            : adminRequest('/api/announcement', { method, ...options });
        const response = await handler(request);
        const body = await readJson(response);

        assert.equal(response.status, 500, method);
        assert.equal(body.code, 'internal_error', method);
        assert.doesNotMatch(JSON.stringify(body), /KV offline|geheim/, method);
        assert.equal(errors.length, 1, method);
    }
});

// === Cache-Schutz ===

test('geschützte Antworten sind unspeicherbar, der öffentliche Abruf bleibt cachebar', async () => {
    const geschuetzt = [
        ['POST', { body: { message: 'Hinweis', type: 'info' } }, '/api/announcement'],
        ['POST', { body: { message: '', type: 'info' } }, '/api/announcement'],
        ['DELETE', {}, '/api/announcement'],
        ['PUT', {}, '/api/announcement'],
        ['GET', {}, ADMIN_QUERY],
        ['POST', { authenticated: false }, '/api/announcement'],
        ['POST', { origin: 'https://boese.example' }, '/api/announcement'],
    ];

    for (const [method, options, path] of geschuetzt) {
        const { handler } = createHandler();
        const response = await handler(adminRequest(path, { method, ...options }));

        assert.equal(
            response.headers.get('cache-control'),
            'private, no-store',
            `${method} ${path} ${response.status}`,
        );
    }

    const { handler } = createHandler({ values: { [ANNOUNCEMENT_KV_KEY]: ACTIVE_ANNOUNCEMENT } });
    assert.equal(
        (await handler(publicRequest())).headers.get('cache-control'),
        's-maxage=60, stale-while-revalidate=120',
    );
});

test('405 nennt einen stabilen Code und die erlaubten Methoden', async () => {
    const { handler } = createHandler();

    const response = await handler(adminRequest('/api/announcement', { method: 'PUT' }));

    assert.equal(response.status, 405);
    assert.equal((await readJson(response)).code, 'method_not_allowed');
    assert.equal(response.headers.get('allow'), 'GET, POST, DELETE');
});
