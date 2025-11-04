import React, { useState, useRef, useEffect, useMemo, useTransition } from 'react';
import type { Article, TimeFilter } from '../types';
import { StarIcon, SearchIcon, ResetIcon, FilterIcon, CloseIcon, BookmarkIcon, TrashIcon } from './Icons';
import { useFilter } from '../contexts/FilterContext';

interface FilterBarProps {
  sources: { name: string; language: 'de' | 'en' }[];
  favoritesCount: number;
  allArticles: Article[];
  favoriteIds: string[];
  mutedSources: string[];
}

const baseSelectClasses = "bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition w-full capitalize h-11";
const activeFilterClasses = "border-indigo-500 dark:border-indigo-400 ring-1 ring-indigo-500 dark:ring-indigo-400";

export const FilterBar: React.FC<FilterBarProps> = (props) => {
  const {
    sources,
    favoritesCount,
    allArticles,
    favoriteIds,
    mutedSources
  } = props;

  const {
    timeFilter, setTimeFilter,
    sourceFilter, setSourceFilter,
    languageFilter, setLanguageFilter,
    showFavoritesOnly, setShowFavoritesOnly,
    searchQuery, setSearchQuery,
    savedSearches, setSavedSearches,
    onResetFilters
  } = useFilter();

  const [isPending, startTransition] = useTransition();
  const [inputValue, setInputValue] = useState(searchQuery);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Animation States:
  const prevCountRef = useRef(0);
  const [isCountChanging, setIsCountChanging] = useState(false);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  
  // Sync local search when global query changes (e.g., from a reset)
  useEffect(() => {
    setInputValue(searchQuery);
  }, [searchQuery]);
  
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value); // Update the input field immediately
    startTransition(() => {
      setSearchQuery(value); // Defer the expensive filtering
    });
  };


  const germanSources = useMemo(() => sources
    .filter(s => s.language === 'de')
    .sort((a, b) => a.name.localeCompare(b.name)), [sources]);

  const englishSources = useMemo(() => sources
    .filter(s => s.language === 'en')
    .sort((a, b) => a.name.localeCompare(b.name)), [sources]);
    
  const sourcesForLanguage = useMemo(() => {
    if (languageFilter === 'de') return germanSources;
    if (languageFilter === 'en') return englishSources;
    // For 'all', we need the full list to generate optgroups correctly.
    return [...germanSources, ...englishSources];
  }, [languageFilter, germanSources, englishSources]);

  // When the language filter changes, if the current source is no longer
  // in the available list, reset the source filter to 'all'.
  useEffect(() => {
    if (sourceFilter === 'all') return;
    const isSourceStillAvailable = sourcesForLanguage.some(s => s.name === sourceFilter);
    if (!isSourceStillAvailable) {
      setSourceFilter('all');
    }
  }, [languageFilter, sourceFilter, sourcesForLanguage, setSourceFilter]);

  const normalizeString = (str: string): string => {
    return str
        .toLowerCase()
        .normalize('NFD') // Decompose characters into base + accent
        .replace(/[\u0300-\u036f]/g, ''); // Remove accent characters
  };

  const liveFilteredCount = useMemo(() => {
    let result = allArticles;

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
        result = result.filter(article => favoriteIds.includes(article.id));
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

    return result.length;
  }, [
      allArticles, showFavoritesOnly, sourceFilter, timeFilter, favoriteIds, languageFilter,
      searchQuery, mutedSources
  ]);
    // Count Animation Effect
    useEffect(() => {
        if (prevCountRef.current !== liveFilteredCount) {
            setIsCountChanging(true);
            const timer = setTimeout(() => setIsCountChanging(false), 400);
            prevCountRef.current = liveFilteredCount;

            return () => clearTimeout(timer);
        }
    }, [liveFilteredCount]);

  const languageOptions: { id: 'all' | 'de' | 'en', label: string, count: number }[] = [
    { id: 'all', label: 'All', count: sources.length },
    { id: 'de', label: 'DE', count: germanSources.length },
    { id: 'en', label: 'EN', count: englishSources.length },
  ];

  const activeFilterCount = [
    timeFilter !== 'all',
    sourceFilter !== 'all',
    languageFilter !== 'all',
    showFavoritesOnly,
    searchQuery.length > 0,
  ].filter(Boolean).length;
  
  const isCurrentSearchSaved = inputValue && savedSearches.includes(inputValue);

  const handleSaveSearch = () => {
      if (!inputValue || isCurrentSearchSaved) return;
      setSavedSearches(prev => [inputValue, ...prev]);
  };

  const handleSelectSaved = (search: string) => {
      handleSearchChange({ target: { value: search } } as React.ChangeEvent<HTMLInputElement>);
      setIsDropdownOpen(false);
  };

  const handleRemoveSaved = (e: React.MouseEvent, search: string) => {
      e.stopPropagation();
      setSavedSearches(prev => prev.filter(s => s !== search));
  };
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
            setIsDropdownOpen(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
        document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [searchContainerRef]);

  const handleLanguageFilterChange = (newLanguage: 'all' | 'de' | 'en') => {
    setLanguageFilter(newLanguage);
    // When a language category is selected, reset the source to show all from that category.
    setSourceFilter('all');
  };

  const handleSourceFilterChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newSourceValue = event.target.value;
    setSourceFilter(newSourceValue);
  };
  
  const handleClearSearch = () => {
    handleSearchChange({ target: { value: '' } } as React.ChangeEvent<HTMLInputElement>);
  }

  const FilterControls = (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div ref={searchContainerRef} className="relative flex-grow">
          <input
            type="text"
            placeholder="Search articles by keyword..."
            value={inputValue}
            onChange={handleSearchChange}
            onFocus={() => setIsDropdownOpen(true)}
            onClick={() => setIsDropdownOpen(true)}
            className={`w-full h-11 pl-10 pr-10 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition ${searchQuery.length > 0 ? activeFilterClasses : ''}`}
          />
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <SearchIcon className={`w-5 h-5 text-slate-500 dark:text-zinc-400 transition-opacity duration-300 ${isPending ? 'opacity-30' : 'opacity-100'}`} />
          </div>
          
          {inputValue.length > 0 && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                <button
                    onClick={handleClearSearch}
                    className="p-2.5 rounded-full text-slate-500 dark:text-zinc-400 hover:text-slate-600 dark:hover:text-zinc-200 transition-colors"
                    aria-label="Clear search"
                >
                    <CloseIcon className="w-5 h-5" />
                </button>
            </div>
          )}
          
          {isDropdownOpen && savedSearches.length > 0 && (
            <div className="absolute top-full mt-2 w-full bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-slate-200 dark:border-zinc-700 z-30 p-2 space-y-1 animate-fade-in">
                <p className="text-xs font-semibold text-slate-400 dark:text-zinc-500 px-2 pb-1 uppercase">Saved Searches</p>
                {savedSearches.map(search => (
                    <div key={search} className="group flex items-center justify-between text-left w-full rounded-md hover:bg-slate-100 dark:hover:bg-zinc-700 active:bg-slate-200 dark:active:bg-zinc-600 transition-colors">
                        <button onMouseDown={() => handleSelectSaved(search)} className="flex items-center gap-2 flex-grow text-left px-3 py-2.5 text-base text-slate-700 dark:text-zinc-200 cursor-pointer overflow-hidden">
                           <SearchIcon className="w-5 h-5 text-slate-500 dark:text-zinc-400 flex-shrink-0" />
                           <span className="truncate">{search}</span>
                        </button>
                        <button
                            onMouseDown={(e) => handleRemoveSaved(e, search)}
                            className="p-2.5 mr-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 rounded-full transition-colors flex-shrink-0 hover:bg-red-500/10"
                            aria-label={`Remove "${search}" from saved searches`}
                        >
                            <TrashIcon className="w-5 h-5" />
                        </button>
                    </div>
                ))}
            </div>
          )}
        </div>
        
        {inputValue.length > 0 && (
            <button
                onClick={handleSaveSearch}
                disabled={isCurrentSearchSaved}
                className={`flex-shrink-0 flex items-center justify-center gap-2 px-2 sm:px-4 rounded-lg text-sm font-semibold transition-all duration-200 border-2 h-11
                ${ isCurrentSearchSaved
                    ? 'bg-indigo-500 border-indigo-500 text-white'
                    : 'bg-slate-200 dark:bg-zinc-700 border-transparent text-slate-600 dark:text-zinc-300 hover:bg-slate-300 dark:hover:bg-zinc-600'
                }
                disabled:bg-indigo-500 disabled:border-indigo-500 disabled:text-white disabled:cursor-not-allowed disabled:opacity-75
                `}
            >
                <BookmarkIcon className="w-5 h-5"/>
                <span className="hidden sm:inline">{isCurrentSearchSaved ? 'Saved' : 'Save'}</span>
            </button>
        )}
      </div>


      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div>
          <label htmlFor="time-filter" className="block text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1">Time</label>
          <select id="time-filter" value={timeFilter} onChange={(e) => setTimeFilter(e.target.value as TimeFilter)} className={`${baseSelectClasses} ${timeFilter !== 'all' ? activeFilterClasses : ''}`}>
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="7d">Last 7 days</option>
          </select>
        </div>

        <div>
           <label className="block text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1">Language</label>
            <div className="flex items-center gap-1 h-11">
                {languageOptions.map(option => (
                    <button
                        key={option.id}
                        onClick={() => handleLanguageFilterChange(option.id as 'all' | 'de' | 'en')}
                        className={`relative w-full px-2 py-1 rounded-lg text-sm font-medium transition-all h-full flex items-center justify-center gap-1.5 border ${
                        languageFilter === option.id
                            ? 'bg-indigo-500 text-white shadow z-20 border-indigo-500'
                            : 'bg-white dark:bg-zinc-800 border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-700'
                        }`}
                    >
                        <span>{option.label}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                            languageFilter === option.id 
                            ? 'bg-white/20' 
                            : 'bg-slate-200 dark:bg-zinc-600'
                        }`}>
                            {option.count}
                        </span>
                    </button>
                ))}
            </div>
        </div>

        <div>
          <label htmlFor="source-filter" className="block text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1">Source</label>
          <select 
            id="source-filter" 
            value={sourceFilter} 
            onChange={handleSourceFilterChange} 
            className={`${baseSelectClasses} ${sourceFilter !== 'all' ? activeFilterClasses : ''} !normal-case`}
            disabled={sourcesForLanguage.length === 0}
          >
            <option value="all">
              {languageFilter === 'all' && `All Sources (${sources.length})`}
              {languageFilter === 'de' && `All German (${germanSources.length})`}
              {languageFilter === 'en' && `All English (${englishSources.length})`}
            </option>
            {languageFilter === 'all' ? (
              <>
                {germanSources.length > 0 && (
                  <optgroup label="German Sources">
                    {germanSources.map(source => (
                      <option key={source.name} value={source.name}>{source.name}</option>
                    ))}
                  </optgroup>
                )}
                {englishSources.length > 0 && (
                  <optgroup label="English Sources">
                    {englishSources.map(source => (
                      <option key={source.name} value={source.name}>{source.name}</option>
                    ))}
                  </optgroup>
                )}
              </>
            ) : (
                sourcesForLanguage.map(source => (
                  <option key={source.name} value={source.name}>{source.name}</option>
                ))
            )}
          </select>
        </div>

        <div className="flex items-end">
          <button
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border-2 h-11 ${
              showFavoritesOnly
                ? 'bg-yellow-400/20 border-yellow-500 text-yellow-600 dark:text-yellow-400'
                : 'bg-slate-200 dark:bg-zinc-700 border-transparent text-slate-600 dark:text-zinc-300 hover:bg-slate-300 dark:hover:bg-zinc-600'
            }`}
          >
            <StarIcon className="w-5 h-5" />
            <span>Favorites</span>
            <span className={`flex items-center justify-center text-xs w-5 h-5 rounded-full ${showFavoritesOnly ? 'bg-yellow-500 text-white' : 'bg-slate-300 dark:bg-zinc-600'}`}>
              {favoritesCount}
            </span>
          </button>
        </div>
        
        <div className="flex items-end">
          <button
            onClick={onResetFilters}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border-2 h-11 bg-slate-200 dark:bg-zinc-700 border-transparent text-slate-600 dark:text-zinc-300 hover:bg-slate-300 dark:hover:bg-zinc-600"
            aria-label="Reset all filters"
          >
            <ResetIcon className="w-5 h-5" />
            <span>Reset</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* --- Mobile: Button to open modal --- */}
      <div className="lg:hidden">
        <button
          onClick={() => setIsModalOpen(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-md font-semibold transition-all duration-200 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-700"
        >
          <FilterIcon className="w-5 h-5" />
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <span className="flex items-center justify-center text-xs font-bold text-white bg-indigo-500 w-6 h-6 rounded-full">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* --- Desktop: Full filter bar --- */}
      <div className="hidden lg:block p-4 bg-white/50 dark:bg-zinc-800/50 rounded-xl border border-slate-200 dark:border-zinc-800">
        {FilterControls}
      </div>

      {/* --- Mobile: Modal --- */}
      <div
        className={`fixed inset-0 bg-black/60 z-30 transition-opacity lg:hidden ${
          isModalOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsModalOpen(false)}
        aria-hidden="true"
      />
      <div
        className={`fixed bottom-0 left-0 right-0 z-40 bg-slate-100 dark:bg-zinc-900 rounded-t-2xl shadow-2xl transition-transform duration-300 ease-in-out lg:hidden flex flex-col ${
          isModalOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ maxHeight: '85vh' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="filter-modal-title"
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-zinc-800 flex-shrink-0">
          <h2 id="filter-modal-title" className="text-lg font-semibold">Filters</h2>
          <button
            onClick={() => setIsModalOpen(false)}
            className="p-3 rounded-full hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
            aria-label="Close filters"
          >
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-grow">
          {FilterControls}
        </div>


          <div className="px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 flex-shrink-0">
              {/* Empty State Message */}
              {liveFilteredCount === 0 && (
                  <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                      <div className="flex items-start gap-2">
                          <svg
                              className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                          >
                              <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                              />
                          </svg>
                          <div className="flex-1">
                              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                                  No articles match your filters
                              </p>
                              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                                  Try adjusting your selection to see more results
                              </p>
                          </div>
                      </div>
                  </div>
              )}

              {/* Action Button */}
              <button
                  onClick={() => setIsModalOpen(false)}
                  className={`w-full font-bold py-3 px-8 rounded-lg shadow-md transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                      liveFilteredCount === 0
                          ? 'bg-slate-300 dark:bg-zinc-700 text-slate-500 dark:text-zinc-400 cursor-not-allowed'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white hover:shadow-lg focus:ring-indigo-500 dark:focus:ring-offset-zinc-900'
                  }`}
                  disabled={liveFilteredCount === 0}
              >
                  {liveFilteredCount === 0 ? (
                      'No Articles to Show'
                  ) : (
                      <>
                          Show <span className={isCountChanging ? 'animate-pulse font-bold' : ''}>{liveFilteredCount}</span> {liveFilteredCount === 1 ? 'Article' : 'Articles'}
                      </>
                  )}
              </button>
          </div>
      </div>
    </>
  );
};