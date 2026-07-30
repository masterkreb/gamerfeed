import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// SEO1: Dieselbe Ehrlichkeitsregel wie fuer die Metadaten gilt auch fuer die
// sichtbaren Produkttexte. Sie duerfen weder eine feste Quellenzahl noch
// Vollstaendigkeit noch eine garantierte Aktualisierungsfrequenz behaupten.
//
// Der Cron-Workflow ist auf 7,27,47 geplant, GitHub stellt geplante Laeufe aber
// global in eine Warteschlange. "Alle 20 Minuten" ist deshalb ein Plan, keine
// Zusage - und "Echtzeit" war nie zutreffend.

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

const { default: i18n } = await vite.ssrLoadModule('/i18n.ts');

const LANGUAGES = ['de', 'en'];

/** Texte, die der Nutzer im Reiter "Ueber uns" tatsaechlich liest. */
const ABOUT_KEYS = [
    'settings.about.description',
    'settings.about.sources',
    'settings.about.features.realtime',
];

function claim(language, key) {
    const bundle = i18n.getResourceBundle(language, 'translation');
    const value = bundle?.[key];
    assert.equal(
        typeof value,
        'string',
        `${key} fehlt in ${language}`,
    );
    return value;
}

test('die Ueber-uns-Texte nennen keine feste Quellenzahl', () => {
    for (const language of LANGUAGES) {
        for (const key of ABOUT_KEYS) {
            const text = claim(language, key);
            const match = text.match(
                /\d+\s*\+?\s*(?:\p{L}+[\s,]+){0,4}(?:quellen|sources)/iu,
            );
            assert.equal(
                match,
                null,
                `${language}/${key} verdrahtet eine Quellenzahl: ${match?.[0]}`,
            );
        }
    }
});

test('die Ueber-uns-Texte behaupten keine Vollstaendigkeit', () => {
    for (const language of LANGUAGES) {
        for (const key of ABOUT_KEYS) {
            const text = claim(language, key);
            const match = text.match(
                /\b(?:alle[nmr]?|jede[nmrs]?|s(?:ä|ae)mtliche[nmrs]?|all|every)\s+(?:[\p{L}-]+\s+){0,3}(?:[\p{L}]+-)?(?:quellen|redaktionen|sources)\b/iu,
            );
            assert.equal(
                match,
                null,
                `${language}/${key} verspricht Vollstaendigkeit: ${match?.[0]}`,
            );
        }
    }
});

test('die Aktualisierung wird als Plan beschrieben, nicht als Echtzeit-Zusage', () => {
    for (const language of LANGUAGES) {
        const text = claim(language, 'settings.about.features.realtime');

        assert.ok(
            !/echtzeit|real[-\s]?time|live[-\s]?updates?/i.test(text),
            `${language}: "${text}" behauptet Echtzeit`,
        );

        // Wer den Takt nennt, muss ihn auch als geplant kennzeichnen.
        if (/\d+\s*(?:min|minuten|minutes)/i.test(text)) {
            assert.match(
                text,
                /geplant|ungef(?:ä|ae)hr|etwa|ca\.|circa|planned|roughly|approximately|about|typically/i,
                `${language}: "${text}" nennt einen Takt ohne Einschraenkung`,
            );
        }
    }
});
