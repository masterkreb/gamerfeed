import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export const LanguageSwitcher: React.FC = () => {
    const { t, i18n } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const languages = [
        { code: 'en', label: 'EN', flag: '🇬🇧', name: 'English' },
        { code: 'de', label: 'DE', flag: '🇩🇪', name: 'Deutsch' },
    ];

    const currentLanguage = languages.find(lang => i18n.language.startsWith(lang.code)) || languages[0];

    const handleLanguageChange = (langCode: string) => {
        i18n.changeLanguage(langCode);
        setIsOpen(false);
    };

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    return (
        <div ref={menuRef} className="relative">
            {/* Current Language Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-11 h-11 flex items-center justify-center rounded-lg bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 transition-all font-medium text-sm"
                aria-label={t('a11y.changeLanguage', { lang: currentLanguage.name })}
                aria-haspopup="true"
                aria-expanded={isOpen}
            >
                <span className="text-lg">{currentLanguage.flag}</span>
            </button>

            {/* Language Dropdown Menu */}
            {isOpen && (
                <div className="absolute top-full right-0 mt-2 w-40 bg-white dark:bg-zinc-800 rounded-lg shadow-lg ring-1 ring-black/5 p-2 z-30">
                    <div className="flex flex-col gap-1">
                        {languages.map(lang => (
                            <button
                                key={lang.code}
                                onClick={() => handleLanguageChange(lang.code)}
                                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium w-full text-left transition-colors ${
                                    i18n.language.startsWith(lang.code)
                                        ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400'
                                        : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-700'
                                }`}
                            >
                                <span className="text-lg">{lang.flag}</span>
                                <span>{lang.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};