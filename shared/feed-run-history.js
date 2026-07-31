// Datenmodell der begrenzten Laufhistorie (Roadmap-Paket O4b).
//
// Der Heartbeat aus O1 kennt genau einen Lauf: den letzten. Damit ist die Frage
// „läuft das seit Stunden schief oder war das ein einzelner Ausrutscher?“ nicht
// beantwortbar. O4b legt deshalb eine **begrenzte** Historie abgeschlossener
// Läufe an.
//
// Bewusst ohne `node:`-Importe und ohne Netzwerkzugriff: dieselben Regeln
// gelten im Cron-Skript (Node), in der Health-API (Edge) und im Admin-Panel
// (Browser). Der Speicherzugriff selbst steht getrennt in
// `shared/feed-run-history-store.js`.
//
// Drei Zusagen tragen dieses Modul:
//
// 1. Es wird **nur** ein abgeschlossener Lauf gespeichert. `running` hat kein
//    `finishedAt` und ist damit weder einsortierbar noch aussagekräftig.
// 2. Es landen ausschliesslich Zahlen, Zeitstempel und ein bereinigter Grund in
//    der Historie – keine Feed-Adressen, keine Proxy-Adresse, keine
//    Artikeltexte und keine Einzelmeldungen je Feed.
// 3. Gelesene Einträge werden genauso streng normalisiert wie geschriebene. Ein
//    beschädigter Datensatz ergibt `null` und wird vom Leser übersprungen,
//    statt die gesamte Historie unbrauchbar zu machen.
// 4. Kein Zugriff auf die Historie wartet unbegrenzt. „Best effort“ heisst
//    nicht nur „ein Fehler ist folgenlos“, sondern auch „ein haengender
//    Speicher haelt niemanden auf“ – sonst blockiert eine nicht antwortende
//    Verbindung den Laufabschluss oder die gesamte Health-Antwort.

import {
    normalizeCounters,
    normalizeDurations,
    sanitizeErrorMessage,
    toIsoTimestamp,
} from './feed-health-model.js';

export const FEED_RUN_HISTORY_KEY = 'feed_run_history';

export const FEED_RUN_HISTORY_SCHEMA_VERSION = 1;

/**
 * Grösse der Historie in Läufen.
 *
 * Der Workflow ist auf alle 20 Minuten geplant; 72 Einträge entsprechen damit
 * **rechnerisch** rund einem Tag. Der tatsächlich abgedeckte Zeitraum kann
 * kürzer oder länger sein: verspätete oder ausgefallene GitHub-Actions-Läufe
 * verschieben ihn, und ein nie gestarteter Lauf hinterlässt hier gar keinen
 * Eintrag. Die Zahl begrenzt also die Anzahl der Läufe, nicht die Zeitspanne.
 */
export const FEED_RUN_HISTORY_LIMIT = 72;

/**
 * Ergebniszustände, die überhaupt in die Historie dürfen.
 *
 * `running` fehlt hier absichtlich: ein laufender Versuch ist nicht
 * abgeschlossen, hat kein `finishedAt` und wäre im Zeitverlauf nicht
 * einsortierbar. Der veränderliche `feed_run_status` bleibt die einzige Quelle
 * für „läuft gerade“.
 */
export const FEED_RUN_HISTORY_RESULTS = Object.freeze(['success', 'degraded', 'fatal']);

/**
 * Frist für einen einzelnen Historienzugriff.
 *
 * Ein Speicher, der gar nicht antwortet, ist etwas anderes als einer, der einen
 * Fehler meldet: ohne Frist bliebe `finish()` unbegrenzt haengen, obwohl
 * `feed_run_status` bereits geschrieben ist, und die Health-Antwort kaeme nie
 * an, obwohl alle uebrigen Daten vorliegen.
 *
 * Drei Sekunden sind reichlich fuer eine einzelne KV-Transaktion und kurz genug,
 * um weder den Laufabschluss noch eine Admin-Anfrage spuerbar zu verzoegern.
 * Die Historie ist Beobachtbarkeit; sie darf niemanden aufhalten.
 */
export const FEED_RUN_HISTORY_TIMEOUT_MS = 3000;

/**
 * Begrenzt einen Historienzugriff auf eine kurze, feste Frist.
 *
 * Der Zeitgeber ist injizierbar, damit Tests einen haengenden Speicher
 * nachstellen koennen, ohne real zu warten.
 *
 * Zwei Feinheiten, die leicht untergehen:
 *
 * - Der Zeitgeber wird auf **jedem** Abschlussweg wieder abgeraeumt, auch im
 *   Erfolgsfall. Sonst haelt ein offener Timer den Node-Prozess des Cron-Laufs
 *   nach dem letzten Schreibvorgang unnoetig am Leben.
 * - Eine **verspaetete Ablehnung** des ueberholten Zugriffs bekommt hier einen
 *   eigenen Handler. Ohne ihn beendete eine Ablehnung, die erst nach dem
 *   Zeitablauf eintrifft, den Prozess als unbehandelte Ablehnung – ausgerechnet
 *   ausgeloest von der Historie, die niemals ein Ergebnis veraendern darf.
 *
 * @param {() => Promise<unknown>} start startet den Zugriff
 * @param {{
 *   timeoutMs?: number,
 *   setTimer?: (callback: () => void, ms: number) => unknown,
 *   clearTimer?: (handle: unknown) => void,
 * }} [options]
 */
export async function withRunHistoryDeadline(start, {
    timeoutMs = FEED_RUN_HISTORY_TIMEOUT_MS,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = handle => clearTimeout(handle),
} = {}) {
    // Auch ein synchroner Wurf des Aufrufers wird so zu einer Ablehnung und
    // laeuft durch dieselbe Behandlung.
    const operation = (async () => start())();

    // Siehe oben: der ueberholte Zugriff darf niemanden mehr stoeren.
    operation.catch(() => {});

    // Eine unbrauchbare Frist schaltet die Begrenzung nicht ab, sondern faellt
    // auf die Vorgabe zurueck. „Keine Frist“ waere genau der Zustand, den diese
    // Funktion verhindern soll.
    const effectiveMs = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : FEED_RUN_HISTORY_TIMEOUT_MS;

    let handle = null;
    try {
        return await Promise.race([
            operation,
            new Promise((_resolve, reject) => {
                handle = setTimer(
                    // Bewusst ohne Speicherdetails im Text: die Meldung landet
                    // im Protokoll des Laufs.
                    () => reject(new Error(`Zeitgrenze von ${effectiveMs} ms überschritten`)),
                    effectiveMs,
                );
            }),
        ]);
    } finally {
        clearTimer(handle);
    }
}

/**
 * Baut einen Historieneintrag aus einem abgeschlossenen Laufstatus.
 *
 * Gibt `null` zurück, wenn der Lauf nicht in die Historie gehört – also bei
 * `running`, bei unbekanntem Ergebnis oder bei unbrauchbaren Zeitstempeln.
 * Der Aufrufer schreibt dann schlicht nichts; ein geratener Eintrag wäre
 * schlechter als eine Lücke.
 *
 * Die Schema-Version des **Laufstatus** wird hier ausdrücklich nicht geprüft:
 * diese Funktion übersetzt einen aktuellen Laufstatus in das aktuelle
 * History-Schema und vergibt die Version dabei selbst. Erst beim Lesen ist die
 * gespeicherte Version eine echte Aussage – siehe `normalizeRunHistoryEntry`.
 *
 * @param {unknown} run abgeschlossener Laufstatus (`finishRunStatus`)
 * @param {{ redact?: (message: string) => string, secrets?: unknown[] }} [options]
 * @returns {object|null}
 */
export function buildRunHistoryEntry(run, options = {}) {
    if (!run || typeof run !== 'object' || Array.isArray(run)) return null;

    const result = FEED_RUN_HISTORY_RESULTS.includes(run.result) ? run.result : null;
    if (result === null) return null;

    const startedAt = toIsoTimestamp(run.startedAt);
    const finishedAt = toIsoTimestamp(run.finishedAt);
    // Beide Zeitstempel sind Pflicht: `finishedAt` ist der Sortierschlüssel der
    // Historie, `startedAt` die einzige Grundlage einer Laufzeitangabe.
    if (startedAt === null || finishedAt === null) return null;

    return {
        schemaVersion: FEED_RUN_HISTORY_SCHEMA_VERSION,
        runId: typeof run.runId === 'string' && run.runId !== '' ? run.runId : null,
        startedAt,
        finishedAt,
        result,
        // Genau ein Grundfeld je Ergebnis. Ein `success` mit Begründung oder ein
        // `degraded` mit Fatalfehler wäre im Admin ein Widerspruch.
        degradedReason: result === 'degraded' ? cleanReason(run.degradedReason, options) : null,
        fatalError: result === 'fatal' ? cleanReason(run.fatalError, options) : null,
        feeds: normalizeCounters(run.feeds),
        durations: normalizeDurations(run.durations),
    };
}

/**
 * Normalisiert einen **gelesenen** Historieneintrag.
 *
 * Dieselben Regeln wie beim Schreiben, **zuzüglich** einer strikten Prüfung der
 * gespeicherten Schema-Version: nur `FEED_RUN_HISTORY_SCHEMA_VERSION` wird
 * angenommen.
 *
 * Das ist der eigentliche Zweck der Versionsangabe. Ohne diese Prüfung würde
 * ein Eintrag aus einem anderen Schema stillschweigend als aktueller gelesen –
 * fehlende Felder erschienen dann als `0`, `null` oder „unbekannt“, ohne dass
 * irgendwo sichtbar wäre, dass hier ein fremdes Format geraten wurde. Eine
 * fehlende, ältere oder zukünftige Version ist deshalb ein **einzelner**
 * ungültiger Eintrag und wird übersprungen, nicht umgedeutet.
 *
 * @returns {object|null}
 */
export function normalizeRunHistoryEntry(raw, options = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    // Strikt auf Gleichheit, nicht auf „mindestens“: ein zukünftiges Schema
    // kennt diese Fassung genauso wenig wie ein vergangenes.
    if (raw.schemaVersion !== FEED_RUN_HISTORY_SCHEMA_VERSION) return null;

    return buildRunHistoryEntry(raw, options);
}

/**
 * Normalisiert eine gelesene Historie und sortiert sie neueste zuerst.
 *
 * Beschädigte Elemente fallen isoliert heraus; ein einzelner unlesbarer Eintrag
 * darf die restliche Historie nicht mitnehmen.
 *
 * @param {unknown} rawEntries
 * @param {{ limit?: number, redact?: (message: string) => string, secrets?: unknown[] }} [options]
 * @returns {object[]}
 */
export function normalizeRunHistory(rawEntries, { limit = FEED_RUN_HISTORY_LIMIT, ...options } = {}) {
    if (!Array.isArray(rawEntries)) return [];

    const entries = [];
    for (const raw of rawEntries) {
        const entry = normalizeRunHistoryEntry(raw, options);
        if (entry !== null) entries.push(entry);
    }

    // Auch wenn der Speicher bereits absteigend liefert: die Reihenfolge ist
    // Teil der Zusage an die Oberfläche und wird deshalb hier hergestellt und
    // nicht vorausgesetzt.
    entries.sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));

    return Number.isInteger(limit) && limit >= 0 ? entries.slice(0, limit) : entries;
}

/**
 * Zählt die Ergebnisse der **sichtbaren** Einträge.
 *
 * Ausdrücklich eine Aussage über die vorliegende Historie, nicht über alle je
 * gelaufenen Versuche: ein nie gestarteter Workflow taucht hier gar nicht auf.
 *
 * @param {object[]} entries
 */
export function summarizeRunHistory(entries) {
    const summary = { total: 0, success: 0, degraded: 0, fatal: 0 };
    if (!Array.isArray(entries)) return summary;

    for (const entry of entries) {
        if (!FEED_RUN_HISTORY_RESULTS.includes(entry?.result)) continue;
        summary.total += 1;
        summary[entry.result] += 1;
    }
    return summary;
}

/**
 * Sortierschlüssel eines Eintrags.
 *
 * `finishedAt` in Millisekunden – dieselbe Zahl, die der Speicheradapter als
 * Score verwendet.
 *
 * @returns {number|null}
 */
export function runHistoryScore(entry) {
    const time = Date.parse(entry?.finishedAt ?? '');
    return Number.isFinite(time) ? time : null;
}

/**
 * Bereinigt einen Grund für die Historie.
 *
 * Erst die aufrufereigene Redaktion (sie kennt die konfigurierten Secrets),
 * danach die gemeinsame Regel aus `shared/feed-health-model.js`: URI-
 * Zugangsdaten und Querystrings verschwinden, und der Text bleibt auf 300
 * Zeichen begrenzt.
 */
function cleanReason(value, { redact, secrets = [] } = {}) {
    if (value === null || value === undefined) return null;

    const text = typeof value === 'string' ? value : String(value);
    const redacted = typeof redact === 'function' ? redact(text) : text;

    return sanitizeErrorMessage(redacted, { secrets });
}
