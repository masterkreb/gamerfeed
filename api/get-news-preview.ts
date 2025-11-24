import { kv } from '@vercel/kv';
import type { Article } from '../types';

export const config = {
    runtime: 'edge',
};

const PREVIEW_COUNT = 16;

export default async function handler(req: Request) {
    try {
        // Load from dedicated preview cache (16 articles)
        let articles = await kv.get<Article[]>('news_cache_16');

        // Fallback to full cache if preview doesn't exist yet
        if (!articles) {
            const fullCache = await kv.get<Article[]>('news_cache');
            if (fullCache) {
                articles = fullCache.slice(0, PREVIEW_COUNT);
            }
        }

        if (!articles) {
            return new Response(JSON.stringify({ error: "Cache is empty or not available." }), {
                status: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                },
            });
        }

        return new Response(JSON.stringify(articles), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
            },
        });

    } catch (error) {
        console.error("API Error in /api/get-news-preview:", error);
        const message = error instanceof Error ? error.message : "An unknown server error occurred.";
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
            },
        });
    }
}
