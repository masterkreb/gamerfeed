// Vergleich des deployten PHP-Proxys mit der Hauptkopie (Roadmap-Paket O4d).
//
// `tools/feed-proxy.php` wird von Hand auf ein externes Hosting hochgeladen und
// nirgends automatisch abgeglichen. Bisher gab es keine Moeglichkeit zu sagen,
// ob dort noch dieselbe Datei liegt wie im Repository - eine vergessene
// Aktualisierung faellt sonst erst auf, wenn ein Feed dauerhaft ausfaellt.
//
// Dieses Modul enthaelt ausschliesslich Rechenregeln und einen einzelnen,
// eng begrenzten Abruf. Es fasst weder Feed-Anbieter noch Produktionscache,
// Datenbank oder irgendeinen KV-Schluessel an.
//
// Drei Zusagen tragen es:
//
// 1. Der Fingerprint ist **nicht geheim**: er ist der Hash einer oeffentlich im
//    Repository liegenden Datei. Die *Adresse* des Endpunkts ist dagegen ein
//    Secret und darf in keiner Meldung und keinem Protokoll auftauchen.
// 2. Zeilenenden zaehlen nicht. Ein Upload per FTP im Textmodus veraendert CRLF
//    und LF, aber keine einzige Anweisung - das ist keine Abweichung.
// 3. Jeder Ausgang ist eindeutig benannt. „Nicht erreichbar“ ist etwas anderes
//    als „andere Version“, und beides ist etwas anderes als „Antwort passt
//    nicht zum Schema“.

import { createHash } from 'node:crypto';
import { readLimitedResponseText, ResponseTooLargeError } from './limited-response.js';
import { fetchWithOutboundPolicy } from './outbound-policy.js';
import { sanitizeErrorMessage } from '../shared/feed-health-model.js';

export const PROXY_FINGERPRINT_SCHEMA_VERSION = 1;

/** Kennung des Dienstes; verhindert, dass eine fremde JSON-Antwort durchgeht. */
export const PROXY_FINGERPRINT_SERVICE = 'gamerfeed-feed-proxy';

export const PROXY_FINGERPRINT_ALGORITHM = 'sha256';

/**
 * Frist des Abrufs.
 *
 * Der Endpunkt liest eine lokale Datei und hasht sie; das dauert Millisekunden.
 * Zehn Sekunden lassen einem langsamen Shared-Hosting Luft, ohne dass ein
 * haengender Server den Pruefauftrag minutenlang offen haelt.
 */
export const PROXY_FINGERPRINT_TIMEOUT_MS = 10_000;

/**
 * Byte-Limit der Antwort.
 *
 * Die erwartete Antwort ist gut 150 Byte gross. 4 KiB lassen Spielraum fuer
 * zusaetzliche Felder einer spaeteren Schema-Version und schneiden trotzdem
 * jede Fehlerseite ab, bevor sie Speicher kostet.
 */
export const PROXY_FINGERPRINT_MAX_BYTES = 4096;

/** Genau 64 Hexziffern in Kleinschreibung. */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Eindeutige Ausgaenge der Pruefung.
 *
 * Bewusst getrennt: ein nicht erreichbarer Endpunkt ist betrieblich etwas ganz
 * anderes als eine tatsaechlich abweichende Datei. Wer beides als „Fehler“
 * meldet, laedt nach dem dritten Timeout niemanden mehr zum Hinsehen ein.
 */
export const PROXY_FINGERPRINT_OUTCOMES = Object.freeze([
    'ok',
    'missing_configuration',
    'unreadable_source',
    'request_failed',
    'http_error',
    'response_too_large',
    'invalid_json',
    'invalid_schema',
    'mismatch',
]);

/**
 * Vereinheitlicht die Zeilenenden vor dem Hash.
 *
 * CRLF und ein einzelnes CR werden zu LF. Ohne diesen Schritt meldete jeder
 * Upload, der die Zeilenenden anfasst, eine Abweichung - und der Fingerprint
 * verlöre genau die Aussagekraft, für die es ihn gibt.
 *
 * @param {unknown} source
 * @returns {string}
 */
export function canonicalizeProxySource(source) {
    const text = typeof source === 'string' ? source : String(source ?? '');
    return text.replace(/\r\n|\r/g, '\n');
}

/**
 * Fingerprint des Proxy-Quelltexts.
 *
 * @param {unknown} source vollstaendiger Inhalt von tools/feed-proxy.php
 * @returns {string} 64 Hexziffern
 */
export function computeProxyFingerprint(source) {
    return createHash(PROXY_FINGERPRINT_ALGORITHM)
        .update(canonicalizeProxySource(source), 'utf8')
        .digest('hex');
}

/**
 * Baut die Adresse des Fingerprint-Modus.
 *
 * Vorhandene Queryparameter bleiben erhalten - die konfigurierte Adresse kann
 * welche tragen, und sie wegzuwerfen wuerde den Endpunkt womoeglich unerreichbar
 * machen. Ein `url`-Parameter wird dagegen ausdruecklich entfernt: der
 * Fingerprint-Modus holt keinen Feed, und ein mitgeschleppter Rest duerfte
 * niemals als Abrufauftrag missverstanden werden.
 *
 * @param {string} feedProxyUrl
 * @returns {string}
 */
export function buildFingerprintRequestUrl(feedProxyUrl) {
    const requestUrl = new URL(feedProxyUrl);
    requestUrl.hash = '';
    requestUrl.searchParams.delete('url');
    requestUrl.searchParams.set('mode', 'fingerprint');
    return requestUrl.href;
}

/**
 * Prueft eine gelesene Antwort streng gegen das Schema.
 *
 * Ein fremder Endpunkt, eine Fehlerseite oder eine spaetere Schema-Version
 * ergeben `null`. Aus einer Antwort, die nicht nachweislich von diesem Dienst
 * und aus dieser Schema-Fassung stammt, darf keine Aussage über die deployte
 * Datei abgeleitet werden.
 *
 * @param {unknown} raw
 * @returns {{ schemaVersion: number, service: string, algorithm: string, fingerprint: string }|null}
 */
export function normalizeFingerprintPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (raw.schemaVersion !== PROXY_FINGERPRINT_SCHEMA_VERSION) return null;
    if (raw.service !== PROXY_FINGERPRINT_SERVICE) return null;
    if (raw.algorithm !== PROXY_FINGERPRINT_ALGORITHM) return null;
    if (typeof raw.fingerprint !== 'string' || !SHA256_HEX_PATTERN.test(raw.fingerprint)) return null;

    return {
        schemaVersion: raw.schemaVersion,
        service: raw.service,
        algorithm: raw.algorithm,
        fingerprint: raw.fingerprint,
    };
}

/**
 * Entfernt die Proxy-Adresse und jeden Querystring aus einer Meldung.
 *
 * Die Adresse ist ein GitHub-Secret. Fehlertexte von `fetch`, von der
 * Outbound-Policy und von `URL` tragen sie regelmaessig im Klartext mit sich;
 * dieselbe Bereinigung wie im Cron-Lauf faengt das ab.
 *
 * @param {unknown} message
 * @param {string|null} feedProxyUrl
 * @returns {string}
 */
export function redactProxyMessage(message, feedProxyUrl = null) {
    // Reihenfolge ist hier entscheidend.
    //
    // Zuerst die gemeinsame Regel aus dem Heartbeat: solange die Adressen im
    // Text noch wie Adressen aussehen, entfernt sie Zugangsdaten und
    // Querystrings zuverlaessig. Wuerde man den Host vorher durch `[redacted]`
    // ersetzen, verlöre eine *andere* Adresse auf demselben Host ihr Schema -
    // und ihr Querystring bliebe anschliessend unberuehrt stehen.
    const generic = sanitizeErrorMessage(message) ?? '';
    if (generic === '') return '';

    // Danach die konfigurierte Adresse selbst, laengste Schreibweise zuerst,
    // damit `origin + Pfad` nicht durch den blossen Host zerteilt wird.
    let text = generic;
    for (const variant of collectProxyUrlVariants(feedProxyUrl)) {
        text = text.split(variant).join('[redacted]');
    }

    return text;
}

/**
 * Sammelt die Schreibweisen, unter denen die Proxy-Adresse auftauchen kann.
 *
 * Fehlermeldungen nennen mal die vollstaendige Adresse, mal nur den Host, mal
 * Schema und Pfad ohne Query. Sehr kurze Bruchstuecke bleiben aussen vor, sonst
 * faerbt man halbe Saetze ein.
 *
 * @param {unknown} feedProxyUrl
 * @returns {string[]} absteigend nach Laenge
 */
function collectProxyUrlVariants(feedProxyUrl) {
    if (typeof feedProxyUrl !== 'string' || feedProxyUrl.trim() === '') return [];

    const trimmed = feedProxyUrl.trim();
    const variants = new Set([feedProxyUrl, trimmed]);

    try {
        const parsed = new URL(trimmed);
        variants.add(`${parsed.origin}${parsed.pathname}`);
        variants.add(parsed.origin);
        variants.add(parsed.host);
        variants.add(parsed.hostname);
    } catch {
        // Eine unbrauchbare Adresse hat keine zerlegbaren Bestandteile; der
        // Rohwert oben bleibt trotzdem geschuetzt.
    }

    return [...variants]
        .filter(variant => variant.length >= 8)
        .sort((a, b) => b.length - a.length);
}

function describe(outcome, message, extra = {}) {
    return { ok: outcome === 'ok', outcome, message, expected: null, actual: null, ...extra };
}

/**
 * Vergleicht den erwarteten Fingerprint mit dem des deployten Endpunkts.
 *
 * Wirft nicht: jeder Ausgang wird als benanntes Ergebnis zurueckgegeben, damit
 * der Aufrufer ihn ohne eigene Fehlerbehandlung protokollieren kann. Keine
 * Meldung enthaelt die Proxy-Adresse.
 *
 * @param {{
 *   feedProxyUrl?: unknown,
 *   expectedFingerprint: string,
 *   fetchImpl?: Function,
 *   lookup?: Function,
 *   timeoutMs?: number,
 *   maxBytes?: number,
 *   createSignal?: (ms: number) => AbortSignal,
 * }} options
 */
export async function checkProxyFingerprint({
    feedProxyUrl,
    expectedFingerprint,
    fetchImpl,
    lookup,
    timeoutMs = PROXY_FINGERPRINT_TIMEOUT_MS,
    maxBytes = PROXY_FINGERPRINT_MAX_BYTES,
    createSignal = ms => AbortSignal.timeout(ms),
} = {}) {
    const configuredUrl = typeof feedProxyUrl === 'string' ? feedProxyUrl.trim() : '';
    const redact = message => redactProxyMessage(message, configuredUrl || null);

    if (configuredUrl === '') {
        return describe(
            'missing_configuration',
            'FEED_PROXY_URL ist nicht gesetzt; ohne Adresse ist kein Vergleich möglich.',
        );
    }

    if (!SHA256_HEX_PATTERN.test(String(expectedFingerprint ?? ''))) {
        return describe(
            'unreadable_source',
            'Der erwartete Fingerprint konnte nicht aus tools/feed-proxy.php berechnet werden.',
        );
    }

    let requestUrl;
    try {
        requestUrl = buildFingerprintRequestUrl(configuredUrl);
    } catch (error) {
        return describe(
            'missing_configuration',
            `FEED_PROXY_URL ist keine gültige Adresse: ${redact(error)}`,
        );
    }

    let response;
    try {
        response = await fetchWithOutboundPolicy(requestUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: createSignal(timeoutMs),
            fetchImpl,
            ...(lookup ? { lookup } : {}),
        });
    } catch (error) {
        return describe('request_failed', `Der Fingerprint-Endpunkt war nicht erreichbar: ${redact(error)}`);
    }

    if (!response.ok) {
        // Bewusst nur der Status: der Antworttext eines fremden Servers gehoert
        // nicht ungeprueft ins Protokoll.
        await response.body?.cancel?.().catch(() => {});
        return describe('http_error', `Der Fingerprint-Endpunkt antwortete mit HTTP ${response.status}.`);
    }

    let text;
    try {
        text = await readLimitedResponseText(response, maxBytes);
    } catch (error) {
        if (error instanceof ResponseTooLargeError) {
            return describe(
                'response_too_large',
                `Die Antwort überschreitet das Limit von ${maxBytes} Byte und wurde verworfen.`,
            );
        }
        return describe('request_failed', `Die Antwort war nicht lesbar: ${redact(error)}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        // Ohne den Text: eine HTML-Fehlerseite des Hostings kann alles Moegliche
        // enthalten, auch die Adresse selbst.
        return describe('invalid_json', 'Die Antwort ist kein gültiges JSON.');
    }

    const payload = normalizeFingerprintPayload(parsed);
    if (payload === null) {
        return describe(
            'invalid_schema',
            'Die Antwort entspricht nicht dem erwarteten Fingerprint-Schema '
            + `(schemaVersion ${PROXY_FINGERPRINT_SCHEMA_VERSION}, service ${PROXY_FINGERPRINT_SERVICE}).`,
        );
    }

    if (payload.fingerprint !== expectedFingerprint) {
        return describe(
            'mismatch',
            'Der deployte Proxy weicht von tools/feed-proxy.php ab; die Datei muss erneut hochgeladen werden.',
            { expected: expectedFingerprint, actual: payload.fingerprint },
        );
    }

    return describe(
        'ok',
        'Der deployte Proxy entspricht tools/feed-proxy.php.',
        { expected: expectedFingerprint, actual: payload.fingerprint },
    );
}
