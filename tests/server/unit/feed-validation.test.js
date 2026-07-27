import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFeedPayload } from '../../../server/feed-validation.js';

const VALID_PAYLOAD = Object.freeze({
    language: 'de',
    name: 'GamePro',
    priority: 'primary',
    url: 'https://www.gamepro.de/rss/gamepro.rss',
});

test('lässt vollständige und gültige Feed-Daten durch', () => {
    assert.deepEqual(validateFeedPayload(VALID_PAYLOAD), { error: null });
    assert.deepEqual(
        validateFeedPayload({ ...VALID_PAYLOAD, language: 'en', priority: 'secondary' }),
        { error: null },
    );
});

test('lehnt fehlende oder unbrauchbare Nutzlasten ab', () => {
    for (const payload of [undefined, null, 'text', 42]) {
        assert.notEqual(validateFeedPayload(payload).error, null);
    }
});

test('lehnt fehlende und überlange Namen ab', () => {
    assert.notEqual(validateFeedPayload({ ...VALID_PAYLOAD, name: '' }).error, null);
    assert.notEqual(validateFeedPayload({ ...VALID_PAYLOAD, name: '   ' }).error, null);
    assert.notEqual(validateFeedPayload({ ...VALID_PAYLOAD, name: undefined }).error, null);
    assert.notEqual(validateFeedPayload({ ...VALID_PAYLOAD, name: 'x'.repeat(121) }).error, null);
});

test('lehnt unzulässige Feed-Adressen mit verständlicher Begründung ab', () => {
    for (const url of [
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'file:///etc/passwd',
        'https://nutzer:geheim@example.com/feed',
        'kein-schema',
        '',
        undefined,
    ]) {
        const { error } = validateFeedPayload({ ...VALID_PAYLOAD, url });
        assert.notEqual(error, null, `${String(url)} wurde akzeptiert`);
        assert.match(error, /^Die Feed-Adresse wurde abgelehnt: /);
    }
});

test('lehnt unbekannte Sprachen und Prioritäten ab', () => {
    assert.notEqual(validateFeedPayload({ ...VALID_PAYLOAD, language: 'fr' }).error, null);
    assert.notEqual(validateFeedPayload({ ...VALID_PAYLOAD, language: undefined }).error, null);
    assert.notEqual(validateFeedPayload({ ...VALID_PAYLOAD, priority: 'wichtig' }).error, null);
    assert.notEqual(validateFeedPayload({ ...VALID_PAYLOAD, priority: undefined }).error, null);
});
