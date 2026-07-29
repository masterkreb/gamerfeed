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
 * ## Warum in Produktion (noch) keine Generation gemeldet wird
 *
 * `news_cache`, `news_cache_16` und `news_cache_64` sind **veränderliche**
 * Schlüssel: der Cron überschreibt sie an Ort und Stelle. Zwischen dem Lesen
 * eines Zeigers und dem Lesen der Artikel kann also ein Publish liegen – und
 * **keine** Lesereihenfolge kann das ausschließen:
 *
 * - Zeiger zuerst → die Antwort trägt eine alte Kennung auf neuem Inhalt.
 * - Artikel zuerst → sie trägt eine neue Kennung auf altem Inhalt.
 *
 * Beides ist eine Falschaussage, und die zweite ist über einen gepinnten
 * Edge-Cache sogar dauerhaft: unter derselben Kennung lägen dann verschiedene
 * Inhalte. Damit wäre die Grundannahme des Protokolls verletzt.
 *
 * Deshalb meldet dieser Endpunkt eine Generation **nur**, wenn ihm über
 * `readSnapshot` eine Quelle gegeben wird, die die Zugehörigkeit belegen kann.
 * Die unveränderlichen Generationen dafür bringt **O3b**; bis dahin bleibt die
 * Vorgabe „keine Quelle“ und der Endpunkt antwortet exakt wie vor O3a.
 *
 * Das Leseprotokoll selbst ist damit nicht ungetestet: die Contract-Tests
 * reichen eine Quelle herein und prüfen den vollständigen Ablauf.
 */
export function createNewsCacheHandler(
    cache: NewsCacheClient,
    endpoint: NewsCacheEndpoint,
    logger: Pick<Console, 'error'> = console,
    { readSnapshot, legacyRollback = false }: NewsCacheOptions = {},
) {
    return async function handler(request: Request): Promise<Response> {
        try {
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

            // Ohne belegbare Zugehörigkeit gibt es keine Kennung. Ein Ausfall
            // der Quelle ist kein Grund, die News zu verweigern – dann gilt
            // Legacy.
            let pointer = null;
            if (readSnapshot && !legacyRollback) {
                try {
                    pointer = normalizeSnapshotPointer(await readSnapshot(articles));
                } catch (snapshotError) {
                    logger.error(`Snapshot unavailable in ${endpoint.endpointPath}:`, snapshotError);
                }
            }

            const requestedId = requestedSnapshotId(request);
            // Beim Rollback ersetzt das Signal die Generationsangaben: der
            // Leser soll seine gepinnte Generation aufgeben, nicht eine neue
            // annehmen.
            const headers = legacyRollback ? rollbackHeaders() : snapshotHeaders(pointer);

            // Eine Anfrage, die eine bestimmte Generation will, aber eine
            // andere (oder gar keine) bekommt, darf nicht unter der
            // angefragten Kennung am Edge liegen bleiben.
            const matches = pointer !== null && pointer.snapshotId === requestedId;
            const cacheControl = requestedId !== null && !matches
                ? MISMATCH_CACHE_CONTROL
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
