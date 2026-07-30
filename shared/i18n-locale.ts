export function getDateLocale(language: string | undefined): 'de-DE' | 'en-US' {
    return language?.toLowerCase().startsWith('de') ? 'de-DE' : 'en-US';
}
