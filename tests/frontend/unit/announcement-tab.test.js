import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
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

const INACTIVE_ANNOUNCEMENT = Object.freeze({
    id: 'announcement-1785239000000',
    message: 'Abgeschaltete Wartungsmeldung.',
    type: 'maintenance',
    isActive: false,
    createdAt: '2026-07-28T11:43:20.000Z',
});

const ACTIVE_ANNOUNCEMENT = Object.freeze({
    id: 'announcement-1785240000000',
    message: 'Wartungsfenster am Wochenende.',
    type: 'warning',
    isActive: true,
    createdAt: '2026-07-28T12:00:00.000Z',
});

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function createDeferred() {
    let resolve;
    const promise = new Promise(resolvePromise => {
        resolve = resolvePromise;
    });

    return { promise, resolve };
}

function click(window, element) {
    element.dispatchEvent(new window.Event('click', {
        bubbles: true,
        cancelable: true,
    }));
}

function silenceConsole() {
    const original = { error: console.error, warn: console.warn };
    console.error = () => {};
    console.warn = () => {};

    return () => {
        console.error = original.error;
        console.warn = original.warn;
    };
}

async function renderTab(fetcher) {
    const testRoot = await createReactTestRoot({ fetch: fetcher });
    await vite.ssrLoadModule('/i18n.ts');
    const { AnnouncementTab } = await vite.ssrLoadModule('/components/admin/AnnouncementTab.tsx');

    await testRoot.render(React.createElement(AnnouncementTab));
    return testRoot;
}

/**
 * Beantwortet den Admin-Abruf sofort, hält aber jede Mutation offen, bis der
 * Test sie ausdrücklich auflöst.
 */
function createAnnouncementFetchMock(initial) {
    const mutations = [];

    const fetcher = async (input, init = {}) => {
        const method = (init.method ?? 'GET').toUpperCase();

        if (method === 'GET') {
            return jsonResponse(initial);
        }

        const deferred = createDeferred();
        mutations.push({
            method,
            body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
            deferred,
        });
        return deferred.promise;
    };

    return {
        fetcher,
        mutations,
        countOf(method) {
            return mutations.filter(mutation => mutation.method === method).length;
        },
        firstOf(method) {
            return mutations.find(mutation => mutation.method === method);
        },
    };
}

async function resolveMutation(mutation, response) {
    await act(async () => {
        mutation.deferred.resolve(response);
        await new Promise(resolve => setImmediate(resolve));
    });
}

const getDialog = container => container.querySelector('[role="alertdialog"]');
const getButtons = root => Array.from(root.querySelectorAll('button'));
const getSaveButton = container => getButtons(container)
    .find(button => /Ankündigung speichern|Speichere\.\.\./.test(button.textContent));
const getDeleteTrigger = container => getButtons(container)
    .find(button => !button.closest('[role="alertdialog"]') && button.textContent === 'Löschen');
const getDialogButtons = container => getButtons(getDialog(container));

test('lädt die Ankündigung über den geschützten Admin-Abruf', async () => {
    const requests = [];
    const testRoot = await renderTab(async input => {
        requests.push(String(input));
        return jsonResponse(INACTIVE_ANNOUNCEMENT);
    });

    try {
        // Der öffentliche Endpunkt würde eine inaktive Ankündigung als null
        // ausliefern; der Admin käme dann nicht mehr an sie heran.
        assert.deepEqual(requests, ['/api/announcement?admin=1']);
    } finally {
        await testRoot.cleanup();
    }
});

test('eine inaktive Ankündigung ist im Admin vollständig sichtbar', async () => {
    const testRoot = await renderTab(async () => jsonResponse(INACTIVE_ANNOUNCEMENT));

    try {
        // Die Vorschau rendert den geladenen Text; sie ist der sichtbare Beleg
        // dafür, dass die Nachricht im Formularzustand angekommen ist.
        // (linkedom spiegelt den value-Zustand eines React-Textfelds nicht.)
        assert.match(testRoot.container.textContent, /Abgeschaltete Wartungsmeldung\./);
        assert.match(testRoot.container.textContent, /Inaktiv/);

        const aktivSchalter = testRoot.container.querySelector('input[type="checkbox"]');
        assert.equal(aktivSchalter.checked, false, 'der Aktiv-Schalter spiegelt den Zustand');
    } finally {
        await testRoot.cleanup();
    }
});

test('ohne gespeicherte Ankündigung bleibt das Formular leer und aktiv', async () => {
    const testRoot = await renderTab(async () => jsonResponse(null));

    try {
        assert.doesNotMatch(testRoot.container.textContent, /Inaktiv/);
        assert.equal(testRoot.container.querySelector('input[type="checkbox"]').checked, true);
    } finally {
        await testRoot.cleanup();
    }
});

test('ein Fehler beim Laden blockiert das Formular nicht', async () => {
    const testRoot = await renderTab(async () => jsonResponse({ error: 'nope', code: 'unauthorized' }, 401));

    try {
        assert.ok(testRoot.container.querySelector('textarea'), 'das Formular wird trotzdem angezeigt');
    } finally {
        await testRoot.cleanup();
    }
});

test('zwei synchrone Speicherklicks erzeugen genau einen POST', async () => {
    const restoreConsole = silenceConsole();
    const api = createAnnouncementFetchMock(ACTIVE_ANNOUNCEMENT);
    const testRoot = await renderTab(api.fetcher);

    try {
        const saveButton = getSaveButton(testRoot.container);

        // Beide Ereignisse laufen synchron im selben Batch: `isSaving` steht
        // dabei noch auf false, ein Guard allein daraus ließe beide durch.
        await act(async () => {
            click(testRoot.window, saveButton);
            click(testRoot.window, saveButton);
        });

        assert.equal(api.countOf('POST'), 1, 'zwei synchrone Klicks erzeugten mehr als einen POST');

        // Solange der Request offen ist, entsteht keine zweite Anfrage.
        await act(async () => {
            click(testRoot.window, getSaveButton(testRoot.container));
        });
        assert.equal(api.countOf('POST'), 1);

        await resolveMutation(api.firstOf('POST'), jsonResponse(ACTIVE_ANNOUNCEMENT));

        // Nach Abschluss ist eine legitime spätere Aktion wieder möglich.
        await act(async () => {
            click(testRoot.window, getSaveButton(testRoot.container));
        });
        assert.equal(api.countOf('POST'), 2, 'nach der Freigabe geht genau eine neue Anfrage raus');
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('ein fehlgeschlagenes Speichern erhält Nachricht, Typ und Aktiv-Status', async () => {
    const restoreConsole = silenceConsole();
    const api = createAnnouncementFetchMock(INACTIVE_ANNOUNCEMENT);
    const testRoot = await renderTab(api.fetcher);

    try {
        await act(async () => {
            click(testRoot.window, getSaveButton(testRoot.container));
        });
        await resolveMutation(
            api.firstOf('POST'),
            jsonResponse({ error: 'Interner Fehler', code: 'internal_error' }, 500),
        );

        assert.match(testRoot.container.textContent, /Fehler beim Speichern der Ankündigung/);
        // Der interne Fehlertext bleibt im Log.
        assert.doesNotMatch(testRoot.container.textContent, /Interner Fehler/);
        // Vorschau und Schalter belegen den erhaltenen Formularzustand.
        assert.match(testRoot.container.textContent, /Abgeschaltete Wartungsmeldung\./);
        assert.equal(testRoot.container.querySelector('input[type="checkbox"]').checked, false);
        assert.deepEqual(api.firstOf('POST').body, {
            message: 'Abgeschaltete Wartungsmeldung.',
            type: 'maintenance',
            isActive: false,
        });

        // Die Sperre wurde auch im Fehlerfall im finally freigegeben.
        await act(async () => {
            click(testRoot.window, getSaveButton(testRoot.container));
        });
        assert.equal(api.countOf('POST'), 2, 'nach der Freigabe geht genau eine neue Anfrage raus');
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('das Löschen einer Ankündigung sendet erst nach der Bestätigung genau ein DELETE', async () => {
    const restoreConsole = silenceConsole();
    const api = createAnnouncementFetchMock(ACTIVE_ANNOUNCEMENT);
    const testRoot = await renderTab(api.fetcher);

    try {
        await act(async () => {
            click(testRoot.window, getDeleteTrigger(testRoot.container));
        });

        assert.ok(getDialog(testRoot.container) !== null, 'der Bestätigungsdialog ist offen');
        assert.equal(api.countOf('DELETE'), 0, 'vor der Bestätigung wird nichts gelöscht');

        const confirmButton = getDialogButtons(testRoot.container)[1];
        await act(async () => {
            click(testRoot.window, confirmButton);
            click(testRoot.window, confirmButton);
        });
        assert.equal(api.countOf('DELETE'), 1, 'zwei synchrone Klicks erzeugten mehr als ein DELETE');

        // Solange der Request offen ist, entsteht keine zweite Anfrage.
        await act(async () => {
            click(testRoot.window, getDialogButtons(testRoot.container)[1]);
        });
        assert.equal(api.countOf('DELETE'), 1);

        await resolveMutation(api.firstOf('DELETE'), new Response(null, { status: 204 }));

        assert.ok(getDialog(testRoot.container) === null, 'der Dialog schließt nach Erfolg');
        assert.ok(
            getDeleteTrigger(testRoot.container) === undefined,
            'ohne Ankündigung gibt es keinen Löschknopf mehr',
        );
        assert.match(testRoot.container.textContent, /Ankündigung gelöscht!/);
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('ein fehlgeschlagenes Löschen erhält Ankündigung und Bestätigungsdialog', async () => {
    const restoreConsole = silenceConsole();
    const api = createAnnouncementFetchMock(ACTIVE_ANNOUNCEMENT);
    const testRoot = await renderTab(api.fetcher);

    try {
        await act(async () => {
            click(testRoot.window, getDeleteTrigger(testRoot.container));
        });
        await act(async () => {
            click(testRoot.window, getDialogButtons(testRoot.container)[1]);
        });
        await resolveMutation(
            api.firstOf('DELETE'),
            jsonResponse({ error: 'Interner Fehler', code: 'internal_error' }, 500),
        );

        const dialog = getDialog(testRoot.container);
        assert.ok(dialog !== null, 'der Bestätigungsdialog bleibt offen');
        assert.ok(dialog.querySelector('[role="alert"]') !== null, 'der Fehler wird angekündigt');
        assert.match(dialog.textContent, /Fehler beim Löschen der Ankündigung/);
        assert.doesNotMatch(dialog.textContent, /Interner Fehler/);
        assert.match(testRoot.container.textContent, /Wartungsfenster am Wochenende\./);
        assert.match(testRoot.container.textContent, /Aktueller Status/);

        // Die Sperre wurde auch im Fehlerfall im finally freigegeben.
        await act(async () => {
            click(testRoot.window, getDialogButtons(testRoot.container)[1]);
        });
        assert.equal(api.countOf('DELETE'), 2, 'nach der Freigabe geht genau eine neue Anfrage raus');
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('Speichern und Löschen teilen sich denselben Mutationsschutz', async () => {
    const restoreConsole = silenceConsole();
    const api = createAnnouncementFetchMock(ACTIVE_ANNOUNCEMENT);
    const testRoot = await renderTab(api.fetcher);

    try {
        await act(async () => {
            click(testRoot.window, getDeleteTrigger(testRoot.container));
        });

        const saveButton = getSaveButton(testRoot.container);
        const confirmButton = getDialogButtons(testRoot.container)[1];

        // Ohne gemeinsamen Latch startete hier synchron ein POST und ein DELETE.
        await act(async () => {
            click(testRoot.window, saveButton);
            click(testRoot.window, confirmButton);
        });

        assert.equal(api.mutations.length, 1, 'POST und DELETE liefen gleichzeitig');
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('der Löschdialog fokussiert Abbrechen, hält den Fokus und gibt ihn zurück', async () => {
    const restoreConsole = silenceConsole();
    const api = createAnnouncementFetchMock(ACTIVE_ANNOUNCEMENT);
    const testRoot = await renderTab(api.fetcher);

    try {
        const trigger = getDeleteTrigger(testRoot.container);
        trigger.focus();
        await act(async () => {
            click(testRoot.window, trigger);
        });

        const [cancelButton, confirmButton] = getDialogButtons(testRoot.container);
        assert.ok(
            testRoot.window.document.activeElement === cancelButton,
            'Abbrechen erhält den initialen Fokus',
        );

        confirmButton.focus();
        const forwardTab = dispatchKeyboardEvent(testRoot.window, 'Tab');
        assert.equal(forwardTab.defaultPrevented, true);
        assert.ok(
            testRoot.window.document.activeElement === cancelButton,
            'Tab läuft im Dialog um',
        );

        const backwardTab = dispatchKeyboardEvent(testRoot.window, 'Tab', { shiftKey: true });
        assert.equal(backwardTab.defaultPrevented, true);
        assert.ok(
            testRoot.window.document.activeElement === confirmButton,
            'Shift+Tab läuft im Dialog um',
        );

        // Escape vor Beginn der Mutation schließt und gibt den Fokus zurück.
        await act(async () => {
            dispatchKeyboardEvent(testRoot.window, 'Escape');
        });
        assert.ok(getDialog(testRoot.container) === null, 'Escape schließt den Dialog');
        assert.equal(api.countOf('DELETE'), 0, 'ohne Bestätigung wird nichts gelöscht');
        assert.ok(
            testRoot.window.document.activeElement === trigger,
            'der Fokus kehrt zum Auslöser zurück',
        );

        // Während einer laufenden Löschung bleibt der Dialog offen.
        await act(async () => {
            click(testRoot.window, trigger);
        });
        await act(async () => {
            click(testRoot.window, getDialogButtons(testRoot.container)[1]);
        });
        const blockedEscape = dispatchKeyboardEvent(testRoot.window, 'Escape');
        assert.equal(blockedEscape.defaultPrevented, false);
        assert.ok(
            getDialog(testRoot.container) !== null,
            'Escape schließt während der Löschung nicht',
        );

        // Nach erfolgreicher Löschung fehlt der Auslöser; der Fallback greift.
        await resolveMutation(api.firstOf('DELETE'), new Response(null, { status: 204 }));
        assert.ok(
            testRoot.window.document.activeElement === getSaveButton(testRoot.container),
            'ohne Auslöser greift der Fallback-Fokus',
        );
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});
