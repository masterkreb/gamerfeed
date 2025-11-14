export type Theme = 'light' | 'dark';
export type ViewMode = 'grid' | 'list' | 'compact';
export type TimeFilter = 'today' | 'yesterday' | '7d' | 'all';

export interface Article {
    id: string;
    title: string;
    source: string;
    publicationDate: string; // ISO 8601 string
    summary: string;
    link: string;
    imageUrl: string;
    needsScraping?: boolean;
    language: 'de' | 'en';
}

export interface CachedNews {
    articles: Article[];
    timestamp: number;
}

export interface FeedSource {
    id: string;
    url: string;
    name: string;
    language: 'de' | 'en';
    priority: 'primary' | 'secondary';
    update_interval: number; // in minutes
    needsScraping?: boolean;
}

export type BackendHealthStatus = Record<string, { status: 'success' | 'warning' | 'error'; message: string }>;
