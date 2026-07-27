import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createServer } from 'vite';
import {
    createReactTestRoot,
    dispatchKeyboardEvent,
} from '../helpers/react-test-root.js';

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

function click(window, element) {
    element.dispatchEvent(new window.Event('click', {
        bubbles: true,
        cancelable: true,
    }));
}

async function renderSettingsModal(testRoot) {
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

// Spiegelt die Auswahl aus useDialogFocus, um dieselbe Reihenfolge zu pruefen.
function getFocusable(dialog) {
    return Array.from(dialog.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ));
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
