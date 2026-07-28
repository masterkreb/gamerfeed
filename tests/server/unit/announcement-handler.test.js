import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ANNOUNCEMENT_KV_KEY,
    createAnnouncementHandler,
} from '../../../server/announcement-handler.ts';
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
