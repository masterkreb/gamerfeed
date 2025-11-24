import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TrendItem, TrendsData } from '../types';
import { LoadingSpinner, ArrowLeftIcon } from './Icons';

// Fire Icon für Trends
const FireIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path fillRule="evenodd" d="M12.963 2.286a.75.75 0 00-1.071-.136 9.742 9.742 0 00-3.539 6.177A7.547 7.547 0 016.648 6.61a.75.75 0 00-1.152.082A9 9 0 1015.68 4.534a7.46 7.46 0 01-2.717-2.248zM15.75 14.25a3.75 3.75 0 11-7.313-1.172c.628.465 1.35.81 2.133 1a5.99 5.99 0 011.925-3.545 3.75 3.75 0 013.255 3.717z" clipRule="evenodd" />
    </svg>
);

// Sonnen-Icon für Tages-Trends
const SunIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
    </svg>
);

// Kalender-Icon für Wochen-Trends
const CalendarIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
);

// Newspaper Icon für Weekly Summary
const NewspaperIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
    </svg>
);

interface TrendsViewProps {
    onBackToNews: () => void;
    onTrendClick: (topic: string) => void;
}

const getRankBadge = (rank: number): string => {
    switch (rank) {
        case 1: return '🥇';
        case 2: return '🥈';
        case 3: return '🥉';
        default: return `${rank}.`;
    }
};

const formatUpdatedAt = (dateString: string, t: any): string => {
    if (!dateString) return '';
    
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    
    if (diffMins < 1) return t('trends.updatedJustNow');
    if (diffMins < 60) return t('trends.updatedMinutesAgo', { count: diffMins });
    if (diffHours < 24) return t('trends.updatedHoursAgo', { count: diffHours });
    
    return date.toLocaleDateString();
};

interface TrendCardProps {
    trend: TrendItem;
    rank: number;
    onTrendClick: (topic: string) => void;
}

const TrendCard: React.FC<TrendCardProps> = ({ trend, rank, onTrendClick }) => {
    const { t } = useTranslation();
    
    return (
        <button
            onClick={() => onTrendClick(trend.topic)}
            className="w-full text-left bg-white dark:bg-zinc-800 rounded-xl p-5 border border-slate-200 dark:border-zinc-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-lg transition-all duration-200 group"
        >
            <div className="flex items-start gap-3">
                <span className={`text-xl flex-shrink-0 ${rank <= 3 ? '' : 'text-slate-500 dark:text-zinc-400 font-semibold'}`}>
                    {getRankBadge(rank)}
                </span>
                <div className="flex-grow min-w-0">
                    <h3 className="font-semibold text-lg text-slate-800 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {trend.topic}
                    </h3>
                    
                    {/* Summary */}
                    {trend.summary && (
                        <p className="mt-2 text-sm text-slate-600 dark:text-zinc-400 line-clamp-2">
                            {trend.summary}
                        </p>
                    )}
                    
                    {/* Read Articles Link */}
                    <div className="mt-3">
                        <span className="text-sm font-medium text-indigo-500 dark:text-indigo-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 inline-flex items-center gap-1">
                            {t('trends.readArticles')}
                            <svg className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </span>
                    </div>
                </div>
            </div>
        </button>
    );
};

interface TrendSectionProps {
    title: string;
    icon: React.ReactNode;
    trends: TrendItem[];
    updatedAt: string;
    onTrendClick: (topic: string) => void;
    accentColor: string;
}

const TrendSection: React.FC<TrendSectionProps> = ({ 
    title, 
    icon, 
    trends, 
    updatedAt, 
    onTrendClick,
    accentColor 
}) => {
    const { t } = useTranslation();
    
    return (
        <section className="mb-10">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${accentColor}`}>
                        {icon}
                    </div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-zinc-100">
                        {title}
                    </h2>
                </div>
                {updatedAt && (
                    <span className="text-sm text-slate-500 dark:text-zinc-400">
                        {formatUpdatedAt(updatedAt, t)}
                    </span>
                )}
            </div>
            
            <div className="space-y-4">
                {trends.map((trend, index) => (
                    <TrendCard
                        key={trend.topic}
                        trend={trend}
                        rank={index + 1}
                        onTrendClick={onTrendClick}
                    />
                ))}
            </div>
        </section>
    );
};

// Weekly Summary Box Component
const WeeklySummaryBox: React.FC<{ summary: string }> = ({ summary }) => {
    const { t } = useTranslation();
    
    if (!summary) return null;
    
    return (
        <div className="mb-6 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-xl p-5 border border-purple-200 dark:border-purple-800">
            <div className="flex items-start gap-3">
                <div className="p-2 bg-purple-100 dark:bg-purple-800 rounded-lg flex-shrink-0">
                    <NewspaperIcon className="w-5 h-5 text-purple-600 dark:text-purple-300" />
                </div>
                <div>
                    <h3 className="font-semibold text-purple-800 dark:text-purple-200 mb-2">
                        {t('trends.weeklySummaryTitle')}
                    </h3>
                    <p className="text-sm text-purple-700 dark:text-purple-300 leading-relaxed">
                        {summary}
                    </p>
                </div>
            </div>
        </div>
    );
};

export const TrendsView: React.FC<TrendsViewProps> = ({ onBackToNews, onTrendClick }) => {
    const { t } = useTranslation();
    const [trendsData, setTrendsData] = useState<TrendsData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadTrends = async () => {
            setIsLoading(true);
            setError(null);
            
            try {
                const response = await fetch('/api/get-trends');
                if (!response.ok) {
                    throw new Error(`Failed to load trends: ${response.status}`);
                }
                const data: TrendsData = await response.json();
                setTrendsData(data);
            } catch (err) {
                console.error('Failed to fetch trends:', err);
                setError(err instanceof Error ? err.message : 'Unknown error');
            } finally {
                setIsLoading(false);
            }
        };

        loadTrends();
    }, []);

    const handleTrendClick = (topic: string) => {
        onTrendClick(topic);
    };

    return (
        <div className="animate-fade-in">
            {/* Back Button */}
            <button
                onClick={onBackToNews}
                className="inline-flex items-center gap-2 text-slate-600 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors mb-6 group"
            >
                <ArrowLeftIcon className="w-5 h-5 transform group-hover:-translate-x-1 transition-transform" />
                <span className="font-medium">{t('trends.backToNews')}</span>
            </button>

            {/* Page Header */}
            <div className="flex items-center gap-3 mb-8">
                <div className="p-3 bg-gradient-to-br from-orange-400 to-red-500 rounded-xl">
                    <FireIcon className="w-7 h-7 text-white" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-zinc-100">
                        {t('trends.pageTitle')}
                    </h1>
                    <p className="text-slate-600 dark:text-zinc-400">
                        {t('trends.pageSubtitle')}
                    </p>
                </div>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="flex justify-center items-center h-64">
                    <LoadingSpinner />
                </div>
            ) : error ? (
                <div className="text-center py-16">
                    <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/50 mb-4">
                        <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                    </div>
                    <h3 className="text-xl font-semibold text-red-600 dark:text-red-400">{t('trends.errorLoading')}</h3>
                    <p className="mt-2 text-slate-600 dark:text-zinc-400">{error}</p>
                </div>
            ) : trendsData && (trendsData.daily.length > 0 || trendsData.weekly.length > 0) ? (
                <>
                    {/* Daily Trends */}
                    {trendsData.daily.length > 0 && (
                        <TrendSection
                            title={t('trends.todayTitle')}
                            icon={<SunIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
                            trends={trendsData.daily}
                            updatedAt={trendsData.dailyUpdatedAt}
                            onTrendClick={handleTrendClick}
                            accentColor="bg-amber-100 dark:bg-amber-900/30"
                        />
                    )}

                    {/* Weekly Section */}
                    {trendsData.weekly.length > 0 && (
                        <section>
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                                        <CalendarIcon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                                    </div>
                                    <h2 className="text-xl font-bold text-slate-800 dark:text-zinc-100">
                                        {t('trends.weeklyTitle')}
                                    </h2>
                                </div>
                                {trendsData.weeklyUpdatedAt && (
                                    <span className="text-sm text-slate-500 dark:text-zinc-400">
                                        {formatUpdatedAt(trendsData.weeklyUpdatedAt, t)}
                                    </span>
                                )}
                            </div>
                            
                            {/* Weekly Summary */}
                            <WeeklySummaryBox summary={trendsData.weeklySummary || ''} />
                            
                            {/* Weekly Trends */}
                            <div className="space-y-4">
                                {trendsData.weekly.map((trend, index) => (
                                    <TrendCard
                                        key={trend.topic}
                                        trend={trend}
                                        rank={index + 1}
                                        onTrendClick={handleTrendClick}
                                    />
                                ))}
                            </div>
                        </section>
                    )}
                </>
            ) : (
                <div className="text-center py-16">
                    <FireIcon className="w-16 h-16 mx-auto text-slate-400 dark:text-zinc-500 mb-4" />
                    <h3 className="text-xl font-semibold text-slate-700 dark:text-zinc-200">
                        {t('trends.noTrends')}
                    </h3>
                    <p className="mt-2 text-slate-600 dark:text-zinc-400">
                        {t('trends.noTrendsHint')}
                    </p>
                </div>
            )}
        </div>
    );
};

export default TrendsView;
