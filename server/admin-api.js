// Antwort- und Rumpfhilfen der Admin-APIs (Roadmap-Paket S2).
//
// Bewusst ohne `node:`-Importe, damit sie in der Edge-Runtime laufen.

import {
    ADMIN_CACHE_CONTROL,
    API_ERROR_CODES,
    INTERNAL_ERROR_MESSAGE,
} from '../shared/api-errors.js';

const JSON_CONTENT_TYPE = 'application/json';

/** Erfolgsantwort eines geschuetzten Endpunkts. */
export function adminJsonResponse(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': JSON_CONTENT_TYPE,
            'Cache-Control': ADMIN_CACHE_CONTROL,
            ...headers,
        },
    });
}

/**
 * Antwort ohne Rumpf – auch sie darf nicht zwischengespeichert werden.
 *
 * Ein gecachtes 204 auf einen DELETE-Endpunkt waere zwar folgenlos, aber die
 * Regel gilt ausnahmslos: kein geschuetzter Endpunkt liefert etwas
 * Cachebares.
 */
export function adminEmptyResponse(status = 204, headers = {}) {
    return new Response(null, {
        status,
        headers: {
            'Cache-Control': ADMIN_CACHE_CONTROL,
            ...headers,
        },
    });
}

/**
 * Fehlerantwort mit stabilem Code.
 *
 * @param {number} status
 * @param {string} code aus API_ERROR_CODES
 * @param {string} message fuer Menschen; niemals ein interner Fehlertext
 * @param {{ field?: string, headers?: Record<string, string> }} [options]
 */
export function adminErrorResponse(status, code, message, { field, headers } = {}) {
    const body = { error: message, code };
    // Die Vertragsprüfungen liefern `field: null`, wenn der Fehler kein
    // einzelnes Feld betrifft. Dann bleibt der Schlüssel ganz weg, statt als
    // null im Vertrag zu stehen.
    if (field !== undefined && field !== null) {
        body.field = field;
    }
    return adminJsonResponse(body, status, headers);
}

/** 500 ohne jede interne Einzelheit. */
export function internalErrorResponse() {
    return adminErrorResponse(500, API_ERROR_CODES.INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE);
}

export function methodNotAllowedResponse(method, allow) {
    return adminErrorResponse(
        405,
        API_ERROR_CODES.METHOD_NOT_ALLOWED,
        `Die Methode ${method} ist auf diesem Endpunkt nicht erlaubt.`,
        { headers: { Allow: allow } },
    );
}

/**
 * Liest den Rumpf als JSON-Objekt.
 *
 * Unterschieden wird bewusst zwischen „gar kein JSON“ und „JSON, aber kein
 * Objekt“: der Client kann daran erkennen, ob sein Serialisierer oder sein
 * Datenmodell falsch liegt.
 *
 * @returns {Promise<{ value: object, error: null } | { value: null, error: Response }>}
 */
export async function readAdminJsonObject(request) {
    let parsed;
    try {
        parsed = await request.json();
    } catch {
        return {
            value: null,
            error: adminErrorResponse(
                400,
                API_ERROR_CODES.INVALID_JSON,
                'Der Anfragetext ist kein gültiges JSON.',
            ),
        };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {
            value: null,
            error: adminErrorResponse(
                400,
                API_ERROR_CODES.INVALID_PAYLOAD,
                'Es wurde kein JSON-Objekt übermittelt.',
            ),
        };
    }

    return { value: parsed, error: null };
}

/**
 * Wandelt ein Ergebnis der Vertragsprüfung in eine 400-Antwort.
 *
 * @param {{ error: string|null, field?: string|null }} result
 */
export function validationErrorResponse({ error, field }) {
    return adminErrorResponse(
        400,
        API_ERROR_CODES.VALIDATION_FAILED,
        error ?? 'Die übermittelten Daten sind ungültig.',
        { field },
    );
}
