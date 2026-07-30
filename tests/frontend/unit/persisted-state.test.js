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

test.after(async () => {
    await vite.close();
});

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial));

    return {
        get length() {
            return values.size;
        },
        clear() {
            values.clear();
        },
        getItem(key) {
            return values.get(key) ?? null;
        },
        key(index) {
            return [...values.keys()][index] ?? null;
        },
        removeItem(key) {
            values.delete(key);
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
    };
}

function dispatchStorageEvent(window, properties) {
    const event = new window.Event('storage');
    Object.defineProperties(event, {
        key: { value: properties.key },
        newValue: { value: properties.newValue },
        storageArea: { value: properties.storageArea },
    });
    window.dispatchEvent(event);
}

test('Decoder akzeptieren nur die dokumentierten Enums und String-Arrays', async () => {
    const {
        decodeNullableString,
        decodeStringArray,
        decodeTheme,
        decodeViewMode,
    } = await vite.ssrLoadModule('/shared/persisted-state.ts');

    assert.equal(decodeTheme('dark'), 'dark');
    assert.equal(decodeTheme('sepia'), undefined);
    assert.equal(decodeViewMode('compact'), 'compact');
    assert.equal(decodeViewMode('tiles'), undefined);
    assert.deepEqual(decodeStringArray(['GameStar', 'IGN']), ['GameStar', 'IGN']);
    assert.equal(decodeStringArray(['GameStar', 17]), undefined);
    assert.equal(decodeStringArray({ 0: 'GameStar' }), undefined);
    assert.equal(decodeNullableString('meldung-1'), 'meldung-1');
    assert.equal(decodeNullableString(null), null);
    assert.equal(decodeNullableString(17), undefined);
});

test('cachedNews fällt bei kaputtem JSON und falschen Strukturen vollständig zurück', async () => {
    const {
        decodeCachedNews,
        parsePersistedValue,
    } = await vite.ssrLoadModule('/shared/persisted-state.ts');
    const fallback = { articles: [], timestamp: 0 };

    assert.equal(parsePersistedValue('{', decodeCachedNews, fallback), fallback);
    assert.equal(
        parsePersistedValue(JSON.stringify({ articles: {}, timestamp: 1 }), decodeCachedNews, fallback),
        fallback,
    );
    assert.equal(
        parsePersistedValue(JSON.stringify({
            articles: [{ id: 'unvollständig' }],
            timestamp: 1,
        }), decodeCachedNews, fallback),
        fallback,
    );
    assert.equal(
        parsePersistedValue(JSON.stringify({
            articles: [{
                id: 'artikel-1',
                title: 'Titel',
                source: 'Quelle',
                publicationDate: 'kein Datum',
                summary: 'Zusammenfassung',
                link: 'https://beispiel.example/artikel',
                imageUrl: 'https://beispiel.example/bild.jpg',
                language: 'de',
            }],
            timestamp: 1,
        }), decodeCachedNews, fallback),
        fallback,
    );
    assert.equal(
        parsePersistedValue(JSON.stringify({ articles: [], timestamp: 'gestern' }), decodeCachedNews, fallback),
        fallback,
    );
});

test('cachedNews akzeptiert einen vollständigen Legacy-Eintrag', async () => {
    const {
        decodeCachedNews,
        parsePersistedValue,
    } = await vite.ssrLoadModule('/shared/persisted-state.ts');
    const fallback = { articles: [], timestamp: 0 };
    const stored = {
        articles: [{
            id: 'artikel-1',
            title: 'Titel',
            source: 'Quelle',
            publicationDate: '2026-07-30T09:00:00.000Z',
            summary: 'Zusammenfassung',
            link: 'https://beispiel.example/artikel',
            imageUrl: 'https://beispiel.example/bild.jpg',
            language: 'de',
        }],
        timestamp: 123,
    };

    assert.deepEqual(
        parsePersistedValue(JSON.stringify(stored), decodeCachedNews, fallback),
        stored,
    );
});

test('cachedNews normalisiert eine gültige Generation zusammen mit ihren Artikeln', async () => {
    const {
        decodeCachedNews,
        parsePersistedValue,
    } = await vite.ssrLoadModule('/shared/persisted-state.ts');
    const fallback = { articles: [], timestamp: 0 };
    const createdAt = '2026-07-30T09:00:00.000Z';
    const stored = {
        articles: [],
        timestamp: 123,
        snapshot: {
            schemaVersion: 1,
            snapshotId: `${Date.parse(createdAt)}-lauf-1`,
            createdAt,
            articleCount: 0,
            runId: 'lauf-1',
        },
    };

    assert.deepEqual(
        parsePersistedValue(JSON.stringify(stored), decodeCachedNews, fallback),
        stored,
    );
});

test('useLocalStorage verwirft eine formal gültige, aber falsch geformte Liste', async () => {
    const testRoot = await createReactTestRoot();
    const storage = createStorage({
        favorites: JSON.stringify(['artikel-1', 17]),
    });
    Object.defineProperty(testRoot.window, 'localStorage', {
        configurable: true,
        value: storage,
    });
    const { useLocalStorage } = await vite.ssrLoadModule('/hooks/useLocalStorage.ts');
    const { decodeStringArray } = await vite.ssrLoadModule('/shared/persisted-state.ts');

    function Probe() {
        const [value] = useLocalStorage('favorites', [], decodeStringArray);
        return React.createElement('output', null, JSON.stringify(value));
    }

    try {
        await testRoot.render(React.createElement(Probe));
        assert.equal(testRoot.container.textContent, '[]');
    } finally {
        await testRoot.cleanup();
    }
});

test('useLocalStorage setzt einen in einem anderen Tab entfernten Key auf den Default', async () => {
    const testRoot = await createReactTestRoot();
    const storage = createStorage({
        theme: JSON.stringify('dark'),
    });
    Object.defineProperty(testRoot.window, 'localStorage', {
        configurable: true,
        value: storage,
    });
    const { useLocalStorage } = await vite.ssrLoadModule('/hooks/useLocalStorage.ts');
    const { decodeTheme } = await vite.ssrLoadModule('/shared/persisted-state.ts');

    function Probe() {
        const [value] = useLocalStorage('theme', 'light', decodeTheme);
        return React.createElement('output', null, value);
    }

    try {
        await testRoot.render(React.createElement(Probe));
        assert.equal(testRoot.container.textContent, 'dark');

        await act(async () => {
            dispatchStorageEvent(testRoot.window, {
                key: 'theme',
                newValue: null,
                storageArea: storage,
            });
        });
        assert.equal(testRoot.container.textContent, 'light');

        await act(async () => {
            dispatchStorageEvent(testRoot.window, {
                key: 'theme',
                newValue: JSON.stringify('dark'),
                storageArea: storage,
            });
        });
        assert.equal(testRoot.container.textContent, 'dark');

        await act(async () => {
            dispatchStorageEvent(testRoot.window, {
                key: null,
                newValue: null,
                storageArea: storage,
            });
        });
        assert.equal(testRoot.container.textContent, 'light');
    } finally {
        await testRoot.cleanup();
    }
});

test('kaputtes JSON aus einem storage-Event wirft nie und setzt den Default', async () => {
    const testRoot = await createReactTestRoot();
    const storage = createStorage({
        viewMode: JSON.stringify('list'),
    });
    Object.defineProperty(testRoot.window, 'localStorage', {
        configurable: true,
        value: storage,
    });
    const { useLocalStorage } = await vite.ssrLoadModule('/hooks/useLocalStorage.ts');
    const { decodeViewMode } = await vite.ssrLoadModule('/shared/persisted-state.ts');

    function Probe() {
        const [value] = useLocalStorage('viewMode', 'grid', decodeViewMode);
        return React.createElement('output', null, value);
    }

    try {
        await testRoot.render(React.createElement(Probe));
        assert.equal(testRoot.container.textContent, 'list');

        await act(async () => {
            dispatchStorageEvent(testRoot.window, {
                key: 'viewMode',
                newValue: '{',
                storageArea: storage,
            });
        });
        assert.equal(testRoot.container.textContent, 'grid');
    } finally {
        await testRoot.cleanup();
    }
});

test('ein blockierter Schreibzugriff verliert den aktuellen React-Zustand nicht', async () => {
    const testRoot = await createReactTestRoot();
    const storage = createStorage();
    storage.setItem = () => {
        throw new Error('Speicher gesperrt');
    };
    Object.defineProperty(testRoot.window, 'localStorage', {
        configurable: true,
        value: storage,
    });
    const { useLocalStorage } = await vite.ssrLoadModule('/hooks/useLocalStorage.ts');
    const { decodeTheme } = await vite.ssrLoadModule('/shared/persisted-state.ts');

    function Probe() {
        const [value, setValue] = useLocalStorage('theme', 'light', decodeTheme);
        return React.createElement(
            'button',
            { onClick: () => setValue('dark') },
            value,
        );
    }

    try {
        await testRoot.render(React.createElement(Probe));
        const button = testRoot.container.querySelector('button');
        assert.notEqual(button, null);

        await act(async () => {
            button.dispatchEvent(new testRoot.window.Event('click', {
                bubbles: true,
                cancelable: true,
            }));
        });
        assert.equal(button.textContent, 'dark');
    } finally {
        await testRoot.cleanup();
    }
});
