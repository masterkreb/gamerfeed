import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon, SendIcon } from './Icons';

interface ContactFormProps {
    isOpen: boolean;
    onClose: () => void;
}

export const ContactForm: React.FC<ContactFormProps> = ({ isOpen, onClose }) => {
    const { t } = useTranslation();
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        subject: '',
        message: ''
    });
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [turnstileToken, setTurnstileToken] = useState<string>('');

    // Cloudflare Turnstile wird beim Mount geladen
    React.useEffect(() => {
        if (isOpen && !document.querySelector('script[src*="turnstile"]')) {
            const script = document.createElement('script');
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
            script.async = true;
            script.defer = true;
            document.body.appendChild(script);
        }

        // Globales Callback für Turnstile
        (window as any).onTurnstileSuccess = (token: string) => {
            setTurnstileToken(token);
        };
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!turnstileToken) {
            setStatus('error');
            return;
        }

        setStatus('loading');

        try {
            const response = await fetch('/api/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...formData, turnstileToken })
            });

            if (response.ok) {
                setStatus('success');
                setFormData({ name: '', email: '', subject: '', message: '' });
                setTimeout(() => {
                    onClose();
                    setStatus('idle');
                }, 2000);
            } else {
                setStatus('error');
            }
        } catch (error) {
            setStatus('error');
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <div 
                className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm z-40"
                onClick={onClose}
                aria-hidden="true"
            />
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="contact-modal-title"
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[95vw] max-w-2xl max-h-[90vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            >
                <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-zinc-800">
                    <h2 id="contact-modal-title" className="text-lg font-semibold">{t('contact.title')}</h2>
                    <button
                        onClick={onClose}
                        className="p-3 rounded-full hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
                        aria-label={t('settings.close')}
                    >
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 flex-grow overflow-y-auto space-y-4">
                    <div>
                        <label htmlFor="name" className="block text-sm font-semibold mb-2 text-slate-700 dark:text-zinc-300">
                            {t('contact.name')}
                        </label>
                        <input
                            type="text"
                            id="name"
                            required
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>

                    <div>
                        <label htmlFor="email" className="block text-sm font-semibold mb-2 text-slate-700 dark:text-zinc-300">
                            {t('contact.email')}
                        </label>
                        <input
                            type="email"
                            id="email"
                            required
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>

                    <div>
                        <label htmlFor="subject" className="block text-sm font-semibold mb-2 text-slate-700 dark:text-zinc-300">
                            {t('contact.subject')}
                        </label>
                        <input
                            type="text"
                            id="subject"
                            required
                            value={formData.subject}
                            onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                            className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>

                    <div>
                        <label htmlFor="message" className="block text-sm font-semibold mb-2 text-slate-700 dark:text-zinc-300">
                            {t('contact.message')}
                        </label>
                        <textarea
                            id="message"
                            required
                            rows={6}
                            value={formData.message}
                            onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                            className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                        />
                    </div>

                    {/* Cloudflare Turnstile */}
                    <div className="flex justify-center">
                        <div
                            className="cf-turnstile"
                            data-sitekey="YOUR_TURNSTILE_SITE_KEY"
                            data-callback="onTurnstileSuccess"
                            data-theme="auto"
                        />
                    </div>

                    {status === 'success' && (
                        <div className="p-4 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 rounded-lg text-sm">
                            {t('contact.success')}
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="p-4 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded-lg text-sm">
                            {t('contact.error')}
                        </div>
                    )}
                </form>

                <div className="flex-shrink-0 p-4 border-t border-slate-200 dark:border-zinc-800 flex justify-end items-center bg-slate-100 dark:bg-zinc-900 rounded-b-2xl">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors mr-3 text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200"
                    >
                        {t('admin.cancel')}
                    </button>
                    <button
                        type="submit"
                        disabled={status === 'loading'}
                        onClick={handleSubmit}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-zinc-900"
                    >
                        <SendIcon className="w-5 h-5" />
                        <span>{status === 'loading' ? t('contact.sending') : t('contact.send')}</span>
                    </button>
                </div>
            </div>
        </>
    );
};
