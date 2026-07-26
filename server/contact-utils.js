import { escape } from 'html-escaper';
import {
    CONTACT_FIELD_LIMITS,
    CONTACT_RECAPTCHA_ACTION,
} from '../shared/contact-contract.js';

export { CONTACT_FIELD_LIMITS };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const HEADER_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;
const MESSAGE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTrimmedString(record, key) {
    const value = record[key];
    return typeof value === 'string' ? value.trim() : null;
}

function isWithinLimit(value, maximumLength) {
    return value.length > 0 && value.length <= maximumLength;
}

export function validateContactPayload(payload) {
    if (!isRecord(payload)) {
        return null;
    }

    const name = readTrimmedString(payload, 'name');
    const email = readTrimmedString(payload, 'email');
    const subject = readTrimmedString(payload, 'subject');
    const rawMessage = readTrimmedString(payload, 'message');
    const recaptchaToken = readTrimmedString(payload, 'recaptchaToken');

    if (name === null || email === null || subject === null || rawMessage === null || recaptchaToken === null) {
        return null;
    }

    const message = rawMessage.replace(/\r\n?/gu, '\n');

    if (
        !isWithinLimit(name, CONTACT_FIELD_LIMITS.name)
        || !isWithinLimit(email, CONTACT_FIELD_LIMITS.email)
        || !isWithinLimit(subject, CONTACT_FIELD_LIMITS.subject)
        || !isWithinLimit(message, CONTACT_FIELD_LIMITS.message)
        || !isWithinLimit(recaptchaToken, CONTACT_FIELD_LIMITS.recaptchaToken)
    ) {
        return null;
    }

    if (
        !EMAIL_PATTERN.test(email)
        || HEADER_CONTROL_CHARACTERS.test(name)
        || HEADER_CONTROL_CHARACTERS.test(email)
        || HEADER_CONTROL_CHARACTERS.test(subject)
        || HEADER_CONTROL_CHARACTERS.test(recaptchaToken)
        || MESSAGE_CONTROL_CHARACTERS.test(message)
    ) {
        return null;
    }

    return {
        name,
        email,
        subject,
        message,
        recaptchaToken,
    };
}

export function buildContactEmail(contact) {
    const safeName = escape(contact.name);
    const safeEmail = escape(contact.email);
    const safeSubject = escape(contact.subject);
    const safeMessage = escape(contact.message);

    return {
        subject: `[GamerFeed Kontakt] ${contact.subject}`,
        text: [
            'Neue Kontaktanfrage von GamerFeed',
            '',
            `Von: ${contact.name}`,
            `E-Mail: ${contact.email}`,
            `Betreff: ${contact.subject}`,
            '',
            contact.message,
        ].join('\n'),
        html: `
            <h2>Neue Kontaktanfrage von GamerFeed</h2>
            <p><strong>Von:</strong> ${safeName}</p>
            <p><strong>E-Mail:</strong> ${safeEmail}</p>
            <p><strong>Betreff:</strong> ${safeSubject}</p>
            <hr>
            <h3>Nachricht:</h3>
            <p style="white-space: pre-wrap;">${safeMessage}</p>
            <hr>
            <p style="color: #666; font-size: 12px;">
                Diese E-Mail wurde über das Kontaktformular auf gamerfeed.vercel.app gesendet.
            </p>
        `,
    };
}

function normalizeHostname(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return null;
    }

    try {
        const normalizedValue = value.trim();
        const candidate = normalizedValue.includes('://')
            ? normalizedValue
            : `https://${normalizedValue}`;
        const hostname = new URL(candidate).hostname.toLowerCase().replace(/\.$/u, '');
        return hostname.length > 0 ? hostname : null;
    } catch {
        return null;
    }
}

export function parseAllowedHostnames(value) {
    if (typeof value !== 'string') {
        return [];
    }

    return [...new Set(
        value
            .split(',')
            .map(normalizeHostname)
            .filter(hostname => hostname !== null),
    )];
}

/**
 * @param {unknown} payload
 * @param {{
 *   minimumScore?: number,
 *   expectedAction?: string,
 *   allowedHostnames?: string[],
 * }} [options]
 */
export function isRecaptchaAccepted(
    payload,
    {
        minimumScore = 0.5,
        expectedAction = CONTACT_RECAPTCHA_ACTION,
        allowedHostnames = [],
    } = {},
) {
    if (!isRecord(payload)) {
        return false;
    }

    const score = payload.score;
    const action = payload.action;
    const hostname = normalizeHostname(payload.hostname);
    const errorCodes = payload['error-codes'];

    if (
        payload.success !== true
        || typeof score !== 'number'
        || !Number.isFinite(score)
        || score < minimumScore
        || action !== expectedAction
        || (Array.isArray(errorCodes) && errorCodes.length > 0)
    ) {
        return false;
    }

    if (allowedHostnames.length === 0) {
        return true;
    }

    return hostname !== null && allowedHostnames.includes(hostname);
}
