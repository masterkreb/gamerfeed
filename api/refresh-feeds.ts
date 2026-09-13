import { createFeedRefreshHandler } from '../server/feed-refresh-handler.js';

export const config = { runtime: 'edge' };

export default createFeedRefreshHandler();
