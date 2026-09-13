import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedRefreshHandler } from '../../../server/feed-refresh-handler.js';
import { ADMIN_ENV, adminRequest, readJson } from '../helpers/admin-api.js';

const ENV = { ...ADMIN_ENV, GITHUB_FEED_DISPATCH_TOKEN: 'secret-test-token' };
const PATH = '/api/refresh-feeds';

test('manueller Start fordert nur den festen Workflow auf main an', async () => {
    const calls = [];
    const handler = createFeedRefreshHandler({
        env: ENV,
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return new Response(null, { status: 204 });
        },
    });

    const response = await handler(adminRequest(PATH, { method: 'POST' }));
    assert.equal(response.status, 202);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(await readJson(response), { status: 'accepted' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.github.com/repos/masterkreb/gamerfeed/actions/workflows/update-feeds.yml/dispatches');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), { ref: 'main' });
    assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-test-token');
    assert.equal(calls[0].options.redirect, 'error');
    assert.ok(calls[0].options.signal);
});

test('ohne Admin-Zugang oder passende Origin wird GitHub nie aufgerufen', async () => {
    let calls = 0;
    const handler = createFeedRefreshHandler({ env: ENV, fetchImpl: async () => { calls += 1; } });

    const unauthorized = await handler(adminRequest(PATH, { method: 'POST', authenticated: false }));
    assert.equal(unauthorized.status, 401);
    assert.equal((await readJson(unauthorized)).code, 'unauthorized');

    const forbidden = await handler(adminRequest(PATH, { method: 'POST', origin: 'https://other.example' }));
    assert.equal(forbidden.status, 403);
    assert.equal((await readJson(forbidden)).code, 'forbidden');

    const wrongMethod = await handler(adminRequest(PATH, { method: 'GET' }));
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('Allow'), 'POST');
    assert.equal(calls, 0);
});

test('fehlendes Token und GitHub-Fehler liefern keine internen Details aus', async () => {
    const missing = createFeedRefreshHandler({ env: ADMIN_ENV });
    const missingResponse = await missing(adminRequest(PATH, { method: 'POST' }));
    assert.equal(missingResponse.status, 503);
    assert.equal((await readJson(missingResponse)).code, 'dispatch_unavailable');

    const errors = [];
    const rejected = createFeedRefreshHandler({
        env: ENV,
        fetchImpl: async () => new Response('secret-test-token provider details', { status: 403 }),
        logger: { error: (...args) => errors.push(args) },
    });
    const response = await rejected(adminRequest(PATH, { method: 'POST' }));
    assert.equal(response.status, 502);
    assert.equal((await readJson(response)).code, 'dispatch_failed');
    assert.ok(!JSON.stringify(errors).includes('secret-test-token'));
});
