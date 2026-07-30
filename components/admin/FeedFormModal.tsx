import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { FeedSource } from '../../types';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { CloseIcon } from '../Icons';

interface FeedFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    feed: FeedSource | null;
    feeds: FeedSource[];
    addFeed: (feed: Omit<FeedSource, 'id'>) => Promise<void>;
    updateFeed: (feed: FeedSource) => Promise<void>;
}

export const FeedFormModal: React.FC<FeedFormModalProps> = ({ isOpen, onClose, feed, feeds, addFeed, updateFeed }) => {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [language, setLanguage] = useState<'de' | 'en'>('en');
    const [priority, setPriority] = useState<'primary' | 'secondary'>('secondary');
    const [needsScraping, setNeedsScraping] = useState(false);
    const [urlError, setUrlError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const nameInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (feed) {
            setName(feed.name);
            setUrl(feed.url);
            setLanguage(feed.language);
            setPriority(feed.priority);
            setNeedsScraping(!!feed.needsScraping);
        } else {
            // Reset form for "add new"
            setName('');
            setUrl('');
            setLanguage('en');
            setPriority('secondary');
            setNeedsScraping(false);
        }
        // Reset error state whenever the modal is opened/closed or the feed changes
        setUrlError(null);
        setSubmitError(null);
    }, [feed, isOpen]);

    const handleClose = () => {
        if (!isSaving) {
            onClose();
        }
    };

    const dialogRef = useDialogFocus<HTMLDivElement>({
        isOpen,
        onClose: handleClose,
        canClose: !isSaving,
        initialFocusRef: nameInputRef,
    });

    if (!isOpen) {
        return null;
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSaving) return;
        setSubmitError(null);

        // --- Duplicate URL Validation ---
        const normalizeUrl = (u: string) => u.trim().toLowerCase().replace(/\/$/, '');
        const normalizedUrl = normalizeUrl(url);

        const isDuplicate = feeds.some(existingFeed => {
            // When editing, ensure we are not comparing the feed to itself.
            const isDifferentFeed = feed ? existingFeed.id !== feed.id : true;
            return isDifferentFeed && normalizeUrl(existingFeed.url) === normalizedUrl;
        });

        if (isDuplicate) {
            setUrlError(t('admin.form.errorUrlExists'));
            return; // Block form submission
        }
        // --- End Validation ---

        const feedData = { name, url, language, priority, needsScraping };

        setIsSaving(true);
        try {
            if (feed) {
                await updateFeed({ ...feedData, id: feed.id });
            } else {
                await addFeed(feedData);
            }
            onClose();
        } catch (error) {
            console.error('Error saving feed:', error);
            setSubmitError(t('admin.form.errorSaving'));
        } finally {
            setIsSaving(false);
        }
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
                onClick={handleClose}
                aria-hidden="true"
            />
            <div
                ref={dialogRef}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-slate-100 dark:bg-zinc-900 rounded-2xl shadow-2xl flex flex-col"
                style={{ maxHeight: '90vh' }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="form-modal-title"
                tabIndex={-1}
            >
                <form id="feed-form" onSubmit={handleSubmit} aria-busy={isSaving}>
                    <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-zinc-800 flex-shrink-0">
                        <h2 id="form-modal-title" className="text-lg font-semibold">
                            {feed ? t('admin.form.titleEdit') : t('admin.form.titleAdd')}
                        </h2>
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={isSaving}
                            className="p-3 rounded-full hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label={t('admin.form.ariaClose')}
                        >
                            <CloseIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <fieldset disabled={isSaving} className="border-0 p-0 m-0 min-w-0">
                    <div className="p-6 flex-grow overflow-y-auto space-y-4">
                        <div>
                            <label htmlFor="feed-name" className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">{t('admin.form.labelName')}</label>
                            <input
                                ref={nameInputRef}
                                id="feed-name"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                                className="w-full h-11 px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                            />
                        </div>
                        <div>
                            <label htmlFor="feed-url" className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">{t('admin.form.labelUrl')}</label>
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
                                <label htmlFor="feed-language" className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">{t('admin.form.labelLang')}</label>
                                <select id="feed-language" value={language} onChange={(e) => setLanguage(e.target.value as 'de' | 'en')} className="w-full h-11 px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition">
                                    <option value="en">{t('admin.form.languageEnglish')}</option>
                                    <option value="de">{t('admin.form.languageGerman')}</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="feed-priority" className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">{t('admin.form.labelPriority')}</label>
                                <select id="feed-priority" value={priority} onChange={(e) => setPriority(e.target.value as 'primary' | 'secondary')} className="w-full h-11 px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition capitalize">
                                    <option value="primary">{t('admin.management.priorityPrimary')}</option>
                                    <option value="secondary">{t('admin.management.prioritySecondary')}</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 pt-2">
                            <input
                                id="needs-scraping"
                                type="checkbox"
                                checked={needsScraping}
                                onChange={(e) => setNeedsScraping(e.target.checked)}
                                className="h-5 w-5 rounded border-slate-300 dark:border-zinc-600 text-indigo-600 focus:ring-indigo-500 bg-slate-100 dark:bg-zinc-700"
                            />
                            <label htmlFor="needs-scraping" className="text-sm font-medium text-slate-700 dark:text-zinc-300">{t('admin.form.labelScraping')}</label>
                        </div>
                        {submitError && (
                            <div
                                role="alert"
                                className="p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 text-sm"
                            >
                                {submitError}
                            </div>
                        )}
                    </div>
                    <div className="flex-shrink-0 p-4 border-t border-slate-200 dark:border-zinc-800 flex justify-end items-center bg-slate-100 dark:bg-zinc-900 rounded-b-2xl gap-3">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-slate-200 dark:bg-zinc-700 text-slate-800 dark:text-zinc-200 hover:bg-slate-300 dark:hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {t('admin.cancel')}
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2 rounded-lg text-sm font-bold transition-all duration-200 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSaving ? t('admin.form.saving') : t('admin.form.save')}
                        </button>
                    </div>
                    </fieldset>
                </form>
            </div>
        </>
    );
};
