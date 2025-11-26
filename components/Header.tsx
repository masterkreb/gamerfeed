import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme, ViewMode, AppView } from '../types';
import { SunIcon, MoonIcon, GridIcon, ListIcon, CompactIcon, ResetIcon, SettingsIcon, FireIcon } from './Icons';
import { LanguageSwitcher } from './LanguageSwitcher';

interface HeaderProps {
    theme: Theme;
    setTheme: React.Dispatch<React.SetStateAction<Theme>>;
    viewMode: ViewMode;
    setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
    isRefreshing: boolean;
    onRefresh: () => void;
    onOpenSettings: () => void;
    onLogoClick: () => void;
    currentView: AppView;
    onViewChange: (view: AppView) => void;
    newArticlesCount?: number;
    onLoadNewArticles?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ theme, setTheme, viewMode, setViewMode, isRefreshing, onRefresh, onOpenSettings, onLogoClick, currentView, onViewChange, newArticlesCount = 0, onLoadNewArticles }) => {
    const { t } = useTranslation();
    const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const toggleTheme = () => {
        setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
    };

    const viewOptions: { mode: ViewMode, icon: React.ReactNode, label: string }[] = [
        { mode: 'grid', icon: <GridIcon className="w-5 h-5" />, label: t('viewMode.grid') },
        { mode: 'list', icon: <ListIcon className="w-5 h-5" />, label: t('viewMode.list') },
        { mode: 'compact', icon: <CompactIcon className="w-5 h-5" />, label: t('viewMode.compact') },
    ];

    const currentViewIcon = viewOptions.find(opt => opt.mode === viewMode)?.icon;

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsViewMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [menuRef]);


    return (
        <header className="bg-white/70 dark:bg-zinc-900/70 backdrop-blur-lg sticky top-0 z-20 border-b border-slate-200 dark:border-zinc-800">
            <div className="container mx-auto px-2 sm:px-4 md:px-6 py-2 sm:py-3 flex justify-between items-center gap-1 sm:gap-2">
                {/* Logo */}
                <a
                    href="/"
                    onClick={(e) => {
                        e.preventDefault();
                        onLogoClick();
                    }}
                    aria-label="Go to homepage and reset filters"
                    className="flex-shrink-0 transition-transform duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-100 dark:focus-visible:ring-offset-zinc-900 focus-visible:ring-indigo-500 rounded-lg"
                >
                    <h1 className="text-lg xs:text-xl sm:text-2xl font-bold text-indigo-500 dark:text-indigo-400 whitespace-nowrap">
                        {t('header.title')}
                    </h1>
                </a>
                    
                {/* Trends Link - Desktop only */}
                <button
                    onClick={() => onViewChange(currentView === 'trends' ? 'news' : 'trends')}
                    className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-base font-medium transition-all flex-shrink-0 ${
                        currentView === 'trends'
                            ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                            : 'text-slate-600 dark:text-zinc-400 hover:text-orange-500 dark:hover:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20'
                    }`}
                    aria-label={t('header.trends')}
                >
                    <FireIcon className="w-5 h-5" />
                    <span>{t('header.trends')}</span>
                </button>

                {/* Spacer to push controls to right */}
                <div className="flex-grow min-w-0" />

                <div className="flex items-center gap-1 sm:gap-2 md:gap-4 flex-shrink-0">
                    {/* Trends Link - Mobile */}
                    <button
                        onClick={() => onViewChange(currentView === 'trends' ? 'news' : 'trends')}
                        className={`sm:hidden w-9 h-9 flex items-center justify-center rounded-lg transition-all ${
                            currentView === 'trends'
                                ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                                : 'bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 hover:text-orange-500 dark:hover:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20'
                        }`}
                        aria-label={t('header.trends')}
                    >
                        <FireIcon className="w-4 h-4" />
                    </button>

                    {/* Desktop View Mode Switcher - only show on news view */}
                    {currentView === 'news' && (
                        <div className="hidden sm:flex items-center bg-slate-200 dark:bg-zinc-800 p-1 rounded-lg">
                            {viewOptions.map(option => (
                                <button
                                    key={option.mode}
                                    onClick={() => setViewMode(option.mode)}
                                    className={`px-3 py-2.5 rounded-md text-sm font-medium transition-all ${
                                        viewMode === option.mode
                                            ? 'bg-white dark:bg-zinc-700 text-indigo-600 dark:text-indigo-400 shadow'
                                            : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-300/50 dark:hover:bg-zinc-700/50'
                                    }`}
                                    aria-label={`Switch to ${option.mode} view`}
                                >
                                    {option.icon}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Mobile View Mode Switcher - only show on news view */}
                    {currentView === 'news' && (
                        <div ref={menuRef} className="relative sm:hidden">
                            <button
                                onClick={() => setIsViewMenuOpen(!isViewMenuOpen)}
                                className="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 transition-all"
                                aria-label="Change view mode"
                                aria-haspopup="true"
                                aria-expanded={isViewMenuOpen}
                            >
                                {currentViewIcon}
                            </button>
                            {isViewMenuOpen && (
                                <div className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-zinc-800 rounded-lg shadow-lg ring-1 ring-black/5 p-2 z-30">
                                    <div className="flex flex-col gap-1">
                                        {viewOptions.map(option => (
                                            <button
                                                key={option.mode}
                                                onClick={() => {
                                                    setViewMode(option.mode);
                                                    setIsViewMenuOpen(false);
                                                }}
                                                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium w-full text-left transition-colors ${
                                                    viewMode === option.mode
                                                        ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400'
                                                        : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-700'
                                                }`}
                                            >
                                                {option.icon}
                                                <span>{option.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Refresh Button with Badge */}
                    <div className="relative">
                        <button
                            onClick={newArticlesCount > 0 ? onLoadNewArticles : onRefresh}
                            disabled={isRefreshing}
                            className={`relative w-9 h-9 sm:w-11 sm:h-11 flex items-center justify-center rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                                newArticlesCount > 0 
                                    ? 'bg-indigo-100 dark:bg-indigo-900/30 hover:bg-indigo-200 dark:hover:bg-indigo-900/50' 
                                    : 'bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700'
                            }`}
                            aria-label={newArticlesCount > 0 ? t('header.loadNewArticles', { count: newArticlesCount }) : t('header.refresh')}
                        >
                            <ResetIcon className={`w-4 h-4 sm:w-5 sm:h-5 transition-transform ${isRefreshing ? 'animate-spin' : ''}`} />
                        </button>
                        {newArticlesCount > 0 && (
                            <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[20px] h-5 px-1 text-xs font-bold text-white bg-red-500 rounded-full animate-pulse">
                                {newArticlesCount > 99 ? '99+' : newArticlesCount}
                            </span>
                        )}
                    </div>

                    {/* Language Switcher */}
                    <LanguageSwitcher />

                    {/* Theme Toggle */}
                    <button
                        onClick={toggleTheme}
                        className="w-9 h-9 sm:w-11 sm:h-11 flex items-center justify-center rounded-lg bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 transition-all"
                        aria-label={t('header.toggleTheme')}
                    >
                        {theme === 'light' ? <MoonIcon className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600" /> : <SunIcon className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-400" />}
                    </button>

                    {/* Settings Button */}
                    <button
                        onClick={onOpenSettings}
                        className="w-9 h-9 sm:w-11 sm:h-11 flex items-center justify-center rounded-lg bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 transition-all"
                        aria-label={t('header.openSettings')}
                    >
                        <SettingsIcon className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600 dark:text-zinc-300" />
                    </button>
                </div>
            </div>
        </header>
    );
};