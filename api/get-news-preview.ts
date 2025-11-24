import { kv } from '@vercel/kv';
import type { Article } from '../types';

export const config = {
    runtime: 'edge',
};

const PREVIEW_COUNT = 12;

export default async function handler(req: Request) {
    try {
        // Load from the same news_cache, just return first 12
        const articles = await kv.get<Article[]>('news_cache');

        if (!articles) {
            return new Response(JSON.stringify({ error: "Cache is empty or not available." }), {
                status: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                },
            });
        }

        // Return only the first 12 articles for instant display
        const previewArticles = articles.slice(0, PREVIEW_COUNT);

        return new Response(JSON.stringify(previewArticles), {
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
