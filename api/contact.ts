import nodemailer from 'nodemailer';
import {
    buildContactEmail,
    isRecaptchaAccepted,
    parseAllowedHostnames,
    validateContactPayload,
} from '../server/contact-utils.js';

interface ApiRequest {
    method?: string;
    body?: unknown;
}

interface ApiResponse {
    setHeader?: (name: string, value: string) => void;
    status: (code: number) => {
        json: (body: unknown) => void;
    };
}

type ValidatedContact = NonNullable<ReturnType<typeof validateContactPayload>>;

const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const RECAPTCHA_TIMEOUT_MS = 5_000;

let mailTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;

class RecaptchaUnavailableError extends Error {
    constructor() {
        super('reCAPTCHA verification unavailable');
        this.name = 'RecaptchaUnavailableError';
    }
}

function respond(res: ApiResponse, status: number, code?: string) {
    res.setHeader?.('Cache-Control', 'no-store');

    if (status === 200) {
        return res.status(status).json({ success: true });
    }

    return res.status(status).json({
        success: false,
        error: { code },
    });
}

function getConfiguredValue(value: string | undefined) {
    const normalizedValue = value?.trim();
    return normalizedValue ? normalizedValue : null;
}

function getAllowedRecaptchaHostnames(value: string | undefined) {
    const configuredValue = getConfiguredValue(value);
    if (!configuredValue) {
        return [];
    }

    const allowedHostnames = parseAllowedHostnames(configuredValue);
    return allowedHostnames.length > 0 ? allowedHostnames : null;
}

async function verifyRecaptcha(
    token: string,
    secret: string,
    allowedHostnames: string[],
): Promise<boolean> {
    let response: Response;

    try {
        response = await fetch(RECAPTCHA_VERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                secret,
                response: token,
            }),
            signal: AbortSignal.timeout(RECAPTCHA_TIMEOUT_MS),
        });
    } catch {
        throw new RecaptchaUnavailableError();
    }

    if (!response.ok) {
        throw new RecaptchaUnavailableError();
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new RecaptchaUnavailableError();
    }

    return isRecaptchaAccepted(payload, { allowedHostnames });
}

function getMailTransporter(smtpUser: string, smtpPassword: string) {
    if (!mailTransporter) {
        mailTransporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            requireTLS: true,
            auth: {
                user: smtpUser,
                pass: smtpPassword,
            },
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 20_000,
            dnsTimeout: 5_000,
            disableFileAccess: true,
            disableUrlAccess: true,
        });
    }

    return mailTransporter;
}

async function sendContactEmail(
    contact: ValidatedContact,
    smtpUser: string,
    smtpPassword: string,
) {
    const email = buildContactEmail(contact);

    await getMailTransporter(smtpUser, smtpPassword).sendMail({
        from: {
            name: 'GamerFeed Kontakt',
            address: smtpUser,
        },
        to: smtpUser,
        replyTo: contact.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        disableFileAccess: true,
        disableUrlAccess: true,
    });
}

function getSafeMailErrorCode(error: unknown) {
    if (
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && typeof error.code === 'string'
    ) {
        return error.code.slice(0, 40);
    }

    return 'unknown';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader?.('Allow', 'POST');
        return respond(res, 405, 'method_not_allowed');
    }

    const contact = validateContactPayload(req.body);
    if (!contact) {
        console.warn('contact.request_rejected', { reason: 'validation' });
        return respond(res, 400, 'invalid_request');
    }

    const recaptchaSecret = getConfiguredValue(process.env.RECAPTCHA_SECRET_KEY);
    const smtpUser = getConfiguredValue(process.env.GMAIL_USER);
    const smtpPassword = getConfiguredValue(process.env.GMAIL_APP_PASSWORD);

    if (!recaptchaSecret || !smtpUser || !smtpPassword) {
        console.error('contact.service_unavailable', { reason: 'configuration' });
        return respond(res, 503, 'service_unavailable');
    }

    const allowedHostnames = getAllowedRecaptchaHostnames(
        process.env.RECAPTCHA_ALLOWED_HOSTNAMES,
    );
    if (!allowedHostnames) {
        console.error('contact.service_unavailable', {
            reason: 'hostname_configuration',
        });
        return respond(res, 503, 'service_unavailable');
    }

    let captchaAccepted: boolean;
    try {
        captchaAccepted = await verifyRecaptcha(
            contact.recaptchaToken,
            recaptchaSecret,
            allowedHostnames,
        );
    } catch (error) {
        if (error instanceof RecaptchaUnavailableError) {
            console.error('contact.service_unavailable', { reason: 'recaptcha' });
            return respond(res, 503, 'service_unavailable');
        }
        console.error('contact.internal_error');
        return respond(res, 500, 'internal_error');
    }

    if (!captchaAccepted) {
        console.warn('contact.request_rejected', { reason: 'captcha' });
        return respond(res, 403, 'captcha_rejected');
    }

    try {
        await sendContactEmail(contact, smtpUser, smtpPassword);
    } catch (error) {
        console.error('contact.delivery_failed', {
            code: getSafeMailErrorCode(error),
        });
        return respond(res, 502, 'delivery_failed');
    }

    console.info('contact.delivered');
    return respond(res, 200);
}
