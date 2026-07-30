import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { FeedHeartbeat } from '../../types';
import type { AdminFeedHealthRow, AdminHealthReport } from '../../services/admin-health-report';
import { FeedHeartbeatPanel } from './FeedHeartbeatPanel';
import {
    CheckCircleIcon, XCircleIcon, QuestionMarkCircleIcon, LoadingSpinner, WarningIcon, ChevronDownIcon, ChevronUpIcon
} from '../Icons';

// --- Types ---
type SortableKey = 'name' | 'status' | 'details';
type SortDirection = 'ascending' | 'descending';


// --- Reusable Components ---

const HealthStatusCell: React.FC<{ status: AdminFeedHealthRow['status'] }> = ({ status }) => {
    const { t } = useTranslation();

    const styles = {
        ok: { icon: <CheckCircleIcon className="w-5 h-5" />, text: t('admin.health.statusOk'), colors: 'text-green-600 dark:text-green-400' },
        warning: { icon: <WarningIcon className="w-5 h-5" />, text: t('admin.health.statusWarning'), colors: 'text-amber-600 dark:text-amber-400' },
        error: { icon: <XCircleIcon className="w-5 h-5" />, text: t('admin.health.statusError'), colors: 'text-red-600 dark:text-red-400' },
        unknown: { icon: <QuestionMarkCircleIcon className="w-5 h-5" />, text: t('admin.health.statusUnknown'), colors: 'text-slate-500 dark:text-zinc-400' },
    };

    const currentStyle = styles[status];

    return (
        <div className={`flex items-center gap-2 font-semibold ${currentStyle.colors}`}>
            {currentStyle.icon}
            <span>{currentStyle.text}</span>
        </div>
    );
};

const SortableHeader: React.FC<{
    label: string;
    sortKey: SortableKey;
    sortConfig: { key: SortableKey; direction: SortDirection } | null;
    requestSort: (key: SortableKey) => void;
    className?: string;
}> = ({ label, sortKey, sortConfig, requestSort, className = "" }) => {
    const isSorting = sortConfig?.key === sortKey;
    const direction = sortConfig?.direction;

    return (
        <th scope="col" className={`p-4 ${className}`}>
            <button type="button" onClick={() => requestSort(sortKey)} className="flex items-center gap-1.5 group whitespace-nowrap">
                <span>{label}</span>
                <div className="flex flex-col">
                    <ChevronUpIcon className={`w-3 h-3 transition-colors ${isSorting && direction === 'ascending' ? 'text-indigo-500' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-zinc-200'}`} />
                    <ChevronDownIcon className={`w-3 h-3 transition-colors ${isSorting && direction === 'descending' ? 'text-indigo-500' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-zinc-200'}`} />
                </div>
            </button>
        </th>
    );
};

/**
 * Eine der drei Kennzahlen mit ihrer Herkunft.
 *
 * Sie beantworten verschiedene Fragen und dürfen deshalb nicht als eine Zahl
 * gelesen werden: die Datenbank kennt alle konfigurierten Feeds, der aktive
 * Snapshot nur die Quellen des letzten Publish, und die lokale Kopie den Stand
 * genau dieses Browsers.
 */
const SourceMetric: React.FC<{
    id: string;
    label: string;
    value: string;
    hint: string;
    note?: string | null;
}> = ({ id, label, value, hint, note }) => (
    <div className="p-4 rounded-lg bg-slate-50 dark:bg-zinc-900/40 border border-slate-200 dark:border-zinc-700">
        <dt className="text-sm font-semibold text-slate-600 dark:text-zinc-300" id={`${id}-label`}>{label}</dt>
        <dd
            id={id}
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-hint`}
            className="mt-1 text-2xl font-bold text-slate-800 dark:text-zinc-100"
        >
            {value}
        </dd>
        <p id={`${id}-hint`} className="mt-2 text-xs text-slate-500 dark:text-zinc-400">{hint}</p>
        {note && <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">{note}</p>}
    </div>
);


// --- Main Tab Component ---

interface HealthCenterTabProps {
    report: AdminHealthReport;
    heartbeat: FeedHeartbeat | null;
    onReloadReport: () => void;
    isReloadingReport: boolean;
}

export const HealthCenterTab: React.FC<HealthCenterTabProps> = ({
                                                                    report,
                                                                    heartbeat,
                                                                    onReloadReport,
                                                                    isReloadingReport
                                                                }) => {
    const { t } = useTranslation();
    const [sortConfig, setSortConfig] = useState<{ key: SortableKey; direction: SortDirection } | null>({ key: 'status', direction: 'ascending' });

    const requestSort = (key: SortableKey) => {
        let direction: SortDirection = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const rows = useMemo(() => report.rows.map(row => ({
        ...row,
        detail: t(row.detailKey, row.detailParams),
    })), [report.rows, t]);

    const sortedRows = useMemo(() => {
        const sortableItems = [...rows];
        if (sortConfig) {
            sortableItems.sort((a, b) => {
                let aValue: string | number = '';
                let bValue: string | number = '';

                switch (sortConfig.key) {
                    case 'name':
                        aValue = a.name;
                        bValue = b.name;
                        break;
                    case 'status': {
                        const healthOrder: Record<AdminFeedHealthRow['status'], number> = { error: 0, warning: 1, unknown: 2, ok: 3 };
                        aValue = healthOrder[a.status];
                        bValue = healthOrder[b.status];
                        break;
                    }
                    case 'details':
                        aValue = a.detail;
                        bValue = b.detail;
                        break;
                }

                if (typeof aValue === 'string' && typeof bValue === 'string') {
                    return sortConfig.direction === 'ascending' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
                }
                if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [rows, sortConfig]);

    const unknownValue = t('admin.health.metrics.unavailable');
    const snapshotLabel = (snapshotId: string | null) => (
        snapshotId === null
            ? t('admin.health.metrics.snapshotLegacy')
            : t('admin.health.metrics.snapshotId', { id: snapshotId })
    );

    const localCacheNote = {
        missing: t('admin.health.metrics.localMissing'),
        unreadable: t('admin.health.metrics.localUnreadable'),
        expired: t('admin.health.metrics.localExpired'),
        usable: snapshotLabel(report.localSnapshotId),
    }[report.localCacheStatus];

    const comparisonText = {
        same: t('admin.health.metrics.compareSame'),
        different: t('admin.health.metrics.compareDifferent', {
            active: report.activeSnapshotId ?? '',
            local: report.localSnapshotId ?? '',
        }),
        unknown: t('admin.health.metrics.compareUnknown'),
    }[report.snapshotComparison];

    return (
        <section className="bg-white dark:bg-zinc-800 rounded-lg shadow overflow-hidden">
            <FeedHeartbeatPanel heartbeat={heartbeat} />
            <div className="p-4 flex flex-col sm:flex-row justify-between items-center gap-3 border-b border-slate-200 dark:border-zinc-700">
                <div className="text-center sm:text-left">
                    <h2 className="text-lg font-semibold">{t('admin.health.title')}</h2>
                    <p className="text-sm text-slate-500 dark:text-zinc-400">{t('admin.health.description')}</p>
                </div>
                <div className="w-full sm:w-auto sm:max-w-xs">
                    <button
                        type="button"
                        onClick={onReloadReport}
                        disabled={isReloadingReport}
                        aria-describedby="admin-reload-report-hint"
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-slate-200 dark:bg-zinc-700 text-slate-700 dark:text-zinc-200 hover:bg-slate-300 dark:hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-wait"
                    >
                        {isReloadingReport ? <LoadingSpinner className="w-5 h-5"/> : <CheckCircleIcon className="w-5 h-5"/>}
                        <span>{t('admin.health.reloadReport')}</span>
                    </button>
                    {/* Der Klick startet ausdruecklich keinen Feed-Abruf. */}
                    <p id="admin-reload-report-hint" className="mt-2 text-xs text-slate-500 dark:text-zinc-400">
                        {t('admin.health.reloadReportHint')}
                    </p>
                </div>
            </div>

            <section aria-labelledby="admin-source-metrics-title" className="p-4 border-b border-slate-200 dark:border-zinc-700">
                <h3 id="admin-source-metrics-title" className="text-base font-semibold">
                    {t('admin.health.metrics.title')}
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
                    {t('admin.health.metrics.description')}
                </p>
                <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                    <SourceMetric
                        id="admin-metric-configured"
                        label={t('admin.health.metrics.configuredLabel')}
                        value={String(report.configuredFeedCount)}
                        hint={t('admin.health.metrics.configuredHint')}
                    />
                    <SourceMetric
                        id="admin-metric-snapshot"
                        label={t('admin.health.metrics.snapshotLabel')}
                        value={report.activeSnapshotSourceCount === null
                            ? unknownValue
                            : String(report.activeSnapshotSourceCount)}
                        hint={t('admin.health.metrics.snapshotHint')}
                        note={snapshotLabel(report.activeSnapshotId)}
                    />
                    <SourceMetric
                        id="admin-metric-local"
                        label={t('admin.health.metrics.localLabel')}
                        value={report.localCacheSourceCount === null
                            ? unknownValue
                            : String(report.localCacheSourceCount)}
                        hint={t('admin.health.metrics.localHint')}
                        note={localCacheNote}
                    />
                </dl>
                <p className="mt-4 text-sm text-slate-600 dark:text-zinc-300">{comparisonText}</p>

                {report.unmatchedSnapshotSources.length > 0 && (
                    <div className="mt-4">
                        <h4 className="text-sm font-semibold">{t('admin.health.metrics.unmatchedTitle')}</h4>
                        <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                            {t('admin.health.metrics.unmatchedHint')}
                        </p>
                        <ul id="admin-unmatched-snapshot-sources" className="mt-2 flex flex-wrap gap-2">
                            {report.unmatchedSnapshotSources.map(source => (
                                <li key={source} className="px-2 py-1 rounded bg-slate-100 dark:bg-zinc-700 text-xs font-mono">
                                    {source}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </section>

            {/* Desktop Table */}
            <div className="overflow-x-auto hidden md:block">
                <table className="w-full text-sm text-left table-auto">
                    <thead className="bg-slate-50 dark:bg-zinc-700/50 text-xs uppercase text-slate-500 dark:text-zinc-400">
                    <tr>
                        <SortableHeader label={t('admin.health.headerName')} sortKey="name" sortConfig={sortConfig} requestSort={requestSort} className="w-1/4"/>
                        <SortableHeader label={t('admin.health.headerStatus')} sortKey="status" sortConfig={sortConfig} requestSort={requestSort} className="w-40"/>
                        <SortableHeader label={t('admin.health.headerDetails')} sortKey="details" sortConfig={sortConfig} requestSort={requestSort} className="w-1/2"/>
                    </tr>
                    </thead>
                    <tbody>
                    {sortedRows.map(row => (
                        <tr key={row.feedId} className="border-b dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800/50">
                            <td className="p-4 font-medium truncate">{row.name}</td>
                            <td className="p-4"><HealthStatusCell status={row.status} /></td>
                            <td className="p-4 text-slate-500 dark:text-zinc-400">{row.detail}</td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden p-4 space-y-4 bg-slate-50 dark:bg-zinc-900/50">
                {sortedRows.map(row => (
                    <div key={row.feedId} className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4 space-y-3">
                        <div className="flex justify-between items-start gap-2">
                            <p className="font-bold text-lg break-words">{row.name}</p>
                        </div>
                        <div>
                            <HealthStatusCell status={row.status} />
                        </div>
                        <div className="text-sm text-slate-500 dark:text-zinc-400 pt-2 border-t border-slate-100 dark:border-zinc-700">
                            <p className="font-semibold text-slate-600 dark:text-zinc-300 mb-1">{t('admin.health.headerDetails')}:</p>
                            <p>{row.detail}</p>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};
