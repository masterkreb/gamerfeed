// Datenmodell fuer Cron-Heartbeat und Frische (Roadmap-Paket O1).
//
// Bewusst ohne node:-Importe und ohne Netzwerkzugriff, damit dieselbe Logik im
// Cron-Skript (Node), in der Health-API (Edge) und im Admin-Panel (Browser)
// gilt. Alle Zeitvergleiche laufen ueber eine uebergebene Uhr, deshalb sind
// Grenzfaelle ohne echte Wartezeit testbar.
//
// Getrennt gefuehrt werden drei Datensaetze:
//
// - `feed_run_status`     veraenderlicher Versuch: laeuft gerade, ist beendet,
//                         ist fatal gescheitert;
// - `feed_publish_status` letzter erfolgreicher Kern-Publish;
// - `feed_health_status`  Status je Feed, mit fortgeschriebenem `lastSuccessAt`.
//
// Ein gescheiterter Versuch darf ausschliesslich `feed_run_status` und die
// Statuszeilen der betroffenen Feeds veraendern. `lastCorePublishAt` und
// `lastSuccessAt` bleiben dabei erhalten.

export const FEED_HEALTH_SCHEMA_VERSION = 1;

/**
 * Feste, dokumentierte Schwelle fuer „veraltet“.
 *
 * Der Workflow laeuft alle 20 Minuten. 50 Minuten lassen damit zwei ausgefallene
 * Laeufe plus Anlaufverzoegerung der GitHub-Actions-Warteschlange zu, bevor
 * Alarm ausgeloest wird.
 */
export const FEED_STALE_AFTER_MS = 50 * 60 * 1000;

/**
 * Erlaubte Uhrabweichung fuer Zeitstempel, die in der Zukunft liegen.
 *
 * GitHub-Runner, Vercel-Edge und KV haben leicht unterschiedliche Uhren; ein
 * paar Sekunden Vorlauf sind normal. Ein Zeitstempel, der weiter als diese
 * Toleranz in der Zukunft liegt, ist dagegen nicht plausibel und wird
 * konservativ als ungueltig behandelt – sonst waere ein einziger falsch
 * gesetzter Wert unbegrenzt lange „frisch“.
 */
export const FEED_CLOCK_SKEW_TOLERANCE_MS = 2 * 60 * 1000;

export const FEED_HEALTH_STATUS_KEY = 'feed_health_status';
export const FEED_RUN_STATUS_KEY = 'feed_run_status';
export const FEED_PUBLISH_STATUS_KEY = 'feed_publish_status';

/**
 * Ergebniszustaende eines Versuchs (O2b).
 *
 * - `running`  – der Versuch laeuft noch; `finishedAt` ist leer.
 * - `success`  – der Kernlauf ist vollstaendig **und** es wurde keine Arbeit
 *                wegen des globalen Zeit- oder Scrape-Budgets zurueckgestellt.
 * - `degraded` – der Kern-Publish war sicher moeglich, aber Arbeit wurde
 *                kontrolliert zurueckgestellt (Deadline oder Budget). Der
 *                Grund steht in `degradedReason`.
 * - `fatal`    – ein vertrauenswuerdiger Kernabschluss war nicht moeglich.
 *
 * `degraded` ist ausdruecklich **kein** `success`: sonst meldete ein Lauf einen
 * vollstaendigen Stand, obwohl Quellen oder Bilder fehlen.
 */
export const FEED_RUN_RESULTS = Object.freeze(['running', 'success', 'degraded', 'fatal']);

const FEED_STATUSES = Object.freeze(['success', 'warning', 'error', 'unknown']);

const DURATION_KEYS = Object.freeze([
    'totalMs',
    'feedFetchMs',
    'imageScrapeMs',
    'imageBackfillMs',
    'publishMs',
    'trendsMs',
]);

const MAX_ERROR_MESSAGE_LENGTH = 300;

// `scheme://user:pass@host` - das Schema folgt RFC 3986 (Buchstabe, danach
// Buchstaben, Ziffern, `+`, `-`, `.`).
const URI_CREDENTIALS_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi;

// `scheme://host/pfad?token=...` - Querystrings tragen ueblicherweise Tokens.
const URI_QUERY_PATTERN = /([a-z][a-z0-9+.-]*:\/\/[^\s?#]+)\?[^\s]*/gi;

function emptyDurations() {
    const durations = {};
    for (const key of DURATION_KEYS) {
        durations[key] = null;
    }
    return durations;
}

function emptyCounters() {
    return { total: 0, success: 0, warning: 0, error: 0, unknown: 0 };
}

/**
 * @param {unknown} value
 * @returns {string|null} ISO-8601-Zeitstempel oder null
 */
export function toIsoTimestamp(value) {
    if (value === null || value === undefined || value === '') return null;

    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    if (!Number.isFinite(time)) return null;

    return date.toISOString();
}

function toMilliseconds(value) {
    if (value === null || value === undefined || value === '') return null;

    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    return Number.isFinite(time) ? time : null;
}

function toFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toNonNegativeInteger(value) {
    const numeric = toFiniteNumber(value);
    if (numeric === null || numeric < 0) return 0;
    return Math.floor(numeric);
}

function normalizeDurations(raw) {
    const durations = emptyDurations();
    if (!raw || typeof raw !== 'object') return durations;

    for (const key of DURATION_KEYS) {
        const value = toFiniteNumber(raw[key]);
        durations[key] = value === null || value < 0 ? null : value;
    }
    return durations;
}

function normalizeCounters(raw) {
    const counters = emptyCounters();
    if (!raw || typeof raw !== 'object') return counters;

    for (const key of Object.keys(counters)) {
        counters[key] = toNonNegativeInteger(raw[key]);
    }
    return counters;
}

/**
 * Entfernt Zugangsdaten und bekannte Secret-Werte aus einer Fehlermeldung.
 *
 * Der Attempt-Status landet im Admin-Panel; Verbindungsfehler von Postgres, KV
 * oder Groq tragen die Zieladresse haeufig im Klartext mit sich.
 *
 * @param {unknown} message
 * @param {{ secrets?: unknown[], maxLength?: number }} [options]
 * @returns {string|null}
 */
export function sanitizeErrorMessage(message, { secrets = [], maxLength = MAX_ERROR_MESSAGE_LENGTH } = {}) {
    if (message === null || message === undefined) return null;

    let text = typeof message === 'string' ? message : String(message);
    if (text.trim() === '') return null;

    // Exakte Secret-Werte zuerst: kein Regex, damit Sonderzeichen keine Rolle
    // spielen. Sehr kurze Werte werden ausgelassen, sonst faerbt man die halbe
    // Meldung ein.
    for (const secret of secrets) {
        if (typeof secret !== 'string' || secret.length < 8) continue;
        text = text.split(secret).join('[redacted]');
    }

    // Zugangsdaten und Querystrings in Adressen mit Schema.
    //
    // Bewusst **nicht** nur http(s): Verbindungsfehler von Postgres, KV oder
    // Redis tragen ihre Adresse samt `user:pass@` im Text, und die Zusage
    // „keine Zugangsdaten“ darf nicht davon abhaengen, dass eine Meldung die
    // konfigurierte Zeichenfolge bytegenau wiederholt. Das Schemamuster folgt
    // RFC 3986; die exakten Secret-Werte oben laufen weiterhin zuerst.
    text = text.replace(URI_CREDENTIALS_PATTERN, '$1');
    text = text.replace(URI_QUERY_PATTERN, '$1?[redacted]');

    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > maxLength) {
        text = `${text.slice(0, maxLength)}…`;
    }

    return text;
}

/**
 * Normalisiert eine einzelne Feed-Statuszeile.
 *
 * `status` und `message` bleiben unveraendert, damit bestehende Leser des
 * Admin-Panels weiterarbeiten.
 */
export function normalizeFeedHealthEntry(raw) {
    const status = FEED_STATUSES.includes(raw?.status) ? raw.status : 'unknown';
    const message = typeof raw?.message === 'string' ? raw.message : '';
    const durationMs = toFiniteNumber(raw?.durationMs);

    return {
        status,
        message,
        lastAttemptAt: toIsoTimestamp(raw?.lastAttemptAt),
        lastSuccessAt: toIsoTimestamp(raw?.lastSuccessAt),
        durationMs: durationMs === null || durationMs < 0 ? null : durationMs,
        articleCount: raw?.articleCount === undefined || raw?.articleCount === null
            ? null
            : toNonNegativeInteger(raw.articleCount),
        // Anzahl der beim Parsen uebersprungenen Elemente (O2a). Nur eine Zahl -
        // Gruende stehen in `message`, Inhalte nirgends.
        skippedItemCount: raw?.skippedItemCount === undefined || raw?.skippedItemCount === null
            ? null
            : toNonNegativeInteger(raw.skippedItemCount),
    };
}

/** @returns {Record<string, ReturnType<typeof normalizeFeedHealthEntry>>} */
export function normalizeFeedHealth(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

    const normalized = {};
    for (const [feedId, entry] of Object.entries(raw)) {
        normalized[feedId] = normalizeFeedHealthEntry(entry);
    }
    return normalized;
}

/**
 * Zaehlt die Feed-Ergebnisse eines Laufs.
 *
 * @param {Record<string, unknown>} health
 */
export function summarizeFeedHealth(health) {
    const counters = emptyCounters();
    for (const entry of Object.values(normalizeFeedHealth(health))) {
        counters.total += 1;
        counters[entry.status] += 1;
    }
    return counters;
}

/**
 * Fuehrt den Feed-Status des laufenden Versuchs mit dem gespeicherten zusammen.
 *
 * `lastSuccessAt` wird nur von einem Lauf fortgeschrieben, in dem der Feed
 * tatsaechlich Artikel geliefert hat; sonst bleibt der gespeicherte Wert
 * stehen.
 *
 * Ein leerer aktueller Status ergibt hier bewusst ein leeres Ergebnis. Ob das
 * gespeichert werden darf, haengt davon ab, warum er leer ist – eine
 * tatsaechlich leere Feed-Liste soll geloeschte Feeds entfernen, ein Abbruch
 * vor dem Laden der Liste dagegen nichts anfassen. Diese Entscheidung trifft
 * `scripts/feed-run-recorder.js`, nicht diese Funktion.
 */
export function mergeFeedHealth(previousHealth, currentHealth) {
    const previous = normalizeFeedHealth(previousHealth);
    const current = normalizeFeedHealth(currentHealth);

    const merged = {};
    for (const [feedId, entry] of Object.entries(current)) {
        const stored = previous[feedId];
        merged[feedId] = {
            ...entry,
            lastSuccessAt: entry.status === 'success'
                ? (entry.lastSuccessAt ?? entry.lastAttemptAt)
                : (stored?.lastSuccessAt ?? null),
        };
    }
    return merged;
}

/**
 * Legt den veraenderlichen Attempt-Status zu Beginn eines Laufs an.
 *
 * @param {{ runId: string, startedAt: unknown }} params
 */
export function createRunStatus({ runId, startedAt }) {
    return {
        schemaVersion: FEED_HEALTH_SCHEMA_VERSION,
        runId: String(runId),
        startedAt: toIsoTimestamp(startedAt),
        finishedAt: null,
        result: 'running',
        fatalError: null,
        degradedReason: null,
        feeds: emptyCounters(),
        durations: emptyDurations(),
    };
}

function buildRunStatus(run, {
    finishedAt,
    result,
    fatalError = null,
    degradedReason = null,
    feeds,
    durations,
}) {
    const started = normalizeRunStatus(run);
    const effectiveResult = FEED_RUN_RESULTS.includes(result) ? result : 'fatal';

    return {
        schemaVersion: FEED_HEALTH_SCHEMA_VERSION,
        runId: started?.runId ?? null,
        startedAt: started?.startedAt ?? null,
        finishedAt: toIsoTimestamp(finishedAt),
        result: effectiveResult,
        fatalError: sanitizeErrorMessage(fatalError),
        // Nur ein degradierter Lauf traegt einen Grund. Ein `success` mit
        // Begruendung waere widerspruechlich, ein `fatal` hat `fatalError`.
        degradedReason: effectiveResult === 'degraded' ? sanitizeErrorMessage(degradedReason) : null,
        feeds: normalizeCounters(feeds ?? run?.feeds),
        durations: normalizeDurations(durations ?? run?.durations),
    };
}

/**
 * Schreibt Zwischenstaende eines noch laufenden Versuchs fort.
 *
 * `finishedAt` bleibt dabei bewusst leer: solange noch eine Phase aussteht, ist
 * der Lauf nicht beendet. Ein Abbruch danach wird deshalb am `startedAt`
 * gemessen und faellt als haengender Lauf auf.
 *
 * @param {ReturnType<typeof createRunStatus>} run
 */
export function progressRunStatus(run, { feeds, durations } = {}) {
    return buildRunStatus(run, { finishedAt: null, result: 'running', feeds, durations });
}

/**
 * Ergebniszustand eines abgeschlossenen Kernlaufs.
 *
 * Bewusst eine eigene Funktion: die Antwort „war das ein `success`?" darf nicht
 * an mehreren Stellen unabhaengig voneinander getroffen werden.
 *
 * @param {{ deferredWork?: boolean }} params
 * @returns {'success'|'degraded'}
 */
export function resolveRunResult({ deferredWork = false } = {}) {
    return deferredWork ? 'degraded' : 'success';
}

/**
 * Schliesst den Attempt-Status ab, ohne das Ausgangsobjekt zu veraendern.
 *
 * @param {ReturnType<typeof createRunStatus>} run
 */
export function finishRunStatus(run, options = {}) {
    return buildRunStatus(run, options);
}

/** @returns {ReturnType<typeof createRunStatus>|null} */
export function normalizeRunStatus(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const startedAt = toIsoTimestamp(raw.startedAt);
    const finishedAt = toIsoTimestamp(raw.finishedAt);
    if (startedAt === null && finishedAt === null) return null;

    const result = FEED_RUN_RESULTS.includes(raw.result) ? raw.result : 'running';

    return {
        schemaVersion: FEED_HEALTH_SCHEMA_VERSION,
        runId: typeof raw.runId === 'string' && raw.runId !== '' ? raw.runId : null,
        startedAt,
        finishedAt,
        result,
        fatalError: sanitizeErrorMessage(raw.fatalError),
        // Auch beim Lesen gilt: nur ein degradierter Lauf traegt einen Grund.
        // Ein aelterer oder manipulierter Datensatz mit `success` und
        // Begruendung wuerde im Admin sonst einen Widerspruch anzeigen –
        // „abgeschlossen“ neben „zurückgestellt: …“.
        degradedReason: result === 'degraded' ? sanitizeErrorMessage(raw.degradedReason) : null,
        feeds: normalizeCounters(raw.feeds),
        durations: normalizeDurations(raw.durations),
    };
}

/** @returns {object|null} */
export function normalizePublishStatus(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const lastCorePublishAt = toIsoTimestamp(raw.lastCorePublishAt);
    if (lastCorePublishAt === null) return null;

    return {
        schemaVersion: FEED_HEALTH_SCHEMA_VERSION,
        runId: typeof raw.runId === 'string' && raw.runId !== '' ? raw.runId : null,
        lastCorePublishAt,
        lastContentUpdateAt: toIsoTimestamp(raw.lastContentUpdateAt),
        newestArticleAt: toIsoTimestamp(raw.newestArticleAt),
        articleCount: toNonNegativeInteger(raw.articleCount),
        feeds: normalizeCounters(raw.feeds),
        durations: normalizeDurations(raw.durations),
    };
}

/**
 * Schreibt den Kern-Publish fort.
 *
 * `lastCorePublishAt` gilt jedem geschriebenen News-Cache, auch wenn der Lauf
 * nur alte Artikel erneut veroeffentlicht hat.
 *
 * `lastContentUpdateAt` verlangt zusaetzlich `feeds.success > 0`. Das belegt
 * genau eine Sache: mindestens ein Feed hat ueberhaupt Artikel geliefert. Es
 * belegt **nicht**, dass darunter neue Artikel waren – ein unveraenderter Feed
 * zaehlt hier ebenso. Eine Novelty-Erkennung gehoert nicht zu O1.
 *
 * Ist `previous` nicht sicher gelesen worden, darf das Ergebnis bei
 * `feeds.success === 0` nicht gespeichert werden: es enthielte dann ein
 * geratenes `lastContentUpdateAt`. Diese Entscheidung trifft
 * `scripts/feed-run-recorder.js`.
 */
export function buildPublishStatus({
    previous,
    runId,
    publishedAt,
    articleCount,
    newestArticleAt,
    feeds,
    durations,
}) {
    const storedPublish = normalizePublishStatus(previous);
    const counters = normalizeCounters(feeds);
    const publishedAtIso = toIsoTimestamp(publishedAt);

    return {
        schemaVersion: FEED_HEALTH_SCHEMA_VERSION,
        runId: runId === undefined || runId === null ? null : String(runId),
        lastCorePublishAt: publishedAtIso,
        lastContentUpdateAt: counters.success > 0
            ? publishedAtIso
            : (storedPublish?.lastContentUpdateAt ?? null),
        newestArticleAt: toIsoTimestamp(newestArticleAt),
        articleCount: toNonNegativeInteger(articleCount),
        feeds: counters,
        durations: normalizeDurations(durations),
    };
}

function describeFreshness(timestamp, nowMs, staleAfterMs) {
    const at = toIsoTimestamp(timestamp);
    const atMs = toMilliseconds(timestamp);
    const ageMs = atMs === null ? null : nowMs - atMs;

    // Ein Zeitstempel jenseits der Uhrtoleranz in der Zukunft ist nicht
    // plausibel. Ohne diese Pruefung wuerde er dauerhaft als frisch gelten und
    // genau den Ausfall verdecken, den der Heartbeat melden soll.
    const isFuture = ageMs !== null && ageMs < -FEED_CLOCK_SKEW_TOLERANCE_MS;

    return {
        at,
        ageMs,
        isFuture,
        // Fehlender Zeitstempel gilt als veraltet. Genau auf der Schwelle noch
        // nicht, erst darueber – das macht die Grenze eindeutig testbar.
        isStale: ageMs === null || isFuture || ageMs > staleAfterMs,
    };
}

/**
 * Stellt Workflow-Frische, Kern-Publish und Inhaltsfrische getrennt dar.
 *
 * @param {{ run?: unknown, publish?: unknown, now: unknown, staleAfterMs?: number }} params
 * @returns {import('../types').FeedHeartbeat}
 */
export function buildFreshnessReport({ run, publish, now, staleAfterMs = FEED_STALE_AFTER_MS }) {
    const nowMs = toMilliseconds(now) ?? 0;
    const threshold = toFiniteNumber(staleAfterMs) ?? FEED_STALE_AFTER_MS;
    const runStatus = normalizeRunStatus(run);
    const publishStatus = normalizePublishStatus(publish);

    // Ein abgebrochener Lauf hinterlaesst kein `finishedAt`; dann zaehlt der
    // Start, damit ein haengender Lauf ebenfalls veraltet.
    const runFreshness = describeFreshness(
        runStatus?.finishedAt ?? runStatus?.startedAt ?? null,
        nowMs,
        threshold,
    );
    const publishFreshness = describeFreshness(
        publishStatus?.lastCorePublishAt ?? null,
        nowMs,
        threshold,
    );
    const contentFreshness = describeFreshness(
        publishStatus?.lastContentUpdateAt ?? null,
        nowMs,
        threshold,
    );
    const newestArticle = describeFreshness(
        publishStatus?.newestArticleAt ?? null,
        nowMs,
        threshold,
    );

    return {
        now: toIsoTimestamp(nowMs),
        staleAfterMs: threshold,
        isStale: runFreshness.isStale || publishFreshness.isStale || contentFreshness.isStale,
        run: {
            ...runFreshness,
            runId: runStatus?.runId ?? null,
            startedAt: runStatus?.startedAt ?? null,
            finishedAt: runStatus?.finishedAt ?? null,
            result: runStatus?.result ?? null,
            fatalError: runStatus?.fatalError ?? null,
            degradedReason: runStatus?.degradedReason ?? null,
            feeds: runStatus?.feeds ?? emptyCounters(),
            durations: runStatus?.durations ?? emptyDurations(),
        },
        corePublish: {
            ...publishFreshness,
            runId: publishStatus?.runId ?? null,
            articleCount: publishStatus?.articleCount ?? 0,
            feeds: publishStatus?.feeds ?? emptyCounters(),
            durations: publishStatus?.durations ?? emptyDurations(),
        },
        content: {
            ...contentFreshness,
            newestArticleAt: newestArticle.at,
            newestArticleAgeMs: newestArticle.ageMs,
        },
    };
}
