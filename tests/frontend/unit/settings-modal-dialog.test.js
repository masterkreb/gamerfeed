import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createServer } from 'vite';
import {
    createReactTestRoot,
    dispatchKeyboardEvent,
} from '../helpers/react-test-root.js';

// Vor jedem window-Override festhalten: linkedoms window teilt sich den globalen
// Namensraum, ein Wrapper wuerde sonst sich selbst aufrufen.
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;

const vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    logLevel: 'silent',
    server: {
        middlewareMode: true,
    },
});

// Der Kontakt-Reiter laedt beim Aktivieren reCAPTCHA nach und greift dabei auf
// Timer und grecaptcha zu. linkedom bringt beides nicht mit; ohne die Stubs
// laeuft die Ladelogik nach Testende weiter und wirft.
function installBrowserStubs(window) {
    Object.defineProperty(window, 'setTimeout', {
        configurable: true,
        value: (...args) => nativeSetTimeout(...args),
    });
    Object.defineProperty(window, 'clearTimeout', {
        configurable: true,
        value: (...args) => nativeClearTimeout(...args),
    });
    Object.defineProperty(window, 'grecaptcha', {
        configurable: true,
        value: {
            ready: callback => callback(),
            execute: async () => 'test-token',
        },
    });
}

test.after(async () => {
    await vite.close();
});

function click(window, element) {
    element.dispatchEvent(new window.Event('click', {
        bubbles: true,
        cancelable: true,
    }));
}

async function renderSettingsModal(testRoot) {
    installBrowserStubs(testRoot.window);
    await vite.ssrLoadModule('/i18n.ts');
    const { SettingsModal } = await vite.ssrLoadModule('/components/SettingsModal.tsx');

    function Harness() {
        const [isOpen, setIsOpen] = useState(false);
        const [mutedSources, setMutedSources] = useState([]);

        return React.createElement(
            React.Fragment,
            null,
            React.createElement(
                'button',
                { type: 'button', id: 'open-settings', onClick: () => setIsOpen(true) },
                'Einstellungen',
            ),
            React.createElement(SettingsModal, {
                isOpen,
                onClose: () => setIsOpen(false),
                allSources: [
                    { name: 'GameStar', language: 'de' },
                    { name: 'IGN', language: 'en' },
                ],
                mutedSources,
                setMutedSources,
            }),
        );
    }

    await testRoot.render(React.createElement(Harness));
    return testRoot.container.querySelector('#open-settings');
}

function getDialog(testRoot) {
    return testRoot.container.querySelector('[role="dialog"]');
}

// Spiegelt die Auswahl aus useDialogFocus, um dieselbe Reihenfolge zu pruefen -
// einschliesslich des Ausschlusses ausgeblendeter Bereiche.
function getFocusable(dialog) {
    return Array.from(dialog.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )).filter(element => !element.closest('[hidden], [aria-hidden="true"]'));
}

function getTabs(dialog) {
    return Array.from(dialog.querySelectorAll('[role="tab"]'));
}

// React-Handler haengen am Element; ein auf document abgesetztes Ereignis
// erreicht sie nicht.
function dispatchKeyOn(window, element, key) {
    const event = new window.Event('keydown', { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
        key: { value: key },
        shiftKey: { value: false },
    });
    element.dispatchEvent(event);
    return event;
}

test('setzt den Fokus im Einstellungsdialog, schließt per Escape und gibt den Fokus zurück', async () => {
    const testRoot = await createReactTestRoot();

    try {
        const trigger = await renderSettingsModal(testRoot);

        // Geschlossen ist der Dialog gar nicht im DOM und damit nicht erreichbar.
        assert.equal(getDialog(testRoot), null);

        trigger.focus();
        await act(async () => {
            click(testRoot.window, trigger);
        });

        const dialog = getDialog(testRoot);
        assert.notEqual(dialog, null);
        assert.equal(dialog.getAttribute('aria-modal'), 'true');

        // Erster fokussierbarer Knopf ist das Schließen-Kreuz in der Kopfzeile.
        const closeButton = getFocusable(dialog)[0];
        assert.equal(testRoot.window.document.activeElement, closeButton);

        await act(async () => {
            dispatchKeyboardEvent(testRoot.window, 'Escape');
        });

        assert.equal(getDialog(testRoot), null);
        assert.equal(testRoot.window.document.activeElement, trigger);
    } finally {
        await testRoot.cleanup();
    }
});

test('haelt den Fokus im Einstellungsdialog fest', async () => {
    const testRoot = await createReactTestRoot();

    try {
        const trigger = await renderSettingsModal(testRoot);
        trigger.focus();
        await act(async () => {
            click(testRoot.window, trigger);
        });

        const dialog = getDialog(testRoot);
        const focusable = getFocusable(dialog);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        assert.ok(focusable.length > 1);

        last.focus();
        await act(async () => {
            dispatchKeyboardEvent(testRoot.window, 'Tab');
        });
        assert.equal(testRoot.window.document.activeElement, first);

        first.focus();
        await act(async () => {
            dispatchKeyboardEvent(testRoot.window, 'Tab', { shiftKey: true });
        });
        assert.equal(testRoot.window.document.activeElement, last);
    } finally {
        await testRoot.cleanup();
    }
});

test('bildet die Reiter als barrierefreie Tabs mit passenden Panels ab', async () => {
    const testRoot = await createReactTestRoot();

    try {
        const trigger = await renderSettingsModal(testRoot);
        trigger.focus();
        await act(async () => {
            click(testRoot.window, trigger);
        });

        const dialog = getDialog(testRoot);
        const tablist = dialog.querySelector('[role="tablist"]');
        assert.notEqual(tablist, null);
        assert.ok(tablist.getAttribute('aria-label'));

        const tabs = getTabs(dialog);
        assert.equal(tabs.length, 4);

        // Genau ein ausgewaehlter Reiter, und nur dieser liegt in der Tab-Reihenfolge.
        assert.deepEqual(
            tabs.map(tab => tab.getAttribute('aria-selected')),
            ['true', 'false', 'false', 'false'],
        );
        assert.deepEqual(
            tabs.map(tab => tab.getAttribute('tabindex')),
            ['0', '-1', '-1', '-1'],
        );

        // Jedes aria-controls zeigt auf ein vorhandenes Panel, das zurueckverweist.
        for (const tab of tabs) {
            const panel = dialog.querySelector(`#${tab.getAttribute('aria-controls')}`);
            assert.notEqual(panel, null, `Panel zu ${tab.getAttribute('id')} fehlt`);
            assert.equal(panel.getAttribute('role'), 'tabpanel');
            assert.equal(panel.getAttribute('aria-labelledby'), tab.getAttribute('id'));
        }

        // Nur das aktive Panel ist sichtbar.
        const panels = Array.from(dialog.querySelectorAll('[role="tabpanel"]'));
        assert.deepEqual(
            panels.map(panel => panel.hasAttribute('hidden')),
            [false, true, true, true],
        );

        // Ausgeblendete Panels zaehlen nicht zur Fokusfalle.
        const focusable = getFocusable(dialog);
        assert.equal(focusable.some(element => element.closest('[hidden]')), false);
    } finally {
        await testRoot.cleanup();
    }
});

test('wechselt die Reiter mit Pfeiltasten, Home und End', async () => {
    const testRoot = await createReactTestRoot();

    try {
        const trigger = await renderSettingsModal(testRoot);
        trigger.focus();
        await act(async () => {
            click(testRoot.window, trigger);
        });

        const dialog = getDialog(testRoot);
        const tabs = getTabs(dialog);
        const selectedIndex = () => getTabs(dialog)
            .findIndex(tab => tab.getAttribute('aria-selected') === 'true');

        const press = async (fromIndex, key) => {
            tabs[fromIndex].focus();
            await act(async () => {
                dispatchKeyOn(testRoot.window, tabs[fromIndex], key);
            });
        };

        await press(0, 'ArrowRight');
        assert.equal(selectedIndex(), 1);
        assert.equal(testRoot.window.document.activeElement, tabs[1]);

        // Vom letzten Reiter zurueck auf den ersten.
        await press(3, 'ArrowRight');
        assert.equal(selectedIndex(), 0);
        assert.equal(testRoot.window.document.activeElement, tabs[0]);

        // Und in der Gegenrichtung vom ersten auf den letzten.
        await press(0, 'ArrowLeft');
        assert.equal(selectedIndex(), 3);
        assert.equal(testRoot.window.document.activeElement, tabs[3]);

        await press(2, 'Home');
        assert.equal(selectedIndex(), 0);
        assert.equal(testRoot.window.document.activeElement, tabs[0]);

        await press(1, 'End');
        assert.equal(selectedIndex(), 3);
        assert.equal(testRoot.window.document.activeElement, tabs[3]);

        // Das jeweils gewaehlte Panel ist sichtbar, die anderen nicht.
        const panels = Array.from(dialog.querySelectorAll('[role="tabpanel"]'));
        assert.deepEqual(
            panels.map(panel => panel.hasAttribute('hidden')),
            [true, true, true, false],
        );

        // Eine nicht belegte Taste laesst die Auswahl unveraendert.
        await press(3, 'ArrowUp');
        assert.equal(selectedIndex(), 3);
    } finally {
        await testRoot.cleanup();
    }
});

test('schließt den Einstellungsdialog per Schließen-Knopf und gibt den Fokus zurück', async () => {
    const testRoot = await createReactTestRoot();

    try {
        const trigger = await renderSettingsModal(testRoot);
        trigger.focus();
        await act(async () => {
            click(testRoot.window, trigger);
        });

        const closeButton = getFocusable(getDialog(testRoot))[0];
        await act(async () => {
            click(testRoot.window, closeButton);
        });

        assert.equal(getDialog(testRoot), null);
        assert.equal(testRoot.window.document.activeElement, trigger);
    } finally {
        await testRoot.cleanup();
    }
});
