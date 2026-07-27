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

function createArticle(link) {
    return {
        id: 'artikel-1',
        title: 'Beispielartikel',
        source: 'Beispiel',
        publicationDate: new Date().toISOString(),
        summary: 'Zusammenfassung',
        link,
        imageUrl: 'https://bilder.example/titel.jpg',
        language: 'de',
    };
}

async function renderCard(testRoot, link) {
    await vite.ssrLoadModule('/i18n.ts');
    const { ArticleCard } = await vite.ssrLoadModule('/components/ArticleCard.tsx');

    await testRoot.render(React.createElement(ArticleCard, {
        article: createArticle(link),
        viewMode: 'grid',
        isFavorite: false,
        onToggleFavorite: () => {},
        onMuteSource: () => {},
    }));

    // Der Kartenlink ist der Anker, der den Artikeltitel enthält.
    return Array.from(testRoot.container.querySelectorAll('a'))
        .find(anchor => anchor.textContent.includes('Beispielartikel')) ?? null;
}

test('gibt gültige Artikel-Links unverändert als anklickbaren Anker aus', async () => {
    const testRoot = await createReactTestRoot();

    try {
        const anchor = await renderCard(testRoot, 'https://beispiel.example/artikel?a=1');
        assert.notEqual(anchor, null, 'kein Kartenlink gefunden');
        assert.equal(anchor.getAttribute('href'), 'https://beispiel.example/artikel?a=1');
        assert.equal(anchor.getAttribute('rel'), 'noopener noreferrer');
    } finally {
        await testRoot.cleanup();
    }
});

test('macht unzulässige Artikel-Links nicht anklickbar', async () => {
    for (const link of [
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'https://nutzer:geheim@beispiel.example/x',
        'nicht::parsebar',
        '',
    ]) {
        const testRoot = await createReactTestRoot();

        try {
            const anchor = await renderCard(testRoot, link);
            assert.notEqual(anchor, null, `kein Kartenlink für ${link}`);
            // Ohne href ist der Anker kein Link mehr; die Karte bleibt sichtbar.
            assert.equal(anchor.hasAttribute('href'), false, `${link} blieb anklickbar`);
            assert.match(anchor.textContent, /Beispielartikel/);
        } finally {
            await testRoot.cleanup();
        }
    }
});

test('lädt unzulässige Bildadressen nicht', async () => {
    const testRoot = await createReactTestRoot();

    try {
        await vite.ssrLoadModule('/i18n.ts');
        const { ArticleCard } = await vite.ssrLoadModule('/components/ArticleCard.tsx');
        const article = createArticle('https://beispiel.example/artikel');

        await testRoot.render(React.createElement(ArticleCard, {
            article: { ...article, imageUrl: 'javascript:alert(1)' },
            viewMode: 'grid',
            isFavorite: false,
            onToggleFavorite: () => {},
            onMuteSource: () => {},
        }));

        const image = testRoot.container.querySelector('img');
        assert.notEqual(image, null, 'kein Bildelement gefunden');
        assert.equal(image.hasAttribute('src'), false, 'unzulässige Bildadresse wurde gesetzt');
        assert.equal(image.getAttribute('alt'), 'Beispielartikel');
    } finally {
        await testRoot.cleanup();
    }
});
