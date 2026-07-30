import { expect, test } from './fixtures';

const SAVED_SEARCHES_KEY = 'savedSearches';

test.beforeEach(async ({ page }) => {
    await page.addInitScript(({ key }) => {
        localStorage.setItem(key, JSON.stringify(['GameStar', 'IGN']));
    }, { key: SAVED_SEARCHES_KEY });
});

test('wählt und löscht gespeicherte Suchen vollständig per Tastatur', async ({ page }) => {
    await page.goto('/');

    const search = page.getByRole('textbox', {
        name: /Search articles|Artikel durchsuchen/i,
    });
    await search.focus();

    const savedSearch = page.getByRole('button', { name: 'GameStar', exact: true });
    await expect(savedSearch).toBeVisible();
    await savedSearch.focus();
    await page.keyboard.press('Enter');
    await expect(search).toHaveValue('GameStar');

    await search.focus();
    const secondSavedSearch = page.getByRole('button', { name: 'IGN', exact: true });
    await secondSavedSearch.focus();
    await page.keyboard.press('Space');
    await expect(search).toHaveValue('IGN');

    await search.focus();
    const removeWithSpace = page.getByRole('button', {
        name: /Remove "GameStar" from saved searches|"GameStar" aus gespeicherten Suchen entfernen/i,
    });
    await removeWithSpace.focus();
    await page.keyboard.press('Space');
    await expect(removeWithSpace).toBeHidden();

    const removeWithEnter = page.getByRole('button', {
        name: /Remove "IGN" from saved searches|"IGN" aus gespeicherten Suchen entfernen/i,
    });
    await removeWithEnter.focus();
    await page.keyboard.press('Enter');
    await expect(removeWithEnter).toBeHidden();
    await expect.poll(() => page.evaluate(key => (
        JSON.parse(localStorage.getItem(key) ?? '[]')
    ), SAVED_SEARCHES_KEY)).toEqual([]);

    await search.fill('Neue Suche');
    await expect(page.getByRole('button', {
        name: /Save|Speichern/i,
    }).first()).toBeVisible();
});

test('Artikelaktionen liegen außerhalb des Links und der Optionsdialog gibt Fokus zurück', async ({ page }) => {
    await page.goto('/');

    const title = page.getByRole('link', { name: 'Erster Testartikel' });
    const card = title.locator('xpath=ancestor::article');
    const favorite = card.getByRole('button', {
        name: /Add to favorites|Zu Favoriten hinzufügen/i,
    });
    const more = card.getByRole('button', {
        name: /More options|Weitere Optionen/i,
    });
    const initialUrl = page.url();
    let popupCount = 0;
    page.on('popup', () => {
        popupCount += 1;
    });

    await expect(title.locator('button')).toHaveCount(0);
    expect(await favorite.evaluate(button => button.closest('a') === null)).toBe(true);
    expect(await more.evaluate(button => button.closest('a') === null)).toBe(true);

    await favorite.focus();
    await page.keyboard.press('Enter');
    await expect(card.getByRole('button', {
        name: /Remove from favorites|Aus Favoriten entfernen/i,
    })).toBeFocused();
    await card.getByRole('button', {
        name: /Remove from favorites|Aus Favoriten entfernen/i,
    }).click();
    await expect(page).toHaveURL(initialUrl);
    expect(popupCount).toBe(0);

    await more.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', {
        name: /Article Options|Artikel-Optionen/i,
    })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', {
        name: /Article Options|Artikel-Optionen/i,
    })).toBeHidden();
    await expect(more).toBeFocused();

    await more.click();
    await expect(page.getByRole('dialog', {
        name: /Article Options|Artikel-Optionen/i,
    })).toBeVisible();
    await expect(page).toHaveURL(initialUrl);
    expect(popupCount).toBe(0);
});
