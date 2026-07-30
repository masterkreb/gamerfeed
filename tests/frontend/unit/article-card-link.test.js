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

function click(window, element) {
    element.dispatchEvent(new window.Event('click', {
        bubbles: true,
        cancelable: true,
    }));
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

test('verschachtelt in keinem Layout Aktionsbuttons innerhalb des Artikel-Links', async () => {
    await vite.ssrLoadModule('/i18n.ts');
    const { ArticleCard } = await vite.ssrLoadModule('/components/ArticleCard.tsx');

    for (const viewMode of ['grid', 'list', 'compact']) {
        const testRoot = await createReactTestRoot();

        try {
            await testRoot.render(React.createElement(ArticleCard, {
                article: createArticle('https://beispiel.example/artikel'),
                viewMode,
                isFavorite: false,
                onToggleFavorite: () => {},
                onMuteSource: () => {},
            }));

            const articleLink = Array.from(testRoot.container.querySelectorAll('a'))
                .find(anchor => anchor.textContent.includes('Beispielartikel'));
            assert.notEqual(articleLink, null, `kein Artikel-Link im Layout ${viewMode}`);
            assert.equal(
                articleLink.querySelectorAll('button').length,
                0,
                `Layout ${viewMode} enthält weiterhin einen Button im Link`,
            );

            for (const button of testRoot.container.querySelectorAll('button')) {
                assert.equal(
                    button.closest('a'),
                    null,
                    `Layout ${viewMode} verschachtelt ${button.getAttribute('aria-label') ?? 'einen Button'} im Link`,
                );
            }
        } finally {
            await testRoot.cleanup();
        }
    }
});

test('benennt den Optionsdialog und gibt den Fokus nach schnellem Escape dauerhaft zurück', async () => {
    const testRoot = await createReactTestRoot();
    await vite.ssrLoadModule('/i18n.ts');
    const { ArticleCard } = await vite.ssrLoadModule('/components/ArticleCard.tsx');

    try {
        await testRoot.render(React.createElement(ArticleCard, {
            article: createArticle('https://beispiel.example/artikel'),
            viewMode: 'grid',
            isFavorite: false,
            onToggleFavorite: () => {},
            onMuteSource: () => {},
        }));

        const trigger = testRoot.container.querySelector('button[aria-haspopup="dialog"]');
        const dialog = testRoot.container.querySelector('[role="dialog"]');
        assert.notEqual(trigger, null, 'Optionsauslöser fehlt');
        assert.notEqual(dialog, null, 'Optionsdialog fehlt');
        assert.ok(
            dialog.getAttribute('aria-label') || dialog.getAttribute('aria-labelledby'),
            'Optionsdialog besitzt keinen Accessible Name',
        );

        trigger.focus();
        await act(async () => {
            click(testRoot.window, trigger);
        });
        assert.equal(dialog.getAttribute('aria-hidden'), 'false');

        await act(async () => {
            dispatchKeyboardEvent(testRoot.window, 'Escape');
        });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 70));
        });

        assert.equal(dialog.getAttribute('aria-hidden'), 'true');
        assert.equal(testRoot.window.document.activeElement, trigger);
    } finally {
        await testRoot.cleanup();
    }
});

test('rendert alle sichtbaren Artikelwerte bei gleicher ID neu', async () => {
    await vite.ssrLoadModule('/i18n.ts');
    const { ArticleCard } = await vite.ssrLoadModule('/components/ArticleCard.tsx');
    const onToggleFavorite = () => {};
    const onMuteSource = () => {};
    const original = {
        ...createArticle('https://beispiel.example/alt'),
        publicationDate: '2020-01-02T12:00:00.000Z',
    };
    const cases = [
        {
            name: 'Zusammenfassung',
            article: { ...original, summary: 'Neue Zusammenfassung' },
            assertUpdated(container) {
                assert.match(container.textContent, /Neue Zusammenfassung/);
            },
        },
        {
            name: 'Link',
            article: { ...original, link: 'https://beispiel.example/neu' },
            assertUpdated(container) {
                const articleLink = Array.from(container.querySelectorAll('a'))
                    .find(anchor => anchor.textContent.includes('Beispielartikel'));
                assert.equal(articleLink?.getAttribute('href'), 'https://beispiel.example/neu');
            },
        },
        {
            name: 'Quelle',
            article: { ...original, source: 'Neue Quelle' },
            assertUpdated(container) {
                assert.match(container.textContent, /Neue Quelle/);
            },
        },
        {
            name: 'Sprache',
            article: { ...original, language: 'en' },
            assertUpdated(container) {
                assert.equal(container.querySelector('span.uppercase')?.textContent, 'en');
            },
        },
        {
            name: 'Datum',
            article: { ...original, publicationDate: '2021-03-04T12:00:00.000Z' },
            assertUpdated(container) {
                assert.match(container.textContent, /2021/);
                assert.doesNotMatch(container.textContent, /2020/);
            },
        },
    ];

    for (const testCase of cases) {
        const testRoot = await createReactTestRoot();
        const props = {
            viewMode: 'grid',
            isFavorite: false,
            onToggleFavorite,
            onMuteSource,
        };

        try {
            await testRoot.render(React.createElement(ArticleCard, {
                ...props,
                article: original,
            }));
            await testRoot.render(React.createElement(ArticleCard, {
                ...props,
                article: testCase.article,
            }));
            testCase.assertUpdated(testRoot.container);
        } catch (error) {
            error.message = `${testCase.name}: ${error.message}`;
            throw error;
        } finally {
            await testRoot.cleanup();
        }
    }
});
