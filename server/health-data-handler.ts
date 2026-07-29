import type { Article, BackendHealthStatus, FeedHeartbeat, NewsSnapshotPointer } from '../types';
import { adminErrorResponse, adminJsonResponse, internalErrorResponse } from './admin-api.js';
import { API_ERROR_CODES } from '../shared/api-errors.js';
import {
    FEED_HEALTH_STATUS_KEY,
    FEED_PUBLISH_STATUS_KEY,
    FEED_RUN_STATUS_KEY,
    FEED_STALE_AFTER_MS,
    buildFreshnessReport,
} from '../shared/feed-health-model.js';
import { normalizeSnapshotPointer } from '../shared/news-snapshot.js';
import { normalizeNewsSnapshotMetadata } from '../shared/news-snapshot-store.js';

interface HealthCacheClient {
    get<T>(key: string): Promise<T | null>;
}

interface HealthHandlerOptions {
    /** Injizierbare Uhr: Grenzfälle der Frische sind so ohne Wartezeit testbar. */
    now?: () => Date;
    staleAfterMs?: number;
    /**
     * Liefert die Generation, zu der die gelesenen Artikel **nachweisbar**
     * gehören.
     *
     * O3a-Vertragsadapter fuer Legacy-Artikel. Produktion verwendet ab O3b
     * `readSnapshotMetadata`; jede Naeherung ueber die Artikelzahl bleibt
     * unzulaessig.
     */
    readSnapshot?: (articles: Article[]) => Promise<unknown> | unknown;
    /**
     * Liefert das Manifest der aktiven unveraenderlichen O3b-Generation.
     * Damit braucht die Health-API den grossen Full-Payload nicht zu laden.
     */
    readSnapshotMetadata?: () => Promise<unknown> | unknown;
}

// Neutral formuliert: die Meldung geht an den Client und soll weder den
// Provider noch die Namen der Speicherschlüssel verraten. Woran es genau fehlt,
// steht im Log und im Heartbeat.
const MISSING_DATA_MESSAGE = 'Health-Daten sind derzeit nicht verfügbar.';

/**
 * Liefert den gespeicherten Feed-Status zusammen mit dem Frischebericht.
 *
 * Der Heartbeat trennt drei Fragen, die bisher zusammenfielen: Ist der Workflow
 * überhaupt gelaufen, hat er wirklich veröffentlicht, und ist der Inhalt neu?
 * Ein alter grüner Feed-Status bleibt deshalb nicht länger unbemerkt grün.
 */
export function createHealthDataHandler(
    cache: HealthCacheClient,
    {
        now = () => new Date(),
        staleAfterMs = FEED_STALE_AFTER_MS,
        readSnapshot,
        readSnapshotMetadata,
    }: HealthHandlerOptions = {},
    logger: Pick<Console, 'error'> = console,
) {
    return async function handler(_request: Request): Promise<Response> {
        try {
            const [healthStatus, runStatus, publishStatus] = await Promise.all([
                cache.get<BackendHealthStatus>(FEED_HEALTH_STATUS_KEY),
                cache.get<unknown>(FEED_RUN_STATUS_KEY),
                cache.get<unknown>(FEED_PUBLISH_STATUS_KEY),
            ]);

            if (!healthStatus) {
                return adminErrorResponse(404, API_ERROR_CODES.NOT_FOUND, MISSING_DATA_MESSAGE);
            }

            let sourcesInCache: string[] | null = null;
            let snapshot: NewsSnapshotPointer | null = null;

            if (readSnapshotMetadata) {
                try {
                    const metadata = normalizeNewsSnapshotMetadata(await readSnapshotMetadata());
                    if (metadata) {
                        sourcesInCache = metadata.sources;
                        snapshot = normalizeSnapshotPointer(metadata);
                    }
                } catch (snapshotError) {
                    logger.error('Snapshot unavailable in /api/get-health-data:', snapshotError);
                }
            }

            // Dual-Read fuer die Migration und einen Legacy-Rollback. Nur wenn
            // kein vollstaendiges Manifest vorliegt, wird der grosse
            // veraenderliche Full-Cache noch fuer die Quellenliste geladen.
            if (sourcesInCache === null) {
                const articles = await cache.get<Article[]>('news_cache');
                if (!articles) {
                    return adminErrorResponse(404, API_ERROR_CODES.NOT_FOUND, MISSING_DATA_MESSAGE);
                }

                sourcesInCache = [...new Set(articles.map(article => article.source))];

                // O3a-Testadapter: eine Generation nur melden, wenn die
                // injizierte Quelle ihre Bindung an genau diese Artikel
                // belegen kann.
                if (readSnapshot) {
                    try {
                        snapshot = normalizeSnapshotPointer(await readSnapshot(articles));
                    } catch (snapshotError) {
                        logger.error('Snapshot unavailable in /api/get-health-data:', snapshotError);
                    }
                }
            }

            const heartbeat: FeedHeartbeat = buildFreshnessReport({
                run: runStatus,
                publish: publishStatus,
                now: now(),
                staleAfterMs,
            });

            // Immer der aktuelle Stand und niemals zwischengespeichert: der
            // Frischebericht wäre sonst genau das, was er melden soll – alt.
            return adminJsonResponse({ healthStatus, sourcesInCache, heartbeat, snapshot });
        } catch (error) {
            // Der KV-Originaltext bleibt im Log.
            logger.error('API Error in /api/get-health-data:', error);
            return internalErrorResponse();
        }
    };
}
