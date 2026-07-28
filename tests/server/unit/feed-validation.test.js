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
    // Seit S2 nennt das Ergebnis zusätzlich das betroffene Feld; bei Erfolg ist
    // es null.
    assert.deepEqual(validateFeedPayload(VALID_PAYLOAD), { error: null, field: null });
    assert.deepEqual(
        validateFeedPayload({ ...VALID_PAYLOAD, language: 'en', priority: 'secondary' }),
        { error: null, field: null },
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

test('lehnt ohne DNS erkennbare lokale und private Ziele beim Speichern ab', () => {
    for (const url of [
        'http://127.0.0.1/feed',
        'http://127.0.0.1:8080/feed',
        'http://localhost/feed',
        'http://intern.localhost/feed',
        'http://[::1]/feed',
        'http://169.254.169.254/latest/meta-data/',
        'http://10.0.0.5/feed',
        'http://192.168.1.1/feed',
        'http://172.16.0.1/feed',
        'http://172.31.255.255/feed',
        'http://2130706433/feed',
        'http://0177.0.0.1/feed',
        'http://[::ffff:127.0.0.1]/feed',
        'http://[fd00::1]/feed',
        'http://[fe80::1]/feed',
    ]) {
        const { error } = validateFeedPayload({ ...VALID_PAYLOAD, url });
        assert.notEqual(error, null, `${url} wurde akzeptiert`);
        assert.match(error, /lokales oder privates Ziel/);
    }
});

test('lehnt auch die vom Cron blockierten Sonderbereiche ab', () => {
    // Diese Adressen wurden früher beim Speichern akzeptiert, obwohl der Cron
    // sie garantiert ablehnt.
    for (const url of [
        'http://100.64.0.1/feed',
        'http://192.0.2.1/feed',
        'http://192.0.0.1/feed',
        'http://192.88.99.1/feed',
        'http://198.18.0.1/feed',
        'http://198.51.100.1/feed',
        'http://203.0.113.1/feed',
        'http://224.0.0.1/feed',
        'http://240.0.0.1/feed',
        'http://255.255.255.255/feed',
        'http://0.0.0.1/feed',
        'http://[2001:db8::1]/feed',
        'http://[ff00::1]/feed',
        'http://[64:ff9b::7f00:1]/feed',
        'http://[2002::1]/feed',
        'http://[100::1]/feed',
    ]) {
        const { error } = validateFeedPayload({ ...VALID_PAYLOAD, url });
        assert.notEqual(error, null, `${url} wurde akzeptiert`);
    }
});

test('lässt die Adressen direkt neben den gesperrten Bereichen zu', () => {
    // Grenztests: eine Adresse zu früh oder zu spät darf nicht mitgesperrt werden.
    for (const url of [
        'https://11.0.0.0/feed',
        'https://100.128.0.1/feed',
        'https://128.0.0.1/feed',
        'https://169.255.0.1/feed',
        'https://172.32.0.1/feed',
        'https://192.0.1.1/feed',
        'https://192.0.3.1/feed',
        'https://192.169.0.1/feed',
        'https://198.20.0.1/feed',
        'https://223.255.255.255/feed',
        'https://[2001:db9::1]/feed',
        'https://[2003::1]/feed',
        'https://[fbff::1]/feed',
        'https://[fec0::1]/feed',
    ]) {
        assert.equal(validateFeedPayload({ ...VALID_PAYLOAD, url }).error, null, `${url} wurde abgelehnt`);
    }
});

test('lässt öffentliche Adressen weiterhin zu', () => {
    for (const url of [
        'https://www.gamepro.de/rss/gamepro.rss',
        'https://172.32.0.1/feed',
        'https://10.example.com/feed',
        'https://localhost.example.com/feed',
        'https://[2606:4700:4700::1111]/feed',
    ]) {
        assert.equal(validateFeedPayload({ ...VALID_PAYLOAD, url }).error, null, `${url} wurde abgelehnt`);
    }
});
