// Orchestrierung des Cron-Heartbeats (Roadmap O1).
//
// Der Recorder kapselt, *wann* und *ob* die drei Heartbeat-Schluessel
// geschrieben werden. Die reinen Rechenregeln stehen in
// shared/feed-health-model.js; hier liegt ausschliesslich die Reihenfolge und
// die Frage, wann ein Schreibvorgang mehr zerstoert als er nuetzt.
//
// Drei Regeln tragen den groessten Teil der Verantwortung:
//
// 1. Der Versuch bleibt `running`, bis wirklich alle Phasen durch sind. Ein
//    Abbruch zwischen Kern-Publish und Laufende hinterlaesst deshalb einen
//    Datensatz ohne `finishedAt` und wird spaeter am `startedAt` gemessen –
//    also als haengen geblieben und schliesslich als veraltet erkannt.
// 2. Ein historischer Stand, der nicht sicher gelesen werden konnte, wird nicht
//    mit geratenen Ersatzwerten ueberschrieben. Lieber gar nicht schreiben als
//    ein `lastSuccessAt` loeschen.
// 3. Ein Abbruch *vor* dem Laden der Feed-Liste sagt nichts ueber die Feeds
//    aus; eine erfolgreich geladene, aber leere Liste dagegen sehr wohl. Nur im
//    zweiten Fall darf der gespeicherte Feed-Status geleert werden, damit
//    geloeschte Feeds verschwinden.

import {
    FEED_HEALTH_STATUS_KEY,
    FEED_PUBLISH_STATUS_KEY,
    FEED_RUN_STATUS_KEY,
    buildPublishStatus,
    createRunStatus,
    finishRunStatus,
    mergeFeedHealth,
    normalizeFeedHealth,
    normalizePublishStatus,
    progressRunStatus,
    summarizeFeedHealth,
} from '../shared/feed-health-model.js';

/**
 * @param {{
 *   store: { get(key: string): Promise<unknown>, set(key: string, value: unknown): Promise<unknown> },
 *   runId: string,
 *   startedAt: Date,
 *   now?: () => Date,
 *   logger?: { log?: Function, warn?: Function },
 *   redact?: (message: string) => string,
 * }} options
 */
export function createFeedRunRecorder({
    store,
    runId,
    startedAt,
    now = () => new Date(),
    logger = console,
    redact = message => message,
}) {
    const runStatus = createRunStatus({ runId, startedAt });

    let previousHealth = {};
    let previousPublish = null;
    // `known` heisst: erfolgreich gelesen. Ein leerer Speicher ist bekannt,
    // ein Lesefehler nicht.
    let previousHealthKnown = false;
    let previousPublishKnown = false;
    let feedListLoaded = false;

    function warn(message) {
        logger.warn?.(`   ⚠️  ${message}`);
    }

    // Ein fehlgeschlagener Heartbeat-Write darf einen sonst gesunden Lauf nicht
    // abbrechen: der Kern-Publish ist wichtiger als seine Beobachtung.
    async function saveSafely(key, value) {
        try {
            await store.set(key, value);
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warn(`Heartbeat '${key}' konnte nicht gespeichert werden: ${redact(message)}`);
            return false;
        }
    }

    // Die beiden Reads sind bewusst getrennt: ein kaputter Publish-Datensatz
    // darf nicht dazu fuehren, dass auch der Feed-Status als unbekannt gilt.
    async function readSafely(key, normalize, label) {
        try {
            const stored = await store.get(key);
            return { value: normalize(stored), known: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warn(`${label} nicht lesbar, historischer Stand bleibt unangetastet: ${redact(message)}`);
            return { value: normalize(null), known: false };
        }
    }

    return {
        runId: runStatus.runId,
        startedAt: runStatus.startedAt,

        /** Nur fuer Tests und Protokollausgaben. */
        state() {
            return { previousHealthKnown, previousPublishKnown, feedListLoaded };
        },

        /** Schreibt den laufenden Versuch, bevor irgendetwas anderes passiert. */
        async begin() {
            await saveSafely(FEED_RUN_STATUS_KEY, runStatus);
        },

        async loadPreviousState() {
            const [health, publish] = await Promise.all([
                readSafely(FEED_HEALTH_STATUS_KEY, normalizeFeedHealth, 'Bisheriger Feed-Status'),
                readSafely(FEED_PUBLISH_STATUS_KEY, normalizePublishStatus, 'Bisheriger Kern-Publish'),
            ]);

            previousHealth = health.value;
            previousHealthKnown = health.known;
            previousPublish = publish.value;
            previousPublishKnown = publish.known;

            return { health: previousHealth, publish: previousPublish };
        },

        /** Letzter bekannter Erfolgszeitpunkt eines Feeds, fuer den neuen Lauf. */
        lastSuccessAtFor(feedId) {
            return previousHealth[feedId]?.lastSuccessAt ?? null;
        },

        /**
         * Muss aufgerufen werden, sobald die Feed-Liste tatsaechlich geladen
         * ist – auch wenn sie leer ist. Erst danach darf ein Lauf den
         * gespeicherten Feed-Status leeren.
         */
        markFeedListLoaded() {
            feedListLoaded = true;
        },

        /**
         * Nach erfolgreichem Schreiben der News-Caches.
         *
         * Der Versuch bleibt danach ausdruecklich `running`: die Trendphase
         * laeuft noch, und ein Abbruch dort soll als haengender Lauf sichtbar
         * werden, nicht als sauber beendeter.
         */
        async recordCorePublish({ feedHealth, articleCount, newestArticleAt, durations }) {
            const feeds = summarizeFeedHealth(feedHealth);
            const publishedAt = now();

            await this.saveFeedHealth(feedHealth);

            // Ohne sicher gelesenen Vorzustand laesst sich `lastContentUpdateAt`
            // nur dann bestimmen, wenn dieser Lauf selbst Artikel gesehen hat.
            // Sonst wuerde ein geratener Wert die Inhaltsfrische verfaelschen.
            if (!previousPublishKnown && feeds.success === 0) {
                warn(
                    'Kern-Publish wird nicht fortgeschrieben: der bisherige Stand ist unbekannt '
                    + 'und dieser Lauf hat keine Artikel geliefert.',
                );
                await saveSafely(FEED_RUN_STATUS_KEY, progressRunStatus(runStatus, { feeds, durations }));
                return null;
            }

            const publish = buildPublishStatus({
                previous: previousPublish,
                runId: runStatus.runId,
                publishedAt,
                articleCount,
                newestArticleAt,
                feeds,
                durations,
            });

            await saveSafely(FEED_PUBLISH_STATUS_KEY, publish);
            await saveSafely(FEED_RUN_STATUS_KEY, progressRunStatus(runStatus, { feeds, durations }));

            previousPublish = publish;
            previousPublishKnown = true;
            return publish;
        },

        /**
         * Schreibt den Feed-Status, sofern das keinen Verlust bedeutet.
         *
         * Schlaegt der Schreibvorgang fehl, bleibt der Lauf trotzdem gueltig:
         * der Kern-Publish ist bereits erfolgt und wiegt schwerer als seine
         * Beobachtung. Ein eigener Ergebniszustand dafuer kommt mit O2b.
         *
         * @returns {Promise<object|null>} geschriebener Stand oder null
         */
        async saveFeedHealth(feedHealth) {
            if (!feedListLoaded) {
                warn('Feed-Status wird nicht geschrieben: die Feed-Liste wurde nie geladen.');
                return null;
            }

            if (!previousHealthKnown) {
                warn('Feed-Status wird nicht geschrieben: der bisherige Stand ist unbekannt.');
                return null;
            }

            // Eine geladene, aber leere Feed-Liste ist eine echte Aussage: es
            // gibt keine Feeds mehr. Der gespeicherte Status wird dann geleert.
            const merged = mergeFeedHealth(previousHealth, feedHealth);
            if (!await saveSafely(FEED_HEALTH_STATUS_KEY, merged)) {
                return null;
            }

            previousHealth = merged;
            return merged;
        },

        /** Der Lauf ist wirklich durch – erst hier faellt `finishedAt`. */
        async finish({ feedHealth, durations }) {
            const finished = finishRunStatus(runStatus, {
                finishedAt: now(),
                result: 'success',
                feeds: summarizeFeedHealth(feedHealth),
                durations,
            });

            await saveSafely(FEED_RUN_STATUS_KEY, finished);
            return finished;
        },

        /**
         * Fataler Abbruch. Der Kern-Publish wird nie angefasst, der Feed-Status
         * nur, wenn die Feed-Liste vorher geladen wurde.
         */
        async recordFatal({ error, feedHealth, durations }) {
            const health = await this.saveFeedHealth(feedHealth);

            const failed = finishRunStatus(runStatus, {
                finishedAt: now(),
                result: 'fatal',
                fatalError: redact(error instanceof Error ? error.message : String(error)),
                feeds: summarizeFeedHealth(feedHealth),
                durations,
            });

            await saveSafely(FEED_RUN_STATUS_KEY, failed);
            return { health, run: failed };
        },
    };
}
