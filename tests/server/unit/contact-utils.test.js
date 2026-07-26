import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CONTACT_FIELD_LIMITS,
    buildContactEmail,
    isRecaptchaAccepted,
    parseAllowedHostnames,
    validateContactPayload,
} from '../../../server/contact-utils.js';

function createContactPayload(overrides = {}) {
    return {
        name: 'Ada Lovelace',
        email: 'ada+gaming@example.co.uk',
        subject: 'Feedback zu GamerFeed',
        message: 'Hallo GamerFeed!\nDie App gefällt mir.',
        recaptchaToken: 'gültiger-token',
        ...overrides,
    };
}

test('validiert und normalisiert eine gültige Kontaktanfrage', () => {
    const result = validateContactPayload(createContactPayload({
        name: '  Ada Lovelace  ',
        message: '  Erste Zeile\r\nZweite Zeile  ',
    }));

    assert.deepEqual(result, {
        name: 'Ada Lovelace',
        email: 'ada+gaming@example.co.uk',
        subject: 'Feedback zu GamerFeed',
        message: 'Erste Zeile\nZweite Zeile',
        recaptchaToken: 'gültiger-token',
    });
});

test('lehnt fehlende, leere und falsch typisierte Felder ab', async t => {
    const cases = [
        ['kein Objekt', null],
        ['Array', []],
        ['fehlender Name', createContactPayload({ name: undefined })],
        ['nur Leerzeichen', createContactPayload({ message: '   ' })],
        ['falscher Typ', createContactPayload({ subject: 123 })],
        ['ungültige E-Mail', createContactPayload({ email: 'ada.example.com' })],
    ];

    for (const [name, payload] of cases) {
        await t.test(name, () => {
            assert.equal(validateContactPayload(payload), null);
        });
    }
});

test('akzeptiert Grenzlängen und lehnt überlange Felder ab', async t => {
    for (const [field, limit] of Object.entries(CONTACT_FIELD_LIMITS)) {
        await t.test(field, () => {
            const validCharacter = field === 'email' ? null : 'a';
            const atLimit = field === 'email'
                ? `${'a'.repeat(limit - '@b.cd'.length)}@b.cd`
                : validCharacter.repeat(limit);
            const overLimit = field === 'email'
                ? `${'a'.repeat(limit + 1 - '@b.cd'.length)}@b.cd`
                : validCharacter.repeat(limit + 1);

            assert.notEqual(validateContactPayload(createContactPayload({ [field]: atLimit })), null);
            assert.equal(validateContactPayload(createContactPayload({ [field]: overLimit })), null);
        });
    }
});

test('blockiert Steuerzeichen in Headerfeldern und NUL in Nachrichten', async t => {
    const cases = [
        ['Name mit Zeilenumbruch', { name: 'Ada\nBcc: attacker@example.com' }],
        ['E-Mail mit Zeilenumbruch', { email: 'ada@example.com\r\nBcc: attacker@example.com' }],
        ['Betreff mit Zeilenumbruch', { subject: 'Hallo\r\nBcc: attacker@example.com' }],
        ['Nachricht mit NUL', { message: 'Hallo\u0000Welt' }],
        ['Token mit Zeilenumbruch', { recaptchaToken: 'token\nzweite-zeile' }],
    ];

    for (const [name, override] of cases) {
        await t.test(name, () => {
            assert.equal(validateContactPayload(createContactPayload(override)), null);
        });
    }
});

test('escaped alle Benutzereingaben in der HTML-Mail und behält einen Textteil', () => {
    const contact = validateContactPayload(createContactPayload({
        name: '<Ada & Co>',
        email: 'ada+test@example.com',
        subject: '"Hallo" & <Test>',
        message: '<script>alert("xss")</script>\nGrüsse 👋',
    }));

    assert.ok(contact);
    const email = buildContactEmail(contact);

    assert.doesNotMatch(email.html, /<script>/u);
    assert.match(email.html, /&lt;Ada &amp; Co&gt;/u);
    assert.match(email.html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/u);
    assert.match(email.html, /Grüsse 👋/u);
    assert.match(email.text, /<script>alert\("xss"\)<\/script>/u);
    assert.equal(email.subject, '[GamerFeed Kontakt] "Hallo" & <Test>');
});

test('normalisiert und dedupliziert konfigurierte reCAPTCHA-Hostnamen', () => {
    assert.deepEqual(
        parseAllowedHostnames(' gamerfeed.vercel.app, HTTPS://Example.com/path, gamerfeed.vercel.app., ungültig:// '),
        ['gamerfeed.vercel.app', 'example.com'],
    );
    assert.deepEqual(parseAllowedHostnames(undefined), []);
});

test('akzeptiert reCAPTCHA nur mit Erfolg, ausreichendem Score und richtiger Action', async t => {
    const validResponse = {
        success: true,
        score: 0.5,
        action: 'contact_form',
        hostname: 'gamerfeed.vercel.app',
    };

    assert.equal(isRecaptchaAccepted(validResponse), true);

    const rejectedCases = [
        ['kein Objekt', null],
        ['nicht erfolgreich', { ...validResponse, success: false }],
        ['Score zu niedrig', { ...validResponse, score: 0.49 }],
        ['Score fehlt', { ...validResponse, score: undefined }],
        ['falsche Action', { ...validResponse, action: 'login' }],
        ['Fehlercodes vorhanden', { ...validResponse, 'error-codes': ['timeout-or-duplicate'] }],
    ];

    for (const [name, response] of rejectedCases) {
        await t.test(name, () => {
            assert.equal(isRecaptchaAccepted(response), false);
        });
    }
});

test('prüft reCAPTCHA-Hostnamen nur bei konfigurierter Allowlist', () => {
    const response = {
        success: true,
        score: 0.9,
        action: 'contact_form',
        hostname: 'gamerfeed.vercel.app',
    };

    assert.equal(isRecaptchaAccepted(response, {
        allowedHostnames: ['gamerfeed.vercel.app'],
    }), true);
    assert.equal(isRecaptchaAccepted(response, {
        allowedHostnames: ['example.com'],
    }), false);
});
