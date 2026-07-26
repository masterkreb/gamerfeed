import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createServer } from 'vite';
import {
    createReactTestRoot,
    dispatchKeyboardEvent,
} from '../helpers/react-test-root.js';

const vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    logLevel: 'silent',
    server: {
        middlewareMode: true,
    },
});

test.after(async () => {
    await vite.close();
});

function installLocalStorage(window) {
    const values = new Map();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            clear: () => values.clear(),
            getItem: key => values.get(key) ?? null,
            key: index => Array.from(values.keys())[index] ?? null,
            get length() {
                return values.size;
            },
            removeItem: key => values.delete(key),
            setItem: (key, value) => values.set(key, String(value)),
        },
    });
}

function installMatchMedia(window) {
    const listeners = new Set();
    const query = {
        matches: false,
        media: '(min-width: 64rem)',
        addEventListener: (type, listener) => {
            if (type === 'change') {
                listeners.add(listener);
            }
        },
        removeEventListener: (type, listener) => {
            if (type === 'change') {
                listeners.delete(listener);
            }
        },
    };

    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => query,
    });

    return {
        switchToDesktop() {
            query.matches = true;
            for (const listener of listeners) {
                listener({ matches: true });
            }
        },
    };
}

function click(window, element) {
    element.dispatchEvent(new window.Event('click', {
        bubbles: true,
        cancelable: true,
    }));
}

test('macht den mobilen Filterdialog nur geöffnet erreichbar und schließt ihn beim Desktop-Wechsel', async () => {
    const testRoot = await createReactTestRoot();
    installLocalStorage(testRoot.window);
    const media = installMatchMedia(testRoot.window);
    await vite.ssrLoadModule('/i18n.ts');
    const [
        { FilterBar },
        { FilterProvider },
    ] = await Promise.all([
        vite.ssrLoadModule('/components/FilterBar.tsx'),
        vite.ssrLoadModule('/contexts/FilterContext.tsx'),
    ]);

    try {
        await testRoot.render(
            React.createElement(
                FilterProvider,
                null,
                React.createElement(FilterBar, {
                    sources: [
                        { name: 'GameStar', language: 'de' },
                        { name: 'IGN', language: 'en' },
                    ],
                    favoritesCount: 1,
                    filteredArticlesCount: 3,
                }),
            ),
        );

        const trigger = testRoot.container.querySelector(
            'button[aria-controls="mobile-filter-dialog"]',
        );
        const dialog = testRoot.container.querySelector('#mobile-filter-dialog');

        assert.equal(trigger.getAttribute('aria-expanded'), 'false');
        assert.equal(dialog.getAttribute('aria-hidden'), 'true');
        assert.equal(dialog.hasAttribute('inert'), true);
        assert.equal(testRoot.container.querySelectorAll('#desktop-time-filter').length, 1);
        assert.equal(testRoot.container.querySelectorAll('#mobile-time-filter').length, 1);
        assert.equal(testRoot.container.querySelectorAll('#desktop-source-filter').length, 1);
        assert.equal(testRoot.container.querySelectorAll('#mobile-source-filter').length, 1);

        trigger.focus();
        await act(async () => {
            click(testRoot.window, trigger);
        });

        const closeButton = dialog.querySelector('button[aria-label]');
        assert.equal(trigger.getAttribute('aria-expanded'), 'true');
        assert.equal(dialog.hasAttribute('aria-hidden'), false);
        assert.equal(dialog.hasAttribute('inert'), false);
        assert.equal(dialog.getAttribute('aria-modal'), 'true');
        assert.equal(testRoot.window.document.activeElement, closeButton);

        await act(async () => {
            dispatchKeyboardEvent(testRoot.window, 'Escape');
        });

        assert.equal(trigger.getAttribute('aria-expanded'), 'false');
        assert.equal(dialog.getAttribute('aria-hidden'), 'true');
        assert.equal(dialog.hasAttribute('inert'), true);
        assert.equal(testRoot.window.document.activeElement, trigger);

        await act(async () => {
            click(testRoot.window, trigger);
        });
        await act(async () => {
            media.switchToDesktop();
        });

        assert.equal(trigger.getAttribute('aria-expanded'), 'false');
        assert.equal(dialog.getAttribute('aria-hidden'), 'true');
        assert.equal(dialog.hasAttribute('inert'), true);
    } finally {
        await testRoot.cleanup();
    }
});
