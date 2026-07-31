import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedRunRecorder } from '../../../scripts/feed-run-recorder.js';
import {
    FEED_STALE_AFTER_MS,
    buildFreshnessReport,
} from '../../../shared/feed-health-model.js';
import { FEED_RUN_HISTORY_KEY } from '../../../shared/feed-run-history.js';

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

function createStore({ initial = {}, failGet = [], failSet = [], failHistory = false } = {}) {
    const values = { ...initial };
    const writes = [];
    const reads = [];
    // O4b: jeder in den Sorted Set geschriebene Historieneintrag samt Score.
    const historyWrites = [];
    const failGetKeys = new Set(failGet);
    const failSetKeys = new Set(failSet);

    return {
        values,
        writes,
        reads,
        historyWrites,
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
            // Sorted Set der Laufhistorie. Nur so weit nachgebildet, wie der
            // Recorder ihn benutzt; das Kürzverhalten selbst prüft
            // tests/server/unit/feed-run-history-store.test.js.
            multi() {
                const commands = [];
                return {
                    zadd(key, { score, member }) {
                        commands.push({ command: 'zadd', key, score, member });
                        return this;
                    },
                    zremrangebyrank(key, start, stop) {
                        commands.push({ command: 'zremrangebyrank', key, start, stop });
                        return this;
                    },
                    async exec() {
                        if (failHistory) throw new Error('Historie kv-token-geheim abgelehnt');
                        for (const befehl of commands) {
                            if (befehl.command === 'zadd') {
                                historyWrites.push({ key: befehl.key, score: befehl.score, entry: befehl.member });
                            }
                        }
                        return commands.map(() => 1);
                    },
                };
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

function createRecorder(storeHarness, clock, logger = silentLogger().logger, overrides = {}) {
    return createFeedRunRecorder({
        store: storeHarness.store,
        runId: 'gha-4711-1',
        startedAt: STARTED_AT,
        now: clock.now,
        logger,
        ...overrides,
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

// === Punkt 5: Begrenzte Laufhistorie (O4b) ===
//
// Die Historie ist reine Beobachtbarkeit. Geprüft wird deshalb vor allem, wo
// **nicht** geschrieben wird und dass ihr Fehler folgenlos bleibt.

test('begin() und der Kern-Publish schreiben keinen Historieneintrag', async () => {
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

    assert.deepEqual(harness.historyWrites, [], 'ein laufender Versuch gehört nicht in die Historie');
});

test('ein erfolgreicher Abschluss ergibt genau einen Historieneintrag', async () => {
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
    clock.advance(150_000);
    await recorder.finish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        durations: { totalMs: 150_000 },
    });

    assert.equal(harness.historyWrites.length, 1);

    const [write] = harness.historyWrites;
    assert.equal(write.key, FEED_RUN_HISTORY_KEY);
    assert.equal(write.score, Date.parse(write.entry.finishedAt));
    assert.equal(write.entry.result, 'success');
    assert.equal(write.entry.runId, 'gha-4711-1');
    assert.equal(write.entry.startedAt, STARTED_AT.toISOString());
    assert.deepEqual(write.entry.feeds, { total: 1, success: 1, warning: 0, error: 0, unknown: 0 });
    assert.equal(write.entry.durations.totalMs, 150_000);
});

test('ein eingeschränkter Abschluss ergibt genau einen Historieneintrag mit Grund', async () => {
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
    clock.advance(150_000);
    await recorder.finish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        durations: { totalMs: 150_000 },
        result: 'degraded',
        degradedReason: 'Trendphase zurückgestellt',
    });

    assert.equal(harness.historyWrites.length, 1);
    assert.equal(harness.historyWrites[0].entry.result, 'degraded');
    assert.equal(harness.historyWrites[0].entry.degradedReason, 'Trendphase zurückgestellt');
    assert.equal(harness.historyWrites[0].entry.fatalError, null);
});

test('ein Abbruch ergibt genau einen Historieneintrag mit bereinigtem Fatalfehler', async () => {
    const harness = createStore({
        initial: { feed_health_status: storedHealth('2026-07-28T10:40:00.000Z') },
    });
    const clock = createClock();
    const recorder = createFeedRunRecorder({
        store: harness.store,
        runId: 'gha-4711-1',
        startedAt: STARTED_AT,
        now: clock.now,
        logger: silentLogger().logger,
        redact: message => message.split('kv-token-geheim').join('[redacted]'),
    });

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(45_000);
    await recorder.recordFatal({
        error: new Error('KV nicht erreichbar: kv-token-geheim unter https://kv.example/pipeline?token=geheim'),
        feedHealth: failedFeedHealth('2026-07-28T11:00:45.000Z', '2026-07-28T10:40:00.000Z'),
        durations: { totalMs: 45_000 },
    });

    assert.equal(harness.historyWrites.length, 1);

    const eintrag = harness.historyWrites[0].entry;
    assert.equal(eintrag.result, 'fatal');
    assert.equal(eintrag.degradedReason, null);
    assert.ok(!eintrag.fatalError.includes('kv-token-geheim'), 'kein Secret in der Historie');
    assert.ok(!eintrag.fatalError.includes('token=geheim'), 'kein Querystring in der Historie');
    assert.ok(eintrag.fatalError.includes('[redacted]'));
});

test('die Historie wird erst nach dem finalen Laufstatus geschrieben', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
    });
    const clock = createClock();
    const reihenfolge = [];
    const recorder = createRecorder(harness, clock, silentLogger().logger, {
        appendHistory: async () => {
            reihenfolge.push('history');
            return { ok: true, written: true, error: null };
        },
    });

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();

    const laufStatusSchreiben = harness.writes.length;
    clock.advance(150_000);
    await recorder.finish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        durations: { totalMs: 150_000 },
    });

    assert.equal(harness.writes[laufStatusSchreiben].key, 'feed_run_status');
    assert.equal(harness.lastWrite('feed_run_status').result, 'success');
    assert.deepEqual(reihenfolge, ['history']);
});

test('ein Fehler beim Schreiben der Historie verändert das Laufergebnis nicht', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
        failHistory: true,
    });
    const clock = createClock();
    const { logger, warnings } = silentLogger();
    const recorder = createRecorder(harness, clock, logger);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(150_000);

    const finished = await recorder.finish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        durations: { totalMs: 150_000 },
    });

    assert.equal(finished.result, 'success', 'der Lauf bleibt erfolgreich');
    assert.equal(harness.lastWrite('feed_run_status').result, 'success');
    assert.equal(harness.historyWrites.length, 0);
    assert.ok(warnings.some(message => message.includes('Laufhistorie konnte nicht ergänzt werden')));
});

test('ein werfender Historien-Adapter wird abgefangen und verändert nichts', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
    });
    const clock = createClock();
    const { logger, warnings } = silentLogger();
    const recorder = createRecorder(harness, clock, logger, {
        appendHistory: async () => {
            throw new Error('Sorted Set explodiert');
        },
    });

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(150_000);

    const finished = await recorder.finish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        durations: { totalMs: 150_000 },
    });

    assert.equal(finished.result, 'success');
    assert.ok(warnings.some(message => message.includes('Laufhistorie konnte nicht ergänzt werden')));
});

test('ein Historienfehler überdeckt einen Abbruch nicht und wirft nicht nach außen', async () => {
    const harness = createStore({
        initial: { feed_health_status: storedHealth('2026-07-28T10:40:00.000Z') },
        failHistory: true,
    });
    const clock = createClock();
    const { logger, warnings } = silentLogger();
    const recorder = createRecorder(harness, clock, logger);

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(45_000);

    const { run } = await recorder.recordFatal({
        error: new Error('SQL nicht erreichbar'),
        feedHealth: failedFeedHealth('2026-07-28T11:00:45.000Z', '2026-07-28T10:40:00.000Z'),
        durations: { totalMs: 45_000 },
    });

    assert.equal(run.result, 'fatal');
    assert.equal(harness.lastWrite('feed_run_status').result, 'fatal');
    assert.ok(warnings.some(message => message.includes('Laufhistorie konnte nicht ergänzt werden')));
});

test('die Warnung zu einem Historienfehler trägt kein Secret', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
        failHistory: true,
    });
    const clock = createClock();
    const { logger, warnings } = silentLogger();
    const recorder = createFeedRunRecorder({
        store: harness.store,
        runId: 'gha-4711-1',
        startedAt: STARTED_AT,
        now: clock.now,
        logger,
        redact: message => message.split('kv-token-geheim').join('[redacted]'),
    });

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(150_000);
    await recorder.finish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        durations: { totalMs: 150_000 },
    });

    const historienWarnungen = warnings.filter(message => message.includes('Laufhistorie'));
    assert.equal(historienWarnungen.length, 1);
    assert.ok(!historienWarnungen[0].includes('kv-token-geheim'));
});

test('ein abgelehnter Ergebniszustand hinterlässt keinen Historieneintrag', async () => {
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

    await assert.rejects(() => recorder.finish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        durations: {},
        result: 'irgendwas',
    }));

    assert.deepEqual(harness.historyWrites, []);
});

// === Der Historien-Write ist begrenzt, nicht nur folgenlos ===
//
// „Best effort“ heisst auch: ein Speicher, der gar nicht antwortet, haelt den
// Laufabschluss nicht auf. Kein Test wartet real - die Zeitgeber feuern auf
// Zuruf, der haengende Speicher ist ein nie aufgeloestes Promise.

function createTestTimers() {
    const angelegt = [];
    const abgeraeumt = [];

    return {
        angelegt,
        abgeraeumt,
        offene: () => angelegt.filter(eintrag => !abgeraeumt.includes(eintrag)),
        setTimer(callback, ms) {
            const eintrag = { callback, ms };
            angelegt.push(eintrag);
            return eintrag;
        },
        clearTimer(handle) {
            if (handle) abgeraeumt.push(handle);
        },
        ablaufen() {
            for (const eintrag of angelegt) eintrag.callback();
        },
    };
}

/**
 * Laesst die Microtask-Warteschlange durchlaufen, ohne real zu warten.
 *
 * Der Recorder schreibt vor dem Historien-Write noch `feed_run_status`; der
 * Zeitgeber der Frist entsteht deshalb erst einige Await-Schritte spaeter.
 */
async function abwickeln(runden = 8) {
    for (let index = 0; index < runden; index += 1) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

async function laufMitHaengenderHistorie(harness, clock, logger, timers) {
    let ablehnen;
    const haengend = new Promise((_resolve, reject) => {
        ablehnen = reject;
    });

    const recorder = createRecorder(harness, clock, logger, {
        appendHistory: () => haengend,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    });

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();
    clock.advance(150_000);

    return { recorder, ablehnen };
}

test('ein hängender Historien-Write hält finish() nicht auf', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
    });
    const clock = createClock();
    const { logger, warnings } = silentLogger();
    const timers = createTestTimers();

    const { recorder } = await laufMitHaengenderHistorie(harness, clock, logger, timers);

    const lauf = recorder.finish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        durations: { totalMs: 150_000 },
    });

    await abwickeln();

    // Der Laufstatus steht bereits; ohne Frist bliebe finish() hier für immer.
    assert.equal(harness.lastWrite('feed_run_status').result, 'success');
    assert.equal(timers.angelegt.length, 1);
    assert.equal(timers.angelegt[0].ms, 3000);

    timers.ablaufen();

    const finished = await lauf;

    assert.equal(finished.result, 'success', 'das Ergebnis bleibt unverändert');
    assert.equal(harness.historyWrites.length, 0);
    assert.deepEqual(timers.offene(), [], 'der Zeitgeber wird abgeräumt');
    assert.ok(warnings.some(message => message.includes('Laufhistorie konnte nicht ergänzt werden')));
    assert.ok(warnings.some(message => message.includes('Zeitgrenze')));
});

test('ein hängender Historien-Write hält recordFatal() nicht auf', async () => {
    const harness = createStore({
        initial: { feed_health_status: storedHealth('2026-07-28T10:40:00.000Z') },
    });
    const clock = createClock();
    const { logger, warnings } = silentLogger();
    const timers = createTestTimers();

    const { recorder } = await laufMitHaengenderHistorie(harness, clock, logger, timers);

    const lauf = recorder.recordFatal({
        error: new Error('SQL nicht erreichbar'),
        feedHealth: failedFeedHealth('2026-07-28T11:00:45.000Z', '2026-07-28T10:40:00.000Z'),
        durations: { totalMs: 150_000 },
    });

    await abwickeln();

    assert.equal(harness.lastWrite('feed_run_status').result, 'fatal');
    timers.ablaufen();

    const { run } = await lauf;

    assert.equal(run.result, 'fatal', 'der Abbruch bleibt ein Abbruch');
    assert.deepEqual(timers.offene(), []);
    assert.ok(warnings.some(message => message.includes('Laufhistorie konnte nicht ergänzt werden')));
});

test('eine verspätete Ablehnung des überholten Writes bleibt behandelt', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
    });
    const clock = createClock();
    const { logger } = silentLogger();
    const timers = createTestTimers();

    const unbehandelte = [];
    const beobachter = grund => unbehandelte.push(grund);
    process.on('unhandledRejection', beobachter);

    try {
        const { recorder, ablehnen } = await laufMitHaengenderHistorie(harness, clock, logger, timers);

        const lauf = recorder.finish({
            feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
            durations: { totalMs: 150_000 },
        });

        await abwickeln();
        timers.ablaufen();
        await lauf;

        // Der Speicher meldet sich erst jetzt - lange nachdem der Lauf fertig
        // ist. Das darf den Cron-Prozess nicht beenden.
        ablehnen(new Error('kv-token-geheim verspätet abgelehnt'));
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));

        assert.deepEqual(unbehandelte, []);
    } finally {
        process.off('unhandledRejection', beobachter);
    }
});

test('die Frist des Historien-Writes ist einstellbar', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
    });
    const clock = createClock();
    const timers = createTestTimers();
    let ablehnen;
    const haengend = new Promise((_resolve, reject) => {
        ablehnen = reject;
    });
    void ablehnen;

    const recorder = createRecorder(harness, clock, silentLogger().logger, {
        appendHistory: () => haengend,
        historyTimeoutMs: 500,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    });

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();

    const lauf = recorder.finish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        durations: { totalMs: 150_000 },
    });

    await abwickeln();

    assert.equal(timers.angelegt[0].ms, 500);
    timers.ablaufen();
    assert.equal((await lauf).result, 'success');
});

test('die Warnung zum Fristablauf trägt kein Secret', async () => {
    const harness = createStore({
        initial: {
            feed_health_status: storedHealth('2026-07-28T10:40:00.000Z'),
            feed_publish_status: storedPublish('2026-07-28T10:40:00.000Z'),
        },
    });
    const clock = createClock();
    const { logger, warnings } = silentLogger();
    const timers = createTestTimers();
    const haengend = new Promise(() => {});

    const recorder = createFeedRunRecorder({
        store: harness.store,
        runId: 'gha-4711-1',
        startedAt: STARTED_AT,
        now: clock.now,
        logger,
        redact: message => message.split('kv-token-geheim').join('[redacted]'),
        appendHistory: () => haengend,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    });

    await recorder.begin();
    await recorder.loadPreviousState();
    recorder.markFeedListLoaded();

    const lauf = recorder.finish({
        feedHealth: successfulFeedHealth('2026-07-28T11:01:30.000Z'),
        durations: { totalMs: 150_000 },
    });
    await abwickeln();
    timers.ablaufen();
    await lauf;

    const historienWarnungen = warnings.filter(message => message.includes('Laufhistorie'));
    assert.equal(historienWarnungen.length, 1);
    assert.ok(!historienWarnungen[0].includes('kv-token-geheim'));
    assert.ok(!historienWarnungen[0].includes('feed_run_history'));
});
