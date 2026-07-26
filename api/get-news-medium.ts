import { kv } from '@vercel/kv';
import { createNewsCacheHandler } from '../server/news-cache-handler.ts';

export const config = {
    runtime: 'edge',
};

export default createNewsCacheHandler(kv, {
    cacheKey: 'news_cache_64',
    endpointPath: '/api/get-news-medium',
    fallback: {
        cacheKey: 'news_cache',
        limit: 64,
    },
});
