import { expect, MOCK_ARTICLES, test } from './fixtures';

// SEO1: Geprueft wird das **erzeugte** Production-HTML aus `dist/`, einmal ohne
// und einmal mit JavaScript. Alle /api-Antworten sind gestellt, fremde
// Herkuenfte werden abgebrochen - kein produktiver Endpunkt wird aufgerufen.
//
// `/gaming-news` selbst ist eine Vercel-Function und existiert im
// Preview-Server nicht; die Seite wird deshalb in
// `tests/server/unit/gaming-news-page.test.js` geprueft. Hier zaehlt nur, dass
// die Startseite sie als gewoehnlichen Link erschliesst.

test.describe('ohne JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('das Production-HTML zeigt Ueberschrift, Beschreibung und den Link zu /gaming-news', async ({ page }) => {
        await page.goto('/');

        const heading = page.locator('h1');
        await expect(heading).toHaveCount(1);
        await expect(heading).toBeVisible();

        const link = page.locator('a[href="/gaming-news"]');
        await expect(link).toHaveCount(1);
        await expect(link).toBeVisible();

        // Eine eigene Beschreibung, die ohne JavaScript wirklich gerendert wird.
        const rootText = (await page.locator('#root').innerText()).trim();
        expect(rootText.length).toBeGreaterThan(80);

        // Sichtbar heisst: im Viewport-Koordinatensystem mit echter Flaeche.
        const box = await page.locator('#root').boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThan(50);
        expect(box!.height).toBeGreaterThan(20);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
    });

    test('das Production-HTML nennt keine feste Quellenzahl und keine SearchAction', async ({ page }) => {
        const response = await page.goto('/');
        const html = (await response!.text());

        expect(html).not.toMatch(/SearchAction/i);
        expect(html).not.toMatch(/\d+\s*\+?\s*(?:\p{L}+[\s,]+){0,4}(?:quellen|sources)/iu);
    });
});

test.describe('nach dem React-Start', () => {
    test('ersetzt die App den Fallback und behaelt genau eine sichtbare H1', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText(MOCK_ARTICLES[0].title)).toBeVisible();

        const headings = page.locator('h1');
        await expect(headings).toHaveCount(1);
        await expect(headings).toBeVisible();

        // Der Fallbacktext darf nach dem Start nicht neben der App stehen
        // bleiben - sonst haette die Seite zwei widerspruechliche Aussagen.
        await expect(page.locator('[data-seo="fallback"]')).toHaveCount(0);
    });

    test('zeigt den lokalisierten Link zu /gaming-news im Footer', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText(MOCK_ARTICLES[0].title)).toBeVisible();

        const link = page.locator('footer a[href="/gaming-news"]');
        await expect(link).toHaveCount(1);
        await expect(link).toBeVisible();

        const label = (await link.innerText()).trim();
        expect(label.length).toBeGreaterThan(4);
        expect(label).not.toContain('footer.');
    });

    test('laesst die bestehende App-Navigation unveraendert', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText(MOCK_ARTICLES[0].title)).toBeVisible();

        // Der interne Link navigiert normal, oeffnet also keinen neuen Tab.
        const link = page.locator('footer a[href="/gaming-news"]');
        await expect(link).not.toHaveAttribute('target', /.+/);

        // Und die Artikelliste bleibt bedienbar.
        await expect(page.getByText(MOCK_ARTICLES[1].title)).toBeVisible();
    });
});
