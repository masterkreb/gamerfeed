import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useRef, useState } from 'react';
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

const { useDialogFocus } = await vite.ssrLoadModule('/hooks/useDialogFocus.ts');

test.after(async () => {
    await vite.close();
});

test('hält den Fokus im Dialog, schließt mit Escape und stellt den Fokus wieder her', async () => {
    const testRoot = await createReactTestRoot();
    let setIsOpen;
    let setIsBusy;
    let setIsTriggerVisible;

    function Harness() {
        const [isOpen, updateIsOpen] = useState(false);
        const [isBusy, updateIsBusy] = useState(false);
        const [isTriggerVisible, updateIsTriggerVisible] = useState(true);
        const firstButtonRef = useRef(null);
        const fallbackButtonRef = useRef(null);
        const dialogRef = useDialogFocus({
            isOpen,
            onClose: () => updateIsOpen(false),
            canClose: !isBusy,
            initialFocusRef: firstButtonRef,
            fallbackFocusRef: fallbackButtonRef,
        });

        setIsOpen = updateIsOpen;
        setIsBusy = updateIsBusy;
        setIsTriggerVisible = updateIsTriggerVisible;

        return React.createElement(
            React.Fragment,
            null,
            React.createElement('button', { id: 'fallback', ref: fallbackButtonRef }, 'Neu'),
            isTriggerVisible && React.createElement('button', { id: 'trigger' }, 'Öffnen'),
            isOpen && React.createElement(
                'div',
                {
                    id: 'dialog',
                    ref: dialogRef,
                    role: 'dialog',
                    tabIndex: -1,
                },
                React.createElement(
                    'button',
                    { id: 'first', ref: firstButtonRef },
                    'Erste Aktion',
                ),
                React.createElement('button', { id: 'last' }, 'Letzte Aktion'),
            ),
        );
    }

    try {
        await testRoot.render(React.createElement(Harness));
        const trigger = testRoot.container.querySelector('#trigger');
        trigger.focus();

        await act(async () => {
            setIsOpen(true);
        });

        const firstButton = testRoot.container.querySelector('#first');
        const lastButton = testRoot.container.querySelector('#last');
        assert.equal(testRoot.window.document.activeElement, firstButton);

        lastButton.focus();
        const forwardTab = dispatchKeyboardEvent(testRoot.window, 'Tab');
        assert.equal(forwardTab.defaultPrevented, true);
        assert.equal(testRoot.window.document.activeElement, firstButton);

        firstButton.focus();
        const backwardTab = dispatchKeyboardEvent(
            testRoot.window,
            'Tab',
            { shiftKey: true },
        );
        assert.equal(backwardTab.defaultPrevented, true);
        assert.equal(testRoot.window.document.activeElement, lastButton);

        await act(async () => {
            setIsBusy(true);
        });
        const blockedEscape = dispatchKeyboardEvent(testRoot.window, 'Escape');
        assert.equal(blockedEscape.defaultPrevented, false);
        assert.ok(testRoot.container.querySelector('#dialog'));

        await act(async () => {
            setIsBusy(false);
        });
        await act(async () => {
            dispatchKeyboardEvent(testRoot.window, 'Escape');
        });

        assert.equal(testRoot.container.querySelector('#dialog'), null);
        assert.equal(testRoot.window.document.activeElement, trigger);

        await act(async () => {
            setIsOpen(true);
        });
        await act(async () => {
            setIsTriggerVisible(false);
        });
        await act(async () => {
            dispatchKeyboardEvent(testRoot.window, 'Escape');
        });

        assert.equal(
            testRoot.window.document.activeElement,
            testRoot.container.querySelector('#fallback'),
        );
    } finally {
        await testRoot.cleanup();
    }
});
