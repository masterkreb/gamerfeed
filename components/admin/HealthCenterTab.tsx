import React, { useState, useMemo } from 'react';
import type { FeedSource } from '../../types';
import type { FeedHealth } from './AdminPanel';
// FIX: Correctly import HealthState as a type. The original error "not a module" is resolved by adding content to healthService.ts.
import type { HealthState } from './healthService';
import {
    CheckCircleIcon, XCircleIcon, QuestionMarkCircleIcon, LoadingSpinner, WarningIcon, ChevronDownIcon, ChevronUpIcon
} from '../Icons';

// --- Types ---
type SortableKey = 'name' | 'status' | 'details';
type SortDirection = 'ascending' | 'descending';


// --- Reusable Components ---

const HealthStatusCell: React.FC<{ state: HealthState }> = ({ state }) => {
    const status = state?.status || 'unknown';

    const styles = {
        ok: { icon: <CheckCircleIcon className="w-5 h-5" />, text: 'OK', colors: 'text-green-600 dark:text-green-400' },
        warning: { icon: <WarningIcon className="w-5 h-5" />, text: 'Warning', colors: 'text-amber-600 dark:text-amber-400' },
        error: { icon: <XCircleIcon className="w-5 h-5" />, text: 'Error', colors: 'text-red-600 dark:text-red-400' },
        checking: { icon: <LoadingSpinner className="w-4 h-4" />, text: 'Checking...', colors: 'text-indigo-500 dark:text-indigo-400' },
        unknown: { icon: <QuestionMarkCircleIcon className="w-5 h-5" />, text: 'Unknown', colors: 'text-slate-500 dark:text-zinc-400' },
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

interface HealthCenterTabProps {
    feeds: FeedSource[];
    feedHealth: FeedHealth;
    onCheckAll: () => void;
    isCheckingAll: boolean;
}

export const HealthCenterTab: React.FC<HealthCenterTabProps> = ({
                                                                    feeds,
                                                                    feedHealth,
                                                                    onCheckAll,
                                                                    isCheckingAll
                                                                }) => {
    const [sortConfig, setSortConfig] = useState<{ key: SortableKey; direction: SortDirection } | null>({ key: 'status', direction: 'ascending' });

    const requestSort = (key: SortableKey) => {
        let direction: SortDirection = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const sortedFeeds = useMemo(() => {
        let sortableItems = [...feeds];
        if (sortConfig) {
            sortableItems.sort((a, b) => {
                let aValue: string | number | null = null;
                let bValue: string | number | null = null;

                switch (sortConfig.key) {
                    case 'name':
                        aValue = a.name;
                        bValue = b.name;
                        break;
                    case 'status':
                        const healthOrder: Record<HealthState['status'], number> = { error: 0, warning: 1, checking: 2, unknown: 3, ok: 4 };
                        aValue = healthOrder[feedHealth[a.id]?.status || 'unknown'];
                        bValue = healthOrder[feedHealth[b.id]?.status || 'unknown'];
                        break;
                    case 'details':
                        aValue = feedHealth[a.id]?.detail || '';
                        bValue = feedHealth[b.id]?.detail || '';
                        break;
                }

                if (aValue === null || bValue === null) return 0;

                if (typeof aValue === 'string' && typeof bValue === 'string') {
                    return sortConfig.direction === 'ascending' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
                }
                if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [feeds, feedHealth, sortConfig]);

    return (
        <section className="bg-white dark:bg-zinc-800 rounded-lg shadow overflow-hidden">
            <div className="p-4 flex flex-col sm:flex-row justify-between items-center gap-3 border-b border-slate-200 dark:border-zinc-700">
                <div className="text-center sm:text-left">
                    <h2 className="text-lg font-semibold">Backend Feed Status</h2>
                    <p className="text-sm text-slate-500 dark:text-zinc-400">Shows the result of the last automated backend fetch (GitHub Action).</p>
                </div>
                <button onClick={onCheckAll} disabled={isCheckingAll} className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-slate-200 dark:bg-zinc-700 text-slate-700 dark:text-zinc-200 hover:bg-slate-300 dark:hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-wait">
                    {isCheckingAll ? <LoadingSpinner className="w-5 h-5"/> : <CheckCircleIcon className="w-5 h-5"/>}
                    <span>Refresh Backend Status</span>
                </button>
            </div>

            {/* Desktop Table */}
            <div className="overflow-x-auto hidden md:block">
                <table className="w-full text-sm text-left table-auto">
                    <thead className="bg-slate-50 dark:bg-zinc-700/50 text-xs uppercase text-slate-500 dark:text-zinc-400">
                    <tr>
                        <SortableHeader label="Name" sortKey="name" sortConfig={sortConfig} requestSort={requestSort} className="w-1/4"/>
                        <SortableHeader label="Status" sortKey="status" sortConfig={sortConfig} requestSort={requestSort} className="w-40"/>
                        <SortableHeader label="Details" sortKey="details" sortConfig={sortConfig} requestSort={requestSort} className="w-1/2"/>
                    </tr>
                    </thead>
                    <tbody>
                    {sortedFeeds.map(feed => (
                        <tr key={feed.id} className="border-b dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800/50">
                            <td className="p-4 font-medium truncate">{feed.name}</td>
                            <td className="p-4"><HealthStatusCell state={feedHealth[feed.id]} /></td>
                            <td className="p-4 text-slate-500 dark:text-zinc-400">{feedHealth[feed.id]?.detail || 'N/A'}</td>
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
                        </div>
                        <div>
                            <HealthStatusCell state={feedHealth[feed.id]} />
                        </div>
                        <div className="text-sm text-slate-500 dark:text-zinc-400 pt-2 border-t border-slate-100 dark:border-zinc-700">
                            <p className="font-semibold text-slate-600 dark:text-zinc-300 mb-1">Details:</p>
                            <p>{feedHealth[feed.id]?.detail || 'N/A'}</p>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};