// Begrenztes Lesen von HTTP-Antworten (Roadmap-Paket O2a).
//
// Jede Stelle, die eine fremde Antwort in den Speicher liest, braucht dieselbe
// Grenze: Feed-XML, gescrapte Artikelseiten und Groq-Antworten. Die Logik liegt
// deshalb hier und nicht dreimal nebeneinander.
//
// Wichtig ist der Fall **ohne** `Content-Length`: ein Server kann beliebig lange
// streamen. Die Zaehlung laeuft deshalb ueber die tatsaechlich gelesenen Bytes
// und bricht den Stream ab, sobald das Limit ueberschritten ist.

export class ResponseTooLargeError extends Error {
    constructor(maxBytes) {
        super(`response exceeds the ${maxBytes} byte limit`);
        this.name = 'ResponseTooLargeError';
        this.maxBytes = maxBytes;
    }
}

/**
 * Liest den Antworttext und bricht ab, sobald `maxBytes` ueberschritten sind.
 *
 * Geprueft wird zweistufig:
 *
 * 1. `Content-Length`, falls vorhanden – dann muss gar nicht erst gelesen
 *    werden;
 * 2. die real gelesenen Bytes waehrend des Streamens – das greift auch bei
 *    `Transfer-Encoding: chunked` und bei falsch gesetzter `Content-Length`.
 *
 * Bei Ueberschreitung wird der Stream ueber `reader.cancel()` geschlossen,
 * damit die Verbindung nicht offen bleibt und weiter Daten zieht.
 *
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<string>}
 * @throws {ResponseTooLargeError}
 */
export async function readLimitedResponseText(response, maxBytes) {
    const contentLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        await response.body?.cancel?.().catch(() => {});
        throw new ResponseTooLargeError(maxBytes);
    }

    // Attrappen und einige Runtimes liefern keinen Stream; dann bleibt nur, den
    // fertigen Text zu messen.
    if (!response.body || typeof response.body.getReader !== 'function') {
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > maxBytes) {
            throw new ResponseTooLargeError(maxBytes);
        }
        return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let text = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
                await reader.cancel();
                throw new ResponseTooLargeError(maxBytes);
            }
            text += decoder.decode(value, { stream: true });
        }

        return text + decoder.decode();
    } finally {
        reader.releaseLock();
    }
}
