import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdminAuth, requireAdminMutation } from '../../../server/admin-auth.js';

const ENV = {
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'sehr:sicher',
};

function encodeBasicCredentials(username, password, scheme = 'Basic') {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
    return `${scheme} ${btoa(binary)}`;
}

function createRequest({
    authorization,
    origin,
    url = 'https://gamerfeed.example/api/feeds',
    method = 'GET',
} = {}) {
    const headers = new Headers();
    if (authorization !== undefined) {
        headers.set('authorization', authorization);
    }
    if (origin !== undefined) {
        headers.set('origin', origin);
    }

    return new Request(url, { method, headers });
}

test('akzeptiert gültige Basic-Credentials inklusive Doppelpunkt im Passwort', () => {
    const request = createRequest({
        authorization: encodeBasicCredentials('admin', 'sehr:sicher'),
    });

    assert.equal(requireAdminAuth(request, ENV), null);
});

test('akzeptiert Basic-Scheme unabhängig von Gross-/Kleinschreibung und UTF-8', () => {
    const env = {
        ADMIN_USERNAME: 'admín',
        ADMIN_PASSWORD: 'pässwort',
    };
    const request = createRequest({
        authorization: encodeBasicCredentials('admín', 'pässwort', 'basic'),
    });

    assert.equal(requireAdminAuth(request, env), null);
});

test('lehnt fehlende, falsche und fehlerhafte Credentials ab', async t => {
    const validToken = encodeBasicCredentials('admin', 'sehr:sicher').split(' ')[1];
    const cases = [
        ['ohne Header', undefined],
        ['falscher Benutzername', encodeBasicCredentials('anderer', 'sehr:sicher')],
        ['falsches Passwort', encodeBasicCredentials('admin', 'falsch')],
        ['fremdes Scheme', `Bearer ${validToken}`],
        ['ungültiges Base64', 'Basic !!!!'],
        ['ohne Trennzeichen', `Basic ${btoa('admin')}`],
    ];

    for (const [name, authorization] of cases) {
        await t.test(name, () => {
            const response = requireAdminAuth(createRequest({ authorization }), ENV);

            assert.equal(response?.status, 401);
            assert.equal(response?.headers.get('cache-control'), 'no-store');
            assert.equal(
                response?.headers.get('www-authenticate'),
                'Basic realm="GamerFeed Admin", charset="UTF-8"',
            );
        });
    }
});

test('schlägt bei fehlender oder ungültiger Server-Konfiguration geschlossen fehl', async t => {
    const request = createRequest({
        authorization: encodeBasicCredentials('admin', 'sehr:sicher'),
    });
    const cases = [
        ['beide Werte fehlen', {}],
        ['Passwort fehlt', { ADMIN_USERNAME: 'admin' }],
        ['Benutzername fehlt', { ADMIN_PASSWORD: 'sehr:sicher' }],
        ['Benutzername enthält Doppelpunkt', {
            ADMIN_USERNAME: 'ad:min',
            ADMIN_PASSWORD: 'sehr:sicher',
        }],
    ];

    for (const [name, env] of cases) {
        await t.test(name, () => {
            const response = requireAdminAuth(request, env);

            assert.equal(response?.status, 503);
            assert.equal(response?.headers.get('cache-control'), 'no-store');
            assert.equal(response?.headers.has('www-authenticate'), false);
        });
    }
});

test('erlaubt authentifizierte Mutationen nur mit exakt gleicher Origin', () => {
    const authorization = encodeBasicCredentials('admin', 'sehr:sicher');
    const request = createRequest({
        authorization,
        origin: 'https://gamerfeed.example',
        method: 'POST',
    });

    assert.equal(requireAdminMutation(request, ENV), null);
});

test('lehnt Mutationen ohne oder mit fremder Origin ab', async t => {
    const authorization = encodeBasicCredentials('admin', 'sehr:sicher');
    const origins = [
        ['ohne Origin', undefined],
        ['fremde Origin', 'https://example.org'],
        ['undurchsichtige Origin', 'null'],
    ];

    for (const [name, origin] of origins) {
        await t.test(name, () => {
            const response = requireAdminMutation(createRequest({
                authorization,
                origin,
                method: 'DELETE',
            }), ENV);

            assert.equal(response?.status, 403);
            assert.equal(response?.headers.get('cache-control'), 'no-store');
        });
    }
});

test('prüft bei Mutationen zuerst die Authentifizierung', () => {
    const response = requireAdminMutation(createRequest({
        origin: 'https://gamerfeed.example',
        method: 'PUT',
    }), ENV);

    assert.equal(response?.status, 401);
});
