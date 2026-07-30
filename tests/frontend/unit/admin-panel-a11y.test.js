import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createServer } from 'vite';
import {
    click,
    pressKey,
    renderAdminPanel,
    silenceConsole,
} from '../helpers/admin-panel-harness.js';

const vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    logLevel: 'silent',
    server: {
        middlewareMode: true,
    },
});

test.after(async () => {
    await vite.close();
});

const FEEDS = Object.freeze([
    Object.freeze({
        id: 'feed-fehler',
        name: 'Kaputt',
        url: 'https://kaputt.example/feed.xml',
        language: 'de',
        priority: 'primary',
        needsScraping: false,
    }),
    Object.freeze({
        id: 'feed-ok',
        name: 'Heil',
        url: 'https://heil.example/feed.xml',
        language: 'de',
        priority: 'primary',
        needsScraping: false,
    }),
    Object.freeze({
        id: 'feed-warnung',
        name: 'Leer',
        url: 'https://leer.example/feed.xml',
        language: 'en',
        priority: 'secondary',
        needsScraping: false,
    }),
]);

const HEALTH_RESPONSE = Object.freeze({
    healthStatus: {
        'feed-fehler': { status: 'error', message: 'HTTP 500' },
        'feed-ok': { status: 'success' },
        'feed-warnung': { status: 'success' },
    },
    sourcesInCache: ['Heil'],
    heartbeat: null,
    snapshot: null,
});

const TAB_IDS = ['management', 'health', 'announcement', 'legend'];

const getTabs = container => Array.from(container.querySelectorAll('[role="tab"]'));
const getPanels = container => Array.from(container.querySelectorAll('[role="tabpanel"]'));

async function renderPanel() {
    return renderAdminPanel(vite, {
        feeds: FEEDS,
        healthResponse: HEALTH_RESPONSE,
    });
}

test('die Admin-Reiter tragen IDs, aria-controls, aria-labelledby und genau einen tabIndex 0', async () => {
    const restoreConsole = silenceConsole();
    const testRoot = await renderPanel();

    try {
        const tabs = getTabs(testRoot.container);
        const panels = getPanels(testRoot.container);

        assert.equal(tabs.length, 4, 'vier Reiter');
        assert.equal(panels.length, 4, 'vier Panels');

        const tablist = testRoot.container.querySelector('[role="tablist"]');
        assert.ok(tablist !== null, 'es gibt eine Reiterleiste');
        assert.equal(tablist.getAttribute('aria-label'), 'Admin-Bereiche');

        tabs.forEach((tab, index) => {
            const expectedTabId = `admin-tab-${TAB_IDS[index]}`;
            const expectedPanelId = `admin-panel-${TAB_IDS[index]}`;

            assert.equal(tab.id, expectedTabId, `Reiter ${index} hat eine stabile ID`);
            assert.equal(tab.getAttribute('type'), 'button');
            assert.equal(tab.getAttribute('aria-controls'), expectedPanelId);

            const panel = testRoot.container.querySelector(`#${expectedPanelId}`);
            assert.ok(panel !== null, `Panel ${expectedPanelId} existiert`);
            assert.equal(panel.getAttribute('role'), 'tabpanel');
            assert.equal(panel.getAttribute('aria-labelledby'), expectedTabId);
        });

        assert.deepEqual(
            tabs.map(tab => tab.getAttribute('aria-selected')),
            ['true', 'false', 'false', 'false'],
        );
        assert.deepEqual(
            tabs.map(tab => tab.getAttribute('tabindex')),
            ['0', '-1', '-1', '-1'],
            'genau der aktive Reiter liegt in der Tab-Reihenfolge',
        );
        assert.deepEqual(
            getPanels(testRoot.container).map(panel => panel.hasAttribute('hidden')),
            [false, true, true, true],
        );
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('Pfeiltasten laufen mit Umlauf, Home und End springen an die Ränder', async () => {
    const restoreConsole = silenceConsole();
    const testRoot = await renderPanel();

    try {
        const activeIndex = () => getTabs(testRoot.container)
            .findIndex(tab => tab.getAttribute('aria-selected') === 'true');
        const focusedIndex = () => getTabs(testRoot.container)
            .indexOf(testRoot.window.document.activeElement);
        const visiblePanelIndex = () => getPanels(testRoot.container)
            .findIndex(panel => !panel.hasAttribute('hidden'));

        const pressOnActiveTab = async key => {
            const tab = getTabs(testRoot.container)[activeIndex()];
            let event;
            await act(async () => {
                event = pressKey(testRoot.window, tab, key);
            });
            return event;
        };

        const right = await pressOnActiveTab('ArrowRight');
        assert.equal(right.defaultPrevented, true, 'ArrowRight wird behandelt');
        assert.equal(activeIndex(), 1);
        assert.equal(focusedIndex(), 1, 'der neue Reiter bekommt den Fokus');
        assert.equal(visiblePanelIndex(), 1, 'das zugehörige Panel wird sichtbar');

        await pressOnActiveTab('ArrowLeft');
        assert.equal(activeIndex(), 0);

        // Umlauf nach links vom ersten auf den letzten Reiter.
        await pressOnActiveTab('ArrowLeft');
        assert.equal(activeIndex(), 3);
        assert.equal(focusedIndex(), 3);

        // Umlauf nach rechts vom letzten auf den ersten Reiter.
        await pressOnActiveTab('ArrowRight');
        assert.equal(activeIndex(), 0);

        const end = await pressOnActiveTab('End');
        assert.equal(end.defaultPrevented, true);
        assert.equal(activeIndex(), 3);
        assert.equal(visiblePanelIndex(), 3);

        const home = await pressOnActiveTab('Home');
        assert.equal(home.defaultPrevented, true);
        assert.equal(activeIndex(), 0);
        assert.equal(visiblePanelIndex(), 0);

        // Andere Tasten bleiben unangetastet.
        const other = await pressOnActiveTab('a');
        assert.equal(other.defaultPrevented, false);
        assert.equal(activeIndex(), 0);
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('ein Mausklick wählt denselben Reiter wie die Tastatur', async () => {
    const restoreConsole = silenceConsole();
    const testRoot = await renderPanel();

    try {
        await act(async () => {
            click(testRoot.window, getTabs(testRoot.container)[2]);
        });

        const tabs = getTabs(testRoot.container);
        assert.equal(tabs[2].getAttribute('aria-selected'), 'true');
        assert.deepEqual(tabs.map(tab => tab.getAttribute('tabindex')), ['-1', '-1', '0', '-1']);
        assert.equal(
            testRoot.container.querySelector('#admin-panel-announcement').hasAttribute('hidden'),
            false,
        );
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('beide Aufklapp-Schaltflächen sind eindeutig benannt und steuern echte Bereiche', async () => {
    const restoreConsole = silenceConsole();
    const testRoot = await renderPanel();

    try {
        const errorToggle = testRoot.container.querySelector(
            'button[aria-controls="admin-failed-feeds-details"]',
        );
        const warningToggle = testRoot.container.querySelector(
            'button[aria-controls="admin-warning-feeds-details"]',
        );

        assert.ok(errorToggle !== null, 'die Fehlerliste hat eine benannte Schaltfläche');
        assert.ok(warningToggle !== null, 'die Warnungsliste hat eine benannte Schaltfläche');

        // Aufgeklappt: der Name beschreibt das Einklappen und trennt Fehler von Warnungen.
        assert.equal(errorToggle.getAttribute('aria-expanded'), 'true');
        assert.equal(errorToggle.getAttribute('aria-label'), 'Fehlerdetails ausblenden');
        assert.equal(warningToggle.getAttribute('aria-expanded'), 'true');
        assert.equal(warningToggle.getAttribute('aria-label'), 'Warnungsdetails ausblenden');
        assert.notEqual(
            errorToggle.getAttribute('aria-label'),
            warningToggle.getAttribute('aria-label'),
        );

        assert.ok(
            testRoot.container.querySelector('#admin-failed-feeds-details') !== null,
            'aria-controls verweist auf einen vorhandenen Bereich',
        );
        assert.ok(
            testRoot.container.querySelector('#admin-warning-feeds-details') !== null,
            'aria-controls verweist auf einen vorhandenen Bereich',
        );

        await act(async () => {
            click(testRoot.window, errorToggle);
        });
        await act(async () => {
            click(testRoot.window, warningToggle);
        });

        assert.equal(errorToggle.getAttribute('aria-expanded'), 'false');
        assert.equal(errorToggle.getAttribute('aria-label'), 'Fehlerdetails einblenden');
        assert.equal(warningToggle.getAttribute('aria-expanded'), 'false');
        assert.equal(warningToggle.getAttribute('aria-label'), 'Warnungsdetails einblenden');
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});
