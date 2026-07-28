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

// Ohne DNS erkennbare lokale und private Ziele. Bewusst nur die eindeutigen
// Faelle: die vollstaendige Adresspruefung leistet scripts/outbound-policy.js
// mit Aufloesung, was in der Edge-Runtime nicht moeglich ist.
const IPV4_LITERAL = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

const PRIVATE_IPV4_PATTERNS = [
    /^0\./,
    /^10\./,
    /^127\./,
    /^169\.254\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
];

/**
 * Erkennt Hostnamen, die ohne Namensaufloesung eindeutig lokal oder privat sind.
 *
 * Der URL-Parser hat numerische Schreibweisen bereits normalisiert, hier steht
 * also die kanonische Form.
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

    // Nur echte IPv4-Literale pruefen - sonst gaelte "10.example.com" als privat.
    if (IPV4_LITERAL.test(literal)) {
        return PRIVATE_IPV4_PATTERNS.some(pattern => pattern.test(literal));
    }

    if (!literal.includes(':')) return false;

    if (literal === '::1' || literal === '::') return true;
    // Unique Local (fc00::/7) und Link-local (fe80::/10).
    if (/^f[cd]/.test(literal) || /^fe[89ab]/.test(literal)) return true;

    // IPv4-mapped IPv6. Der URL-Parser schreibt die eingebettete Adresse
    // hexadezimal (::ffff:7f00:1), deshalb wird sie hier zurueckgerechnet.
    const mapped = /^::ffff:(.+)$/.exec(literal);
    if (mapped) {
        const tail = mapped[1];
        if (IPV4_LITERAL.test(tail)) return isObviouslyPrivateHostname(tail);

        const groups = tail.split(':');
        if (groups.length === 2 && groups.every(group => /^[0-9a-f]{1,4}$/.test(group))) {
            const [high, low] = groups.map(group => Number.parseInt(group, 16));
            const dotted = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
            return isObviouslyPrivateHostname(dotted);
        }
    }

    return false;
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
