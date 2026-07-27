import { blockExternalRequests, expect, installApiMocks, MOCK_ARTICLES, test } from './fixtures';

// Neutraler Rauchtest: Startet die App und prüft, dass die erste
// Artikelanzeige zustande kommt. Fachliche Abnahmen kommen in den jeweiligen
// Arbeitspaketen dazu.

test('startet und zeigt die ersten Artikel an', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText(MOCK_ARTICLES[0].title)).toBeVisible();
    await expect(page.getByText(MOCK_ARTICLES[1].title)).toBeVisible();
});

test('rendert ohne Konsolenfehler', async ({ page }) => {
    const errors: string[] = [];

    // Blockierte externe Ressourcen sind das gewollte Verhalten des
    // Netzwerkschutzes und kein Fehler der Anwendung.
    const isDeliberatelyBlocked = (text: string) => text.includes('ERR_BLOCKED_BY_CLIENT');

    page.on('console', message => {
        if (message.type() === 'error' && !isDeliberatelyBlocked(message.text())) {
            errors.push(message.text());
        }
    });
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/');
    await expect(page.getByText(MOCK_ARTICLES[0].title)).toBeVisible();

    expect(errors, `Konsolenfehler: ${errors.join(' | ')}`).toEqual([]);
});

// Dieser Test verwendet bewusst die unveränderte Playwright-Seite, um die
// Schutzregel selbst zu prüfen statt sie vorauszusetzen.
test.describe('Netzwerkschutz', () => {
    test('bricht Anfragen an fremde Herkünfte ab', async ({ browser }) => {
        const page = await browser.newPage();
        const blocked: string[] = [];

        await installApiMocks(page);
        await blockExternalRequests(page, url => blocked.push(url));

        try {
            await page.goto('/');
            await expect(page.getByText(MOCK_ARTICLES[0].title)).toBeVisible();

            // Ein Zugriff auf die produktive API muss im Test scheitern.
            const reachedProduction = await page.evaluate(async () => {
                try {
                    await fetch('https://gamerfeed.vercel.app/api/get-news');
                    return true;
                } catch {
                    return false;
                }
            });

            expect(reachedProduction, 'die produktive API war erreichbar').toBe(false);
            expect(blocked.some(url => url.includes('gamerfeed.vercel.app'))).toBe(true);
        } finally {
            await page.close();
        }
    });
});
