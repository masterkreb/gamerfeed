import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CORE_DEADLINE_MS,
    CORE_DEADLINE_SAFETY_MARGIN_MS,
    DEADLINE_ABORT_MESSAGE,
    DEFERRAL_KINDS,
    DEFERRAL_REASONS,
    MAX_ARTICLE_PAGE_FETCHES_PER_RUN,
    MAX_CORE_DEADLINE_MS,
    WORKFLOW_HARD_LIMIT_MS,
    createRunBudget,
    distributeBySourceFairly,
} from '../../../scripts/feed-run-budget.js';
import {
    createControlledClock as createUhr,
    createTimeoutSignalFactory as createSignalFabrik,
} from '../helpers/feed-run-harness.js';

// Alle Grenzfaelle laufen ueber eine gestellte Uhr und gestellte Timer.
// Kein Test wartet echt, keiner beruehrt das Netz.

function createBudget(uhr, optionen = {}) {
    const fabrik = createSignalFabrik();
    const budget = createRunBudget({
        now: uhr.now,
        setTimer: uhr.setTimer,
        clearTimer: uhr.clearTimer,
        createTimeoutSignal: fabrik.createTimeoutSignal,
        ...optionen,
    });
    return { budget, fabrik };
}

// === Herleitung der Konstanten ===

test('die Sicherheitsreserve ergaenzt die Deadline zum Hardlimit', () => {
    assert.equal(CORE_DEADLINE_MS + CORE_DEADLINE_SAFETY_MARGIN_MS, WORKFLOW_HARD_LIMIT_MS);
    assert.ok(CORE_DEADLINE_SAFETY_MARGIN_MS >= 5 * 60 * 1000, 'mindestens fünf Minuten Reserve');
    assert.ok(MAX_CORE_DEADLINE_MS < WORKFLOW_HARD_LIMIT_MS, 'auch das Maximum bleibt unter dem Hardlimit');
    assert.ok(MAX_ARTICLE_PAGE_FETCHES_PER_RUN > 0);
});

// === Grenztests direkt vor, genau auf und nach der Deadline ===

test('direkt vor der Deadline laeuft der Lauf weiter', () => {
    const uhr = createUhr();
    const { budget } = createBudget(uhr, { deadlineMs: 10_000 });

    uhr.vor(9_999);

    assert.equal(budget.remainingMs(), 1);
    assert.equal(budget.isDeadlineReached(), false);
    assert.equal(budget.signal.aborted, false);
});

test('genau auf der Deadline gilt sie als erreicht', () => {
    const uhr = createUhr();
    const { budget } = createBudget(uhr, { deadlineMs: 10_000 });

    uhr.vor(10_000);

    assert.equal(budget.remainingMs(), 0);
    assert.equal(budget.isDeadlineReached(), true);
});

test('nach der Deadline bleibt die Restzeit bei null statt negativ zu werden', () => {
    const uhr = createUhr();
    const { budget } = createBudget(uhr, { deadlineMs: 10_000 });

    uhr.vor(45_000);

    assert.equal(budget.remainingMs(), 0);
    assert.equal(budget.isDeadlineReached(), true);
});

// === Kontrollierter Gesamtabbruch ===

test('der Timer bricht eine laufende Anfrage ab, ohne dass jemand die Uhr abfragt', () => {
    // Der entscheidende Fall: waehrend eine Anfrage haengt, fragt niemand die
    // Restzeit ab. Ohne Timer liefe sie bis in ihr eigenes Einzeltimeout.
    const uhr = createUhr();
    const { budget } = createBudget(uhr, { deadlineMs: 10_000 });

    const signal = budget.requestSignal(15_000);
    assert.equal(signal.aborted, false);

    uhr.vor(10_000);

    assert.equal(budget.signal.aborted, true, 'der Gesamtabbruch greift');
    assert.equal(signal.aborted, true, 'die laufende Anfrage wird mit abgebrochen');
});

test('der Abbruchgrund nennt keinen Konfigurations- oder Zielwert', () => {
    const uhr = createUhr();
    const { budget } = createBudget(uhr, { deadlineMs: 1_000 });

    uhr.vor(1_000);

    assert.equal(budget.signal.reason.message, DEADLINE_ABORT_MESSAGE);
    assert.doesNotMatch(budget.signal.reason.message, /https?:|@|token|key/i);
});

test('nach der Deadline ist das Anfragesignal sofort abgebrochen', () => {
    const uhr = createUhr();
    const { budget, fabrik } = createBudget(uhr, { deadlineMs: 10_000 });

    uhr.vor(20_000);
    const signal = budget.requestSignal(15_000);

    assert.equal(signal.aborted, true);
    assert.deepEqual(fabrik.angefragt, [], 'für eine tote Anfrage wird kein Timeout mehr gebaut');
});

test('das Einzeltimeout wird auf die Restzeit gekuerzt', () => {
    const uhr = createUhr();
    const { budget, fabrik } = createBudget(uhr, { deadlineMs: 20_000 });

    budget.requestSignal(15_000);
    assert.equal(fabrik.angefragt.at(-1), 15_000, 'genug Restzeit: das Einzeltimeout gilt unverändert');

    uhr.vor(12_000);
    budget.requestSignal(15_000);
    assert.equal(fabrik.angefragt.at(-1), 8_000, 'knappe Restzeit: das Einzeltimeout wird gekürzt');
});

test('ein abgelaufenes Einzeltimeout bricht die Anfrage ohne Gesamtabbruch ab', () => {
    const uhr = createUhr();
    const { budget, fabrik } = createBudget(uhr, { deadlineMs: 60_000 });

    const signal = budget.requestSignal(5_000);
    fabrik.controller.at(-1).abort(new Error('Einzeltimeout'));

    assert.equal(signal.aborted, true);
    assert.equal(budget.signal.aborted, false, 'der Lauf als Ganzes läuft weiter');
});

// === Scrape-Budget ===

test('das Seitenabruf-Budget laesst genau so viele Abrufe zu wie erlaubt', () => {
    const uhr = createUhr();
    const { budget } = createBudget(uhr, { scrapeLimit: 3 });

    assert.equal(budget.hasPageFetchBudget(), true);
    assert.equal(budget.consumePageFetch(), true);
    assert.equal(budget.consumePageFetch(), true);
    assert.equal(budget.consumePageFetch(), true);

    assert.equal(budget.hasPageFetchBudget(), false);
    assert.equal(budget.consumePageFetch(), false, 'der vierte Abruf wird nicht mehr gebucht');
    assert.equal(budget.pageFetchesUsed, 3, 'der Zähler bleibt bei der Obergrenze stehen');
});

test('ein Limit von null erlaubt keinen einzigen Seitenabruf', () => {
    const uhr = createUhr();
    const { budget } = createBudget(uhr, { scrapeLimit: 0 });

    assert.equal(budget.hasPageFetchBudget(), false);
    assert.equal(budget.consumePageFetch(), false);
});

// === Ergebniszustand ===

test('ohne zurueckgestellte Arbeit ist der Lauf nicht degradiert', () => {
    const uhr = createUhr();
    const { budget } = createBudget(uhr);

    assert.equal(budget.isDegraded(), false);
    assert.equal(budget.describeDeferrals(), null);
});

test('zurueckgestellte Arbeit wird nach Grund und Art gezaehlt', () => {
    const uhr = createUhr();
    const { budget } = createBudget(uhr);

    budget.defer({ reason: DEFERRAL_REASONS.DEADLINE, kind: DEFERRAL_KINDS.FEED, count: 2 });
    budget.defer({ reason: DEFERRAL_REASONS.DEADLINE, kind: DEFERRAL_KINDS.FEED });
    budget.defer({ reason: DEFERRAL_REASONS.SCRAPE_BUDGET, kind: DEFERRAL_KINDS.IMAGE_SCRAPE, count: 12 });

    assert.equal(budget.isDegraded(), true);
    assert.deepEqual(budget.deferrals(), [
        { reason: 'deadline', kind: 'feed', count: 3 },
        { reason: 'scrape_budget', kind: 'image_scrape', count: 12 },
    ]);

    const text = budget.describeDeferrals();
    assert.match(text, /Zeitbudget erschöpft: 3/);
    assert.match(text, /Scrape-Budget erschöpft: 12/);
});

test('eine Zurueckstellung ohne Anzahl aendert nichts', () => {
    const uhr = createUhr();
    const { budget } = createBudget(uhr);

    budget.defer({ reason: DEFERRAL_REASONS.DEADLINE, kind: DEFERRAL_KINDS.FEED, count: 0 });

    assert.equal(budget.isDegraded(), false);
});

// === Optionale Phasen ===

test('eine optionale Phase entfaellt, sobald die Restzeit unter die Reserve faellt', () => {
    const uhr = createUhr();
    const { budget } = createBudget(uhr, {
        deadlineMs: 100_000,
        optionalPhaseMinRemainingMs: 30_000,
    });

    uhr.vor(69_999);
    assert.equal(budget.canRunOptionalPhase(), true, 'knapp über der Reserve läuft sie noch');

    uhr.vor(1);
    assert.equal(budget.canRunOptionalPhase(), true, 'genau auf der Reserve ebenfalls');

    uhr.vor(1);
    assert.equal(budget.canRunOptionalPhase(), false, 'darunter nicht mehr');
});

// === Faire Verteilung ===

test('zurueckgestellte Bild-Scrapes verteilen sich reihum ueber die Quellen', () => {
    const artikel = [
        { source: 'A', link: 'a1' },
        { source: 'A', link: 'a2' },
        { source: 'A', link: 'a3' },
        { source: 'B', link: 'b1' },
        { source: 'B', link: 'b2' },
        { source: 'C', link: 'c1' },
    ];

    const verteilt = distributeBySourceFairly(artikel);

    assert.deepEqual(verteilt.map(a => a.link), ['a1', 'b1', 'c1', 'a2', 'b2', 'a3']);

    // Bei einem Budget von drei bekommt jede Quelle genau einen Abruf, statt
    // dass die erste Quelle alles aufbraucht.
    const ersteDrei = verteilt.slice(0, 3).map(a => a.source);
    assert.deepEqual([...new Set(ersteDrei)].sort(), ['A', 'B', 'C']);
});

test('die Verteilung ist deterministisch und verliert keinen Artikel', () => {
    const artikel = Array.from({ length: 25 }, (_, index) => ({
        source: ['A', 'B', 'C', 'D'][index % 4],
        link: `l${index}`,
    }));

    const erste = distributeBySourceFairly(artikel.slice());
    const zweite = distributeBySourceFairly(artikel.slice());

    assert.deepEqual(erste.map(a => a.link), zweite.map(a => a.link));
    assert.equal(erste.length, 25);
    assert.equal(new Set(erste.map(a => a.link)).size, 25);
});

test('eine leere Liste bleibt leer', () => {
    assert.deepEqual(distributeBySourceFairly([]), []);
});

test('Artikel ohne Quelle landen in einer gemeinsamen Gruppe', () => {
    const verteilt = distributeBySourceFairly([
        { link: 'x1' },
        { source: 'A', link: 'a1' },
        { link: 'x2' },
    ]);

    assert.deepEqual(verteilt.map(a => a.link), ['x1', 'a1', 'x2']);
});

// === Aufraeumen ===

test('dispose gibt den Deadline-Timer frei', () => {
    const uhr = createUhr();
    const { budget } = createBudget(uhr, { deadlineMs: 10_000 });

    budget.dispose();
    uhr.vor(10_000);

    assert.equal(budget.signal.aborted, false, 'ein freigegebener Timer feuert nicht mehr');
    budget.dispose();
});
