import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ANNOUNCEMENT_MESSAGE_MAX_LENGTH,
    ANNOUNCEMENT_TYPES,
    parseAnnouncementPayload,
} from '../../../shared/announcement-contract.js';

const VALID = Object.freeze({
    message: 'Wartungsarbeiten am Sonntag.',
    type: 'maintenance',
    isActive: true,
});

test('die Typenliste bleibt deckungsgleich mit AnnouncementType in types.ts', () => {
    assert.deepEqual([...ANNOUNCEMENT_TYPES], ['info', 'warning', 'maintenance', 'celebration']);
});

test('lässt eine vollständige Ankündigung durch und normalisiert die Nachricht', () => {
    const { value, error, field } = parseAnnouncementPayload({
        ...VALID,
        message: '   Wartungsarbeiten am Sonntag.   ',
    });

    assert.equal(error, null);
    assert.equal(field, null);
    assert.deepEqual(value, VALID);
});

test('akzeptiert jeden dokumentierten Typ', () => {
    for (const type of ANNOUNCEMENT_TYPES) {
        assert.equal(parseAnnouncementPayload({ ...VALID, type }).error, null, type);
    }
});

test('ohne isActive gilt die Ankündigung als aktiv', () => {
    const { value } = parseAnnouncementPayload({ message: 'Hinweis', type: 'info' });

    assert.equal(value.isActive, true);
});

test('ein ausdrückliches null bei isActive wird abgelehnt', () => {
    // Nur ein fehlendes Feld darf zum Default führen. Ein stiller Default würde
    // aus null ein "aktiv" machen und die Ankündigung veröffentlichen.
    const { value, error, field } = parseAnnouncementPayload({
        message: 'Hinweis',
        type: 'info',
        isActive: null,
    });

    assert.equal(value, null);
    assert.notEqual(error, null);
    assert.equal(field, 'isActive');
});

test('isActive false bleibt erhalten', () => {
    const { value } = parseAnnouncementPayload({ ...VALID, isActive: false });

    assert.equal(value.isActive, false);
});

test('lehnt Nutzlasten ab, die kein Objekt sind', () => {
    for (const payload of [undefined, null, 'text', 42, true, ['info']]) {
        const { error, value } = parseAnnouncementPayload(payload);
        assert.notEqual(error, null, String(payload));
        assert.equal(value, null);
    }
});

test('lehnt fehlende, leere und falsch typisierte Nachrichten ab', () => {
    for (const message of [undefined, null, '', '   ', 42, true, {}, ['Hallo']]) {
        const { error, field } = parseAnnouncementPayload({ ...VALID, message });
        assert.notEqual(error, null, JSON.stringify(message));
        assert.equal(field, 'message');
    }
});

test('lehnt zu lange Nachrichten ab und lässt die Grenze selbst zu', () => {
    const grenze = 'x'.repeat(ANNOUNCEMENT_MESSAGE_MAX_LENGTH);
    assert.equal(parseAnnouncementPayload({ ...VALID, message: grenze }).error, null);

    const zuLang = parseAnnouncementPayload({ ...VALID, message: `${grenze}x` });
    assert.notEqual(zuLang.error, null);
    assert.equal(zuLang.field, 'message');
});

test('lehnt unbekannte Typen ab', () => {
    for (const type of [undefined, null, '', 'kritisch', 42, true, ['info']]) {
        const { error, field } = parseAnnouncementPayload({ ...VALID, type });
        assert.notEqual(error, null, JSON.stringify(type));
        assert.equal(field, 'type');
    }
});

test('lehnt isActive-Werte ab, die kein Boolean sind', () => {
    for (const isActive of ['false', 'true', 0, 1, {}, [], null]) {
        const { error, field } = parseAnnouncementPayload({ ...VALID, isActive });
        assert.notEqual(error, null, JSON.stringify(isActive));
        assert.equal(field, 'isActive');
    }
});

test('übernimmt weder id noch createdAt aus dem Eingang', () => {
    const { value } = parseAnnouncementPayload({
        ...VALID,
        id: 'untergeschoben',
        createdAt: '1999-01-01T00:00:00.000Z',
        unbekannt: 'wird ignoriert',
    });

    assert.deepEqual(Object.keys(value).sort(), ['isActive', 'message', 'type']);
});
