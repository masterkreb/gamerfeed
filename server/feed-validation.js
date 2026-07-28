// Eingangsprüfung für die Feed-Verwaltung. Läuft in der Edge-Runtime, deshalb
// nur syntaktische Prüfungen über shared/url-policy.js - die Auflösung der
// Zieladressen passiert im Node-Cron über scripts/outbound-policy.js.

import { isObviouslyPrivateHostname, parseAllowedUrl, UrlPolicyError } from '../shared/url-policy.js';

export const FEED_LANGUAGES = Object.freeze(['de', 'en']);
export const FEED_PRIORITIES = Object.freeze(['primary', 'secondary']);
export const FEED_NAME_MAX_LENGTH = 120;
export const FEED_URL_MAX_LENGTH = 2048;
// Eine erzeugte ID ist "<Slug aus max. 120 Zeichen>-<13-stelliger Zeitstempel>";
// 160 lässt Luft, ohne beliebig lange Werte in die Abfrage zu lassen.
export const FEED_ID_MAX_LENGTH = 160;

function fail(error, field = null) {
    return { error, field };
}

const OK = Object.freeze({ error: null, field: null });

/**
 * @typedef {object} FeedContractValue
 * @property {string} name
 * @property {string} url
 * @property {'de'|'en'} language
 * @property {'primary'|'secondary'} priority
 * @property {boolean} needsScraping
 */

/**
 * @typedef {FeedContractValue & { id: string }} FeedUpdateContractValue
 */

/**
 * Prüft die vom Admin gesendeten Feed-Felder.
 *
 * @param {unknown} payload
 * @returns {{ error: string | null, field: string | null }} `error` ist null, wenn alles passt.
 */
export function validateFeedPayload(payload) {
    if (typeof payload !== 'object' || payload === null) {
        return fail('Es wurden keine Feed-Daten übermittelt.');
    }

    const { language, name, needsScraping, priority, url } = payload;

    if (typeof name !== 'string' || name.trim() === '') {
        return fail('Der Name des Feeds fehlt.', 'name');
    }

    if (name.length > FEED_NAME_MAX_LENGTH) {
        return fail(`Der Name darf höchstens ${FEED_NAME_MAX_LENGTH} Zeichen lang sein.`, 'name');
    }

    // Längengrenze vor dem Parsen: eine megabytelange Zeichenkette soll gar
    // nicht erst durch den URL-Parser laufen.
    if (typeof url === 'string' && url.length > FEED_URL_MAX_LENGTH) {
        return fail(
            `Die Feed-Adresse darf höchstens ${FEED_URL_MAX_LENGTH} Zeichen lang sein.`,
            'url',
        );
    }

    let parsedUrl;
    try {
        parsedUrl = parseAllowedUrl(url);
    } catch (error) {
        const reason = error instanceof UrlPolicyError
            ? error.message
            : 'Die Feed-Adresse ist ungültig.';
        return fail(`Die Feed-Adresse wurde abgelehnt: ${reason}`, 'url');
    }

    // Ohne DNS erkennbare interne Ziele werden schon beim Speichern abgewiesen.
    // Der Cron würde sie später ohnehin ablehnen, aber dann stünde bereits eine
    // unbrauchbare Konfiguration in der Datenbank.
    if (isObviouslyPrivateHostname(parsedUrl.hostname)) {
        return fail(
            `Die Feed-Adresse wurde abgelehnt: "${parsedUrl.hostname}" ist ein lokales oder privates Ziel.`,
            'url',
        );
    }

    if (!FEED_LANGUAGES.includes(language)) {
        return fail(`Die Sprache muss ${FEED_LANGUAGES.join(' oder ')} sein.`, 'language');
    }

    if (!FEED_PRIORITIES.includes(priority)) {
        return fail(`Die Priorität muss ${FEED_PRIORITIES.join(' oder ')} sein.`, 'priority');
    }

    // Nur ein wirklich fehlendes Feld bedeutet "aus". Ein gesetztes muss ein
    // Boolean sein - sonst landet ein "false"-String als true in der Datenbank
    // und der Cron scrapt Seiten, die niemand freigegeben hat. Auch ein
    // ausdrückliches null wird abgelehnt: der Absender meint damit etwas, und
    // ein stiller Default würde diese Absicht überschreiben.
    if (needsScraping !== undefined && typeof needsScraping !== 'boolean') {
        return fail('„needsScraping" muss true oder false sein.', 'needsScraping');
    }

    return OK;
}

function validateFeedId(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return fail('Die Feed-ID fehlt.', 'id');
    }

    if (value.length > FEED_ID_MAX_LENGTH) {
        return fail(`Die Feed-ID darf höchstens ${FEED_ID_MAX_LENGTH} Zeichen lang sein.`, 'id');
    }

    return OK;
}

/**
 * Normalisierte Felder eines geprüften Feeds.
 *
 * Unbekannte Zusatzfelder werden bewusst ignoriert statt abgelehnt: sonst
 * würde ein Client, der ein Feld mehr schickt, ohne Not scheitern.
 */
function normalizeFeedFields(payload) {
    return {
        name: payload.name.trim(),
        url: payload.url.trim(),
        language: payload.language,
        priority: payload.priority,
        needsScraping: payload.needsScraping === true,
    };
}

/**
 * Vertrag für „Feed erstellen".
 *
 * @param {unknown} payload
 * @returns {{ value: FeedContractValue|null, error: string|null, field: string|null }}
 */
export function parseFeedCreatePayload(payload) {
    const { error, field } = validateFeedPayload(payload);
    if (error) {
        return { value: null, error, field };
    }

    return { value: normalizeFeedFields(payload), error: null, field: null };
}

/**
 * Vertrag für „Feed aktualisieren". Verlangt zusätzlich eine gültige ID.
 *
 * @param {unknown} payload
 * @returns {{ value: FeedUpdateContractValue|null, error: string|null, field: string|null }}
 */
export function parseFeedUpdatePayload(payload) {
    if (typeof payload !== 'object' || payload === null) {
        return { value: null, error: 'Es wurden keine Feed-Daten übermittelt.', field: null };
    }

    const idCheck = validateFeedId(payload.id);
    if (idCheck.error) {
        return { value: null, ...idCheck };
    }

    const { error, field } = validateFeedPayload(payload);
    if (error) {
        return { value: null, error, field };
    }

    return {
        value: { id: payload.id.trim(), ...normalizeFeedFields(payload) },
        error: null,
        field: null,
    };
}

/**
 * Vertrag für „Feed löschen".
 *
 * @param {unknown} payload
 * @returns {{ value: { id: string }|null, error: string|null, field: string|null }}
 */
export function parseFeedDeletePayload(payload) {
    if (typeof payload !== 'object' || payload === null) {
        return { value: null, error: 'Es wurden keine Feed-Daten übermittelt.', field: null };
    }

    const idCheck = validateFeedId(payload.id);
    if (idCheck.error) {
        return { value: null, ...idCheck };
    }

    return { value: { id: payload.id.trim() }, error: null, field: null };
}
