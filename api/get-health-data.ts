import { kv } from '@vercel/kv';
import { requireAdminAuth } from '../server/admin-auth.js';
import { createHealthDataHandler } from '../server/health-data-handler.js';

export const config = {
    runtime: 'edge',
};

const handler = createHealthDataHandler(kv);

export default async function healthDataRoute(req: Request) {
    const authResponse = requireAdminAuth(req);
    if (authResponse) {
        return authResponse;
    }

    if (req.method !== 'GET') {
        return new Response(JSON.stringify({ error: `Method ${req.method} Not Allowed` }), {
            status: 405,
            headers: {
                'Allow': 'GET',
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    }

    return handler(req);
}
