export type Theme = 'light' | 'dark';
export type ViewMode = 'grid' | 'list' | 'compact';
export type TimeFilter = 'today' | 'yesterday' | '7d' | 'all';
export type AppView = 'news' | 'trends';

export interface TrendItem {
    topic: string;
    summary: string;
    articleCount: number;
}

export interface TrendsData {
    daily: TrendItem[];
    weekly: TrendItem[];
    dailyUpdatedAt: string;
    weeklyUpdatedAt: string;
    weeklySummary?: string;
    weeklyDateRange?: {
        from: string;
        to: string;
    };
}

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

// Announcement types
export type AnnouncementType = 'info' | 'warning' | 'maintenance' | 'celebration';

export interface Announcement {
    id: string;
    message: string;
    type: AnnouncementType;
    isActive: boolean;
    createdAt: string;
}
export type BackendHealthStatus = Record<string, { status: 'success' | 'warning' | 'error'; message: string }>;
