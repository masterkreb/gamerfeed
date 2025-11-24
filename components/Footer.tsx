import React from 'react';
import { useTranslation } from 'react-i18next';

export const Footer: React.FC = () => {
    const { t } = useTranslation();

    return (
        <footer className="bg-white/70 dark:bg-zinc-900/70 backdrop-blur-sm border-t border-slate-200 dark:border-zinc-800 mt-8">
            <div className="container mx-auto px-4 md:px-6 py-6 text-center text-sm text-slate-500 dark:text-zinc-400">
                <p>&copy; {new Date().getFullYear()} GamerFeed. {t('footer.rights')}</p>
                <p className="mt-1">
                    {t('footer.tagline')}
                </p>
            </div>
        </footer>
    );
};