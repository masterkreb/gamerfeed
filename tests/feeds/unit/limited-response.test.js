import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ResponseTooLargeError,
    readLimitedResponseText,
} from '../../../scripts/limited-response.js';

const encoder = new TextEncoder();

/** Antwort mit echtem Stream; `chunks` wird stückweise ausgeliefert. */
function streamingResponse(chunks, { headers = {} } = {}) {
    let cancelled = false;
    let index = 0;

    const body = {
        getReader() {
            return {
                async read() {
                    if (index >= chunks.length) return { done: true, value: undefined };
                    return { done: false, value: encoder.encode(chunks[index++]) };
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
