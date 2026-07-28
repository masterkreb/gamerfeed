// Stabile Fehlercodes der Admin-APIs (Roadmap-Paket S2).
//
// Die Codes sind Teil des Vertrags mit dem Client und aendern sich nicht mehr
// stillschweigend. Sie stehen in `shared/`, weil sowohl die Edge-Handler als
// auch das Admin-Panel gegen dieselbe Liste arbeiten. Bewusst ohne
// `node:`-Importe, damit sie in der Edge-Runtime laufen.
//
// Antwortformat aller Fehler:
//
//     { "error": "<verstaendliche Meldung>", "code": "<stabiler Code>",
//       "field": "<optionales Feld bei Validierungsfehlern>" }
//
// `error` ist fuer Menschen und darf sich aendern. `code` ist fuer Programme
// und darf das nicht.

export const API_ERROR_CODES = Object.freeze({
    /** 401 – Zugangsdaten fehlen oder stimmen nicht. */
    UNAUTHORIZED: 'unauthorized',
    /** 403 – authentifiziert, aber die Origin passt nicht (CSRF-Schutz). */
    FORBIDDEN: 'forbidden',
    /** 503 – auf dem Server sind keine Admin-Zugangsdaten konfiguriert. */
    AUTH_UNAVAILABLE: 'auth_unavailable',
    /** 405 – Methode auf diesem Endpunkt nicht vorgesehen. */
    METHOD_NOT_ALLOWED: 'method_not_allowed',
    /** 400 – der Rumpf ist ueberhaupt kein gueltiges JSON. */
    INVALID_JSON: 'invalid_json',
    /** 400 – gueltiges JSON, aber kein Objekt (Array, String, Zahl, null). */
    INVALID_PAYLOAD: 'invalid_payload',
    /** 400 – Objekt, aber ein Feld verletzt den Vertrag. */
    VALIDATION_FAILED: 'validation_failed',
    /** 404 – der angesprochene Datensatz existiert nicht. */
    NOT_FOUND: 'not_found',
    /** 500 – interner Fehler; Einzelheiten stehen ausschliesslich im Log. */
    INTERNAL_ERROR: 'internal_error',
});

/**
 * Cache-Control fuer alle geschuetzten Admin-Antworten.
 *
 * `private` verbietet geteilte Caches (CDN, Proxy), `no-store` zusaetzlich das
 * Ablegen im Browser. Gilt auch fuer Fehler, 204-Antworten und Auth-Grenzen –
 * eine 401 im CDN waere genauso schaedlich wie ein gecachter Datensatz.
 */
export const ADMIN_CACHE_CONTROL = 'private, no-store';

/**
 * Generische Meldung fuer 500er.
 *
 * Datenbank-, KV- und Providerfehler tragen Verbindungsdaten, Tabellennamen
 * und Stacktraces mit sich. Der Client bekommt deshalb nie den Originaltext.
 */
export const INTERNAL_ERROR_MESSAGE = 'Es ist ein interner Serverfehler aufgetreten.';
