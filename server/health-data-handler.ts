import type { Article, BackendHealthStatus, FeedHeartbeat } from '../types';
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

const ERROR_CACHE_CONTROL = 'no-cache';
const MISSING_DATA_MESSAGE = 'Health data or news cache not available in KV store.';
const UNKNOWN_ERROR_MESSAGE = 'An unknown server error occurred.';

function jsonResponse(body: unknown, status: number, cacheControl: string): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': cacheControl,
        },
    });
}

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
                return jsonResponse({ error: MISSING_DATA_MESSAGE }, 404, ERROR_CACHE_CONTROL);
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

            return jsonResponse(
                { healthStatus, sourcesInCache, heartbeat },
                200,
                ERROR_CACHE_CONTROL, // Always fetch the latest health status
            );
        } catch (error) {
            logger.error('API Error in /api/get-health-data:', error);
            const message = error instanceof Error ? error.message : UNKNOWN_ERROR_MESSAGE;
            return jsonResponse({ error: message }, 500, ERROR_CACHE_CONTROL);
        }
    };
}
