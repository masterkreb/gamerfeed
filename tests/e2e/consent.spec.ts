import { expect, test } from './fixtures';

// Browser-Abnahme des Consent-Lebenszyklus. Netzwerk und Cookies lassen sich
// nur hier echt prüfen - Linkedom kann weder das eine noch das andere.
//
// ACHTUNG: Der Consent-Banner rendert im Produktions-Build derzeit nicht
// (`#cc-main` ist nicht vorhanden, ohne Konsolenfehler). Das ist ein
// bestehender Fehler und war schon vor dem F2-Arbeitspaket so - nachgewiesen
// gegen den Stand vor den Änderungen. Solange er besteht, wird nie eine
// Zustimmung eingeholt und Analytics folglich nie geladen.
//
// Die Abnahmen, die eine Bedienung des Banners voraussetzen, lassen sich
// deshalb noch nicht schreiben. Was hier steht, prüft den Zustand vor jeder
// Zustimmung - und genau der ist derzeit der Dauerzustand.

const ANALYTICS_HOSTS = ['googletagmanager.com', 'google-analytics.com', 'analytics.google.com'];

test('stellt ohne Zustimmung keine Analytics-Anfrage', async ({ page }) => {
    const analyticsRequests: string[] = [];
    page.on('request', request => {
        if (ANALYTICS_HOSTS.some(host => request.url().includes(host))) {
            analyticsRequests.push(request.url());
        }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(analyticsRequests, `unerwartete Anfragen: ${analyticsRequests.join(', ')}`).toEqual([]);
});

test('setzt ohne Zustimmung keine Analytics-Cookies', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const analyticsCookies = (await context.cookies())
        .filter(cookie => /^(_ga|_gid|_gat)/.test(cookie.name))
        .map(cookie => cookie.name);

    expect(analyticsCookies).toEqual([]);
});

test('lädt ohne Zustimmung kein Analytics-Skript', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Das Lebenszyklus-Modul markiert sein Skript; ohne Zustimmung darf es
    // keines geben.
    await expect(page.locator('script[data-analytics-lifecycle]')).toHaveCount(0);
});

// Belegt den offenen Fehler, statt ihn zu übergehen: Sobald der Banner wieder
// erscheint, schlägt dieser Test fehl und die eigentlichen Abnahmen
// (Zustimmung, Widerruf, erneute Zustimmung, dauerhafter Einstellungs-Link)
// können ergänzt werden.
test('bekannter Fehler: der Consent-Banner erscheint nicht', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(
        page.locator('#cc-main'),
        'Der Banner erscheint wieder - die offenen F2-Abnahmen sind jetzt schreibbar.',
    ).toHaveCount(0);
});
