import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useFeeds } from '../../hooks/useFeeds';
import type { Article, FeedSource } from '../../types';
import {
    ArrowLeftIcon,
    NewspaperIcon,
    HeartbeatIcon,
    QuestionMarkCircleIcon,
    WarningIcon,
    ChevronDownIcon,
    ChevronUpIcon,
} from '../Icons';
import { FeedFormModal } from './FeedFormModal';
import { checkFeedHealth as checkFeedHealthService, HealthState } from './healthService';
import { FeedManagementTab } from './FeedManagementTab';
import { HealthCenterTab } from './HealthCenterTab';
import { HealthLegendTab } from './HealthLegendTab';


// Types
type AdminTab = 'management' | 'health' | 'legend';
export type FeedHealth = Record<string, HealthState>;

const TabButton: React.FC<{
    isActive: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
}> = ({ isActive, onClick, icon, label }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
            isActive
                ? 'text-indigo-600 dark:text-indigo-400 border-indigo-500'
                : 'text-slate-500 dark:text-zinc-400 border-transparent hover:border-slate-300 dark:hover:border-zinc-600 hover:text-slate-700 dark:hover:text-zinc-200'
        }`}
        role="tab"
        aria-selected={isActive}
    >
        {icon}
        {label}
    </button>
);

const MissingFeedsWarning: React.FC<{ missingFeeds: FeedSource[] }> = ({ missingFeeds }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    if (missingFeeds.length === 0) {
        return null;
    }

    return (
        <div className="bg-amber-100 dark:bg-amber-900/30 border-l-4 border-amber-500 text-amber-800 dark:text-amber-200 p-4 rounded-lg mb-6 animate-fade-in">
            <div className="flex items-start">
                <div className="flex-shrink-0 mt-0.5">
                    <WarningIcon className="w-6 h-6 text-amber-500" />
                </div>
                <div className="ml-3 flex-1">
                    <div className="flex justify-between items-center">
                        <h3 className="text-lg font-medium">
                            {missingFeeds.length} Missing Feed{missingFeeds.length > 1 ? 's' : ''} From Frontend Cache
                        </h3>
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="p-2 -m-2 rounded-full hover:bg-amber-200 dark:hover:bg-amber-800/50"
                            aria-expanded={isExpanded}
                        >
                            {isExpanded ? <ChevronUpIcon className="w-5 h-5" /> : <ChevronDownIcon className="w-5 h-5" />}
                        </button>
                    </div>
                    {isExpanded && (
                        <div className="mt-2 text-sm">
                            <p>The following feeds are not present in the live <code className="text-xs bg-amber-200 dark:bg-amber-800/50 p-1 rounded">news-cache.json</code> file. This indicates a potential issue with the automated feed fetching process (e.g., GitHub Action failure).</p>
                            <ul className="list-none mt-3 space-y-2 text-xs">
                                {missingFeeds.map(feed => (
                                    <li key={feed.id} className="font-mono p-2 bg-slate-50 dark:bg-zinc-800/30 rounded">
                                        <strong className="font-sans font-semibold text-base mr-2">{feed.name}</strong>
                                        <a href={feed.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-600 dark:hover:text-amber-100 break-all">{feed.url}</a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};


export const AdminPanel: React.FC = () => {
    const { feeds, addFeed, updateFeed, deleteFeed } = useFeeds();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingFeed, setEditingFeed] = useState<FeedSource | null>(null);
    const [feedToDelete, setFeedToDelete] = useState<FeedSource | null>(null);
    const [feedHealth, setFeedHealth] = useState<FeedHealth>({});
    const [activeTab, setActiveTab] = useState<AdminTab>('management');
    const [isCheckingAll, setIsCheckingAll] = useState(false);

    // Initialize health status for any new feeds
    useEffect(() => {
        const initialHealth: FeedHealth = {};
        feeds.forEach(feed => {
            if (!feedHealth[feed.id]) {
                initialHealth[feed.id] = { status: 'unknown', detail: null };
            }
        });
        if (Object.keys(initialHealth).length > 0) {
            setFeedHealth(prev => ({ ...prev, ...initialHealth }));
        }
    }, [feeds, feedHealth]);

    const missingFeeds = useMemo(() => {
        return feeds.filter(feed =>
            feedHealth[feed.id]?.status === 'warning' &&
            feedHealth[feed.id]?.detail?.includes('not found in the live news cache')
        ).sort((a,b) => a.name.localeCompare(b.name));
    }, [feeds, feedHealth]);

    const handleAddNew = () => { setEditingFeed(null); setIsModalOpen(true); };
    const handleEdit = (feed: FeedSource) => { setEditingFeed(feed); setIsModalOpen(true); };
    const handleDelete = (feed: FeedSource) => { setFeedToDelete(feed); };

    const confirmDelete = () => {
        if (feedToDelete) {
            deleteFeed(feedToDelete.id);
            setFeedHealth(prev => {
                const newHealth = { ...prev };
                delete newHealth[feedToDelete.id];
                return newHealth;
            });
            setFeedToDelete(null);
        }
    };

    // Health Check Logic
    const checkFeedHealth = useCallback(async (feed: FeedSource, sourcesInCache: Set<string>) => {
        setFeedHealth(prev => ({ ...prev, [feed.id]: { status: 'checking', detail: 'Verifying presence in news cache...' } }));

        if (!sourcesInCache.has(feed.name)) {
            setFeedHealth(prev => ({
                ...prev,
                [feed.id]: {
                    status: 'warning',
                    detail: 'Feed not found in the live news cache. The automated GitHub Action might be failing for this source.'
                }
            }));
            return; // Stop here. This is the most critical information.
        }

        // If present in cache, run the live check for deeper diagnostics.
        setFeedHealth(prev => ({ ...prev, [feed.id]: { status: 'checking', detail: 'Cache OK. Initiating live check...' } }));
        const result = await checkFeedHealthService(feed);
        setFeedHealth(prev => ({ ...prev, [feed.id]: result }));
    }, []);

    const handleCheckSingleFeed = useCallback(async (feed: FeedSource) => {
        setFeedHealth(prev => ({ ...prev, [feed.id]: { status: 'checking', detail: 'Fetching live news cache...' } }));
        try {
            const response = await fetch('/news-cache.json?' + Date.now()); // Cache bust
            if (!response.ok) {
                throw new Error(`Failed to fetch news cache: ${response.status}`);
            }
            const articles: Article[] = await response.json();
            const sourcesInCache = new Set(articles.map(a => a.source));

            // Now call the core check function with the cache data
            await checkFeedHealth(feed, sourcesInCache);

        } catch (error) {
            const message = error instanceof Error ? error.message : "An unknown error occurred.";
            console.error("Failed to fetch or parse news-cache.json", error);
            setFeedHealth(prev => ({
                ...prev,
                [feed.id]: {
                    status: 'error',
                    detail: `Could not load news-cache.json to verify presence. Error: ${message}`
                }
            }));
        }
    }, [checkFeedHealth]);


    const checkAllFeeds = useCallback(async () => {
        setIsCheckingAll(true);
        // First, fetch the live cache to get the ground truth.
        let sourcesInCache: Set<string>;
        try {
            const response = await fetch('/news-cache.json?' + Date.now()); // Cache bust
            if (!response.ok) throw new Error(`Failed to fetch news cache: ${response.status}`);
            const articles: Article[] = await response.json();
            sourcesInCache = new Set(articles.map((a: Article) => a.source));
        } catch (error) {
            const message = error instanceof Error ? error.message : "An unknown server error occurred.";
            console.error("Failed to fetch or parse news-cache.json for 'Check All'", error);
            // Optionally update all feeds to show a cache error
            const allFeedsErrorState: FeedHealth = {};
            feeds.forEach(feed => {
                allFeedsErrorState[feed.id] = { status: 'error', detail: `Could not load news-cache.json. Error: ${message}` };
            });
            setFeedHealth(allFeedsErrorState);
            setIsCheckingAll(false);
            return;
        }

        // Sequentially check feeds to avoid rate limiting or browser connection limits.
        for (const feed of feeds) {
            await checkFeedHealth(feed, sourcesInCache);
        }
        setIsCheckingAll(false);
    }, [feeds, checkFeedHealth]);


    return (
        <div className="min-h-screen bg-slate-100 dark:bg-zinc-900 text-slate-800 dark:text-zinc-200 animate-fade-in">
            <header className="bg-white/70 dark:bg-zinc-900/70 backdrop-blur-lg sticky top-0 z-20 border-b border-slate-200 dark:border-zinc-800">
                <div className="container mx-auto px-4 md:px-6 py-3 flex justify-between items-center">
                    <h1 className="text-2xl font-bold text-indigo-500 dark:text-indigo-400">Admin Panel</h1>
                    <a href="/" className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-slate-200 dark:bg-zinc-700 border-transparent text-slate-600 dark:text-zinc-300 hover:bg-slate-300 dark:hover:bg-zinc-600">
                        <ArrowLeftIcon className="w-5 h-5"/> <span>Back to App</span>
                    </a>
                </div>
            </header>
            <main className="container mx-auto p-4 md:p-6">
                <MissingFeedsWarning missingFeeds={missingFeeds} />
                <nav className="mb-6 border-b border-slate-200 dark:border-zinc-700" role="tablist" aria-label="Admin Sections">
                    <div className="flex items-center space-x-2">
                        <TabButton
                            isActive={activeTab === 'management'}
                            onClick={() => setActiveTab('management')}
                            icon={<NewspaperIcon className="w-5 h-5" />}
                            label="Feed Management"
                        />
                        <TabButton
                            isActive={activeTab === 'health'}
                            onClick={() => setActiveTab('health')}
                            icon={<HeartbeatIcon className="w-5 h-5" />}
                            label="Health Center"
                        />
                        <TabButton
                            isActive={activeTab === 'legend'}
                            onClick={() => setActiveTab('legend')}
                            icon={<QuestionMarkCircleIcon className="w-5 h-5" />}
                            label="Health Legend"
                        />
                    </div>
                </nav>

                <div role="tabpanel" hidden={activeTab !== 'management'}>
                    <FeedManagementTab
                        feeds={feeds}
                        feedHealth={feedHealth}
                        onAddNew={handleAddNew}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onCheckHealth={handleCheckSingleFeed}
                    />
                </div>
                <div role="tabpanel" hidden={activeTab !== 'health'}>
                    <HealthCenterTab
                        feeds={feeds}
                        feedHealth={feedHealth}
                        onCheckHealth={handleCheckSingleFeed}
                        onCheckAll={checkAllFeeds}
                        isCheckingAll={isCheckingAll}
                    />
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

            {feedToDelete && (<>
                <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setFeedToDelete(null)} aria-hidden="true" />
                <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-slate-100 dark:bg-zinc-900 rounded-2xl shadow-2xl p-6" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title">
                    <h2 id="delete-dialog-title" className="text-lg font-bold">Delete Feed Source</h2>
                    <p className="text-sm text-slate-600 dark:text-zinc-400 mt-2">Are you sure you want to delete "{feedToDelete.name}"? This cannot be undone.</p>
                    <div className="mt-6 flex justify-end gap-3">
                        <button onClick={() => setFeedToDelete(null)} className="px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-slate-200 dark:bg-zinc-700 text-slate-800 dark:text-zinc-200 hover:bg-slate-300 dark:hover:bg-zinc-600">Cancel</button>
                        <button onClick={confirmDelete} className="px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-red-600 text-white hover:bg-red-700">Delete</button>
                    </div>
                </div>
            </>)}
        </div>
    );
};