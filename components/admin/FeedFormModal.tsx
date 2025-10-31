import React, { useState, useEffect } from 'react';
import { FeedSource } from '../../types';
import { CloseIcon } from '../Icons';

interface FeedFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    feed: FeedSource | null;
    feeds: FeedSource[];
    addFeed: (feed: Omit<FeedSource, 'id'>) => void;
    updateFeed: (feed: FeedSource) => void;
}

export const FeedFormModal: React.FC<FeedFormModalProps> = ({ isOpen, onClose, feed, feeds, addFeed, updateFeed }) => {
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [language, setLanguage] = useState<'de' | 'en'>('en');
    const [priority, setPriority] = useState<'primary' | 'secondary'>('secondary');
    const [updateInterval, setUpdateInterval] = useState(60);
    const [needsScraping, setNeedsScraping] = useState(false);
    const [urlError, setUrlError] = useState<string | null>(null);

    useEffect(() => {
        if (feed) {
            setName(feed.name);
            setUrl(feed.url);
            setLanguage(feed.language);
            setPriority(feed.priority);
            setUpdateInterval(feed.update_interval);
            setNeedsScraping(!!feed.needsScraping);
        } else {
            // Reset form for "add new"
            setName('');
            setUrl('');
            setLanguage('en');
            setPriority('secondary');
            setUpdateInterval(60);
            setNeedsScraping(false);
        }
        // Reset error state whenever the modal is opened/closed or the feed changes
        setUrlError(null);
    }, [feed, isOpen]);

    if (!isOpen) {
        return null;
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // --- Duplicate URL Validation ---
        const normalizeUrl = (u: string) => u.trim().toLowerCase().replace(/\/$/, '');
        const normalizedUrl = normalizeUrl(url);

        const isDuplicate = feeds.some(existingFeed => {
            // When editing, ensure we are not comparing the feed to itself.
            const isDifferentFeed = feed ? existingFeed.id !== feed.id : true;
            return isDifferentFeed && normalizeUrl(existingFeed.url) === normalizedUrl;
        });

        if (isDuplicate) {
            setUrlError('This feed URL already exists.');
            return; // Block form submission
        }
        // --- End Validation ---

        const feedData = { name, url, language, priority, needsScraping, update_interval: Number(updateInterval) };

        if (feed) { // Editing existing feed
            updateFeed({ ...feedData, id: feed.id });
        } else { // Adding new feed
            addFeed(feedData);
        }
        onClose();
    };

    const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setUrl(e.target.value);
        // Clear the error message as soon as the user starts typing again
        if (urlError) {
            setUrlError(null);
        }
    };

    return (
        <>
            <div
                className="fixed inset-0 bg-black/60 z-40 transition-opacity"
                onClick={onClose}
                aria-hidden="true"
            />
            <div
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-slate-100 dark:bg-zinc-900 rounded-2xl shadow-2xl flex flex-col"
                style={{ maxHeight: '90vh' }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="form-modal-title"
            >
                <form id="feed-form" onSubmit={handleSubmit}>
                    <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-zinc-800 flex-shrink-0">
                        <h2 id="form-modal-title" className="text-lg font-semibold">
                            {feed ? 'Edit Feed Source' : 'Add New Feed Source'}
                        </h2>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-3 rounded-full hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
                            aria-label="Close form"
                        >
                            <CloseIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <div className="p-6 flex-grow overflow-y-auto space-y-4">
                        <div>
                            <label htmlFor="feed-name" className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Name</label>
                            <input
                                id="feed-name"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                                className="w-full h-11 px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                            />
                        </div>
                        <div>
                            <label htmlFor="feed-url" className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">URL</label>
                            <input
                                id="feed-url"
                                type="url"
                                value={url}
                                onChange={handleUrlChange}
                                required
                                className={`w-full h-11 px-3 py-2 bg-white dark:bg-zinc-800 border rounded-lg transition ${
                                    urlError
                                        ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                                        : 'border-slate-300 dark:border-zinc-700 focus:ring-indigo-500 focus:border-indigo-500'
                                }`}
                                aria-invalid={!!urlError}
                                aria-describedby={urlError ? "url-error" : undefined}
                            />
                            {urlError && <p id="url-error" className="mt-2 text-sm text-red-600 dark:text-red-400">{urlError}</p>}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="feed-language" className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Language</label>
                                <select id="feed-language" value={language} onChange={(e) => setLanguage(e.target.value as 'de' | 'en')} className="w-full h-11 px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition">
                                    <option value="en">English</option>
                                    <option value="de">German</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="feed-priority" className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Priority</label>
                                <select id="feed-priority" value={priority} onChange={(e) => setPriority(e.target.value as 'primary' | 'secondary')} className="w-full h-11 px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition capitalize">
                                    <option value="primary">primary</option>
                                    <option value="secondary">secondary</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label htmlFor="feed-interval" className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Update Interval (minutes)</label>
                            <input
                                id="feed-interval"
                                type="number"
                                value={updateInterval}
                                onChange={(e) => setUpdateInterval(Number(e.target.value))}
                                required
                                min="1"
                                className="w-full h-11 px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                            />
                        </div>
                        <div className="flex items-center gap-3 pt-2">
                            <input
                                id="needs-scraping"
                                type="checkbox"
                                checked={needsScraping}
                                onChange={(e) => setNeedsScraping(e.target.checked)}
                                className="h-5 w-5 rounded border-slate-300 dark:border-zinc-600 text-indigo-600 focus:ring-indigo-500 bg-slate-100 dark:bg-zinc-700"
                            />
                            <label htmlFor="needs-scraping" className="text-sm font-medium text-slate-700 dark:text-zinc-300">Image requires scraping fallback?</label>
                        </div>
                    </div>
                    <div className="flex-shrink-0 p-4 border-t border-slate-200 dark:border-zinc-800 flex justify-end items-center bg-slate-100 dark:bg-zinc-900 rounded-b-2xl gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-slate-200 dark:bg-zinc-700 text-slate-800 dark:text-zinc-200 hover:bg-slate-300 dark:hover:bg-zinc-600"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2 rounded-lg text-sm font-bold transition-all duration-200 bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                            Save
                        </button>
                    </div>
                </form>
            </div>
        </>
    );
};