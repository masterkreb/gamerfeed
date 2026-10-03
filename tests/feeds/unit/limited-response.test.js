import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import {
    ResponseTooLargeError,
    readLimitedResponseText,
} from '../../../scripts/limited-response.js';

const encoder = new TextEncoder();

/**
 * Antwort mit echtem Stream; `chunks` wird stückweise ausgeliefert. Ein Chunk
 * ist Text oder, um ein Zeichen mitten durchzuschneiden, fertige Bytes.
 */
function streamingResponse(chunks, { headers = {} } = {}) {
    let cancelled = false;
    let index = 0;

    const body = {
        getReader() {
            return {
                async read() {
                    if (index >= chunks.length) return { done: true, value: undefined };
                    const chunk = chunks[index++];
                    return {
                        done: false,
                        value: typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
                    };
                },
                async cancel() {
                    cancelled = true;
                },
                releaseLock() {},
            };
        },
    };

    return {
        response: {
            body,
            headers: { get: name => headers[name.toLowerCase()] ?? null },
            async text() {
                throw new Error('text() darf bei einem Stream nicht verwendet werden');
            },
        },
        wasCancelled: () => cancelled,
        readChunks: () => index,
    };
}

/** Antwort ohne Stream – etwa aus einer Attrappe. */
function bufferedResponse(text, { headers = {} } = {}) {
    return {
        body: null,
        headers: { get: name => headers[name.toLowerCase()] ?? null },
        async text() {
            return text;
        },
    };
}

test('liest eine Antwort innerhalb des Limits vollständig', async () => {
    const { response } = streamingResponse(['Hallo ', 'Welt']);

    assert.equal(await readLimitedResponseText(response, 1000), 'Hallo Welt');
});

test('lehnt eine zu große Content-Length ab, ohne zu lesen', async () => {
    const { response, readChunks } = streamingResponse(['egal'], {
        headers: { 'content-length': '5000' },
    });

    await assert.rejects(
        () => readLimitedResponseText(response, 1000),
        ResponseTooLargeError,
    );
    assert.equal(readChunks(), 0, 'der Rumpf wird gar nicht erst gelesen');
});

test('eine passende Content-Length wird gelesen', async () => {
    const { response } = streamingResponse(['kurz'], { headers: { 'content-length': '4' } });

    assert.equal(await readLimitedResponseText(response, 1000), 'kurz');
});

test('ein Stream ohne Content-Length wird beim Byte-Limit beendet', async () => {
    // Der gefährliche Fall: ohne Content-Length könnte ein Server endlos senden.
    const { response, wasCancelled, readChunks } = streamingResponse([
        'x'.repeat(40),
        'y'.repeat(40),
        'z'.repeat(40),
        'niemals'.repeat(1000),
    ]);

    await assert.rejects(
        () => readLimitedResponseText(response, 100),
        ResponseTooLargeError,
    );
    assert.equal(wasCancelled(), true, 'der Stream wird geschlossen');
    assert.equal(readChunks(), 3, 'nach der Überschreitung wird nicht weitergelesen');
});

test('genau auf dem Limit wird noch gelesen', async () => {
    const { response } = streamingResponse(['x'.repeat(100)]);

    assert.equal((await readLimitedResponseText(response, 100)).length, 100);
});

test('ein Byte über dem Limit wird abgelehnt', async () => {
    const { response } = streamingResponse(['x'.repeat(101)]);

    await assert.rejects(() => readLimitedResponseText(response, 100), ResponseTooLargeError);
});

test('zählt Bytes, nicht Zeichen', async () => {
    // Vier Zeichen, aber zwölf Bytes in UTF-8.
    const { response } = streamingResponse(['🎮🎮🎮']);

    await assert.rejects(() => readLimitedResponseText(response, 8), ResponseTooLargeError);
    assert.equal(await readLimitedResponseText(streamingResponse(['🎮🎮🎮']).response, 12), '🎮🎮🎮');
});

test('mehrbytige Zeichen über Chunk-Grenzen bleiben heil', async () => {
    const bytes = encoder.encode('äöü');
    const chunks = [bytes.slice(0, 3), bytes.slice(3)];
    let index = 0;

    const response = {
        body: {
            getReader: () => ({
                async read() {
                    if (index >= chunks.length) return { done: true, value: undefined };
                    return { done: false, value: chunks[index++] };
                },
                async cancel() {},
                releaseLock() {},
            }),
        },
        headers: { get: () => null },
    };

    assert.equal(await readLimitedResponseText(response, 100), 'äöü');
});

test('eine Antwort ohne Stream wird nach dem Lesen gemessen', async () => {
    assert.equal(await readLimitedResponseText(bufferedResponse('kurz'), 100), 'kurz');

    await assert.rejects(
        () => readLimitedResponseText(bufferedResponse('x'.repeat(200)), 100),
        ResponseTooLargeError,
    );
});

test('der Fehler nennt das überschrittene Limit', async () => {
    await assert.rejects(
        () => readLimitedResponseText(bufferedResponse('x'.repeat(200)), 100),
        error => {
            assert.equal(error.name, 'ResponseTooLargeError');
            assert.equal(error.maxBytes, 100);
            assert.match(error.message, /100 byte limit/);
            return true;
        },
    );
});

// === Teiltext bei Überschreitung (keepPartialText) ===
//
// Manche Aufrufer brauchen nur den Anfang einer Antwort, etwa die Meta-Tags im
// <head> einer Artikelseite. Für alle anderen ändert sich nichts.

/** Der längste Anfang von `text`, dessen UTF-8-Kodierung höchstens `grenze` Bytes umfasst. */
function laengsterAnfang(text, grenze) {
    let bytes = 0;
    let anfang = '';
    for (const zeichen of text) {
        const groesse = encoder.encode(zeichen).byteLength;
        if (bytes + groesse > grenze) break;
        bytes += groesse;
        anfang += zeichen;
    }
    return anfang;
}

/** Zerlegt Bytes in Chunks fester Größe - auch mitten durch ein Zeichen. */
function inChunks(bytes, groesse) {
    const chunks = [];
    for (let start = 0; start < bytes.byteLength; start += groesse) {
        chunks.push(bytes.slice(start, start + groesse));
    }
    return chunks;
}

test('ohne Option trägt der Fehler keinen Teiltext', async () => {
    const { response } = streamingResponse(['x'.repeat(60), 'y'.repeat(60)]);

    await assert.rejects(
        () => readLimitedResponseText(response, 100),
        error => {
            assert.ok(error instanceof ResponseTooLargeError);
            assert.equal(error.partialText, null);
            return true;
        },
    );
});

test('mit keepPartialText trägt der Fehler den bis zur Grenze gelesenen Anfang', async () => {
    const { response, wasCancelled, readChunks } = streamingResponse(['abc', 'def', 'ghi']);

    await assert.rejects(
        () => readLimitedResponseText(response, 5, { keepPartialText: true }),
        error => {
            assert.ok(error instanceof ResponseTooLargeError);
            assert.equal(error.partialText, 'abcde', 'genau die ersten fünf Bytes');
            assert.equal(error.maxBytes, 5);
            assert.match(error.message, /5 byte limit/);
            return true;
        },
    );
    assert.equal(wasCancelled(), true, 'der Stream wird geschlossen');
    assert.equal(readChunks(), 2, 'nach der Überschreitung wird nicht weitergelesen');
});

test('der Teiltext gelangt weder in die aufzählbaren Eigenschaften noch ins Log', async () => {
    const { response } = streamingResponse(['geheimer Seiteninhalt']);
    const error = await readLimitedResponseText(response, 6, { keepPartialText: true })
        .then(() => null, caught => caught);

    assert.equal(error.partialText, 'geheim');
    assert.ok(!Object.keys(error).includes('partialText'));
    assert.doesNotMatch(JSON.stringify(error), /geheim/);
    assert.doesNotMatch(inspect(error), /geheim/);
});

test('der Teiltext ist nie länger als die Grenze und endet nie mit einem halben Zeichen', async () => {
    // Ein-, zwei-, drei- und vierbyteige Zeichen, damit jede Grenze irgendwo
    // mitten in eines fällt - bei jeder Chunk-Teilung, auch byteweise.
    const text = 'aä€🎮z'.repeat(4) + 'Ende';
    const bytes = encoder.encode(text);

    for (let grenze = 0; grenze <= bytes.byteLength + 1; grenze += 1) {
        for (const groesse of [1, 2, 3, 5, 7, bytes.byteLength]) {
            const { response } = streamingResponse(inChunks(bytes, groesse));
            const fall = `Grenze ${grenze}, Chunkgröße ${groesse}`;
            const ergebnis = await readLimitedResponseText(response, grenze, { keepPartialText: true })
                .then(gelesen => ({ gelesen }), error => ({ error }));

            if (grenze >= bytes.byteLength) {
                assert.equal(ergebnis.gelesen, text, `${fall}: innerhalb der Grenze wird alles gelesen`);
                continue;
            }

            assert.ok(ergebnis.error instanceof ResponseTooLargeError, fall);
            const teil = ergebnis.error.partialText;
            assert.ok(encoder.encode(teil).byteLength <= grenze, `${fall}: höchstens die Grenze`);
            assert.equal(teil, laengsterAnfang(text, grenze), `${fall}: der längste vollständige Anfang`);
            assert.ok(!teil.includes('\uFFFD'), `${fall}: kein Ersatzzeichen am Ende`);
        }
    }
});

test('ein am Limit zerschnittenes Zeichen fällt weg, statt zu werfen oder ein Ersatzzeichen zu erzeugen', async () => {
    // Drei Spielcontroller sind zwölf Bytes; bei sechs liegt die Grenze mitten im zweiten.
    const { response } = streamingResponse(['🎮🎮🎮']);

    await assert.rejects(
        () => readLimitedResponseText(response, 6, { keepPartialText: true }),
        error => {
            assert.equal(error.partialText, '🎮');
            return true;
        },
    );
});

test('ein Zeichen über eine Chunk-Grenze hinweg wird im Teiltext vollständig zusammengesetzt', async () => {
    const bytes = encoder.encode('a€b€c');
    // Die Chunk-Grenzen zerschneiden beide Euro-Zeichen: [a, E2 82] [AC, b, E2] [82 AC c].
    const { response } = streamingResponse([bytes.slice(0, 3), bytes.slice(3, 6), bytes.slice(6)]);

    await assert.rejects(
        // Die Grenze bei sechs Bytes lässt das zweite Euro-Zeichen unvollständig.
        () => readLimitedResponseText(response, 6, { keepPartialText: true }),
        error => {
            assert.equal(error.partialText, 'a€b');
            return true;
        },
    );
});

test('eine Antwort ohne Stream liefert den Teiltext ebenfalls', async () => {
    await assert.rejects(
        // Sieben Bytes sind "äöü" plus das erste Byte des nächsten ä, das wegfällt.
        () => readLimitedResponseText(bufferedResponse('äöü'.repeat(10)), 7, { keepPartialText: true }),
        error => {
            assert.equal(error.partialText, 'äöü');
            return true;
        },
    );

    await assert.rejects(
        () => readLimitedResponseText(bufferedResponse('äöü'.repeat(10)), 7),
        error => {
            assert.equal(error.partialText, null, 'ohne Option bleibt der Fehler ohne Text');
            return true;
        },
    );
});

test('eine vorab über Content-Length abgelehnte Antwort wird nicht gelesen und hat keinen Teiltext', async () => {
    const { response, readChunks } = streamingResponse(['egal'], {
        headers: { 'content-length': '5000' },
    });

    await assert.rejects(
        () => readLimitedResponseText(response, 1000, { keepPartialText: true }),
        error => {
            assert.ok(error instanceof ResponseTooLargeError);
            assert.equal(error.partialText, null);
            return true;
        },
    );
    assert.equal(readChunks(), 0, 'der Rumpf wird gar nicht erst gelesen');
});

test('innerhalb der Grenze ändert keepPartialText nichts', async () => {
    const option = { keepPartialText: true };

    assert.equal(await readLimitedResponseText(streamingResponse(['Hallo ', 'Welt']).response, 1000, option), 'Hallo Welt');
    assert.equal((await readLimitedResponseText(streamingResponse(['x'.repeat(100)]).response, 100, option)).length, 100);
    assert.equal(await readLimitedResponseText(bufferedResponse('kurz'), 100, option), 'kurz');
});
