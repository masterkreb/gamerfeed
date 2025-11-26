import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Announcement, AnnouncementType } from '../types';
import { XCircleIcon } from './Icons';

const typeStyles: Record<AnnouncementType, { bg: string; border: string; text: string; icon: string }> = {
    info: {
        bg: 'bg-blue-50 dark:bg-blue-900/30',
        border: 'border-blue-200 dark:border-blue-700',
        text: 'text-blue-800 dark:text-blue-200',
        icon: 'ℹ️',
    },
    warning: {
        bg: 'bg-amber-50 dark:bg-amber-900/30',
        border: 'border-amber-200 dark:border-amber-700',
        text: 'text-amber-800 dark:text-amber-200',
        icon: '⚠️',
    },
    maintenance: {
        bg: 'bg-red-50 dark:bg-red-900/30',
        border: 'border-red-200 dark:border-red-700',
        text: 'text-red-800 dark:text-red-200',
        icon: '🔧',
    },
    celebration: {
        bg: 'bg-green-50 dark:bg-green-900/30',
        border: 'border-green-200 dark:border-green-700',
        text: 'text-green-800 dark:text-green-200',
        icon: '🎉',
    },
};

interface AnnouncementBannerProps {
    announcement: Announcement | null;
    onDismiss: (id: string) => void;
}

export const AnnouncementBanner: React.FC<AnnouncementBannerProps> = ({ announcement, onDismiss }) => {
    const { t } = useTranslation();
    
    if (!announcement || !announcement.isActive) {
        return null;
    }

    const style = typeStyles[announcement.type];

    return (
        <div className={`${style.bg} ${style.border} border-b`}>
            <div className="container mx-auto px-2 sm:px-4 md:px-6 py-2.5 sm:py-3">
                <div className="flex items-start sm:items-center justify-between gap-3">
                    <div className="flex items-start sm:items-center gap-2 sm:gap-3 flex-1 min-w-0">
                        <span className="text-lg flex-shrink-0 mt-0.5 sm:mt-0" role="img" aria-hidden="true">
                            {style.icon}
                        </span>
                        <p className={`text-sm sm:text-base ${style.text}`}>
                            {announcement.message}
                        </p>
                    </div>
                    <button
                        onClick={() => onDismiss(announcement.id)}
                        className={`flex-shrink-0 p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors ${style.text} mt-0.5 sm:mt-0`}
                        aria-label={t('announcement.dismiss')}
                    >
                        <XCircleIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    );
};
