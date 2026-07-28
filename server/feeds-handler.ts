import type { FeedSource } from '../types';
import { requireAdminAuth, requireAdminMutation } from './admin-auth.js';
import {
    mapNewFeedToDatabaseRow,
    mapFeedRow,
    mapFeedRows,
    mapFeedUpdateToDatabaseRow,
} from './feed-mapper.js';
import { validateFeedPayload } from './feed-validation.js';

/**
 * Tagged-Template-Funktion im Stil von `@vercel/postgres`.
 *
 * Die Abfragen bleiben bewusst im getesteten Handler statt in der dünnen
 * API-Datei; Tests reichen eine eigene Implementierung herein und kommen so
 * ohne Datenbank aus.
 */
export type FeedsSql = <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
) => Promise<{ rows: T[] }>;

interface FeedsHandlerOptions {
    sql: FeedsSql;
    /** Injizierbare Uhr: die Feed-ID enthält einen Zeitstempel. */
    now?: () => Date;
    /** Zugangsdaten; injizierbar, damit Tests `process.env` nicht anfassen. */
    env?: Record<string, string | undefined>;
    logger?: Pick<Console, 'error'>;
}

// A helper function to create a new, URL-safe feed ID from its name
function createFeedId(name: string, now: Date): string {
    const sanitizedName = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
        .replace(/\s+/g, '-')          // Replace spaces with hyphens
        .replace(/-+/g, '-')           // Replace multiple hyphens with a single one
        .replace(/^-+|-+$/g, '');      // Trim leading/trailing hyphens

    return `${sanitizedName}-${now.getTime()}`;
}

export function createFeedsHandler({
    sql,
    now = () => new Date(),
    env = process.env,
    logger = console,
}: FeedsHandlerOptions) {
    return async function handler(req: Request): Promise<Response> {
        const authResponse = ['POST', 'PUT', 'DELETE'].includes(req.method)
            ? requireAdminMutation(req, env)
            : requireAdminAuth(req, env);
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
                const payload = await req.json() as Omit<FeedSource, 'id'>;

                const { error: validationError } = validateFeedPayload(payload);
                if (validationError) {
                    return new Response(JSON.stringify({ error: validationError }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }

                const newId = createFeedId(payload.name, now());
                const feedRow = mapNewFeedToDatabaseRow(payload, newId);

                const result = await sql`
                    INSERT INTO feeds (id, name, url, language, priority, needs_scraping, update_interval)
                    VALUES (${feedRow.id}, ${feedRow.name}, ${feedRow.url}, ${feedRow.language}, ${feedRow.priority}, ${feedRow.needs_scraping}, ${feedRow.update_interval})
                    RETURNING *;
                `;

                return new Response(JSON.stringify(mapFeedRow(result.rows[0])), {
                    status: 201,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            // --- PUT (update) an existing feed ---
            if (req.method === 'PUT') {
                const payload = await req.json() as FeedSource;
                const feedRow = mapFeedUpdateToDatabaseRow(payload);
                if (!feedRow.id) {
                    return new Response(JSON.stringify({ error: 'Feed ID is required for updates' }), { status: 400 });
                }

                const { error: validationError } = validateFeedPayload(payload);
                if (validationError) {
                    return new Response(JSON.stringify({ error: validationError }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }

                const result = await sql`
                    UPDATE feeds
                    SET name = ${feedRow.name}, url = ${feedRow.url}, language = ${feedRow.language}, priority = ${feedRow.priority}, needs_scraping = ${feedRow.needs_scraping}
                    WHERE id = ${feedRow.id}
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
            logger.error('API Error in /api/feeds:', error);
            const message = error instanceof Error ? error.message : 'An unknown server error occurred.';
            return new Response(JSON.stringify({ error: message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    };
}
