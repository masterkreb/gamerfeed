import type { BackendHealthStatus, FeedSource, NewsSnapshotPointer } from '../types';
import type { LocalNewsCacheState } from '../shared/local-news-cache';

export type AdminFeedStatus = 'unknown' | 'ok' | 'warning' | 'error';

/**
 * Verhältnis zwischen der aktiven Generation und der lokalen Browserkopie.
 *
 * `unknown` ist der Regelfall bei Legacy-Ständen und heißt ausdrücklich **nicht**
 * „gleich“: Eine fehlende Kennung belegt gar nichts.
 */
export type SnapshotComparison = 'same' | 'different' | 'unknown';

export interface AdminFeedHealthRow {
    feedId: string;
    name: string;
    status: AdminFeedStatus;
    /** i18n-Schlüssel statt fertigem Text: die Ableitung bleibt sprachfrei. */
    detailKey: string;
    detailParams: Record<string, string>;
    /** `null`, solange die aktive Generation nicht gelesen werden konnte. */
    inActiveSnapshot: boolean | null;
    /** `null`, solange keine verwendbare lokale Browserkopie vorliegt. */
    inLocalCache: boolean | null;
}

export interface AdminHealthReport {
    /** Feed-Quellen in der Datenbank. */
    configuredFeedCount: number;
    /** Quellen mit Artikeln im aktiven News-Snapshot, `null` wenn ungelesen. */
    activeSnapshotSourceCount: number | null;
    /** Quellen in der noch verwendbaren lokalen Browserkopie, sonst `null`. */
    localCacheSourceCount: number | null;
    activeSnapshotId: string | null;
    localSnapshotId: string | null;
    snapshotComparison: SnapshotComparison;
    localCacheStatus: LocalNewsCacheState['status'];
    rows: AdminFeedHealthRow[];
    /** Snapshot-Quellennamen ohne exakt passenden konfigurierten Feed. */
    unmatchedSnapshotSources: string[];
}

export interface AdminHealthReportInput {
    feeds: FeedSource[];
    /** `null`, solange der gespeicherte Bericht nicht gelesen wurde. */
    backendHealth: BackendHealthStatus | null;
    /** Quellen des aktiven Snapshots, `null` wenn nicht belegbar. */
    sourcesInCache: string[] | null;
    activeSnapshot: NewsSnapshotPointer | null;
    localCache: LocalNewsCacheState;
}

function compareSnapshots(
    active: NewsSnapshotPointer | null,
    local: NewsSnapshotPointer | null,
): SnapshotComparison {
    // Nur zwei belegbare Kennungen dürfen verglichen werden. Alles andere ist
    // Legacy oder schlicht nicht bekannt.
    if (!active?.snapshotId || !local?.snapshotId) {
        return 'unknown';
    }

    return active.snapshotId === local.snapshotId ? 'same' : 'different';
}

function resolveRow(
    feed: FeedSource,
    backendHealth: BackendHealthStatus | null,
    activeSources: Set<string> | null,
    localSources: Set<string> | null,
): AdminFeedHealthRow {
    const inActiveSnapshot = activeSources === null ? null : activeSources.has(feed.name);
    const inLocalCache = localSources === null ? null : localSources.has(feed.name);
    const base = { feedId: feed.id, name: feed.name, inActiveSnapshot, inLocalCache };

    if (backendHealth === null) {
        return {
            ...base,
            status: 'unknown',
            detailKey: 'admin.health.detailNotLoaded',
            detailParams: {},
        };
    }

    const entry = backendHealth[feed.id];

    if (!entry) {
        return {
            ...base,
            status: 'error',
            detailKey: 'admin.health.detailNotProcessed',
            detailParams: {},
        };
    }

    if (entry.status === 'unknown') {
        return {
            ...base,
            status: 'unknown',
            detailKey: 'admin.health.detailNotProcessed',
            detailParams: {},
        };
    }

    if (entry.status === 'error') {
        return {
            ...base,
            status: 'error',
            detailKey: 'admin.health.detailBackendError',
            detailParams: { message: entry.message ?? '' },
        };
    }

    // Ab hier gilt: der Backend-Abruf war erfolgreich. Ob die Quelle Artikel im
    // aktiven Snapshot hat, ist davon getrennt zu beantworten.
    if (inActiveSnapshot === null) {
        return {
            ...base,
            status: 'unknown',
            detailKey: 'admin.health.detailSnapshotUnknown',
            detailParams: {},
        };
    }

    if (!inActiveSnapshot) {
        return {
            ...base,
            status: 'warning',
            detailKey: 'admin.health.detailNotInActiveSnapshot',
            detailParams: { feedName: feed.name },
        };
    }

    // Im aktiven Snapshot vorhanden, aber die lokale Kopie dieses Browsers
    // kennt die Quelle noch nicht. Das ist ein Snapshot-Unterschied, kein
    // Feed-Ausfall - der Status bleibt deshalb `ok`.
    if (inLocalCache === false) {
        return {
            ...base,
            status: 'ok',
            detailKey: 'admin.health.detailOkNotInLocalCopy',
            detailParams: { feedName: feed.name },
        };
    }

    return {
        ...base,
        status: 'ok',
        detailKey: 'admin.health.detailOk',
        detailParams: {},
    };
}

/**
 * Leitet den vollständigen Admin-Statusbericht ab.
 *
 * Bewusst rein und ohne i18n: Die Zuordnung von Feed zu Snapshot-Quelle erfolgt
 * **ausschließlich über exakt gleiche Namen**. Ein unscharfer Vergleich könnte
 * eine abweichend geschriebene Quelle fälschlich gesund melden; stattdessen
 * bleibt der Feed eine Warnung und der unzuordenbare Snapshot-Name wird separat
 * ausgewiesen.
 */
export function buildAdminHealthReport({
    feeds,
    backendHealth,
    sourcesInCache,
    activeSnapshot,
    localCache,
}: AdminHealthReportInput): AdminHealthReport {
    const activeSources = sourcesInCache === null ? null : new Set(sourcesInCache);
    const localSources = localCache.status === 'usable' ? new Set(localCache.sources) : null;
    const feedNames = new Set(feeds.map(feed => feed.name));

    return {
        configuredFeedCount: feeds.length,
        activeSnapshotSourceCount: activeSources === null ? null : activeSources.size,
        localCacheSourceCount: localSources === null ? null : localSources.size,
        activeSnapshotId: activeSnapshot?.snapshotId ?? null,
        localSnapshotId: localCache.status === 'usable'
            ? localCache.snapshot?.snapshotId ?? null
            : null,
        snapshotComparison: compareSnapshots(
            activeSnapshot,
            localCache.status === 'usable' ? localCache.snapshot : null,
        ),
        localCacheStatus: localCache.status,
        rows: feeds.map(feed => resolveRow(feed, backendHealth, activeSources, localSources)),
        unmatchedSnapshotSources: activeSources === null
            ? []
            : [...activeSources].filter(source => !feedNames.has(source)).sort(),
    };
}

/**
 * Bericht für den Fall, dass der gespeicherte Status gar nicht gelesen werden
 * konnte. Ohne frische Antwort ist auch keine Snapshot-Aussage belegt.
 */
export function buildUnavailableHealthReport(
    feeds: FeedSource[],
    localCache: LocalNewsCacheState,
): AdminHealthReport {
    const report = buildAdminHealthReport({
        feeds,
        backendHealth: null,
        sourcesInCache: null,
        activeSnapshot: null,
        localCache,
    });

    return {
        ...report,
        rows: report.rows.map(row => ({
            ...row,
            status: 'error',
            detailKey: 'admin.health.detailFetchError',
            detailParams: {},
        })),
    };
}
