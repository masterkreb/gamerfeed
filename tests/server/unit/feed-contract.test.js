import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FEED_ID_MAX_LENGTH,
    FEED_NAME_MAX_LENGTH,
    FEED_URL_MAX_LENGTH,
    parseFeedCreatePayload,
    parseFeedDeletePayload,
    parseFeedUpdatePayload,
} from '../../../server/feed-validation.js';

const VALID_CREATE = Object.freeze({
    name: 'GameStar',
    url: 'https://www.gamestar.de/feed.xml',
    language: 'de',
    priority: 'primary',
    needsScraping: false,
});

const VALID_UPDATE = Object.freeze({ ...VALID_CREATE, id: 'gamestar-1785240000000' });

// === Erstellen ===

test('erstellt einen Feed aus vollständigen Daten und normalisiert Leerraum', () => {
    const { value, error, field } = parseFeedCreatePayload({
        ...VALID_CREATE,
        name: '  GameStar  ',
        url: '  https://www.gamestar.de/feed.xml  ',
    });

    assert.equal(error, null);
    assert.equal(field, null);
    assert.deepEqual(value, VALID_CREATE);
});

test('ein weggelassenes needsScraping bedeutet false', () => {
    const { name, url, language, priority } = VALID_CREATE;
    const { value } = parseFeedCreatePayload({ name, url, language, priority });

    assert.equal(value.needsScraping, false);
});

test('needsScraping muss ein Boolean sein', () => {
    for (const needsScraping of ['true', 'false', 1, 0, {}, []]) {
        const { error, field } = parseFeedCreatePayload({ ...VALID_CREATE, needsScraping });
        assert.notEqual(error, null, JSON.stringify(needsScraping));
        assert.equal(field, 'needsScraping');
    }

    assert.equal(parseFeedCreatePayload({ ...VALID_CREATE, needsScraping: true }).value.needsScraping, true);
    assert.equal(parseFeedCreatePayload({ ...VALID_CREATE, needsScraping: false }).value.needsScraping, false);
});

test('ein ausdrückliches null bei needsScraping wird abgelehnt', () => {
    // Nur ein fehlendes Feld darf zum Default führen. Wer null schickt, meint
    // etwas damit; ein stiller Default würde diese Absicht überschreiben.
    for (const parse of [parseFeedCreatePayload, parseFeedUpdatePayload]) {
        const { value, error, field } = parse({ ...VALID_UPDATE, needsScraping: null });

        assert.equal(value, null);
        assert.notEqual(error, null);
        assert.equal(field, 'needsScraping');
    }
});

test('lehnt falsche Grundtypen in den Pflichtfeldern ab', () => {
    for (const [feld, wert] of [
        ['name', 42],
        ['name', true],
        ['name', { text: 'GameStar' }],
        ['url', 42],
        ['url', ['https://example.com/feed']],
        ['language', 42],
        ['priority', false],
    ]) {
        const { error, field } = parseFeedCreatePayload({ ...VALID_CREATE, [feld]: wert });
        assert.notEqual(error, null, `${feld}=${JSON.stringify(wert)}`);
        assert.equal(field, feld, `${feld}=${JSON.stringify(wert)}`);
    }
});

test('lehnt fehlende Pflichtfelder ab', () => {
    for (const feld of ['name', 'url', 'language', 'priority']) {
        const payload = { ...VALID_CREATE };
        delete payload[feld];

        const { error, field } = parseFeedCreatePayload(payload);
        assert.notEqual(error, null, feld);
        assert.equal(field, feld);
    }
});

test('setzt die Längengrenzen für Name und Adresse durch', () => {
    const nameGrenze = 'x'.repeat(FEED_NAME_MAX_LENGTH);
    assert.equal(parseFeedCreatePayload({ ...VALID_CREATE, name: nameGrenze }).error, null);
    assert.equal(parseFeedCreatePayload({ ...VALID_CREATE, name: `${nameGrenze}x` }).field, 'name');

    const rest = 'https://example.com/';
    const urlGrenze = rest + 'x'.repeat(FEED_URL_MAX_LENGTH - rest.length);
    assert.equal(urlGrenze.length, FEED_URL_MAX_LENGTH);
    assert.equal(parseFeedCreatePayload({ ...VALID_CREATE, url: urlGrenze }).error, null);
    assert.equal(parseFeedCreatePayload({ ...VALID_CREATE, url: `${urlGrenze}x` }).field, 'url');
});

test('nutzt weiterhin die bestehende URL-Policy statt einer eigenen Prüfung', () => {
    for (const url of [
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'file:///etc/passwd',
        'https://nutzer:geheim@example.com/feed',
        'http://127.0.0.1/feed',
        'kein-schema',
    ]) {
        const { error, field } = parseFeedCreatePayload({ ...VALID_CREATE, url });
        assert.notEqual(error, null, url);
        assert.equal(field, 'url', url);
        assert.match(error, /Die Feed-Adresse wurde abgelehnt/, url);
    }
});

test('lehnt unbekannte Enum-Werte ab', () => {
    assert.equal(parseFeedCreatePayload({ ...VALID_CREATE, language: 'fr' }).field, 'language');
    assert.equal(parseFeedCreatePayload({ ...VALID_CREATE, priority: 'wichtig' }).field, 'priority');
});

test('lehnt Nutzlasten ab, die kein Objekt sind', () => {
    for (const payload of [undefined, null, 'text', 42]) {
        assert.notEqual(parseFeedCreatePayload(payload).error, null, String(payload));
        assert.notEqual(parseFeedUpdatePayload(payload).error, null, String(payload));
        assert.notEqual(parseFeedDeletePayload(payload).error, null, String(payload));
    }
});

// === Aktualisieren ===

test('aktualisiert einen Feed und behält die ID', () => {
    const { value, error } = parseFeedUpdatePayload({ ...VALID_UPDATE, id: '  gamestar-1785240000000  ' });

    assert.equal(error, null);
    assert.deepEqual(value, VALID_UPDATE);
});

test('verlangt eine brauchbare Feed-ID', () => {
    for (const id of [undefined, null, '', '   ', 42, true, {}, ['a']]) {
        const { error, field } = parseFeedUpdatePayload({ ...VALID_UPDATE, id });
        assert.notEqual(error, null, JSON.stringify(id));
        assert.equal(field, 'id');
    }

    const grenze = 'x'.repeat(FEED_ID_MAX_LENGTH);
    assert.equal(parseFeedUpdatePayload({ ...VALID_UPDATE, id: grenze }).error, null);
    assert.equal(parseFeedUpdatePayload({ ...VALID_UPDATE, id: `${grenze}x` }).field, 'id');
});

test('prüft beim Aktualisieren zuerst die ID und danach die Felder', () => {
    const { field } = parseFeedUpdatePayload({ ...VALID_UPDATE, id: '', url: 'javascript:alert(1)' });

    assert.equal(field, 'id');
});

test('prüft beim Aktualisieren dieselben Felder wie beim Erstellen', () => {
    assert.equal(parseFeedUpdatePayload({ ...VALID_UPDATE, language: 'fr' }).field, 'language');
    assert.equal(parseFeedUpdatePayload({ ...VALID_UPDATE, url: 'http://10.0.0.5/feed' }).field, 'url');
    assert.equal(parseFeedUpdatePayload({ ...VALID_UPDATE, needsScraping: 'ja' }).field, 'needsScraping');
});

// === Löschen ===

test('löscht anhand einer geprüften ID', () => {
    const { value, error } = parseFeedDeletePayload({ id: '  gamestar-1785240000000  ' });

    assert.equal(error, null);
    assert.deepEqual(value, { id: 'gamestar-1785240000000' });
});

test('lehnt Löschanfragen ohne brauchbare ID ab', () => {
    for (const id of [undefined, null, '', '   ', 42, true, {}]) {
        const { error, field } = parseFeedDeletePayload({ id });
        assert.notEqual(error, null, JSON.stringify(id));
        assert.equal(field, 'id');
    }
});

test('das Löschen ignoriert mitgeschickte Zusatzfelder', () => {
    const { value } = parseFeedDeletePayload({ id: 'feed-1', name: 'egal', beliebig: true });

    assert.deepEqual(value, { id: 'feed-1' });
});
