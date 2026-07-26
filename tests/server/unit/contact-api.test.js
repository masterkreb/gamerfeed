import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import contactHandler from '../../../api/contact.ts';

const CONTACT_ENVIRONMENT_KEYS = [
    'RECAPTCHA_SECRET_KEY',
    'RECAPTCHA_ALLOWED_HOSTNAMES',
    'GMAIL_USER',
    'GMAIL_APP_PASSWORD',
];

function createValidRequestBody(overrides = {}) {
    return {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        subject: 'Feedback',
        message: 'Hallo GamerFeed!',
        recaptchaToken: 'gültiger-token',
        ...overrides,
    };
}

function createApiResponse() {
    const headers = new Map();
    let statusCode = null;
    let body;

    return {
        response: {
            setHeader(name, value) {
                headers.set(name.toLowerCase(), value);
            },
            status(code) {
                statusCode = code;
                return {
                    json(payload) {
                        body = payload;
                    },
                };
            },
        },
        result() {
            return { statusCode, body, headers };
        },
    };
}

async function invokeContactHandler(request) {
    const apiResponse = createApiResponse();
    await contactHandler(request, apiResponse.response);
    return apiResponse.result();
}

function createRecaptchaResponse(overrides = {}) {
    return new Response(JSON.stringify({
        success: true,
        score: 0.9,
        action: 'contact_form',
        hostname: 'gamerfeed.vercel.app',
        ...overrides,
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

test('Kontakt-API liefert nur nach erfolgreichem Captcha und SMTP-Versand Erfolg', async t => {
    const originalEnvironment = Object.fromEntries(
        CONTACT_ENVIRONMENT_KEYS.map(key => [key, process.env[key]]),
    );
    const originalFetch = globalThis.fetch;
    const originalCreateTransport = nodemailer.createTransport;
    const originalConsole = {
        error: console.error,
        info: console.info,
        warn: console.warn,
    };

    let fetchCalls = [];
    let transportOptions;
    let sentMessage;
    let sendMailImplementation = async message => {
        sentMessage = message;
    };

    globalThis.fetch = async (url, options) => {
        fetchCalls.push({ url, options });
        return createRecaptchaResponse();
    };
    nodemailer.createTransport = options => {
        transportOptions = options;
        return {
            sendMail: message => sendMailImplementation(message),
        };
    };
    console.error = () => {};
    console.info = () => {};
    console.warn = () => {};

    Object.assign(process.env, {
        RECAPTCHA_SECRET_KEY: 'server-secret',
        RECAPTCHA_ALLOWED_HOSTNAMES: 'gamerfeed.vercel.app',
        GMAIL_USER: 'gamerfeed@example.com',
        GMAIL_APP_PASSWORD: 'app-password',
    });

    try {
        await t.test('lehnt andere HTTP-Methoden ab', async () => {
            const result = await invokeContactHandler({ method: 'GET' });

            assert.equal(result.statusCode, 405);
            assert.deepEqual(result.body, {
                success: false,
                error: { code: 'method_not_allowed' },
            });
            assert.equal(result.headers.get('allow'), 'POST');
            assert.equal(result.headers.get('cache-control'), 'no-store');
            assert.equal(fetchCalls.length, 0);
        });

        await t.test('lehnt ungültige Formulardaten vor externen Aufrufen ab', async () => {
            const result = await invokeContactHandler({
                method: 'POST',
                body: createValidRequestBody({ message: '   ' }),
            });

            assert.equal(result.statusCode, 400);
            assert.equal(result.body.error.code, 'invalid_request');
            assert.equal(fetchCalls.length, 0);
        });

        await t.test('meldet fehlende Secrets als nicht verfügbaren Dienst', async () => {
            delete process.env.GMAIL_APP_PASSWORD;

            const result = await invokeContactHandler({
                method: 'POST',
                body: createValidRequestBody(),
            });

            assert.equal(result.statusCode, 503);
            assert.equal(result.body.error.code, 'service_unavailable');
            assert.equal(fetchCalls.length, 0);
            process.env.GMAIL_APP_PASSWORD = 'app-password';
        });

        await t.test('schlägt bei einer ungültigen Hostname-Konfiguration geschlossen fehl', async () => {
            process.env.RECAPTCHA_ALLOWED_HOSTNAMES = 'https://';

            const result = await invokeContactHandler({
                method: 'POST',
                body: createValidRequestBody(),
            });

            assert.equal(result.statusCode, 503);
            assert.equal(result.body.error.code, 'service_unavailable');
            assert.equal(fetchCalls.length, 0);
            process.env.RECAPTCHA_ALLOWED_HOSTNAMES = 'gamerfeed.vercel.app';
        });

        await t.test('lehnt eine falsche reCAPTCHA-Action ab', async () => {
            globalThis.fetch = async (url, options) => {
                fetchCalls.push({ url, options });
                return createRecaptchaResponse({ action: 'login' });
            };

            const result = await invokeContactHandler({
                method: 'POST',
                body: createValidRequestBody(),
            });

            assert.equal(result.statusCode, 403);
            assert.equal(result.body.error.code, 'captcha_rejected');
            assert.equal(sentMessage, undefined);
        });

        await t.test('behandelt einen Ausfall der reCAPTCHA-Prüfung als temporären Fehler', async () => {
            globalThis.fetch = async () => {
                throw new Error('Netzwerk nicht erreichbar');
            };

            const result = await invokeContactHandler({
                method: 'POST',
                body: createValidRequestBody(),
            });

            assert.equal(result.statusCode, 503);
            assert.equal(result.body.error.code, 'service_unavailable');
        });

        await t.test('sendet eine validierte Nachricht mit sicheren SMTP-Optionen', async () => {
            fetchCalls = [];
            globalThis.fetch = async (url, options) => {
                fetchCalls.push({ url, options });
                return createRecaptchaResponse();
            };

            const result = await invokeContactHandler({
                method: 'POST',
                body: createValidRequestBody(),
            });

            assert.equal(result.statusCode, 200);
            assert.deepEqual(result.body, { success: true });
            assert.equal(fetchCalls.length, 1);
            assert.equal(fetchCalls[0].url, 'https://www.google.com/recaptcha/api/siteverify');
            assert.equal(fetchCalls[0].options.method, 'POST');
            assert.equal(fetchCalls[0].options.body.get('secret'), 'server-secret');
            assert.equal(fetchCalls[0].options.body.get('response'), 'gültiger-token');
            assert.equal(transportOptions.requireTLS, true);
            assert.equal(transportOptions.disableFileAccess, true);
            assert.equal(transportOptions.disableUrlAccess, true);
            assert.equal(sentMessage.to, 'gamerfeed@example.com');
            assert.equal(sentMessage.replyTo, 'ada@example.com');
            assert.match(sentMessage.text, /Hallo GamerFeed!/u);
            assert.match(sentMessage.html, /Hallo GamerFeed!/u);
        });

        await t.test('gibt bei einem SMTP-Fehler keinen falschen Erfolg zurück', async () => {
            sendMailImplementation = async () => {
                const error = new Error('SMTP fehlgeschlagen');
                error.code = 'ECONNECTION';
                throw error;
            };

            const result = await invokeContactHandler({
                method: 'POST',
                body: createValidRequestBody(),
            });

            assert.equal(result.statusCode, 502);
            assert.deepEqual(result.body, {
                success: false,
                error: { code: 'delivery_failed' },
            });
        });
    } finally {
        globalThis.fetch = originalFetch;
        nodemailer.createTransport = originalCreateTransport;
        console.error = originalConsole.error;
        console.info = originalConsole.info;
        console.warn = originalConsole.warn;

        for (const [key, value] of Object.entries(originalEnvironment)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
});
