import React, { act } from 'react';
import { createReactTestRoot } from './react-test-root.js';

export function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export function click(window, element) {
    element.dispatchEvent(new window.Event('click', {
        bubbles: true,
        cancelable: true,
    }));
}

/**
 * Tastaturereignis direkt am Element statt am Dokument: die Reiterleiste
 * behandelt Pfeiltasten über einen React-`onKeyDown` am jeweiligen Reiter.
 */
export function pressKey(window, element, key) {
    const event = new window.Event('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'key', { value: key });
    element.dispatchEvent(event);
    return event;
}

// Das Admin-Panel protokolliert seinen Statusabgleich; Fehlerpfade schreiben
// zusätzlich bewusst nach console.error.
export function silenceConsole() {
    const original = { log: console.log, warn: console.warn, error: console.error };
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};

    return () => {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
    };
}

export function installLocalStorage(window, entries = {}) {
    const values = new Map(Object.entries(entries));

    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
            clear: () => values.clear(),
            getItem: key => (values.has(key) ? values.get(key) : null),
            key: index => Array.from(values.keys())[index] ?? null,
            get length() {
                return values.size;
            },
            removeItem: key => values.delete(key),
            setItem: (key, value) => values.set(key, String(value)),
        },
    });

    return values;
}

/**
 * Rendert das echte Admin-Panel mit gestellten Leseantworten. Mutationen
 * beantwortet der Aufrufer selbst; hier geht es nur um Darstellung und
 * Tastaturbedienung.
 */
export async function renderAdminPanel(vite, {
    feeds = [],
    healthResponse,
    healthStatusCode = 200,
    localStorageEntries = {},
} = {}) {
    const requests = [];

    const testRoot = await createReactTestRoot({
        fetch: async (input, init = {}) => {
            const url = String(input);
            const method = (init.method ?? 'GET').toUpperCase();
            requests.push({ url, method });

            if (url.startsWith('/api/get-health-data')) {
                return jsonResponse(healthResponse ?? null, healthStatusCode);
            }
            if (url === '/api/feeds') {
                return jsonResponse(feeds);
            }
            // Der Ankündigungs-Reiter ist dauerhaft mitgemountet.
            if (url.startsWith('/api/announcement')) {
                return jsonResponse(null);
            }
            throw new Error(`Unerwartete Anfrage: ${method} ${url}`);
        },
    });

    installLocalStorage(testRoot.window, localStorageEntries);

    await vite.ssrLoadModule('/i18n.ts');
    const { AdminPanel } = await vite.ssrLoadModule('/components/admin/AdminPanel.tsx');

    await testRoot.render(React.createElement(AdminPanel));
    // Der Health-Abruf läuft in einem Effect; erst danach steht der Bericht.
    await act(async () => {
        await new Promise(resolve => setImmediate(resolve));
    });

    return { ...testRoot, requests };
}
