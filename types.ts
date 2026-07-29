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
// --- Cron-Heartbeat und Frische (Roadmap O1) ---
// Vertrag von shared/feed-health-model.js, genutzt von Cron-Skript,
// Health-API und Admin-Panel.

export type FeedHealthStatusValue = 'success' | 'warning' | 'error' | 'unknown';

export interface BackendHealthEntry {
    status: FeedHealthStatusValue;
    message: string;
    /** Zeitpunkt des letzten Abrufversuchs für diesen Feed. */
    lastAttemptAt?: string | null;
    /** Letzter Lauf, in dem dieser Feed Artikel geliefert hat. */
    lastSuccessAt?: string | null;
    durationMs?: number | null;
    articleCount?: number | null;
    /** Beim Parsen übersprungene Einzelelemente dieses Feeds. */
    skippedItemCount?: number | null;
}

export type BackendHealthStatus = Record<string, BackendHealthEntry>;

/** `degraded` wird erst mit O2b vergeben. */
export type FeedRunResult = 'running' | 'success' | 'degraded' | 'fatal';

export interface FeedRunCounters {
    total: number;
    success: number;
    warning: number;
    error: number;
    unknown: number;
}

export interface FeedRunDurations {
    totalMs: number | null;
    feedFetchMs: number | null;
    imageScrapeMs: number | null;
    imageBackfillMs: number | null;
    publishMs: number | null;
    trendsMs: number | null;
}

export interface FeedFreshness {
    at: string | null;
    ageMs: number | null;
    /** Zeitstempel liegt jenseits der erlaubten Uhrabweichung in der Zukunft. */
    isFuture: boolean;
    isStale: boolean;
}

export interface FeedHeartbeat {
    now: string | null;
    staleAfterMs: number;
    /** Wahr, sobald Lauf, Kern-Publish oder Inhalt die Schwelle überschreiten. */
    isStale: boolean;
    run: FeedFreshness & {
        runId: string | null;
        startedAt: string | null;
        finishedAt: string | null;
        result: FeedRunResult | null;
        fatalError: string | null;
        /** Warum der Lauf `degraded` endete (Deadline oder Scrape-Budget). */
        degradedReason: string | null;
        feeds: FeedRunCounters;
        durations: FeedRunDurations;
    };
    corePublish: FeedFreshness & {
        runId: string | null;
        articleCount: number;
        feeds: FeedRunCounters;
        durations: FeedRunDurations;
    };
    content: FeedFreshness & {
        newestArticleAt: string | null;
        newestArticleAgeMs: number | null;
    };
}

/** Aktive Cache-Generation des Leseprotokolls (Roadmap O3a). */
export interface NewsSnapshotPointer {
    schemaVersion: number;
    snapshotId: string;
    createdAt: string | null;
    articleCount: number;
    runId: string | null;
}

export interface HealthDataResponse {
    healthStatus: BackendHealthStatus;
    sourcesInCache: string[];
    heartbeat: FeedHeartbeat;
    /** Generation, auf der `sourcesInCache` beruht; `null` bei Legacy-Stand. */
    snapshot: NewsSnapshotPointer | null;
}
