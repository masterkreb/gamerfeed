import type { Article } from '../types';

type NewsCacheKey = 'news_cache' | 'news_cache_16' | 'news_cache_64';

interface NewsCacheClient {
    get<T>(key: string): Promise<T | null>;
}

interface NewsCacheFallback {
    cacheKey: NewsCacheKey;
    limit: number;
}

interface NewsCacheEndpoint {
    cacheKey: NewsCacheKey;
    endpointPath: string;
    fallback?: NewsCacheFallback;
}

const SUCCESS_CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=300';
const ERROR_CACHE_CONTROL = 'no-cache';
const EMPTY_CACHE_MESSAGE = 'Cache is empty or not available.';
const UNKNOWN_ERROR_MESSAGE = 'An unknown server error occurred.';

function jsonResponse(body: unknown, status: number, cacheControl: string): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': cacheControl,
        },
    });
}

export function createNewsCacheHandler(
    cache: NewsCacheClient,
    endpoint: NewsCacheEndpoint,
    logger: Pick<Console, 'error'> = console,
) {
    return async function handler(_request: Request): Promise<Response> {
        try {
            let articles = await cache.get<Article[]>(endpoint.cacheKey);

            if (!articles && endpoint.fallback) {
                const fallbackArticles = await cache.get<Article[]>(endpoint.fallback.cacheKey);
                if (fallbackArticles) {
                    articles = fallbackArticles.slice(0, endpoint.fallback.limit);
                }
            }

            if (!articles) {
                return jsonResponse(
                    { error: EMPTY_CACHE_MESSAGE },
                    404,
                    ERROR_CACHE_CONTROL,
                );
            }

            return jsonResponse(articles, 200, SUCCESS_CACHE_CONTROL);
        } catch (error) {
            logger.error(`API Error in ${endpoint.endpointPath}:`, error);
            const message = error instanceof Error ? error.message : UNKNOWN_ERROR_MESSAGE;
            return jsonResponse({ error: message }, 500, ERROR_CACHE_CONTROL);
        }
    };
}
