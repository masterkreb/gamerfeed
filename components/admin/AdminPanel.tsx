import React, { useState, useCallback, useEffect } from 'react';
import { useFeeds } from '../../hooks/useFeeds';
import type { FeedSource } from '../../types';
import {
    ArrowLeftIcon,
    NewspaperIcon,
    HeartbeatIcon,
    QuestionMarkCircleIcon,
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


export const AdminPanel: React.FC = () => {
    const { feeds, addFeed, updateFeed, deleteFeed } = useFeeds();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingFeed, setEditingFeed] = useState<FeedSource | null>(null);
    const [feedToDelete, setFeedToDelete] = useState<FeedSource | null>(null);
    const [feedHealth, setFeedHealth] = useState<FeedHealth>({});
    const [activeTab, setActiveTab] = useState<AdminTab>('management');

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
    const checkFeedHealth = useCallback(async (feed: FeedSource) => {
        setFeedHealth(prev => ({ ...prev, [feed.id]: { status: 'checking', detail: 'Initiating check...' } }));
        const result = await checkFeedHealthService(feed);
        setFeedHealth(prev => ({ ...prev, [feed.id]: result }));
    }, []);

    const checkAllFeeds = useCallback(async () => {
        // Sequentially check feeds to avoid rate limiting or browser connection limits.
        for (const feed of feeds) {
            await checkFeedHealth(feed);
        }
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