// Syntaktische URL-Policy, gemeinsam genutzt von Edge-Functions und
// Node-Skripten. Bewusst ohne node:-Importe, damit sie in der Edge-Runtime
// laeuft. Alles, was DNS oder Netzwerk braucht, steht in
// scripts/outbound-policy.js.

import { isBlockedIpLiteral } from './ip-ranges.js';

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

/**
 * Erkennt Hostnamen, die ohne Namensaufloesung als gesperrt erkennbar sind.
 *
 * Fuer IP-Literale gilt exakt dieselbe Bereichsliste wie im Cron - siehe
 * shared/ip-ranges.js. Namen koennen ohne DNS nicht beurteilt werden; die
 * einzige Ausnahme ist "localhost", das per Konvention lokal aufloest.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export function isObviouslyPrivateHostname(hostname) {
    if (typeof hostname !== 'string' || hostname === '') return false;

    const host = hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) return true;

    // IPv6-Literale stehen in der URL in eckigen Klammern.
    const literal = host.startsWith('[') && host.endsWith(']')
        ? host.slice(1, -1)
        : host;

    return isBlockedIpLiteral(literal);
}

/**
 * Normalisiert eine aus Feed-Inhalten stammende Artikel- oder Bild-URL.
 *
 * Dieselbe Funktion gilt fuer den Feed-Ingest, das OG-Scraping, die Links in
 * der SPA und das statische HTML unter /gaming-news - damit die Regel an allen
 * Ausgabestellen dieselbe ist und nicht doppelt gepflegt werden muss.
 *
 * Relative Angaben werden nur aufgeloest, wenn eine Basis uebergeben wird.
 *
 * @param {unknown} rawUrl
 * @param {{ base?: string | URL }} [options]
 * @returns {string | null} Absolute URL oder null, wenn sie abzulehnen ist.
 */
export function normalizeContentUrl(rawUrl, { base } = {}) {
    const url = toAllowedUrl(rawUrl, { base });
    return url === null ? null : url.href;
}
