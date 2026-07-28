import { disableBotDetection, expect, test } from './fixtures';

// Browser-Abnahme des Consent-Lebenszyklus. Netzwerk und Cookies lassen sich
// nur hier echt prüfen - Linkedom kann weder das eine noch das andere.
//
// CookieConsent versteckt sich bei navigator.webdriver === true. Die Fixture
// neutralisiert das ausschliesslich im Test.

const ANALYTICS_HOSTS = ['googletagmanager.com', 'google-analytics.com', 'analytics.google.com'];

const acceptAll = /Accept All|Alle akzeptieren/i;
const rejectAll = /Necessary Only|Nur notwendige/i;
const cookieSettings = /Cookie Settings|Cookie-Einstellungen/i;

/** Der sichtbare Teil des Consent-Dialogs; #cc-main selbst hat keine Groesse. */
const consentDialog = (page: import('@playwright/test').Page) => page.locator('#cc-main .cm, #cc-main .pm');

/**
 * Der dauerhafte Zugang: Einstellungsdialog, Reiter "Rechtliches", Knopf zu den
 * Cookie-Einstellungen. Der Knopf im Banner verschwindet nach der Zustimmung.
 */
async function openCookiePreferences(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: /Settings|Einstellungen/i }).first().click();
    await page.getByRole('tab', { name: /Legal|Rechtliches/i }).click();
    await page.getByRole('button', { name: cookieSettings }).first().click();
}

function trackAnalyticsRequests(page: import('@playwright/test').Page) {
    const requests: string[] = [];
    page.on('request', request => {
        if (ANALYTICS_HOSTS.some(host => request.url().includes(host))) {
            requests.push(request.url());
        }
    });
    return requests;
}

/** Liest die an den Lebenszyklus gemeldeten Consent-Signale aus. */
async function consentSignals(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
        const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [];
        return layer
            .map(entry => Array.from(entry as ArrayLike<unknown>))
            .filter(entry => entry[0] === 'consent')
            .map(entry => [entry[1], (entry[2] as Record<string, string>)?.analytics_storage].join(':'));
    });
}

test.beforeEach(async ({ page }) => {
    await disableBotDetection(page);
});

test('stellt vor der Zustimmung keine Analytics-Anfrage', async ({ page, context }) => {
    const analyticsRequests = trackAnalyticsRequests(page);

    await page.goto('/');
    await expect(consentDialog(page).first()).toBeVisible();
    await page.waitForLoadState('networkidle');

    expect(analyticsRequests, `unerwartete Anfragen: ${analyticsRequests.join(', ')}`).toEqual([]);
    await expect(page.locator('script[data-analytics-lifecycle]')).toHaveCount(0);

    const analyticsCookies = (await context.cookies()).filter(cookie => /^(_ga|_gid|_gat)/.test(cookie.name));
    expect(analyticsCookies.map(cookie => cookie.name)).toEqual([]);
});

test('initialisiert nach der Zustimmung genau einmal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: acceptAll }).click();

    await expect(page.locator('script[data-analytics-lifecycle]')).toHaveCount(1);
    // Erst der Standard denied, dann genau eine Zustimmung.
    expect(await consentSignals(page)).toEqual(['default:denied', 'update:granted']);
});

test('aktiviert Analytics auch für einen wiederkehrenden Nutzer nach dem Reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: acceptAll }).click();
    await expect(page.locator('script[data-analytics-lifecycle]')).toHaveCount(1);

    await page.reload();

    // Die gespeicherte Zustimmung muss erneut angewendet werden - dafür reicht
    // onFirstConsent nicht aus.
    await expect(page.locator('script[data-analytics-lifecycle]')).toHaveCount(1);
    expect(await consentSignals(page)).toEqual(['default:denied', 'update:granted']);
});

test('wendet den Widerruf an und entfernt die Analytics-Cookies', async ({ page, context }) => {
    await page.goto('/');
    await page.getByRole('button', { name: acceptAll }).click();
    await expect(page.locator('script[data-analytics-lifecycle]')).toHaveCount(1);

    // Ein Analytics-Cookie stellen, das der Widerruf entfernen muss.
    await context.addCookies([{
        name: '_ga',
        value: 'GA1.1.testwert',
        domain: '127.0.0.1',
        path: '/',
    }]);

    await openCookiePreferences(page);
    await page.getByRole('button', { name: rejectAll }).first().click();

    expect(await consentSignals(page)).toEqual(['default:denied', 'update:granted', 'update:denied']);

    const analyticsCookies = (await context.cookies()).filter(cookie => /^(_ga|_gid|_gat)/.test(cookie.name));
    expect(analyticsCookies.map(cookie => cookie.name)).toEqual([]);
});

test('erlaubt erneute Zustimmung ohne zweites Skript', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: acceptAll }).click();

    await openCookiePreferences(page);
    await page.getByRole('button', { name: rejectAll }).first().click();

    await openCookiePreferences(page);
    await page.getByRole('button', { name: acceptAll }).first().click();

    await expect(page.locator('script[data-analytics-lifecycle]')).toHaveCount(1);
    expect(await consentSignals(page)).toEqual([
        'default:denied', 'update:granted', 'update:denied', 'update:granted',
    ]);
});

test('schließt den Einstellungsdialog, bevor der Consent-Dialog öffnet', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: acceptAll }).click();

    await page.getByRole('button', { name: /Settings|Einstellungen/i }).first().click();
    const settingsDialog = page.getByRole('dialog').filter({ hasText: /Sources|Quellen/i });
    await expect(settingsDialog).toBeVisible();

    await page.getByRole('tab', { name: /Legal|Rechtliches/i }).click();
    await page.getByRole('button', { name: cookieSettings }).first().click();

    // Zwei dokumentweite Fokusfallen duerfen nicht gleichzeitig aktiv sein.
    await expect(settingsDialog).toHaveCount(0);
    await expect(consentDialog(page).first()).toBeVisible();
});
