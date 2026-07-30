import type {
    Article,
    CachedNews,
    NewsSnapshotPointer,
    Theme,
    ViewMode,
} from '../types';
import { normalizeSnapshotPointer } from './news-snapshot.js';

export type PersistedStateDecoder<T> = (value: unknown) => T | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decodeArticle(value: unknown): Article | undefined {
    if (!isRecord(value)) return undefined;
    if (
        typeof value.id !== 'string'
        || typeof value.title !== 'string'
        || typeof value.source !== 'string'
        || typeof value.publicationDate !== 'string'
        || !Number.isFinite(Date.parse(value.publicationDate))
        || typeof value.summary !== 'string'
        || typeof value.link !== 'string'
        || typeof value.imageUrl !== 'string'
        || (value.language !== 'de' && value.language !== 'en')
        || (value.needsScraping !== undefined && typeof value.needsScraping !== 'boolean')
    ) {
        return undefined;
    }

    return {
        id: value.id,
        title: value.title,
        source: value.source,
        publicationDate: value.publicationDate,
        summary: value.summary,
        link: value.link,
        imageUrl: value.imageUrl,
        language: value.language,
        ...(value.needsScraping === undefined
            ? {}
            : { needsScraping: value.needsScraping }),
    };
}

export const decodeTheme: PersistedStateDecoder<Theme> = value => (
    value === 'light' || value === 'dark' ? value : undefined
);

export const decodeViewMode: PersistedStateDecoder<ViewMode> = value => (
    value === 'grid' || value === 'list' || value === 'compact'
        ? value
        : undefined
);

export const decodeStringArray: PersistedStateDecoder<string[]> = value => (
    Array.isArray(value) && value.every(item => typeof item === 'string')
        ? [...value]
        : undefined
);

export const decodeNullableString: PersistedStateDecoder<string | null> = value => (
    value === null || typeof value === 'string' ? value : undefined
);

export const decodeCachedNews: PersistedStateDecoder<CachedNews> = value => {
    if (
        !isRecord(value)
        || !Array.isArray(value.articles)
        || typeof value.timestamp !== 'number'
        || !Number.isSafeInteger(value.timestamp)
        || value.timestamp < 0
    ) {
        return undefined;
    }

    const articles: Article[] = [];
    for (const rawArticle of value.articles) {
        const article = decodeArticle(rawArticle);
        if (article === undefined) return undefined;
        articles.push(article);
    }

    const decoded: CachedNews = {
        articles,
        timestamp: value.timestamp,
    };

    if (Object.prototype.hasOwnProperty.call(value, 'snapshot')) {
        if (value.snapshot === null) {
            decoded.snapshot = null;
        } else {
            const snapshot = normalizeSnapshotPointer(value.snapshot) as NewsSnapshotPointer | null;
            if (snapshot === null) return undefined;
            decoded.snapshot = snapshot;
        }
    }

    return decoded;
};

export function decodePersistedValue<T>(
    value: unknown,
    decoder: PersistedStateDecoder<T>,
    fallback: T,
): T {
    try {
        const decoded = decoder(value);
        return decoded === undefined ? fallback : decoded;
    } catch {
        return fallback;
    }
}

export function parsePersistedValue<T>(
    rawValue: string | null,
    decoder: PersistedStateDecoder<T>,
    fallback: T,
): T {
    if (rawValue === null) return fallback;

    try {
        return decodePersistedValue(JSON.parse(rawValue), decoder, fallback);
    } catch {
        return fallback;
    }
}
