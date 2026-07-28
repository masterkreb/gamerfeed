import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GROQ_ENDPOINT,
    MAX_GROQ_RESPONSE_BYTES,
    parseGroqJsonContent,
    requestGroqCompletion,
} from '../../../scripts/groq-client.js';

const API_KEY = 'gsk_supergeheimer_testschluessel';
const MESSAGES = [{ role: 'user', content: 'Analysiere' }];

function silentLogger() {
    const errors = [];
    return { errors, logger: { error: line => errors.push(String(line)) } };
}

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: name => headers[name.toLowerCase()] ?? null },
        body: null,
        async text() {
            return text;
        },
    };
}

function completion(content) {
    return jsonResponse({ choices: [{ message: { content } }] });
}

/** Antwort, die stückweise streamt – ohne Content-Length. */
function streamingResponse(chunks) {
    const encoder = new TextEncoder();
    let cancelled = false;
    let index = 0;

    return {
        wasCancelled: () => cancelled,
        response: {
            ok: true,
            status: 200,
            headers: { get: () => null },
            body: {
                getReader: () => ({
                    async read() {
                        if (index >= chunks.length) return { done: true, value: undefined };
                        return { done: false, value: encoder.encode(chunks[index++]) };
                    },
                    async cancel() {
                        cancelled = true;
                    },
                    releaseLock() {},
                }),
                async cancel() {
                    cancelled = true;
                },
            },
        },
    };
}

test('liefert den Textinhalt einer gültigen Antwort', async () => {
    const { logger } = silentLogger();
    const { content, error } = await requestGroqCompletion({
        apiKey: API_KEY,
        messages: MESSAGES,
        fetchImpl: async () => completion('[{"topic":"GTA 6"}]'),
        logger,
    });

    assert.equal(error, null);
    assert.equal(content, '[{"topic":"GTA 6"}]');
});

test('schickt Schlüssel, Modell und Abort-Signal mit', async () => {
    const { logger } = silentLogger();
    let gesehen = null;

    await requestGroqCompletion({
        apiKey: API_KEY,
        messages: MESSAGES,
        fetchImpl: async (url, init) => {
            gesehen = { url, init };
            return completion('[]');
        },
        logger,
    });

    assert.equal(gesehen.url, GROQ_ENDPOINT);
    assert.equal(gesehen.init.headers.Authorization, `Bearer ${API_KEY}`);
    assert.ok(gesehen.init.signal, 'ohne Signal könnte die Anfrage ewig hängen');
    assert.equal(JSON.parse(gesehen.init.body).model, 'llama-3.1-8b-instant');
});

test('ein hängender Aufruf endet über das Abort-Signal', async () => {
    const { logger, errors } = silentLogger();
    let signalGesehen = null;

    const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
        signalGesehen = init.signal;
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });

    // AbortSignal.timeout() hält die Event-Loop nicht selbst offen.
    const anker = setTimeout(() => {}, 5000);
    const start = Date.now();
    let ergebnis;
    try {
        ergebnis = await requestGroqCompletion({
            apiKey: API_KEY,
            messages: MESSAGES,
            fetchImpl,
            logger,
            timeoutMs: 25,
        });
    } finally {
        clearTimeout(anker);
    }

    assert.equal(ergebnis.content, null);
    assert.equal(signalGesehen.aborted, true);
    assert.ok(Date.now() - start < 2000, 'der Aufruf endet über das Signal, nicht durch Warten');
    assert.match(ergebnis.error, /aborted|timeout/i);
    assert.ok(errors.length > 0);
});

test('eine zu große Antwort wird kontrolliert abgelehnt', async () => {
    const { logger } = silentLogger();
    const stream = streamingResponse(['x'.repeat(400), 'y'.repeat(400), 'z'.repeat(400)]);

    const { content, error } = await requestGroqCompletion({
        apiKey: API_KEY,
        messages: MESSAGES,
        fetchImpl: async () => stream.response,
        logger,
        maxBytes: 500,
    });

    assert.equal(content, null);
    assert.match(error, /byte limit/);
    assert.equal(stream.wasCancelled(), true, 'der Stream wird geschlossen');
});

test('eine zu große Content-Length wird abgelehnt', async () => {
    const { logger } = silentLogger();

    const { content, error } = await requestGroqCompletion({
        apiKey: API_KEY,
        messages: MESSAGES,
        fetchImpl: async () => jsonResponse({ choices: [] }, {
            headers: { 'content-length': String(MAX_GROQ_RESPONSE_BYTES + 1) },
        }),
        logger,
    });

    assert.equal(content, null);
    assert.match(error, /byte limit/);
});

test('ungültiges JSON endet kontrolliert und ohne Rohtext im Log', async () => {
    const { logger, errors } = silentLogger();

    const { content, error } = await requestGroqCompletion({
        apiKey: API_KEY,
        messages: MESSAGES,
        fetchImpl: async () => jsonResponse('{"choices": [ kaputt'),
        logger,
    });

    assert.equal(content, null);
    assert.equal(error, 'invalid json');
    assert.doesNotMatch(errors.join('\n'), /kaputt/);
});

test('eine Antwort ohne Inhalt endet kontrolliert', async () => {
    const { logger } = silentLogger();

    for (const payload of [{ choices: [] }, { choices: [{ message: {} }] }, { choices: [{ message: { content: '   ' } }] }, {}]) {
        const { content, error } = await requestGroqCompletion({
            apiKey: API_KEY,
            messages: MESSAGES,
            fetchImpl: async () => jsonResponse(payload),
            logger,
        });

        assert.equal(content, null, JSON.stringify(payload));
        assert.equal(error, 'empty content');
    }
});

test('ein Providerfehler wird begrenzt und bereinigt gemeldet', async () => {
    const { logger, errors } = silentLogger();

    const { content, error } = await requestGroqCompletion({
        apiKey: API_KEY,
        messages: MESSAGES,
        fetchImpl: async () => jsonResponse('Fehlerdetails '.repeat(200), { status: 500 }),
        logger,
        redact: message => message.replaceAll(API_KEY, '[redacted]'),
    });

    assert.equal(content, null);
    assert.match(error, /status 500/);
    assert.ok(error.length < 300, 'der Providertext wird gekürzt');
    assert.doesNotMatch(errors.join('\n'), new RegExp(API_KEY));
});

test('der API-Schlüssel erscheint in keiner Fehlerausgabe', async () => {
    const { logger, errors } = silentLogger();

    const { error } = await requestGroqCompletion({
        apiKey: API_KEY,
        messages: MESSAGES,
        fetchImpl: async () => {
            throw new Error(`connect failed for Bearer ${API_KEY}`);
        },
        logger,
        redact: message => message.replaceAll(API_KEY, '[redacted]'),
    });

    assert.doesNotMatch(error, new RegExp(API_KEY));
    assert.doesNotMatch(errors.join('\n'), new RegExp(API_KEY));
});

test('ohne Schlüssel wird gar nicht erst angefragt', async () => {
    const { logger } = silentLogger();
    let aufrufe = 0;

    for (const apiKey of [undefined, null, '', '   ']) {
        const { content, error } = await requestGroqCompletion({
            apiKey,
            messages: MESSAGES,
            fetchImpl: async () => {
                aufrufe += 1;
                return completion('[]');
            },
            logger,
        });

        assert.equal(content, null);
        assert.equal(error, 'missing api key');
    }

    assert.equal(aufrufe, 0);
});

// === JSON-Auswertung ===

test('parseGroqJsonContent liest auch Markdown-verpacktes JSON', () => {
    assert.deepEqual(parseGroqJsonContent('```json\n[{"topic":"GTA 6"}]\n```'), [{ topic: 'GTA 6' }]);
    assert.deepEqual(parseGroqJsonContent('[{"topic":"GTA 6"}]'), [{ topic: 'GTA 6' }]);
});

test('parseGroqJsonContent liefert bei Unsinn null statt zu werfen', () => {
    for (const content of ['kein json', '{kaputt', '', undefined, null, 42]) {
        assert.equal(parseGroqJsonContent(content), null, String(content));
    }
});
