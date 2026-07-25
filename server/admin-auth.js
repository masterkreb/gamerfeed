const ADMIN_REALM = 'GamerFeed Admin';

function noStoreResponse(body, status, headers = {}) {
    return new Response(body, {
        status,
        headers: {
            'Cache-Control': 'no-store',
            ...headers,
        },
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

export function requireAdminAuth(request, env = process.env) {
    const expectedUsername = env.ADMIN_USERNAME;
    const expectedPassword = env.ADMIN_PASSWORD;

    if (!expectedUsername || !expectedPassword || expectedUsername.includes(':')) {
        return noStoreResponse('Service unavailable', 503);
    }

    const credentials = parseBasicCredentials(request.headers.get('authorization'));
    const usernameMatches = safeEqual(credentials?.username ?? '', expectedUsername);
    const passwordMatches = safeEqual(credentials?.password ?? '', expectedPassword);

    if (credentials && usernameMatches && passwordMatches) {
        return null;
    }

    return noStoreResponse('Authentication required', 401, {
        'WWW-Authenticate': `Basic realm="${ADMIN_REALM}", charset="UTF-8"`,
    });
}

export function requireAdminMutation(request, env = process.env) {
    const authResponse = requireAdminAuth(request, env);
    if (authResponse) {
        return authResponse;
    }

    let requestOrigin;
    try {
        requestOrigin = new URL(request.url).origin;
    } catch {
        return noStoreResponse('Forbidden', 403);
    }

    if (request.headers.get('origin') !== requestOrigin) {
        return noStoreResponse('Forbidden', 403);
    }

    return null;
}
