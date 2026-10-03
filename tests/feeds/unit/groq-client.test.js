import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GROQ_ENDPOINT,
    GROQ_MODEL,
    GROQ_REASONING_EFFORT,
    GROQ_REASONING_RESERVE_TOKENS,
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

/** Führt einen Aufruf aus und liefert den JSON-Rumpf, der an Groq gesendet wurde. */
async function gesendeterRumpf(optionen = {}) {
    const { logger } = silentLogger();
    let rumpf = null;

    await requestGroqCompletion({
        apiKey: API_KEY,
        messages: MESSAGES,
        fetchImpl: async (_url, init) => {
            rumpf = JSON.parse(init.body);
            return completion('[]');
        },
        logger,
        ...optionen,
    });

    return rumpf;
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
    assert.equal(JSON.parse(gesehen.init.body).model, 'openai/gpt-oss-20b');
});

test('fragt nicht mehr das abgeschaltete Modell an', async () => {
    // Groq hat llama-3.1-8b-instant am 16.08.2026 abgeschaltet; seither
    // beantwortet es jede Anfrage mit 404 model_not_found.
    const rumpf = await gesendeterRumpf();

    assert.equal(GROQ_MODEL, 'openai/gpt-oss-20b');
    assert.equal(rumpf.model, GROQ_MODEL);
    assert.notEqual(rumpf.model, 'llama-3.1-8b-instant');
});

test('fragt das Reasoning-Modell mit niedrigem Aufwand und ohne Denkweg an', async () => {
    const rumpf = await gesendeterRumpf();

    assert.equal(GROQ_REASONING_EFFORT, 'low');
    assert.equal(rumpf.reasoning_effort, 'low');
    assert.equal(rumpf.include_reasoning, false, 'der Denkweg wird nicht in die Antwort geschrieben');
    // Bei gpt-oss gibt es reasoning_format nicht, und es schließt
    // include_reasoning aus: Groq würde die Anfrage ablehnen.
    assert.equal('reasoning_format' in rumpf, false);
    // Kein Modus, der ein JSON-Objekt erzwingt: die Tagestrends sind ein Array.
    assert.equal('response_format' in rumpf, false);
});

test('das Tokenlimit lässt dem Denkweg Platz neben der sichtbaren Antwort', async () => {
    const standard = await gesendeterRumpf();
    const knapp = await gesendeterRumpf({ maxTokens: 700 });

    // max_tokens ist bei Groq veraltet; der Denkweg zählt zu max_completion_tokens.
    assert.equal('max_tokens' in standard, false);
    assert.equal(standard.max_completion_tokens, 1500 + GROQ_REASONING_RESERVE_TOKENS);
    assert.equal(knapp.max_completion_tokens, 700 + GROQ_REASONING_RESERVE_TOKENS);
    assert.ok(
        GROQ_REASONING_RESERVE_TOKENS >= 1024,
        'weniger als Groqs Vorgabe von 1024 Tokens lässt den Denkweg die Antwort verdrängen',
    );
});

test('die Temperatur liegt im von Groq für Reasoning-Modelle empfohlenen Bereich', async () => {
    const standard = await gesendeterRumpf();
    const eigene = await gesendeterRumpf({ temperature: 0.7 });

    assert.ok(standard.temperature >= 0.5 && standard.temperature <= 0.7, String(standard.temperature));
    assert.equal(eigene.temperature, 0.7, 'ein ausdrücklich gesetzter Wert bleibt maßgeblich');
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

test('ein im Denkweg verbrauchtes Tokenlimit wird als solches gemeldet', async () => {
    const { logger, errors } = silentLogger();

    // Der Denkweg hat das Limit aufgebraucht, bevor die Antwort begann.
    const { content, error } = await requestGroqCompletion({
        apiKey: API_KEY,
        messages: MESSAGES,
        fetchImpl: async () => jsonResponse({
            choices: [{ message: { content: '' }, finish_reason: 'length' }],
        }),
        logger,
    });

    assert.equal(content, null);
    assert.equal(error, 'token limit reached');
    assert.match(errors.join('\n'), /token limit/);

    // Eine leere Antwort aus anderem Grund bleibt eine leere Antwort.
    const regulaer = await requestGroqCompletion({
        apiKey: API_KEY,
        messages: MESSAGES,
        fetchImpl: async () => jsonResponse({
            choices: [{ message: { content: '' }, finish_reason: 'stop' }],
        }),
        logger,
    });
    assert.equal(regulaer.error, 'empty content');
});

test('geliefert wird nur die endgültige Antwort, nie der Denkweg', async () => {
    const { logger } = silentLogger();

    // Groq legt den Denkweg von gpt-oss in ein eigenes Feld. Selbst wenn es trotz
    // include_reasoning: false mitgeschickt würde, darf es nicht zur Antwort werden.
    const { content, error } = await requestGroqCompletion({
        apiKey: API_KEY,
        messages: MESSAGES,
        fetchImpl: async () => jsonResponse({
            choices: [{
                message: {
                    role: 'assistant',
                    content: '[{"topic":"GTA 6"}]',
                    reasoning: 'We need to output JSON only. Count the titles first ...',
                },
                finish_reason: 'stop',
            }],
        }),
        logger,
    });

    assert.equal(error, null);
    assert.equal(content, '[{"topic":"GTA 6"}]');
    assert.deepEqual(parseGroqJsonContent(content), [{ topic: 'GTA 6' }]);
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
