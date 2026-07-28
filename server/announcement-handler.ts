import type { Announcement } from '../types';
import { requireAdminAuth, requireAdminMutation } from './admin-auth.js';

export const ANNOUNCEMENT_KV_KEY = 'site_announcement';

interface AnnouncementKv {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<unknown>;
    del(key: string): Promise<unknown>;
}

interface AnnouncementHandlerOptions {
    kv: AnnouncementKv;
    /** Injizierbare Uhr: ID und createdAt enthalten einen Zeitstempel. */
    now?: () => Date;
    /** Zugangsdaten; injizierbar, damit Tests `process.env` nicht anfassen. */
    env?: Record<string, string | undefined>;
    logger?: Pick<Console, 'error'>;
}

export function createAnnouncementHandler({
    kv,
    now = () => new Date(),
    env = process.env,
    logger = console,
}: AnnouncementHandlerOptions) {
    return async function handler(req: Request): Promise<Response> {
        if (req.method !== 'GET') {
            const authResponse = ['POST', 'DELETE'].includes(req.method)
                ? requireAdminMutation(req, env)
                : requireAdminAuth(req, env);
            if (authResponse) {
                return authResponse;
            }
        }

        try {
            // GET - Fetch current announcement (public)
            if (req.method === 'GET') {
                const announcement = await kv.get<Announcement>(ANNOUNCEMENT_KV_KEY);

                // Return null if no announcement or not active
                if (!announcement || !announcement.isActive) {
                    return new Response(JSON.stringify(null), {
                        status: 200,
                        headers: {
                            'Content-Type': 'application/json',
                            'Cache-Control': 's-maxage=60, stale-while-revalidate=120',
                        },
                    });
                }

                return new Response(JSON.stringify(announcement), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 's-maxage=60, stale-while-revalidate=120',
                    },
                });
            }

            // POST - Create/Update announcement (server-side protected)
            if (req.method === 'POST') {
                const body = await req.json();
                const { message, type, isActive } = body;

                if (!message || !type) {
                    return new Response(JSON.stringify({ error: 'Message and type are required' }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }

                const timestamp = now();
                const announcement: Announcement = {
                    id: `announcement-${timestamp.getTime()}`,
                    message,
                    type,
                    isActive: isActive ?? true,
                    createdAt: timestamp.toISOString(),
                };

                await kv.set(ANNOUNCEMENT_KV_KEY, announcement);

                return new Response(JSON.stringify(announcement), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            // DELETE - Remove announcement (server-side protected)
            if (req.method === 'DELETE') {
                await kv.del(ANNOUNCEMENT_KV_KEY);

                return new Response(JSON.stringify({ success: true }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
                status: 405,
                headers: { 'Content-Type': 'application/json' },
            });

        } catch (error) {
            logger.error('Announcement API Error:', error);
            const message = error instanceof Error ? error.message : 'An unknown error occurred';
            return new Response(JSON.stringify({ error: message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    };
}
