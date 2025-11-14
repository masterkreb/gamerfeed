import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { FeedSource } from '../../types';
import type { FeedHealth } from './AdminPanel';
import { HealthState } from './healthService';
import {
    PencilIcon, PlusIcon, TrashIcon, ChevronUpIcon, ChevronDownIcon,
    CheckCircleIcon, XCircleIcon, QuestionMarkCircleIcon, LoadingSpinner, ResetIcon, WarningIcon
} from '../Icons';

type SortableKey = keyof Omit<FeedSource, 'needsScraping' | 'id'> | 'health';
type SortDirection = 'ascending' | 'descending';

// --- Reusable Components ---

const HealthStatusIcon: React.FC<{ state: HealthState }> = ({ state }) => {
    const status = state?.status || 'unknown';
    const detail = state?.detail || 'No details available.';

    switch (status) {
        case 'ok':
            return <div title={detail}><CheckCircleIcon className="w-5 h-5 text-green-500" /></div>;
        case 'warning':
            return <div title={detail}><WarningIcon className="w-5 h-5 text-amber-500" /></div>;
        case 'error':
            return <div title={detail}><XCircleIcon className="w-5 h-5 text-red-500" /></div>;
        case 'checking':
            return <div title="Checking..."><LoadingSpinner className="w-4 h-4 text-indigo-500" /></div>;
        default:
            return <div title={detail}><QuestionMarkCircleIcon className="w-5 h-5 text-slate-400" /></div>;
    }
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
            <button onClick={() => requestSort(sortKey)} className="flex items-center gap-1.5 group whitespace-nowrap">
                <span>{label}</span>
                <div className="flex flex-col">
                    <ChevronUpIcon className={`w-3 h-3 transition-colors ${isSorting && direction === 'ascending' ? 'text-indigo-500' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-zinc-200'}`} />
                    <ChevronDownIcon className={`w-3 h-3 transition-colors ${isSorting && direction === 'descending' ? 'text-indigo-500' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-zinc-200'}`} />
                </div>
            </button>
        </th>
    );
};

// --- Main Tab Component ---

interface FeedManagementTabProps {
    feeds: FeedSource[];
    feedHealth: FeedHealth;
    onAddNew: () => void;
    onEdit: (feed: FeedSource) => void;
    onDelete: (feed: FeedSource) => void;
    onCheckHealth: () => void;
}

export const FeedManagementTab: React.FC<FeedManagementTabProps> = ({
                                                                        feeds,
                                                                        feedHealth,
                                                                        onAddNew,
                                                                        onEdit,
                                                                        onDelete,
                                                                        onCheckHealth
                                                                    }) => {
    const { t } = useTranslation();
    const [sortConfig, setSortConfig] = useState<{ key: SortableKey; direction: SortDirection } | null>({ key: 'name', direction: 'ascending' });

    const summary = useMemo(() => ({
        total: feeds.length,
        primary: feeds.filter(f => f.priority === 'primary').length,
        secondary: feeds.filter(f => f.priority === 'secondary').length,
    }), [feeds]);

    const sortedFeeds = useMemo(() => {
        let sortableItems = [...feeds];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                if (sortConfig.key === 'health') {
                    const healthOrder: Record<HealthState['status'], number> = { error: 0, warning: 1, checking: 2, unknown: 3, ok: 4 };
                    const healthA = healthOrder[feedHealth[a.id]?.status || 'unknown'];
                    const healthB = healthOrder[feedHealth[b.id]?.status || 'unknown'];
                    if (healthA < healthB) return sortConfig.direction === 'ascending' ? -1 : 1;
                    if (healthA > healthB) return sortConfig.direction === 'ascending' ? 1 : -1;
                    return 0;
                }

                const aValue = a[sortConfig.key as keyof Omit<FeedSource, 'needsScraping' | 'id'>];
                const bValue = b[sortConfig.key as keyof Omit<FeedSource, 'needsScraping' | 'id'>];

                if (typeof aValue === 'string' && typeof bValue === 'string') {
                    return sortConfig.direction === 'ascending' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
                }
                if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [feeds, sortConfig, feedHealth]);

    const requestSort = (key: SortableKey) => {
        let direction: SortDirection = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    return (
        <section className="bg-white dark:bg-zinc-800 rounded-lg shadow overflow-hidden">
            <div className="p-4 flex flex-col sm:flex-row justify-between items-center gap-3 border-b border-slate-200 dark:border-zinc-700">
                <div className="flex items-center gap-4">
                    <h2 className="text-lg font-semibold">{t('admin.management.title')}</h2>
                    <div className="hidden sm:flex items-center gap-4 text-sm text-slate-500 dark:text-zinc-400">
                        <span>{t('admin.management.total')} <span className="font-bold text-slate-700 dark:text-zinc-200">{summary.total}</span></span>
                        <span>{t('admin.management.primary')} <span className="font-bold text-indigo-500">{summary.primary}</span></span>
                        <span>{t('admin.management.secondary')} <span className="font-bold">{summary.secondary}</span></span>
                    </div>
                </div>
                <button onClick={onAddNew} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-indigo-600 text-white hover:bg-indigo-700">
                    <PlusIcon className="w-5 h-5" /><span>{t('admin.management.addNew')}</span>
                </button>
            </div>

            {/* Desktop Table */}
            <div className="overflow-x-auto hidden md:block">
                <table className="w-full text-sm text-left table-auto">
                    <thead className="bg-slate-50 dark:bg-zinc-700/50 text-xs uppercase text-slate-500 dark:text-zinc-400">
                    <tr>
                        <SortableHeader label={t('admin.management.headerName')} sortKey="name" sortConfig={sortConfig} requestSort={requestSort} className="w-1/4"/>
                        <SortableHeader label={t('admin.management.headerUrl')} sortKey="url" sortConfig={sortConfig} requestSort={requestSort} className="w-1/3"/>
                        <SortableHeader label={t('admin.management.headerPriority')} sortKey="priority" sortConfig={sortConfig} requestSort={requestSort} className="w-32" />
                        <SortableHeader label={t('admin.management.headerLang')} sortKey="language" sortConfig={sortConfig} requestSort={requestSort} className="w-24" />
                        <SortableHeader label={t('admin.management.headerInterval')} sortKey="update_interval" sortConfig={sortConfig} requestSort={requestSort} className="w-28" />
                        <SortableHeader label={t('admin.management.headerHealth')} sortKey="health" sortConfig={sortConfig} requestSort={requestSort} className="w-20 justify-center" />
                        <th scope="col" className="p-4 text-right w-28">{t('admin.management.headerActions')}</th>
                    </tr>
                    </thead>
                    <tbody>
                    {sortedFeeds.map(feed => (
                        <tr key={feed.id} className="border-b dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800/50">
                            <td className="p-4 font-medium truncate">{feed.name}</td>
                            <td className="p-4 text-slate-500 dark:text-zinc-400 truncate" title={feed.url}>{feed.url}</td>
                            <td className="p-4"><span className={`px-2 py-1 text-xs font-semibold rounded-full capitalize ${feed.priority === 'primary' ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' : 'bg-slate-100 dark:bg-zinc-700 text-slate-600 dark:text-zinc-300'}`}>{feed.priority}</span></td>
                            <td className="p-4 text-center"><span className="font-bold uppercase text-xs">{feed.language}</span></td>
                            <td className="p-4 text-center">{feed.update_interval} min</td>
                            <td className="p-4"><div className="flex justify-center items-center">
                                <HealthStatusIcon state={feedHealth[feed.id]} />
                            </div></td>
                            <td className="p-4 text-right"><div className="flex justify-end items-center gap-1">
                                <button onClick={onCheckHealth} className="p-2 text-slate-500 dark:text-zinc-400 hover:text-indigo-500 dark:hover:text-indigo-400 rounded-md hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors" aria-label={t('admin.management.ariaCheckHealth', { name: feed.name })}><ResetIcon className="w-4 h-4"/></button>
                                <button onClick={() => onEdit(feed)} className="p-2 text-slate-500 dark:text-zinc-400 hover:text-indigo-500 dark:hover:text-indigo-400 rounded-md hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors" aria-label={t('admin.management.ariaEdit', { name: feed.name })}><PencilIcon className="w-5 h-5"/></button>
                                <button onClick={() => onDelete(feed)} className="p-2 text-slate-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 rounded-md hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors" aria-label={t('admin.management.ariaDelete', { name: feed.name })}><TrashIcon className="w-5 h-5"/></button>
                            </div></td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden p-4 space-y-4 bg-slate-50 dark:bg-zinc-900/50">
                {sortedFeeds.map(feed => (
                    <div key={feed.id} className="bg-white dark:bg-zinc-800 rounded-lg shadow p-4 space-y-3">
                        <div className="flex justify-between items-start gap-2">
                            <p className="font-bold text-lg break-words">{feed.name}</p>
                            <div className="flex items-center flex-shrink-0">
                                <HealthStatusIcon state={feedHealth[feed.id]} />
                            </div>
                        </div>
                        <div className="text-sm text-slate-500 dark:text-zinc-400">
                            <a href={feed.url} target="_blank" rel="noopener noreferrer" className="text-indigo-500 break-all">{feed.url}</a>
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-center text-sm pt-2">
                            <div><p className="text-xs text-slate-500 dark:text-zinc-400 font-semibold">{t('admin.management.headerPriority')}</p><p className="font-bold capitalize">{feed.priority}</p></div>
                            <div><p className="text-xs text-slate-500 dark:text-zinc-400 font-semibold">{t('admin.management.headerLang')}</p><p className="font-bold uppercase">{feed.language}</p></div>
                            <div><p className="text-xs text-slate-500 dark:text-zinc-400 font-semibold">{t('admin.management.headerInterval')}</p><p className="font-bold">{feed.update_interval} min</p></div>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-zinc-700 pt-3 mt-3">
                            <button onClick={onCheckHealth} className="p-2 text-slate-500 dark:text-zinc-400 rounded-md" aria-label={t('admin.management.ariaCheckHealth', { name: feed.name })}><ResetIcon className="w-5 h-5"/></button>
                            <button onClick={() => onEdit(feed)} className="p-2 text-slate-500 dark:text-zinc-400 rounded-md" aria-label={t('admin.management.ariaEdit', { name: feed.name })}><PencilIcon className="w-5 h-5"/></button>
                            <button onClick={() => onDelete(feed)} className="p-2 text-slate-500 dark:text-zinc-400 rounded-md" aria-label={t('admin.management.ariaDelete', { name: feed.name })}><TrashIcon className="w-5 h-5"/></button>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};