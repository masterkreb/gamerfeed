import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircleIcon, WarningIcon, XCircleIcon, QuestionMarkCircleIcon, LoadingSpinner } from '../Icons';

const LegendItem: React.FC<{
    icon: React.ReactNode;
    title: string;
    description: string;
}> = ({ icon, title, description }) => (
    <div className="flex items-start gap-4 p-4 rounded-lg bg-slate-50 dark:bg-zinc-800/50">
        <div className="flex-shrink-0 mt-1">{icon}</div>
        <div>
            <h4 className="font-semibold text-slate-800 dark:text-zinc-200">{title}</h4>
            <p className="text-sm text-slate-600 dark:text-zinc-400">{description}</p>
        </div>
    </div>
);

const ErrorCodeItem: React.FC<{
    code: string;
    meaning: string;
    details: string;
}> = ({ code, meaning, details }) => (
    <div className="p-4 border-l-4 border-slate-300 dark:border-zinc-600 bg-slate-50 dark:bg-zinc-800/50 rounded-r-lg">
        <h4 className="font-mono font-bold text-slate-800 dark:text-zinc-200">
            <span className="text-red-500">{code}</span> - {meaning}
        </h4>
        <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">{details}</p>
    </div>
);


export const HealthLegendTab: React.FC = () => {
    const { t } = useTranslation();

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <section className="bg-white dark:bg-zinc-800 rounded-lg shadow p-6">
                <h3 className="text-xl font-bold mb-4">{t('admin.legend.title')}</h3>
                <p className="text-sm text-slate-500 dark:text-zinc-400 mb-4">
                    {t('admin.legend.description')}
                </p>
                <div className="space-y-4">
                    <LegendItem
                        icon={<CheckCircleIcon className="w-6 h-6 text-green-500" />}
                        title={t('admin.legend.okTitle')}
                        description={t('admin.legend.okDesc')}
                    />
                    <LegendItem
                        icon={<WarningIcon className="w-6 h-6 text-amber-500" />}
                        title={t('admin.legend.warningTitle')}
                        description={t('admin.legend.warningDesc')}
                    />
                    <LegendItem
                        icon={<XCircleIcon className="w-6 h-6 text-red-500" />}
                        title={t('admin.legend.errorTitle')}
                        description={t('admin.legend.errorDesc')}
                    />
                    <LegendItem
                        icon={<LoadingSpinner className="w-5 h-5 text-indigo-500" />}
                        title={t('admin.legend.checkingTitle')}
                        description={t('admin.legend.checkingDesc')}
                    />
                    <LegendItem
                        icon={<QuestionMarkCircleIcon className="w-6 h-6 text-slate-400" />}
                        title={t('admin.legend.unknownTitle')}
                        description={t('admin.legend.unknownDesc')}
                    />
                </div>
            </section>
            <section className="bg-white dark:bg-zinc-800 rounded-lg shadow p-6">
                <h3 className="text-xl font-bold mb-4">{t('admin.legend.errorsTitle')}</h3>
                <p className="text-sm text-slate-500 dark:text-zinc-400 mb-4">
                    {t('admin.legend.errorsDesc')}
                </p>
                <div className="space-y-4">
                    <ErrorCodeItem
                        code="Failed to parse XML"
                        meaning={t('admin.legend.errorFormatMeaning')}
                        details={t('admin.legend.errorFormatDesc')}
                    />
                    <ErrorCodeItem
                        code="Fetch failed"
                        meaning={t('admin.legend.errorFetchMeaning')}
                        details={t('admin.legend.errorFetchDesc')}
                    />
                    <ErrorCodeItem
                        code="Status 403 / 404 / 500"
                        meaning={t('admin.legend.errorServerMeaning')}
                        details={t('admin.legend.errorServerDesc')}
                    />
                    <ErrorCodeItem
                        code="Not processed"
                        meaning={t('admin.legend.errorScriptMeaning')}
                        details={t('admin.legend.errorScriptDesc')}
                    />
                </div>
            </section>
        </div>
    );
};