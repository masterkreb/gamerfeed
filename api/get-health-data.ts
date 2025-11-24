import { kv } from '@vercel/kv';
import type { Article, BackendHealthStatus } from '../types';

export const config = {
    runtime: 'edge',
};

export default async function handler(req: Request) {
    try {
        const [healthStatus, articles] = await Promise.all([
            kv.get<BackendHealthStatus>('feed_health_status'),
            kv.get<Article[]>('news_cache')
        ]);

        if (!healthStatus || !articles) {
            return new Response(JSON.stringify({ error: "Health data or news cache not available in KV store." }), {
                status: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                },
            });
        }

        // We only need the unique sources from the articles for the health check logic, not all article data.
        const sourcesInCache = [...new Set(articles.map(a => a.source))];

        return new Response(JSON.stringify({ healthStatus, sourcesInCache }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache', // Always fetch the latest health status
            },
        });

    } catch (error) {
        console.error("API Error in /api/get-health-data:", error);
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
