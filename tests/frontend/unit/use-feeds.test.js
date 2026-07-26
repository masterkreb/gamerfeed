import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createServer } from 'vite';
import { createReactTestRoot } from '../helpers/react-test-root.js';

const vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    logLevel: 'silent',
    server: {
        middlewareMode: true,
    },
});

const { useFeeds } = await vite.ssrLoadModule('/hooks/useFeeds.ts');

test.after(async () => {
    await vite.close();
});

function createDeferred() {
    let resolve;
    const promise = new Promise(resolvePromise => {
        resolve = resolvePromise;
    });

    return { promise, resolve };
}

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function renderHook(fetcher) {
    const testRoot = await createReactTestRoot({ fetch: fetcher });
    let current;

    function Harness() {
        current = useFeeds();
        return React.createElement(
            'output',
            { 'data-load-status': current.loadStatus },
            String(current.feeds.length),
        );
    }

    await testRoot.render(React.createElement(Harness));

    return {
        get current() {
            return current;
        },
        async cleanup() {
            await testRoot.cleanup();
        },
    };
}

test('wechselt nach einem Ladefehler über Retry zu erfolgreichen Feed-Daten', async () => {
    const retryRequest = createDeferred();
    let requestCount = 0;
    const fetcher = async () => {
        requestCount += 1;
        if (requestCount === 1) {
            return jsonResponse({ error: 'Temporarily unavailable' }, 503);
        }
        return retryRequest.promise;
    };
    const originalConsoleError = console.error;
    console.error = () => {};
    let hook;

    try {
        hook = await renderHook(fetcher);
        assert.equal(hook.current.loadStatus, 'error');
        assert.deepEqual(hook.current.feeds, []);

        let retryPromise;
        act(() => {
            retryPromise = hook.current.reloadFeeds();
        });
        assert.equal(hook.current.loadStatus, 'loading');

        const feed = {
            id: 'feed-1',
            name: 'GameStar',
            url: 'https://example.com/feed.xml',
            language: 'de',
            priority: 'primary',
            needsScraping: false,
        };

        await act(async () => {
            retryRequest.resolve(jsonResponse([feed]));
            await retryPromise;
        });

        assert.equal(hook.current.loadStatus, 'ready');
        assert.deepEqual(hook.current.feeds, [feed]);
        assert.equal(requestCount, 2);
    } finally {
        console.error = originalConsoleError;
        await hook?.cleanup();
    }
});

test('ignoriert eine verspätete Antwort eines älteren Ladeversuchs', async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    let requestCount = 0;
    const fetcher = async () => {
        requestCount += 1;
        return requestCount === 1 ? firstRequest.promise : secondRequest.promise;
    };
    const hook = await renderHook(fetcher);

    try {
        let latestRequest;
        act(() => {
            latestRequest = hook.current.reloadFeeds();
        });

        await act(async () => {
            secondRequest.resolve(jsonResponse([]));
            await latestRequest;
        });
        assert.equal(hook.current.loadStatus, 'ready');

        await act(async () => {
            firstRequest.resolve(jsonResponse([{
                id: 'stale-feed',
                name: 'Veraltet',
                url: 'https://example.com/stale.xml',
                language: 'de',
                priority: 'secondary',
            }]));
            await firstRequest.promise;
        });

        assert.equal(hook.current.loadStatus, 'ready');
        assert.deepEqual(hook.current.feeds, []);
    } finally {
        await hook.cleanup();
    }
});
