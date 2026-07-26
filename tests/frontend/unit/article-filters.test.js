import test from 'node:test';
import assert from 'node:assert/strict';
import {
    filterArticles,
    normalizeSearchText,
} from '../../../shared/article-filters.ts';

function createArticle(id, overrides = {}) {
    return {
        id,
        title: `Artikel ${id}`,
        source: 'GameStar',
        publicationDate: new Date(2026, 6, 26, 12).toISOString(),
        summary: `Zusammenfassung ${id}`,
        link: `https://example.com/${id}`,
        imageUrl: `https://example.com/${id}.jpg`,
        language: 'de',
        ...overrides,
    };
}

function createFilters(overrides = {}) {
    return {
        searchQuery: '',
        showFavoritesOnly: false,
        sourceFilter: 'all',
        languageFilter: 'all',
        timeFilter: 'all',
        favoriteIds: [],
        mutedSources: [],
        ...overrides,
    };
}

function articleIds(articles) {
    return articles.map(article => article.id);
}

test('normalisiert Suchtext inklusive Umlauten, Apostrophen und Bindestrichen', () => {
    assert.equal(
        normalizeSearchText('  Tom’s Äction—RPG `Test`  '),
        'toms action rpg test',
    );
});

test('findet normalisierte Suchbegriffe in Titel und Zusammenfassung', () => {
    const articles = [
        createArticle('title', { title: 'Tom’s Action-RPG' }),
        createArticle('summary', { summary: 'Ein großes Äction Abenteuer' }),
        createArticle('other', { title: 'Strategie', summary: 'Rundenbasiert' }),
    ];

    assert.deepEqual(
        articleIds(filterArticles(articles, createFilters({ searchQuery: 'Toms Action RPG' }))),
        ['title'],
    );
    assert.deepEqual(
        articleIds(filterArticles(articles, createFilters({ searchQuery: 'action abenteuer' }))),
        ['summary'],
    );
});

test('blendet stummgeschaltete Quellen außerhalb der Favoritenansicht aus', () => {
    const articles = [
        createArticle('visible'),
        createArticle('muted', { source: 'IGN' }),
    ];

    assert.deepEqual(
        articleIds(filterArticles(articles, createFilters({ mutedSources: ['IGN'] }))),
        ['visible'],
    );
});

test('zeigt in der Favoritenansicht nur Favoriten, auch aus stummgeschalteten Quellen', () => {
    const articles = [
        createArticle('regular'),
        createArticle('favorite', { source: 'IGN' }),
    ];

    assert.deepEqual(
        articleIds(filterArticles(articles, createFilters({
            showFavoritesOnly: true,
            favoriteIds: ['favorite'],
            mutedSources: ['IGN'],
        }))),
        ['favorite'],
    );
});

test('filtert nach Quelle und Sprache', () => {
    const articles = [
        createArticle('gamestar-de'),
        createArticle('ign-en', { source: 'IGN', language: 'en' }),
        createArticle('ign-de', { source: 'IGN' }),
    ];

    assert.deepEqual(
        articleIds(filterArticles(articles, createFilters({
            sourceFilter: 'IGN',
            languageFilter: 'en',
        }))),
        ['ign-en'],
    );
});

test('filtert heute anhand des lokalen Tagesbeginns', () => {
    const now = new Date(2026, 6, 26, 12);
    const articles = [
        createArticle('today-start', {
            publicationDate: new Date(2026, 6, 26, 0).toISOString(),
        }),
        createArticle('yesterday-end', {
            publicationDate: new Date(2026, 6, 25, 23, 59, 59, 999).toISOString(),
        }),
    ];

    assert.deepEqual(
        articleIds(filterArticles(articles, createFilters({ timeFilter: 'today' }), now)),
        ['today-start'],
    );
});

test('filtert gestern mit inklusiver Start- und exklusiver Endgrenze', () => {
    const now = new Date(2026, 6, 26, 12);
    const articles = [
        createArticle('before', {
            publicationDate: new Date(2026, 6, 24, 23, 59, 59, 999).toISOString(),
        }),
        createArticle('yesterday-start', {
            publicationDate: new Date(2026, 6, 25, 0).toISOString(),
        }),
        createArticle('yesterday-end', {
            publicationDate: new Date(2026, 6, 25, 23, 59, 59, 999).toISOString(),
        }),
        createArticle('today', {
            publicationDate: new Date(2026, 6, 26, 0).toISOString(),
        }),
    ];

    assert.deepEqual(
        articleIds(filterArticles(articles, createFilters({ timeFilter: 'yesterday' }), now)),
        ['yesterday-start', 'yesterday-end'],
    );
});

test('filtert die letzten sieben Tage relativ zum injizierten Zeitpunkt', () => {
    const now = new Date(2026, 6, 26, 12);
    const exactCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const articles = [
        createArticle('too-old', {
            publicationDate: new Date(exactCutoff.getTime() - 1).toISOString(),
        }),
        createArticle('exact-cutoff', {
            publicationDate: exactCutoff.toISOString(),
        }),
        createArticle('current', {
            publicationDate: now.toISOString(),
        }),
    ];

    assert.deepEqual(
        articleIds(filterArticles(articles, createFilters({ timeFilter: '7d' }), now)),
        ['exact-cutoff', 'current'],
    );
});

test('kombiniert Filter ohne die ursprüngliche Artikelliste zu verändern', () => {
    const articles = [
        createArticle('match', {
            title: 'Co-op Action-RPG',
            source: 'IGN',
            language: 'en',
        }),
        createArticle('wrong-language', {
            title: 'Co-op Action-RPG',
            source: 'IGN',
        }),
    ];
    const originalOrder = articleIds(articles);

    const result = filterArticles(articles, createFilters({
        searchQuery: 'co-op action rpg',
        sourceFilter: 'IGN',
        languageFilter: 'en',
    }));

    assert.deepEqual(articleIds(result), ['match']);
    assert.deepEqual(articleIds(articles), originalOrder);
});
