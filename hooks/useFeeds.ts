import { useState, useEffect, useCallback, useRef } from 'react';
import type { FeedSource } from '../types';
import {
    createFeed,
    loadFeeds,
    removeFeed,
    saveFeed,
} from '../services/feeds-api';

export type FeedsLoadStatus = 'loading' | 'ready' | 'error';

export const useFeeds = () => {
    const [feeds, setFeeds] = useState<FeedSource[]>([]);
    const [loadStatus, setLoadStatus] = useState<FeedsLoadStatus>('loading');
    const latestLoadRequest = useRef(0);

    const fetchFeeds = useCallback(async () => {
        const requestId = ++latestLoadRequest.current;
        setLoadStatus('loading');

        try {
            const data = await loadFeeds();
            if (requestId !== latestLoadRequest.current) return;

            setFeeds(data);
            setLoadStatus('ready');
        } catch (error) {
            if (requestId !== latestLoadRequest.current) return;

            console.error('Error loading feeds:', error);
            setLoadStatus('error');
        }
    }, []);

    useEffect(() => {
        void fetchFeeds();

        return () => {
            latestLoadRequest.current += 1;
        };
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

    return {
        feeds,
        loadStatus,
        reloadFeeds: fetchFeeds,
        addFeed,
        updateFeed,
        deleteFeed,
    };
};
