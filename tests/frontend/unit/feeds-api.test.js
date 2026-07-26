import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FeedsApiError,
    createFeed,
    loadFeeds,
    removeFeed,
    saveFeed,
} from '../../../services/feeds-api.ts';

const existingFeed = {
    id: 'feed-1',
    name: 'GameStar',
    url: 'https://example.com/feed.xml',
    language: 'de',
    priority: 'primary',
    needsScraping: false,
};

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
    });
}

test('lädt Feed-Quellen über den gemeinsamen API-Endpunkt', async () => {
    const requests = [];
    const fetcher = async (input, init) => {
        requests.push({ input, init });
        return jsonResponse([existingFeed]);
    };

    const feeds = await loadFeeds(fetcher);

    assert.deepEqual(feeds, [existingFeed]);
    assert.deepEqual(requests, [{ input: '/api/feeds', init: undefined }]);
});

test('erstellt eine Feed-Quelle mit JSON-Payload', async () => {
    const { id: _id, ...newFeed } = existingFeed;
    let request;
    const fetcher = async (input, init) => {
        request = { input, init };
        return jsonResponse(existingFeed, { status: 201 });
    };

    const createdFeed = await createFeed(newFeed, fetcher);

    assert.deepEqual(createdFeed, existingFeed);
    assert.equal(request.input, '/api/feeds');
    assert.equal(request.init.method, 'POST');
    assert.deepEqual(request.init.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(request.init.body), newFeed);
});

test('aktualisiert eine Feed-Quelle mit JSON-Payload', async () => {
    let request;
    const fetcher = async (input, init) => {
        request = { input, init };
        return jsonResponse(existingFeed);
    };

    const savedFeed = await saveFeed(existingFeed, fetcher);

    assert.deepEqual(savedFeed, existingFeed);
    assert.equal(request.input, '/api/feeds');
    assert.equal(request.init.method, 'PUT');
    assert.deepEqual(request.init.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(request.init.body), existingFeed);
});

test('löscht eine Feed-Quelle und akzeptiert eine leere 204-Antwort', async () => {
    let request;
    const fetcher = async (input, init) => {
        request = { input, init };
        return new Response(null, { status: 204 });
    };

    await removeFeed(existingFeed.id, fetcher);

    assert.equal(request.input, '/api/feeds');
    assert.equal(request.init.method, 'DELETE');
    assert.deepEqual(request.init.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(request.init.body), { id: existingFeed.id });
});

test('übernimmt eine JSON-Fehlermeldung und den HTTP-Status', async () => {
    const fetcher = async () => jsonResponse(
        { error: 'Feed not found' },
        { status: 404 },
    );

    await assert.rejects(
        removeFeed(existingFeed.id, fetcher),
        error => {
            assert.ok(error instanceof FeedsApiError);
            assert.equal(error.message, 'Feed not found');
            assert.equal(error.status, 404);
            return true;
        },
    );
});

test('verwendet bei ungültigem Fehlertext eine stabile Ersatzmeldung', async () => {
    const fetcher = async () => new Response('Service unavailable', { status: 503 });

    await assert.rejects(
        createFeed(existingFeed, fetcher),
        error => {
            assert.ok(error instanceof FeedsApiError);
            assert.equal(error.message, 'Failed to add feed (503)');
            assert.equal(error.status, 503);
            return true;
        },
    );
});

test('reicht Netzwerkfehler an den Aufrufer weiter', async () => {
    const networkError = new TypeError('Network request failed');
    const fetcher = async () => {
        throw networkError;
    };

    await assert.rejects(loadFeeds(fetcher), error => error === networkError);
});
