import { kv } from '@vercel/kv';
import { createNewsCacheHandler } from '../server/news-cache-handler.js';
import {
    NEWS_SNAPSHOT_VARIANTS,
    legacySnapshotRollbackEnabled,
    readBoundNewsSnapshot,
} from '../shared/news-snapshot-store.js';

export const config = {
    runtime: 'edge',
};

export default createNewsCacheHandler(kv, {
    cacheKey: 'news_cache',
    endpointPath: '/api/get-news',
}, console, {
    legacyRollback: legacySnapshotRollbackEnabled(process.env.NEWS_SNAPSHOT_LEGACY_ROLLBACK),
    readBoundSnapshot: requestedSnapshotId => readBoundNewsSnapshot(kv, {
        variant: NEWS_SNAPSHOT_VARIANTS.FULL,
        requestedSnapshotId,
    }),
});
