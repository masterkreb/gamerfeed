import React, { useMemo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon, ResetIcon } from './Icons';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    allSources: { name: string; language: 'de' | 'en' }[];
    mutedSources: string[];
    setMutedSources: React.Dispatch<React.SetStateAction<string[]>>;
}

type TabType = 'sources' | 'legal' | 'about' | 'contact';

const SourceCheckbox: React.FC<{
    sourceName: string;
    isMuted: boolean;
    onToggle: (sourceName: string) => void;
}> = ({ sourceName, isMuted, onToggle }) => (
    <label className="flex items-center gap-3 p-3 rounded-lg bg-white dark:bg-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-700/50 transition-all duration-200 cursor-pointer">
        <input
            type="checkbox"
            checked={isMuted}
            onChange={() => onToggle(sourceName)}
            className="h-5 w-5 rounded border-slate-300 dark:border-zinc-600 text-indigo-600 focus:ring-indigo-500 bg-slate-100 dark:bg-zinc-700"
        />
        <span className="font-medium">{sourceName}</span>
    </label>
);

const LanguageSourceGroup: React.FC<{
    title: string;
    sources: { name: string; language: 'de' | 'en' }[];
    mutedSources: string[];
    onToggleSource: (sourceName: string) => void;
    onToggleLanguage: (language: 'de' | 'en', shouldMute: boolean) => void;
}> = ({ title, sources, mutedSources, onToggleSource, onToggleLanguage }) => {
    const checkboxRef = useRef<HTMLInputElement>(null);
    const language = sources[0]?.language;

    const mutedCount = useMemo(
        () => sources.filter(s => mutedSources.includes(s.name)).length,
        [sources, mutedSources]
    );

    const allForLangMuted = sources.length > 0 && mutedCount === sources.length;
    const someForLangMuted = mutedCount > 0 && !allForLangMuted;

    useEffect(() => {
        if (checkboxRef.current) {
            checkboxRef.current.indeterminate = someForLangMuted;
        }
    }, [someForLangMuted]);

    const handleToggle = () => {
        if (!language) return;
        onToggleLanguage(language, !allForLangMuted);
    };

    return (
        <section>
            <label className="flex items-center gap-3 p-3 mb-2 rounded-lg bg-slate-200/50 dark:bg-zinc-800/50 cursor-pointer">
                <input
                    ref={checkboxRef}
                    type="checkbox"
                    checked={allForLangMuted}
                    onChange={handleToggle}
                    className="h-5 w-5 rounded border-slate-400 dark:border-zinc-500 text-indigo-600 focus:ring-indigo-500 bg-slate-100 dark:bg-zinc-700"
                />
                <h4 className="font-semibold uppercase text-slate-600 dark:text-zinc-300 tracking-wider">
                    {title}
                </h4>
            </label>
            <div className="space-y-2 pl-2">
                {sources.map(source => (
                    <SourceCheckbox
                        key={source.name}
                        sourceName={source.name}
                        isMuted={mutedSources.includes(source.name)}
                        onToggle={onToggleSource}
                    />
                ))}
            </div>
        </section>
    );
};


export const SettingsModal: React.FC<SettingsModalProps> = ({
                                                                isOpen,
                                                                onClose,
                                                                allSources,
                                                                mutedSources,
                                                                setMutedSources,
                                                            }) => {
    const { t } = useTranslation();

    // ESC-Taste zum Schließen
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const [activeTab, setActiveTab] = useState<TabType>('sources');
    const [contactFormData, setContactFormData] = useState({ name: '', email: '', subject: '', message: '' });
    const [contactStatus, setContactStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    // reCAPTCHA v3 laden wenn Kontakt-Tab aktiv
    useEffect(() => {
        if (activeTab === 'contact' && !document.querySelector('script[src*="recaptcha"]')) {
            const script = document.createElement('script');
            script.src = 'https://www.google.com/recaptcha/api.js?render=6LeKjy4sAAAAAPqI5SG57GRV4ZxSswqEgCtdilWp';
            script.async = true;
            script.defer = true;
            document.body.appendChild(script);
        }
    }, [activeTab]);

    const handleContactSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setContactStatus('loading');

        try {
            // reCAPTCHA v3 Token holen
            const grecaptcha = (window as any).grecaptcha;
            if (!grecaptcha) {
                setContactStatus('error');
                return;
            }

            const token = await grecaptcha.execute('6LeKjy4sAAAAAPqI5SG57GRV4ZxSswqEgCtdilWp', { action: 'contact_form' });

            const response = await fetch('/api/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...contactFormData, recaptchaToken: token })
            });

            if (response.ok) {
                setContactStatus('success');
                setContactFormData({ name: '', email: '', subject: '', message: '' });
                setTimeout(() => setContactStatus('idle'), 3000);
            } else {
                setContactStatus('error');
            }
        } catch (error) {
            setContactStatus('error');
        }
    };

    const handleToggleSource = (sourceName: string) => {
        setMutedSources(prev =>
            prev.includes(sourceName) ? prev.filter(s => s !== sourceName) : [...prev, sourceName]
        );
    };

    const handleToggleLanguage = (language: 'de' | 'en', shouldMute: boolean) => {
        const languageSourceNames = allSources
            .filter(s => s.language === language)
            .map(s => s.name);

        if (shouldMute) {
            setMutedSources(prev => [...new Set([...prev, ...languageSourceNames])]);
        } else {
            setMutedSources(prev => prev.filter(s => !languageSourceNames.includes(s)));
        }
    };

    const germanSources = useMemo(() =>
            allSources.filter(s => s.language === 'de').sort((a, b) => a.name.localeCompare(b.name)),
        [allSources]
    );

    const englishSources = useMemo(() =>
            allSources.filter(s => s.language === 'en').sort((a, b) => a.name.localeCompare(b.name)),
        [allSources]
    );

    if (!isOpen) return null;

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
                aria-labelledby="settings-modal-title"
            >
                <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-zinc-800 flex-shrink-0">
                    <h2 id="settings-modal-title" className="text-lg font-semibold">{t('settings.title')}</h2>
                    <button
                        onClick={onClose}
                        className="p-3 rounded-full hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
                        aria-label={t('settings.close')}
                    >
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </div>
                
                {/* Tab Navigation */}
                <div className="flex border-b border-slate-200 dark:border-zinc-800 flex-shrink-0">
                    <button
                        onClick={() => setActiveTab('sources')}
                        className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
                            activeTab === 'sources'
                                ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                                : 'text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
                        }`}
                    >
                        {t('settings.tabs.sources')}
                    </button>
                    <button
                        onClick={() => setActiveTab('legal')}
                        className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
                            activeTab === 'legal'
                                ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                                : 'text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
                        }`}
                    >
                        {t('settings.tabs.legal')}
                    </button>
                    <button
                        onClick={() => setActiveTab('about')}
                        className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
                            activeTab === 'about'
                                ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                                : 'text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
                        }`}
                    >
                        {t('settings.tabs.about')}
                    </button>
                    <button
                        onClick={() => setActiveTab('contact')}
                        className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
                            activeTab === 'contact'
                                ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                                : 'text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
                        }`}
                    >
                        {t('settings.tabs.contact')}
                    </button>
                </div>

                <div className="p-6 flex-grow overflow-y-auto">
                    {activeTab === 'sources' && (
                        <>
                            <div className="mb-2">
                                <h3 className="font-semibold text-slate-800 dark:text-zinc-200">{t('settings.manage')}</h3>
                            </div>
                            <p className="text-sm text-slate-500 dark:text-zinc-400 mb-4">
                                {t('settings.manageHint')}
                            </p>
                            <div className="space-y-6">
                                {allSources.length > 0 ? (
                                    <>
                                        {germanSources.length > 0 && (
                                            <LanguageSourceGroup
                                                title={t('settings.germanSources')}
                                                sources={germanSources}
                                                mutedSources={mutedSources}
                                                onToggleSource={handleToggleSource}
                                                onToggleLanguage={handleToggleLanguage}
                                            />
                                        )}
                                        {englishSources.length > 0 && (
                                            <LanguageSourceGroup
                                                title={t('settings.englishSources')}
                                                sources={englishSources}
                                                mutedSources={mutedSources}
                                                onToggleSource={handleToggleSource}
                                                onToggleLanguage={handleToggleLanguage}
                                            />
                                        )}
                                    </>
                                ) : (
                                    <p className="text-sm text-center text-slate-500 dark:text-zinc-400 py-4">{t('settings.noSources')}</p>
                                )}
                            </div>
                        </>
                    )}

                    {activeTab === 'legal' && (
                        <div className="space-y-8 prose dark:prose-invert max-w-none prose-slate dark:prose-zinc">
                            <section>
                                <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-200 mb-3">
                                    {t('settings.legal.imprint.title')}
                                </h3>
                                <div className="text-sm space-y-2 text-slate-700 dark:text-zinc-300">
                                    <p className="font-semibold">{t('settings.legal.imprint.responsible')}</p>
                                    <p className="whitespace-pre-line">{t('settings.legal.imprint.name')}</p>
                                    <p>{t('settings.legal.imprint.location')}</p>
                                    <p className="mt-3 text-slate-600 dark:text-zinc-400">{t('settings.legal.imprint.contact')}</p>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-200 mb-3">
                                    {t('settings.legal.privacy.title')}
                                </h3>
                                <div className="text-sm space-y-4 text-slate-700 dark:text-zinc-300">
                                    <div>
                                        <p className="font-semibold mb-2">{t('settings.legal.privacy.intro.title')}</p>
                                        <p>{t('settings.legal.privacy.intro.text')}</p>
                                    </div>
                                    <div>
                                        <p className="font-semibold mb-2">{t('settings.legal.privacy.dataProcessing.title')}</p>
                                        <p className="mb-2">{t('settings.legal.privacy.dataProcessing.text')}</p>
                                        <ul className="list-disc list-inside space-y-1 ml-2">
                                            <li>{t('settings.legal.privacy.dataProcessing.localStorage')}</li>
                                            <li>{t('settings.legal.privacy.dataProcessing.cookies')}</li>
                                            <li>{t('settings.legal.privacy.dataProcessing.analytics')}</li>
                                        </ul>
                                    </div>
                                    <div>
                                        <p className="font-semibold mb-2">{t('settings.legal.privacy.googleAnalytics.title')}</p>
                                        <p className="mb-2">{t('settings.legal.privacy.googleAnalytics.text')}</p>
                                        <ul className="list-disc list-inside space-y-1 ml-2">
                                            <li>{t('settings.legal.privacy.googleAnalytics.ipAnonymization')}</li>
                                            <li>{t('settings.legal.privacy.googleAnalytics.purpose')}</li>
                                            <li>{t('settings.legal.privacy.googleAnalytics.thirdParty')}</li>
                                        </ul>
                                        <p className="mt-2">{t('settings.legal.privacy.googleAnalytics.optOut')}</p>
                                    </div>
                                    <div>
                                        <p className="font-semibold mb-2">{t('settings.legal.privacy.cookies.title')}</p>
                                        <p className="mb-2">{t('settings.legal.privacy.cookies.text')}</p>
                                        <ul className="list-disc list-inside space-y-1 ml-2">
                                            <li>{t('settings.legal.privacy.cookies.necessary')}</li>
                                            <li>{t('settings.legal.privacy.cookies.analytics')}</li>
                                        </ul>
                                        <p className="mt-2">{t('settings.legal.privacy.cookies.manage')}</p>
                                    </div>
                                    <div>
                                        <p className="font-semibold mb-2">{t('settings.legal.privacy.dataTransfer.title')}</p>
                                        <p>{t('settings.legal.privacy.dataTransfer.text')}</p>
                                    </div>
                                    <div>
                                        <p className="font-semibold mb-2">{t('settings.legal.privacy.yourRights.title')}</p>
                                        <p>{t('settings.legal.privacy.yourRights.text')}</p>
                                    </div>
                                    <div>
                                        <p className="font-semibold mb-2">{t('settings.legal.privacy.externalLinks.title')}</p>
                                        <p>{t('settings.legal.privacy.externalLinks.text')}</p>
                                    </div>
                                    <div>
                                        <p className="font-semibold mb-2">{t('settings.legal.privacy.hosting.title')}</p>
                                        <p>{t('settings.legal.privacy.hosting.text')}</p>
                                    </div>
                                </div>
                            </section>

                            <div className="mt-6 p-4 bg-slate-100 dark:bg-zinc-800 rounded-lg text-sm text-slate-700 dark:text-zinc-300">
                                📧 {t('settings.legal.contactReference')}
                            </div>
                        </div>
                    )}

                    {activeTab === 'about' && (
                        <div className="space-y-6 prose dark:prose-invert max-w-none prose-slate dark:prose-zinc">
                            <section>
                                <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-200 mb-3">
                                    {t('settings.about.title')}
                                </h3>
                                <div className="text-sm space-y-4 text-slate-700 dark:text-zinc-300">
                                    <p>{t('settings.about.description')}</p>
                                    <p>{t('settings.about.sources')}</p>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-200 mb-3">
                                    {t('settings.about.features.title')}
                                </h3>
                                <ul className="text-sm space-y-2 text-slate-700 dark:text-zinc-300 list-disc list-inside">
                                    <li>{t('settings.about.features.realtime')}</li>
                                    <li>{t('settings.about.features.filters')}</li>
                                    <li>{t('settings.about.features.favorites')}</li>
                                    <li>{t('settings.about.features.trends')}</li>
                                    <li>{t('settings.about.features.darkmode')}</li>
                                    <li>{t('settings.about.features.multilang')}</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="text-lg font-bold text-slate-800 dark:text-zinc-200 mb-3">
                                    {t('settings.about.tech.title')}
                                </h3>
                                <div className="text-sm text-slate-700 dark:text-zinc-300">
                                    <p>{t('settings.about.tech.stack')}</p>
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === 'contact' && (
                        <div className="space-y-4">
                            <p className="text-sm text-slate-600 dark:text-zinc-400">
                                {t('contact.openForm')}
                            </p>
                            <form onSubmit={handleContactSubmit} className="space-y-4">
                                <div>
                                    <label htmlFor="contact-name" className="block text-sm font-semibold mb-2 text-slate-700 dark:text-zinc-300">
                                        {t('contact.name')}
                                    </label>
                                    <input
                                        type="text"
                                        id="contact-name"
                                        required
                                        value={contactFormData.name}
                                        onChange={(e) => setContactFormData({ ...contactFormData, name: e.target.value })}
                                        className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>

                                <div>
                                    <label htmlFor="contact-email" className="block text-sm font-semibold mb-2 text-slate-700 dark:text-zinc-300">
                                        {t('contact.email')}
                                    </label>
                                    <input
                                        type="email"
                                        id="contact-email"
                                        required
                                        value={contactFormData.email}
                                        onChange={(e) => setContactFormData({ ...contactFormData, email: e.target.value })}
                                        className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>

                                <div>
                                    <label htmlFor="contact-subject" className="block text-sm font-semibold mb-2 text-slate-700 dark:text-zinc-300">
                                        {t('contact.subject')}
                                    </label>
                                    <input
                                        type="text"
                                        id="contact-subject"
                                        required
                                        value={contactFormData.subject}
                                        onChange={(e) => setContactFormData({ ...contactFormData, subject: e.target.value })}
                                        className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>

                                <div>
                                    <label htmlFor="contact-message" className="block text-sm font-semibold mb-2 text-slate-700 dark:text-zinc-300">
                                        {t('contact.message')}
                                    </label>
                                    <textarea
                                        id="contact-message"
                                        required
                                        rows={6}
                                        value={contactFormData.message}
                                        onChange={(e) => setContactFormData({ ...contactFormData, message: e.target.value })}
                                        className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                                    />
                                </div>

                                {/* reCAPTCHA v3 Badge (unsichtbar) */}
                                <div className="text-xs text-slate-500 dark:text-zinc-500 text-center">
                                    This site is protected by reCAPTCHA and the Google{' '}
                                    <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-700 dark:hover:text-zinc-400">Privacy Policy</a> and{' '}
                                    <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-700 dark:hover:text-zinc-400">Terms of Service</a> apply.
                                </div>

                                {contactStatus === 'success' && (
                                    <div className="p-4 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 rounded-lg text-sm">
                                        {t('contact.success')}
                                    </div>
                                )}

                                {contactStatus === 'error' && (
                                    <div className="p-4 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded-lg text-sm">
                                        {t('contact.error')}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={contactStatus === 'loading'}
                                    className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-bold transition-all duration-200 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-zinc-900"
                                >
                                    <span>{contactStatus === 'loading' ? t('contact.sending') : t('contact.send')}</span>
                                </button>
                            </form>
                        </div>
                    )}
                </div>
                <div className="flex-shrink-0 p-4 border-t border-slate-200 dark:border-zinc-800 flex justify-between items-center bg-slate-100 dark:bg-zinc-900 rounded-b-2xl">
                    {activeTab === 'sources' && (
                        <button
                            onClick={() => setMutedSources([])}
                            disabled={mutedSources.length === 0}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 border-2 bg-slate-200 dark:bg-zinc-700 border-transparent text-slate-600 dark:text-zinc-300 hover:bg-slate-300 dark:hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label={t('settings.unmuteAll')}
                        >
                            <ResetIcon className="w-5 h-5" />
                            <span>{t('settings.unmuteAll')}</span>
                        </button>
                    )}
                    {activeTab !== 'sources' && <div></div>}
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-zinc-900"
                    >
                        {t('settings.done')}
                    </button>
                </div>
            </div>
        </>
    );
};