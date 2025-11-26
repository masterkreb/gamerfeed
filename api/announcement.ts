import { kv } from '@vercel/kv';
import type { Announcement } from '../types';

export const config = {
    runtime: 'edge',
};

const KV_KEY = 'site_announcement';

export default async function handler(req: Request) {
    try {
        // GET - Fetch current announcement (public)
        if (req.method === 'GET') {
            const announcement = await kv.get<Announcement>(KV_KEY);
            
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

        // POST - Create/Update announcement (protected by middleware)
        if (req.method === 'POST') {
            const body = await req.json();
            const { message, type, isActive } = body;

            if (!message || !type) {
                return new Response(JSON.stringify({ error: 'Message and type are required' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            const announcement: Announcement = {
                id: `announcement-${Date.now()}`,
                message,
                type,
                isActive: isActive ?? true,
                createdAt: new Date().toISOString(),
            };

            await kv.set(KV_KEY, announcement);

            return new Response(JSON.stringify(announcement), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // DELETE - Remove announcement (protected by middleware)
        if (req.method === 'DELETE') {
            await kv.del(KV_KEY);

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
        console.error('Announcement API Error:', error);
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
