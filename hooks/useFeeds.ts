import { useLocalStorage } from './useLocalStorage';
import { INITIAL_FEEDS } from '../services/feeds';
import type { FeedSource } from '../types';
import { useEffect } from 'react';

export const useFeeds = () => {
    const [feeds, setFeeds] = useLocalStorage<FeedSource[]>('app_feeds', INITIAL_FEEDS);

    // One-time data migration for users with older versions of saved feeds.
    useEffect(() => {
        let needsUpdate = false;
        const migratedFeeds = feeds.map(feed => {
            // Check if 'update_interval' is missing, null, or not a number.
            if (typeof feed.update_interval !== 'number') {
                needsUpdate = true;
                // Assign a sensible default value based on priority.
                const defaultInterval = feed.priority === 'primary' ? 15 : 60;
                return { ...feed, update_interval: defaultInterval };
            }
            return feed;
        });

        if (needsUpdate) {
            console.log('Migrating old feed data to include update intervals.');
            setFeeds(migratedFeeds);
        }
        // The empty dependency array ensures this effect runs only once on mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const addFeed = (feed: Omit<FeedSource, 'id'>) => {
        const newFeed: FeedSource = {
            ...feed,
            id: `${feed.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`
        };
        setFeeds(prev => [...prev, newFeed]);
    };

    const updateFeed = (updatedFeed: FeedSource) => {
        setFeeds(prev => prev.map(feed => feed.id === updatedFeed.id ? updatedFeed : feed));
    };

    const deleteFeed = (feedId: string) => {
        setFeeds(prev => prev.filter(feed => feed.id !== feedId));
    };

    return { feeds, setFeeds, addFeed, updateFeed, deleteFeed };
};
