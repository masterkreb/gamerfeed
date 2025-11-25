import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Header } from './components/Header';
import { FilterBar } from './components/FilterBar';
import { ArticleCard } from './components/ArticleCard';
import { TrendsView } from './components/TrendsView';
import { useLocalStorage } from './hooks/useLocalStorage';
import type { Article, Theme, ViewMode, AppView } from './types';
import { LoadingSpinner, SearchIcon, FilterIcon, ResetIcon, NewspaperIcon, BookmarkIcon, StarIcon, ArrowLeftIcon } from './components/Icons';
import { FilterProvider, useFilter } from './contexts/FilterContext';
import { Footer } from './components/Footer';
import { ScrollToTopButton } from './components/ScrollToTopButton';
import { FavoritesHeader } from './components/FavoritesHeader';
import { SettingsModal } from './components/SettingsModal';
import ErrorBoundary from './components/ErrorBoundary';

const ARTICLES_PER_PAGE = 32;

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
    const [theme, setTheme] = useLocalStorage<Theme>('theme', 'dark');
    const [viewMode, setViewMode] = useLocalStorage<ViewMode>('viewMode', 'grid');
    const [favorites, setFavorites] = useLocalStorage<string[]>('favorites', []);
    const [mutedSources, setMutedSources] = useLocalStorage<string[]>('mutedSources', []);
    const [currentView, setCurrentView] = useState<AppView>('news');

    const [articles, setArticles] = useState<Article[]>([]);
    const [isBlockingLoading, setIsBlockingLoading] = useState<boolean>(true);
    const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);

    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [toast, setToast] = useState<Toast | null>(null);
    const toastTimerRef = useRef<number | null>(null);

    // Auto-update state
    const [newArticlesCount, setNewArticlesCount] = useState(0);
    const [pendingArticles, setPendingArticles] = useState<Article[]>([]);
    const lastCheckRef = useRef<number>(Date.now());
    const autoUpdateIntervalRef = useRef<number | null>(null);

    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [theme]);

    const loadNews = useCallback(async (isManualRefresh = false) => {
        setError(null);

        if (!isManualRefresh) {
            setIsBlockingLoading(true);
        } else {
            setIsRefreshing(true);
        }

        try {
            if (isManualRefresh) {
                // Manual refresh: fetch all articles directly
                const response = await fetch('/api/get-news');
                if (!response.ok) {
                    const errorData = await response.json().catch(() => null);
                    const errorMessage = errorData?.error || `Failed to load news from API: ${response.status}`;
                    throw new Error(errorMessage);
                }
                const fetchedArticles: Article[] = await response.json();
                setArticles(fetchedArticles);
                console.log(`Refreshed ${fetchedArticles.length} articles from API`);
            } else {
                // Initial load: 3-stage progressive loading (16 → 64 → full)
                const previewResponse = await fetch('/api/get-news-preview');

                if (previewResponse.ok) {
                    // Stage 1: Show first 16 articles immediately
                    const previewArticles: Article[] = await previewResponse.json();
                    setArticles(previewArticles);
                    setIsBlockingLoading(false);
                    console.log(`✅ Stage 1: Loaded ${previewArticles.length} preview articles`);

                    // Stage 2: Load 64 articles in background
                    fetch('/api/get-news-medium')
                        .then(response => {
                            if (!response.ok) throw new Error('Failed to load medium articles');
                            return response.json();
                        })
                        .then((mediumArticles: Article[]) => {
                            setArticles(mediumArticles);
                            console.log(`✅ Stage 2: Loaded ${mediumArticles.length} medium articles`);

                            // Stage 3: Load all articles in background
                            return fetch('/api/get-news');
                        })
                        .then(response => {
                            if (!response.ok) throw new Error('Failed to load full articles');
                            return response.json();
                        })
                        .then((fullArticles: Article[]) => {
                            setArticles(fullArticles);
                            console.log(`✅ Stage 3: Loaded ${fullArticles.length} full articles`);
                        })
                        .catch(err => {
                            console.warn('Background loading failed:', err);
                        });

                    return; // Exit early since we already set isBlockingLoading to false
                } else {
                    // Preview API not available (404) - fallback to full API
                    console.log('Preview API not available, falling back to full API');
                    const response = await fetch('/api/get-news');
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => null);
                        const errorMessage = errorData?.error || `Failed to load news: ${response.status}`;
                        throw new Error(errorMessage);
                    }
                    const fetchedArticles: Article[] = await response.json();
                    setArticles(fetchedArticles);
                    console.log(`Loaded ${fetchedArticles.length} articles (fallback)`);
                }
            }

        } catch (error) {
            console.error("Failed to fetch articles from API:", error);
            const message = error instanceof Error ? error.message : "An unknown error occurred.";
            setError(message);
        } finally {
            setIsBlockingLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    useEffect(() => {
        loadNews();
    }, [loadNews]);

    const handleRefresh = useCallback(() => {
        loadNews(true);
        // Clear pending articles when manually refreshing
        setNewArticlesCount(0);
        setPendingArticles([]);
        // Reset tab title
        document.title = 'GamerFeed';
    }, [loadNews]);

    // Check for new articles without updating the view
    const checkForNewArticles = useCallback(async () => {
        try {
            const response = await fetch('/api/get-news');
            if (!response.ok) return;
            
            const fetchedArticles: Article[] = await response.json();
            
            // Find articles that we don't have yet (compare against original articles, not pending)
            const currentIds = new Set(articles.map(a => a.id));
            const newArticles = fetchedArticles.filter(a => !currentIds.has(a.id));
            
            if (newArticles.length > 0) {
                // Accumulate: add new count to existing count
                setNewArticlesCount(prev => {
                    const totalNew = prev + newArticles.length;
                    // Update tab title
                    document.title = `(${totalNew}) GamerFeed`;
                    return totalNew;
                });
                setPendingArticles(fetchedArticles);
                console.log(`🆕 ${newArticles.length} neue Artikel gefunden (insgesamt: ${newArticlesCount + newArticles.length})`);
            }
            
            lastCheckRef.current = Date.now();
        } catch (error) {
            console.warn('Auto-update check failed:', error);
        }
    }, [articles, newArticlesCount]);

    // Load pending articles (when user clicks the toast or badge)
    const loadPendingArticles = useCallback(() => {
        if (pendingArticles.length > 0) {
            setArticles(pendingArticles);
            setNewArticlesCount(0);
            setPendingArticles([]);
            // Reset tab title
            document.title = 'GamerFeed';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [pendingArticles]);

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


    const normalizeString = (str: string): string => {
        return str
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
            .replace(/[''`]/g, '') // Remove apostrophes and similar characters
            .replace(/[-–—]/g, ' ') // Replace dashes with spaces
            .replace(/[^\w\s]/g, '') // Remove other punctuation
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    };

    const filteredArticles = useMemo(() => {
        let result = articles;

        if (!showFavoritesOnly) {
            result = result.filter(article => !mutedSources.includes(article.source));
        }

        if (searchQuery) {
            const normalizedQuery = normalizeString(searchQuery);
            result = result.filter(article =>
                normalizeString(article.title).includes(normalizedQuery) ||
                normalizeString(article.summary).includes(normalizedQuery)
            );
        }

        if (showFavoritesOnly) {
            result = result.filter(article => favorites.includes(article.id));
        }

        if (sourceFilter !== 'all') {
            result = result.filter(article => article.source === sourceFilter);
        }

        if (languageFilter !== 'all') {
            result = result.filter(article => article.language === languageFilter);
        }

        if (timeFilter !== 'all') {
            const now = new Date();
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            if (timeFilter === 'today') {
                result = result.filter(article => new Date(article.publicationDate) >= todayStart);
            } else if (timeFilter === 'yesterday') {
                const yesterdayStart = new Date(todayStart);
                yesterdayStart.setDate(todayStart.getDate() - 1);

                result = result.filter(article => {
                    const articleDate = new Date(article.publicationDate);
                    return articleDate >= yesterdayStart && articleDate < todayStart;
                });
            } else if (timeFilter === '7d') {
                const hours = 7 * 24;
                const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
                result = result.filter(article => new Date(article.publicationDate) >= cutoff);
            }
        }

        return result;
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
                    allArticles={articles}
                    favoriteIds={favorites}
                    mutedSources={mutedSources}
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
                        <p className="mt-2 text-slate-600 dark:text-zinc-400">{error}</p>
                        <button
                            onClick={() => loadNews(true)}
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
            <Footer />
            <ScrollToTopButton />
            <SettingsModal
                isOpen={isSettingsModalOpen}
                onClose={() => setIsSettingsModalOpen(false)}
                allSources={allSources}
                mutedSources={mutedSources}
                setMutedSources={setMutedSources}
            />
            {toast && (
                <div
                    key={toast.id}
                    role="alert"
                    className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 rounded-xl shadow-lg flex items-stretch w-11/12 max-w-2xl overflow-hidden transition-all duration-600 ease-in-out ${toastStyles[toast.type].bg} ${toastStyles[toast.type].text} ${
                        toast.isExiting
                            ? 'opacity-0 scale-95'
                            : toast.isEntering
                                ? 'opacity-0 scale-95'
                                : 'opacity-100 scale-100'
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