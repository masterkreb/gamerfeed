import type { Article, NewsSnapshotPointer } from '../types';
import {
    decideSnapshotAcceptance,
    readSnapshotHeaders,
    readSnapshotRollback,
    withSnapshotQuery,
} from '../shared/news-snapshot.js';

export type NewsLoadStage = 'preview' | 'medium' | 'full' | 'manual' | 'fallback';

export interface NewsLoadFailure {
    error: Error;
    stage: NewsLoadStage;
}

export interface NewsLoadControllerOptions {
    fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
    getPinnedSnapshot: () => NewsSnapshotPointer | null;
    setPinnedSnapshot: (snapshot: NewsSnapshotPointer | null) => void;
    commitArticles: (
        articles: Article[],
        snapshot: NewsSnapshotPointer | null,
        stage: NewsLoadStage,
    ) => void;
    setBlockingLoading: (loading: boolean) => void;
    setRefreshing: (refreshing: boolean) => void;
    clearBlockingError: () => void;
    clearBackgroundError: () => void;
    reportBlockingError: (failure: NewsLoadFailure) => void;
    reportBackgroundError: (failure: NewsLoadFailure) => void;
    logger?: Pick<Console, 'log' | 'warn'>;
}

export interface NewsLoadRequest {
    manualRefresh?: boolean;
    hasVisibleArticles?: boolean;
}

export interface PassiveNewsRequest {
    signal: AbortSignal;
    isCurrent: () => boolean;
    release: () => void;
}

interface ActiveRun {
    controller: AbortController;
    epoch: number;
    hasUsableResponse: boolean;
    /**
     * Hat **diese** Ladung bereits eine Antwort angenommen und damit ihre
     * Generation gewählt? Erst danach darf gepinnt werden.
     *
     * Bewusst getrennt von `hasUsableResponse`: Das beschreibt bereits
     * sichtbare Artikel aus einem früheren Lauf und entscheidet nur, ob ein
     * Fehler blockierend ist.
     */
    hasAcceptedResponse: boolean;
    isBlocking: boolean;
    manualRefresh: boolean;
}

interface StageResult {
    accepted: boolean;
    stale: boolean;
}

const ENDPOINTS = Object.freeze({
    preview: '/api/get-news-preview',
    medium: '/api/get-news-medium',
    full: '/api/get-news',
});

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error('An unknown error occurred.');
}

async function responseError(response: Response, fallback: string): Promise<Error> {
    const errorData = await response.json().catch(() => null) as { error?: unknown } | null;
    const message = typeof errorData?.error === 'string'
        ? errorData.error
        : `${fallback}: ${response.status}`;
    return new Error(message);
}

/**
 * Steuert die progressive News-Ladekette und besitzt alle laufenden Requests.
 *
 * Jede neue autoritative Ladung erhöht die interne Epoche und bricht ältere
 * Arbeit ab. Die Epochenprüfung bleibt zusätzlich bestehen, weil ein
 * gestelltes `fetch` oder ein bereits aufgelöster Body ein Abort-Signal
 * ignorieren kann. Nur die aktuelle Epoche darf State, Snapshot-Pin oder
 * lokale Kopie verändern.
 */
export function createNewsLoadController(options: NewsLoadControllerOptions) {
    const {
        fetchImpl,
        getPinnedSnapshot,
        setPinnedSnapshot,
        commitArticles,
        setBlockingLoading,
        setRefreshing,
        clearBlockingError,
        clearBackgroundError,
        reportBlockingError,
        reportBackgroundError,
        logger = console,
    } = options;

    let epoch = 0;
    let activeRun: ActiveRun | null = null;
    const passiveControllers = new Set<AbortController>();

    const isCurrent = (run: ActiveRun): boolean => (
        activeRun === run
        && run.epoch === epoch
        && !run.controller.signal.aborted
    );

    const cancelPassiveRequests = (): void => {
        for (const controller of passiveControllers) {
            controller.abort();
        }
        passiveControllers.clear();
    };

    const invalidate = (): void => {
        epoch += 1;
        activeRun?.controller.abort();
        activeRun = null;
        cancelPassiveRequests();
    };

    const beginRun = ({
        manualRefresh = false,
        hasVisibleArticles = false,
    }: NewsLoadRequest): ActiveRun => {
        invalidate();

        const run: ActiveRun = {
            controller: new AbortController(),
            epoch,
            hasUsableResponse: hasVisibleArticles,
            // Jede Ladung beginnt mit einer ungebundenen Entdeckung, auch wenn
            // schon Artikel sichtbar sind.
            hasAcceptedResponse: false,
            isBlocking: !hasVisibleArticles,
            manualRefresh,
        };
        activeRun = run;

        clearBlockingError();
        clearBackgroundError();
        setBlockingLoading(run.isBlocking);
        setRefreshing(manualRefresh && !run.isBlocking);
        return run;
    };

    const finishRun = (run: ActiveRun): void => {
        if (!isCurrent(run)) return;

        if (run.isBlocking) {
            setBlockingLoading(false);
        }
        if (run.manualRefresh) {
            setRefreshing(false);
        }
        activeRun = null;
    };

    const commitResponse = async (
        run: ActiveRun,
        response: Response,
        stage: NewsLoadStage,
    ): Promise<StageResult> => {
        const rawArticles: unknown = await response.json();
        if (!isCurrent(run)) return { accepted: false, stale: true };
        if (!Array.isArray(rawArticles)) {
            throw new Error(`Invalid article response during ${stage}.`);
        }

        const decision = decideSnapshotAcceptance({
            pinned: getPinnedSnapshot(),
            incoming: readSnapshotHeaders(response.headers),
            rollback: readSnapshotRollback(response.headers),
        });
        if (!isCurrent(run)) return { accepted: false, stale: true };

        if (!decision.accept) {
            logger.warn(`Antwort verworfen (${decision.reason})`);
            return { accepted: false, stale: false };
        }

        setPinnedSnapshot(decision.pin);
        commitArticles(rawArticles as Article[], decision.pin, stage);
        run.hasUsableResponse = true;
        // Ab jetzt steht die Generation dieser Ladung fest; die Folgestufen
        // werden daran gebunden.
        run.hasAcceptedResponse = true;

        if (run.isBlocking) {
            run.isBlocking = false;
            setBlockingLoading(false);
        }

        return { accepted: true, stale: false };
    };

    /**
     * Adresse einer Stufe.
     *
     * `?snapshot=<id>` setzt eine **bereits gewählte** Generation konsistent
     * fort; es ist kein Suchmittel. Der Server darf die direkt vorherige
     * Generation weiter ausliefern, deshalb bekäme eine gepinnte Anfrage
     * dauerhaft den alten Stand zurück und der Browser entdeckte eine neue
     * Generation nie. Der erste Versuch einer Ladung fragt deshalb ungebunden;
     * erst die angenommene Antwort bindet die Folgestufen.
     */
    const stageUrl = (run: ActiveRun, endpoint: string): string => (
        run.hasAcceptedResponse
            ? withSnapshotQuery(endpoint, getPinnedSnapshot())
            : endpoint
    );

    const fetchStage = async (
        run: ActiveRun,
        endpoint: string,
        stage: NewsLoadStage,
    ): Promise<StageResult> => {
        const response = await fetchImpl(
            stageUrl(run, endpoint),
            { signal: run.controller.signal },
        );
        if (!isCurrent(run)) return { accepted: false, stale: true };
        if (!response.ok) {
            throw await responseError(response, `Failed to load ${stage} articles`);
        }
        if (!isCurrent(run)) return { accepted: false, stale: true };
        return commitResponse(run, response, stage);
    };

    const logIntermediateFailure = (
        run: ActiveRun,
        error: unknown,
        stage: NewsLoadStage,
    ): void => {
        if (!isCurrent(run)) return;
        logger.warn(`News-Zwischenstufe ${stage} fehlgeschlagen; die Ladekette wird fortgesetzt.`, error);
    };

    const reportTerminal = (
        run: ActiveRun,
        error: unknown,
        stage: NewsLoadStage,
    ): void => {
        if (!isCurrent(run)) return;
        const failure = { error: toError(error), stage };
        if (run.hasUsableResponse) {
            reportBackgroundError(failure);
        } else {
            reportBlockingError(failure);
        }
    };

    const loadInitial = async (run: ActiveRun): Promise<void> => {
        try {
            await fetchStage(run, ENDPOINTS.preview, 'preview');
        } catch (error) {
            if (!isCurrent(run)) return;

            // Die kleine Preview ist eine Beschleunigung, keine Voraussetzung.
            // Fällt sie aus, bekommt der vollständige Endpunkt genau einen
            // unabhängigen Versuch.
            logger.warn('Preview-Ladung fehlgeschlagen, Full-Fallback wird versucht.', error);
            try {
                await fetchStage(run, ENDPOINTS.full, 'fallback');
            } catch (fallbackError) {
                reportTerminal(run, fallbackError, 'fallback');
            }
            return;
        }

        if (!isCurrent(run)) return;

        // Medium und Full bleiben absichtlich sequenziell, damit die Seite
        // progressiv wächst. Der Full-Versuch liegt aber nicht mehr im
        // Erfolgszweig von Medium und läuft deshalb auch nach dessen Fehler.
        try {
            await fetchStage(run, ENDPOINTS.medium, 'medium');
        } catch (error) {
            logIntermediateFailure(run, error, 'medium');
        }

        if (!isCurrent(run)) return;

        try {
            await fetchStage(run, ENDPOINTS.full, 'full');
        } catch (error) {
            reportTerminal(run, error, 'full');
        }
    };

    const load = async (request: NewsLoadRequest = {}): Promise<void> => {
        const run = beginRun(request);

        try {
            if (run.manualRefresh) {
                try {
                    await fetchStage(run, ENDPOINTS.full, 'manual');
                } catch (error) {
                    reportTerminal(run, error, 'manual');
                }
            } else {
                await loadInitial(run);
            }
        } finally {
            finishRun(run);
        }
    };

    /**
     * Liefert eine Gültigkeitsmarke für Auto-Update-Abfragen.
     *
     * Passive Abfragen verdrängen keine sichtbare Ladung und werden gar nicht
     * gestartet, solange eine solche läuft. Ein späterer manueller Refresh
     * invalidiert und abortiert dagegen jede bereits laufende Abfrage.
     */
    const beginPassiveRequest = (): PassiveNewsRequest | null => {
        if (activeRun || passiveControllers.size > 0) return null;

        const controller = new AbortController();
        const requestEpoch = epoch;
        passiveControllers.add(controller);

        const isPassiveCurrent = (): boolean => (
            requestEpoch === epoch
            && passiveControllers.has(controller)
            && !controller.signal.aborted
        );

        return {
            signal: controller.signal,
            isCurrent: isPassiveCurrent,
            release: () => {
                passiveControllers.delete(controller);
            },
        };
    };

    return {
        beginPassiveRequest,
        cancel: invalidate,
        cancelPassiveRequests,
        load,
    };
}
