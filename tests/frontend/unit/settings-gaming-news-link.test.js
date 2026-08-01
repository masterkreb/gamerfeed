import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createServer } from 'vite';
import { createReactTestRoot } from '../helpers/react-test-root.js';

// Die endlose Artikelliste hat bewusst keinen Footer. Der normale interne Link
// zur servergerenderten Uebersicht bleibt im erreichbaren Reiter "Ueber uns".

const vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    logLevel: 'silent',
    server: {
        middlewareMode: true,
    },
});

test.after(async () => {
    const { default: i18n } = await vite.ssrLoadModule('/i18n.ts');
    await i18n.changeLanguage('de');
    await vite.close();
});

async function renderAboutLink(language) {
    const testRoot = await createReactTestRoot();
    const { default: i18n } = await vite.ssrLoadModule('/i18n.ts');
    await i18n.changeLanguage(language);
    const { SettingsModal } = await vite.ssrLoadModule('/components/SettingsModal.tsx');

    await testRoot.render(React.createElement(SettingsModal, {
        isOpen: true,
        onClose: () => {},
        allSources: [],
        mutedSources: [],
        setMutedSources: () => {},
    }));

    const aboutTab = testRoot.container.querySelector(
        '[role="tab"][aria-controls="settings-panel-about"]',
    );
    assert.ok(aboutTab, 'der Reiter "Ueber uns" fehlt');

    await act(async () => {
        aboutTab.dispatchEvent(new testRoot.window.Event('click', {
            bubbles: true,
            cancelable: true,
        }));
    });

    const panel = testRoot.container.querySelector('#settings-panel-about');
    const link = panel?.querySelector('a[href="/gaming-news"]') ?? null;
    return { link, panel, testRoot };
}

test('Ueber uns verlinkt /gaming-news sichtbar und als normalen internen Link', async () => {
    const { link, panel, testRoot } = await renderAboutLink('de');

    try {
        assert.ok(panel && !panel.hasAttribute('hidden'), 'der About-Bereich ist nicht sichtbar');
        assert.ok(link, 'kein Link auf /gaming-news im About-Bereich');
        assert.equal(link.getAttribute('target'), null, 'der interne Link oeffnet einen neuen Tab');
        assert.equal(link.getAttribute('onclick'), null, 'der Link ist von JavaScript abhaengig');
        assert.ok((link.textContent ?? '').trim().length >= 5, 'der Linktext ist nicht sprechend');
    } finally {
        await testRoot.cleanup();
    }
});

test('der Link zur Gaming-News-Uebersicht ist auf Deutsch und Englisch lokalisiert', async () => {
    const de = await renderAboutLink('de');
    const germanText = (de.link?.textContent ?? '').trim();
    await de.testRoot.cleanup();

    const en = await renderAboutLink('en');
    const englishText = (en.link?.textContent ?? '').trim();
    await en.testRoot.cleanup();

    assert.ok(germanText.length > 0, 'kein deutscher Linktext');
    assert.ok(englishText.length > 0, 'kein englischer Linktext');
    assert.notEqual(germanText, englishText, 'der Linktext ist nicht lokalisiert');
    assert.ok(!germanText.includes('settings.'), `unaufgeloester Schluessel: ${germanText}`);
    assert.ok(!englishText.includes('settings.'), `unaufgeloester Schluessel: ${englishText}`);
});
