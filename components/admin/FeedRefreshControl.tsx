import React from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from '../Icons';

interface FeedRefreshControlProps {
    onTriggerRefresh: () => void;
    isTriggeringRefresh: boolean;
    refreshFeedback: 'accepted' | 'unavailable' | 'failed' | null;
}

/** Der manuelle Start bleibt auch bei nicht lesbarer Feed-Liste erreichbar. */
export const FeedRefreshControl: React.FC<FeedRefreshControlProps> = ({
    onTriggerRefresh,
    isTriggeringRefresh,
    refreshFeedback,
}) => {
    const { t } = useTranslation();
    const feedbackKey = refreshFeedback === 'accepted'
        ? 'admin.health.refreshAccepted'
        : refreshFeedback === 'unavailable'
            ? 'admin.health.refreshUnavailable'
            : 'admin.health.refreshFailed';

    return (
        <section className="p-4 mb-4 bg-white dark:bg-zinc-800 rounded-lg shadow">
            <h2 className="text-lg font-semibold">{t('admin.health.refreshTitle')}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400" id="admin-refresh-feeds-hint">
                {t('admin.health.refreshHint')}
            </p>
            <button
                type="button"
                onClick={onTriggerRefresh}
                disabled={isTriggeringRefresh}
                aria-describedby="admin-refresh-feeds-hint"
                className="mt-3 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-wait"
            >
                {isTriggeringRefresh && <LoadingSpinner className="w-5 h-5" />}
                {t(isTriggeringRefresh ? 'admin.health.refreshRequesting' : 'admin.health.refreshButton')}
            </button>
            {refreshFeedback && (
                <p
                    role={refreshFeedback === 'accepted' ? 'status' : 'alert'}
                    className={`mt-3 text-sm ${refreshFeedback === 'accepted'
                        ? 'text-green-700 dark:text-green-300'
                        : 'text-red-700 dark:text-red-300'}`}
                >
                    {t(feedbackKey)}
                </p>
            )}
            <a
                href="https://github.com/masterkreb/gamerfeed/actions/workflows/update-feeds.yml"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm text-indigo-600 dark:text-indigo-400 underline"
            >
                {t('admin.health.refreshWorkflowLink')}
            </a>
        </section>
    );
};
