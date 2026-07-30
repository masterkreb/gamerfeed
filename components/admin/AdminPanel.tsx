import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeeds } from '../../hooks/useFeeds';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import type { FeedSource, FeedHeartbeat, HealthDataResponse } from '../../types';
import {
    ArrowLeftIcon,
    NewspaperIcon,
    HeartbeatIcon,
    QuestionMarkCircleIcon,
    WarningIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    MegaphoneIcon,
    LoadingSpinner,
} from '../Icons';
import { FeedFormModal } from './FeedFormModal';
import { FeedManagementTab } from './FeedManagementTab';
import { HealthCenterTab } from './HealthCenterTab';
import { HealthLegendTab } from './HealthLegendTab';
import { AnnouncementTab } from './AnnouncementTab';
import type { HealthState } from './healthTypes';

// Types
type AdminTab = 'management' | 'health' | 'legend' | 'announcement';
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

const FeedLoadState: React.FC<{
    isLoading: boolean;
    onRetry: () => Promise<void>;
}> = ({ isLoading, onRetry }) => {
    const { t } = useTranslation();

    if (isLoading) {
        return (
            <section
                role="status"
                aria-live="polite"
                className="bg-white dark:bg-zinc-800 rounded-lg shadow p-10 flex flex-col items-center justify-center text-center"
            >
                <LoadingSpinner className="w-8 h-8 text-indigo-500" />
                <p className="mt-4 font-semibold">{t('admin.feedsLoading')}</p>
            </section>
        );
    }

    return (
        <section
            role="alert"
            className="bg-white dark:bg-zinc-800 rounded-lg shadow p-8 flex flex-col items-center justify-center text-center"
        >
            <WarningIcon className="w-10 h-10 text-red-500" />
            <h2 className="mt-4 text-lg font-semibold">{t('admin.feedsLoadErrorTitle')}</h2>
            <p className="mt-2 max-w-xl text-sm text-slate-600 dark:text-zinc-400">
                {t('admin.feedsLoadErrorDescription')}
            </p>
            <button
                type="button"
                onClick={() => void onRetry()}
                className="mt-5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
                {t('admin.retry')}
            </button>
        </section>
    );
};

export const AdminPanel: React.FC = () => {
    const { t } = useTranslation();
    const {
        feeds,
        loadStatus,
        reloadFeeds,
        addFeed,
        updateFeed,
        deleteFeed,
    } = useFeeds();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingFeed, setEditingFeed] = useState<FeedSource | null>(null);
    const [feedToDelete, setFeedToDelete] = useState<FeedSource | null>(null);
    const [isDeletingFeed, setIsDeletingFeed] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const deleteCancelButtonRef = useRef<HTMLButtonElement>(null);
    const addFeedButtonRef = useRef<HTMLButtonElement>(null);
    const [feedHealth, setFeedHealth] = useState<FeedHealth>({});
    const [heartbeat, setHeartbeat] = useState<FeedHeartbeat | null>(null);
    const [activeTab, setActiveTab] = useState<AdminTab>('management');
    const [isCheckingAll, setIsCheckingAll] = useState(false);

    // State for alert box visibility
    const [isErrorsExpanded, setIsErrorsExpanded] = useState(true);
    const [isWarningsExpanded, setIsWarningsExpanded] = useState(true);

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


    const failingFeeds = useMemo(() => {
        return feeds.filter(feed => feedHealth[feed.id]?.status === 'error')
            .sort((a,b) => a.name.localeCompare(b.name));
    }, [feeds, feedHealth]);

    const warningFeeds = useMemo(() => {
        return feeds.filter(feed => feedHealth[feed.id]?.status === 'warning')
            .sort((a,b) => a.name.localeCompare(b.name));
    }, [feeds, feedHealth]);

    const handleAddNew = () => { setEditingFeed(null); setIsModalOpen(true); };
    const handleEdit = (feed: FeedSource) => { setEditingFeed(feed); setIsModalOpen(true); };
    const handleDelete = (feed: FeedSource) => {
        setDeleteError(null);
        setFeedToDelete(feed);
    };

    const closeDeleteDialog = () => {
        if (!isDeletingFeed) {
            setFeedToDelete(null);
            setDeleteError(null);
        }
    };

    const deleteDialogRef = useDialogFocus<HTMLDivElement>({
        isOpen: feedToDelete !== null,
        onClose: closeDeleteDialog,
        canClose: !isDeletingFeed,
        initialFocusRef: deleteCancelButtonRef,
        fallbackFocusRef: addFeedButtonRef,
    });

    const confirmDelete = async () => {
        if (feedToDelete && !isDeletingFeed) {
            const targetFeed = feedToDelete;
            setIsDeletingFeed(true);
            setDeleteError(null);

            try {
                await deleteFeed(targetFeed.id);
                setFeedHealth(prev => {
                    const newHealth = { ...prev };
                    delete newHealth[targetFeed.id];
                    return newHealth;
                });
                setFeedToDelete(null);
            } catch (error) {
                console.error('Error deleting feed:', error);
                setDeleteError(t('admin.deleteError'));
            } finally {
                setIsDeletingFeed(false);
            }
        }
    };

    // Health Check Logic
    const refreshHealthStatus = useCallback(async () => {
        setIsCheckingAll(true);
        try {
            const response = await fetch(`/api/get-health-data?t=${Date.now()}`);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Could not fetch health data: ${response.statusText}` }));
                throw new Error(errorData.error);
            }

            const {
                healthStatus: backendHealth,
                sourcesInCache: sourcesInCacheArray,
                heartbeat: backendHeartbeat,
            } = await response.json() as HealthDataResponse;

            const sourcesInCache = new Set(sourcesInCacheArray);
            setHeartbeat(backendHeartbeat ?? null);

            // Debug logging to help identify naming mismatches
            console.log('🔍 Health Check Debug Info:');
            console.log('  Sources in cache:', Array.from(sourcesInCache));
            console.log('  Feeds being checked:', feeds.map(f => ({ id: f.id, name: f.name })));

            const newHealthState: FeedHealth = {};
            feeds.forEach(feed => {
                const backendStatus = backendHealth[feed.id];

                // Case 1: Feed not in backend health status
                if (!backendStatus) {
                    newHealthState[feed.id] = {
                        status: 'error',
                        detail: t('admin.health.detailNotProcessed')
                    };
                    return;
                }

                // Case 2: Feed steht im Status, wurde aber nicht verarbeitet –
                // etwa weil der Lauf vorher abgebrochen ist.
                if (backendStatus.status === 'unknown') {
                    newHealthState[feed.id] = {
                        status: 'unknown',
                        detail: t('admin.health.detailNotProcessed')
                    };
                    return;
                }

                // Case 3: Backend reported an error
                if (backendStatus.status === 'error') {
                    newHealthState[feed.id] = {
                        status: 'error',
                        detail: t('admin.health.detailBackendError', { message: backendStatus.message })
                    };
                    return;
                }

                // Case 4: Backend was successful or has warning
                if (backendStatus.status === 'success' || backendStatus.status === 'warning') {
                    // First try exact match
                    let isInCache = sourcesInCache.has(feed.name);

                    // If no exact match, try fuzzy matching
                    if (!isInCache) {
                        const normalizedFeedName = feed.name.toLowerCase().replace(/[\s.]+/g, '');
                        isInCache = Array.from(sourcesInCache).some(source =>
                            source.toLowerCase().replace(/[\s.]+/g, '') === normalizedFeedName
                        );

                        if (isInCache) {
                            console.warn(`⚠️ Feed "${feed.name}" found in cache with fuzzy matching. Consider updating the database name to match exactly.`);
                        }
                    }

                    if (isInCache) {
                        newHealthState[feed.id] = {
                            status: 'ok',
                            detail: t('admin.health.detailOk')
                        };
                    } else {
                        newHealthState[feed.id] = {
                            status: 'warning',
                            detail: t('admin.health.detailWarningNotInCache', { feedName: feed.name })
                        };
                    }
                }
            });

            setFeedHealth(newHealthState);
            console.log('✅ Health check completed successfully');

        } catch (error) {
            const message = error instanceof Error ? error.message : "An unknown error occurred";
            console.error("❌ Error refreshing health status:", error);

            // Ohne frische Antwort ist auch der Heartbeat nicht mehr belegt.
            setHeartbeat(null);

            const errorState: FeedHealth = {};
            feeds.forEach(feed => {
                errorState[feed.id] = {
                    status: 'error',
                    detail: t('admin.health.detailFetchError', { message })
                };
            });
            setFeedHealth(errorState);
        } finally {
            setIsCheckingAll(false);
        }
    }, [feeds, t]);

    useEffect(() => {
        if(feeds.length > 0) {
            refreshHealthStatus();
        }
    }, [feeds.length]);


    return (
        <div className="min-h-screen bg-slate-100 dark:bg-zinc-900 text-slate-800 dark:text-zinc-200 animate-fade-in">
            <header className="bg-white/70 dark:bg-zinc-900/70 backdrop-blur-lg sticky top-0 z-20 border-b border-slate-200 dark:border-zinc-800">
                <div className="container mx-auto px-4 md:px-6 py-3 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <h1 className="text-2xl font-bold text-indigo-500 dark:text-indigo-400">{t('admin.panelTitle')}</h1>
                    </div>
                    <a href="/" className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-slate-200 dark:bg-zinc-700 border-transparent text-slate-600 dark:text-zinc-300 hover:bg-slate-300 dark:hover:bg-zinc-600">
                        <ArrowLeftIcon className="w-5 h-5"/> <span>{t('admin.backToApp')}</span>
                    </a>
                </div>
            </header>
            <main className="container mx-auto p-4 md:p-6">

                {failingFeeds.length > 0 && (
                    <div className={`bg-red-100 dark:bg-red-900/30 border-l-4 border-red-500 text-red-800 dark:text-red-200 p-4 rounded-lg mb-6 animate-fade-in ${isCheckingAll ? 'animate-pulse' : ''}`}>
                        <div className="flex items-start">
                            <div className="flex-shrink-0 mt-0.5">
                                <WarningIcon className="w-6 h-6 text-red-500" />
                            </div>
                            <div className="ml-3 flex-1">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-lg font-medium">
                                        {t('admin.failedFeedsTitle', { count: failingFeeds.length })}
                                    </h3>
                                    <button onClick={() => setIsErrorsExpanded(!isErrorsExpanded)} className="p-2 -m-2 rounded-full hover:bg-red-200 dark:hover:bg-red-800/50" aria-expanded={isErrorsExpanded}>
                                        {isErrorsExpanded ? <ChevronUpIcon className="w-5 h-5" /> : <ChevronDownIcon className="w-5 h-5" />}
                                    </button>
                                </div>
                                {isErrorsExpanded && (
                                    <div className="mt-2 text-sm">
                                        <p>{t('admin.failedFeedsDesc')}</p>
                                        <ul className="list-none mt-3 space-y-2 text-xs">
                                            {failingFeeds.map(feed => (
                                                <li key={feed.id} className="font-mono p-2 bg-slate-50 dark:bg-zinc-800/30 rounded">
                                                    <p className="font-sans font-semibold text-base mr-2">{feed.name}</p>
                                                    <p className="text-xs text-slate-500 dark:text-zinc-400 truncate mt-1" title={feed.url}>{feed.url}</p>
                                                    <p className="mt-1 text-red-700 dark:text-red-300 font-sans">{feedHealth[feed.id]?.detail}</p>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {warningFeeds.length > 0 && (
                    <div className={`bg-amber-100 dark:bg-amber-900/30 border-l-4 border-amber-500 text-amber-800 dark:text-amber-200 p-4 rounded-lg mb-6 animate-fade-in ${isCheckingAll ? 'animate-pulse' : ''}`}>
                        <div className="flex items-start">
                            <div className="flex-shrink-0 mt-0.5">
                                <WarningIcon className="w-6 h-6 text-amber-500" />
                            </div>
                            <div className="ml-3 flex-1">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-lg font-medium">
                                        {t('admin.warningFeedsTitle', { count: warningFeeds.length })}
                                    </h3>
                                    <button onClick={() => setIsWarningsExpanded(!isWarningsExpanded)} className="p-2 -m-2 rounded-full hover:bg-amber-200 dark:hover:bg-amber-800/50" aria-expanded={isWarningsExpanded}>
                                        {isWarningsExpanded ? <ChevronUpIcon className="w-5 h-5" /> : <ChevronDownIcon className="w-5 h-5" />}
                                    </button>
                                </div>
                                {isWarningsExpanded && (
                                    <div className="mt-2 text-sm">
                                        <p>{t('admin.warningFeedsDesc')}</p>
                                        <ul className="list-none mt-3 space-y-2 text-xs">
                                            {warningFeeds.map(feed => (
                                                <li key={feed.id} className="font-mono p-2 bg-slate-50 dark:bg-zinc-800/30 rounded">
                                                    <p className="font-sans font-semibold text-base mr-2">{feed.name}</p>
                                                    <p className="text-xs text-slate-500 dark:text-zinc-400 truncate mt-1" title={feed.url}>{feed.url}</p>
                                                    <p className="mt-1 text-amber-700 dark:text-amber-300 font-sans">{feedHealth[feed.id]?.detail}</p>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                <nav className="mb-6 border-b border-slate-200 dark:border-zinc-700" role="tablist" aria-label={t('admin.tabsLabel')}>
                    <div className="flex items-center space-x-2 overflow-x-auto">
                        <TabButton isActive={activeTab === 'management'} onClick={() => setActiveTab('management')} icon={<NewspaperIcon className="w-5 h-5" />} label={t('admin.tabManagement')} />
                        <TabButton isActive={activeTab === 'health'} onClick={() => setActiveTab('health')} icon={<HeartbeatIcon className="w-5 h-5" />} label={t('admin.tabHealth')} />
                        <TabButton isActive={activeTab === 'announcement'} onClick={() => setActiveTab('announcement')} icon={<MegaphoneIcon className="w-5 h-5" />} label={t('admin.tabAnnouncement')} />
                        <TabButton isActive={activeTab === 'legend'} onClick={() => setActiveTab('legend')} icon={<QuestionMarkCircleIcon className="w-5 h-5" />} label={t('admin.tabLegend')} />
                    </div>
                </nav>

                <div role="tabpanel" hidden={activeTab !== 'management'}>
                    {loadStatus === 'ready' ? (
                        <FeedManagementTab
                            feeds={feeds}
                            feedHealth={feedHealth}
                            addButtonRef={addFeedButtonRef}
                            onAddNew={handleAddNew}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onCheckHealth={refreshHealthStatus}
                        />
                    ) : (
                        <FeedLoadState
                            isLoading={loadStatus === 'loading'}
                            onRetry={reloadFeeds}
                        />
                    )}
                </div>
                <div role="tabpanel" hidden={activeTab !== 'health'}>
                    {loadStatus === 'ready' ? (
                        <HealthCenterTab
                            feeds={feeds}
                            feedHealth={feedHealth}
                            heartbeat={heartbeat}
                            onCheckAll={refreshHealthStatus}
                            isCheckingAll={isCheckingAll}
                        />
                    ) : (
                        <FeedLoadState
                            isLoading={loadStatus === 'loading'}
                            onRetry={reloadFeeds}
                        />
                    )}
                </div>
                <div role="tabpanel" hidden={activeTab !== 'announcement'}>
                    <AnnouncementTab />
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
                <div className="fixed inset-0 bg-black/60 z-40" onClick={closeDeleteDialog} aria-hidden="true" />
                <div
                    ref={deleteDialogRef}
                    className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-slate-100 dark:bg-zinc-900 rounded-2xl shadow-2xl p-6"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="delete-dialog-title"
                    aria-describedby={deleteError
                        ? 'delete-dialog-description delete-dialog-error'
                        : 'delete-dialog-description'}
                    aria-busy={isDeletingFeed}
                    tabIndex={-1}
                >
                    <h2 id="delete-dialog-title" className="text-lg font-bold">{t('admin.deleteModalTitle')}</h2>
                    <p id="delete-dialog-description" className="text-sm text-slate-600 dark:text-zinc-400 mt-2">{t('admin.deleteModalConfirm', { name: feedToDelete.name })}</p>
                    {deleteError && (
                        <div
                            id="delete-dialog-error"
                            role="alert"
                            className="mt-4 p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 text-sm"
                        >
                            {deleteError}
                        </div>
                    )}
                    <div className="mt-6 flex justify-end gap-3">
                        <button ref={deleteCancelButtonRef} onClick={closeDeleteDialog} disabled={isDeletingFeed} className="px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-slate-200 dark:bg-zinc-700 text-slate-800 dark:text-zinc-200 hover:bg-slate-300 dark:hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed">{t('admin.cancel')}</button>
                        <button onClick={() => void confirmDelete()} disabled={isDeletingFeed} className="px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
                            {isDeletingFeed ? t('admin.deleting') : t('admin.delete')}
                        </button>
                    </div>
                </div>
            </>)}
        </div>
    );
};
