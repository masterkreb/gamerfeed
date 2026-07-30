import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Announcement, AnnouncementType } from '../../types';
import { ANNOUNCEMENT_MESSAGE_MAX_LENGTH } from '../../shared/announcement-contract.js';
import { getDateLocale } from '../../shared/i18n-locale';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useMutationLatch } from '../../hooks/useMutationLatch';

// Geschützter Abruf: nur so bekommt der Admin eine abgeschaltete Ankündigung
// zu sehen. Der öffentliche Endpunkt liefert sie weiterhin nicht aus.
const ADMIN_ANNOUNCEMENT_ENDPOINT = '/api/announcement?admin=1';

const typeStyles: Record<AnnouncementType, { bg: string; border: string; text: string; labelKey: string }> = {
    info: {
        bg: 'bg-blue-50 dark:bg-blue-900/20',
        border: 'border-blue-200 dark:border-blue-800',
        text: 'text-blue-800 dark:text-blue-200',
        labelKey: 'admin.announcement.typeInfo',
    },
    warning: {
        bg: 'bg-amber-50 dark:bg-amber-900/20',
        border: 'border-amber-200 dark:border-amber-800',
        text: 'text-amber-800 dark:text-amber-200',
        labelKey: 'admin.announcement.typeWarning',
    },
    maintenance: {
        bg: 'bg-red-50 dark:bg-red-900/20',
        border: 'border-red-200 dark:border-red-800',
        text: 'text-red-800 dark:text-red-200',
        labelKey: 'admin.announcement.typeMaintenance',
    },
    celebration: {
        bg: 'bg-green-50 dark:bg-green-900/20',
        border: 'border-green-200 dark:border-green-800',
        text: 'text-green-800 dark:text-green-200',
        labelKey: 'admin.announcement.typeCelebration',
    },
};

export const AnnouncementTab: React.FC = () => {
    const { t, i18n } = useTranslation();
    const [announcement, setAnnouncement] = useState<Announcement | null>(null);
    const [message, setMessage] = useState('');
    const [type, setType] = useState<AnnouncementType>('info');
    const [isActive, setIsActive] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const deleteCancelButtonRef = useRef<HTMLButtonElement>(null);
    // Nach einer erfolgreichen Löschung verschwindet der auslösende Knopf. Das
    // Textfeld ist dann das nächstliegende, immer vorhandene Fokusziel – der
    // Speichern-Knopf wäre ohne Nachricht deaktiviert und nicht fokussierbar.
    const messageInputRef = useRef<HTMLTextAreaElement>(null);
    const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Speichern und Löschen teilen sich bewusst einen Latch: sonst könnten ein
    // POST und ein DELETE synchron nebeneinander starten. Welche der beiden
    // Aktionen läuft, entscheidet nur noch über die Beschriftung.
    const { isMutating, runExclusive } = useMutationLatch();
    const [pendingMutation, setPendingMutation] = useState<'save' | 'delete' | null>(null);

    const announceSuccess = (text: string) => {
        setSuccessMessage(text);
        if (successTimeoutRef.current !== null) {
            clearTimeout(successTimeoutRef.current);
        }
        successTimeoutRef.current = setTimeout(() => {
            successTimeoutRef.current = null;
            setSuccessMessage(null);
        }, 3000);
    };

    useEffect(() => () => {
        if (successTimeoutRef.current !== null) {
            clearTimeout(successTimeoutRef.current);
        }
    }, []);

    const closeDeleteDialog = () => {
        // Dieselbe Regel wie im Feed-Löschdialog: eine laufende Löschung lässt
        // sich weder mit Escape noch über den Hintergrund wegklicken.
        if (!isMutating) {
            setIsConfirmingDelete(false);
            setDeleteError(null);
        }
    };

    const deleteDialogRef = useDialogFocus<HTMLDivElement>({
        isOpen: isConfirmingDelete,
        onClose: closeDeleteDialog,
        canClose: !isMutating,
        initialFocusRef: deleteCancelButtonRef,
        fallbackFocusRef: messageInputRef,
    });

    // Load current announcement
    useEffect(() => {
        const fetchAnnouncement = async () => {
            try {
                const response = await fetch(ADMIN_ANNOUNCEMENT_ENDPOINT);
                if (response.ok) {
                    const data = await response.json();
                    if (data) {
                        setAnnouncement(data);
                        setMessage(data.message);
                        setType(data.type);
                        setIsActive(data.isActive);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch announcement:', err);
            } finally {
                setIsLoading(false);
            }
        };
        fetchAnnouncement();
    }, []);

    const handleSave = async () => {
        if (!message.trim()) {
            setError(t('admin.announcement.errorEmpty'));
            return;
        }

        // Der Latch wird synchron gesetzt, damit ein zweiter Klick im selben
        // Render-Zyklus keinen zweiten POST auslöst.
        await runExclusive(async () => {
            setPendingMutation('save');
            setError(null);
            setSuccessMessage(null);

            try {
                const response = await fetch('/api/announcement', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: message.trim(), type, isActive }),
                });

                if (!response.ok) {
                    throw new Error('Failed to save announcement');
                }

                const data = await response.json();
                setAnnouncement(data);
                announceSuccess(t('admin.announcement.saved'));
            } catch (err) {
                // Nachricht, Typ und Aktiv-Status bleiben unverändert stehen.
                console.error('Failed to save announcement:', err);
                setError(t('admin.announcement.errorSaving'));
            } finally {
                setPendingMutation(null);
            }
        });
    };

    const requestDelete = () => {
        setDeleteError(null);
        setIsConfirmingDelete(true);
    };

    const confirmDelete = async () => {
        // Derselbe Latch wie beim Speichern, ebenfalls synchron gesetzt.
        await runExclusive(async () => {
            setPendingMutation('delete');
            setError(null);
            setDeleteError(null);

            try {
                const response = await fetch('/api/announcement', { method: 'DELETE' });

                if (!response.ok) {
                    throw new Error('Failed to delete announcement');
                }

                setAnnouncement(null);
                setMessage('');
                setType('info');
                setIsActive(true);
                setIsConfirmingDelete(false);
                announceSuccess(t('admin.announcement.deleted'));
            } catch (err) {
                // Ankündigung und Bestätigungsdialog bleiben erhalten.
                console.error('Failed to delete announcement:', err);
                setDeleteError(t('admin.announcement.errorDeleting'));
            } finally {
                setPendingMutation(null);
            }
        });
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-zinc-700">
                <h3 className="text-lg font-semibold text-slate-800 dark:text-zinc-100 mb-4">
                    {t('admin.announcement.title')}
                </h3>
                <p className="text-sm text-slate-600 dark:text-zinc-400 mb-6">
                    {t('admin.announcement.description')}
                </p>

                {/* Message Input */}
                <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-2">
                        {t('admin.announcement.messageLabel')}
                    </label>
                    <textarea
                        ref={messageInputRef}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={t('admin.announcement.messagePlaceholder')}
                        // Dieselbe Grenze, die der Server durchsetzt.
                        maxLength={ANNOUNCEMENT_MESSAGE_MAX_LENGTH}
                        className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-slate-800 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                        rows={3}
                    />
                </div>

                {/* Type Selector */}
                <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-2">
                        {t('admin.announcement.typeLabel')}
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(Object.keys(typeStyles) as AnnouncementType[]).map((announcementType) => (
                            <button
                                key={announcementType}
                                onClick={() => setType(announcementType)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                                    type === announcementType
                                        ? `${typeStyles[announcementType].bg} ${typeStyles[announcementType].border} ${typeStyles[announcementType].text}`
                                        : 'bg-slate-100 dark:bg-zinc-700 border-transparent text-slate-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-600'
                                }`}
                            >
                                {t(typeStyles[announcementType].labelKey)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Active Toggle */}
                <div className="mb-6">
                    <label className="flex items-center gap-3 cursor-pointer">
                        <div className="relative">
                            <input
                                type="checkbox"
                                checked={isActive}
                                onChange={(e) => setIsActive(e.target.checked)}
                                className="sr-only"
                            />
                            <div className={`w-11 h-6 rounded-full transition-colors ${isActive ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-zinc-600'}`}>
                                <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isActive ? 'translate-x-5' : ''}`} />
                            </div>
                        </div>
                        <span className="text-sm font-medium text-slate-700 dark:text-zinc-300">
                            {t('admin.announcement.activeLabel')}
                        </span>
                    </label>
                </div>

                {/* Preview */}
                {message && (
                    <div className="mb-6">
                        <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-2">
                            {t('admin.announcement.preview')}
                        </label>
                        <div className={`rounded-xl p-4 border ${typeStyles[type].bg} ${typeStyles[type].border}`}>
                            <p className={`text-sm ${typeStyles[type].text}`}>{message}</p>
                        </div>
                    </div>
                )}

                {/* Error/Success Messages */}
                {error && (
                    <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
                        {error}
                    </div>
                )}
                {successMessage && (
                    <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 text-sm">
                        {successMessage}
                    </div>
                )}

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <button
                        onClick={() => void handleSave()}
                        disabled={isMutating || !message.trim()}
                        className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {pendingMutation === 'save'
                            ? t('admin.announcement.saving')
                            : t('admin.announcement.save')}
                    </button>
                    {announcement && (
                        <button
                            onClick={requestDelete}
                            disabled={isMutating}
                            className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {t('admin.announcement.delete')}
                        </button>
                    )}
                </div>
            </div>

            {/* Current Status */}
            {announcement && (
                <div className="bg-slate-50 dark:bg-zinc-800/50 rounded-xl p-4 border border-slate-200 dark:border-zinc-700">
                    <h4 className="text-sm font-medium text-slate-600 dark:text-zinc-400 mb-2">
                        {t('admin.announcement.currentStatus')}
                    </h4>
                    <div className="flex items-center gap-2 text-sm">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            announcement.isActive 
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' 
                                : 'bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-zinc-400'
                        }`}>
                            {announcement.isActive ? t('admin.announcement.statusActive') : t('admin.announcement.statusInactive')}
                        </span>
                        <span className="text-slate-500 dark:text-zinc-500">
                            {t('admin.announcement.createdAt', {
                                date: new Date(announcement.createdAt).toLocaleString(
                                    getDateLocale(i18n.resolvedLanguage ?? i18n.language),
                                ),
                            })}
                        </span>
                    </div>
                </div>
            )}

            {isConfirmingDelete && (<>
                <div className="fixed inset-0 bg-black/60 z-40" onClick={closeDeleteDialog} aria-hidden="true" />
                <div
                    ref={deleteDialogRef}
                    className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-slate-100 dark:bg-zinc-900 rounded-2xl shadow-2xl p-6"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="announcement-delete-title"
                    aria-describedby={deleteError
                        ? 'announcement-delete-description announcement-delete-error'
                        : 'announcement-delete-description'}
                    aria-busy={isMutating}
                    tabIndex={-1}
                >
                    <h2 id="announcement-delete-title" className="text-lg font-bold">
                        {t('admin.announcement.deleteModalTitle')}
                    </h2>
                    <p id="announcement-delete-description" className="text-sm text-slate-600 dark:text-zinc-400 mt-2">
                        {t('admin.announcement.deleteModalConfirm')}
                    </p>
                    {deleteError && (
                        <div
                            id="announcement-delete-error"
                            role="alert"
                            className="mt-4 p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 text-sm"
                        >
                            {deleteError}
                        </div>
                    )}
                    <div className="mt-6 flex justify-end gap-3">
                        <button
                            ref={deleteCancelButtonRef}
                            onClick={closeDeleteDialog}
                            disabled={isMutating}
                            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-slate-200 dark:bg-zinc-700 text-slate-800 dark:text-zinc-200 hover:bg-slate-300 dark:hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {t('admin.cancel')}
                        </button>
                        <button
                            onClick={() => void confirmDelete()}
                            disabled={isMutating}
                            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {pendingMutation === 'delete'
                                ? t('admin.announcement.deleting')
                                : t('admin.announcement.delete')}
                        </button>
                    </div>
                </div>
            </>)}
        </div>
    );
};
