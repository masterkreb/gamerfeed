import React, { useState, useEffect } from 'react';
import type { FeedSource } from '../../types';

interface CachedArticle {
    source: string;
    title: string;
    imageUrl?: string;
}

interface CacheAnalysis {
    totalInDatabase: number;
    totalInCache: number;
    missingFromCache: string[];
    sourcesInCache: { [key: string]: number };
    articlesWithImages: number;
    articlesWithoutImages: number;
    articlesWithPlaceholders: number;
}

export const CacheAnalysisTab: React.FC<{ feeds: FeedSource[] }> = ({ feeds }) => {
    const [analysis, setAnalysis] = useState<CacheAnalysis | null>(null);
    const [loading, setLoading] = useState(false);
    const [cachedArticles, setCachedArticles] = useState<CachedArticle[]>([]);

    const analyzeCache = async () => {
        setLoading(true);
        try {
            // Lade news-cache.json
            const cacheResponse = await fetch('/news-cache.json');
            const cacheData = await cacheResponse.json();
            setCachedArticles(cacheData);

            // Analysiere
            const sourcesInCache: { [key: string]: number } = {};
            let articlesWithImages = 0;
            let articlesWithoutImages = 0;
            let articlesWithPlaceholders = 0;

            cacheData.forEach((article: CachedArticle) => {
                sourcesInCache[article.source] = (sourcesInCache[article.source] || 0) + 1;

                if (article.imageUrl) {
                    if (article.imageUrl.includes('placeholder') || article.imageUrl.includes('placehold')) {
                        articlesWithPlaceholders++;
                    } else {
                        articlesWithImages++;
                    }
                } else {
                    articlesWithoutImages++;
                }
            });

            // Finde fehlende Quellen
            const feedNames = feeds.map(f => f.name);
            const cacheSourceNames = Object.keys(sourcesInCache);
            const missingFromCache = feedNames.filter(name => !cacheSourceNames.includes(name));

            setAnalysis({
                totalInDatabase: feeds.length,
                totalInCache: cacheSourceNames.length,
                missingFromCache,
                sourcesInCache,
                articlesWithImages,
                articlesWithoutImages,
                articlesWithPlaceholders
            });
        } catch (error) {
            console.error('Error analyzing cache:', error);
            alert('Error loading cache. Make sure news-cache.json exists.');
        }
        setLoading(false);
    };

    useEffect(() => {
        analyzeCache();
    }, [feeds]);

    if (!analysis) {
        return (
            <div className="text-center py-8">
                <button
                    onClick={analyzeCache}
                    disabled={loading}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                    {loading ? 'Analyzing...' : 'Analyze Cache'}
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-50 dark:bg-zinc-900 rounded-lg p-6 border border-slate-200 dark:border-zinc-800">
                    <h3 className="text-sm font-semibold text-slate-600 dark:text-zinc-400 mb-2">Database Sources</h3>
                    <p className="text-3xl font-bold">{analysis.totalInDatabase}</p>
                </div>
                <div className="bg-slate-50 dark:bg-zinc-900 rounded-lg p-6 border border-slate-200 dark:border-zinc-800">
                    <h3 className="text-sm font-semibold text-slate-600 dark:text-zinc-400 mb-2">Sources in Cache</h3>
                    <p className="text-3xl font-bold text-green-600">{analysis.totalInCache}</p>
                </div>
                <div className="bg-slate-50 dark:bg-zinc-900 rounded-lg p-6 border border-slate-200 dark:border-zinc-800">
                    <h3 className="text-sm font-semibold text-slate-600 dark:text-zinc-400 mb-2">Missing Sources</h3>
                    <p className="text-3xl font-bold text-red-600">{analysis.missingFromCache.length}</p>
                </div>
            </div>

            {/* Image Statistics */}
            <div className="bg-slate-50 dark:bg-zinc-900 rounded-lg p-6 border border-slate-200 dark:border-zinc-800">
                <h3 className="text-lg font-bold mb-4">Image Statistics</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <p className="text-sm text-slate-600 dark:text-zinc-400">With Images</p>
                        <p className="text-2xl font-bold text-green-600">{analysis.articlesWithImages}</p>
                    </div>
                    <div>
                        <p className="text-sm text-slate-600 dark:text-zinc-400">With Placeholders</p>
                        <p className="text-2xl font-bold text-yellow-600">{analysis.articlesWithPlaceholders}</p>
                    </div>
                    <div>
                        <p className="text-sm text-slate-600 dark:text-zinc-400">No Images</p>
                        <p className="text-2xl font-bold text-red-600">{analysis.articlesWithoutImages}</p>
                    </div>
                </div>
            </div>

            {/* Missing Sources Alert */}
            {analysis.missingFromCache.length > 0 && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
                    <h3 className="text-lg font-bold text-red-900 dark:text-red-100 mb-3">
                        ⚠️ Missing Sources ({analysis.missingFromCache.length})
                    </h3>
                    <p className="text-sm text-red-700 dark:text-red-300 mb-4">
                        These sources are in the database but not found in news-cache.json.
                        Check GitHub Actions logs for fetching errors (403, timeout, etc.)
                    </p>
                    <div className="space-y-2">
                        {analysis.missingFromCache.map(source => {
                            const feed = feeds.find(f => f.name === source);
                            return (
                                <div key={source} className="bg-white dark:bg-zinc-900 rounded p-3 border border-red-200 dark:border-red-800">
                                    <p className="font-semibold">{source}</p>
                                    {feed && (
                                        <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1">{feed.url}</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Sources in Cache */}
            <div className="bg-slate-50 dark:bg-zinc-900 rounded-lg p-6 border border-slate-200 dark:border-zinc-800">
                <h3 className="text-lg font-bold mb-4">Articles per Source</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Object.entries(analysis.sourcesInCache)
                        .sort(([, a]: [string, number], [, b]: [string, number]) => b - a)
                        .map(([source, count]) => (
                            <div key={source} className="bg-white dark:bg-zinc-800 rounded p-3 border border-slate-200 dark:border-zinc-700">
                                <p className="font-semibold text-sm">{source}</p>
                                <p className="text-2xl font-bold text-blue-600">{count}</p>
                            </div>
                        ))}
                </div>
            </div>

            {/* Refresh Button */}
            <div className="text-center">
                <button
                    onClick={analyzeCache}
                    disabled={loading}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                    {loading ? 'Refreshing...' : '🔄 Refresh Analysis'}
                </button>
            </div>
        </div>
    );
};