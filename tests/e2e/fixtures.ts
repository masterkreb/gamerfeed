import { test as base, expect, type Page, type Route } from '@playwright/test';

// Gemeinsame Grundlage für alle Browser-Abnahmen.
//
// Zwei Regeln gelten für jeden Test:
//   1. `/api/*` wird vollständig gestellt - kein Test hängt an echten Daten.
//   2. Jede Anfrage an eine fremde Herkunft wird abgebrochen. Ein Test, der
//      versehentlich die produktive API oder ein CDN anspricht, schlägt fehl,
//      statt still zu funktionieren.

export const MOCK_ARTICLES = [
    {
        id: 'artikel-1',
        title: 'Erster Testartikel',
        source: 'Beispiel DE',
        publicationDate: new Date().toISOString(),
        summary: 'Zusammenfassung des ersten Artikels.',
        link: 'https://beispiel.example/artikel-1',
        imageUrl: 'https://beispiel.example/bild-1.jpg',
        language: 'de',
    },
    {
        id: 'artikel-2',
        title: 'Zweiter Testartikel',
        source: 'Example EN',
        publicationDate: new Date(Date.now() - 3_600_000).toISOString(),
        summary: 'Summary of the second article.',
        link: 'https://example.com/article-2',
        imageUrl: 'https://example.com/image-2.jpg',
        language: 'en',
    },
];

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

/** Adressen, die der Browser lokal auflösen darf. */
function isLocalOrigin(url: string) {
    try {
        const { hostname } = new URL(url);
        return hostname === '127.0.0.1' || hostname === 'localhost';
    } catch {
        return false;
    }
}

/**
 * Reihenfolge ist entscheidend: Playwright ruft den **zuletzt** registrierten
 * passenden Handler zuerst auf. Deshalb kommt zuerst das Sicherheitsnetz und
 * danach die konkreten Mocks.
 */
export async function installApiMocks(page: Page) {
    // Sicherheitsnetz: ein nicht gestellter API-Pfad schlägt sichtbar fehl,
    // statt still an die produktive API weitergereicht zu werden. Der
    // Preview-Server leitet /api sonst nach draußen weiter.
    await page.route('**/api/**', route => json(
        route,
        { error: `Kein Mock für ${new URL(route.request().url()).pathname}` },
        501,
    ));

    await page.route('**/api/get-news*', route => json(route, MOCK_ARTICLES));
    await page.route('**/api/get-news-medium*', route => json(route, MOCK_ARTICLES));
    await page.route('**/api/get-news-preview*', route => json(route, MOCK_ARTICLES));
    await page.route('**/api/get-trends*', route => json(route, { trends: [], updatedAt: null }));
    await page.route('**/api/announcement*', route => json(route, null));
}

/**
 * Bricht alles ab, was nicht lokal ist.
 *
 * Für lokale Adressen wird `fallback()` statt `continue()` verwendet: sonst
 * würde dieser zuletzt registrierte Handler die API-Mocks übergehen und die
 * Anfrage an den Preview-Server durchreichen, der /api nach außen weiterleitet.
 */
export async function blockExternalRequests(page: Page, onBlocked?: (url: string) => void) {
    await page.route('**/*', route => {
        const url = route.request().url();
        if (isLocalOrigin(url)) {
            return route.fallback();
        }
        onBlocked?.(url);
        return route.abort('blockedbyclient');
    });
}

export const test = base.extend<{ page: Page }>({
    page: async ({ page }, use) => {
        await installApiMocks(page);
        await blockExternalRequests(page);
        await use(page);
    },
});

export { expect };
