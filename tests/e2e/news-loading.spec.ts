import { expect, test } from './fixtures';
import type { Route } from '@playwright/test';

function article(id: string) {
    return {
        id,
        title: `F1 ${id}`,
        source: 'F1 Testquelle',
        publicationDate: '2026-07-29T12:00:00.000Z',
        summary: `Zusammenfassung ${id}`,
        link: `https://example.com/${id}`,
        imageUrl: `https://example.com/${id}.jpg`,
        language: 'de',
    };
}

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
});

test('durchlaeuft Preview, Medium und Full sichtbar in dieser Reihenfolge', async ({ page }) => {
    const previewGate = deferred();
    const mediumGate = deferred();
    const fullGate = deferred();
    const requestedStages: string[] = [];

    await page.route('**/api/get-news*', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/get-news-preview')) {
            requestedStages.push('preview');
            await previewGate.promise;
            return json(route, [article('preview')]);
        }
        if (path.endsWith('/get-news-medium')) {
            requestedStages.push('medium');
            await mediumGate.promise;
            return json(route, [article('medium')]);
        }

        requestedStages.push('full');
        await fullGate.promise;
        return json(route, [article('full')]);
    });

    await page.goto('/');
    await expect.poll(() => requestedStages).toEqual(['preview']);

    previewGate.resolve();
    await expect(page.getByText('F1 preview')).toBeVisible();
    await expect.poll(() => requestedStages).toEqual(['preview', 'medium']);

    mediumGate.resolve();
    await expect(page.getByText('F1 medium')).toBeVisible();
    await expect.poll(() => requestedStages).toEqual(['preview', 'medium', 'full']);

    fullGate.resolve();
    await expect(page.getByText('F1 full')).toBeVisible();
    await expect(page.getByText('F1 preview')).toHaveCount(0);
    await expect(page.getByText('F1 medium')).toHaveCount(0);
});

test('ein manueller Refresh gewinnt gegen die alte Full-Stufe', async ({ page }) => {
    const oldFullGate = deferred();
    let fullRequests = 0;

    await page.route('**/api/get-news*', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/get-news-preview')) {
            return json(route, [article('preview-alt')]);
        }
        if (path.endsWith('/get-news-medium')) {
            return json(route, [article('medium-alt')]);
        }

        fullRequests += 1;
        if (fullRequests === 1) {
            await oldFullGate.promise;
            // Der Browser darf den Request inzwischen abgebrochen haben.
            return json(route, [article('full-alt')]).catch(() => undefined);
        }
        return json(route, [article('refresh-neu')]);
    });

    await page.goto('/');
    await expect(page.getByText('F1 medium-alt')).toBeVisible();
    await expect.poll(() => fullRequests).toBe(1);

    await page.getByRole('button', { name: /News aktualisieren|Refresh news/ }).click();
    await expect(page.getByText('F1 refresh-neu')).toBeVisible();

    oldFullGate.resolve();
    await page.waitForTimeout(100);
    await expect(page.getByText('F1 refresh-neu')).toBeVisible();
    await expect(page.getByText('F1 full-alt')).toHaveCount(0);
});

test('ein Medium-Fehler laesst die Full-Stufe weiterlaufen', async ({ page }) => {
    const requestedStages: string[] = [];

    await page.route('**/api/get-news*', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/get-news-preview')) {
            requestedStages.push('preview');
            return json(route, [article('preview')]);
        }
        if (path.endsWith('/get-news-medium')) {
            requestedStages.push('medium');
            return json(route, { error: 'Medium nicht erreichbar' }, 503);
        }

        requestedStages.push('full');
        return json(route, [article('full-trotz-medium-fehler')]);
    });

    await page.goto('/');

    await expect(page.getByText('F1 full-trotz-medium-fehler')).toBeVisible();
    expect(requestedStages).toEqual(['preview', 'medium', 'full']);
});

test('ein Refresh-Fehler behaelt sichtbare Artikel und meldet sich nicht blockierend', async ({ page }) => {
    let fullRequests = 0;

    await page.route('**/api/get-news*', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/get-news-preview') || path.endsWith('/get-news-medium')) {
            return json(route, [article('sichtbar')]);
        }

        fullRequests += 1;
        if (fullRequests === 1) {
            return json(route, [article('sichtbar')]);
        }
        return json(route, { error: 'Aktualisierung voruebergehend fehlgeschlagen' }, 503);
    });

    await page.goto('/');
    await expect(page.getByText('F1 sichtbar')).toBeVisible();
    await expect.poll(() => fullRequests).toBe(1);

    await page.getByRole('button', { name: /News aktualisieren|Refresh news/ }).click();

    await expect(page.getByText('F1 sichtbar')).toBeVisible();
    await expect(page.getByText(
        /The update failed\. The articles already displayed remain available\.|Die Aktualisierung ist fehlgeschlagen\./,
    )).toBeVisible();
});
