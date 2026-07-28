import type { FeedSource } from '../types';

type FetchFeeds = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<Response>;

export type NewFeedSource = Omit<FeedSource, 'id'>;

export class FeedsApiError extends Error {
    readonly status: number;
    /**
     * Stabiler Fehlercode aus `shared/api-errors.js`, sofern die Antwort einen
     * mitliefert. `null` bei älteren oder fremden Antworten.
     */
    readonly code: string | null;
    /** Betroffenes Feld bei Validierungsfehlern, sonst null. */
    readonly field: string | null;

    constructor(
        message: string,
        status: number,
        code: string | null = null,
        field: string | null = null,
    ) {
        super(message);
        this.name = 'FeedsApiError';
        this.status = status;
        this.code = code;
        this.field = field;
    }
}

const FEEDS_ENDPOINT = '/api/feeds';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface ParsedApiError {
    message: string;
    code: string | null;
    field: string | null;
}

async function readApiError(response: Response, fallbackMessage: string): Promise<ParsedApiError> {
    const fallback: ParsedApiError = {
        message: `${fallbackMessage} (${response.status})`,
        code: null,
        field: null,
    };

    try {
        const responseText = await response.text();
        if (!responseText) {
            return fallback;
        }

        try {
            const payload = JSON.parse(responseText) as {
                error?: unknown;
                code?: unknown;
                field?: unknown;
            };

            return {
                message: typeof payload.error === 'string' && payload.error.trim()
                    ? payload.error
                    : fallback.message,
                code: typeof payload.code === 'string' && payload.code ? payload.code : null,
                field: typeof payload.field === 'string' && payload.field ? payload.field : null,
            };
        } catch {
            // Non-JSON error bodies use the stable fallback below.
            return fallback;
        }
    } catch {
        // A response body is optional for errors.
        return fallback;
    }
}

async function ensureSuccessful(response: Response, fallbackMessage: string): Promise<void> {
    if (response.ok) {
        return;
    }

    const { message, code, field } = await readApiError(response, fallbackMessage);
    throw new FeedsApiError(message, response.status, code, field);
}

async function requestJson<T>(
    fetcher: FetchFeeds,
    init: RequestInit | undefined,
    fallbackMessage: string,
): Promise<T> {
    const response = await fetcher(FEEDS_ENDPOINT, init);
    await ensureSuccessful(response, fallbackMessage);
    return response.json() as Promise<T>;
}

export function loadFeeds(fetcher: FetchFeeds = globalThis.fetch): Promise<FeedSource[]> {
    return requestJson<FeedSource[]>(fetcher, undefined, 'Failed to load feeds');
}

export function createFeed(
    feed: NewFeedSource,
    fetcher: FetchFeeds = globalThis.fetch,
): Promise<FeedSource> {
    return requestJson<FeedSource>(
        fetcher,
        {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify(feed),
        },
        'Failed to add feed',
    );
}

export function saveFeed(
    feed: FeedSource,
    fetcher: FetchFeeds = globalThis.fetch,
): Promise<FeedSource> {
    return requestJson<FeedSource>(
        fetcher,
        {
            method: 'PUT',
            headers: JSON_HEADERS,
            body: JSON.stringify(feed),
        },
        'Failed to update feed',
    );
}

export async function removeFeed(
    feedId: string,
    fetcher: FetchFeeds = globalThis.fetch,
): Promise<void> {
    const response = await fetcher(FEEDS_ENDPOINT, {
        method: 'DELETE',
        headers: JSON_HEADERS,
        body: JSON.stringify({ id: feedId }),
    });
    await ensureSuccessful(response, 'Failed to delete feed');
}
