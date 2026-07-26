import type { FeedSource } from '../types';

type FetchFeeds = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<Response>;

export type NewFeedSource = Omit<FeedSource, 'id'>;

export class FeedsApiError extends Error {
    readonly status: number;

    constructor(
        message: string,
        status: number,
    ) {
        super(message);
        this.name = 'FeedsApiError';
        this.status = status;
    }
}

const FEEDS_ENDPOINT = '/api/feeds';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function readErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
    try {
        const responseText = await response.text();
        if (responseText) {
            try {
                const payload = JSON.parse(responseText) as { error?: unknown };
                if (typeof payload.error === 'string' && payload.error.trim()) {
                    return payload.error;
                }
            } catch {
                // Non-JSON error bodies use the stable fallback below.
            }
        }
    } catch {
        // A response body is optional for errors.
    }

    return `${fallbackMessage} (${response.status})`;
}

async function ensureSuccessful(response: Response, fallbackMessage: string): Promise<void> {
    if (response.ok) {
        return;
    }

    throw new FeedsApiError(
        await readErrorMessage(response, fallbackMessage),
        response.status,
    );
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
