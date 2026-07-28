// Konfigurationspruefung des Cron-Laufs (Roadmap-Paket O2a).
//
// Getrennt wird zwischen zwei Klassen:
//
// - **Core**: ohne diese Werte kann der Lauf gar nichts Sinnvolles tun. Fehlt
//   einer, endet er kontrolliert und *bevor* die erste Verbindung aufgebaut
//   wird. Sonst laeuft das Skript minutenlang gegen Feeds, um am Ende beim
//   Speichern zu scheitern - und hinterlaesst dabei einen halben Heartbeat.
// - **Optional**: Zusatzfunktionen. Fehlt oder taugt ein Wert nicht, wird genau
//   diese Funktion uebersprungen; der Kernlauf laeuft weiter.
//
// Kein Wert wird jemals ausgegeben - weder ganz noch teilweise. Gemeldet wird
// ausschliesslich der Name der Variablen.

import { parseAllowedUrl } from '../shared/url-policy.js';

export const CORE_ENV_KEYS = Object.freeze([
    'POSTGRES_URL',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
]);

/**
 * Ein Wert gilt nur als vorhanden, wenn er ein nicht-leerer String ist.
 *
 * Leerzeichen zaehlen ausdruecklich nicht: ein versehentlich als " " gesetztes
 * GitHub-Secret ist genauso unbrauchbar wie ein fehlendes, wuerde aber jede
 * naive Truthiness-Pruefung bestehen.
 */
function hasUsableValue(value) {
    return typeof value === 'string' && value.trim() !== '';
}

/**
 * Prueft die Core-Konfiguration.
 *
 * @param {Record<string, unknown>} env
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function checkCoreConfiguration(env = {}) {
    const missing = CORE_ENV_KEYS.filter(key => !hasUsableValue(env?.[key]));
    return { ok: missing.length === 0, missing };
}

/**
 * Meldung fuer einen fehlenden Core-Wert.
 *
 * Enthaelt nur Variablennamen, nie Werte.
 *
 * @param {string[]} missing
 * @returns {string}
 */
export function describeMissingCoreConfiguration(missing) {
    return `Fehlende Pflichtkonfiguration: ${missing.join(', ')}. `
        + 'Der Lauf wurde vor dem ersten externen Zugriff beendet.';
}

/**
 * Optionaler Groq-Schluessel.
 *
 * @param {Record<string, unknown>} env
 * @returns {{ value: string|null, skipReason: string|null }}
 */
export function readOptionalGroqKey(env = {}) {
    if (!hasUsableValue(env?.GROQ_API_KEY)) {
        return { value: null, skipReason: 'GROQ_API_KEY ist nicht gesetzt' };
    }
    return { value: env.GROQ_API_KEY.trim(), skipReason: null };
}

/**
 * Optionale Proxy-Adresse.
 *
 * Die Adresse wird syntaktisch geprueft, damit eine unbrauchbare Konfiguration
 * sofort auffaellt statt erst beim ersten Fallback. Zurueckgemeldet wird nur,
 * *dass* sie unbrauchbar ist - die Adresse selbst waere ein Secret-Leak, denn
 * sie ist genau deshalb ein GitHub-Secret.
 *
 * @param {Record<string, unknown>} env
 * @returns {{ value: string|null, skipReason: string|null }}
 */
export function readOptionalProxyUrl(env = {}) {
    if (!hasUsableValue(env?.FEED_PROXY_URL)) {
        return { value: null, skipReason: 'FEED_PROXY_URL ist nicht gesetzt' };
    }

    const candidate = env.FEED_PROXY_URL.trim();
    let parsed;
    try {
        parsed = parseAllowedUrl(candidate);
    } catch {
        return { value: null, skipReason: 'FEED_PROXY_URL ist keine gültige http(s)-Adresse' };
    }

    // Der Proxy laeuft ueber HTTPS. Ein versehentliches http:// waere ein
    // stiller Downgrade auf einen unverschluesselten Umweg.
    if (parsed.protocol !== 'https:') {
        return { value: null, skipReason: 'FEED_PROXY_URL muss https verwenden' };
    }

    return { value: candidate, skipReason: null };
}

/**
 * Fasst die gesamte Laufkonfiguration zusammen.
 *
 * @param {Record<string, unknown>} env
 * @returns {{
 *   ok: boolean,
 *   missingCore: string[],
 *   fatalMessage: string|null,
 *   groqApiKey: string|null,
 *   feedProxyUrl: string|null,
 *   skipped: string[],
 * }}
 */
export function readFeedRunConfiguration(env = {}) {
    const core = checkCoreConfiguration(env);
    if (!core.ok) {
        return {
            ok: false,
            missingCore: core.missing,
            fatalMessage: describeMissingCoreConfiguration(core.missing),
            groqApiKey: null,
            feedProxyUrl: null,
            skipped: [],
        };
    }

    const groq = readOptionalGroqKey(env);
    const proxy = readOptionalProxyUrl(env);

    return {
        ok: true,
        missingCore: [],
        fatalMessage: null,
        groqApiKey: groq.value,
        feedProxyUrl: proxy.value,
        skipped: [groq.skipReason, proxy.skipReason].filter(reason => reason !== null),
    };
}
