import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsLifecycle } from '../../../shared/analytics-lifecycle.js';

const MEASUREMENT_ID = 'G-TEST123';

function createEnvironment({ cookie = '', hostname = 'gamerfeed.example' } = {}) {
    const appendedScripts = [];
    let cookieJar = cookie;
    const cookieWrites = [];

    const doc = {
        head: {
            appendChild(script) {
                appendedScripts.push(script);
            },
        },
        createElement: () => ({ dataset: {} }),
        get cookie() {
            return cookieJar;
        },
        set cookie(value) {
            cookieWrites.push(value);
            // Sehr grobe Nachbildung: ein Ablaufdatum in der Vergangenheit
            // entfernt den Eintrag.
            const [pair] = value.split(';');
            const [name] = pair.split('=');
            if (/expires=Thu, 01 Jan 1970/.test(value)) {
                cookieJar = cookieJar
                    .split(';')
                    .map(entry => entry.trim())
                    .filter(entry => entry && entry.split('=')[0] !== name.trim())
                    .join('; ');
            }
        },
    };

    const win = { location: { hostname } };

    return { appendedScripts, cookieWrites, doc, get cookie() { return cookieJar; }, win };
}

function consentCalls(win) {
    return (win.dataLayer ?? []).filter(entry => entry[0] === 'consent');
}

test('lädt vor der Zustimmung nichts', () => {
    const env = createEnvironment();
    const analytics = createAnalyticsLifecycle({ measurementId: MEASUREMENT_ID, ...env });

    assert.equal(analytics.isScriptLoaded(), false);
    assert.equal(env.appendedScripts.length, 0);
    assert.equal(env.win.dataLayer, undefined);
});

test('initialisiert bei Zustimmung genau einmal', () => {
    const env = createEnvironment();
    const analytics = createAnalyticsLifecycle({ measurementId: MEASUREMENT_ID, ...env });

    analytics.grant();
    analytics.grant();
    analytics.grant();

    assert.equal(env.appendedScripts.length, 1, 'Skript wurde mehrfach geladen');
    assert.match(env.appendedScripts[0].src, new RegExp(`id=${MEASUREMENT_ID}$`));
    assert.equal(env.appendedScripts[0].async, true);

    // Der Standard ist denied, erst danach folgt die Zustimmung.
    const consents = consentCalls(env.win);
    assert.deepEqual(consents[0], ['consent', 'default', { analytics_storage: 'denied' }]);
    assert.deepEqual(consents[1], ['consent', 'update', { analytics_storage: 'granted' }]);
    assert.equal(consents.filter(entry => entry[1] === 'default').length, 1);
});

test('wendet den Widerruf als denied an und entfernt die Analytics-Cookies', () => {
    const env = createEnvironment({ cookie: '_ga=GA1.1.5; _gid=GA1.2.7; theme=dark' });
    const analytics = createAnalyticsLifecycle({ measurementId: MEASUREMENT_ID, ...env });

    analytics.grant();
    analytics.deny();

    const consents = consentCalls(env.win);
    assert.deepEqual(consents[consents.length - 1], ['consent', 'update', { analytics_storage: 'denied' }]);

    // Fremde Cookies bleiben unangetastet.
    assert.match(env.cookie, /theme=dark/);
    assert.doesNotMatch(env.cookie, /_ga=/);
    assert.doesNotMatch(env.cookie, /_gid=/);

    // Auch die übergeordnete Domain wird abgeräumt.
    assert.ok(env.cookieWrites.some(write => write.includes('domain=.gamerfeed.example')));
});

test('erlaubt erneute Zustimmung ohne zweites Skript', () => {
    const env = createEnvironment({ cookie: '_ga=GA1.1.5' });
    const analytics = createAnalyticsLifecycle({ measurementId: MEASUREMENT_ID, ...env });

    analytics.grant();
    analytics.deny();
    analytics.grant();

    assert.equal(env.appendedScripts.length, 1, 'ein zweites Skript wurde geladen');

    const updates = consentCalls(env.win).filter(entry => entry[1] === 'update');
    assert.deepEqual(updates.map(entry => entry[2].analytics_storage), ['granted', 'denied', 'granted']);
});

test('ein Widerruf ohne vorherige Zustimmung lädt nichts nach', () => {
    const env = createEnvironment({ cookie: '_ga=GA1.1.5' });
    const analytics = createAnalyticsLifecycle({ measurementId: MEASUREMENT_ID, ...env });

    analytics.deny();

    assert.equal(analytics.isScriptLoaded(), false);
    assert.equal(env.appendedScripts.length, 0);
    // Vorhandene Cookies werden trotzdem entfernt.
    assert.doesNotMatch(env.cookie, /_ga=/);
});
