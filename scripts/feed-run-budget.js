// Globales Zeit- und Scrape-Budget des Cron-Laufs (Roadmap-Paket O2b).
//
// O2a hat jeden **einzelnen** externen Aufruf begrenzt. Ihre Summe war damit
// weiterhin ungedeckelt: 15+ Feeds mit Wiederholung, ein Proxy-Umweg und eine
// unbegrenzte Zahl von Artikel-Seitenabrufen koennen zusammen das
// 30-Minuten-Hardlimit des GitHub-Workflows erreichen. Ein harter
// Actions-Abbruch laeuft **nicht** durch den normalen Fehlerpfad: der Lauf
// hinterlaesst dann einen halben Heartbeat und niemand erfaehrt, warum.
//
// Dieses Modul haelt deshalb zwei Grenzen:
//
// - eine **Deadline** fuer die Kernphasen, gemessen ab Start des Skripts;
// - ein **Seitenabruf-Budget** fuer neue OG-Bild-Scrapes und Backfills.
//
// Wird eine davon erreicht, wird die restliche Arbeit *kontrolliert*
// zurueckgestellt statt abgeschnitten - und der Lauf endet als `degraded`,
// nicht als `success`. Zurueckgestellte Bild-Scrapes bleiben reparierbar: der
// Artikel bekommt einen Platzhalter und wird im naechsten Lauf erneut versucht.
//
// Uhr, Timer und Timeout-Signal sind injizierbar. Nur deshalb sind die
// Grenzfaelle direkt vor, genau auf und nach der Deadline ohne echte Wartezeit
// pruefbar.

/** Hardlimit des Workflows (`timeout-minutes: 30`). Nur zur Herleitung. */
export const WORKFLOW_HARD_LIMIT_MS = 30 * 60 * 1000;

/**
 * Deadline der Kernphasen, gemessen ab Start von `scripts/fetch-feeds.js`.
 *
 * 18 Minuten lassen 12 Minuten Sicherheitsreserve bis zum Hardlimit. Davon
 * gehen Checkout, `npm ci` und `npm run test:feeds` ab (in der Praxis 2-4
 * Minuten); der Rest deckt Kern-Publish, Trendphase und Heartbeat ab.
 *
 * Die Zahl passt zu den Einzelgrenzen aus O2a: 16 Feeds mit je zwei Versuchen
 * a 15 s ergeben schlimmstenfalls rund 8 Minuten, die 80 erlaubten
 * Seitenabrufe mit je 5 s Timeout und 0,5 s Pause rund 7,3 Minuten.
 */
export const CORE_DEADLINE_MS = 18 * 60 * 1000;

/** Was nach der Kern-Deadline bis zum Hardlimit uebrig bleibt. */
export const CORE_DEADLINE_SAFETY_MARGIN_MS = WORKFLOW_HARD_LIMIT_MS - CORE_DEADLINE_MS;

/**
 * Feste Obergrenze fuer Artikel-Seitenabrufe pro Lauf.
 *
 * Gilt gemeinsam fuer neue OG-Scrapes und den Backfill alter Artikel - beides
 * sind Abrufe fremder Artikelseiten und beide kosten dieselbe Laufzeit.
 */
export const MAX_ARTICLE_PAGE_FETCHES_PER_RUN = 80;

/**
 * Restzeit, die eine optionale Phase (Trends) noch vorfinden muss.
 *
 * Zwei Groq-Aufrufe mit je 20 s Timeout plus KV-Zugriffe brauchen deutlich
 * weniger; die Reserve ist bewusst grosszuegig, weil die Phase verzichtbar ist.
 */
export const OPTIONAL_PHASE_MIN_REMAINING_MS = 3 * 60 * 1000;

/** Zulaessiger Bereich einer konfigurierten Deadline. */
export const MIN_CORE_DEADLINE_MS = 60 * 1000;
/** Auch eine konfigurierte Deadline behaelt mindestens 5 Minuten Reserve. */
export const MAX_CORE_DEADLINE_MS = WORKFLOW_HARD_LIMIT_MS - 5 * 60 * 1000;

/** Warum Arbeit zurueckgestellt wurde. */
export const DEFERRAL_REASONS = Object.freeze({
    DEADLINE: 'deadline',
    SCRAPE_BUDGET: 'scrape_budget',
});

/** Welche Arbeit zurueckgestellt wurde. */
export const DEFERRAL_KINDS = Object.freeze({
    FEED: 'feed',
    IMAGE_SCRAPE: 'image_scrape',
    IMAGE_BACKFILL: 'image_backfill',
    TRENDS: 'trends',
});

const REASON_LABELS = Object.freeze({
    [DEFERRAL_REASONS.DEADLINE]: 'Zeitbudget erschöpft',
    [DEFERRAL_REASONS.SCRAPE_BUDGET]: 'Scrape-Budget erschöpft',
});

const KIND_LABELS = Object.freeze({
    [DEFERRAL_KINDS.FEED]: 'Quelle(n)',
    [DEFERRAL_KINDS.IMAGE_SCRAPE]: 'neue(r) Bild-Scrape(s)',
    [DEFERRAL_KINDS.IMAGE_BACKFILL]: 'Bild-Backfill(s)',
    [DEFERRAL_KINDS.TRENDS]: 'Trendphase(n)',
});

/** Grund des kontrollierten Gesamtabbruchs. Enthaelt bewusst keinen Wert. */
export const DEADLINE_ABORT_MESSAGE = 'Zeitbudget des Laufs erschöpft; laufende Anfrage abgebrochen.';

/**
 * Bringt Artikel so in eine Reihenfolge, dass jede Quelle reihum drankommt.
 *
 * Ohne diese Verteilung frisst die erste Quelle das gesamte Scrape-Budget auf
 * und alle folgenden gehen dauerhaft leer aus - Lauf fuer Lauf dieselben.
 * Reihum bekommt jede Quelle ihren Anteil, und die uebrig gebliebenen Artikel
 * verteilen sich ebenfalls ueber alle Quellen.
 *
 * Die Reihenfolge ist deterministisch: `Map` behaelt die Einfuegereihenfolge.
 *
 * @template T
 * @param {T[]} articles
 * @param {(article: T) => string} [getSource]
 * @returns {T[]}
 */
export function distributeBySourceFairly(articles, getSource = article => String(article?.source ?? 'Unknown')) {
    const bySource = new Map();

    for (const article of articles) {
        const source = getSource(article);
        if (!bySource.has(source)) bySource.set(source, []);
        bySource.get(source).push(article);
    }

    const ordered = [];
    let added = true;
    while (added) {
        added = false;
        for (const queue of bySource.values()) {
            if (queue.length === 0) continue;
            ordered.push(queue.shift());
            added = true;
        }
    }

    return ordered;
}

function toPositiveInteger(value) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.floor(numeric);
}

/**
 * Erzeugt das Laufbudget.
 *
 * @param {{
 *   now?: () => number,
 *   deadlineMs?: number,
 *   scrapeLimit?: number,
 *   optionalPhaseMinRemainingMs?: number,
 *   setTimer?: (callback: () => void, ms: number) => unknown,
 *   clearTimer?: (handle: unknown) => void,
 *   createTimeoutSignal?: (ms: number) => AbortSignal,
 * }} [options]
 */
export function createRunBudget({
    now = () => Date.now(),
    deadlineMs = CORE_DEADLINE_MS,
    scrapeLimit = MAX_ARTICLE_PAGE_FETCHES_PER_RUN,
    optionalPhaseMinRemainingMs = OPTIONAL_PHASE_MIN_REMAINING_MS,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = handle => clearTimeout(handle),
    createTimeoutSignal = ms => AbortSignal.timeout(ms),
} = {}) {
    const startedAtMs = now();
    const effectiveDeadlineMs = toPositiveInteger(deadlineMs) ?? CORE_DEADLINE_MS;
    const effectiveScrapeLimit = toPositiveInteger(scrapeLimit) ?? MAX_ARTICLE_PAGE_FETCHES_PER_RUN;
    const deadlineAtMs = startedAtMs + effectiveDeadlineMs;

    const controller = new AbortController();
    // Zaehler je `reason:kind`. Nur Anzahlen - keine Titel, Adressen, Inhalte.
    const deferralCounts = new Map();

    let pageFetchesUsed = 0;
    let disposed = false;

    function abortForDeadline() {
        if (controller.signal.aborted) return;
        // Der Grund landet in Fehlertexten laufender Anfragen. Deshalb ein
        // fester Satz ohne Adresse, Quelle oder Konfigurationswert.
        controller.abort(new Error(DEADLINE_ABORT_MESSAGE));
    }

    // Der Timer bricht eine **laufende** Anfrage ab. Ohne ihn wuerde die
    // Restzeit nur zwischen zwei Arbeitsschritten geprueft - eine haengende
    // Gegenstelle liefe dann trotz Deadline bis in ihr eigenes Timeout.
    let timerHandle = setTimer(abortForDeadline, effectiveDeadlineMs);
    timerHandle?.unref?.();

    /** Prueft die Uhr; eine ueberschrittene Deadline bricht sofort ab. */
    function remainingMs() {
        const remaining = deadlineAtMs - now();
        if (remaining <= 0) {
            abortForDeadline();
            return 0;
        }
        return remaining;
    }

    return {
        startedAtMs,
        deadlineAtMs,
        deadlineMs: effectiveDeadlineMs,
        scrapeLimit: effectiveScrapeLimit,

        /** Signal des kontrollierten Gesamtabbruchs. */
        get signal() {
            return controller.signal;
        },

        get pageFetchesUsed() {
            return pageFetchesUsed;
        },

        elapsedMs() {
            return now() - startedAtMs;
        },

        remainingMs,

        /**
         * Ist die Deadline erreicht?
         *
         * Genau **auf** der Deadline gilt sie als erreicht - sonst haette der
         * Grenzfall keine eindeutige Antwort.
         */
        isDeadlineReached() {
            return remainingMs() === 0;
        },

        /**
         * Bleibt nach `ms` noch Zeit uebrig?
         *
         * Gedacht fuer **Wartezeiten**: Wiederholungspausen und die
         * Hoeflichkeitspausen zwischen Abrufen. Eine Pause, die ueber die
         * Deadline hinausreicht, ist der schlechteste Zeitverbrauch von allen -
         * sie tut nichts und nimmt dem Laufabschluss trotzdem die Zeit weg.
         *
         * Bewusst **strikt groesser**: nach der Pause muss noch etwas moeglich
         * sein, sonst haette man sie sich sparen koennen.
         *
         * @param {number} [ms]
         * @returns {boolean}
         */
        hasTimeFor(ms = 0) {
            return remainingMs() > (toPositiveInteger(ms) ?? 0);
        },

        /** Reicht die Restzeit noch fuer eine optionale Phase? */
        canRunOptionalPhase() {
            return remainingMs() >= optionalPhaseMinRemainingMs;
        },

        /** Ist noch Seitenabruf-Budget uebrig? */
        hasPageFetchBudget() {
            return pageFetchesUsed < effectiveScrapeLimit;
        },

        /**
         * Bucht einen Artikel-Seitenabruf.
         *
         * @returns {boolean} false, wenn das Budget erschoepft ist
         */
        consumePageFetch() {
            if (pageFetchesUsed >= effectiveScrapeLimit) return false;
            pageFetchesUsed += 1;
            return true;
        },

        /**
         * Signal fuer eine einzelne Anfrage.
         *
         * Es verbindet zwei Grenzen: das Einzeltimeout aus O2a und die
         * Restzeit des Laufs. Keine Anfrage darf laenger laufen, als der Lauf
         * ueberhaupt noch hat; zusaetzlich bricht der Gesamtabbruch eine
         * bereits laufende Anfrage ab.
         *
         * @param {number} timeoutMs
         * @returns {AbortSignal}
         */
        requestSignal(timeoutMs) {
            const remaining = remainingMs();
            if (controller.signal.aborted) return controller.signal;

            const requested = toPositiveInteger(timeoutMs) ?? 0;
            const effective = Math.min(requested, remaining);
            return AbortSignal.any([controller.signal, createTimeoutSignal(effective)]);
        },

        /**
         * Haelt zurueckgestellte Arbeit fest.
         *
         * @param {{ reason: string, kind: string, count?: number }} entry
         */
        defer({ reason, kind, count = 1 }) {
            const amount = toPositiveInteger(count) ?? 0;
            if (amount === 0) return;

            const key = `${reason}:${kind}`;
            deferralCounts.set(key, (deferralCounts.get(key) ?? 0) + amount);
        },

        /** @returns {{ reason: string, kind: string, count: number }[]} */
        deferrals() {
            return [...deferralCounts.entries()].map(([key, count]) => {
                const [reason, kind] = key.split(':');
                return { reason, kind, count };
            });
        },

        /** Wurde ueberhaupt Arbeit zurueckgestellt? */
        isDegraded() {
            return deferralCounts.size > 0;
        },

        /**
         * Kurzer, secret-freier Satz fuer Heartbeat und Log.
         *
         * @returns {string|null}
         */
        describeDeferrals() {
            if (deferralCounts.size === 0) return null;

            return this.deferrals()
                .map(({ reason, kind, count }) => (
                    `${REASON_LABELS[reason] ?? reason}: ${count} ${KIND_LABELS[kind] ?? kind} zurückgestellt`
                ))
                .join('; ');
        },

        /** Gibt den Deadline-Timer frei; ohne ihn haelt er den Prozess auf. */
        dispose() {
            if (disposed) return;
            disposed = true;
            clearTimer(timerHandle);
            timerHandle = null;
        },
    };
}
