import { test, expect, blockExternalRequests, installApiMocks } from './fixtures';
import type { Page, Route } from '@playwright/test';

// Browser-Abnahme des generationsgebundenen Leseprotokolls (Roadmap O3a).
//
// Der dokumentierte Fall vom 29. Juli 2026: das Frontend zeigte dauerhaft eine
// Quelle weniger als der direkt abgerufene Full-Cache. GameStar stand im
// Full-Cache, im Browser aber nicht. Hier laeuft genau dieser Ablauf durch
// echtes Chromium - mit gestellten API-Antworten, ohne jeden echten Endpunkt.

const SNAPSHOT_ID_HEADER = 'x-gamerfeed-snapshot-id';
const SNAPSHOT_SCHEMA_HEADER = 'x-gamerfeed-snapshot-schema';
const SNAPSHOT_CREATED_AT_HEADER = 'x-gamerfeed-snapshot-created-at';

/**
 * Jede Quelle bekommt genau einen Artikel mit eindeutigem Titel. So laesst sich
 * ihre Sichtbarkeit pruefen, ohne etwas ueber das Kartenmarkup anzunehmen.
 */
function titelVon(quelle: string) {
    return `${quelle} Artikel`;
}

function artikel(quelle: string, index: number, sprache = 'de') {
    return {
        id: `${quelle}-${index}`,
        title: titelVon(quelle),
        source: quelle,
        publicationDate: new Date(Date.now() - index * 60_000).toISOString(),
        summary: `Zusammenfassung von ${quelle}`,
        link: `https://beispiel.example/${encodeURIComponent(quelle)}`,
        imageUrl: `https://beispiel.example/${index}.jpg`,
        language: sprache,
    };
}

const ALTER_STAND = [artikel('GameZone', 0), artikel('PC Games', 1)];
const NEUER_STAND = [...ALTER_STAND, artikel('GameStar', 2)];

const GAMEZONE_TITEL = titelVon('GameZone');
const GAMESTAR_TITEL = titelVon('GameStar');

interface Generation {
    snapshotId: string;
    createdAt: string;
    articles: typeof ALTER_STAND;
}

/**
 * Kennung und Zeitstempel muessen zueinander passen: der Zeitanteil der
 * Kennung ist die Sortiergrundlage, und `normalizeSnapshotPointer` weist einen
 * Widerspruch als Legacy ab.
 */
function generation(millis: number, lauf: string, articles: typeof ALTER_STAND): Generation {
    return {
        snapshotId: `${millis}-${lauf}`,
        createdAt: new Date(millis).toISOString(),
        articles,
    };
}

const ALT = generation(Date.parse('2026-07-29T10:00:00.000Z'), 'gha-1', ALTER_STAND);
const NEU = generation(Date.parse('2026-07-29T10:20:00.000Z'), 'gha-2', NEUER_STAND);

function erfuelle(route: Route, generation: Generation | null, body?: unknown) {
    return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: generation === null ? {} : {
            [SNAPSHOT_ID_HEADER]: generation.snapshotId,
            [SNAPSHOT_SCHEMA_HEADER]: '1',
            [SNAPSHOT_CREATED_AT_HEADER]: generation.createdAt,
        },
        body: JSON.stringify(body ?? generation?.articles ?? []),
    });
}

/**
 * Stellt die drei Stufen mit je einer eigenen Generation.
 *
 * Playwright ruft den **zuletzt** registrierten passenden Handler zuerst auf.
 * Der Glob `get-news*` trifft auch `get-news-preview`, deshalb entscheidet ein
 * einziger Handler anhand des Pfads - sonst haengt das Ergebnis von der
 * Registrierungsreihenfolge ab.
 */
async function stelleLadekette(page: Page, stufen: {
    preview: Generation | null;
    medium: Generation | null;
    full: Generation | null;
}, legacyBody?: unknown) {
    await installApiMocks(page);

    await page.route('**/api/get-news*', route => {
        const pfad = new URL(route.request().url()).pathname;
        if (pfad.endsWith('/get-news-preview')) return erfuelle(route, stufen.preview, legacyBody);
        if (pfad.endsWith('/get-news-medium')) return erfuelle(route, stufen.medium, legacyBody);
        return erfuelle(route, stufen.full, legacyBody);
    });

    await blockExternalRequests(page);
}

test.beforeEach(async ({ page }) => {
    // Der lokale 32er-Cache darf keinen Stand aus einem frueheren Test
    // mitbringen. Ein Test, der ihn braucht, setzt ihn danach selbst.
    await page.addInitScript(() => window.localStorage.clear());
});

test('eine neuere Generation in einer spaeteren Stufe wird uebernommen', async ({ page }) => {
    // Der Browser startet auf dem aelteren Stand ohne GameStar und muss nach
    // der Aktualisierung die vollstaendige gepinnte Generation zeigen.
    await stelleLadekette(page, { preview: ALT, medium: ALT, full: NEU });

    await page.goto('/');

    await expect(page.getByText(GAMEZONE_TITEL)).toBeVisible();
    await expect(page.getByText(GAMESTAR_TITEL)).toBeVisible();
});

test('eine aeltere Generation in der letzten Stufe dreht den Stand nicht zurueck', async ({ page }) => {
    // Genau der beobachtete Dauerzustand: die letzte Stufe kommt aus einem
    // aelteren Edge-Cache. Ohne das Protokoll verschwaende GameStar wieder.
    await stelleLadekette(page, { preview: NEU, medium: NEU, full: ALT });

    await page.goto('/');

    await expect(page.getByText(GAMESTAR_TITEL)).toBeVisible();

    // Auch nachdem die letzte Stufe laengst beantwortet ist.
    await page.waitForTimeout(500);
    await expect(page.getByText(GAMESTAR_TITEL)).toBeVisible();
    await expect(page.getByText(GAMEZONE_TITEL)).toBeVisible();
});

test('gepinnte Folgeanfragen tragen die Generation in der Adresse', async ({ page }) => {
    const adressen: string[] = [];
    page.on('request', request => {
        const url = request.url();
        if (url.includes('/api/get-news')) adressen.push(url);
    });

    await stelleLadekette(page, { preview: NEU, medium: NEU, full: NEU });
    await page.goto('/');

    await expect.poll(() => adressen.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);

    const [erste, ...folgende] = adressen;
    expect(erste).not.toContain('snapshot=');
    expect(folgende.every(url => url.includes(`snapshot=${encodeURIComponent(NEU.snapshotId)}`))).toBe(true);
});

test('ohne Generations-Header bleibt das bisherige Verhalten', async ({ page }) => {
    // Legacy-Fall: kein Zeiger, keine Header - der Browser zeigt trotzdem den
    // letzten Stand der Kette.
    await stelleLadekette(page, { preview: null, medium: null, full: null }, NEUER_STAND);

    await page.goto('/');

    await expect(page.getByText(GAMESTAR_TITEL)).toBeVisible();
});

test('eine neuere lokale Kopie wird nicht von einer aelteren Antwort ersetzt', async ({ page }) => {
    // Der lokale 32er-Cache ist 30 Minuten gueltig, der Edge-Cache 60 Sekunden.
    // Eine lokale Kopie kann damit **neuer** sein als die Antwort, die
    // zurueckkommt. Ohne die gespeicherte Generation wuerde sie ersetzt.
    await stelleLadekette(page, { preview: ALT, medium: ALT, full: ALT });

    await page.addInitScript(([artikel, zeiger]) => {
        window.localStorage.setItem('cachedNews', JSON.stringify({
            articles: artikel,
            timestamp: Date.now(),
            snapshot: zeiger,
        }));
    }, [NEUER_STAND, {
        schemaVersion: 1,
        snapshotId: NEU.snapshotId,
        createdAt: NEU.createdAt,
        articleCount: NEUER_STAND.length,
        runId: 'gha-2',
    }] as const);

    await page.goto('/');

    await expect(page.getByText(GAMESTAR_TITEL)).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByText(GAMESTAR_TITEL)).toBeVisible();
});
