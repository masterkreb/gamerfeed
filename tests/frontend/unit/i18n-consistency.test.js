import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
    const { default: i18n } = await vite.ssrLoadModule('/i18n.ts');
    await i18n.changeLanguage('de');
    await vite.close();
});

function article() {
    return {
        id: 'artikel-1',
        title: 'Sprachtest',
        source: 'Quelle',
        publicationDate: '2020-01-31T12:00:00.000Z',
        summary: 'Zusammenfassung',
        link: 'https://beispiel.example/artikel',
        imageUrl: 'https://beispiel.example/bild.jpg',
        language: 'de',
    };
}

test('Sprachwechsel aktualisiert Artikeldatum und zentrale Accessible Names ohne Reload', async () => {
    const testRoot = await createReactTestRoot();
    Object.defineProperty(testRoot.window.navigator, 'language', {
        configurable: true,
        value: 'en-US',
    });
    const { default: i18n } = await vite.ssrLoadModule('/i18n.ts');
    const { ArticleCard } = await vite.ssrLoadModule('/components/ArticleCard.tsx');
    const { ErrorFallback } = await vite.ssrLoadModule('/components/ErrorFallback.tsx');
    const { Header } = await vite.ssrLoadModule('/components/Header.tsx');
    const { ScrollToTopButton } = await vite.ssrLoadModule('/components/ScrollToTopButton.tsx');

    function Probe() {
        return React.createElement(
            React.Fragment,
            null,
            React.createElement(Header, {
                theme: 'light',
                setTheme: () => {},
                viewMode: 'grid',
                setViewMode: () => {},
                isRefreshing: false,
                onRefresh: () => {},
                onOpenSettings: () => {},
                onLogoClick: () => {},
                currentView: 'news',
                onViewChange: () => {},
            }),
            React.createElement(ArticleCard, {
                article: article(),
                viewMode: 'grid',
                isFavorite: false,
                onToggleFavorite: () => {},
                onMuteSource: () => {},
            }),
            React.createElement(ScrollToTopButton),
            React.createElement(ErrorFallback, { onReset: () => {} }),
        );
    }

    try {
        await act(async () => {
            await i18n.changeLanguage('de');
        });
        await testRoot.render(React.createElement(Probe));

        assert.match(testRoot.container.textContent, /31\.01\.2020/);
        assert.notEqual(
            testRoot.container.querySelector('[aria-label="Zur Startseite und Filter zurücksetzen"]'),
            null,
        );
        assert.notEqual(
            testRoot.container.querySelector('[aria-label="Ansicht wechseln"]'),
            null,
        );
        assert.notEqual(
            testRoot.container.querySelector('[aria-label="Nach oben scrollen"]'),
            null,
        );
        assert.match(testRoot.container.textContent, /Hoppla! Etwas ist schiefgelaufen\./);

        await act(async () => {
            await i18n.changeLanguage('en');
        });

        assert.match(testRoot.container.textContent, /01\/31\/2020/);
        assert.notEqual(
            testRoot.container.querySelector('[aria-label="Go to homepage and reset filters"]'),
            null,
        );
        assert.notEqual(
            testRoot.container.querySelector('[aria-label="Change view mode"]'),
            null,
        );
        assert.notEqual(
            testRoot.container.querySelector('[aria-label="Scroll to top"]'),
            null,
        );
        assert.match(testRoot.container.textContent, /Oops! Something went wrong\./);
    } finally {
        await testRoot.cleanup();
        await i18n.changeLanguage('de');
    }
});

test('bearbeitete Komponenten enthalten keine bekannten hart codierten UI-Texte mehr', () => {
    const forbiddenByFile = {
        'components/ErrorFallback.tsx': [
            'Oops! Something went wrong.',
            'Refresh Page',
        ],
        'components/Header.tsx': [
            'aria-label="Go to homepage and reset filters"',
            'aria-label="Change view mode"',
            'aria-label={`Switch to ${option.mode} view`}',
        ],
        'components/LanguageSwitcher.tsx': [
            "name: 'English'",
            "name: 'Deutsch'",
        ],
        'components/ScrollToTopButton.tsx': [
            'aria-label="Scroll to top"',
        ],
        'components/admin/AdminPanel.tsx': [
            'aria-label="Admin Sections"',
        ],
        'components/admin/AnnouncementTab.tsx': [
            "label: 'Warnung'",
            "label: 'Wartung'",
            "label: 'Feier'",
            '.toLocaleString()',
        ],
        'components/admin/FeedFormModal.tsx': [
            '<option value="en">English</option>',
            '<option value="de">German</option>',
            '<option value="primary">primary</option>',
            '<option value="secondary">secondary</option>',
        ],
        'components/admin/FeedManagementTab.tsx': [
            "'No details available.'",
            'title="Checking..."',
            '>{feed.priority}</span>',
        ],
        'components/ArticleCard.tsx': [
            'navigator.language',
        ],
        'components/TrendsView.tsx': [
            '.toLocaleDateString()',
        ],
    };

    for (const [file, forbiddenTexts] of Object.entries(forbiddenByFile)) {
        const source = fs.readFileSync(file, 'utf8');
        for (const forbidden of forbiddenTexts) {
            assert.equal(
                source.includes(forbidden),
                false,
                `${file} enthält weiterhin ${JSON.stringify(forbidden)}`,
            );
        }
    }
});
