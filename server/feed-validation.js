// Eingangsprüfung für die Feed-Verwaltung. Läuft in der Edge-Runtime, deshalb
// nur syntaktische Prüfungen über shared/url-policy.js - die Auflösung der
// Zieladressen passiert im Node-Cron über scripts/outbound-policy.js.

import { parseAllowedUrl, UrlPolicyError } from '../shared/url-policy.js';

export const FEED_LANGUAGES = Object.freeze(['de', 'en']);
export const FEED_PRIORITIES = Object.freeze(['primary', 'secondary']);
export const FEED_NAME_MAX_LENGTH = 120;

/**
 * Prüft die vom Admin gesendeten Feed-Felder.
 *
 * @param {unknown} payload
 * @returns {{ error: string | null }} `error` ist null, wenn alles passt.
 */
export function validateFeedPayload(payload) {
    if (typeof payload !== 'object' || payload === null) {
        return { error: 'Es wurden keine Feed-Daten übermittelt.' };
    }

    const { language, name, priority, url } = payload;

    if (typeof name !== 'string' || name.trim() === '') {
        return { error: 'Der Name des Feeds fehlt.' };
    }

    if (name.length > FEED_NAME_MAX_LENGTH) {
        return { error: `Der Name darf höchstens ${FEED_NAME_MAX_LENGTH} Zeichen lang sein.` };
    }

    try {
        parseAllowedUrl(url);
    } catch (error) {
        const reason = error instanceof UrlPolicyError
            ? error.message
            : 'Die Feed-Adresse ist ungültig.';
        return { error: `Die Feed-Adresse wurde abgelehnt: ${reason}` };
    }

    if (!FEED_LANGUAGES.includes(language)) {
        return { error: `Die Sprache muss ${FEED_LANGUAGES.join(' oder ')} sein.` };
    }

    if (!FEED_PRIORITIES.includes(priority)) {
        return { error: `Die Priorität muss ${FEED_PRIORITIES.join(' oder ')} sein.` };
    }

    return { error: null };
}
