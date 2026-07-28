import { kv } from '@vercel/kv';
import { requireAdminApiAuth } from '../server/admin-auth.js';
import { methodNotAllowedResponse } from '../server/admin-api.js';
import { createHealthDataHandler } from '../server/health-data-handler.js';

export const config = {
    runtime: 'edge',
};

const handler = createHealthDataHandler(kv);

export default async function healthDataRoute(req: Request) {
    const authResponse = requireAdminApiAuth(req);
    if (authResponse) {
        return authResponse;
    }

    if (req.method !== 'GET') {
        return methodNotAllowedResponse(req.method, 'GET');
    }

    return handler(req);
}
