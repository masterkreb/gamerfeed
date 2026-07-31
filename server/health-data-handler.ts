import type {
    Article,
    BackendHealthStatus,
    FeedHeartbeat,
    FeedRunHistoryEntry,
    NewsSnapshotPointer,
} from '../types';
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
    FEED_RUN_HISTORY_TIMEOUT_MS,
    normalizeRunHistory,
    withRunHistoryDeadline,
} from '../shared/feed-run-history.js';
import { readRunHistory } from '../shared/feed-run-history-store.js';
import { normalizeSnapshotPointer } from '../shared/news-snapshot.js';
import { normalizeNewsSnapshotMetadata } from '../shared/news-snapshot-store.js';

interface HealthCacheClient {
    get<T>(key: string): Promise<T | null>;
    /**
     * Sorted-Set-Zugriff für die Laufhistorie (O4b).
     *
     * Optional: Testclients und ein Legacy-Client ohne Sorted-Set-Unterstützung
     * führen zu `runHistory: null`, nicht zu einem Fehler der übrigen Antwort.
     */
    zrange?: (
        key: string,
        min: number,
        max: number,
        options?: { rev?: boolean },
    ) => Promise<unknown>;
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
    /**
     * Liest die begrenzte Laufhistorie (O4b).
     *
     * Injizierbar, damit Tests weder einen echten Sorted Set noch einen echten
     * KV-Client brauchen. Ein Lesefehler ergibt `runHistory: null` und lässt
     * die übrigen Health-Daten unberührt.
     */
    readHistory?: () => Promise<unknown[]>;
    /**
     * Frist für den Historien-Read (O4b).
     *
     * Ein Speicher, der gar nicht antwortet, darf die Health-Antwort nicht
     * unbegrenzt offen halten – alle übrigen Daten liegen längst vor.
     */
    historyTimeoutMs?: number;
    /** Injizierbare Zeitsteuerung: Tests warten nicht real. */
    setTimer?: (callback: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}

interface RunHistoryDeadlineOptions {
    timeoutMs: number;
    setTimer: (callback: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
}

// Neutral formuliert: die Meldung geht an den Client und soll weder den
// Provider noch die Namen der Speicherschlüssel verraten. Woran es genau fehlt,
// steht im Log und im Heartbeat.
const MISSING_DATA_MESSAGE = 'Health-Daten sind derzeit nicht verfügbar.';

/**
 * Liest die begrenzte Laufhistorie, ohne die Antwort gefährden zu können.
 *
 * Der Unterschied zwischen `[]` und `null` ist die eigentliche Aussage: „noch
 * keine Läufe festgehalten“ ist etwas anderes als „nicht lesbar“. Ein
 * geratenes `[]` im Fehlerfall würde eine leere Historie behaupten, die
 * niemand belegt hat.
 */
async function readRunHistorySafely(
    readHistory: () => Promise<unknown[]>,
    deadline: RunHistoryDeadlineOptions,
    logger: Pick<Console, 'error'>,
): Promise<FeedRunHistoryEntry[] | null> {
    try {
        // Begrenzt: ein hängender Speicher darf die übrige Antwort nicht
        // aufhalten. Ein Zeitablauf zählt wie jeder andere Lesefehler und
        // ergibt `null` – niemals ein leeres Feld, das eine leere Historie
        // behaupten würde.
        const entries = await withRunHistoryDeadline(readHistory, deadline);

        // Auch eine bereits normalisierte Liste läuft noch einmal durch die
        // gemeinsame Regel: was ausgeliefert wird, entscheidet genau eine
        // Stelle, unabhängig davon, woher die Einträge kommen.
        return normalizeRunHistory(entries) as FeedRunHistoryEntry[];
    } catch (historyError) {
        // Der KV-Originaltext bleibt im Log.
        logger.error('Run history unavailable in /api/get-health-data:', historyError);
        return null;
    }
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
    {
        now = () => new Date(),
        staleAfterMs = FEED_STALE_AFTER_MS,
        readSnapshot,
        readSnapshotMetadata,
        readHistory = () => readRunHistory(cache),
        historyTimeoutMs = FEED_RUN_HISTORY_TIMEOUT_MS,
        setTimer = (callback, ms) => setTimeout(callback, ms),
        clearTimer = handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    }: HealthHandlerOptions = {},
    logger: Pick<Console, 'error'> = console,
) {
    return async function handler(_request: Request): Promise<Response> {
        try {
            const [healthStatus, runStatus, publishStatus, runHistory] = await Promise.all([
                cache.get<BackendHealthStatus>(FEED_HEALTH_STATUS_KEY),
                cache.get<unknown>(FEED_RUN_STATUS_KEY),
                cache.get<unknown>(FEED_PUBLISH_STATUS_KEY),
                // Die Historie ist eine Ergänzung, kein Vertrag: ihr Lesefehler
                // ergibt `null` und darf die übrigen Health-Daten nicht in
                // einen 500er verwandeln. `[]` heißt dagegen ausdrücklich
                // „gelesen, aber noch leer“.
                readRunHistorySafely(
                    readHistory,
                    { timeoutMs: historyTimeoutMs, setTimer, clearTimer },
                    logger,
                ),
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
            return adminJsonResponse({ healthStatus, sourcesInCache, heartbeat, snapshot, runHistory });
        } catch (error) {
            // Der KV-Originaltext bleibt im Log.
            logger.error('API Error in /api/get-health-data:', error);
            return internalErrorResponse();
        }
    };
}
