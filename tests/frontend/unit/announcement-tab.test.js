import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
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

const INACTIVE_ANNOUNCEMENT = Object.freeze({
    id: 'announcement-1785239000000',
    message: 'Abgeschaltete Wartungsmeldung.',
    type: 'maintenance',
    isActive: false,
    createdAt: '2026-07-28T11:43:20.000Z',
});

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function renderTab(fetcher) {
    const testRoot = await createReactTestRoot({ fetch: fetcher });
    await vite.ssrLoadModule('/i18n.ts');
    const { AnnouncementTab } = await vite.ssrLoadModule('/components/admin/AnnouncementTab.tsx');

    await testRoot.render(React.createElement(AnnouncementTab));
    return testRoot;
}

test('lädt die Ankündigung über den geschützten Admin-Abruf', async () => {
    const requests = [];
    const testRoot = await renderTab(async input => {
        requests.push(String(input));
        return jsonResponse(INACTIVE_ANNOUNCEMENT);
    });

    try {
        // Der öffentliche Endpunkt würde eine inaktive Ankündigung als null
        // ausliefern; der Admin käme dann nicht mehr an sie heran.
        assert.deepEqual(requests, ['/api/announcement?admin=1']);
    } finally {
        await testRoot.cleanup();
    }
});

test('eine inaktive Ankündigung ist im Admin vollständig sichtbar', async () => {
    const testRoot = await renderTab(async () => jsonResponse(INACTIVE_ANNOUNCEMENT));

    try {
        // Die Vorschau rendert den geladenen Text; sie ist der sichtbare Beleg
        // dafür, dass die Nachricht im Formularzustand angekommen ist.
        // (linkedom spiegelt den value-Zustand eines React-Textfelds nicht.)
        assert.match(testRoot.container.textContent, /Abgeschaltete Wartungsmeldung\./);
        assert.match(testRoot.container.textContent, /Inaktiv/);

        const aktivSchalter = testRoot.container.querySelector('input[type="checkbox"]');
        assert.equal(aktivSchalter.checked, false, 'der Aktiv-Schalter spiegelt den Zustand');
    } finally {
        await testRoot.cleanup();
    }
});

test('ohne gespeicherte Ankündigung bleibt das Formular leer und aktiv', async () => {
    const testRoot = await renderTab(async () => jsonResponse(null));

    try {
        assert.doesNotMatch(testRoot.container.textContent, /Inaktiv/);
        assert.equal(testRoot.container.querySelector('input[type="checkbox"]').checked, true);
    } finally {
        await testRoot.cleanup();
    }
});

test('ein Fehler beim Laden blockiert das Formular nicht', async () => {
    const testRoot = await renderTab(async () => jsonResponse({ error: 'nope', code: 'unauthorized' }, 401));

    try {
        assert.ok(testRoot.container.querySelector('textarea'), 'das Formular wird trotzdem angezeigt');
    } finally {
        await testRoot.cleanup();
    }
});
