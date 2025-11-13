import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme, ViewMode } from '../types';
import { SunIcon, MoonIcon, GridIcon, ListIcon, CompactIcon, ResetIcon, SettingsIcon } from './Icons';
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
}

export const Header: React.FC<HeaderProps> = ({ theme, setTheme, viewMode, setViewMode, isRefreshing, onRefresh, onOpenSettings, onLogoClick }) => {
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
            <div className="container mx-auto px-4 md:px-6 py-3 flex justify-between items-center">
                <button
                    onClick={onLogoClick}
                    aria-label="Go to homepage and reset filters"
                    className="transition-transform duration-200 focus:outline-none focus:ring-2 focus:ring-offset-4 focus:ring-offset-slate-100 dark:focus:ring-offset-zinc-900 focus:ring-indigo-500 rounded-lg"
                >
                    <h1 className="text-2xl font-bold text-indigo-500 dark:text-indigo-400">
                        {t('header.title')}
                    </h1>
                </button>

                <div className="flex items-center gap-2 md:gap-4">
                    {/* Desktop View Mode Switcher */}
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

                    {/* Mobile View Mode Switcher */}
                    <div ref={menuRef} className="relative sm:hidden">
                        <button
                            onClick={() => setIsViewMenuOpen(!isViewMenuOpen)}
                            className="w-11 h-11 flex items-center justify-center rounded-lg bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 transition-all"
                            aria-label="Change view mode"
                            aria-haspopup="true"
                            aria-expanded={isViewMenuOpen}
                        >
                            {currentViewIcon}
                        </button>
                        {isViewMenuOpen && (
                            <div className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-zinc-800 rounded-lg shadow-lg ring-1 ring-black ring-opacity-5 p-2 z-30">
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

                    {/* Refresh Button */}
                    <button
                        onClick={onRefresh}
                        disabled={isRefreshing}
                        className="relative w-11 h-11 flex items-center justify-center rounded-lg bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label={t('header.refresh')}
                    >
                        <ResetIcon className={`w-5 h-5 transition-transform ${isRefreshing ? 'animate-spin' : ''}`} />
                    </button>

                    {/* Language Switcher - NEU! */}
                    <LanguageSwitcher />

                    {/* Theme Toggle */}
                    <button
                        onClick={toggleTheme}
                        className="w-11 h-11 flex items-center justify-center rounded-lg bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 transition-all"
                        aria-label={t('header.toggleTheme')}
                    >
                        {theme === 'light' ? <MoonIcon className="w-5 h-5 text-indigo-600" /> : <SunIcon className="w-5 h-5 text-yellow-400" />}
                    </button>

                    {/* Settings Button */}
                    <button
                        onClick={onOpenSettings}
                        className="w-11 h-11 flex items-center justify-center rounded-lg bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 transition-all"
                        aria-label={t('header.openSettings')}
                    >
                        <SettingsIcon className="w-5 h-5 text-slate-600 dark:text-zinc-300" />
                    </button>
                </div>
            </div>
        </header>
    );
};