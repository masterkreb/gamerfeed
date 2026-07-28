import test from 'node:test';
import assert from 'node:assert/strict';
import {
    adminEmptyResponse,
    adminErrorResponse,
    adminJsonResponse,
    internalErrorResponse,
    methodNotAllowedResponse,
    readAdminJsonObject,
    validationErrorResponse,
} from '../../../server/admin-api.js';
import {
    ADMIN_CACHE_CONTROL,
    API_ERROR_CODES,
    INTERNAL_ERROR_MESSAGE,
} from '../../../shared/api-errors.js';

function jsonRequest(rawBody) {
    return new Request('https://gamerfeed.example/api/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
    });
}

test('die dokumentierte Cache-Vorgabe lautet private, no-store', () => {
    assert.equal(ADMIN_CACHE_CONTROL, 'private, no-store');
});

test('jede Antwort eines geschützten Endpunkts ist unspeicherbar', async () => {
    const responses = [
        adminJsonResponse({ ok: true }),
        adminJsonResponse({ ok: true }, 201),
        adminEmptyResponse(204),
        adminErrorResponse(404, API_ERROR_CODES.NOT_FOUND, 'Nicht gefunden.'),
        internalErrorResponse(),
        methodNotAllowedResponse('PATCH', 'GET, POST'),
    ];

    for (const response of responses) {
        assert.equal(
            response.headers.get('cache-control'),
            'private, no-store',
            `Status ${response.status}`,
        );
    }
});

test('die 204-Antwort trägt keinen Inhalt', async () => {
    const response = adminEmptyResponse(204);

    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
});

test('Fehlerantworten tragen Meldung und stabilen Code', async () => {
    const response = adminErrorResponse(404, API_ERROR_CODES.NOT_FOUND, 'Nicht gefunden.');

    assert.equal(response.status, 404);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.deepEqual(await response.json(), { error: 'Nicht gefunden.', code: 'not_found' });
});

test('Validierungsfehler nennen zusätzlich das betroffene Feld', async () => {
    const response = validationErrorResponse({ error: 'Der Name des Feeds fehlt.', field: 'name' });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
        error: 'Der Name des Feeds fehlt.',
        code: 'validation_failed',
        field: 'name',
    });
});

test('ohne betroffenes Feld bleibt der Schlüssel weg statt null zu sein', async () => {
    const response = validationErrorResponse({ error: 'Kaputt.', field: null });

    assert.deepEqual(Object.keys(await response.json()).sort(), ['code', 'error']);
});

test('die 500-Antwort nennt niemals den internen Text', async () => {
    const response = internalErrorResponse();

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
        error: INTERNAL_ERROR_MESSAGE,
        code: 'internal_error',
    });
});

test('405 nennt die erlaubten Methoden', async () => {
    const response = methodNotAllowedResponse('PATCH', 'GET, POST, DELETE');

    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, POST, DELETE');
    assert.equal((await response.json()).code, 'method_not_allowed');
});

// === Rumpf lesen ===

test('liest ein gültiges JSON-Objekt', async () => {
    const { value, error } = await readAdminJsonObject(jsonRequest('{"name":"GameStar"}'));

    assert.equal(error, null);
    assert.deepEqual(value, { name: 'GameStar' });
});

test('kaputtes JSON ergibt eine kontrollierte 400 mit eigenem Code', async () => {
    for (const rawBody of ['{', 'nicht json', '{"a":}', '']) {
        const { value, error } = await readAdminJsonObject(jsonRequest(rawBody));

        assert.equal(value, null, JSON.stringify(rawBody));
        assert.equal(error.status, 400);
        assert.deepEqual(await error.json(), {
            error: 'Der Anfragetext ist kein gültiges JSON.',
            code: 'invalid_json',
        });
    }
});

test('gültiges JSON, das kein Objekt ist, bekommt einen eigenen Code', async () => {
    for (const rawBody of ['[]', '"text"', '42', 'null', 'true']) {
        const { value, error } = await readAdminJsonObject(jsonRequest(rawBody));

        assert.equal(value, null, rawBody);
        assert.equal(error.status, 400, rawBody);
        assert.equal((await error.json()).code, 'invalid_payload', rawBody);
    }
});

test('die Fehlercodes bleiben als Liste stabil', () => {
    assert.deepEqual(Object.values(API_ERROR_CODES).sort(), [
        'auth_unavailable',
        'forbidden',
        'internal_error',
        'invalid_json',
        'invalid_payload',
        'method_not_allowed',
        'not_found',
        'unauthorized',
        'validation_failed',
    ]);
});
