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
 * Baut einen Historieneintrag aus einem abgeschlossenen Laufstatus.
 *
 * Gibt `null` zurück, wenn der Lauf nicht in die Historie gehört – also bei
 * `running`, bei unbekanntem Ergebnis oder bei unbrauchbaren Zeitstempeln.
 * Der Aufrufer schreibt dann schlicht nichts; ein geratener Eintrag wäre
 * schlechter als eine Lücke.
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
 * Dieselben Regeln wie beim Schreiben: was hier nicht durchkommt, ist
 * beschädigt und wird vom Leser einzeln übersprungen.
 *
 * @returns {object|null}
 */
export function normalizeRunHistoryEntry(raw, options = {}) {
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
