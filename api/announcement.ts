import { kv } from '@vercel/kv';
import { createAnnouncementHandler } from '../server/announcement-handler.js';

export const config = {
    runtime: 'edge',
};

export default createAnnouncementHandler({ kv });
