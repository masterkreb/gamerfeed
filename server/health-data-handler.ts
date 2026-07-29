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
import {
    NEWS_SNAPSHOT_POINTER_KEY,
    normalizeSnapshotPointer,
} from '../shared/news-snapshot.js';

interface HealthCacheClient {
    get<T>(key: string): Promise<T | null>;
}

/**
 * Bindet den Zeiger an die gelesenen Artikel – oder meldet Legacy.
 *
 * Zwei Bedingungen müssen erfüllt sein:
 *
 * 1. Der Zeiger ist vor und nach dem Artikelabruf derselbe. Ein Wechsel
 *    dazwischen heißt, dass ein Publish lief.
 * 2. Seine `articleCount` passt zum gelesenen Full-Cache.
 *
 * Beides zusammen ist eine **Konsistenzprüfung, kein Beweis**: zwei
 * Generationen können dieselbe Artikelzahl haben. Ein Beweis ist mit
 * veränderlichen Schlüsseln nicht möglich – deshalb schreibt der Cron bis O3b
 * gar keinen Zeiger, und diese Prüfung liefert heute immer `null`.
 */
function bindSnapshotToArticles(
    before: unknown,
    after: unknown,
    articles: Article[],
): NewsSnapshotPointer | null {
    const pointer = normalizeSnapshotPointer(before);
    if (pointer === null) return null;

    const second = normalizeSnapshotPointer(after);
    if (second === null || second.snapshotId !== pointer.snapshotId) return null;

    if (pointer.articleCount !== articles.length) return null;

    return pointer;
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
            // Der Zeiger wird **vor** und **nach** den Artikeln gelesen. Beide
            // Lesevorgaenge parallel abzusetzen wuerde die Frage, ob sie
            // denselben Stand beschreiben, gar nicht erst stellen.
            const pointerBefore = await cache.get<unknown>(NEWS_SNAPSHOT_POINTER_KEY);

            const [healthStatus, articles, runStatus, publishStatus] = await Promise.all([
                cache.get<BackendHealthStatus>(FEED_HEALTH_STATUS_KEY),
                cache.get<Article[]>('news_cache'),
                cache.get<unknown>(FEED_RUN_STATUS_KEY),
                cache.get<unknown>(FEED_PUBLISH_STATUS_KEY),
            ]);

            const pointerAfter = await cache.get<unknown>(NEWS_SNAPSHOT_POINTER_KEY);

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

            // Welche Generation der Zaehlung `sourcesInCache` zugrunde liegt
            // (O3a). Ohne diese Angabe laesst sich „nicht im aktiven Snapshot"
            // nicht von „das Frontend sieht einen anderen Snapshot"
            // unterscheiden - genau die Frage, die der beobachtete
            // GameStar-Fall aufgeworfen hat. Die Auswertung im Admin bleibt
            // A1b vorbehalten; hier wird die Angabe nur bereitgestellt.
            //
            // Gemeldet wird sie **nur**, wenn beide Werte belegbar denselben
            // Stand beschreiben: derselbe Zeiger vor und nach dem Artikelabruf
            // *und* eine passende Artikelzahl. Sonst gilt kontrolliert Legacy.
            // Das ist eine Konsistenzpruefung und kein Beweis - solange die
            // News-Keys veraenderlich sind, gibt es keinen. Deshalb schreibt
            // der Cron bis O3b auch gar keinen Zeiger.
            const snapshot = bindSnapshotToArticles(pointerBefore, pointerAfter, articles);

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
