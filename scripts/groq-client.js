// Begrenzter Zugang zur Groq-API (Roadmap-Paket O2a).
//
// Trends sind eine **optionale** Zusatzfunktion. Weder ein hängender Provider
// noch eine riesige oder unsinnige Antwort darf den News-Kernlauf beschädigen -
// deshalb endet hier jeder Fehler als `{ content: null, error }` und nie als
// geworfene Ausnahme.
//
// Der API-Schlüssel steht ausschliesslich im Authorization-Header und wird
// nirgends protokolliert; zusätzlich läuft jede Meldung durch `redact`.

import { ResponseTooLargeError, readLimitedResponseText } from './limited-response.js';

export const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

// Groq hat llama-3.1-8b-instant am 16.08.2026 abgeschaltet und empfiehlt als
// Ersatz openai/gpt-oss-20b, ein Modell im Produktionsstatus
// (https://console.groq.com/docs/deprecations). Eine abgeschaltete Modell-ID
// zeigt sich als `404 model_not_found`; weil Trends optional sind, bleibt der
// Lauf dabei grün. Groq löst Modelle regelmäßig ab: die Deprecation-Liste
// gehört zur Pflege dieser Konstante.
export const GROQ_MODEL = 'openai/gpt-oss-20b';

// gpt-oss ist ein Reasoning-Modell und denkt vor seiner Antwort. Die Aufgaben
// hier sind einfach (Titel zu Themen verdichten), deshalb genügt der niedrigste
// Aufwand. `include_reasoning: false` lässt den Denkweg aus der Antwort weg,
// `content` enthält ohnehin nur die endgültige Antwort. `reasoning_format` wird
// bei gpt-oss nicht unterstützt und darf nicht zusammen mit
// `include_reasoning` gesendet werden.
export const GROQ_REASONING_EFFORT = 'low';

// Der Denkweg zählt zur erzeugten Tokenzahl. Ein Limit, das nur für die
// sichtbare Antwort reicht, endet deshalb mit leerem `content` und
// `finish_reason: "length"`. `maxTokens` bleibt das Budget der Antwort; diese
// Reserve kommt für den Denkweg hinzu. Das Gesamtlimit bleibt klein genug für
// das Token-pro-Minute-Limit des kostenlosen Tarifs (8K für gpt-oss-20b).
export const GROQ_REASONING_RESERVE_TOKENS = 2048;

/** Groq antwortet auf unsere Prompts mit wenigen Kilobyte. */
export const GROQ_TIMEOUT_MS = 20000;
export const MAX_GROQ_RESPONSE_BYTES = 256 * 1024;

// Fehlerantworten des Providers können Hinweise auf die Anfrage enthalten und
// sind für die Diagnose selten nötig. Ein kurzer Auszug reicht.
const MAX_PROVIDER_ERROR_CHARS = 200;

function describeError(error) {
    if (error instanceof Error) {
        // Ein Abbruch über das Signal ist der erwartete Timeout-Fall.
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            return 'request aborted (timeout)';
        }
        return error.message;
    }
    return String(error);
}

/**
 * Fragt eine Chat-Completion an und liefert den reinen Textinhalt.
 *
 * `maxTokens` ist das Budget der sichtbaren Antwort. Der Denkweg des Modells
 * bekommt zusätzlich `GROQ_REASONING_RESERVE_TOKENS`; als `max_completion_tokens`
 * geht die Summe an Groq.
 *
 * `responseFormat` ist optional und geht unverändert als `response_format` an
 * Groq, etwa ein striktes JSON-Schema (Structured Outputs). Ohne ihn bleibt der
 * Rumpf so, wie er vorher war.
 *
 * `finishReason` ist der `finish_reason` der ersten Auswahl, sofern Groq einen
 * geliefert hat, sonst `null`. Er erklärt vor allem abgeschnittene Antworten
 * (`length`); als Wert zurückgegeben, damit der Aufrufer ihn protokollieren kann.
 *
 * @param {{
 *   apiKey: string,
 *   messages: Array<{ role: string, content: string }>,
 *   maxTokens?: number,
 *   temperature?: number,
 *   responseFormat?: object|null,
 *   fetchImpl?: Function,
 *   timeoutMs?: number,
 *   maxBytes?: number,
 *   logger?: { error?: Function },
 *   redact?: (message: string) => string,
 * }} options
 * @returns {Promise<{ content: string|null, error: string|null, finishReason: string|null }>}
 */
export async function requestGroqCompletion({
    apiKey,
    messages,
    maxTokens = 1500,
    // Groq empfiehlt für Reasoning-Modelle 0.5-0.7, damit sich die Ausgabe nicht
    // wiederholt oder unzusammenhängend wird (https://console.groq.com/docs/reasoning).
    // 0.5 liegt dem früheren 0.3 am nächsten.
    temperature = 0.5,
    responseFormat = null,
    fetchImpl = globalThis.fetch,
    timeoutMs = GROQ_TIMEOUT_MS,
    maxBytes = MAX_GROQ_RESPONSE_BYTES,
    logger = console,
    redact = message => message,
}) {
    if (typeof apiKey !== 'string' || apiKey.trim() === '') {
        return { content: null, error: 'missing api key', finishReason: null };
    }

    const requestBody = {
        model: GROQ_MODEL,
        messages,
        temperature,
        // `max_tokens` ist bei Groq zugunsten von `max_completion_tokens`
        // veraltet.
        max_completion_tokens: maxTokens + GROQ_REASONING_RESERVE_TOKENS,
        reasoning_effort: GROQ_REASONING_EFFORT,
        include_reasoning: false,
    };
    if (responseFormat !== null && responseFormat !== undefined) {
        // Unverändert durchgereicht: der Aufrufer besitzt das Schema, dieser
        // Client prüft es nicht.
        requestBody.response_format = responseFormat;
    }

    let response;
    try {
        response = await fetchImpl(GROQ_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (error) {
        const message = redact(describeError(error));
        logger.error?.(`   ❌ Groq request failed: ${message}`);
        return { content: null, error: message, finishReason: null };
    }

    if (!response?.ok) {
        // Der Fehlertext wird begrenzt gelesen: auch eine Fehlerantwort kann
        // beliebig gross sein.
        let detail = '';
        try {
            detail = (await readLimitedResponseText(response, maxBytes)).slice(0, MAX_PROVIDER_ERROR_CHARS);
        } catch {
            await response?.body?.cancel?.().catch(() => {});
        }
        const message = redact(`status ${response?.status}${detail ? `: ${detail}` : ''}`);
        logger.error?.(`   ❌ Groq API error: ${message}`);
        return { content: null, error: message, finishReason: null };
    }

    let rawBody;
    try {
        rawBody = await readLimitedResponseText(response, maxBytes);
    } catch (error) {
        await response.body?.cancel?.().catch(() => {});
        const message = error instanceof ResponseTooLargeError
            ? `response exceeds the ${maxBytes} byte limit`
            : redact(describeError(error));
        logger.error?.(`   ❌ Groq response could not be read: ${message}`);
        return { content: null, error: message, finishReason: null };
    }

    let payload;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        // Bewusst ohne den Rohtext: er stammt vom Provider und gehört nicht
        // unbesehen ins Log.
        logger.error?.('   ❌ Groq response is not valid JSON');
        return { content: null, error: 'invalid json', finishReason: null };
    }

    const choice = payload?.choices?.[0];
    const content = choice?.message?.content;
    // Nur ein Text zählt als Grund. Alles andere ist für den Aufrufer "unbekannt".
    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
    if (typeof content !== 'string' || content.trim() === '') {
        // Bei einem Reasoning-Modell ist ein im Denkweg verbrauchtes Limit der
        // naheliegende Grund für eine leere Antwort. Das soll im Protokoll als
        // solches erkennbar sein und nicht wie eine stumme Antwort aussehen.
        if (finishReason === 'length') {
            logger.error?.('   ❌ Groq response reached the token limit before an answer was produced');
            return { content: null, error: 'token limit reached', finishReason };
        }
        logger.error?.('   ❌ No content in Groq response');
        return { content: null, error: 'empty content', finishReason };
    }

    return { content, error: null, finishReason };
}

// Öffnender Markdown-Zaun samt Sprachkennung (`json`, `JSON` oder keine, auch mit
// Leerzeichen davor) und schließender Zaun. Beide sind am Rand des Textes
// verankert, damit Backticks im JSON selbst unangetastet bleiben. Der schließende
// Zaun ist bewusst kein Regex: Leerraum davor stört `JSON.parse` nicht, und ein
// Muster mit `\s*` liefe bei langen Leerzeichenfolgen mitten im Text quadratisch.
const OPENING_CODE_FENCE = /^```[ \t]*[A-Za-z0-9_+-]*[ \t]*\r?\n?/;
const CLOSING_CODE_FENCE = '```';

/**
 * Liest JSON aus einer Chat-Antwort und unterscheidet dabei "nicht lesbar" vom
 * JSON-Wert `null`, was `parseGroqJsonContent` bewusst gleich behandelt.
 *
 * @param {unknown} content
 * @returns {{ ok: boolean, value: unknown }}
 */
function readGroqJson(content) {
    if (typeof content !== 'string') return { ok: false, value: null };

    // `trim()` räumt auch Leerraum und BOM vor einem Zaun ab; erst danach wird
    // geprüft, ob der Text mit einem Zaun beginnt.
    let jsonString = content.trim();
    if (jsonString.startsWith('```')) {
        jsonString = jsonString.replace(OPENING_CODE_FENCE, '');
        if (jsonString.endsWith(CLOSING_CODE_FENCE)) {
            jsonString = jsonString.slice(0, -CLOSING_CODE_FENCE.length);
        }
    }

    try {
        return { ok: true, value: JSON.parse(jsonString) };
    } catch {
        return { ok: false, value: null };
    }
}

/**
 * Liest das von Groq erwartete JSON aus einer Chat-Antwort.
 *
 * Das Modell verpackt sein JSON gelegentlich in einen Markdown-Block; das wird
 * abgeräumt, wenn der Zaun den Text umschließt. Text vor oder nach dem Zaun wird
 * nicht herausgesucht: Mit einem strikten Antwortschema kommt das JSON ohnehin
 * unverpackt. Alles Ungültige endet als `null`, nicht als Ausnahme.
 *
 * @param {string} content
 * @returns {unknown|null}
 */
export function parseGroqJsonContent(content) {
    return readGroqJson(content).value;
}

// Die Beschreibung einer fehlgeschlagenen Antwort soll deren Form zeigen und
// nichts von ihrem Inhalt. Namen kommen vom Modell und tauchen deshalb nur auf,
// wenn sie kurz und bezeichnerartig sind - Titel enthalten Leerzeichen.
const MAX_DESCRIBED_KEYS = 5;
const MAX_DESCRIBED_NAME_LENGTH = 32;
const PLAIN_NAME = /^[A-Za-z0-9_.-]+$/;

function plainName(value) {
    return typeof value === 'string'
        && value.length <= MAX_DESCRIBED_NAME_LENGTH
        && PLAIN_NAME.test(value)
        ? value
        : '?';
}

/**
 * Beschreibt die Form einer Groq-Antwort in einer Zeile - ausdrücklich ohne
 * ihren Inhalt, ohne Titel und ohne Zusammenfassungen.
 *
 * Gemeldet werden: Länge des Inhalts, `finish_reason`, Typ der obersten Ebene
 * (`array`, `object`, `string`, `number`, `boolean`, `null` oder `unparsable`)
 * und bei einem Objekt höchstens die ersten fünf Schlüsselnamen, soweit sie kurz
 * und bezeichnerartig sind (sonst `?`). So zeigt der nächste fehlgeschlagene Lauf,
 * ob ein Objekt statt eines Arrays kam, ob die Antwort abgeschnitten war oder ob
 * gar kein JSON ankam.
 *
 * @param {{ content: unknown, finishReason?: string|null }} shape
 * @returns {string}
 */
export function describeGroqResponseShape({ content, finishReason = null } = {}) {
    const { ok, value } = readGroqJson(content);

    let topLevel;
    if (!ok) topLevel = 'unparsable';
    else if (value === null) topLevel = 'null';
    else if (Array.isArray(value)) topLevel = 'array';
    else topLevel = typeof value;

    const parts = [
        `length=${typeof content === 'string' ? content.length : 0}`,
        `finish_reason=${typeof finishReason === 'string' ? plainName(finishReason) : 'unknown'}`,
        `top_level=${topLevel}`,
    ];

    if (topLevel === 'object') {
        const names = Object.keys(value);
        const shown = names.slice(0, MAX_DESCRIBED_KEYS).map(plainName);
        const more = names.length - shown.length;
        parts.push(`keys=${shown.length === 0 ? '(none)' : shown.join(',')}${more > 0 ? ` (+${more} more)` : ''}`);
    }

    return parts.join(' ');
}
