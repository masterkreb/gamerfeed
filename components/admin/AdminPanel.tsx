import React, { useState, useEffect } from 'react';
import { FeedFormModal } from './FeedFormModal';
import { FeedManagementTab } from './FeedManagementTab';
import { HealthCenterTab } from './HealthCenterTab';
import { HealthLegendTab } from './HealthLegendTab';
import { CacheAnalysisTab } from './CacheAnalysisTab';
import type { FeedSource } from '../../types';
import type { HealthState } from './healthService';

export const AdminPanel: React.FC = () => {
    const [feeds, setFeeds] = useState<FeedSource[]>([]);
    const [feedHealth, setFeedHealth] = useState<Record<string, HealthState>>({});
    const [activeTab, setActiveTab] = useState<'feeds' | 'health' | 'legend' | 'cache'>('feeds');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingFeed, setEditingFeed] = useState<FeedSource | null>(null);
    const [feedToDelete, setFeedToDelete] = useState<FeedSource | null>(null);

    useEffect(() => {
        loadFeeds();
    }, []);

    const loadFeeds = async () => {
        try {
            const response = await fetch('/api/feeds');
            if (response.ok) {
                const data = await response.json();
                setFeeds(data);
            }
        } catch (error) {
            console.error('Error loading feeds:', error);
        }
    };

    const addFeed = async (feed: Omit<FeedSource, 'id'>) => {
        try {
            const response = await fetch('/api/feeds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(feed)
            });
            if (response.ok) {
                await loadFeeds();
                setIsModalOpen(false);
            }
        } catch (error) {
            console.error('Error adding feed:', error);
        }
    };

    const updateFeed = async (id: string, feed: Partial<FeedSource>) => {
        try {
            const response = await fetch(`/api/feeds/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(feed)
            });
            if (response.ok) {
                await loadFeeds();
                setIsModalOpen(false);
                setEditingFeed(null);
            }
        } catch (error) {
            console.error('Error updating feed:', error);
        }
    };

    const deleteFeed = async (id: string) => {
        try {
            const response = await fetch(`/api/feeds/${id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                await loadFeeds();
            }
        } catch (error) {
            console.error('Error deleting feed:', error);
        }
    };

    const checkFeedHealth = async (feedUrl: string) => {
        try {
            const response = await fetch('/api/check-feed-health', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ feedUrl })
            });
            if (response.ok) {
                const health = await response.json();
                setFeedHealth(prev => ({ ...prev, [feedUrl]: health }));
            }
        } catch (error) {
            console.error('Error checking feed health:', error);
        }
    };

    const checkAllFeeds = async () => {
        for (const feed of feeds) {
            await checkFeedHealth(feed.url);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    };

    const handleAddNew = () => {
        setEditingFeed(null);
        setIsModalOpen(true);
    };

    const handleEdit = (feed: FeedSource) => {
        setEditingFeed(feed);
        setIsModalOpen(true);
    };

    const handleDelete = (feed: FeedSource) => {
        setFeedToDelete(feed);
    };

    const confirmDelete = () => {
        if (feedToDelete) {
            deleteFeed(feedToDelete.id);
            setFeedToDelete(null);
        }
    };

    return (
        <div className="min-h-screen bg-white dark:bg-black text-slate-900 dark:text-zinc-100">
            <header className="border-b border-slate-200 dark:border-zinc-800 bg-white/80 dark:bg-black/80 backdrop-blur-sm sticky top-0 z-30">
                <div className="max-w-7xl mx-auto px-4 py-4">
                    <h1 className="text-2xl font-bold">Admin Panel</h1>
                </div>
            </header>

            <nav className="border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/50">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="flex gap-1" role="tablist">
                        <button
                            role="tab"
                            aria-selected={activeTab === 'feeds'}
                            onClick={() => setActiveTab('feeds')}
                            className={`px-6 py-3 font-semibold transition-all ${
                                activeTab === 'feeds'
                                    ? 'border-b-2 border-blue-600 text-blue-600'
                                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                            }`}
                        >
                            Feed Sources
                        </button>
                        <button
                            role="tab"
                            aria-selected={activeTab === 'health'}
                            onClick={() => setActiveTab('health')}
                            className={`px-6 py-3 font-semibold transition-all ${
                                activeTab === 'health'
                                    ? 'border-b-2 border-blue-600 text-blue-600'
                                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                            }`}
                        >
                            Health Center
                        </button>
                        <button
                            role="tab"
                            aria-selected={activeTab === 'cache'}
                            onClick={() => setActiveTab('cache')}
                            className={`px-6 py-3 font-semibold transition-all ${
                                activeTab === 'cache'
                                    ? 'border-b-2 border-blue-600 text-blue-600'
                                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                            }`}
                        >
                            Cache Analysis
                        </button>
                        <button
                            role="tab"
                            aria-selected={activeTab === 'legend'}
                            onClick={() => setActiveTab('legend')}
                            className={`px-6 py-3 font-semibold transition-all ${
                                activeTab === 'legend'
                                    ? 'border-b-2 border-blue-600 text-blue-600'
                                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
                            }`}
                        >
                            Legend
                        </button>
                    </div>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto px-4 py-8">
                <div role="tabpanel" hidden={activeTab !== 'feeds'}>
                    <FeedManagementTab
                        feeds={feeds}
                        feedHealth={feedHealth}
                        onAddNew={handleAddNew}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onCheckHealth={checkFeedHealth}
                    />
                </div>
                <div role="tabpanel" hidden={activeTab !== 'health'}>
                    <HealthCenterTab
                        feeds={feeds}
                        feedHealth={feedHealth}
                        onCheckHealth={checkFeedHealth}
                        onCheckAll={checkAllFeeds}
                    />
                </div>
                <div role="tabpanel" hidden={activeTab !== 'cache'}>
                    <CacheAnalysisTab feeds={feeds} />
                </div>
                <div role="tabpanel" hidden={activeTab !== 'legend'}>
                    <HealthLegendTab />
                </div>
            </main>

            <FeedFormModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                feed={editingFeed}
                feeds={feeds}
                addFeed={addFeed}
                updateFeed={updateFeed}
            />

            {feedToDelete && (
                <>
                    <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setFeedToDelete(null)} />
                    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-slate-100 dark:bg-zinc-900 rounded-2xl shadow-2xl p-6">
                        <h2 className="text-lg font-bold">Delete Feed Source</h2>
                        <p className="text-sm text-slate-600 dark:text-zinc-400 mt-2">
                            Are you sure you want to delete "{feedToDelete.name}"? This cannot be undone.
                        </p>
                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                onClick={() => setFeedToDelete(null)}
                                className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-200 dark:bg-zinc-700 hover:bg-slate-300 dark:hover:bg-zinc-600"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};