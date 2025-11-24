import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon, StarIcon } from './Icons';

interface FavoritesHeaderProps {
    totalFavorites: number;
    filteredFavoritesCount: number;
    onResetFilters: () => void;
    onExitFavorites: () => void;
}

export const FavoritesHeader: React.FC<FavoritesHeaderProps> = ({
                                                                    totalFavorites,
                                                                    filteredFavoritesCount,
                                                                    onResetFilters,
                                                                    onExitFavorites,
                                                                }) => {
    const { t } = useTranslation();
    const areFiltersActive = filteredFavoritesCount < totalFavorites;

    let content;

    if (areFiltersActive) {
        const message = filteredFavoritesCount === 0
            ? t('favorites.noMatch')
            : t('favorites.showingFiltered', { count: filteredFavoritesCount, filtered: filteredFavoritesCount, total: totalFavorites });

        content = (
            <p className="text-sm text-amber-700 dark:text-amber-300">
                {message}
                <button
                    onClick={onResetFilters}
                    className="font-bold underline ml-2 hover:text-amber-600 dark:hover:text-amber-100 transition-colors"
                >
                    {t('favorites.resetToViewAll')}
                </button>
            </p>
        );
    } else {
        content = (
            <button
                onClick={onExitFavorites}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-amber-200/50 dark:bg-amber-800/50 border border-amber-500 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800"
            >
                <ArrowLeftIcon className="w-5 h-5"/>
                <span>{t('favorites.viewAll')}</span>
            </button>
        );
    }

    return (
        <div className="mt-6 p-4 bg-amber-100 dark:bg-amber-900/30 border-l-4 border-amber-500 rounded-r-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 animate-fade-in">
            <div className="flex items-center gap-3">
                <StarIcon className="w-6 h-6 text-amber-500 flex-shrink-0" />
                <div>
                    <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-200">
                        {t('favorites.viewing')}
                    </h2>
                    {totalFavorites > 0 && !areFiltersActive && (
                        <p className="text-sm text-amber-700 dark:text-amber-300">
                            {t('favorites.showing', { count: totalFavorites })}
                        </p>
                    )}
                </div>
            </div>
            <div className="w-full sm:w-auto sm:ml-auto">
                {content}
            </div>
        </div>
    );
};