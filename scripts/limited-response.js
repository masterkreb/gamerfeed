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
    /**
     * @param {number} maxBytes
     * @param {string|null} [partialText] der bis zur Grenze gelesene Anfang;
     *   `null`, wenn er nicht angefordert wurde oder nichts gelesen ist
     */
    constructor(maxBytes, partialText = null) {
        super(`response exceeds the ${maxBytes} byte limit`);
        this.name = 'ResponseTooLargeError';
        this.maxBytes = maxBytes;
        // Bewusst nicht aufzaehlbar: der Text stammt von der Gegenstelle und
        // soll weder beim Ausgeben des Fehlers noch beim Serialisieren im Log
        // landen. Er ist nur fuer Aufrufer da, die ihn ausdruecklich auswerten.
        Object.defineProperty(this, 'partialText', { value: partialText });
    }
}

// Dekodiert hoechstens die ersten `limit` Bytes. Ein am Ende abgeschnittenes
// Zeichen faellt weg: `stream: true` gibt eine unvollstaendige Byte-Folge nie
// aus, auch nicht als Ersatzzeichen. Fehlerhafte Bytes werfen ebenfalls nicht,
// denn der Decoder ist nicht `fatal`.
function decodePrefix(bytes, limit) {
    return new TextDecoder().decode(bytes.subarray(0, limit), { stream: true });
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
 * Mit `keepPartialText` traegt der Fehler zusaetzlich den bis zur Grenze
 * gelesenen Anfang (`error.partialText`) – fuer Aufrufer, denen dieser Anfang
 * genuegt, etwa die Meta-Tags im `<head>` einer Artikelseite. Es wird dadurch
 * nichts zusaetzlich gelesen: Grenze und Bytezaehlung bleiben dieselben, der
 * Teiltext umfasst hoechstens `maxBytes` Bytes und endet nie mit einem halben
 * Zeichen. Eine vorab ueber `Content-Length` abgelehnte Antwort wurde gar nicht
 * gelesen; dort ist `partialText` `null`. Ohne die Option aendert sich fuer den
 * Aufrufer nichts.
 *
 * @param {Response} response
 * @param {number} maxBytes
 * @param {{ keepPartialText?: boolean }} [options]
 * @returns {Promise<string>}
 * @throws {ResponseTooLargeError}
 */
export async function readLimitedResponseText(response, maxBytes, { keepPartialText = false } = {}) {
    const contentLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        await response.body?.cancel?.().catch(() => {});
        throw new ResponseTooLargeError(maxBytes);
    }

    // Attrappen und einige Runtimes liefern keinen Stream; dann bleibt nur, den
    // fertigen Text zu messen.
    if (!response.body || typeof response.body.getReader !== 'function') {
        const text = await response.text();
        const bytes = new TextEncoder().encode(text);
        if (bytes.byteLength > maxBytes) {
            throw new ResponseTooLargeError(
                maxBytes,
                keepPartialText ? decodePrefix(bytes, maxBytes) : null,
            );
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
                // So viele Bytes dieses Chunks passen noch unter die Grenze.
                // Der laufende Decoder setzt ein Zeichen fort, das an der
                // Chunk-Grenze begonnen hat; ein am Limit zerschnittenes bleibt
                // ungelesen im Decoder und faellt weg.
                const partialText = keepPartialText
                    ? text + decoder.decode(
                        value.subarray(0, maxBytes - (totalBytes - value.byteLength)),
                        { stream: true },
                    )
                    : null;
                await reader.cancel();
                throw new ResponseTooLargeError(maxBytes, partialText);
            }
            text += decoder.decode(value, { stream: true });
        }

        return text + decoder.decode();
    } finally {
        reader.releaseLock();
    }
}
