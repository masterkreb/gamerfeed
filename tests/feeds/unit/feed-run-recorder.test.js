import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedRunRecorder } from '../../../scripts/feed-run-recorder.js';
import {
    FEED_STALE_AFTER_MS,
    buildFreshnessReport,
} from '../../../shared/feed-health-model.js';

const STARTED_AT = new Date('2026-07-28T11:00:00.000Z');

// Die Uhr wird schrittweise vorgestellt, damit die Reihenfolge der Schreib-
// vorgänge sichtbar wird, ohne real zu warten.
function createClock(start = STARTED_AT) {
    let current = start.getTime();
    return {
        now: () => new Date(current),
        advance(ms) {
            current += ms;
            return new Date(current);
        },
    };
}

function createStore({ initial = {}, failGet = [], failSet = [] } = {}) {
    const values = { ...initial };
    const writes = [];
    const reads = [];
    const failGetKeys = new Set(failGet);
    const failSetKeys = new Set(failSet);

    return {
        values,
        writes,
        reads,
        writtenKeys: () => writes.map(write => write.key),
        lastWrite(key) {
            const matching = writes.filter(write => write.key === key);
            return matching.length === 0 ? undefined : matching[matching.length - 1].value;
        },
        store: {
            async get(key) {
                reads.push(key);
                if (failGetKeys.has(key)) throw new Error(`get ${key} nicht möglich`);
                return Object.hasOwn(values, key) ? values[key] : null;
            },
            async set(key, value) {
                if (failSetKeys.has(key)) throw new Error(`set ${key} nicht möglich`);
                writes.push({ key, value });
                values[key] = value;
                return 'OK';
            },
        },
    };
}

function silentLogger() {
    const warnings = [];
    return { warnings, logger: { log() {}, warn: message => warnings.push(message) } };
}

function storedHealth(lastSuccessAt) {
    return {
        gamestar: {
            status: 'success',
            message: 'Successfully fetched and parsed 12 articles.',
            lastAttemptAt: lastSuccessAt,
            lastSuccessAt,
            durationMs: 900,
            articleCount: 12,
        },
    };
}

function storedPublish(at) {
    return {
        schemaVersion: 1,
        runId: 'gha-alt-1',
        lastCorePublishAt: at,
        lastContentUpdateAt: at,
        newestArticleAt: at,
        articleCount: 1000,
        feeds: { total: 1, success: 1, warning: 0, error: 0, unknown: 0 },
        durations: {},
    };
}

function failedFeedHealth(attemptAt, lastSuccessAt) {
    return {
        gamestar: {
            status: 'error',
            message: 'Fetch failed. Error: timeout',
            lastAttemptAt: attemptAt,
            lastSuccessAt,
            durationMs: 15000,
            articleCount: null,
        },
    };
}

function successfulFeedHealth(attemptAt) {
    return {
        gamestar: {
            status: 'success',
            message: 'Successfully fetched and parsed 9 articles.',
            lastAttemptAt: attemptAt,
            lastSuccessAt: attemptAt,
            durationMs: 1100,
            articleCount: 9,
        },
    };
}

function createRecorder(storeHarness, clock, logger = silentLogger().logger) {
    return createFeedRunRecorder({
        store: storeHarness.store,
        runId: 'gha-4711-1',
        startedAt: STARTED_AT,
        now: clock.now,
        logger,
    });
}

// === Punkt 1: Der Versuch bleibt running, bis alle Phasen durch sind ===

test('schreibt die Heartbeat-Schlüssel in der erwarteten Reihenfolge', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
    });
    const clock = createClock();
    const recorder = createRecorder(harness, clock);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(120_000);
    await recorder.recordCorePublish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        articleCount: 1200,
        newestArticleAt: '2026-07-28T10:58:00.000Z',
        durations: { feedFetchMs: 60_000, publishMs: 800 },
    });
    clock.advance(30_000);
    await recorder.finish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        durations: { totalMs: 150_000 },
    });

    assert.deepEqual(harness.writtenKeys(), [
        'feed_run_status',
        'feed_health_status',
        'feed_publish_status',
        'feed_run_status',
        'feed_run_status',
    ]);
});

test('der Versuch bleibt nach dem Kern-Publish running, bis der Lauf endet', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
    });
    const clock = createClock();
    const recorder = createRecorder(harness, clock);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(120_000);
    await recorder.recordCorePublish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        articleCount: 1200,
        newestArticleAt: '2026-07-28T10:58:00.000Z',
        durations: { publishMs: 800 },
    });

    const afterPublish = harness.lastWrite('feed_run_status');
    assert.equal(afterPublish.result, 'running', 'die Trendphase läuft noch');
    assert.equal(afterPublish.finishedAt, null);
    assert.equal(afterPublish.durations.publishMs, 800, 'Zwischenstand wird trotzdem festgehalten');

    // Der Kern-Publish ist dagegen bereits verbucht.
    assert.equal(
        harness.lastWrite('feed_publish_status').lastCorePublishAt,
        '2026-07-28T11:02:00.000Z',
    );

    clock.advance(30_000);
    await recorder.finish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        durations: { totalMs: 150_000 },
    });

    const finished = harness.lastWrite('feed_run_status');
    assert.equal(finished.result, 'success');
    assert.equal(finished.finishedAt, '2026-07-28T11:02:30.000Z');
});

test('ein Abbruch in der Trendphase bleibt als hängender Lauf erkennbar', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
    });
    const clock = createClock();
    const recorder = createRecorder(harness, clock);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(120_000);
    await recorder.recordCorePublish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        articleCount: 1200,
        newestArticleAt: '2026-07-28T10:58:00.000Z',
        durations: { publishMs: 800 },
    });
    // Danach passiert nichts mehr: der Prozess wurde in der Trendphase getötet.

    const hangingRun = harness.lastWrite('feed_run_status');
    assert.equal(hangingRun.result, 'running');
    assert.equal(hangingRun.finishedAt, null);

    const report = buildFreshnessReport({
        run: hangingRun,
        publish: harness.lastWrite('feed_publish_status'),
        now: new Date(STARTED_AT.getTime() + FEED_STALE_AFTER_MS + 60_000),
    });

    assert.equal(report.run.result, 'running', 'nicht als sauber beendet ausgewiesen');
    assert.equal(report.run.isStale, true, 'am startedAt gemessen und damit veraltet');
});

// === Punkt 2: Lesefehler löschen keine historischen Werte ===

test('ein Lesefehler beim Feed-Status verhindert das Überschreiben von lastSuccessAt', async () => {
    const previousSuccess = '2026-07-28T10:40:00.000Z';
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth(previousSuccess),
            feed_publish_status: storedPublish(previousSuccess),
        },
        failGet: ['feed_health_status'],
    });
    const clock = createClock();
    const { logger, warnings } = silentLogger();
    const recorder = createRecorder(harness, clock, logger);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(120_000);
    await recorder.recordCorePublish({
        feedHealth: failedFeedHealth('2026-07-28T11:01:00.000Z', null),
        articleCount: 1000,
        newestArticleAt: previousSuccess,
        durations: {},
    });

    assert.ok(
        !harness.writtenKeys().includes('feed_health_status'),
        'der Feed-Status wird gar nicht erst geschrieben',
    );
    assert.equal(
        harness.values.feed_health_status.gamestar.lastSuccessAt,
        previousSuccess,
        'der gespeicherte Wert bleibt unverändert',
    );
    assert.ok(warnings.some(message => message.includes('bisherige Stand ist unbekannt')));
});

test('die beiden Reads sind unabhängig: ein kaputter Feed-Status blockiert den Publish nicht', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
        failGet: ['feed_health_status'],
    });
    const clock = createClock();
    const recorder = createRecorder(harness, clock);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(120_000);
    await recorder.recordCorePublish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        articleCount: 1200,
        newestArticleAt: '2026-07-28T10:58:00.000Z',
        durations: {},
    });

    assert.deepEqual(harness.reads.sort(), ['feed_health_status', 'feed_publish_status']);
    assert.equal(harness.lastWrite('feed_publish_status').lastCorePublishAt, '2026-07-28T11:02:00.000Z');
});

test('ohne gelesenen Kern-Publish und ohne Artikel wird nichts fortgeschrieben', async () => {
    const previous = '2026-07-28T10:40:00.000Z';
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth(previous),
            feed_publish_status: storedPublish(previous),
        },
        failGet: ['feed_publish_status'],
    });
    const clock = createClock();
    const { logger, warnings } = silentLogger();
    const recorder = createRecorder(harness, clock, logger);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(120_000);
    const publish = await recorder.recordCorePublish({
        feedHealth: failedFeedHealth('2026-07-28T11:01:00.000Z', previous),
        articleCount: 1000,
        newestArticleAt: previous,
        durations: {},
    });

    assert.equal(publish, null);
    assert.ok(!harness.writtenKeys().includes('feed_publish_status'));
    assert.equal(harness.values.feed_publish_status.lastContentUpdateAt, previous);
    assert.ok(warnings.some(message => message.includes('bisherige Stand ist unbekannt')));

    // Der Feed-Status durfte gelesen werden und wird deshalb geschrieben.
    assert.ok(harness.writtenKeys().includes('feed_health_status'));
});

test('ohne gelesenen Kern-Publish, aber mit Artikeln, ist der neue Stand vollständig bekannt', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
        failGet: ['feed_publish_status'],
    });
    const clock = createClock();
    const recorder = createRecorder(harness, clock);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(120_000);
    const publish = await recorder.recordCorePublish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        articleCount: 1200,
        newestArticleAt: '2026-07-28T10:58:00.000Z',
        durations: {},
    });

    assert.equal(publish.lastCorePublishAt, '2026-07-28T11:02:00.000Z');
    assert.equal(publish.lastContentUpdateAt, '2026-07-28T11:02:00.000Z');
});

// === Punkt 3: Abbruch vor der Feed-Liste gegen tatsächlich leere Liste ===

test('ein Fatalabbruch vor der Feed-Liste bewahrt den gespeicherten Feed-Status', async () => {
    const previous = '2026-07-28T10:40:00.000Z';
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth(previous),
            feed_publish_status: storedPublish(previous),
        },
    });
    const clock = createClock();
    const recorder = createRecorder(harness, clock);

    await recorder.begin();
    await recorder.loadPreviousState();
    // markFeedListLoaded() bleibt bewusst aus: der Abbruch passiert davor.
    clock.advance(5_000);
    await recorder.recordFatal({
        error: new Error('Existing cache data from KV is corrupted'),
        feedHealth: {},
        durations: {},
    });

    assert.ok(!harness.writtenKeys().includes('feed_health_status'));
    assert.ok(!harness.writtenKeys().includes('feed_publish_status'));
    assert.deepEqual(harness.values.feed_health_status, storedHealth(previous));
    assert.equal(harness.values.feed_publish_status.lastCorePublishAt, previous);

    const run = harness.lastWrite('feed_run_status');
    assert.equal(run.result, 'fatal');
    assert.equal(run.fatalError, 'Existing cache data from KV is corrupted');
    assert.equal(run.finishedAt, '2026-07-28T11:00:05.000Z');
});

test('eine geladene, aber leere Feed-Liste entfernt gelöschte Feeds', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
    });
    const clock = createClock();
    const recorder = createRecorder(harness, clock);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(3_000);
    const written = await recorder.saveFeedHealth({});

    assert.deepEqual(written, {});
    assert.deepEqual(harness.values.feed_health_status, {});
});

test('ein Fatalabbruch nach der Feed-Liste schreibt den Status und bewahrt lastSuccessAt', async () => {
    const previous = '2026-07-28T10:40:00.000Z';
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth(previous),
            feed_publish_status: storedPublish(previous),
        },
    });
    const clock = createClock();
    const recorder = createRecorder(harness, clock);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(60_000);
    await recorder.recordFatal({
        error: new Error('KV nicht erreichbar'),
        feedHealth: failedFeedHealth('2026-07-28T11:00:45.000Z', null),
        durations: { feedFetchMs: 40_000 },
    });

    const health = harness.values.feed_health_status;
    assert.equal(health.gamestar.status, 'error');
    assert.equal(health.gamestar.lastSuccessAt, previous, 'der alte Erfolg bleibt stehen');
    assert.ok(!harness.writtenKeys().includes('feed_publish_status'));
    assert.equal(harness.lastWrite('feed_run_status').result, 'fatal');
});

// === Robustheit der Schreibvorgänge ===

test('ein fehlgeschlagener Feed-Status-Write kann nie zu einem erfolgreichen Lauf werden', async () => {
    // feed_health_status gab es schon vor O1 und sein Schreibfehler war immer
    // fatal. Der Heartbeat darf daraus keinen gruenen Lauf machen.
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
        failSet: ['feed_health_status'],
    });
    const clock = createClock();
    const recorder = createRecorder(harness, clock);
    const feedHealth = successfulFeedHealth('2026-07-28T11:01:30.000Z');

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(120_000);

    // Derselbe Ablauf wie in scripts/fetch-feeds.js: Kern-Publish, dann finish,
    // und im Fehlerfall der Abbruchpfad.
    let caught = null;
    try {
        await recorder.recordCorePublish({
            feedHealth,
            articleCount: 1200,
            newestArticleAt: '2026-07-28T10:58:00.000Z',
            durations: {},
        });
        await recorder.finish({ feedHealth, durations: {} });
    } catch (error) {
        caught = error;
        await recorder.recordFatal({ error, feedHealth, durations: {} });
    }

    assert.ok(caught, 'der Schreibfehler wird weitergereicht');
    assert.match(caught.message, /set feed_health_status nicht möglich/);

    const runResults = harness.writes
        .filter(write => write.key === 'feed_run_status')
        .map(write => write.value.result);
    assert.ok(!runResults.includes('success'), `kein success im Verlauf: ${runResults.join(', ')}`);
    assert.equal(harness.lastWrite('feed_run_status').result, 'fatal');

    // Der Kern-Publish wurde nie verbucht, weil der Lauf davor abgebrochen ist.
    assert.ok(!harness.writtenKeys().includes('feed_publish_status'));
    assert.equal(harness.values.feed_publish_status.lastCorePublishAt, '2026-07-28T10:40:00.000Z');
});

test('recordFatal überdeckt den ursprünglichen Fehler nicht, wenn auch der Status-Write scheitert', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
        failSet: ['feed_health_status'],
    });
    const clock = createClock();
    const { logger, warnings } = silentLogger();
    const recorder = createRecorder(harness, clock, logger);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(60_000);

    await assert.doesNotReject(() => recorder.recordFatal({
        error: new Error('set feed_health_status nicht möglich'),
        feedHealth: failedFeedHealth('2026-07-28T11:00:45.000Z', null),
        durations: {},
    }));

    const failed = harness.lastWrite('feed_run_status');
    assert.equal(failed.result, 'fatal');
    assert.equal(failed.fatalError, 'set feed_health_status nicht möglich', 'der Originalfehler bleibt stehen');
    assert.ok(warnings.some(message => message.includes("Heartbeat 'feed_health_status'")));
});

test('ein fehlgeschlagener Heartbeat-Write bricht den Lauf nicht ab', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
        failSet: ['feed_run_status'],
    });
    const clock = createClock();
    const { logger, warnings } = silentLogger();
    const recorder = createRecorder(harness, clock, logger);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(120_000);
    const publish = await recorder.recordCorePublish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        articleCount: 1200,
        newestArticleAt: '2026-07-28T10:58:00.000Z',
        durations: {},
    });
    await recorder.finish({ feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'), durations: {} });

    assert.equal(publish.lastCorePublishAt, '2026-07-28T11:02:00.000Z');
    assert.ok(warnings.some(message => message.includes("Heartbeat 'feed_run_status'")));
});

test('Fehlermeldungen laufen vor dem Speichern durch die Bereinigung', async () => {
    const harness = createStore({ initial: { feed_health_status: {}, feed_publish_status: null } });
    const clock = createClock();
    const recorder = createFeedRunRecorder({
        store: harness.store,
        runId: 'gha-4711-1',
        startedAt: STARTED_AT,
        now: clock.now,
        logger: silentLogger().logger,
        redact: message => message.replace('supersecret', '[redacted]'),
    });

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    await recorder.recordFatal({
        error: new Error('connect failed for supersecret'),
        feedHealth: {},
        durations: {},
    });

    assert.equal(harness.lastWrite('feed_run_status').fatalError, 'connect failed for [redacted]');
});

// === Ergebniszustand des abgeschlossenen Laufs (O2b) ===

test('ein degradierter Lauf wird nicht als success gespeichert', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
    });
    const clock = createClock();
    const recorder = createRecorder(harness, clock);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(120_000);
    await recorder.recordCorePublish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        articleCount: 1200,
        newestArticleAt: '2026-07-28T10:58:00.000Z',
        durations: { publishMs: 800 },
    });
    clock.advance(30_000);
    await recorder.finish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        durations: { totalMs: 150_000 },
        result: 'degraded',
        degradedReason: 'Zeitbudget erschöpft: 2 Quelle(n) zurückgestellt',
    });

    const finished = harness.lastWrite('feed_run_status');
    assert.equal(finished.result, 'degraded');
    assert.match(finished.degradedReason, /2 Quelle/);
    // Der Kern-Publish hat trotzdem stattgefunden - das ist der Unterschied zu
    // `fatal`.
    assert.equal(
        harness.lastWrite('feed_publish_status').lastCorePublishAt,
        '2026-07-28T11:02:00.000Z',
    );
});

test('ein unbekannter Ergebniswert wird abgelehnt, nicht zu success gemacht', async () => {
    // Fail-closed: „ich kenne den Zustand dieses Laufs nicht" darf niemals zu
    // „vollständig abgeschlossen" werden. Der Aufrufer landet stattdessen in
    // seinem Abbruchpfad.
    // `undefined` steht bewusst nicht in der Liste: es greift die Vorgabe
    // `success`, und die ist der Normalfall - siehe den Test darunter.
    for (const wert of ['irgendwas', 'running', 'fatal', '', null, 42, {}]) {
        const harness = createStore({
            initial: {
                feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
                feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
            },
        });
        const clock = createClock();
        const recorder = createRecorder(harness, clock);

        await recorder.begin();
        await recorder.loadPreviousState();
        recorder.markFeedListLoaded();

        await assert.rejects(
            () => recorder.finish({
                feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
                durations: {},
                result: wert,
            }),
            /Unbekannter Ergebniszustand/,
            `${String(wert)}: wird abgelehnt`,
        );

        assert.notEqual(
            harness.lastWrite('feed_run_status').result,
            'success',
            `${String(wert)}: kein success im Heartbeat`,
        );
    }
});

test('ohne Angabe bleibt der Abschluss success', async () => {
    // Die Vorgabe ist der Normalfall und darf von der Ablehnung nicht
    // mitgerissen werden.
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
    });
    const clock = createClock();
    const recorder = createRecorder(harness, clock);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    await recorder.finish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        durations: {},
    });

    assert.equal(harness.lastWrite('feed_run_status').result, 'success');
});

test('die Ablehnung nennt den unbrauchbaren Wert nicht', async () => {
    // Die Meldung läuft über den Abbruchpfad in den Heartbeat. Was hier
    // ankommt, ist nicht zwingend eine harmlose Konstante.
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
    });
    const recorder = createRecorder(harness, createClock());

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();

    await assert.rejects(
        () => recorder.finish({
            feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
            durations: {},
            result: 'kv-token-geheim',
        }),
        error => {
            assert.doesNotMatch(error.message, /kv-token-geheim/);
            return true;
        },
    );
});
