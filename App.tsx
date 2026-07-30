import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Header } from './components/Header';
import { FilterBar } from './components/FilterBar';
import { ArticleCard } from './components/ArticleCard';
import { TrendsView } from './components/TrendsView';
import { useLocalStorage } from './hooks/useLocalStorage';
import type { Article, Theme, ViewMode, AppView, Announcement, CachedNews, NewsSnapshotPointer } from './types';
import { LoadingSpinner, SearchIcon, FilterIcon, ResetIcon, NewspaperIcon, BookmarkIcon, StarIcon, ArrowLeftIcon } from './components/Icons';
import { FilterProvider, useFilter } from './contexts/FilterContext';
import { ScrollToTopButton } from './components/ScrollToTopButton';
import { FavoritesHeader } from './components/FavoritesHeader';
import { SettingsModal } from './components/SettingsModal';
import { AnnouncementBanner } from './components/AnnouncementBanner';
import ErrorBoundary from './components/ErrorBoundary';
import { useCookieConsent } from './components/CookieConsent';
import { createAnalyticsLifecycle } from './shared/analytics-lifecycle.js';
import { filterArticles } from './shared/article-filters';
import { createNewsLoadController } from './services/news-load-controller';
import {
    normalizeSnapshotPointer,
    planPendingAdoption,
    planPollResponse,
    readSnapshotHeaders,
    readSnapshotRollback,
} from './shared/news-snapshot.js';
import {
    decodeCachedNews,
    decodeNullableString,
    decodeStringArray,
    decodeTheme,
    decodeViewMode,
} from './shared/persisted-state';
import {
    LOCAL_NEWS_CACHE_KEY,
    LOCAL_NEWS_CACHE_TTL_MS,
} from './shared/local-news-cache';

const ARTICLES_PER_PAGE = 32;
const INITIAL_ARTICLE_CACHE_COUNT = 32;

// Analytics wird erst nach Zustimmung geladen und bei Widerruf wieder
// stillgelegt. Der Lebenszyklus liegt in shared/analytics-lifecycle.js.
const GA_MEASUREMENT_ID = 'G-V2KB8CTWRV';

const analytics = typeof window === 'undefined'
    ? null
    : createAnalyticsLifecycle({ measurementId: GA_MEASUREMENT_ID });

type ToastType = 'info' | 'success';

interface ToastAction {
    label: string;
    onClick: () => void;
}

interface Toast {
    id: number;
    message: string;
    type: ToastType;
    actions: ToastAction[];
    isExiting: boolean;
    isEntering: boolean;
}

const SearchResultsHeader: React.FC<{
    searchQuery: string;
    resultsCount: number;
    onClear: () => void;
    isSearchingFavorites: boolean;
}> = ({ searchQuery, resultsCount, onClear, isSearchingFavorites }) => {
    const { t } = useTranslation();

    const themeClasses = isSearchingFavorites ? {
        bg: 'bg-amber-100 dark:bg-amber-900/30',
        border: 'border-amber-500',
        icon: 'text-amber-500',
        title: 'text-amber-800 dark:text-amber-200',
        text: 'text-amber-700 dark:text-amber-300',
        buttonHover: 'hover:text-amber-600 dark:hover:text-amber-100',
    } : {
        bg: 'bg-indigo-100 dark:bg-indigo-900/30',
        border: 'border-indigo-500',
        icon: 'text-indigo-500',
        title: 'text-indigo-800 dark:text-indigo-200',
        text: 'text-indigo-700 dark:text-indigo-300',
        buttonHover: 'hover:text-indigo-600 dark:hover:text-indigo-100',
    };

    const titleText = isSearchingFavorites ? t('search.titleFavorites') : t('search.title');
    const resultText = t('search.showing', { count: resultsCount });
    const scopeText = isSearchingFavorites ? t('search.inFavorites') : '';

    return (
        <div
            role="status"
            aria-live="polite"
            className={`mt-6 p-4 ${themeClasses.bg} border-l-4 ${themeClasses.border} rounded-r-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 animate-fade-in`}>
            <div className="flex items-center gap-3">
                <SearchIcon className={`w-6 h-6 ${themeClasses.icon}`} />
                <div>
                    <h2 className={`text-lg font-semibold ${themeClasses.title}`}>
                        {titleText}
                    </h2>
                    <p className={`text-sm ${themeClasses.text}`}>
                        {resultText}
                        <span className="font-bold">"{searchQuery}"</span>
                        {scopeText}
                    </p>
                </div>
            </div>
            <button
                onClick={onClear}
                className={`font-semibold underline text-sm p-2 -m-2 rounded-lg ${themeClasses.text} ${themeClasses.buttonHover} transition-colors sm:ml-auto`}
            >
                {t('search.clearSearch')}
            </button>
        </div>
    );
};


const AppContent: React.FC = () => {
    const { t } = useTranslation();
    const [theme, setTheme] = useLocalStorage<Theme>('theme', 'light', decodeTheme);
    const [viewMode, setViewMode] = useLocalStorage<ViewMode>('viewMode', 'grid', decodeViewMode);
    const [favorites, setFavorites] = useLocalStorage<string[]>('favorites', [], decodeStringArray);
    const [mutedSources, setMutedSources] = useLocalStorage<string[]>('mutedSources', [], decodeStringArray);
    const [currentView, setCurrentView] = useState<AppView>('news');

    const [articles, setArticles] = useState<Article[]>([]);
    const articlesRef = useRef<Article[]>([]);
    const [cachedNews, setCachedNews] = useLocalStorage<CachedNews>(
        LOCAL_NEWS_CACHE_KEY,
        { articles: [], timestamp: 0 },
        decodeCachedNews,
    );
    const [isBlockingLoading, setIsBlockingLoading] = useState<boolean>(true);
    const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [backgroundError, setBackgroundError] = useState<string | null>(null);
    const [page, setPage] = useState(1);

    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [toast, setToast] = useState<Toast | null>(null);
    const toastTimerRef = useRef<number | null>(null);
    
    // Toast swipe state - only one direction at a time
    const [toastSwipeOffset, setToastSwipeOffset] = useState(0);
    const [toastSwipeDirection, setToastSwipeDirection] = useState<'x' | 'y' | null>(null);
    const toastTouchStartRef = useRef<{ x: number; y: number } | null>(null);
    const toastRef = useRef<HTMLDivElement>(null);

    // Auto-update state
    const [newArticlesCount, setNewArticlesCount] = useState(0);
    // Ausstehende Artikel und die Generation, aus der sie stammen, gehören
    // zusammen. Getrennt gespeichert könnten sie beim Übernehmen unter einer
    // fremden Kennung landen (Roadmap O3a).
    const [pending, setPending] = useState<{ articles: Article[]; snapshot: NewsSnapshotPointer | null }>({
        articles: [],
        snapshot: null,
    });
    const autoUpdateIntervalRef = useRef<number | null>(null);

    // Announcement state
    const [announcement, setAnnouncement] = useState<Announcement | null>(null);
    const [dismissedAnnouncementId, setDismissedAnnouncementId] = useLocalStorage<string | null>(
        'dismissedAnnouncementId',
        null,
        decodeNullableString,
    );
    const cachedArticlesRef = useRef<Article[]>([]);

    // Gepinnte Cache-Generation (Roadmap O3a). Bewusst eine Ref und kein State:
    // sie steuert nur, welche Antwort uebernommen wird, und darf dafuer kein
    // Rendern ausloesen.
    const pinnedSnapshotRef = useRef<NewsSnapshotPointer | null>(null);

    const validCachedArticles = useMemo(() => {
        const isFresh = Date.now() - cachedNews.timestamp < LOCAL_NEWS_CACHE_TTL_MS;
        return isFresh ? cachedNews.articles : [];
    }, [cachedNews]);

    /**
     * Speichert die lokale Kopie **mit** ihrer Generation.
     *
     * `snapshot` wird ausdrücklich übergeben und nicht aus der gepinnten
     * Generation gelesen: beim Übernehmen ausstehender Artikel gehören die
     * Artikel zu der Generation, aus der sie geholt wurden – nicht zu der,
     * die inzwischen gepinnt sein könnte.
     */
    const persistCachedArticles = useCallback((
        nextArticles: Article[],
        snapshot: NewsSnapshotPointer | null,
    ) => {
        setCachedNews({
            articles: nextArticles.slice(0, INITIAL_ARTICLE_CACHE_COUNT),
            timestamp: Date.now(),
            // Ohne die Generation könnte eine ältere Antwort aus dem
            // Edge-Cache einen neueren lokalen Stand überschreiben - die
            // 30-Minuten-Kopie ist länger gültig als der 60-Sekunden-Cache.
            snapshot,
        });
    }, [setCachedNews]);

    /**
     * Ein einziger Besitzer fuer Preview, Medium, Full und manuellen Refresh.
     *
     * Der Controller prueft nach jeder asynchronen Grenze seine Request-Epoche.
     * Damit kann eine alte Ladekette weder den sichtbaren State noch Pin oder
     * lokale Kopie einer neueren Ladung ueberschreiben (Roadmap F1).
     */
    const newsLoadController = useMemo(() => createNewsLoadController({
        fetchImpl: (input, init) => fetch(input, init),
        getPinnedSnapshot: () => pinnedSnapshotRef.current,
        setPinnedSnapshot: snapshot => {
            pinnedSnapshotRef.current = snapshot;
        },
        commitArticles: (nextArticles, snapshot) => {
            articlesRef.current = nextArticles;
            setArticles(nextArticles);
            persistCachedArticles(nextArticles, snapshot);
        },
        setBlockingLoading: setIsBlockingLoading,
        setRefreshing: setIsRefreshing,
        clearBlockingError: () => setError(null),
        clearBackgroundError: () => setBackgroundError(null),
        reportBlockingError: ({ error: loadError }) => {
            console.error('Failed to fetch articles from API:', loadError);
            setError(loadError.message);
        },
        reportBackgroundError: ({ error: loadError, stage }) => {
            // Hintergrundfehler duerfen bereits sichtbare Artikel nicht durch
            // den blockierenden Fehlerzustand ersetzen.
            console.warn(`Background news loading failed during ${stage}:`, loadError);
            setBackgroundError(loadError.message);
        },
    }), [persistCachedArticles]);

    // Cookie Consent Hook
    const { showPreferences } = useCookieConsent({
        onConsent: useCallback((categories: string[]) => {
            if (categories.includes('analytics')) {
                analytics?.grant();
            } else {
                // Widerruf: weitere Treffer stoppen und Cookies entfernen.
                analytics?.deny();
            }
        }, []),
    });

    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [theme]);

    useEffect(() => {
        if (articles.length === 0 && validCachedArticles.length > 0) {
            // Die lokale Kopie bringt ihre Generation mit. Damit ist der
            // sichtbare Stand von Anfang an gepinnt und eine aeltere Antwort
            // aus dem Edge-Cache kann ihn nicht ersetzen.
            pinnedSnapshotRef.current = normalizeSnapshotPointer(cachedNews.snapshot);
            articlesRef.current = validCachedArticles;
            setArticles(validCachedArticles);
            setIsBlockingLoading(false);
        }
    }, [articles.length, validCachedArticles, cachedNews.snapshot]);

    useEffect(() => {
        articlesRef.current = articles;
    }, [articles]);

    useEffect(() => {
        cachedArticlesRef.current = validCachedArticles;
    }, [validCachedArticles]);

    // Fetch announcement on mount
    useEffect(() => {
        const fetchAnnouncement = async () => {
            try {
                const response = await fetch('/api/announcement');
                if (response.ok) {
                    const data: Announcement | null = await response.json();
                    // Only set if it's a different announcement than the one dismissed
                    if (data && data.id !== dismissedAnnouncementId) {
                        setAnnouncement(data);
                    } else if (data && data.id === dismissedAnnouncementId) {
                        // User dismissed this announcement
                        setAnnouncement(null);
                    } else {
                        setAnnouncement(null);
                    }
                }
            } catch (error) {
                console.warn('Failed to fetch announcement:', error);
            }
        };
        fetchAnnouncement();
    }, [dismissedAnnouncementId]);

    // Handler to dismiss announcement
    const handleDismissAnnouncement = useCallback((id: string) => {
        setDismissedAnnouncementId(id);
        setAnnouncement(null);
    }, [setDismissedAnnouncementId]);

    const loadNews = useCallback((isManualRefresh = false) => (
        newsLoadController.load({
            manualRefresh: isManualRefresh,
            hasVisibleArticles: (
                articlesRef.current.length > 0
                || cachedArticlesRef.current.length > 0
            ),
        })
    ), [newsLoadController]);

    useEffect(() => {
        void loadNews();
        return () => newsLoadController.cancel();
    }, [loadNews, newsLoadController]);

    const handleRefresh = useCallback(() => {
        void loadNews(true);
        // Clear pending articles when manually refreshing
        setNewArticlesCount(0);
        setPending({ articles: [], snapshot: null });
        // Reset tab title
        document.title = 'GamerFeed';
    }, [loadNews]);

    // Check for new articles without updating the view
    const checkForNewArticles = useCallback(async () => {
        const request = newsLoadController.beginPassiveRequest();
        if (!request) return;

        try {
            // Ungebunden: `?snapshot=` setzt eine gewaehlte Generation fort und
            // taugt nicht zur Suche. Gepinnt bekaeme der Poll weiterhin die
            // gepinnte Generation zurueck und meldete nie einen neuen Stand.
            const response = await fetch(
                '/api/get-news',
                { signal: request.signal },
            );
            if (!request.isCurrent() || !response.ok) return;
            
            const fetchedArticles: Article[] = await response.json();
            if (!request.isCurrent()) return;

            // Hier wird **nicht** gepinnt. Der Benutzer hat die Artikel noch
            // nicht übernommen; die gepinnte Generation muss zum *sichtbaren*
            // Stand passen. Sonst könnten ausstehende Artikel aus Generation B
            // später unter einer inzwischen gepinnten Generation C gespeichert
            // werden.
            const incoming = readSnapshotHeaders(response.headers);
            const plan = planPollResponse({
                pinned: pinnedSnapshotRef.current,
                incoming,
                rollback: readSnapshotRollback(response.headers),
            });
            if (!request.isCurrent()) return;

            if (plan.clearPending) {
                // Autoritativer Rollback: eine vorgemerkte Generation ist
                // zurückgezogen. Sie stehen zu lassen hieße, sie später per
                // Klick doch noch einzuspielen. Der sichtbare Stand bleibt
                // unberührt - er wechselt erst beim nächsten Ladevorgang.
                setNewArticlesCount(0);
                setPending({ articles: [], snapshot: null });
                document.title = 'GamerFeed';
                return;
            }

            // Ein älterer Stand darf keine neuen Artikel melden.
            if (!plan.accept) return;
            
            // Get the newest article date from currently loaded articles
            const newestLoadedDate = articles.length > 0 
                ? Math.max(...articles.map(a => new Date(a.publicationDate).getTime()))
                : 0;
            
            // Find articles that are NEWER than our newest loaded article
            // This avoids counting older articles that just weren't loaded yet (progressive loading)
            const trulyNewArticles = fetchedArticles.filter(a => {
                const articleDate = new Date(a.publicationDate).getTime();
                return articleDate > newestLoadedDate;
            });
            
            if (trulyNewArticles.length > 0) {
                // Set count directly (not accumulate) since we're comparing against dates
                setNewArticlesCount(trulyNewArticles.length);
                // Artikel und ihre Generation gemeinsam - sie gehören zusammen.
                setPending({ articles: fetchedArticles, snapshot: incoming });
                // Update tab title
                document.title = `(${trulyNewArticles.length}) GamerFeed`;
                console.log(`🆕 ${trulyNewArticles.length} neue Artikel verfügbar`);
            }
            
        } catch (error) {
            if (request.isCurrent()) {
                console.warn('Auto-update check failed:', error);
            }
        } finally {
            request.release();
        }
    }, [articles, newsLoadController]);

    // Load pending articles (when user clicks the toast or badge)
    const loadPendingArticles = useCallback(() => {
        if (pending.articles.length === 0) return;

        // Der sichtbare Stand wechselt. Ein bereits laufender Poll hat noch den
        // vorherigen Artikel-State in seiner Closure und darf die eben
        // uebernommene Warteschlange nicht gleich erneut vormerken.
        newsLoadController.cancelPassiveRequests();

        // Zwischen dem Vormerken und diesem Klick können Minuten liegen - genug
        // Zeit, damit der sichtbare Stand längst weiter ist. Die Warteschlange
        // wird deshalb **hier erneut** geprüft, nicht nur beim Befüllen.
        const plan = planPendingAdoption({
            pinned: pinnedSnapshotRef.current,
            pending,
        });

        if (!plan.adopt) {
            // Verworfen, aber nicht vergessen: die Warteschlange wird geleert
            // und das Abzeichen zurückgesetzt, State und lokale Kopie bleiben
            // unangetastet.
            console.warn(`Ausstehende Artikel verworfen (${plan.reason})`);
            setNewArticlesCount(0);
            setPending({ articles: [], snapshot: null });
            document.title = 'GamerFeed';
            return;
        }

        // Erst jetzt wird die Generation der ausstehenden Artikel gepinnt:
        // ab diesem Moment ist sie der sichtbare Stand.
        pinnedSnapshotRef.current = plan.snapshot;
        articlesRef.current = pending.articles;
        setArticles(pending.articles);
        persistCachedArticles(pending.articles, plan.snapshot);
        setNewArticlesCount(0);
        setPending({ articles: [], snapshot: null });
        // Reset tab title
        document.title = 'GamerFeed';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [newsLoadController, pending, persistCachedArticles]);

    // Auto-update polling (every 5 minutes) - runs even when tab is inactive
    useEffect(() => {
        // Don't start polling until initial load is complete
        if (isBlockingLoading || articles.length === 0) return;

        const POLLING_INTERVAL = 5 * 60 * 1000; // 5 minutes

        autoUpdateIntervalRef.current = window.setInterval(() => {
            checkForNewArticles();
        }, POLLING_INTERVAL);

        return () => {
            if (autoUpdateIntervalRef.current) {
                window.clearInterval(autoUpdateIntervalRef.current);
            }
        };
    }, [isBlockingLoading, articles.length, checkForNewArticles]);

    const allSources = useMemo(() => {
        const sourcesMap = new Map<string, { name: string; language: 'de' | 'en' }>();
        articles.forEach(article => {
            if (!sourcesMap.has(article.source)) {
                sourcesMap.set(article.source, { name: article.source, language: article.language });
            }
        });
        return Array.from(sourcesMap.values()).sort((a,b) => a.name.localeCompare(b.name));
    }, [articles]);

    useEffect(() => {
        return () => {
            if (toastTimerRef.current) {
                window.clearTimeout(toastTimerRef.current);
            }
        };
    }, []);

    // Toast swipe handlers for mobile - use native events to allow preventDefault
    useEffect(() => {
        const toastElement = toastRef.current;
        if (!toastElement) return;

        let lockedDirection: 'x' | 'y' | null = null;

        const handleTouchStart = (e: TouchEvent) => {
            toastTouchStartRef.current = {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY
            };
            lockedDirection = null;
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (!toastTouchStartRef.current) return;
            const deltaX = e.touches[0].clientX - toastTouchStartRef.current.x;
            const deltaY = e.touches[0].clientY - toastTouchStartRef.current.y;
            
            // Lock direction on first significant movement (10px threshold)
            if (lockedDirection === null && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
                lockedDirection = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y';
                setToastSwipeDirection(lockedDirection);
            }
            
            if (lockedDirection === 'x' && deltaX < 0) {
                // Swipe left only
                e.preventDefault();
                setToastSwipeOffset(deltaX);
            } else if (lockedDirection === 'y' && deltaY < 0) {
                // Swipe up only
                e.preventDefault();
                setToastSwipeOffset(deltaY);
            }
        };

        const handleTouchEnd = () => {
            // Check if should dismiss - lower threshold for up (50px) vs left (80px)
            const threshold = toastSwipeDirection === 'y' ? 50 : 80;
            if (Math.abs(toastSwipeOffset) > threshold) {
                // Dismiss with animation
                if (toastTimerRef.current) {
                    window.clearTimeout(toastTimerRef.current);
                    toastTimerRef.current = null;
                }
                setToast(null);
                setToastSwipeOffset(0);
                setToastSwipeDirection(null);
            } else {
                // Snap back
                setToastSwipeOffset(0);
                setToastSwipeDirection(null);
            }
            toastTouchStartRef.current = null;
            lockedDirection = null;
        };

        // Register with { passive: false } to allow preventDefault
        toastElement.addEventListener('touchstart', handleTouchStart, { passive: true });
        toastElement.addEventListener('touchmove', handleTouchMove, { passive: false });
        toastElement.addEventListener('touchend', handleTouchEnd, { passive: true });

        return () => {
            toastElement.removeEventListener('touchstart', handleTouchStart);
            toastElement.removeEventListener('touchmove', handleTouchMove);
            toastElement.removeEventListener('touchend', handleTouchEnd);
        };
    }, [toast, toastSwipeOffset, toastSwipeDirection]);

    const showToast = useCallback((message: string, type: ToastType, actions: ToastAction[] = []) => {
        if (toastTimerRef.current) {
            window.clearTimeout(toastTimerRef.current);
            toastTimerRef.current = null;
        }

        const newToastId = Date.now();
        setToast({
            id: newToastId,
            message,
            type,
            actions,
            isExiting: false,
            isEntering: true,
        });

        setTimeout(() => {
            setToast(prev => prev ? { ...prev, isEntering: false } : null);
        }, 10);

        toastTimerRef.current = window.setTimeout(() => {
            setToast(prev => prev ? { ...prev, isExiting: true } : null);
            toastTimerRef.current = window.setTimeout(() => {
                setToast(null);
                toastTimerRef.current = null;
            }, 600);
        }, 5000);
    }, []);

    const handleMuteSource = useCallback((source: string) => {
        setMutedSources(prev => [...prev, source]);

        showToast(
            t('toast.sourceMuted', { source }),
            'info',
            [{
                label: t('toast.undo'),
                onClick: () => {
                    setMutedSources(prev => prev.filter(s => s !== source));
                    setToast(null);
                }
            }]
        );
    }, [setMutedSources, showToast, t]);

    const handleToggleFavorite = useCallback((id: string) => {
        const isCurrentlyFavorite = favorites.includes(id);

        setFavorites(prev =>
            isCurrentlyFavorite ? prev.filter(favId => favId !== id) : [...prev, id]
        );

        if (!isCurrentlyFavorite) {
            const actions: ToastAction[] = [
                {
                    label: t('toast.undo'),
                    onClick: () => {
                        setFavorites(prev => prev.filter(favId => favId !== id));
                        setToast(null);
                    },
                }
            ];
            showToast(t('toast.favoriteAdded'), 'success', actions);
        }
    }, [favorites, setFavorites, showToast, t]);

    // Show toast when new articles are available (only when tab is active)
    useEffect(() => {
        if (newArticlesCount > 0 && document.visibilityState === 'visible') {
            showToast(
                t('toast.newArticles', { count: newArticlesCount }),
                'info',
                [{
                    label: t('toast.loadNewArticles'),
                    onClick: loadPendingArticles
                }]
            );
        }
    }, [newArticlesCount, t, showToast, loadPendingArticles]);

    const {
        timeFilter,
        sourceFilter,
        languageFilter,
        showFavoritesOnly,
        setShowFavoritesOnly,
        searchQuery,
        setSearchQuery,
        onResetFilters,
    } = useFilter();

    const handleResetApp = useCallback(() => {
        onResetFilters();
        setShowFavoritesOnly(false);
        setCurrentView('news');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [onResetFilters, setShowFavoritesOnly]);

    const handleViewChange = useCallback((view: AppView) => {
        setCurrentView(view);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const handleTrendClick = useCallback((topic: string) => {
        setSearchQuery(topic);
        setCurrentView('news');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [setSearchQuery]);


    const filteredArticles = useMemo(() => {
        return filterArticles(articles, {
            searchQuery,
            showFavoritesOnly,
            sourceFilter,
            languageFilter,
            timeFilter,
            favoriteIds: favorites,
            mutedSources,
        });
    }, [
        articles, showFavoritesOnly, sourceFilter, timeFilter, favorites, languageFilter,
        searchQuery, mutedSources
    ]);

    const availableFavoritesCount = useMemo(() => {
        if (!articles.length || !favorites.length) {
            return 0;
        }
        const articleIds = new Set(articles.map(a => a.id));
        return favorites.filter(favId => articleIds.has(favId)).length;
    }, [articles, favorites]);

    const filterKey = useMemo(() => JSON.stringify({
        searchQuery,
        showFavoritesOnly,
        sourceFilter,
        languageFilter,
        timeFilter,
        favorites: showFavoritesOnly ? favorites : [],
    }), [searchQuery, showFavoritesOnly, sourceFilter, languageFilter, timeFilter, favorites]);

    useEffect(() => {
        setPage(1);
        window.scrollTo(0, 0);
    }, [filterKey]);

    const articlesToShow = useMemo(() => {
        return filteredArticles.slice(0, page * ARTICLES_PER_PAGE);
    }, [filteredArticles, page]);

    const availableSources = useMemo(() => {
        return allSources.filter(s => !mutedSources.includes(s.name));
    }, [allSources, mutedSources]);

    const observer = useRef<IntersectionObserver | null>(null);
    const lastArticleElementRef = useCallback((node: HTMLElement) => {
        if (isBlockingLoading) return;
        if (observer.current) observer.current.disconnect();

        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && articlesToShow.length < filteredArticles.length) {
                setTimeout(() => {
                    setPage(p => p + 1);
                }, 300);
            }
        });

        if (node) observer.current.observe(node);
    }, [isBlockingLoading, articlesToShow.length, filteredArticles.length]);

    const viewClasses = {
        grid: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6',
        list: 'flex flex-col gap-6',
        compact: 'flex flex-col gap-2',
    };

    const toastStyles: Record<ToastType, { bg: string, text: string, border: string, buttonHover: string }> = {
        info: {
            bg: 'bg-zinc-800',
            text: 'text-white',
            border: 'border-zinc-700',
            buttonHover: 'hover:bg-zinc-700/50',
        },
        success: {
            bg: 'bg-yellow-400 dark:bg-yellow-500',
            text: 'text-yellow-900 dark:text-yellow-950',
            border: 'border-yellow-500/50 dark:border-yellow-600/50',
            buttonHover: 'hover:bg-yellow-500/50 dark:hover:bg-yellow-600/50',
        },
    };

    const EmptyState = () => {
        const areFiltersActive = timeFilter !== 'all' || sourceFilter !== 'all' || languageFilter !== 'all';

        if (searchQuery) {
            return (
                <div className="col-span-full text-center text-slate-500 dark:text-zinc-400 py-16">
                    <SearchIcon className="w-16 h-16 mx-auto text-slate-400 dark:text-zinc-500 mb-4" />
                    <h3 className="text-2xl font-semibold text-slate-700 dark:text-zinc-200">{t('empty.noResults', { query: searchQuery })}</h3>
                    <p className="mt-2">{t('empty.noResultsHint')}</p>
                    <button
                        onClick={() => setSearchQuery('')}
                        className="mt-6 inline-flex items-center gap-2 px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-zinc-900 transition-all duration-200 hover:shadow-lg"
                    >
                        <ResetIcon className="w-5 h-5" />
                        {t('search.clearSearch')}
                    </button>
                </div>
            );
        }

        if (showFavoritesOnly && availableFavoritesCount === 0) {
            return (
                <div className="col-span-full text-center text-slate-500 dark:text-zinc-400 py-16">
                    <BookmarkIcon className="w-16 h-16 mx-auto text-slate-400 dark:text-zinc-500 mb-4" />
                    <h3 className="text-2xl font-semibold text-slate-700 dark:text-zinc-200">{t('empty.noFavorites')}</h3>
                    <p className="mt-2">{t('favorites.noneHint')} <StarIcon className="w-4 h-4 inline-block text-yellow-500 fill-current"/></p>
                    <button
                        onClick={() => setShowFavoritesOnly(false)}
                        className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-zinc-900 transition-all duration-200 hover:shadow-lg"
                    >
                        <ArrowLeftIcon className="w-5 h-5" />
                        {t('favorites.browseAll')}
                    </button>
                </div>
            );
        }

        if (areFiltersActive || showFavoritesOnly) {
            const title = showFavoritesOnly ? t('favorites.noMatch') : t('empty.noMatch');
            return (
                <div className="col-span-full text-center text-slate-500 dark:text-zinc-400 py-16">
                    <FilterIcon className="w-16 h-16 mx-auto text-slate-400 dark:text-zinc-500 mb-4" />
                    <h3 className="text-2xl font-semibold text-slate-700 dark:text-zinc-200">{title}</h3>
                    <p className="mt-2">{t('empty.noMatchHint')}</p>
                    <button
                        onClick={onResetFilters}
                        className="mt-6 inline-flex items-center gap-2 px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-zinc-900 transition-all duration-200 hover:shadow-lg"
                    >
                        <ResetIcon className="w-5 h-5" />
                        {t('filter.reset')}
                    </button>
                </div>
            );
        }

        return (
            <div className="col-span-full text-center text-slate-500 dark:text-zinc-400 py-16">
                <NewspaperIcon className="w-16 h-16 mx-auto text-slate-400 dark:text-zinc-500 mb-4" />
                <h3 className="text-2xl font-semibold text-slate-700 dark:text-zinc-200">{t('empty.noArticles')}</h3>
                <p className="mt-2">{t('empty.noArticlesHint')}</p>
            </div>
        );
    };


    return (
        <div className="min-h-screen text-slate-800 dark:text-zinc-200 transition-colors duration-300 flex flex-col">
            <a href="#main-content" className="skip-link">{t('a11y.skipToContent')}</a>

            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {isRefreshing && t('loading.refreshing')}
                {isBlockingLoading && t('loading.articles')}
            </div>

            <Header
                theme={theme}
                setTheme={setTheme}
                viewMode={viewMode}
                setViewMode={setViewMode}
                isRefreshing={isRefreshing}
                onRefresh={handleRefresh}
                onOpenSettings={() => setIsSettingsModalOpen(true)}
                onLogoClick={handleResetApp}
                currentView={currentView}
                onViewChange={handleViewChange}
                newArticlesCount={newArticlesCount}
                onLoadNewArticles={loadPendingArticles}
            />

            <AnnouncementBanner 
                announcement={announcement} 
                onDismiss={handleDismissAnnouncement}
            />

            <main id="main-content" className="container mx-auto p-4 md:p-6 flex-grow">
                {currentView === 'trends' ? (
                    <TrendsView 
                        onBackToNews={() => setCurrentView('news')}
                        onTrendClick={handleTrendClick}
                    />
                ) : (
                    <>
                <FilterBar
                    sources={availableSources}
                    favoritesCount={availableFavoritesCount}
                    filteredArticlesCount={filteredArticles.length}
                />

                {showFavoritesOnly && !searchQuery && (
                    <FavoritesHeader
                        totalFavorites={availableFavoritesCount}
                        filteredFavoritesCount={filteredArticles.length}
                        onResetFilters={onResetFilters}
                        onExitFavorites={() => setShowFavoritesOnly(false)}
                    />
                )}

                {searchQuery && (
                    <SearchResultsHeader
                        searchQuery={searchQuery}
                        resultsCount={filteredArticles.length}
                        onClear={() => setSearchQuery('')}
                        isSearchingFavorites={showFavoritesOnly}
                    />
                )}

                {backgroundError && !isBlockingLoading && (
                    <div
                        role="status"
                        className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                    >
                        <p className="font-semibold">{t('error.refreshFailed')}</p>
                    </div>
                )}

                {isBlockingLoading ? (
                    <div className="flex justify-center items-center h-64">
                        <LoadingSpinner />
                    </div>
                ) : error ? (
                    <div className="text-center py-16">
                        <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/50">
                            <svg className="h-6 w-6 text-red-600 dark:text-red-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                            </svg>
                        </div>
                        <h3 className="mt-4 text-2xl font-semibold text-red-600 dark:text-red-400">{t('error.couldNotLoad')}</h3>
                        <button
                            onClick={() => void loadNews(true)}
                            className="mt-6 inline-flex items-center gap-2 px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-zinc-900 transition-all duration-200 hover:shadow-lg"
                        >
                            {t('error.tryAgain')}
                        </button>
                    </div>
                ) : (
                    <>
                        <div key={filterKey} className={`mt-8 ${viewClasses[viewMode]} animate-fade-in`}>
                            {articlesToShow.length > 0 ? (
                                articlesToShow.map((article, index) => {
                                    const isLastElement = articlesToShow.length === index + 1;
                                    return (
                                        <ArticleCard
                                            ref={isLastElement ? lastArticleElementRef : null}
                                            key={article.id}
                                            article={article}
                                            viewMode={viewMode}
                                            isFavorite={favorites.includes(article.id)}
                                            onToggleFavorite={handleToggleFavorite}
                                            onMuteSource={handleMuteSource}
                                        />
                                    );
                                })
                            ) : (
                                <EmptyState />
                            )}
                        </div>

                        {articlesToShow.length > 0 && articlesToShow.length < filteredArticles.length && (
                            <div className="flex justify-center items-center h-24 col-span-full">
                                <LoadingSpinner className="w-8 h-8" />
                            </div>
                        )}
                    </>
                )}
                </>
                )}
            </main>
            <ScrollToTopButton />
            <SettingsModal
                isOpen={isSettingsModalOpen}
                onClose={() => setIsSettingsModalOpen(false)}
                onShowCookieSettings={() => {
                    // Erst schliessen, dann oeffnen: sonst konkurrieren zwei
                    // dokumentweite Fokusfallen miteinander.
                    setIsSettingsModalOpen(false);
                    showPreferences();
                }}
                allSources={allSources}
                mutedSources={mutedSources}
                setMutedSources={setMutedSources}
            />
            {toast && (
                <div 
                    className="fixed inset-x-0 top-0 z-50 overflow-hidden pointer-events-none"
                    style={{ height: '120px' }} // Container to clip the toast
                >
                    <div
                        ref={toastRef}
                        key={toast.id}
                        role="alert"
                        style={{
                            transform: `translateX(-50%) ${toastSwipeDirection === 'x' ? `translateX(${toastSwipeOffset}px)` : toastSwipeDirection === 'y' ? `translateY(${Math.max(toastSwipeOffset, -24)}px)` : ''}`,
                            opacity: Math.max(0, 1 - Math.abs(toastSwipeOffset) / 100),
                            touchAction: 'none' // Prevent browser handling of touch gestures
                        }}
                        className={`absolute top-6 left-1/2 rounded-xl shadow-lg flex items-stretch w-11/12 max-w-2xl overflow-hidden transition-opacity duration-300 pointer-events-auto ${toastStyles[toast.type].bg} ${toastStyles[toast.type].text} ${toastSwipeOffset === 0 ? 'transition-all duration-300 ease-out' : ''} ${
                            toast.isExiting
                                ? 'opacity-0 scale-95'
                                : toast.isEntering
                                    ? 'opacity-0 scale-95'
                                    : ''
                        }`}
                    >
                    <p className="py-4 px-6 flex-grow">{toast.message}</p>
                    {toast.actions.length > 0 && (
                        <div className={`border-l ${toastStyles[toast.type].border} flex-shrink-0 flex items-stretch`}>
                            {toast.actions.map((action, index) => (
                                <button
                                    key={action.label}
                                    onClick={action.onClick}
                                    className={`font-bold px-6 h-full ${toastStyles[toast.type].buttonHover} transition-colors ${ index > 0 ? `border-l ${toastStyles[toast.type].border}` : ''}`}
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    )}
                    </div>
                </div>
            )}
        </div>
    );
};

const App: React.FC = () => {
    return (
        <ErrorBoundary>
            <FilterProvider>
                <AppContent />
            </FilterProvider>
        </ErrorBoundary>
    );
};

export default App;
