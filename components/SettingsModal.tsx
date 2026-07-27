import React, { useMemo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CONTACT_FIELD_LIMITS,
    CONTACT_RECAPTCHA_ACTION,
} from '../shared/contact-contract.js';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { CloseIcon, ResetIcon } from './Icons';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    allSources: { name: string; language: 'de' | 'en' }[];
    mutedSources: string[];
    setMutedSources: React.Dispatch<React.SetStateAction<string[]>>;
}

type TabType = 'sources' | 'legal' | 'about' | 'contact';

const SETTINGS_TABS: { id: TabType; labelKey: string }[] = [
    { id: 'sources', labelKey: 'settings.tabs.sources' },
    { id: 'legal', labelKey: 'settings.tabs.legal' },
    { id: 'about', labelKey: 'settings.tabs.about' },
    { id: 'contact', labelKey: 'settings.tabs.contact' },
];

const getTabId = (tab: TabType) => `settings-tab-${tab}`;
const getPanelId = (tab: TabType) => `settings-panel-${tab}`;

interface RecaptchaClient {
    ready: (callback: () => void) => void;
    execute: (siteKey: string, options: { action: string }) => Promise<string>;
}

const RECAPTCHA_SITE_KEY = '6LeKjy4sAAAAAPqI5SG57GRV4ZxSswqEgCtdilWp';
const RECAPTCHA_SCRIPT_ID = 'gamerfeed-recaptcha';
const RECAPTCHA_LOAD_TIMEOUT_MS = 10_000;
// Nur der reCAPTCHA-Schritt bekommt eine Zeitgrenze. Der Versand selbst laeuft
// ohne: eine clientseitige Grenze koennte kuerzer sein als die erlaubte
// Serverlaufzeit und einen Fehler anzeigen, obwohl die Mail zugestellt wird.
const RECAPTCHA_EXECUTE_TIMEOUT_MS = 15_000;

let recaptchaLoadPromise: Promise<RecaptchaClient> | null = null;

// Begrenzt ein Versprechen, das sonst nie abschliessen wuerde. Der Aufrufer
// behandelt die Ablehnung wie jeden anderen Fehler.
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);

        promise.then(
            value => {
                window.clearTimeout(timeoutId);
                resolve(value);
            },
            error => {
                window.clearTimeout(timeoutId);
                reject(error);
            },
        );
    });
}

function getRecaptchaClient() {
    return (window as Window & { grecaptcha?: RecaptchaClient }).grecaptcha;
}

function loadRecaptcha(): Promise<RecaptchaClient> {
    if (recaptchaLoadPromise) {
        return recaptchaLoadPromise;
    }

    const loadPromise = new Promise<RecaptchaClient>((resolve, reject) => {
        let script = document.querySelector<HTMLScriptElement>(
            `#${RECAPTCHA_SCRIPT_ID}`,
        );
        let settled = false;

        const cleanup = () => {
            window.clearTimeout(timeoutId);
            script?.removeEventListener('load', handleLoad);
            script?.removeEventListener('error', handleError);
        };

        const fail = () => {
            if (settled) return;
            settled = true;
            cleanup();

            if (!getRecaptchaClient()) {
                script?.remove();
            }

            reject(new Error('reCAPTCHA konnte nicht geladen werden.'));
        };

        const waitUntilReady = () => {
            const client = getRecaptchaClient();
            if (!client) {
                fail();
                return;
            }

            client.ready(() => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(client);
            });
        };

        function handleLoad() {
            waitUntilReady();
        }

        function handleError() {
            fail();
        }

        const timeoutId = window.setTimeout(fail, RECAPTCHA_LOAD_TIMEOUT_MS);
        const existingClient = getRecaptchaClient();

        if (existingClient) {
            waitUntilReady();
            return;
        }

        if (!script) {
            script = document.createElement('script');
            script.id = RECAPTCHA_SCRIPT_ID;
            script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
            script.async = true;
            script.defer = true;
        }

        script.addEventListener('load', handleLoad, { once: true });
        script.addEventListener('error', handleError, { once: true });

        if (!script.isConnected) {
            document.body.appendChild(script);
        }
    });

    recaptchaLoadPromise = loadPromise;
    void loadPromise.catch(() => {
        if (recaptchaLoadPromise === loadPromise) {
            recaptchaLoadPromise = null;
        }
    });

    return loadPromise;
}

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

    const [activeTab, setActiveTab] = useState<TabType>('sources');
    const [contactFormData, setContactFormData] = useState({ name: '', email: '', subject: '', message: '' });
    const [contactStatus, setContactStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const contactStatusResetTimeoutRef = useRef<number | null>(null);

    useEffect(() => () => {
        if (contactStatusResetTimeoutRef.current !== null) {
            window.clearTimeout(contactStatusResetTimeoutRef.current);
        }
    }, []);

    // reCAPTCHA v3 laden wenn Kontakt-Tab aktiv
    useEffect(() => {
        if (activeTab === 'contact') {
            void loadRecaptcha().catch(() => undefined);
        }
    }, [activeTab]);

    const isSendingContact = contactStatus === 'loading';

    // Der Dialog bleibt jederzeit schliessbar. SettingsModal bleibt in App.tsx
    // montiert und rendert bei isOpen=false nur null - der Formularzustand
    // ueberlebt das Schliessen also. Ein Sperren waehrend des Versands wuerde den
    // Benutzer bei einer haengenden Anfrage im Dialog festhalten.
    const dialogRef = useDialogFocus<HTMLDivElement>({
        isOpen,
        onClose,
    });

    const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        const lastIndex = SETTINGS_TABS.length - 1;
        let nextIndex: number | null = null;

        if (event.key === 'ArrowRight') {
            nextIndex = index === lastIndex ? 0 : index + 1;
        } else if (event.key === 'ArrowLeft') {
            nextIndex = index === 0 ? lastIndex : index - 1;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = lastIndex;
        }

        if (nextIndex === null) return;

        event.preventDefault();
        setActiveTab(SETTINGS_TABS[nextIndex].id);
        tabRefs.current[nextIndex]?.focus();
    };

    const handleContactSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Verhindert eine zweite Uebermittlung, falls das Formular waehrend eines
        // laufenden Versands erneut abgeschickt wird.
        if (isSendingContact) return;

        if (contactStatusResetTimeoutRef.current !== null) {
            window.clearTimeout(contactStatusResetTimeoutRef.current);
            contactStatusResetTimeoutRef.current = null;
        }

        setContactStatus('loading');

        try {
            const normalizedContact = {
                name: contactFormData.name.trim(),
                email: contactFormData.email.trim(),
                subject: contactFormData.subject.trim(),
                message: contactFormData.message.trim(),
            };

            if (Object.values(normalizedContact).some(value => value.length === 0)) {
                setContactStatus('error');
                return;
            }

            // reCAPTCHA v3 Token erst nach vollständig geladenem Client holen.
            // execute() kann ohne Antwort haengen bleiben und wuerde das Formular
            // sonst dauerhaft im Sendezustand lassen.
            const grecaptcha = await loadRecaptcha();
            const token = await withTimeout(
                grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: CONTACT_RECAPTCHA_ACTION }),
                RECAPTCHA_EXECUTE_TIMEOUT_MS,
                'reCAPTCHA hat nicht rechtzeitig geantwortet.',
            );

            const response = await fetch('/api/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...normalizedContact, recaptchaToken: token }),
            });

            if (response.ok) {
                setContactStatus('success');
                setContactFormData({ name: '', email: '', subject: '', message: '' });
                contactStatusResetTimeoutRef.current = window.setTimeout(() => {
                    setContactStatus('idle');
                    contactStatusResetTimeoutRef.current = null;
                }, 3000);
            } else {
                setContactStatus('error');
            }
        } catch {
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
                ref={dialogRef}
                tabIndex={-1}
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
                <div
                    role="tablist"
                    aria-label={t('settings.title')}
                    className="flex border-b border-slate-200 dark:border-zinc-800 flex-shrink-0"
                >
                    {SETTINGS_TABS.map((tab, index) => (
                        <button
                            key={tab.id}
                            ref={element => { tabRefs.current[index] = element; }}
                            type="button"
                            role="tab"
                            id={getTabId(tab.id)}
                            aria-selected={activeTab === tab.id}
                            aria-controls={getPanelId(tab.id)}
                            // Roving tabIndex: nur der aktive Reiter liegt in der Tab-Reihenfolge,
                            // zwischen den Reitern wird mit den Pfeiltasten gewechselt.
                            tabIndex={activeTab === tab.id ? 0 : -1}
                            onClick={() => setActiveTab(tab.id)}
                            onKeyDown={event => handleTabKeyDown(event, index)}
                            className={`flex-1 px-4 py-3 text-sm font-semibold transition-colors ${
                                activeTab === tab.id
                                    ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
                            }`}
                        >
                            {t(tab.labelKey)}
                        </button>
                    ))}
                </div>

                <div className="p-6 flex-grow overflow-y-auto">
                    <div
                        role="tabpanel"
                        id={getPanelId('sources')}
                        aria-labelledby={getTabId('sources')}
                        hidden={activeTab !== 'sources'}
                    >
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
                    </div>

                    <div
                        role="tabpanel"
                        id={getPanelId('legal')}
                        aria-labelledby={getTabId('legal')}
                        hidden={activeTab !== 'legal'}
                        // Reiner Text ohne Bedienelemente: ohne tabIndex waere der
                        // Bereich per Tastatur weder erreichbar noch scrollbar.
                        tabIndex={0}
                        className="space-y-8 prose dark:prose-invert max-w-none prose-slate dark:prose-zinc">
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

                    <div
                        role="tabpanel"
                        id={getPanelId('about')}
                        aria-labelledby={getTabId('about')}
                        hidden={activeTab !== 'about'}
                        // Wie bei "Rechtliches": reiner Text, sonst nicht erreichbar.
                        tabIndex={0}
                        className="space-y-6 prose dark:prose-invert max-w-none prose-slate dark:prose-zinc">
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

                    <div
                        role="tabpanel"
                        id={getPanelId('contact')}
                        aria-labelledby={getTabId('contact')}
                        hidden={activeTab !== 'contact'}
                        className="space-y-4"
                    >
                            <p className="text-sm text-slate-600 dark:text-zinc-400">
                                {t('contact.openForm')}
                            </p>
                            <form onSubmit={handleContactSubmit} aria-busy={isSendingContact}>
                                <fieldset
                                    disabled={isSendingContact}
                                    className="space-y-4 border-0 p-0 m-0 min-w-0"
                                >
                                <div>
                                    <label htmlFor="contact-name" className="block text-sm font-semibold mb-2 text-slate-700 dark:text-zinc-300">
                                        {t('contact.name')}
                                    </label>
                                    <input
                                        type="text"
                                        id="contact-name"
                                        required
                                        maxLength={CONTACT_FIELD_LIMITS.name}
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
                                        maxLength={CONTACT_FIELD_LIMITS.email}
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
                                        maxLength={CONTACT_FIELD_LIMITS.subject}
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
                                        maxLength={CONTACT_FIELD_LIMITS.message}
                                        value={contactFormData.message}
                                        onChange={(e) => setContactFormData({ ...contactFormData, message: e.target.value })}
                                        className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                                    />
                                </div>

                                {/* reCAPTCHA v3 Badge (unsichtbar) */}
                                <div className="text-xs text-slate-500 dark:text-zinc-500 text-center">
                                        {t('contact.recaptchaBadge')}
                                     </div>

                                {contactStatus === 'success' && (
                                    <div
                                        role="status"
                                        aria-live="polite"
                                        className="p-4 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 rounded-lg text-sm"
                                    >
                                        {t('contact.success')}
                                    </div>
                                )}

                                {contactStatus === 'error' && (
                                    <div
                                        role="alert"
                                        className="p-4 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded-lg text-sm"
                                    >
                                        {t('contact.error')}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={isSendingContact}
                                    className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-bold transition-all duration-200 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-zinc-900"
                                >
                                    <span>{isSendingContact ? t('contact.sending') : t('contact.send')}</span>
                                </button>
                                </fieldset>
                            </form>
                    </div>
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
