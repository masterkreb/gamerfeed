import { ADMIN_CACHE_CONTROL, API_ERROR_CODES } from '../shared/api-errors.js';

const ADMIN_REALM = 'GamerFeed Admin';

function noStoreResponse(body, status, headers = {}) {
    return new Response(body, {
        status,
        headers: {
            'Cache-Control': ADMIN_CACHE_CONTROL,
            ...headers,
        },
    });
}

function jsonNoStoreResponse(code, message, status, headers = {}) {
    return noStoreResponse(JSON.stringify({ error: message, code }), status, {
        'Content-Type': 'application/json',
        ...headers,
    });
}

function safeEqual(actual, expected) {
    const encoder = new TextEncoder();
    const actualBytes = encoder.encode(actual);
    const expectedBytes = encoder.encode(expected);
    const maxLength = Math.max(actualBytes.length, expectedBytes.length);
    let mismatch = actualBytes.length ^ expectedBytes.length;

    for (let index = 0; index < maxLength; index += 1) {
        mismatch |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
    }

    return mismatch === 0;
}

function parseBasicCredentials(authorization) {
    if (!authorization) {
        return null;
    }

    const match = authorization.match(/^Basic[ \t]+([A-Za-z0-9+/]+={0,2})$/i);
    if (!match) {
        return null;
    }

    try {
        const binary = atob(match[1]);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const separatorIndex = decoded.indexOf(':');

        if (separatorIndex < 0) {
            return null;
        }

        return {
            username: decoded.slice(0, separatorIndex),
            password: decoded.slice(separatorIndex + 1),
        };
    } catch {
        return null;
    }
}

/**
 * Trifft die Entscheidung, ohne sie schon in eine Antwort zu gießen.
 *
 * Die Middleware für `/admin.html` und die Admin-APIs brauchen dasselbe Urteil,
 * aber unterschiedliche Antwortformate: der Browser bekommt Text, der Client
 * JSON mit stabilem Fehlercode.
 *
 * @returns {null | { status: number, code: string, message: string, headers?: Record<string, string> }}
 */
function evaluateAdminAuth(request, env) {
    const expectedUsername = env.ADMIN_USERNAME;
    const expectedPassword = env.ADMIN_PASSWORD;

    if (!expectedUsername || !expectedPassword || expectedUsername.includes(':')) {
        return {
            status: 503,
            code: API_ERROR_CODES.AUTH_UNAVAILABLE,
            message: 'Service unavailable',
        };
    }

    const credentials = parseBasicCredentials(request.headers.get('authorization'));
    const usernameMatches = safeEqual(credentials?.username ?? '', expectedUsername);
    const passwordMatches = safeEqual(credentials?.password ?? '', expectedPassword);

    if (credentials && usernameMatches && passwordMatches) {
        return null;
    }

    return {
        status: 401,
        code: API_ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required',
        headers: { 'WWW-Authenticate': `Basic realm="${ADMIN_REALM}", charset="UTF-8"` },
    };
}

function evaluateAdminMutation(request, env) {
    const authFailure = evaluateAdminAuth(request, env);
    if (authFailure) {
        return authFailure;
    }

    let requestOrigin;
    try {
        requestOrigin = new URL(request.url).origin;
    } catch {
        return { status: 403, code: API_ERROR_CODES.FORBIDDEN, message: 'Forbidden' };
    }

    if (request.headers.get('origin') !== requestOrigin) {
        return { status: 403, code: API_ERROR_CODES.FORBIDDEN, message: 'Forbidden' };
    }

    return null;
}

/** Textantwort für die Edge-Middleware vor `/admin.html`. */
export function requireAdminAuth(request, env = process.env) {
    const failure = evaluateAdminAuth(request, env);
    return failure
        ? noStoreResponse(failure.message, failure.status, failure.headers)
        : null;
}

/** Textantwort für die Edge-Middleware vor `/admin.html`. */
export function requireAdminMutation(request, env = process.env) {
    const failure = evaluateAdminMutation(request, env);
    return failure
        ? noStoreResponse(failure.message, failure.status, failure.headers)
        : null;
}

/** JSON-Antwort mit stabilem Fehlercode für die Admin-APIs. */
export function requireAdminApiAuth(request, env = process.env) {
    const failure = evaluateAdminAuth(request, env);
    return failure
        ? jsonNoStoreResponse(failure.code, failure.message, failure.status, failure.headers)
        : null;
}

/** JSON-Antwort mit stabilem Fehlercode für mutierende Admin-APIs. */
export function requireAdminApiMutation(request, env = process.env) {
    const failure = evaluateAdminMutation(request, env);
    return failure
        ? jsonNoStoreResponse(failure.code, failure.message, failure.status, failure.headers)
        : null;
}
