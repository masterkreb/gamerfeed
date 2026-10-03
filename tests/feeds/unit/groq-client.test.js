import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GROQ_ENDPOINT,
    GROQ_MODEL,
    GROQ_REASONING_EFFORT,
    GROQ_REASONING_RESERVE_TOKENS,
    MAX_GROQ_RESPONSE_BYTES,
    describeGroqResponseShape,
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
    // Ein Antwortformat sendet nur, wer ausdrücklich eines übergibt.
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

// === Antwortformat (Structured Outputs) ===

const BEISPIEL_FORMAT = Object.freeze({
    type: 'json_schema',
    json_schema: {
        name: 'beispiel',
        strict: true,
        schema: {
            type: 'object',
            properties: { trends: { type: 'array', items: { type: 'string' } } },
            required: ['trends'],
            additionalProperties: false,
        },
    },
});

test('ein übergebenes Antwortformat geht unverändert als response_format an Groq', async () => {
    const rumpf = await gesendeterRumpf({ responseFormat: BEISPIEL_FORMAT });

    assert.deepEqual(rumpf.response_format, BEISPIEL_FORMAT);
    // Es kommt zu den vorhandenen Angaben hinzu und ersetzt keine davon.
    assert.equal(rumpf.model, GROQ_MODEL);
    assert.equal(rumpf.reasoning_effort, GROQ_REASONING_EFFORT);
    assert.equal(rumpf.include_reasoning, false);
    assert.equal(rumpf.max_completion_tokens, 1500 + GROQ_REASONING_RESERVE_TOKENS);
    assert.equal('reasoning_format' in rumpf, false);
});

test('ohne Antwortformat bleibt der Rumpf exakt wie bisher', async () => {
    const bisher = {
        model: GROQ_MODEL,
        messages: MESSAGES,
        temperature: 0.5,
        max_completion_tokens: 1500 + GROQ_REASONING_RESERVE_TOKENS,
        reasoning_effort: 'low',
        include_reasoning: false,
    };

    // "Nicht gesetzt" heißt: weggelassen, undefined oder null.
    for (const optionen of [{}, { responseFormat: undefined }, { responseFormat: null }]) {
        const rumpf = await gesendeterRumpf(optionen);
        assert.deepEqual(rumpf, bisher, JSON.stringify(optionen));
    }
});

test('ein abgelehntes Antwortformat bleibt ein Providerfehler als Wert', async () => {
    const { logger, errors } = silentLogger();

    // Ob sich json_schema mit reasoning_effort und include_reasoning verträgt,
    // steht nicht in der Groq-Doku. Lehnt die API die Kombination ab, muss das
    // als gewöhnlicher Fehlerwert ankommen und nicht als Ausnahme.
    const ergebnis = await requestGroqCompletion({
        apiKey: API_KEY,
        messages: MESSAGES,
        responseFormat: BEISPIEL_FORMAT,
        fetchImpl: async () => jsonResponse(
            { error: { message: 'response_format is not supported with this request', type: 'invalid_request_error' } },
            { status: 400 },
        ),
        logger,
    });

    assert.deepEqual(ergebnis, {
        content: null,
        error: ergebnis.error,
        finishReason: null,
    });
    assert.match(ergebnis.error, /^status 400: /);
    assert.match(errors.join('\n'), /Groq API error: status 400/);
});

// === finish_reason ===

test('finish_reason der Antwort wird mitgeliefert', async () => {
    const { logger } = silentLogger();

    // Fehlt der Wert oder ist er kein Text, gilt er als unbekannt.
    for (const [finishReason, erwartet] of [['stop', 'stop'], ['length', 'length'], [undefined, null], [null, null], [42, null]]) {
        const ergebnis = await requestGroqCompletion({
            apiKey: API_KEY,
            messages: MESSAGES,
            fetchImpl: async () => jsonResponse({
                choices: [{ message: { content: '{"trends":[]}' }, finish_reason: finishReason }],
            }),
            logger,
        });

        assert.equal(ergebnis.error, null, String(finishReason));
        assert.equal(ergebnis.content, '{"trends":[]}', String(finishReason));
        assert.equal(ergebnis.finishReason, erwartet, String(finishReason));
    }
});

test('eine abgeschnittene Antwort bleibt Inhalt und meldet finish_reason length', async () => {
    const { logger } = silentLogger();

    // Der Client urteilt nicht über den Inhalt: das JSON ist unvollständig, aber
    // der Aufrufer bekommt Text und Grund und kann beides protokollieren.
    const ergebnis = await requestGroqCompletion({
        apiKey: API_KEY,
        messages: MESSAGES,
        fetchImpl: async () => jsonResponse({
            choices: [{ message: { content: '{"trends":[{"topic":"GTA' }, finish_reason: 'length' }],
        }),
        logger,
    });

    assert.equal(ergebnis.error, null);
    assert.equal(ergebnis.content, '{"trends":[{"topic":"GTA');
    assert.equal(ergebnis.finishReason, 'length');
});

test('Fehlerfälle liefern weiter einen Wert statt einer Ausnahme', async () => {
    const faelle = [
        {
            name: '404 für ein abgeschaltetes Modell',
            fetchImpl: async () => jsonResponse(
                { error: { message: 'The model has been decommissioned', code: 'model_not_found' } },
                { status: 404 },
            ),
            error: /^status 404: .*model_not_found/,
            finishReason: null,
        },
        {
            name: 'Netzwerkfehler',
            fetchImpl: async () => {
                throw new Error('connect ECONNRESET');
            },
            error: /^connect ECONNRESET$/,
            finishReason: null,
        },
        {
            name: 'ungültiges JSON im Rumpf',
            fetchImpl: async () => jsonResponse('{"choices": [ kaputt'),
            error: /^invalid json$/,
            finishReason: null,
        },
        {
            name: 'leerer Inhalt',
            fetchImpl: async () => jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }),
            error: /^empty content$/,
            finishReason: 'stop',
        },
        {
            name: 'im Denkweg verbrauchtes Tokenlimit',
            fetchImpl: async () => jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }),
            error: /^token limit reached$/,
            finishReason: 'length',
        },
    ];

    // Mit und ohne Antwortformat: ein Schema ändert nichts an der Fehlerbehandlung.
    for (const responseFormat of [undefined, BEISPIEL_FORMAT]) {
        for (const fall of faelle) {
            const { logger } = silentLogger();
            const ergebnis = await requestGroqCompletion({
                apiKey: API_KEY,
                messages: MESSAGES,
                responseFormat,
                fetchImpl: fall.fetchImpl,
                logger,
            });

            const kontext = `${fall.name} (${responseFormat ? 'mit' : 'ohne'} Format)`;
            assert.equal(ergebnis.content, null, kontext);
            assert.match(ergebnis.error, fall.error, kontext);
            assert.equal(ergebnis.finishReason, fall.finishReason, kontext);
        }
    }

    // Ohne Schlüssel wird gar nicht erst angefragt und trotzdem dieselbe Form geliefert.
    assert.deepEqual(
        await requestGroqCompletion({ apiKey: '', messages: MESSAGES, fetchImpl: async () => completion('[]') }),
        { content: null, error: 'missing api key', finishReason: null },
    );
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

test('parseGroqJsonContent entfernt einen Code-Zaun auch nach führendem Leerraum', () => {
    const erwartet = [{ topic: 'GTA 6' }];

    for (const content of [
        '```json\n[{"topic":"GTA 6"}]\n```',
        '  ```json\n[{"topic":"GTA 6"}]\n```',
        '\n\n\t```json\r\n[{"topic":"GTA 6"}]\r\n```  \n',
        String.fromCharCode(0xFEFF) + '```json\n[{"topic":"GTA 6"}]\n```',
    ]) {
        assert.deepEqual(parseGroqJsonContent(content), erwartet, JSON.stringify(content));
    }
});

test('parseGroqJsonContent erkennt den Zaun unabhängig von der Sprachkennung', () => {
    const erwartet = { trends: [] };

    for (const content of [
        '```JSON\n{"trends":[]}\n```',
        '```Json\n{"trends":[]}\n```',
        '``` json\n{"trends":[]}\n```',
        '```\n{"trends":[]}\n```',
        '```json{"trends":[]}```',
        // Ein abgeschnittener Zaun ohne Schluss ist trotzdem lesbar.
        '```json\n{"trends":[]}',
    ]) {
        assert.deepEqual(parseGroqJsonContent(content), erwartet, JSON.stringify(content));
    }
});

test('parseGroqJsonContent lässt Backticks innerhalb des JSON unangetastet', () => {
    // Früher entfernte der Parser jeden Zaun im Text und verfälschte so Werte.
    assert.deepEqual(
        parseGroqJsonContent('```json\n{"code":"x```y"}\n```'),
        { code: 'x```y' },
    );
});

test('parseGroqJsonContent sucht kein JSON in Fließtext', () => {
    // Das strikte Antwortschema erzwingt die Form; eine Suche im Text ist nicht nötig.
    assert.equal(parseGroqJsonContent('Hier ist das Ergebnis:\n```json\n[{"topic":"GTA 6"}]\n```'), null);
    assert.equal(parseGroqJsonContent('[{"topic":"GTA 6"}]\nDas war es.'), null);
});

// === Formbeschreibung ohne Inhalt ===

test('describeGroqResponseShape nennt Länge, finish_reason und Typ der obersten Ebene', () => {
    assert.equal(
        describeGroqResponseShape({ content: '[{"a":1}]', finishReason: 'stop' }),
        'length=9 finish_reason=stop top_level=array',
    );
    assert.equal(
        describeGroqResponseShape({ content: '"abc"' }),
        'length=5 finish_reason=unknown top_level=string',
    );
    assert.equal(
        describeGroqResponseShape({ content: '42', finishReason: null }),
        'length=2 finish_reason=unknown top_level=number',
    );
    assert.equal(
        describeGroqResponseShape({ content: 'true' }),
        'length=4 finish_reason=unknown top_level=boolean',
    );
    // Das JSON-Literal null und nicht lesbarer Text bleiben unterscheidbar.
    assert.equal(
        describeGroqResponseShape({ content: 'null', finishReason: 'stop' }),
        'length=4 finish_reason=stop top_level=null',
    );
    assert.equal(
        describeGroqResponseShape({ content: '{"trends":[{"topic":"GTA', finishReason: 'length' }),
        'length=24 finish_reason=length top_level=unparsable',
    );
    assert.equal(
        describeGroqResponseShape({ content: undefined }),
        'length=0 finish_reason=unknown top_level=unparsable',
    );
});

test('describeGroqResponseShape nennt bei einem Objekt höchstens die ersten fünf Schlüssel', () => {
    assert.equal(
        describeGroqResponseShape({ content: '{"results":[],"count":1}', finishReason: 'stop' }),
        'length=24 finish_reason=stop top_level=object keys=results,count',
    );
    const siebenSchluessel = JSON.stringify({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 });
    assert.equal(
        describeGroqResponseShape({ content: siebenSchluessel }),
        `length=${siebenSchluessel.length} finish_reason=unknown top_level=object keys=a,b,c,d,e (+2 more)`,
    );
    assert.equal(
        describeGroqResponseShape({ content: '{}' }),
        'length=2 finish_reason=unknown top_level=object keys=(none)',
    );
    // Auch ein Zaun um das JSON ändert die Auswertung nicht.
    assert.match(
        describeGroqResponseShape({ content: '```json\n{"trends":[]}\n```' }),
        /top_level=object keys=trends$/,
    );
});

test('describeGroqResponseShape verrät keinen Inhalt und bleibt eine einzige Zeile', () => {
    const content = JSON.stringify({
        'GTA 6 Release-Termin steht fest': 'Geheimer Zusammenfassungstext',
        [`${'x'.repeat(40)}`]: 1,
        trends: [{ topic: 'Geheimer Titel' }],
        'zeile\numbruch': 2,
    });

    const beschreibung = describeGroqResponseShape({ content, finishReason: 'stop\nGeheim' });

    // Titel, Werte, zu lange und nicht bezeichnerartige Namen erscheinen nicht.
    assert.doesNotMatch(beschreibung, /GTA|Release|Geheim|xxxx|umbruch/);
    assert.doesNotMatch(beschreibung, /[\r\n]/);
    assert.equal(
        beschreibung,
        `length=${content.length} finish_reason=? top_level=object keys=?,?,trends,?`,
    );
});
