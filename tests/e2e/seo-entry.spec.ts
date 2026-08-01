import { expect, MOCK_ARTICLES, test } from './fixtures';

// Geprueft wird das **erzeugte** Production-HTML aus `dist/`, einmal ohne und
// einmal mit JavaScript. Alle /api-Antworten sind gestellt, fremde Herkuenfte
// werden abgebrochen - kein produktiver Endpunkt wird aufgerufen.
//
// `/gaming-news` selbst ist eine Vercel-Function und existiert im
// Preview-Server nicht; die Seite wird deshalb in
// `tests/server/unit/gaming-news-page.test.js` geprueft. Hier zaehlt nur, dass
// die App sie im erreichbaren About-Bereich als gewoehnlichen Link erschliesst.

test.describe('ohne JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('das Production-HTML zeigt keine vorgeschaltete Textseite', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('#root')).toHaveCount(1);
        await expect(page.locator('#root')).toBeEmpty();
        await expect(page.locator('h1, p, a')).toHaveCount(0);
        expect((await page.locator('body').innerText()).trim()).toBe('');
        await expect(page.locator('[data-seo="fallback"], .app-fallback')).toHaveCount(0);
    });

    test('das Production-HTML nennt keine feste Quellenzahl und keine SearchAction', async ({ page }) => {
        const response = await page.goto('/');
        const html = (await response!.text());

        expect(html).not.toMatch(/SearchAction/i);
        expect(html).not.toMatch(/\d+\s*\+?\s*(?:\p{L}+[\s,]+){0,4}(?:quellen|sources)/iu);
    });
});

test.describe('nach dem React-Start', () => {
    test('startet direkt mit der App und zeigt genau eine sichtbare H1', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText(MOCK_ARTICLES[0].title)).toBeVisible();

        const headings = page.locator('h1');
        await expect(headings).toHaveCount(1);
        await expect(headings).toBeVisible();

        await expect(page.locator('[data-seo="fallback"]')).toHaveCount(0);
    });

    test('zeigt den lokalisierten Link zu /gaming-news unter Ueber uns', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText(MOCK_ARTICLES[0].title)).toBeVisible();

        await page.getByRole('button', { name: /Settings|Einstellungen/i }).first().click();
        await page.getByRole('tab', { name: /About|Über uns/i }).click();

        const link = page.locator('#settings-panel-about a[href="/gaming-news"]');
        await expect(link).toHaveCount(1);
        await expect(link).toBeVisible();

        const label = (await link.innerText()).trim();
        expect(label.length).toBeGreaterThan(4);
        expect(label).not.toContain('settings.');
    });

    test('zeigt die Artikelliste ohne unerreichbaren Footer', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText(MOCK_ARTICLES[0].title)).toBeVisible();

        await expect(page.locator('footer')).toHaveCount(0);
        await expect(page.getByText(MOCK_ARTICLES[1].title)).toBeVisible();
    });
});
