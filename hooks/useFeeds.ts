import { useState, useEffect, useCallback } from 'react';
import type { FeedSource } from '../types';
import {
    createFeed,
    loadFeeds,
    removeFeed,
    saveFeed,
} from '../services/feeds-api';

export const useFeeds = () => {
    const [feeds, setFeeds] = useState<FeedSource[]>([]);

    const fetchFeeds = useCallback(async () => {
        try {
            const data = await loadFeeds();
            setFeeds(data);
        } catch (error) {
            console.error('Error loading feeds:', error);
        }
    }, []);

    useEffect(() => {
        void fetchFeeds();
    }, [fetchFeeds]);

    const addFeed = useCallback(async (feed: Omit<FeedSource, 'id'>) => {
        const newFeed = await createFeed(feed);
        setFeeds(prev => [...prev, newFeed]);
    }, []);

    const updateFeed = useCallback(async (updatedFeed: FeedSource) => {
        const savedFeed = await saveFeed(updatedFeed);
        setFeeds(prev => prev.map(f => f.id === savedFeed.id ? savedFeed : f));
    }, []);

    const deleteFeed = useCallback(async (feedId: string) => {
        await removeFeed(feedId);
        setFeeds(prev => prev.filter(f => f.id !== feedId));
    }, []);

    return { feeds, addFeed, updateFeed, deleteFeed };
};
