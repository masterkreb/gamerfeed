import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createServer } from 'vite';
import { createReactTestRoot } from '../helpers/react-test-root.js';

// SEO1: Die laufende App muss `/gaming-news` mit einem gewoehnlichen,
// sichtbaren und lokalisierten Link erschliessen. Eine Sitemap ersetzt diese
// interne Verlinkung nicht.

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

async function renderFooter(language) {
    const testRoot = await createReactTestRoot();
    const { default: i18n } = await vite.ssrLoadModule('/i18n.ts');
    await i18n.changeLanguage(language);
    const { Footer } = await vite.ssrLoadModule('/components/Footer.tsx');

    await testRoot.render(React.createElement(Footer));

    const link = [...testRoot.container.querySelectorAll('a')].find(
        node => node.getAttribute('href') === '/gaming-news',
    );

    return { testRoot, link };
}

test('der Footer verlinkt /gaming-news sichtbar und ohne Skript', async () => {
    const { testRoot, link } = await renderFooter('de');

    try {
        assert.ok(link, 'kein Link auf /gaming-news im Footer');
        assert.equal(
            link.getAttribute('aria-hidden'),
            null,
            'der Link ist aus dem Accessibility-Tree entfernt',
        );
        assert.equal(link.hasAttribute('hidden'), false);
        assert.ok(
            !(link.getAttribute('class') ?? '').split(/\s+/).includes('sr-only'),
            'der Link ist nur fuer Screenreader sichtbar',
        );
        assert.equal(
            link.getAttribute('target'),
            null,
            'der interne Link soll im selben Tab navigieren',
        );
        assert.ok(
            (link.textContent ?? '').trim().length >= 5,
            'der Link hat keinen sprechenden Text',
        );
    } finally {
        await testRoot.cleanup();
    }
});

test('der Footer-Link ist lokalisiert und wechselt mit der Sprache', async () => {
    const de = await renderFooter('de');
    const germanText = (de.link?.textContent ?? '').trim();
    await de.testRoot.cleanup();

    const en = await renderFooter('en');
    const englishText = (en.link?.textContent ?? '').trim();
    await en.testRoot.cleanup();

    assert.ok(germanText.length > 0, 'kein deutscher Linktext');
    assert.ok(englishText.length > 0, 'kein englischer Linktext');
    assert.notEqual(
        germanText,
        englishText,
        'der Linktext ist in beiden Sprachen gleich - vermutlich fest verdrahtet',
    );

    // Ein fehlender Schluessel liefert bei i18next den Schluessel selbst
    // zurueck; das faellt sonst nicht auf.
    assert.ok(!germanText.includes('footer.'), `unaufgeloester Schluessel: ${germanText}`);
    assert.ok(!englishText.includes('footer.'), `unaufgeloester Schluessel: ${englishText}`);
});
