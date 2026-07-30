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

const FEEDS = Object.freeze([
    Object.freeze({
        id: 'feed-1',
        name: 'Alpha',
        url: 'https://alpha.example/feed.xml',
        language: 'de',
        priority: 'primary',
        needsScraping: false,
    }),
    Object.freeze({
        id: 'feed-2',
        name: 'Beta',
        url: 'https://beta.example/feed.xml',
        language: 'en',
        priority: 'secondary',
        needsScraping: false,
    }),
]);

function createDeferred() {
    let resolve;
    const promise = new Promise(resolvePromise => {
        resolve = resolvePromise;
    });

    return { promise, resolve };
}

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function emptyResponse(status = 204) {
    return new Response(null, { status });
}

function click(window, element) {
    element.dispatchEvent(new window.Event('click', {
        bubbles: true,
        cancelable: true,
    }));
}

function submit(window, form) {
    form.dispatchEvent(new window.Event('submit', {
        bubbles: true,
        cancelable: true,
    }));
}

// React verfolgt den Feldwert über einen eigenen Setter; ohne den nativen
// Setter bemerkt es die Änderung nicht und onChange bleibt aus.
function setFieldValue(window, element, value) {
    const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
    )?.set;

    if (setter) {
        setter.call(element, value);
    } else {
        element.value = value;
    }

    element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

// Das Admin-Panel protokolliert seinen Health-Abgleich ausführlich; die
// Fehlerpfade dieser Tests schreiben zusätzlich bewusst nach console.error.
function silenceConsole() {
    const original = { log: console.log, warn: console.warn, error: console.error };
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};

    return () => {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
    };
}

/**
 * Beantwortet alle Leseanfragen des Admin-Panels sofort, hält aber jede
 * Mutation offen, bis der Test sie ausdrücklich auflöst. Nur so lässt sich
 * prüfen, was während eines noch laufenden Requests passiert.
 */
function createAdminFetchMock() {
    const mutations = [];

    const fetcher = async (input, init = {}) => {
        const url = String(input);
        const method = (init.method ?? 'GET').toUpperCase();

        if (method === 'GET') {
            if (url.startsWith('/api/get-health-data')) {
                return jsonResponse({ healthStatus: {}, sourcesInCache: [], heartbeat: null });
            }
            if (url === '/api/feeds') {
                return jsonResponse(FEEDS);
            }
            // Der Ankündigungs-Reiter ist im Admin-Panel dauerhaft gemountet.
            if (url.startsWith('/api/announcement')) {
                return jsonResponse(null);
            }
            throw new Error(`Unerwartete Leseanfrage: ${url}`);
        }

        const deferred = createDeferred();
        mutations.push({
            url,
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

async function renderAdminPanel(fetcher) {
    const testRoot = await createReactTestRoot({ fetch: fetcher });
    await vite.ssrLoadModule('/i18n.ts');
    const { AdminPanel } = await vite.ssrLoadModule('/components/admin/AdminPanel.tsx');

    await testRoot.render(React.createElement(AdminPanel));
    return testRoot;
}

// Löst einen offenen Mutations-Request auf und lässt die gesamte
// Promise-Kette durchlaufen, bevor der Test weiterprüft.
async function resolveMutation(mutation, response) {
    await act(async () => {
        mutation.deferred.resolve(response);
        await new Promise(resolve => setImmediate(resolve));
    });
}

const getDeleteTrigger = (container, feedName) => container.querySelector(
    `button[aria-label="${feedName} löschen"]`,
);
const getEditTrigger = (container, feedName) => container.querySelector(
    `button[aria-label="${feedName} bearbeiten"]`,
);
const getAddButton = container => Array.from(container.querySelectorAll('button'))
    .find(button => button.textContent.includes('Neuen Feed hinzufügen'));
const getAlertDialog = container => container.querySelector('[role="alertdialog"]');
const getFormDialog = container => container.querySelector('[role="dialog"]');
const getConfirmButton = container => getAlertDialog(container).querySelectorAll('button')[1];

test('zwei synchrone Feed-Anlagen erzeugen genau einen POST', async () => {
    const restoreConsole = silenceConsole();
    const api = createAdminFetchMock();
    const testRoot = await renderAdminPanel(api.fetcher);

    try {
        const addButton = getAddButton(testRoot.container);
        await act(async () => {
            click(testRoot.window, addButton);
        });

        const dialog = getFormDialog(testRoot.container);
        assert.ok(dialog !== null, 'der Formulardialog ist offen');

        await act(async () => {
            setFieldValue(testRoot.window, dialog.querySelector('#feed-name'), 'Gamma');
        });
        await act(async () => {
            setFieldValue(
                testRoot.window,
                dialog.querySelector('#feed-url'),
                'https://gamma.example/feed.xml',
            );
        });

        // Beide Ereignisse laufen synchron im selben Batch: `isSaving` steht
        // dabei noch auf false, ein Guard allein daraus ließe beide durch.
        const form = dialog.querySelector('#feed-form');
        await act(async () => {
            submit(testRoot.window, form);
            submit(testRoot.window, form);
        });

        assert.equal(api.countOf('POST'), 1, 'zwei synchrone Submits erzeugten mehr als einen POST');

        // Solange der Request offen ist, entsteht keine zweite Anfrage.
        await act(async () => {
            submit(testRoot.window, form);
        });
        assert.equal(api.countOf('POST'), 1);

        await resolveMutation(api.firstOf('POST'), jsonResponse({
            id: 'feed-3',
            name: 'Gamma',
            url: 'https://gamma.example/feed.xml',
            language: 'en',
            priority: 'secondary',
            needsScraping: false,
        }));

        assert.ok(getFormDialog(testRoot.container) === null, 'der Dialog schließt nach Erfolg');

        // Nach Abschluss ist eine legitime spätere Aktion wieder möglich.
        await act(async () => {
            click(testRoot.window, addButton);
        });
        const secondDialog = getFormDialog(testRoot.container);
        await act(async () => {
            setFieldValue(testRoot.window, secondDialog.querySelector('#feed-name'), 'Delta');
        });
        await act(async () => {
            setFieldValue(
                testRoot.window,
                secondDialog.querySelector('#feed-url'),
                'https://delta.example/feed.xml',
            );
        });
        await act(async () => {
            submit(testRoot.window, secondDialog.querySelector('#feed-form'));
        });

        assert.equal(api.countOf('POST'), 2, 'nach der Freigabe geht genau eine neue Anfrage raus');
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('zwei synchrone Feed-Bearbeitungen erzeugen genau einen PUT und behalten bei Fehlern alle Eingaben', async () => {
    const restoreConsole = silenceConsole();
    const api = createAdminFetchMock();
    const testRoot = await renderAdminPanel(api.fetcher);

    try {
        await act(async () => {
            click(testRoot.window, getEditTrigger(testRoot.container, 'Alpha'));
        });

        const dialog = getFormDialog(testRoot.container);
        await act(async () => {
            setFieldValue(
                testRoot.window,
                dialog.querySelector('#feed-name'),
                'Alpha überarbeitet',
            );
        });

        const form = dialog.querySelector('#feed-form');
        await act(async () => {
            submit(testRoot.window, form);
            submit(testRoot.window, form);
        });

        assert.equal(api.countOf('PUT'), 1, 'zwei synchrone Submits erzeugten mehr als einen PUT');
        assert.equal(api.firstOf('PUT').body.name, 'Alpha überarbeitet');

        await resolveMutation(
            api.firstOf('PUT'),
            jsonResponse({ error: 'Interner Fehler', code: 'internal_error' }, 500),
        );

        // Der Fehler darf weder den Dialog noch die Eingaben verwerfen.
        const dialogAfterError = getFormDialog(testRoot.container);
        assert.ok(dialogAfterError !== null, 'der Dialog bleibt nach einem Fehler offen');
        assert.equal(dialogAfterError.querySelector('#feed-name').value, 'Alpha überarbeitet');
        assert.equal(
            dialogAfterError.querySelector('#feed-url').value,
            'https://alpha.example/feed.xml',
        );
        assert.match(
            dialogAfterError.textContent,
            /Die Feed-Quelle konnte nicht gespeichert werden/,
        );
        // Der interne Fehlertext bleibt im Log.
        assert.doesNotMatch(dialogAfterError.textContent, /Interner Fehler/);

        // Die Sperre wurde im finally freigegeben: ein erneuter Versuch geht raus.
        await act(async () => {
            submit(testRoot.window, dialogAfterError.querySelector('#feed-form'));
        });
        assert.equal(api.countOf('PUT'), 2, 'nach der Freigabe geht genau eine neue Anfrage raus');
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('zwei synchrone Löschbestätigungen erzeugen genau ein DELETE', async () => {
    const restoreConsole = silenceConsole();
    const api = createAdminFetchMock();
    const testRoot = await renderAdminPanel(api.fetcher);

    try {
        await act(async () => {
            click(testRoot.window, getDeleteTrigger(testRoot.container, 'Alpha'));
        });
        assert.ok(getAlertDialog(testRoot.container) !== null, 'der Bestätigungsdialog ist offen');

        const confirmButton = getConfirmButton(testRoot.container);
        await act(async () => {
            click(testRoot.window, confirmButton);
            click(testRoot.window, confirmButton);
        });

        assert.equal(api.countOf('DELETE'), 1, 'zwei synchrone Klicks erzeugten mehr als ein DELETE');

        // Solange der Request offen ist, entsteht keine zweite Anfrage.
        await act(async () => {
            click(testRoot.window, getConfirmButton(testRoot.container));
        });
        assert.equal(api.countOf('DELETE'), 1);

        await resolveMutation(api.firstOf('DELETE'), emptyResponse());

        assert.ok(getAlertDialog(testRoot.container) === null, 'der Dialog schließt nach Erfolg');
        assert.ok(
            getDeleteTrigger(testRoot.container, 'Alpha') === null,
            'der gelöschte Feed verschwindet aus der Liste',
        );

        // Nach Abschluss ist eine legitime spätere Löschung wieder möglich.
        await act(async () => {
            click(testRoot.window, getDeleteTrigger(testRoot.container, 'Beta'));
        });
        await act(async () => {
            click(testRoot.window, getConfirmButton(testRoot.container));
        });
        assert.equal(api.countOf('DELETE'), 2, 'nach der Freigabe geht genau eine neue Anfrage raus');
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('ein fehlgeschlagenes Feed-DELETE erhält Feed und Bestätigungsdialog', async () => {
    const restoreConsole = silenceConsole();
    const api = createAdminFetchMock();
    const testRoot = await renderAdminPanel(api.fetcher);

    try {
        await act(async () => {
            click(testRoot.window, getDeleteTrigger(testRoot.container, 'Alpha'));
        });
        await act(async () => {
            click(testRoot.window, getConfirmButton(testRoot.container));
        });
        await resolveMutation(
            api.firstOf('DELETE'),
            jsonResponse({ error: 'Interner Fehler', code: 'internal_error' }, 500),
        );

        const dialog = getAlertDialog(testRoot.container);
        assert.ok(dialog !== null, 'der Bestätigungsdialog bleibt offen');
        assert.ok(dialog.querySelector('[role="alert"]') !== null, 'der Fehler wird angekündigt');
        assert.ok(
            getDeleteTrigger(testRoot.container, 'Alpha') !== null,
            'der Feed bleibt erhalten',
        );
        assert.doesNotMatch(dialog.textContent, /Interner Fehler/);

        // Die Sperre wurde auch im Fehlerfall im finally freigegeben.
        await act(async () => {
            click(testRoot.window, getConfirmButton(testRoot.container));
        });
        assert.equal(api.countOf('DELETE'), 2, 'nach der Freigabe geht genau eine neue Anfrage raus');
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});

test('der Feed-Löschdialog fokussiert Abbrechen, hält den Fokus und gibt ihn zurück', async () => {
    const restoreConsole = silenceConsole();
    const api = createAdminFetchMock();
    const testRoot = await renderAdminPanel(api.fetcher);

    try {
        const trigger = getDeleteTrigger(testRoot.container, 'Alpha');
        trigger.focus();
        await act(async () => {
            click(testRoot.window, trigger);
        });

        const dialog = getAlertDialog(testRoot.container);
        const [cancelButton, confirmButton] = Array.from(dialog.querySelectorAll('button'));
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
        assert.ok(getAlertDialog(testRoot.container) === null, 'Escape schließt den Dialog');
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
            click(testRoot.window, getConfirmButton(testRoot.container));
        });
        const blockedEscape = dispatchKeyboardEvent(testRoot.window, 'Escape');
        assert.equal(blockedEscape.defaultPrevented, false);
        assert.ok(
            getAlertDialog(testRoot.container) !== null,
            'Escape schließt während der Löschung nicht',
        );

        // Nach erfolgreicher Löschung fehlt der Auslöser; der Fallback greift.
        await resolveMutation(api.firstOf('DELETE'), emptyResponse());
        assert.ok(
            testRoot.window.document.activeElement === getAddButton(testRoot.container),
            'ohne Auslöser greift der Fallback-Fokus',
        );
    } finally {
        await testRoot.cleanup();
        restoreConsole();
    }
});
