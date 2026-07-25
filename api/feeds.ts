import { sql } from '@vercel/postgres';
import type { FeedSource } from '../types';
import { requireAdminAuth, requireAdminMutation } from '../server/admin-auth.js';
import { mapFeedRow, mapFeedRows } from '../server/feed-mapper.js';

export const config = {
    runtime: 'edge',
};

// The scheduler is global. This value only keeps new rows compatible with the
// existing database column; GitHub Actions fetches every feed every 20 minutes.
const LEGACY_UPDATE_INTERVAL_MINUTES = 20;

// A helper function to create a new, URL-safe feed ID from its name
function createFeedId(name: string): string {
    const sanitizedName = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
        .replace(/\s+/g, '-')          // Replace spaces with hyphens
        .replace(/-+/g, '-')           // Replace multiple hyphens with a single one
        .replace(/^-+|-+$/g, '');      // Trim leading/trailing hyphens

    return `${sanitizedName}-${Date.now()}`;
}


export default async function handler(req: Request) {
    const authResponse = ['POST', 'PUT', 'DELETE'].includes(req.method)
        ? requireAdminMutation(req)
        : requireAdminAuth(req);
    if (authResponse) {
        return authResponse;
    }

    try {
        // --- GET all feeds ---
        if (req.method === 'GET') {
            const { rows: feeds } = await sql`SELECT * FROM feeds ORDER BY name;`;
            return new Response(JSON.stringify(mapFeedRows(feeds)), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // --- POST (create) a new feed ---
        if (req.method === 'POST') {
            const { name, url, language, priority, needsScraping } = await req.json() as Omit<FeedSource, 'id'>;
            const newId = createFeedId(name);

            const result = await sql`
                INSERT INTO feeds (id, name, url, language, priority, needs_scraping, update_interval)
                VALUES (${newId}, ${name}, ${url}, ${language}, ${priority}, ${needsScraping ?? false}, ${LEGACY_UPDATE_INTERVAL_MINUTES})
                RETURNING *;
            `;

            return new Response(JSON.stringify(mapFeedRow(result.rows[0])), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // --- PUT (update) an existing feed ---
        if (req.method === 'PUT') {
             const { id, name, url, language, priority, needsScraping } = await req.json() as FeedSource;
             if (!id) {
                 return new Response(JSON.stringify({ error: 'Feed ID is required for updates' }), { status: 400 });
             }

             const result = await sql`
                UPDATE feeds
                SET name = ${name}, url = ${url}, language = ${language}, priority = ${priority}, needs_scraping = ${needsScraping ?? false}
                WHERE id = ${id}
                RETURNING *;
             `;

             if (!result.rows[0]) {
                 return new Response(JSON.stringify({ error: 'Feed not found' }), {
                     status: 404,
                     headers: { 'Content-Type': 'application/json' },
                 });
             }

             return new Response(JSON.stringify(mapFeedRow(result.rows[0])), {
                 status: 200,
                 headers: { 'Content-Type': 'application/json' },
             });
        }

        // --- DELETE a feed ---
        if (req.method === 'DELETE') {
            const { id } = await req.json() as { id: string };
            if (!id) {
                 return new Response(JSON.stringify({ error: 'Feed ID is required for deletion' }), { status: 400 });
            }
            await sql`DELETE FROM feeds WHERE id = ${id};`;
            return new Response(null, { status: 204 }); // 204 No Content for successful delete
        }

        // --- Handle other methods ---
        return new Response(JSON.stringify({ error: `Method ${req.method} Not Allowed` }), {
            status: 405,
            headers: { 'Allow': 'GET, POST, PUT, DELETE' },
        });

    } catch (error) {
        console.error('API Error in /api/feeds:', error);
        const message = error instanceof Error ? error.message : "An unknown server error occurred.";
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
