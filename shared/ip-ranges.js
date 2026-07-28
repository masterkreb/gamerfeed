// Einzige Quelle fuer die gesperrten IP-Bereiche.
//
// Zwei Verbraucher greifen darauf zu:
//   - scripts/outbound-policy.js baut daraus eine net.BlockList (nur Node)
//   - shared/url-policy.js prueft damit IP-Literale ohne node:-Importe (Edge)
//
// Beide muessen dieselbe Liste verwenden, sonst akzeptiert die Feed-Verwaltung
// Adressen, die der Cron anschliessend garantiert ablehnt. Ein Kreuztest in
// tests/feeds/unit/outbound-policy.test.js haelt beide Umsetzungen deckungsgleich.

export const BLOCKED_IP_RANGES = Object.freeze([
    // IPv4
    { address: '0.0.0.0', family: 4, note: '"this network"', prefix: 8 },
    { address: '10.0.0.0', family: 4, note: 'privat', prefix: 8 },
    { address: '100.64.0.0', family: 4, note: 'Carrier-Grade NAT', prefix: 10 },
    { address: '127.0.0.0', family: 4, note: 'Loopback', prefix: 8 },
    { address: '169.254.0.0', family: 4, note: 'Link-local, inkl. Cloud-Metadaten', prefix: 16 },
    { address: '172.16.0.0', family: 4, note: 'privat', prefix: 12 },
    { address: '192.0.0.0', family: 4, note: 'IETF-Zuweisungen', prefix: 24 },
    { address: '192.0.2.0', family: 4, note: 'TEST-NET-1', prefix: 24 },
    { address: '192.88.99.0', family: 4, note: '6to4-Relay-Anycast', prefix: 24 },
    { address: '192.168.0.0', family: 4, note: 'privat', prefix: 16 },
    { address: '198.18.0.0', family: 4, note: 'Benchmarking', prefix: 15 },
    { address: '198.51.100.0', family: 4, note: 'TEST-NET-2', prefix: 24 },
    { address: '203.0.113.0', family: 4, note: 'TEST-NET-3', prefix: 24 },
    { address: '224.0.0.0', family: 4, note: 'Multicast', prefix: 4 },
    { address: '240.0.0.0', family: 4, note: 'reserviert, inkl. 255.255.255.255', prefix: 4 },

    // IPv6
    { address: '::', family: 6, note: 'unspezifiziert', prefix: 128 },
    { address: '::1', family: 6, note: 'Loopback', prefix: 128 },
    { address: '100::', family: 6, note: 'Discard-Only', prefix: 64 },
    { address: '64:ff9b::', family: 6, note: 'NAT64', prefix: 96 },
    { address: '2001:db8::', family: 6, note: 'Dokumentation', prefix: 32 },
    { address: '2002::', family: 6, note: '6to4', prefix: 16 },
    { address: 'fc00::', family: 6, note: 'Unique Local', prefix: 7 },
    { address: 'fe80::', family: 6, note: 'Link-local', prefix: 10 },
    { address: 'ff00::', family: 6, note: 'Multicast', prefix: 8 },
]);

const IPV4_LITERAL = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * @param {string} address
 * @returns {number[] | null} vier Bytes oder null
 */
function parseIpv4(address) {
    if (!IPV4_LITERAL.test(address)) return null;

    const parts = address.split('.').map(Number);
    return parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
        ? parts
        : null;
}

/**
 * @param {string} address
 * @returns {number[] | null} sechzehn Bytes oder null
 */
function parseIpv6(address) {
    // Zone-Index (fe80::1%eth0) gehoert nicht zur Adresse.
    let value = address.split('%')[0].toLowerCase();
    if (!value.includes(':')) return null;

    // Eingebettete IPv4-Schreibweise (::ffff:127.0.0.1) in Hex-Gruppen umschreiben.
    const lastColon = value.lastIndexOf(':');
    const tail = value.slice(lastColon + 1);
    if (tail.includes('.')) {
        const ipv4 = parseIpv4(tail);
        if (ipv4 === null) return null;
        const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
        const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
        value = `${value.slice(0, lastColon + 1)}${high}:${low}`;
    }

    const halves = value.split('::');
    if (halves.length > 2) return null;

    const toGroups = part => (part === '' ? [] : part.split(':'));
    const head = toGroups(halves[0]);
    const rest = halves.length === 2 ? toGroups(halves[1]) : [];

    const missing = 8 - head.length - rest.length;
    if (halves.length === 2) {
        if (missing < 0) return null;
    } else if (missing !== 0) {
        return null;
    }

    const groups = [...head, ...Array.from({ length: Math.max(missing, 0) }, () => '0'), ...rest];
    if (groups.length !== 8) return null;

    const bytes = [];
    for (const group of groups) {
        if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
        const parsed = Number.parseInt(group, 16);
        bytes.push(parsed >> 8, parsed & 0xff);
    }
    return bytes;
}

function matchesPrefix(addressBytes, rangeBytes, prefix) {
    const fullBytes = prefix >> 3;
    for (let index = 0; index < fullBytes; index++) {
        if (addressBytes[index] !== rangeBytes[index]) return false;
    }

    const remainingBits = prefix & 7;
    if (remainingBits === 0) return true;

    const mask = (0xff << (8 - remainingBits)) & 0xff;
    return (addressBytes[fullBytes] & mask) === (rangeBytes[fullBytes] & mask);
}

/**
 * Prueft ein IP-Literal gegen die gesperrten Bereiche - ohne node:-Importe,
 * damit die Edge-Runtime dieselbe Entscheidung treffen kann wie der Cron.
 *
 * @param {unknown} address
 * @returns {boolean} true, wenn gesperrt. Nicht-IP-Eingaben liefern false.
 */
export function isBlockedIpLiteral(address) {
    if (typeof address !== 'string' || address === '') return false;

    const value = address.trim();
    const ipv4 = parseIpv4(value);
    if (ipv4) {
        return BLOCKED_IP_RANGES.some(range => range.family === 4
            && matchesPrefix(ipv4, parseIpv4(range.address), range.prefix));
    }

    const ipv6 = parseIpv6(value);
    if (!ipv6) return false;

    // IPv4-mapped IPv6 (::ffff:a.b.c.d) faellt unter die IPv4-Regeln - genauso
    // wie net.BlockList es auf der Node-Seite handhabt.
    const isMapped = ipv6.slice(0, 10).every(byte => byte === 0)
        && ipv6[10] === 0xff && ipv6[11] === 0xff;
    if (isMapped && isBlockedIpLiteral(ipv6.slice(12).join('.'))) {
        return true;
    }

    return BLOCKED_IP_RANGES.some(range => range.family === 6
        && matchesPrefix(ipv6, parseIpv6(range.address), range.prefix));
}

/**
 * @param {unknown} value
 * @returns {boolean} true, wenn die Eingabe ein IP-Literal ist.
 */
export function isIpLiteral(value) {
    if (typeof value !== 'string') return false;
    return parseIpv4(value) !== null || parseIpv6(value) !== null;
}
