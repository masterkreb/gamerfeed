import type { Article } from '../types';
import {
    NEWS_SNAPSHOT_POINTER_KEY,
    SNAPSHOT_QUERY_PARAM,
    normalizeSnapshotPointer,
    snapshotHeaders,
} from '../shared/news-snapshot.js';

type NewsCacheKey = 'news_cache' | 'news_cache_16' | 'news_cache_64';

interface NewsCacheClient {
    get<T>(key: string): Promise<T | null>;
}

interface NewsCacheFallback {
    cacheKey: NewsCacheKey;
    limit: number;
}

interface NewsCacheEndpoint {
    cacheKey: NewsCacheKey;
    endpointPath: string;
    fallback?: NewsCacheFallback;
}

const SUCCESS_CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=300';
/**
 * Eine Antwort zu einer bestimmten Generation ist unveränderlich – ihr Inhalt
 * kann sich unter derselben Kennung nicht mehr ändern. Deshalb darf sie länger
 * am Edge liegen als der ungepinnte Pfad.
 */
const PINNED_CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';
/**
 * Der Leser hat eine andere Generation angefragt, als hier vorliegt. Diese
 * Antwort darf **nicht** unter der angefragten Kennung im Edge liegen bleiben:
 * sie gehört zu einer anderen Generation und würde die Verwechslung sonst
 * konservieren.
 */
const MISMATCH_CACHE_CONTROL = 'no-store';
const ERROR_CACHE_CONTROL = 'no-cache';
const EMPTY_CACHE_MESSAGE = 'Cache is empty or not available.';
const UNKNOWN_ERROR_MESSAGE = 'An unknown server error occurred.';

function jsonResponse(
    body: unknown,
    status: number,
    cacheControl: string,
    extraHeaders: Record<string, string> = {},
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': cacheControl,
            ...extraHeaders,
        },
    });
}

function requestedSnapshotId(request: Request): string | null {
    try {
        const value = new URL(request.url).searchParams.get(SNAPSHOT_QUERY_PARAM);
        return value === null || value.trim() === '' ? null : value.trim();
    } catch {
        // Eine unlesbare Adresse ist kein Grund, die News zu verweigern – sie
        // heißt nur, dass niemand eine Generation angefragt hat.
        return null;
    }
}

/**
 * News-Endpunkt mit generationsgebundenem Leseprotokoll (Roadmap O3a).
 *
 * Der Rumpf bleibt bewusst ein **nacktes Array**: bestehende Clients lesen ihn
 * unverändert weiter. Die Generation reist in Headern mit, die ein alter Client
 * stillschweigend ignoriert – genau das braucht eine Dual-Read-Migration.
 *
 * ## Lesereihenfolge
 *
 * Der Zeiger wird **vor** den Artikeln gelesen. Das ist kein Zufall: schreibt
 * der Cron genau dazwischen, ist das Etikett höchstens *älter* als die Daten,
 * nie neuer. Ein Leser, der eine ältere Kennung sieht, holt die nächste Stufe
 * und übernimmt dort die neuere Generation – die Verwechslung heilt sich also
 * selbst. In der umgekehrten Reihenfolge trüge alter Inhalt eine neue Kennung,
 * und niemand könnte das noch bemerken.
 *
 * Ein wirklich atomarer Publish samt unveränderlicher Generationen bleibt O3b.
 */
export function createNewsCacheHandler(
    cache: NewsCacheClient,
    endpoint: NewsCacheEndpoint,
    logger: Pick<Console, 'error'> = console,
) {
    return async function handler(request: Request): Promise<Response> {
        try {
            // Zuerst der Zeiger, dann die Daten – siehe Lesereihenfolge oben.
            // Ein unlesbarer oder fehlender Zeiger ist kein Fehler, sondern
            // Legacy: die Antwort geht ohne Generationsangabe hinaus.
            let pointer = null;
            try {
                pointer = normalizeSnapshotPointer(
                    await cache.get<unknown>(NEWS_SNAPSHOT_POINTER_KEY),
                );
            } catch (pointerError) {
                logger.error(`Snapshot pointer unavailable in ${endpoint.endpointPath}:`, pointerError);
            }

            let articles = await cache.get<Article[]>(endpoint.cacheKey);

            if (!articles && endpoint.fallback) {
                const fallbackArticles = await cache.get<Article[]>(endpoint.fallback.cacheKey);
                if (fallbackArticles) {
                    articles = fallbackArticles.slice(0, endpoint.fallback.limit);
                }
            }

            if (!articles) {
                return jsonResponse(
                    { error: EMPTY_CACHE_MESSAGE },
                    404,
                    ERROR_CACHE_CONTROL,
                );
            }

            const requestedId = requestedSnapshotId(request);
            const headers = snapshotHeaders(pointer);

            if (requestedId === null) {
                // Kein Wunsch, kein Pinning: der bisherige kurzlebige Cache.
                return jsonResponse(articles, 200, SUCCESS_CACHE_CONTROL, headers);
            }

            const matches = pointer !== null && pointer.snapshotId === requestedId;

            // Auch bei Abweichung wird geliefert, nicht verweigert: der Rumpf
            // ist ein gültiger Stand, und die Header sagen dem Leser, welcher.
            // Er entscheidet dann selbst – übernehmen, wenn neuer, verwerfen,
            // wenn älter. Ein 409 würde ihn nur ohne Daten zurücklassen.
            return jsonResponse(
                articles,
                200,
                matches ? PINNED_CACHE_CONTROL : MISMATCH_CACHE_CONTROL,
                headers,
            );
        } catch (error) {
            logger.error(`API Error in ${endpoint.endpointPath}:`, error);
            const message = error instanceof Error ? error.message : UNKNOWN_ERROR_MESSAGE;
            return jsonResponse({ error: message }, 500, ERROR_CACHE_CONTROL);
        }
    };
}
