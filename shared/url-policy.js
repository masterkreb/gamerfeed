// Syntaktische URL-Policy, gemeinsam genutzt von Edge-Functions und
// Node-Skripten. Bewusst ohne node:-Importe, damit sie in der Edge-Runtime
// laeuft. Alles, was DNS oder Netzwerk braucht, steht in
// scripts/outbound-policy.js.

export const ALLOWED_URL_PROTOCOLS = Object.freeze(['http:', 'https:']);

export class UrlPolicyError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'UrlPolicyError';
        this.code = code;
    }
}

/**
 * Parst eine URL und setzt die syntaktischen Mindestanforderungen durch.
 *
 * Abgelehnt werden andere Schemata als http/https (also auch `javascript:`,
 * `data:` und `file:`), eingebettete Zugangsdaten und URLs ohne Host.
 *
 * @param {unknown} rawUrl
 * @param {{ base?: string | URL }} [options] `base` loest relative URLs auf.
 * @returns {URL}
 */
export function parseAllowedUrl(rawUrl, { base } = {}) {
    if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
        throw new UrlPolicyError('Es wurde keine URL angegeben.', 'missing_url');
    }

    let url;
    try {
        url = base === undefined ? new URL(rawUrl) : new URL(rawUrl, base);
    } catch {
        throw new UrlPolicyError('Die URL ist syntaktisch ungültig.', 'invalid_syntax');
    }

    if (!ALLOWED_URL_PROTOCOLS.includes(url.protocol)) {
        throw new UrlPolicyError(
            `Nur http und https sind erlaubt, nicht "${url.protocol}".`,
            'protocol_not_allowed',
        );
    }

    // Zugangsdaten in der URL werden von manchen Parsern anders interpretiert
    // als vom Ziel-Server und sind ein bekannter Umgehungsweg.
    if (url.username !== '' || url.password !== '') {
        throw new UrlPolicyError('URLs mit Zugangsdaten sind nicht erlaubt.', 'credentials_not_allowed');
    }

    if (url.hostname === '') {
        throw new UrlPolicyError('Die URL enthält keinen Host.', 'missing_host');
    }

    return url;
}

/**
 * Wie parseAllowedUrl, liefert aber null statt zu werfen.
 *
 * @param {unknown} rawUrl
 * @param {{ base?: string | URL }} [options]
 * @returns {URL | null}
 */
export function toAllowedUrl(rawUrl, options) {
    try {
        return parseAllowedUrl(rawUrl, options);
    } catch {
        return null;
    }
}

/**
 * @param {unknown} rawUrl
 * @param {{ base?: string | URL }} [options]
 * @returns {boolean}
 */
export function isAllowedUrl(rawUrl, options) {
    return toAllowedUrl(rawUrl, options) !== null;
}
