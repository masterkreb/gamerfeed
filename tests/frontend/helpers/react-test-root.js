import { act } from 'react';
import { parseHTML } from 'linkedom';

export async function createReactTestRoot(options = {}) {
    const { window } = parseHTML(
        '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: new URL('about:blank'),
    });

    let activeElement = window.document.body;
    Object.defineProperty(window.document, 'activeElement', {
        configurable: true,
        get: () => activeElement,
    });
    window.HTMLElement.prototype.focus = function focus() {
        activeElement = this;
    };
    window.HTMLElement.prototype.blur = function blur() {
        if (activeElement === this) {
            activeElement = window.document.body;
        }
    };

    const globalOverrides = {
        document: window.document,
        IS_REACT_ACT_ENVIRONMENT: true,
        navigator: window.navigator,
        window,
    };

    if (options.fetch) {
        globalOverrides.fetch = options.fetch;
    }

    const previousDescriptors = new Map();
    for (const [name, value] of Object.entries(globalOverrides)) {
        previousDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, {
            configurable: true,
            value,
            writable: true,
        });
    }

    // React ermittelt beim ersten Import von react-dom einmalig, ob native
    // input-Events unterstuetzt werden, ueber `'oninput' in document`. linkedom
    // definiert diese Eigenschaft nicht; ohne sie waehlt React einen
    // Polyfill-Pfad, der nur auf keydown/keyup reagiert, und onChange feuert bei
    // Textfeldern nie. Muss vor dem Import von react-dom gesetzt sein.
    if (!('oninput' in window.document)) {
        window.document.oninput = null;
    }

    const { createRoot } = await import('react-dom/client');
    const container = window.document.getElementById('root');
    const root = createRoot(container);

    return {
        container,
        window,
        async render(element) {
            await act(async () => {
                root.render(element);
            });
        },
        async cleanup() {
            await act(async () => {
                root.unmount();
            });

            for (const [name, descriptor] of previousDescriptors) {
                if (descriptor) {
                    Object.defineProperty(globalThis, name, descriptor);
                } else {
                    delete globalThis[name];
                }
            }
        },
    };
}

export function dispatchKeyboardEvent(window, key, options = {}) {
    const event = new window.Event('keydown', {
        bubbles: true,
        cancelable: true,
    });
    Object.defineProperties(event, {
        key: {
            value: key,
        },
        shiftKey: {
            value: options.shiftKey ?? false,
        },
    });
    window.document.dispatchEvent(event);
    return event;
}
