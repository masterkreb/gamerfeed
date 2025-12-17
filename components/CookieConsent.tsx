import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import * as CookieConsent from 'vanilla-cookieconsent';

interface CookieConsentConfig {
    onConsent: (categories: string[]) => void;
}

export const useCookieConsent = ({ onConsent }: CookieConsentConfig) => {
    const { t, i18n } = useTranslation();

    useEffect(() => {
        CookieConsent.run({
            guiOptions: {
                consentModal: {
                    layout: 'box inline',
                    position: 'bottom right',
                    equalWeightButtons: false,
                    flipButtons: false
                },
                preferencesModal: {
                    layout: 'box',
                    equalWeightButtons: false,
                    flipButtons: false
                }
            },

            categories: {
                necessary: {
                    enabled: true,
                    readOnly: true
                },
                analytics: {
                    enabled: false,
                    readOnly: false,
                    autoClear: {
                        cookies: [
                            {
                                name: /^(_ga|_gid)/
                            }
                        ]
                    }
                }
            },

            language: {
                default: i18n.language === 'de' ? 'de' : 'en',
                translations: {
                    en: {
                        consentModal: {
                            title: t('cookie.banner.title'),
                            description: t('cookie.banner.description'),
                            acceptAllBtn: t('cookie.banner.acceptAll'),
                            acceptNecessaryBtn: t('cookie.banner.acceptNecessary'),
                            showPreferencesBtn: t('cookie.banner.settings')
                        },
                        preferencesModal: {
                            title: t('cookie.settings.title'),
                            acceptAllBtn: t('cookie.banner.acceptAll'),
                            acceptNecessaryBtn: t('cookie.banner.acceptNecessary'),
                            savePreferencesBtn: t('cookie.settings.save'),
                            closeIconLabel: t('settings.close'),
                            sections: [
                                {
                                    title: t('cookie.settings.necessary.title'),
                                    description: t('cookie.settings.necessary.description'),
                                    linkedCategory: 'necessary'
                                },
                                {
                                    title: t('cookie.settings.analytics.title'),
                                    description: t('cookie.settings.analytics.description'),
                                    linkedCategory: 'analytics'
                                }
                            ]
                        }
                    },
                    de: {
                        consentModal: {
                            title: t('cookie.banner.title'),
                            description: t('cookie.banner.description'),
                            acceptAllBtn: t('cookie.banner.acceptAll'),
                            acceptNecessaryBtn: t('cookie.banner.acceptNecessary'),
                            showPreferencesBtn: t('cookie.banner.settings')
                        },
                        preferencesModal: {
                            title: t('cookie.settings.title'),
                            acceptAllBtn: t('cookie.banner.acceptAll'),
                            acceptNecessaryBtn: t('cookie.banner.acceptNecessary'),
                            savePreferencesBtn: t('cookie.settings.save'),
                            closeIconLabel: t('settings.close'),
                            sections: [
                                {
                                    title: t('cookie.settings.necessary.title'),
                                    description: t('cookie.settings.necessary.description'),
                                    linkedCategory: 'necessary'
                                },
                                {
                                    title: t('cookie.settings.analytics.title'),
                                    description: t('cookie.settings.analytics.description'),
                                    linkedCategory: 'analytics'
                                }
                            ]
                        }
                    }
                }
            },

            onChange: ({ changedCategories }) => {
                if (changedCategories.includes('analytics')) {
                    const acceptedCategories = CookieConsent.acceptedCategory('analytics') ? ['analytics'] : [];
                    onConsent(acceptedCategories);
                }
            }
        });
    }, [t, i18n.language, onConsent]);

    return {
        showPreferences: () => CookieConsent.showPreferences(),
        acceptedCategory: (category: string) => CookieConsent.acceptedCategory(category)
    };
};
