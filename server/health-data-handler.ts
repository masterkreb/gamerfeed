import type { Article, BackendHealthStatus, FeedHeartbeat } from '../types';
import { adminErrorResponse, adminJsonResponse, internalErrorResponse } from './admin-api.js';
import { API_ERROR_CODES } from '../shared/api-errors.js';
import {
    FEED_HEALTH_STATUS_KEY,
    FEED_PUBLISH_STATUS_KEY,
    FEED_RUN_STATUS_KEY,
    FEED_STALE_AFTER_MS,
    buildFreshnessReport,
} from '../shared/feed-health-model.js';

interface HealthCacheClient {
    get<T>(key: string): Promise<T | null>;
}

interface HealthHandlerOptions {
    /** Injizierbare Uhr: Grenzfälle der Frische sind so ohne Wartezeit testbar. */
    now?: () => Date;
    staleAfterMs?: number;
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
    { now = () => new Date(), staleAfterMs = FEED_STALE_AFTER_MS }: HealthHandlerOptions = {},
    logger: Pick<Console, 'error'> = console,
) {
    return async function handler(_request: Request): Promise<Response> {
        try {
            const [healthStatus, articles, runStatus, publishStatus] = await Promise.all([
                cache.get<BackendHealthStatus>(FEED_HEALTH_STATUS_KEY),
                cache.get<Article[]>('news_cache'),
                cache.get<unknown>(FEED_RUN_STATUS_KEY),
                cache.get<unknown>(FEED_PUBLISH_STATUS_KEY),
            ]);

            if (!healthStatus || !articles) {
                return adminErrorResponse(404, API_ERROR_CODES.NOT_FOUND, MISSING_DATA_MESSAGE);
            }

            // We only need the unique sources from the articles for the health
            // check logic, not all article data.
            const sourcesInCache = [...new Set(articles.map(article => article.source))];

            const heartbeat: FeedHeartbeat = buildFreshnessReport({
                run: runStatus,
                publish: publishStatus,
                now: now(),
                staleAfterMs,
            });

            // Immer der aktuelle Stand und niemals zwischengespeichert: der
            // Frischebericht wäre sonst genau das, was er melden soll – alt.
            return adminJsonResponse({ healthStatus, sourcesInCache, heartbeat });
        } catch (error) {
            // Der KV-Originaltext bleibt im Log.
            logger.error('API Error in /api/get-health-data:', error);
            return internalErrorResponse();
        }
    };
}
