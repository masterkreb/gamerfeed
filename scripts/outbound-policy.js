// Outbound-Policy fuer serverseitige Abrufe (Feed-Cron, Bild-Scraping).
//
// Ziel ist, dass ein vom Admin eingetragener oder aus einem Feed stammender
// Link keine Anfrage in interne Netze ausloest - weder direkt noch ueber DNS
// noch ueber eine Weiterleitung.
//
// Der Transport ist an die geprueften Adressen gebunden: undici loest den Host
// ueber unseren eigenen Lookup auf, und genau die dort zurueckgegebene Adresse
// wird fuer die Verbindung verwendet. Damit gibt es zwischen Pruefung und
// Verbindungsaufbau kein Zeitfenster mehr, in dem ein DNS-Wechsel auf eine
// private Adresse greifen koennte.
//
// Die Vorabpruefung bleibt zusaetzlich bestehen: sie lehnt ab, bevor ueberhaupt
// eine Verbindung aufgebaut wird. Jeder Weiterleitungsschritt wird erneut
// vollstaendig geprueft. Siehe docs/deployment/outbound-policy.md.

import { BlockList, isIP } from 'node:net';
import { lookup as systemLookup } from 'node:dns/promises';
import { Agent, fetch as undiciFetch } from 'undici';
import { BLOCKED_IP_RANGES } from '../shared/ip-ranges.js';
import { parseAllowedUrl, UrlPolicyError } from '../shared/url-policy.js';

export { UrlPolicyError };

export const MAX_OUTBOUND_REDIRECTS = 5;

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export class OutboundPolicyError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'OutboundPolicyError';
        this.code = code;
    }
}

// Die Bereiche stammen aus shared/ip-ranges.js, damit Cron und Feed-Verwaltung
// nicht mit zwei auseinanderlaufenden Listen arbeiten. BlockList deckt
// IPv4-mapped IPv6 (::ffff:127.0.0.1) ueber die IPv4-Regeln mit ab.
const blockedRanges = new BlockList();

for (const range of BLOCKED_IP_RANGES) {
    const family = range.family === 4 ? 'ipv4' : 'ipv6';
    const maxPrefix = range.family === 4 ? 32 : 128;

    if (range.prefix === maxPrefix) {
        blockedRanges.addAddress(range.address, family);
    } else {
        blockedRanges.addSubnet(range.address, range.prefix, family);
    }
}

/**
 * Prueft eine einzelne IP-Adresse gegen die gesperrten Bereiche.
 * Unbekannte oder unparsbare Eingaben gelten als gesperrt (fail-closed).
 *
 * @param {unknown} address
 * @returns {boolean}
 */
export function isBlockedIpAddress(address) {
    if (typeof address !== 'string' || address === '') return true;

    // Zone-Index (fe80::1%eth0) abschneiden, isIP akzeptiert ihn nicht.
    const withoutZone = address.split('%')[0];
    const family = isIP(withoutZone);
    if (family === 0) return true;

    return blockedRanges.check(withoutZone, family === 4 ? 'ipv4' : 'ipv6');
}

function stripIpv6Brackets(hostname) {
    return hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;
}

/**
 * Prueft Schema, Zugangsdaten und alle aufgeloesten Adressen eines Ziels.
 *
 * Es reicht **eine** gesperrte Adresse in der DNS-Antwort, um das Ziel
 * abzulehnen: Ein gemischter Datensatz waere sonst ein Umgehungsweg, weil der
 * Verbindungsaufbau sich eine beliebige davon aussuchen darf.
 *
 * @param {unknown} rawUrl
 * @param {{ lookup?: Function }} [options]
 * @returns {Promise<{ url: URL, addresses: { address: string, family: number }[] }>}
 */
export async function assertOutboundTargetAllowed(rawUrl, { lookup = systemLookup } = {}) {
    const url = parseAllowedUrl(rawUrl);
    const hostname = stripIpv6Brackets(url.hostname);

    // Numerische Ziele - auch dezimal, oktal oder hexadezimal notierte - hat der
    // URL-Parser bereits normalisiert, hier steht also eine kanonische Adresse.
    const literalFamily = isIP(hostname);
    if (literalFamily !== 0) {
        if (isBlockedIpAddress(hostname)) {
            throw new OutboundPolicyError(
                `Die Adresse ${hostname} liegt in einem gesperrten Bereich.`,
                'blocked_address',
            );
        }
        return { addresses: [{ address: hostname, family: literalFamily }], url };
    }

    let records;
    try {
        records = await lookup(hostname, { all: true, verbatim: true });
    } catch {
        throw new OutboundPolicyError(`Der Host "${hostname}" ist nicht auflösbar.`, 'dns_failed');
    }

    if (!Array.isArray(records) || records.length === 0) {
        throw new OutboundPolicyError(`Der Host "${hostname}" lieferte keine Adressen.`, 'dns_empty');
    }

    const blocked = records.filter(record => isBlockedIpAddress(record?.address));
    if (blocked.length > 0) {
        throw new OutboundPolicyError(
            `Der Host "${hostname}" löst auf eine gesperrte Adresse auf (${blocked[0].address}).`,
            'blocked_address',
        );
    }

    return { addresses: records, url };
}

function isRedirectResponse(response) {
    return REDIRECT_STATUS_CODES.has(response?.status);
}

/**
 * Erzeugt einen DNS-Lookup im Node-Callback-Stil, der ausschliesslich gepruefte
 * Adressen herausgibt. undici verbindet sich genau mit dem, was hier
 * zurueckkommt - dadurch ist die Verbindung an das gepruefte Ziel gebunden.
 *
 * @param {Function} lookup
 */
export function createPinnedLookup(lookup = systemLookup) {
    return (hostname, options, callback) => {
        const done = typeof options === 'function' ? options : callback;
        const wantsAll = typeof options === 'object' && options !== null && options.all === true;

        Promise.resolve()
            .then(() => lookup(hostname, { all: true, verbatim: true }))
            .then(records => {
                if (!Array.isArray(records) || records.length === 0) {
                    throw new OutboundPolicyError(
                        `Der Host "${hostname}" lieferte keine Adressen.`,
                        'dns_empty',
                    );
                }

                const blocked = records.filter(record => isBlockedIpAddress(record?.address));
                if (blocked.length > 0) {
                    throw new OutboundPolicyError(
                        `Der Host "${hostname}" löst auf eine gesperrte Adresse auf (${blocked[0].address}).`,
                        'blocked_address',
                    );
                }

                if (wantsAll) {
                    done(null, records);
                    return;
                }
                done(null, records[0].address, records[0].family);
            })
            .catch(error => done(error));
    };
}

/**
 * Dispatcher, dessen Verbindungsaufbau nur gepruefte Adressen verwendet.
 *
 * @param {{ lookup?: Function }} [options]
 */
export function createPinnedDispatcher({ lookup = systemLookup } = {}) {
    return new Agent({ connect: { lookup: createPinnedLookup(lookup) } });
}

let defaultPinnedDispatcher = null;

function getDefaultPinnedFetch(lookup) {
    // Fuer den Regelfall genuegt ein einziger Agent mit dem System-Resolver.
    if (lookup === systemLookup) {
        defaultPinnedDispatcher ??= createPinnedDispatcher({ lookup: systemLookup });
        return (url, init) => undiciFetch(url, { ...init, dispatcher: defaultPinnedDispatcher });
    }

    const dispatcher = createPinnedDispatcher({ lookup });
    return (url, init) => undiciFetch(url, { ...init, dispatcher });
}

/**
 * Fuehrt einen Abruf durch, bei dem jedes Ziel und jeder Weiterleitungsschritt
 * einzeln gegen die Policy geprueft wird.
 *
 * Automatische Weiterleitungen sind abgeschaltet, damit kein ungeprueftes Ziel
 * kontaktiert wird. Ein abgelehntes Ziel erreicht das Netzwerk nicht: die
 * Vorabpruefung laeuft vollstaendig vor dem Verbindungsaufbau. Ohne eigenes
 * `fetchImpl` wird zusaetzlich der an die geprueften Adressen gebundene
 * Transport verwendet.
 *
 * @param {unknown} rawUrl
 * @param {{
 *   fetchImpl?: Function,
 *   lookup?: Function,
 *   maxRedirects?: number,
 * } & RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function fetchWithOutboundPolicy(rawUrl, {
    fetchImpl,
    lookup = systemLookup,
    maxRedirects = MAX_OUTBOUND_REDIRECTS,
    ...requestInit
} = {}) {
    // Ohne eigenes fetchImpl wird der gebundene Transport verwendet.
    const performFetch = fetchImpl ?? getDefaultPinnedFetch(lookup);
    const visited = new Set();
    let currentUrl = rawUrl;

    for (let hop = 0; hop <= maxRedirects; hop++) {
        const { url } = await assertOutboundTargetAllowed(currentUrl, { lookup });

        const visitKey = url.toString();
        if (visited.has(visitKey)) {
            throw new OutboundPolicyError('Die Weiterleitungen bilden eine Schleife.', 'redirect_loop');
        }
        visited.add(visitKey);

        const response = await performFetch(url, { ...requestInit, redirect: 'manual' });

        if (!isRedirectResponse(response)) {
            return response;
        }

        const location = response.headers?.get?.('location');
        await response.body?.cancel?.().catch(() => {});

        // Weiterleitung ohne Ziel ist keine Weiterleitung - unveraendert melden.
        if (!location) {
            return response;
        }

        try {
            currentUrl = new URL(location, url).toString();
        } catch {
            throw new OutboundPolicyError(
                'Das Weiterleitungsziel ist syntaktisch ungültig.',
                'invalid_redirect_target',
            );
        }
    }

    throw new OutboundPolicyError(
        `Mehr als ${maxRedirects} Weiterleitungen.`,
        'too_many_redirects',
    );
}
