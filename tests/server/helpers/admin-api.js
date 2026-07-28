// Gemeinsame Testhilfen für die Admin-APIs.
//
// Weder SQL noch KV noch die Uhr sind hier echt: alle Handler bekommen ihre
// Abhängigkeiten injiziert, damit kein Test eine Datenbank oder einen
// KV-Speicher berührt.

export const ADMIN_ENV = Object.freeze({
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'sehr:sicher',
});

export const ORIGIN = 'https://gamerfeed.example';

export function basicAuthHeader(
    username = ADMIN_ENV.ADMIN_USERNAME,
    password = ADMIN_ENV.ADMIN_PASSWORD,
) {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
    return `Basic ${btoa(binary)}`;
}

/**
 * Baut eine Anfrage an einen Admin-Endpunkt.
 *
 * `authenticated: false` lässt den Authorization-Header weg, `origin: null`
 * den Origin-Header – so lassen sich beide Schutzgrenzen einzeln prüfen.
 * `rawBody` umgeht `JSON.stringify` und erlaubt bewusst kaputtes JSON.
 */
export function adminRequest(path, {
    method = 'GET',
    body,
    rawBody,
    authenticated = true,
    authorization,
    origin = ORIGIN,
} = {}) {
    const headers = new Headers();

    if (authorization !== undefined) {
        headers.set('authorization', authorization);
    } else if (authenticated) {
        headers.set('authorization', basicAuthHeader());
    }

    if (origin !== null) {
        headers.set('origin', origin);
    }

    const init = { method, headers };
    if (rawBody !== undefined) {
        headers.set('content-type', 'application/json');
        init.body = rawBody;
    } else if (body !== undefined) {
        headers.set('content-type', 'application/json');
        init.body = JSON.stringify(body);
    }

    return new Request(`${ORIGIN}${path}`, init);
}

/**
 * Tagged-Template-Attrappe im Stil von `@vercel/postgres`.
 *
 * `responses` wird der Reihe nach abgearbeitet; ein `Error` darin wird
 * geworfen. Die abgesetzten Abfragen landen in `calls`.
 */
export function createSqlStub(responses = []) {
    const pending = [...responses];
    const calls = [];

    async function sql(strings, ...values) {
        const text = strings.join('?').replace(/\s+/g, ' ').trim();
        calls.push({ text, values });

        const next = pending.shift();
        if (next instanceof Error) {
            throw next;
        }
        return next ?? { rows: [] };
    }

    return { sql, calls };
}

/** KV-Attrappe mit get/set/del und protokollierten Zugriffen. */
export function createKvStub({ values = {}, error = null } = {}) {
    const store = { ...values };
    const calls = [];

    return {
        store,
        calls,
        kv: {
            async get(key) {
                calls.push({ operation: 'get', key });
                if (error) throw error;
                return Object.hasOwn(store, key) ? store[key] : null;
            },
            async set(key, value) {
                calls.push({ operation: 'set', key, value });
                if (error) throw error;
                store[key] = value;
                return 'OK';
            },
            async del(key) {
                calls.push({ operation: 'del', key });
                if (error) throw error;
                delete store[key];
                return 1;
            },
        },
    };
}

export function createLoggerStub() {
    const errors = [];
    return { errors, logger: { error: (...args) => errors.push(args) } };
}

/** Feste Uhr, damit generierte IDs und Zeitstempel vergleichbar bleiben. */
export function fixedClock(iso = '2026-07-28T12:00:00.000Z') {
    const date = new Date(iso);
    return () => new Date(date);
}

export async function readJson(response) {
    const text = await response.text();
    return text === '' ? null : JSON.parse(text);
}
