import { useState, useEffect, useCallback } from 'react';
import type { FeedSource } from '../types';

export const useFeeds = () => {
    const [feeds, setFeeds] = useState<FeedSource[]>([]);

    const fetchFeeds = useCallback(async () => {
        try {
            const response = await fetch('/api/feeds');
            if (!response.ok) {
                throw new Error(`Failed to fetch feeds: ${response.statusText}`);
            }
            const data: FeedSource[] = await response.json();
            setFeeds(data);
        } catch (error) {
            console.error(error);
            // In a real app, you might want to set an error state here
            // to display a message to the user.
        }
    }, []);

    useEffect(() => {
        fetchFeeds();
    }, [fetchFeeds]);

    const addFeed = useCallback(async (feed: Omit<FeedSource, 'id'>) => {
        try {
            const response = await fetch('/api/feeds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(feed),
            });
            if (!response.ok) throw new Error('Failed to add feed');
            const newFeed = await response.json();
            setFeeds(prev => [...prev, newFeed]);
        } catch (error) {
            console.error('Error adding feed:', error);
        }
    }, []);

    const updateFeed = useCallback(async (updatedFeed: FeedSource) => {
        try {
            const response = await fetch(`/api/feeds`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedFeed),
            });
            if (!response.ok) throw new Error('Failed to update feed');
            setFeeds(prev => prev.map(f => f.id === updatedFeed.id ? updatedFeed : f));
        } catch (error) {
            console.error('Error updating feed:', error);
        }
    }, []);

    const deleteFeed = useCallback(async (feedId: string) => {
        try {
            const response = await fetch(`/api/feeds`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: feedId }),
            });
            if (!response.ok) throw new Error('Failed to delete feed');
            setFeeds(prev => prev.filter(f => f.id !== feedId));
        } catch (error) {
            console.error('Error deleting feed:', error);
        }
    }, []);

    return { feeds, addFeed, updateFeed, deleteFeed };
};
