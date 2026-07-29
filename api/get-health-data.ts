import { kv } from '@vercel/kv';
import { requireAdminApiAuth } from '../server/admin-auth.js';
import { methodNotAllowedResponse } from '../server/admin-api.js';
import { createHealthDataHandler } from '../server/health-data-handler.js';
import {
    legacySnapshotRollbackEnabled,
    readActiveNewsSnapshotMetadata,
} from '../shared/news-snapshot-store.js';

export const config = {
    runtime: 'edge',
};

const legacyRollback = legacySnapshotRollbackEnabled(process.env.NEWS_SNAPSHOT_LEGACY_ROLLBACK);
const handler = createHealthDataHandler(kv, legacyRollback
    ? {}
    : { readSnapshotMetadata: () => readActiveNewsSnapshotMetadata(kv) });

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
