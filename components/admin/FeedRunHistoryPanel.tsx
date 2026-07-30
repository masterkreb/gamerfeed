import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { FeedRunHistoryEntry } from '../../types';
import { FEED_RUN_HISTORY_LIMIT, summarizeRunHistory } from '../../shared/feed-run-history.js';
import { getDateLocale } from '../../shared/i18n-locale';
import { CheckCircleIcon, WarningIcon, XCircleIcon } from '../Icons';

type HistoryResult = FeedRunHistoryEntry['result'];

const SECOND_MS = 1000;

/**
 * Darstellung eines Ergebnisses.
 *
 * Symbol **und** Text tragen die Aussage; die Farbe kommt nur hinzu. Ein
 * ausschliesslich farblich unterschiedener „abgebrochen“-Lauf waere fuer
 * Farbfehlsichtige und in Graustufen nicht lesbar.
 */
const RESULT_STYLES: Record<HistoryResult, { icon: React.ReactNode; labelKey: string; colors: string }> = {
    success: {
        icon: <CheckCircleIcon className="w-4 h-4" />,
        labelKey: 'admin.health.runHistory.resultSuccess',
        colors: 'text-green-700 dark:text-green-300',
    },
    degraded: {
        icon: <WarningIcon className="w-4 h-4" />,
        labelKey: 'admin.health.runHistory.resultDegraded',
        colors: 'text-amber-700 dark:text-amber-300',
    },
    fatal: {
        icon: <XCircleIcon className="w-4 h-4" />,
        labelKey: 'admin.health.runHistory.resultFatal',
        colors: 'text-red-700 dark:text-red-300',
    },
};

function formatTimestamp(iso: string, language: string, fallback: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return fallback;

    // Datum und Uhrzeit folgen der gewaehlten App-Sprache, nicht der
    // Browsersprache: sonst zeigte ein englisch bedientes Admin deutsche Daten.
    return date.toLocaleString(getDateLocale(language));
}

const ResultCell: React.FC<{ result: HistoryResult }> = ({ result }) => {
    const { t } = useTranslation();
    const style = RESULT_STYLES[result];

    return (
        <span className={`flex items-center gap-1.5 font-semibold whitespace-nowrap ${style.colors}`}>
            {style.icon}
            <span>{t(style.labelKey)}</span>
        </span>
    );
};

const HistoryFrame: React.FC<{ state: string; children: React.ReactNode }> = ({ state, children }) => {
    const { t } = useTranslation();

    return (
        <section
            className="p-4 border-b border-slate-200 dark:border-zinc-700"
            aria-labelledby="admin-run-history-title"
            data-run-history="panel"
            data-run-history-state={state}
        >
            <h2 id="admin-run-history-title" className="text-base font-semibold">
                {t('admin.health.runHistory.title')}
            </h2>
            {children}
        </section>
    );
};

/**
 * Begrenzte Historie der zuletzt **abgeschlossenen** Cron-Laeufe (O4b).
 *
 * Der Heartbeat daneben zeigt genau einen Lauf; erst mehrere Laeufe machen eine
 * Haeufung sichtbar. Drei Zustaende werden ausdruecklich unterschieden:
 *
 * - `null`  – die Historie war nicht lesbar;
 * - `[]`    – sie wurde gelesen und ist noch leer;
 * - Eintraege – die tatsaechlich festgehaltenen Laeufe.
 *
 * Was die Historie **nicht** kann: einen Workflow melden, der gar nicht erst
 * gestartet ist. Ein nie gelaufener Versuch schreibt auch keinen Eintrag. Diese
 * Luecke schliesst eine unabhaengige Alarmierung (O4c), nicht diese Anzeige.
 */
export const FeedRunHistoryPanel: React.FC<{ entries: FeedRunHistoryEntry[] | null }> = ({ entries }) => {
    const { t, i18n } = useTranslation();

    const summary = useMemo(() => summarizeRunHistory(entries ?? []), [entries]);

    if (entries === null) {
        return (
            <HistoryFrame state="unavailable">
                <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
                    {t('admin.health.runHistory.unavailable')}
                </p>
            </HistoryFrame>
        );
    }

    if (entries.length === 0) {
        return (
            <HistoryFrame state="empty">
                <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
                    {t('admin.health.runHistory.empty')}
                </p>
            </HistoryFrame>
        );
    }

    const never = t('admin.health.runHistory.unknownTimestamp');

    return (
        <HistoryFrame state="data">
            <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
                {t('admin.health.runHistory.description', { limit: FEED_RUN_HISTORY_LIMIT })}
            </p>
            <p className="mt-2 text-sm text-slate-600 dark:text-zinc-300" data-run-history="summary">
                {t('admin.health.runHistory.summary', {
                    total: summary.total,
                    success: summary.success,
                    degraded: summary.degraded,
                    fatal: summary.fatal,
                })}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                {t('admin.health.runHistory.scopeHint')}
            </p>

            <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm text-left table-auto">
                    <caption className="sr-only">{t('admin.health.runHistory.tableCaption')}</caption>
                    <thead className="bg-slate-50 dark:bg-zinc-700/50 text-xs uppercase text-slate-500 dark:text-zinc-400">
                        <tr>
                            <th scope="col" className="p-3">{t('admin.health.runHistory.headerFinishedAt')}</th>
                            <th scope="col" className="p-3">{t('admin.health.runHistory.headerResult')}</th>
                            <th scope="col" className="p-3">{t('admin.health.runHistory.headerDuration')}</th>
                            <th scope="col" className="p-3">{t('admin.health.runHistory.headerFeeds')}</th>
                            <th scope="col" className="p-3">{t('admin.health.runHistory.headerReason')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map(entry => {
                            const reason = entry.result === 'fatal' ? entry.fatalError : entry.degradedReason;

                            return (
                                <tr
                                    key={`${entry.finishedAt}-${entry.runId ?? 'ohne-kennung'}`}
                                    className="border-b dark:border-zinc-700"
                                    data-run-history-row={entry.result}
                                >
                                    <th scope="row" className="p-3 font-medium whitespace-nowrap">
                                        {formatTimestamp(entry.finishedAt, i18n.language, never)}
                                    </th>
                                    <td className="p-3">
                                        <ResultCell result={entry.result} />
                                    </td>
                                    <td className="p-3 whitespace-nowrap text-slate-500 dark:text-zinc-400">
                                        {entry.durations.totalMs === null
                                            ? t('admin.health.runHistory.durationUnknown')
                                            : t('admin.health.runHistory.durationSeconds', {
                                                seconds: Math.round(entry.durations.totalMs / SECOND_MS),
                                            })}
                                    </td>
                                    <td className="p-3 whitespace-nowrap text-slate-500 dark:text-zinc-400">
                                        {t('admin.health.runHistory.feedCounts', {
                                            success: entry.feeds.success,
                                            total: entry.feeds.total,
                                            warning: entry.feeds.warning,
                                            error: entry.feeds.error,
                                            unknown: entry.feeds.unknown,
                                        })}
                                    </td>
                                    <td className="p-3 text-slate-500 dark:text-zinc-400 break-words">
                                        {reason ?? t('admin.health.runHistory.reasonNone')}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </HistoryFrame>
    );
};
