import React, { createContext, useState, useContext, useCallback } from 'react';
import type { TimeFilter } from '../types';
import { useLocalStorage } from '../hooks/useLocalStorage';

// Define the shape of the context state
interface FilterContextState {
  timeFilter: TimeFilter;
  setTimeFilter: React.Dispatch<React.SetStateAction<TimeFilter>>;
  sourceFilter: string;
  setSourceFilter: React.Dispatch<React.SetStateAction<string>>;
  languageFilter: 'all' | 'de' | 'en';
  setLanguageFilter: React.Dispatch<React.SetStateAction<'all' | 'de' | 'en'>>;
  showFavoritesOnly: boolean;
  setShowFavoritesOnly: React.Dispatch<React.SetStateAction<boolean>>;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  savedSearches: string[];
  setSavedSearches: React.Dispatch<React.SetStateAction<string[]>>;
  onResetFilters: () => void;
}

// Create the context with a default value (will throw an error if used outside a provider)
const FilterContext = createContext<FilterContextState | undefined>(undefined);

// Create the Provider component
export const FilterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [languageFilter, setLanguageFilter] = useState<'all' | 'de' | 'en'>('all');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [savedSearches, setSavedSearches] = useLocalStorage<string[]>('savedSearches', []);

  const onResetFilters = useCallback(() => {
    setSearchQuery('');
    setTimeFilter('all');
    setSourceFilter('all');
    setLanguageFilter('all');
    // NOTE: We no longer touch `setShowFavoritesOnly` here.
    // This preserves the user's view (e.g., staying on the favorites page) when they reset filters.
  }, []);

  const value = {
    timeFilter, setTimeFilter,
    sourceFilter, setSourceFilter,
    languageFilter, setLanguageFilter,
    showFavoritesOnly, setShowFavoritesOnly,
    searchQuery, setSearchQuery,
    savedSearches, setSavedSearches,
    onResetFilters
  };

  return (
    <FilterContext.Provider value={value}>
      {children}
    </FilterContext.Provider>
  );
};

// Create a custom hook to use the filter context
export const useFilter = (): FilterContextState => {
  const context = useContext(FilterContext);
  if (context === undefined) {
    throw new Error('useFilter must be used within a FilterProvider');
  }
  return context;
};
