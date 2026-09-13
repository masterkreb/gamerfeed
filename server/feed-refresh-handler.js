import { requireAdminApiAuth, requireAdminApiMutation } from './admin-auth.js';
import { adminErrorResponse, adminJsonResponse, methodNotAllowedResponse } from './admin-api.js';
import { API_ERROR_CODES } from '../shared/api-errors.js';

const DISPATCH_URL = 'https://api.github.com/repos/masterkreb/gamerfeed/actions/workflows/update-feeds.yml/dispatches';
const DISPATCH_TIMEOUT_MS = 10_000;

/** Fordert ausschließlich den produktiven Feed-Workflow auf `main` an. */
export function createFeedRefreshHandler({
    env = process.env,
    fetchImpl = fetch,
    logger = console,
} = {}) {
    return async function feedRefreshHandler(request) {
        const authResponse = requireAdminApiAuth(request, env);
        if (authResponse) return authResponse;

        if (request.method !== 'POST') {
            return methodNotAllowedResponse(request.method, 'POST');
        }

        const mutationResponse = requireAdminApiMutation(request, env);
        if (mutationResponse) return mutationResponse;

        const token = env.GITHUB_FEED_DISPATCH_TOKEN;
        if (!token) {
            return adminErrorResponse(503, API_ERROR_CODES.DISPATCH_UNAVAILABLE,
                'Der manuelle Feed-Start ist noch nicht eingerichtet.');
        }

        try {
            const response = await fetchImpl(DISPATCH_URL, {
                method: 'POST',
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
                body: JSON.stringify({ ref: 'main' }),
                redirect: 'error',
                signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
            });

            if (response.status !== 204) {
                // Keine Provider-Antwort lesen oder an den Client weiterreichen.
                logger.error('GitHub feed workflow dispatch failed with status', response.status);
                return adminErrorResponse(502, API_ERROR_CODES.DISPATCH_FAILED,
                    'GitHub hat den manuellen Feed-Start nicht angenommen.');
            }

            // 204 bei GitHub bestaetigt nur die Annahme, nicht fertige News.
            return adminJsonResponse({ status: 'accepted' }, 202);
        } catch (error) {
            logger.error('GitHub feed workflow dispatch request failed',
                error instanceof Error ? error.name : 'UnknownError');
            return adminErrorResponse(502, API_ERROR_CODES.DISPATCH_FAILED,
                'GitHub hat den manuellen Feed-Start nicht angenommen.');
        }
    };
}
