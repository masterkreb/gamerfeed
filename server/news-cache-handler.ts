import type { Article } from '../types';
import {
    SNAPSHOT_QUERY_PARAM,
    normalizeSnapshotPointer,
    rollbackHeaders,
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

interface NewsCacheOptions {
    /**
     * Liest Artikel und Zeiger gemeinsam aus einer unveraenderlichen
     * Generation. Nur diese O3b-Quelle darf in Produktion Snapshot-Header
     * ausstellen.
     */
    readBoundSnapshot?: (
        requestedSnapshotId: string | null,
    ) => Promise<{ articles: Article[], snapshot: unknown } | null>;
    /**
     * Liefert die Generation, zu der die gelesenen Artikel **nachweisbar**
     * gehören.
     *
     * Bewusst ohne Vorgabe: siehe die Erklärung an `createNewsCacheHandler`.
     * Solange niemand das belegen kann, antwortet der Endpunkt wie vor O3a.
     */
    readSnapshot?: (articles: Article[]) => Promise<unknown> | unknown;
    /**
     * Meldet einen **ausdrücklichen** Rückfall auf Legacy.
     *
     * Eine Antwort ohne Generationsangabe kann zweierlei bedeuten: eine alte
     * Kopie aus einem Edge-Cache – die einen neueren Stand nicht zurückdrehen
     * darf – oder einen bewussten Rollback, der genau das darf. Nur dieses
     * Signal macht den Unterschied für den Leser sichtbar.
     */
    legacyRollback?: boolean;
}

const SUCCESS_CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=300';
/**
 * Zwei Fälle dürfen den Edge-Cache nie erreichen:
 *
 * 1. **Abweichende Generation** – der Leser hat eine andere angefragt, als hier
 *    vorliegt. Unter der angefragten Kennung läge sonst fremder Inhalt und die
 *    Verwechslung wäre konserviert.
 * 2. **Rollback-Signal** – es ist eine kurzlebige Betriebsanweisung und keine
 *    cachebare Eigenschaft des Inhalts. Läge es am Edge, käme es noch Minuten
 *    später bei Clients an, obwohl der Rollback längst beendet und wieder eine
 *    gültige Generation aktiv ist. Diese Clients gäben dann grundlos ihre
 *    Generation auf.
 */
const NO_STORE_CACHE_CONTROL = 'no-store';
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
 * ## Belegbare Bindung ab O3b
 *
 * Die Legacy-Keys `news_cache`, `news_cache_16` und `news_cache_64` bleiben
 * **veränderlich**. Eine Kennung darf deshalb nie aus einem getrennt gelesenen
 * Pointer neben diesen Werten geraten werden.
 *
 * Produktion reicht stattdessen `readBoundSnapshot` herein. Diese Quelle liest
 * Manifest und Payload unter derselben unveränderlichen Snapshot-ID.
 * `readSnapshot` bleibt nur als O3a-Vertragsadapter und für Tests erhalten;
 * ohne belegbare Quelle antwortet der Handler weiterhin kontrolliert als
 * Legacy.
 */
export function createNewsCacheHandler(
    cache: NewsCacheClient,
    endpoint: NewsCacheEndpoint,
    logger: Pick<Console, 'error'> = console,
    { readBoundSnapshot, readSnapshot, legacyRollback = false }: NewsCacheOptions = {},
) {
    return async function handler(request: Request): Promise<Response> {
        try {
            const requestedId = requestedSnapshotId(request);
            let articles: Article[] | null = null;
            let pointer = null;

            if (readBoundSnapshot && !legacyRollback) {
                try {
                    const bound = await readBoundSnapshot(requestedId);
                    if (bound && Array.isArray(bound.articles)) {
                        articles = bound.articles;
                        pointer = normalizeSnapshotPointer(bound.snapshot);
                    }
                } catch (snapshotError) {
                    logger.error(`Snapshot unavailable in ${endpoint.endpointPath}:`, snapshotError);
                }
            }

            // Dual-Read waehrend der Migration und fuer einen bewussten
            // Legacy-Rollback. Eine generationsgebundene Quelle faellt hier
            // ebenfalls zurueck, wenn Pointer oder Manifest fehlen.
            if (!articles) {
                articles = await cache.get<Article[]>(endpoint.cacheKey);

                if (!articles && endpoint.fallback) {
                    const fallbackArticles = await cache.get<Article[]>(endpoint.fallback.cacheKey);
                    if (fallbackArticles) {
                        articles = fallbackArticles.slice(0, endpoint.fallback.limit);
                    }
                }
            }

            if (!articles) {
                return jsonResponse(
                    { error: EMPTY_CACHE_MESSAGE },
                    404,
                    ERROR_CACHE_CONTROL,
                );
            }

            // Ohne belegbare Zugehörigkeit gibt es keine Kennung. Ein Ausfall
            // der Quelle ist kein Grund, die News zu verweigern – dann gilt
            // Legacy.
            if (!pointer && readSnapshot && !legacyRollback) {
                try {
                    pointer = normalizeSnapshotPointer(await readSnapshot(articles));
                } catch (snapshotError) {
                    logger.error(`Snapshot unavailable in ${endpoint.endpointPath}:`, snapshotError);
                }
            }

            // Beim Rollback ersetzt das Signal die Generationsangaben: der
            // Leser soll seine gepinnte Generation aufgeben, nicht eine neue
            // annehmen.
            const headers = legacyRollback ? rollbackHeaders() : snapshotHeaders(pointer);

            // Ein Rollback wird **unabhängig vom Query-Parameter** nie
            // gespeichert; eine Anfrage, die eine bestimmte Generation will,
            // aber eine andere (oder gar keine) bekommt, ebenfalls nicht.
            const matches = pointer !== null && pointer.snapshotId === requestedId;
            const mismatch = requestedId !== null && !matches;
            const cacheControl = legacyRollback || mismatch
                ? NO_STORE_CACHE_CONTROL
                : SUCCESS_CACHE_CONTROL;

            // Geliefert wird in jedem Fall: der Rumpf ist ein gültiger Stand,
            // und die Header sagen, welcher. Ein 409 ließe den Leser ohne
            // Daten zurück.
            return jsonResponse(articles, 200, cacheControl, headers);
        } catch (error) {
            logger.error(`API Error in ${endpoint.endpointPath}:`, error);
            const message = error instanceof Error ? error.message : UNKNOWN_ERROR_MESSAGE;
            return jsonResponse({ error: message }, 500, ERROR_CACHE_CONTROL);
        }
    };
}
