import { kv } from '@vercel/kv';
import { createNewsCacheHandler } from '../server/news-cache-handler.js';

export const config = {
    runtime: 'edge',
};

export default createNewsCacheHandler(kv, {
    cacheKey: 'news_cache',
    endpointPath: '/api/get-news',
});
