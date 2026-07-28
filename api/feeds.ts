import { sql } from '@vercel/postgres';
import { createFeedsHandler, type FeedsSql } from '../server/feeds-handler.js';

export const config = {
    runtime: 'edge',
};

export default createFeedsHandler({ sql: sql as unknown as FeedsSql });
