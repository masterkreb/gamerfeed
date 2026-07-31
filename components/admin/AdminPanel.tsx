import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFeeds } from '../../hooks/useFeeds';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useMutationLatch } from '../../hooks/useMutationLatch';
import type { FeedSource, FeedHeartbeat, FeedRunHistoryEntry, HealthDataResponse } from '../../types';
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
import {
    buildAdminHealthReport,
    buildUnavailableHealthReport,
    type AdminHealthReport,
} from '../../services/admin-health-report';
import {
    LOCAL_NEWS_CACHE_KEY,
    readLocalNewsCache,
    type LocalNewsCacheState,
} from '../../shared/local-news-cache';

// Types
type AdminTab = 'management' | 'health' | 'announcement' | 'legend';
export type FeedHealth = Record<string, HealthState>;

const ADMIN_TABS: { id: AdminTab; labelKey: string }[] = [
    { id: 'management', labelKey: 'admin.tabManagement' },
    { id: 'health', labelKey: 'admin.tabHealth' },
    { id: 'announcement', labelKey: 'admin.tabAnnouncement' },
    { id: 'legend', labelKey: 'admin.tabLegend' },
];

const TAB_ICONS: Record<AdminTab, React.ReactNode> = {
    management: <NewspaperIcon className="w-5 h-5" />,
    health: <HeartbeatIcon className="w-5 h-5" />,
    announcement: <MegaphoneIcon className="w-5 h-5" />,
    legend: <QuestionMarkCircleIcon className="w-5 h-5" />,
};

const getTabId = (tab: AdminTab) => `admin-tab-${tab}`;
const getPanelId = (tab: AdminTab) => `admin-panel-${tab}`;

/**
 * Liest die lokale Artikelkopie des Frontends. Das Admin liegt auf derselben
 * Herkunft und sieht deshalb genau den Stand, mit dem der Browser arbeitet.
 */
function readLocalCacheState(): LocalNewsCacheState {
    if (typeof window === 'undefined') {
        return { status: 'missing' };
    }

    try {
        return readLocalNewsCache(window.localStorage.getItem(LOCAL_NEWS_CACHE_KEY), Date.now());
    } catch {
        // Ein blockierter Speicher ist kein leerer Speicher.
        return { status: 'unreadable' };
    }
}

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
    const { isMutating: isDeletingFeed, runExclusive: runFeedDeletion } = useMutationLatch();
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const deleteCancelButtonRef = useRef<HTMLButtonElement>(null);
    const addFeedButtonRef = useRef<HTMLButtonElement>(null);
    const [heartbeat, setHeartbeat] = useState<FeedHeartbeat | null>(null);
    // O4b: `null` heisst nicht lesbar, `[]` heisst gelesen und noch leer. Beide
    // Faelle sind unterscheidbar und werden im Health Center getrennt benannt.
    const [runHistory, setRunHistory] = useState<FeedRunHistoryEntry[] | null>(null);
    const [activeTab, setActiveTab] = useState<AdminTab>('management');
    const [isReloadingReport, setIsReloadingReport] = useState(false);
    const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

    /** Zuletzt gelesener gespeicherter Statusbericht; `null` vor dem Laden. */
    const [storedReport, setStoredReport] = useState<{
        backendHealth: HealthDataResponse['healthStatus'];
        sourcesInCache: string[] | null;
        activeSnapshot: HealthDataResponse['snapshot'];
    } | null>(null);
    const [isReportUnavailable, setIsReportUnavailable] = useState(false);
    const [localCache, setLocalCache] = useState<LocalNewsCacheState>(readLocalCacheState);

    // State for alert box visibility
    const [isErrorsExpanded, setIsErrorsExpanded] = useState(true);
    const [isWarningsExpanded, setIsWarningsExpanded] = useState(true);

    const healthReport: AdminHealthReport = useMemo(() => {
        if (isReportUnavailable) {
            return buildUnavailableHealthReport(feeds, localCache);
        }

        return buildAdminHealthReport({
            feeds,
            backendHealth: storedReport?.backendHealth ?? null,
            sourcesInCache: storedReport?.sourcesInCache ?? null,
            activeSnapshot: storedReport?.activeSnapshot ?? null,
            localCache,
        });
    }, [feeds, isReportUnavailable, localCache, storedReport]);

    // Die Feed-Verwaltung zeigt nur Symbol und Kurztext; die Übersetzung
    // passiert deshalb erst hier, nicht in der reinen Ableitung.
    const feedHealth = useMemo<FeedHealth>(() => Object.fromEntries(
        healthReport.rows.map(row => [row.feedId, {
            status: row.status,
            detail: t(row.detailKey, row.detailParams),
        }]),
    ), [healthReport, t]);

    const failingFeeds = useMemo(() => (
        feeds.filter(feed => feedHealth[feed.id]?.status === 'error')
            .sort((a, b) => a.name.localeCompare(b.name))
    ), [feeds, feedHealth]);

    const warningFeeds = useMemo(() => (
        feeds.filter(feed => feedHealth[feed.id]?.status === 'warning')
            .sort((a, b) => a.name.localeCompare(b.name))
    ), [feeds, feedHealth]);

    const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        const lastIndex = ADMIN_TABS.length - 1;
        let nextIndex: number | null = null;

        if (event.key === 'ArrowRight') {
            nextIndex = index === lastIndex ? 0 : index + 1;
        } else if (event.key === 'ArrowLeft') {
            nextIndex = index === 0 ? lastIndex : index - 1;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = lastIndex;
        }

        if (nextIndex === null) return;

        event.preventDefault();
        setActiveTab(ADMIN_TABS[nextIndex].id);
        tabRefs.current[nextIndex]?.focus();
    };

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
        const targetFeed = feedToDelete;
        if (!targetFeed) {
            return;
        }

        // Der Latch wird synchron gesetzt, damit ein zweiter Klick im selben
        // Render-Zyklus kein zweites DELETE auslöst.
        await runFeedDeletion(async () => {
            setDeleteError(null);

            try {
                // Der Statusbericht ist eine Ableitung aus der Feed-Liste; ein
                // gelöschter Feed verschwindet daraus von selbst.
                await deleteFeed(targetFeed.id);
                setFeedToDelete(null);
            } catch (error) {
                // Feed und Bestätigungsdialog bleiben erhalten; der interne
                // Fehlertext geht nur ins Log.
                console.error('Error deleting feed:', error);
                setDeleteError(t('admin.deleteError'));
            }
        });
    };

    /**
     * Lädt den **gespeicherten** Statusbericht des letzten Cron-Laufs erneut.
     *
     * Es wird bewusst kein RSS-Feed abgerufen und kein Workflow gestartet; die
     * Oberfläche darf deshalb auch keine Einzelprüfung behaupten.
     */
    const reloadStoredReport = useCallback(async () => {
        setIsReloadingReport(true);
        // Die lokale Kopie kann sich im Frontend-Tab geändert haben.
        setLocalCache(readLocalCacheState());

        try {
            const response = await fetch(`/api/get-health-data?t=${Date.now()}`);

            if (!response.ok) {
                throw new Error(`Health request failed with status ${response.status}`);
            }

            const {
                healthStatus,
                sourcesInCache,
                heartbeat: backendHeartbeat,
                snapshot,
                runHistory: backendRunHistory,
            } = await response.json() as HealthDataResponse;

            setHeartbeat(backendHeartbeat ?? null);
            // Eine fehlende oder unbrauchbare Historie bleibt `null`; ein
            // geratenes `[]` wuerde eine leere Historie behaupten.
            setRunHistory(Array.isArray(backendRunHistory) ? backendRunHistory : null);
            setStoredReport({
                backendHealth: healthStatus ?? {},
                sourcesInCache: Array.isArray(sourcesInCache) ? sourcesInCache : null,
                activeSnapshot: snapshot ?? null,
            });
            setIsReportUnavailable(false);
        } catch (error) {
            // Der interne Text bleibt im Log; die Oberfläche zeigt eine
            // lokalisierte Meldung.
            console.error('Error reloading the stored health report:', error);

            // Ohne frische Antwort sind auch Heartbeat und Historie nicht mehr
            // belegt.
            setHeartbeat(null);
            setRunHistory(null);
            setStoredReport(null);
            setIsReportUnavailable(true);
        } finally {
            setIsReloadingReport(false);
        }
    }, []);

    useEffect(() => {
        if (feeds.length > 0) {
            void reloadStoredReport();
        }
    }, [feeds.length, reloadStoredReport]);


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
                    <div className={`bg-red-100 dark:bg-red-900/30 border-l-4 border-red-500 text-red-800 dark:text-red-200 p-4 rounded-lg mb-6 animate-fade-in ${isReloadingReport ? 'animate-pulse' : ''}`}>
                        <div className="flex items-start">
                            <div className="flex-shrink-0 mt-0.5">
                                <WarningIcon className="w-6 h-6 text-red-500" />
                            </div>
                            <div className="ml-3 flex-1">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-lg font-medium">
                                        {t('admin.failedFeedsTitle', { count: failingFeeds.length })}
                                    </h3>
                                    <button
                                        type="button"
                                        onClick={() => setIsErrorsExpanded(!isErrorsExpanded)}
                                        className="p-2 -m-2 rounded-full hover:bg-red-200 dark:hover:bg-red-800/50"
                                        aria-expanded={isErrorsExpanded}
                                        aria-controls="admin-failed-feeds-details"
                                        aria-label={isErrorsExpanded
                                            ? t('admin.failedFeedsHide')
                                            : t('admin.failedFeedsShow')}
                                    >
                                        {isErrorsExpanded ? <ChevronUpIcon className="w-5 h-5" /> : <ChevronDownIcon className="w-5 h-5" />}
                                    </button>
                                </div>
                                {/* Immer gerendert: `aria-controls` darf nicht auf eine
                                    fehlende ID zeigen. */}
                                <div id="admin-failed-feeds-details" className="mt-2 text-sm" hidden={!isErrorsExpanded}>
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
                            </div>
                        </div>
                    </div>
                )}

                {warningFeeds.length > 0 && (
                    <div className={`bg-amber-100 dark:bg-amber-900/30 border-l-4 border-amber-500 text-amber-800 dark:text-amber-200 p-4 rounded-lg mb-6 animate-fade-in ${isReloadingReport ? 'animate-pulse' : ''}`}>
                        <div className="flex items-start">
                            <div className="flex-shrink-0 mt-0.5">
                                <WarningIcon className="w-6 h-6 text-amber-500" />
                            </div>
                            <div className="ml-3 flex-1">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-lg font-medium">
                                        {t('admin.warningFeedsTitle', { count: warningFeeds.length })}
                                    </h3>
                                    <button
                                        type="button"
                                        onClick={() => setIsWarningsExpanded(!isWarningsExpanded)}
                                        className="p-2 -m-2 rounded-full hover:bg-amber-200 dark:hover:bg-amber-800/50"
                                        aria-expanded={isWarningsExpanded}
                                        aria-controls="admin-warning-feeds-details"
                                        aria-label={isWarningsExpanded
                                            ? t('admin.warningFeedsHide')
                                            : t('admin.warningFeedsShow')}
                                    >
                                        {isWarningsExpanded ? <ChevronUpIcon className="w-5 h-5" /> : <ChevronDownIcon className="w-5 h-5" />}
                                    </button>
                                </div>
                                <div id="admin-warning-feeds-details" className="mt-2 text-sm" hidden={!isWarningsExpanded}>
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
                            </div>
                        </div>
                    </div>
                )}

                <nav className="mb-6 border-b border-slate-200 dark:border-zinc-700">
                    <div className="flex items-center space-x-2 overflow-x-auto" role="tablist" aria-label={t('admin.tabsLabel')}>
                        {ADMIN_TABS.map((tab, index) => (
                            <button
                                key={tab.id}
                                ref={element => { tabRefs.current[index] = element; }}
                                type="button"
                                id={getTabId(tab.id)}
                                role="tab"
                                aria-selected={activeTab === tab.id}
                                aria-controls={getPanelId(tab.id)}
                                // Roving tabIndex: nur der aktive Reiter liegt in der
                                // Tab-Reihenfolge, innerhalb der Leiste wird mit den
                                // Pfeiltasten navigiert.
                                tabIndex={activeTab === tab.id ? 0 : -1}
                                onClick={() => setActiveTab(tab.id)}
                                onKeyDown={event => handleTabKeyDown(event, index)}
                                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
                                    activeTab === tab.id
                                        ? 'text-indigo-600 dark:text-indigo-400 border-indigo-500'
                                        : 'text-slate-500 dark:text-zinc-400 border-transparent hover:border-slate-300 dark:hover:border-zinc-600 hover:text-slate-700 dark:hover:text-zinc-200'
                                }`}
                            >
                                {TAB_ICONS[tab.id]}
                                {t(tab.labelKey)}
                            </button>
                        ))}
                    </div>
                </nav>

                <div
                    id={getPanelId('management')}
                    role="tabpanel"
                    aria-labelledby={getTabId('management')}
                    hidden={activeTab !== 'management'}
                >
                    {loadStatus === 'ready' ? (
                        <FeedManagementTab
                            feeds={feeds}
                            feedHealth={feedHealth}
                            addButtonRef={addFeedButtonRef}
                            onAddNew={handleAddNew}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                        />
                    ) : (
                        <FeedLoadState
                            isLoading={loadStatus === 'loading'}
                            onRetry={reloadFeeds}
                        />
                    )}
                </div>
                <div
                    id={getPanelId('health')}
                    role="tabpanel"
                    aria-labelledby={getTabId('health')}
                    hidden={activeTab !== 'health'}
                >
                    {loadStatus === 'ready' ? (
                        <HealthCenterTab
                            report={healthReport}
                            heartbeat={heartbeat}
                            runHistory={runHistory}
                            onReloadReport={reloadStoredReport}
                            isReloadingReport={isReloadingReport}
                        />
                    ) : (
                        <FeedLoadState
                            isLoading={loadStatus === 'loading'}
                            onRetry={reloadFeeds}
                        />
                    )}
                </div>
                <div
                    id={getPanelId('announcement')}
                    role="tabpanel"
                    aria-labelledby={getTabId('announcement')}
                    hidden={activeTab !== 'announcement'}
                >
                    <AnnouncementTab />
                </div>
                <div
                    id={getPanelId('legend')}
                    role="tabpanel"
                    aria-labelledby={getTabId('legend')}
                    hidden={activeTab !== 'legend'}
                    // Reiner Text ohne Bedienelemente: ohne tabIndex wäre der
                    // Bereich per Tastatur weder erreichbar noch scrollbar.
                    tabIndex={0}
                >
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
