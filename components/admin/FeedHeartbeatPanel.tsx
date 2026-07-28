import React from 'react';
import { useTranslation } from 'react-i18next';
import type { FeedHeartbeat, FeedRunResult } from '../../types';
import { CheckCircleIcon, WarningIcon, QuestionMarkCircleIcon } from '../Icons';

const MINUTE_MS = 60 * 1000;

const RUN_RESULT_KEYS: Record<FeedRunResult, string> = {
    running: 'admin.health.heartbeat.runResultRunning',
    success: 'admin.health.heartbeat.runResultSuccess',
    degraded: 'admin.health.heartbeat.runResultDegraded',
    fatal: 'admin.health.heartbeat.runResultFatal',
};

function formatTimestamp(iso: string | null, language: string, fallback: string): string {
    if (!iso) return fallback;

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return fallback;

    return date.toLocaleString(language);
}

interface HeartbeatCardProps {
    title: string;
    isStale: boolean;
    at: string | null;
    ageMs: number | null;
    details: string[];
    testId: string;
}

const HeartbeatCard: React.FC<HeartbeatCardProps> = ({ title, isStale, at, ageMs, details, testId }) => {
    const { t, i18n } = useTranslation();

    // Ohne Zeitstempel ist der Zustand nicht „gut“, sondern unbekannt. Farbe
    // allein traegt die Aussage nicht: Symbol und Text nennen sie ebenfalls.
    const state = at === null ? 'unknown' : (isStale ? 'stale' : 'fresh');
    const badge = {
        fresh: {
            icon: <CheckCircleIcon className="w-4 h-4" />,
            label: t('admin.health.heartbeat.fresh'),
            colors: 'text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/40',
        },
        stale: {
            icon: <WarningIcon className="w-4 h-4" />,
            label: t('admin.health.heartbeat.stale'),
            colors: 'text-red-700 dark:text-red-200 bg-red-100 dark:bg-red-900/40',
        },
        unknown: {
            icon: <QuestionMarkCircleIcon className="w-4 h-4" />,
            label: t('admin.health.heartbeat.never'),
            colors: 'text-slate-600 dark:text-zinc-300 bg-slate-200 dark:bg-zinc-700',
        },
    }[state];

    const ageMinutes = ageMs === null ? null : Math.max(0, Math.round(ageMs / MINUTE_MS));

    return (
        <div
            className="bg-slate-50 dark:bg-zinc-900/40 rounded-lg p-4 space-y-2"
            data-heartbeat={testId}
            data-heartbeat-state={state}
        >
            <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-sm">{title}</h3>
                <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${badge.colors}`}>
                    {badge.icon}
                    <span>{badge.label}</span>
                </span>
            </div>
            <p className="text-sm font-medium">
                {formatTimestamp(at, i18n.language, t('admin.health.heartbeat.never'))}
            </p>
            {ageMinutes !== null && (
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                    {t('admin.health.heartbeat.ageMinutes', { count: ageMinutes })}
                </p>
            )}
            {details.map(detail => (
                <p key={detail} className="text-xs text-slate-500 dark:text-zinc-400 break-words">{detail}</p>
            ))}
        </div>
    );
};

/**
 * Trennt die drei Fragen, die ein einzelner gruener Feed-Status bisher
 * vermischt hat: Ist der Workflow gelaufen, hat er veroeffentlicht, und ist der
 * Inhalt neu? Ein alter Erfolg bleibt so nicht laenger unbemerkt gruen.
 */
export const FeedHeartbeatPanel: React.FC<{ heartbeat: FeedHeartbeat | null }> = ({ heartbeat }) => {
    const { t, i18n } = useTranslation();

    if (!heartbeat) {
        return (
            <section className="p-4 border-b border-slate-200 dark:border-zinc-700" data-heartbeat="panel">
                <h2 className="text-base font-semibold">{t('admin.health.heartbeat.title')}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
                    {t('admin.health.heartbeat.unavailable')}
                </p>
            </section>
        );
    }

    const staleAfterMinutes = Math.round(heartbeat.staleAfterMs / MINUTE_MS);
    const { run, corePublish, content } = heartbeat;

    const runDetails = [
        run.runId ? t('admin.health.heartbeat.runId', { runId: run.runId }) : null,
        t('admin.health.heartbeat.runResult', {
            result: run.result
                ? t(RUN_RESULT_KEYS[run.result])
                : t('admin.health.heartbeat.runResultUnknown'),
        }),
        run.durations.totalMs === null
            ? null
            : t('admin.health.heartbeat.runDuration', { seconds: Math.round(run.durations.totalMs / 1000) }),
        run.fatalError ? t('admin.health.heartbeat.runFatalError', { message: run.fatalError }) : null,
    ].filter((detail): detail is string => detail !== null);

    const publishDetails = [
        t('admin.health.heartbeat.publishArticles', { count: corePublish.articleCount }),
        t('admin.health.heartbeat.feeds', {
            success: corePublish.feeds.success,
            total: corePublish.feeds.total,
        }),
    ];

    const contentDetails = [
        t('admin.health.heartbeat.contentNewestArticle', {
            timestamp: formatTimestamp(
                content.newestArticleAt,
                i18n.language,
                t('admin.health.heartbeat.never'),
            ),
        }),
    ];

    return (
        <section
            className="p-4 border-b border-slate-200 dark:border-zinc-700"
            data-heartbeat="panel"
            data-heartbeat-stale={String(heartbeat.isStale)}
        >
            <h2 className="text-base font-semibold">{t('admin.health.heartbeat.title')}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
                {t('admin.health.heartbeat.description', { minutes: staleAfterMinutes })}
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
                <HeartbeatCard
                    testId="run"
                    title={t('admin.health.heartbeat.runTitle')}
                    isStale={run.isStale}
                    at={run.at}
                    ageMs={run.ageMs}
                    details={runDetails}
                />
                <HeartbeatCard
                    testId="publish"
                    title={t('admin.health.heartbeat.publishTitle')}
                    isStale={corePublish.isStale}
                    at={corePublish.at}
                    ageMs={corePublish.ageMs}
                    details={publishDetails}
                />
                <HeartbeatCard
                    testId="content"
                    title={t('admin.health.heartbeat.contentTitle')}
                    isStale={content.isStale}
                    at={content.at}
                    ageMs={content.ageMs}
                    details={contentDetails}
                />
            </div>
        </section>
    );
};
