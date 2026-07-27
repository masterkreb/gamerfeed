// Lebenszyklus der Analytics-Einbindung, getrennt von der Consent-Oberflaeche.
//
// Wichtig ist nicht nur das Einschalten, sondern auch das Ausschalten: Ein
// Widerruf muss weitere Treffer stoppen und die gesetzten Cookies entfernen.
// Ohne das laeuft ein einmal geladenes Analytics-Skript unbegrenzt weiter.
//
// window und document sind injizierbar, damit die Zustandswechsel ohne Browser
// pruefbar sind.

export const ANALYTICS_COOKIE_PATTERN = /^(_ga|_gid|_gat)/;

/**
 * @param {{
 *   measurementId: string,
 *   win?: any,
 *   doc?: any,
 * }} options
 */
export function createAnalyticsLifecycle({ measurementId, win, doc }) {
    const targetWindow = win ?? (typeof window === 'undefined' ? undefined : window);
    const targetDocument = doc ?? (typeof document === 'undefined' ? undefined : document);

    let scriptLoaded = false;

    function gtag(...args) {
        // gtag erwartet das arguments-Objekt, nicht ein Array.
        targetWindow.dataLayer.push(args);
    }

    function ensureBootstrapped() {
        if (scriptLoaded) return;

        targetWindow.dataLayer = targetWindow.dataLayer ?? [];
        targetWindow.gtag = gtag;

        // Vor dem ersten Treffer ausdruecklich auf denied setzen, damit auch
        // eine spaetere Zustimmung eine nachvollziehbare Zustandsaenderung ist.
        gtag('consent', 'default', { analytics_storage: 'denied' });
        gtag('js', new Date());
        gtag('config', measurementId, {
            anonymize_ip: true,
            cookie_domain: 'auto',
            cookie_flags: 'SameSite=Lax;Secure',
        });

        const script = targetDocument.createElement('script');
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
        script.dataset.analyticsLifecycle = 'true';
        targetDocument.head.appendChild(script);

        scriptLoaded = true;
    }

    /** Entfernt die von Analytics gesetzten Cookies auf allen plausiblen Domains. */
    function clearAnalyticsCookies() {
        if (!targetDocument?.cookie) return;

        const names = targetDocument.cookie
            .split(';')
            .map(entry => entry.split('=')[0]?.trim())
            .filter(name => name && ANALYTICS_COOKIE_PATTERN.test(name));

        const hostname = targetWindow?.location?.hostname ?? '';
        const parts = hostname.split('.');
        // Cookies koennen auf der Host- oder einer uebergeordneten Domain liegen.
        const domains = [undefined, hostname];
        if (parts.length > 1) {
            domains.push(`.${parts.slice(-2).join('.')}`);
        }

        for (const name of names) {
            for (const domain of domains) {
                const domainPart = domain ? `;domain=${domain}` : '';
                targetDocument.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/${domainPart}`;
            }
        }
    }

    return {
        /** Zustimmung anwenden. Das Skript wird hoechstens einmal geladen. */
        grant() {
            ensureBootstrapped();
            gtag('consent', 'update', { analytics_storage: 'granted' });
        },

        /**
         * Widerruf anwenden. Wurde nie zugestimmt, passiert nichts - es gibt
         * dann weder ein Skript noch Cookies.
         */
        deny() {
            if (scriptLoaded) {
                gtag('consent', 'update', { analytics_storage: 'denied' });
            }
            clearAnalyticsCookies();
        },

        /** Nur fuer Tests und Diagnose. */
        isScriptLoaded() {
            return scriptLoaded;
        },
    };
}
