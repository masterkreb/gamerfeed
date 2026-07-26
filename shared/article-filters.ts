import type { Article, TimeFilter } from '../types';

export interface ArticleFilters {
    searchQuery: string;
    showFavoritesOnly: boolean;
    sourceFilter: string;
    languageFilter: 'all' | Article['language'];
    timeFilter: TimeFilter;
    favoriteIds: readonly string[];
    mutedSources: readonly string[];
}

export function normalizeSearchText(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['’`]/g, '')
        .replace(/[-–—]/g, ' ')
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function matchesTimeFilter(
    publicationDate: string,
    timeFilter: Exclude<TimeFilter, 'all'>,
    now: Date,
): boolean {
    const articleDate = new Date(publicationDate);
    const todayStart = new Date(now.getTime());
    todayStart.setHours(0, 0, 0, 0);

    if (timeFilter === 'today') {
        return articleDate >= todayStart;
    }

    if (timeFilter === 'yesterday') {
        const yesterdayStart = new Date(todayStart.getTime());
        yesterdayStart.setDate(yesterdayStart.getDate() - 1);
        return articleDate >= yesterdayStart && articleDate < todayStart;
    }

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return articleDate >= sevenDaysAgo;
}

export function filterArticles(
    articles: Article[],
    filters: ArticleFilters,
    now = new Date(),
): Article[] {
    let result = articles;

    if (!filters.showFavoritesOnly && filters.mutedSources.length > 0) {
        result = result.filter(article => !filters.mutedSources.includes(article.source));
    }

    if (filters.searchQuery) {
        const normalizedQuery = normalizeSearchText(filters.searchQuery);
        result = result.filter(article =>
            normalizeSearchText(article.title).includes(normalizedQuery)
            || normalizeSearchText(article.summary).includes(normalizedQuery)
        );
    }

    if (filters.showFavoritesOnly) {
        result = result.filter(article => filters.favoriteIds.includes(article.id));
    }

    if (filters.sourceFilter !== 'all') {
        result = result.filter(article => article.source === filters.sourceFilter);
    }

    if (filters.languageFilter !== 'all') {
        result = result.filter(article => article.language === filters.languageFilter);
    }

    const timeFilter = filters.timeFilter;
    if (timeFilter !== 'all') {
        result = result.filter(article =>
            matchesTimeFilter(article.publicationDate, timeFilter, now)
        );
    }

    return result;
}
