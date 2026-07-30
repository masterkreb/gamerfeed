// Strukturierter Laufbericht und GitHub-Step-Summary (Roadmap O4a).
//
// Rein und ohne Seiteneffekte: Der Bericht entsteht ausschliesslich aus Daten,
// die der Lauf ohnehin schon hat - `feed_run_status`, `feed_health_status`, das
// Ergebnis des Snapshot-Publishers und die im Arbeitsspeicher gesammelten
// Transportangaben. **Es entstehen keine neuen KV-Schluessel**; die
// Transportangaben leben nur so lange wie der laufende Prozess.
//
// Die Zusammenfassung ist reine Beobachtbarkeit. Sie darf ein Ergebnis niemals
// veraendern: `writeRunSummary` wirft nicht und meldet einen Fehlschlag nur als
// `false`.

/** Hoechstzahl der Zeilen in der Feed-Tabelle; der Rest wird nur gezaehlt. */
export const SUMMARY_MAX_FEED_ROWS = 50;

/** Hoechstlaenge eines Feed-Namens in der Tabelle. */
export const SUMMARY_MAX_NAME_LENGTH = 60;

/** Hoechstlaenge des Degraded- oder Fatalgrunds. */
export const SUMMARY_MAX_REASON_LENGTH = 300;

export const FEED_TRANSPORTS = Object.freeze(['direct', 'proxy', 'none']);

const DURATION_KEYS = Object.freeze([
    'totalMs',
    'feedFetchMs',
    'imageScrapeMs',
    'imageBackfillMs',
    'publishMs',
    'trendsMs',
]);

const DURATION_LABELS = Object.freeze({
    totalMs: 'Gesamt',
    feedFetchMs: 'Feed-Abruf',
    imageScrapeMs: 'Bild-Scraping',
    imageBackfillMs: 'Bild-Backfill',
    publishMs: 'Publish',
    trendsMs: 'Trends',
});

const RESULT_LABELS = Object.freeze({
    success: '✅ success',
    degraded: '⚠️ degraded',
    fatal: '❌ fatal',
    running: '⏳ running',
});

function toNonNegativeInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

/**
 * Zaehlwert, der unbekannt bleiben darf.
 *
 * `null`, `undefined` und unbrauchbare Werte ergeben `null` statt `0`. Eine
 * nie bearbeitete Quelle hat ihre Items nicht untersucht - `0 uebersprungen`
 * waere eine unbelegte Aussage. Eine ausdruecklich gemessene `0` bleibt `0`.
 */
function toNullableCount(value) {
    if (value === null || value === undefined || value === '') return null;

    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    return Math.floor(number);
}

function toDurationMs(value) {
    // `null` heisst "Phase lief nicht" und darf nicht zu 0 werden -
    // `Number(null)` waere 0 und behauptete eine Dauer von null Millisekunden.
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

/**
 * HTTP-Status nur, wenn er wirklich bekannt ist.
 *
 * Niemals raten: ein fehlender Status heisst, dass gar keine Antwort ankam -
 * etwa bei einem Verbindungsfehler oder einer zurueckgestellten Quelle.
 */
function toHttpStatus(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 100 && number <= 599 ? number : null;
}

/**
 * Normalisiert die Transportangabe.
 *
 * `proxy` bedeutet ausdruecklich, dass die **erfolgreiche** Antwort vom Proxy
 * kam - nicht, dass ein Proxyversuch moeglich gewesen waere. Alles Unbekannte
 * wird `none`, statt einen Weg zu behaupten.
 */
export function normalizeTransport(value) {
    return FEED_TRANSPORTS.includes(value) ? value : 'none';
}

/**
 * Fehler- und Warnquote mit **einem** dokumentierten Nenner.
 *
 * Nenner ist `success + warning + error`, also jede Quelle mit einem echten
 * Befund. `unknown` heisst, dass die Quelle in diesem Lauf gar nicht beurteilt
 * wurde - etwa weil er vorher abbrach; sie im Nenner zu fuehren wuerde die
 * Quote beschoenigen, im Zaehler wuerde sie sie erfinden. Sie wird deshalb
 * getrennt ausgewiesen.
 *
 * Warnungen stehen im Nenner, aber **nie** im Zaehler: eine zurueckgestellte
 * oder artikellose Quelle ist kein Abruffehler. Damit die beiden Befunde nicht
 * unbemerkt verschmelzen, gibt es die Warnquote als eigene Zahl.
 */
export function computeFeedRates(counters = {}) {
    const success = toNonNegativeInteger(counters.success);
    const warning = toNonNegativeInteger(counters.warning);
    const error = toNonNegativeInteger(counters.error);
    const unknown = toNonNegativeInteger(counters.unknown);
    const evaluated = success + warning + error;

    return {
        evaluated,
        unknown,
        errorRate: evaluated === 0 ? null : error / evaluated,
        warningRate: evaluated === 0 ? null : warning / evaluated,
    };
}

/**
 * Macht einen Feed-Namen fuer eine Markdown-Tabellenzelle unschaedlich.
 *
 * Der Name stammt aus der Datenbank. Ein `|` zerlegte die Spalten, ein
 * Zeilenumbruch die Tabelle; Backticks und Sternchen wuerden formatieren.
 */
function escapeTableCell(value) {
    const text = String(value ?? '')
        // Steuerzeichen und Zeilenumbrueche zu einfachen Leerzeichen.
        .replace(/[\u0000-\u001F\u007F]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const truncated = text.length > SUMMARY_MAX_NAME_LENGTH
        ? `${text.slice(0, SUMMARY_MAX_NAME_LENGTH - 1)}…`
        : text;

    return truncated.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, match => `\\${match}`);
}

/** Mehrzeiliger Fliesstext bleibt einzeilig und begrenzt. */
function toSingleLine(value, maxLength) {
    const text = String(value ?? '')
        .replace(/[\u0000-\u001F\u007F]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (text === '') return null;
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function pickDurations(raw) {
    const durations = {};
    for (const key of DURATION_KEYS) {
        durations[key] = toDurationMs(raw?.[key]);
    }
    return durations;
}

function payloadFacts(payload) {
    if (!payload) return null;
    return {
        count: Array.isArray(payload.articles) ? payload.articles.length : 0,
        bytes: toNonNegativeInteger(payload.bytes),
    };
}

/**
 * Baut den strukturierten Laufbericht.
 *
 * @param {{
 *   run: object|null,
 *   feeds?: Array<{ id: string, name?: string }>,
 *   feedHealth?: Record<string, object>,
 *   transports?: Map<string, { transport?: string, httpStatus?: number|null }>,
 *   snapshot?: { pointer?: object, payloads?: object }|null,
 *   redact?: (message: string) => string,
 *   maxFeedRows?: number,
 * }} params
 */
export function buildRunSummary({
    run = null,
    feeds = [],
    feedHealth = {},
    transports = new Map(),
    snapshot = null,
    redact = message => String(message),
    maxFeedRows = SUMMARY_MAX_FEED_ROWS,
} = {}) {
    const result = typeof run?.result === 'string' ? run.result : 'fatal';

    // Nur ein Grund, und nur der zum Ergebnis passende. `fatalError` und
    // `degradedReason` sind bereits im Heartbeat bereinigt; die Bereinigung
    // laeuft hier trotzdem erneut, weil der Bericht auch aus anderen Quellen
    // gespeist werden koennte.
    const rawReason = result === 'fatal'
        ? run?.fatalError
        : (result === 'degraded' ? run?.degradedReason : null);
    const reason = rawReason ? toSingleLine(redact(String(rawReason)), SUMMARY_MAX_REASON_LENGTH) : null;

    const counters = {
        total: toNonNegativeInteger(run?.feeds?.total),
        success: toNonNegativeInteger(run?.feeds?.success),
        warning: toNonNegativeInteger(run?.feeds?.warning),
        error: toNonNegativeInteger(run?.feeds?.error),
        unknown: toNonNegativeInteger(run?.feeds?.unknown),
    };

    const limit = Number.isInteger(maxFeedRows) && maxFeedRows > 0 ? maxFeedRows : SUMMARY_MAX_FEED_ROWS;
    const visibleFeeds = feeds.slice(0, limit).map(feed => {
        const health = feedHealth?.[feed.id] ?? {};
        const transport = transports?.get?.(feed.id) ?? null;

        return {
            name: escapeTableCell(feed.name ?? feed.id),
            status: typeof health.status === 'string' ? health.status : 'unknown',
            durationMs: toDurationMs(health.durationMs),
            // Ausschliesslich die in **diesem** Lauf gelieferten Artikel. Alte,
            // lediglich beibehaltene Artikel stehen hier nie. Beide Zahlen
            // duerfen unbekannt bleiben, statt eine Null zu behaupten.
            articleCount: toNullableCount(health.articleCount),
            skippedItemCount: toNullableCount(health.skippedItemCount),
            transport: normalizeTransport(transport?.transport),
            httpStatus: toHttpStatus(transport?.httpStatus),
        };
    });

    const pointerId = typeof snapshot?.pointer?.snapshotId === 'string'
        ? snapshot.pointer.snapshotId
        : null;

    return {
        runId: typeof run?.runId === 'string' ? run.runId : null,
        result,
        reason,
        startedAt: run?.startedAt ?? null,
        finishedAt: run?.finishedAt ?? null,
        durations: pickDurations(run?.durations),
        counters,
        rates: computeFeedRates(counters),
        snapshot: pointerId === null ? null : {
            snapshotId: pointerId,
            full: payloadFacts(snapshot?.payloads?.full),
            medium: payloadFacts(snapshot?.payloads?.medium),
            preview: payloadFacts(snapshot?.payloads?.preview),
        },
        feeds: visibleFeeds,
        truncatedFeedCount: Math.max(0, feeds.length - visibleFeeds.length),
    };
}

/**
 * Minimaler Bericht fuer einen Abbruch in der Vorpruefung.
 *
 * Zu diesem Zeitpunkt gibt es weder Recorder noch Feed-Liste noch irgendeinen
 * externen Zugriff - und deshalb **nichts** zu berichten ausser dem bereits
 * sicheren Konfigurationsfehler. `counters` bleibt bewusst `null`: eine
 * Zaehlertabelle voller Nullen waere eine erfundene Aussage ueber Feeds, die
 * nie betrachtet wurden.
 *
 * @param {{ runId?: string|null, message: unknown, redact?: (message: string) => string }} params
 */
export function buildPreflightFailureSummary({
    runId = null,
    message,
    redact = value => String(value),
} = {}) {
    return {
        runId: typeof runId === 'string' && runId !== '' ? runId : null,
        result: 'fatal',
        reason: message ? toSingleLine(redact(String(message)), SUMMARY_MAX_REASON_LENGTH) : null,
        startedAt: null,
        finishedAt: null,
        durations: pickDurations(null),
        counters: null,
        rates: null,
        snapshot: null,
        feeds: [],
        truncatedFeedCount: 0,
        preflightFailure: true,
    };
}

/** Fügt alle Zeilen zu einem Markdown-Block mit abschließendem Umbruch. */
function joinLines(lines) {
    const newline = String.fromCharCode(10);
    return `${lines.join(newline)}${newline}`;
}

function formatDuration(ms) {
    if (ms === null) return '–';
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
}

function formatBytes(bytes) {
    if (bytes === null || bytes === undefined) return '–';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function formatRate(rate) {
    return rate === null ? '–' : `${(rate * 100).toFixed(1)} %`;
}

function formatCount(value) {
    return value === null ? '–' : String(value);
}

function payloadRow(label, facts) {
    return facts === null
        ? `| ${label} | – | – |`
        : `| ${label} | ${facts.count} | ${formatBytes(facts.bytes)} |`;
}

/**
 * Rendert den Bericht als Markdown fuer `GITHUB_STEP_SUMMARY`.
 *
 * Bewusst ohne jede Adresse: keine Feed-URL, keine Proxy-Adresse, keine
 * Artikeltitel oder -inhalte. Die ausfuehrlichen Meldungen je Feed bleiben im
 * Log und im Admin-Panel.
 */
export function renderRunSummaryMarkdown(summary) {
    const lines = [];

    lines.push('## 🫀 GamerFeed-Lauf');
    lines.push('');
    lines.push(`- **Ergebnis:** ${RESULT_LABELS[summary.result] ?? summary.result}`);
    lines.push(`- **Lauf-ID:** \`${summary.runId ?? 'unbekannt'}\``);
    if (summary.reason) {
        lines.push(`- **Grund:** ${summary.reason}`);
    }
    lines.push('');

    // Ein Abbruch in der Vorpruefung hat weder Phasen noch Feeds noch einen
    // Snapshot. Die Abschnitte entfallen deshalb ganz, statt Nullen zu zeigen.
    if (summary.preflightFailure === true) {
        lines.push(
            'Der Lauf endete in der Vorprüfung, noch vor jedem externen Zugriff. '
            + 'Es gibt deshalb keine Phasen-, Feed- oder Snapshot-Daten.',
        );
        lines.push('');
        return joinLines(lines);
    }

    lines.push('### Dauern');
    lines.push('');
    lines.push('| Phase | Dauer |');
    lines.push('| --- | ---: |');
    for (const key of DURATION_KEYS) {
        lines.push(`| ${DURATION_LABELS[key]} | ${formatDuration(summary.durations[key])} |`);
    }
    lines.push('');

    lines.push('### Feeds');
    lines.push('');
    lines.push('| Gesamt | Erfolg | Warnung | Fehler | Unbekannt |');
    lines.push('| ---: | ---: | ---: | ---: | ---: |');
    lines.push(
        `| ${summary.counters.total} | ${summary.counters.success} | ${summary.counters.warning}`
        + ` | ${summary.counters.error} | ${summary.counters.unknown} |`,
    );
    lines.push('');
    lines.push(
        `Fehlerquote ${formatRate(summary.rates.errorRate)}, `
        + `Warnquote ${formatRate(summary.rates.warningRate)} `
        + `(Nenner: ${summary.rates.evaluated} bewertete Feeds; `
        + `${summary.rates.unknown} unbewertet und ausgenommen).`,
    );
    lines.push('');

    lines.push('### Snapshot');
    lines.push('');
    if (summary.snapshot === null) {
        lines.push('Kein Kern-Publish in diesem Lauf.');
    } else {
        lines.push(`Aktive Generation: \`${summary.snapshot.snapshotId}\``);
        lines.push('');
        lines.push('| Payload | Artikel | Bytes |');
        lines.push('| --- | ---: | ---: |');
        lines.push(payloadRow('Full', summary.snapshot.full));
        lines.push(payloadRow('Medium', summary.snapshot.medium));
        lines.push(payloadRow('Preview', summary.snapshot.preview));
    }
    lines.push('');

    lines.push('### Quellen');
    lines.push('');
    lines.push('| Quelle | Ergebnis | Dauer | Artikel | Übersprungen | Transport | HTTP |');
    lines.push('| --- | --- | ---: | ---: | ---: | --- | ---: |');
    for (const feed of summary.feeds) {
        lines.push(
            `| ${feed.name} | ${feed.status} | ${formatDuration(feed.durationMs)}`
            + ` | ${formatCount(feed.articleCount)} | ${formatCount(feed.skippedItemCount)}`
            + ` | ${feed.transport} | ${feed.httpStatus ?? '–'} |`,
        );
    }
    if (summary.truncatedFeedCount > 0) {
        lines.push('');
        lines.push(`… und ${summary.truncatedFeedCount} weitere Quellen (Tabelle begrenzt).`);
    }
    lines.push('');

    return joinLines(lines);
}

/**
 * Schreibt die Zusammenfassung, wenn GitHub Actions eine Datei dafuer bereitstellt.
 *
 * Ausdruecklich **best effort**: Ohne gesetzten Pfad passiert gar nichts, und
 * ein Schreibfehler wird nur protokolliert. Ein erfolgreicher Kern-Publish darf
 * daran nicht scheitern, und ein bereits vorhandener Fatalfehler oder Exit-Code
 * darf davon nicht ueberdeckt werden.
 *
 * @returns {Promise<boolean>} ob wirklich geschrieben wurde
 */
export async function writeRunSummary({
    env = {},
    markdown,
    writeSummary,
    redact = message => String(message),
    logger = console,
} = {}) {
    const path = typeof env.GITHUB_STEP_SUMMARY === 'string' ? env.GITHUB_STEP_SUMMARY.trim() : '';
    if (path === '' || typeof writeSummary !== 'function') return false;

    try {
        await writeSummary(path, markdown);
        return true;
    } catch (error) {
        logger?.warn?.(`   ⚠️  Zusammenfassung konnte nicht geschrieben werden: ${redact(
            error instanceof Error ? error.message : String(error),
        )}`);
        return false;
    }
}
