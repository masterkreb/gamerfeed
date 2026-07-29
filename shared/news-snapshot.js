// Generationsgebundenes Leseprotokoll der News-Caches (Roadmap-Paket O3a).
//
// Das Problem: `news_cache`, `news_cache_16` und `news_cache_64` werden vom
// Cron **nacheinander** geschrieben und danach unabhaengig voneinander am Edge
// gecacht. Die progressive Ladekette holt sie ebenfalls nacheinander. Damit
// kann ein Browser Preview, Medium und Full aus drei verschiedenen Staenden
// zusammensetzen, ohne dass es irgendwo auffaellt - beobachtet am 29. Juli
// 2026, als das Frontend dauerhaft 25 deutsche Quellen zeigte, waehrend der
// direkt abgerufene Full-Cache 26 enthielt (GameStar fehlte nur im Browser).
//
// O3a loest das **nicht** durch atomares Schreiben - das ist O3b -, sondern
// dadurch, dass jede Antwort sagt, aus welcher Generation sie stammt, und der
// Leser sich auf genau eine festlegt.
//
// ## Noch nicht aktiviert
//
// Eine Kennung darf nur Inhalt bezeichnen, der nachweisbar zu ihr gehoert.
// Solange die drei News-Keys **veraenderlich** sind, kann das niemand belegen:
// ein Leser kann den Zeiger vor und die Artikel nach einem Publish erwischen,
// und **keine Lesereihenfolge** schliesst das aus. Deshalb schreibt der Cron
// bis O3b keinen Zeiger, und die Endpunkte melden eine Generation nur ueber
// eine ausdruecklich injizierte Quelle. Siehe
// docs/deployment/news-generations.md.
//
// Bewusst ohne `node:`-Importe und ohne Netzwerkzugriff: dieselbe Logik gilt im
// Cron (Node), in den Endpunkten (Edge) und im Browser.
//
// ## Der Vertrag
//
// - Eine Generation wird durch einen **Zeiger** beschrieben
//   (`news_snapshot_pointer`) mit `schemaVersion`, `snapshotId` und
//   `createdAt`. Wer ihn schreiben darf, entscheidet O3b.
// - Jede News-Antwort traegt diese Angaben als **Header**. Der Rumpf bleibt ein
//   nacktes Array - ein Umschlag waere ein Bruch fuer bestehende Clients.
// - Ein Leser merkt sich die Generation der ersten brauchbaren Antwort und
//   vergleicht jede weitere damit.
//
// ## Warum Header und kein Umschlag
//
// Bestehende Clients lesen `response.json()` als `Article[]`. Ein Umschlag
// haette sie mitten in der Migration gebrochen. Header ignorieren sie
// stillschweigend - genau das, was eine Dual-Read-Migration braucht.

/**
 * @typedef {{
 *   schemaVersion: number,
 *   snapshotId: string,
 *   createdAt: string|null,
 *   articleCount: number,
 *   runId: string|null,
 * }} NewsSnapshotPointer
 */

/**
 * Version des Leseprotokolls.
 *
 * Eine unbekannte Version wird wie „gar keine Generationsangabe“ behandelt und
 * faellt damit kontrolliert auf das Legacy-Verhalten zurueck, statt eine
 * Antwort zu verwerfen, die ein aelterer Leser nicht deuten kann.
 */
export const NEWS_SNAPSHOT_SCHEMA_VERSION = 1;

/** KV-Schluessel des Zeigers auf die aktive Generation. */
export const NEWS_SNAPSHOT_POINTER_KEY = 'news_snapshot_pointer';

export const SNAPSHOT_ID_HEADER = 'x-gamerfeed-snapshot-id';
export const SNAPSHOT_CREATED_AT_HEADER = 'x-gamerfeed-snapshot-created-at';
export const SNAPSHOT_SCHEMA_HEADER = 'x-gamerfeed-snapshot-schema';

/** Query-Parameter, mit dem ein Leser seine Generation anfragt. */
export const SNAPSHOT_QUERY_PARAM = 'snapshot';

/**
 * Ausdrueckliches Rollback-Signal des Servers.
 *
 * Eine Antwort **ohne** Generationsangabe kann zweierlei bedeuten: eine alte
 * Kopie aus einem Edge-Cache von vor der Umstellung - oder einen bewussten
 * Rueckfall auf Legacy. Der Leser darf das nicht raten: die erste darf einen
 * neueren Stand nicht zurueckdrehen, die zweite muss genau das duerfen.
 *
 * Deshalb sagt der Server es ausdruecklich. Nur wer dieses Signal sieht, gibt
 * seine gepinnte Generation auf.
 */
export const SNAPSHOT_ROLLBACK_HEADER = 'x-gamerfeed-snapshot-rollback';
export const SNAPSHOT_ROLLBACK_VALUE = 'legacy';

/**
 * Ergebnis von `decideSnapshotAcceptance`.
 *
 * `accept` entscheidet ueber die Antwort, `pin` ueber die kuenftig gepinnte
 * Generation. Der `reason` ist fuer Protokoll und Tests da und niemals
 * benutzersichtbar.
 */
export const SNAPSHOT_DECISIONS = Object.freeze({
    LEGACY: 'legacy',
    FIRST_GENERATION: 'first_generation',
    SAME_GENERATION: 'same_generation',
    NEWER_GENERATION: 'newer_generation',
    OLDER_GENERATION: 'older_generation',
    LEGACY_AFTER_GENERATION: 'legacy_after_generation',
    LEGACY_ROLLBACK: 'legacy_rollback',
});

function toIsoTimestamp(value) {
    if (value === null || value === undefined || value === '') return null;

    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    return Number.isFinite(time) ? date.toISOString() : null;
}

function toNonNegativeInteger(value) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return Math.floor(numeric);
}

/**
 * Verbindliches Format einer Kennung: `<epochMs>-<lauf>`.
 *
 * Das Format ist Teil des Vertrags und wird beim Lesen erzwungen. Ohne diese
 * Pruefung koennte ein beschaedigter Wert wie `"zzz"` im lexikografischen
 * Vergleich dauerhaft als „neuer" gelten und jede echte Generation blockieren.
 */
export const SNAPSHOT_ID_PATTERN = /^(\d{1,15})-([A-Za-z0-9_-]{1,64})$/;

/**
 * Bildet eine Kennung, die sich **sortieren** laesst.
 *
 * Der Zeitanteil steht vorn und muss mit `createdAt` uebereinstimmen - beim
 * Lesen wird genau das geprueft. Die Kennung ist nicht geheim: sie enthaelt
 * einen Zeitstempel und die ohnehin oeffentliche Lauf-ID.
 *
 * @param {unknown} publishedAt
 * @param {unknown} [runId]
 * @returns {string|null} `null`, wenn kein gueltiger Zeitpunkt vorliegt
 */
export function createSnapshotId(publishedAt, runId) {
    const iso = toIsoTimestamp(publishedAt);
    if (iso === null) return null;

    const millis = new Date(iso).getTime();
    if (millis < 0) return null;

    const suffix = (typeof runId === 'string' ? runId : '')
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, '')
        .slice(0, 64);

    return `${millis}-${suffix === '' ? 'unknown' : suffix}`;
}

/**
 * Baut den Zeiger auf die aktive Generation.
 *
 * @param {{ snapshotId: string, createdAt: unknown, articleCount?: unknown, runId?: unknown }} params
 */
export function buildSnapshotPointer({ snapshotId, createdAt, articleCount, runId }) {
    return {
        schemaVersion: NEWS_SNAPSHOT_SCHEMA_VERSION,
        snapshotId: String(snapshotId),
        createdAt: toIsoTimestamp(createdAt),
        articleCount: toNonNegativeInteger(articleCount),
        runId: runId === undefined || runId === null ? null : String(runId),
    };
}

/**
 * Liest einen gespeicherten oder uebertragenen Zeiger - **streng**.
 *
 * Liefert `null`, sobald irgendetwas nicht stimmt:
 *
 * - unbekannte Schemaversion (eine hoehere kann Felder anders meinen);
 * - Kennung, die nicht dem vereinbarten Format entspricht;
 * - fehlender oder unlesbarer `createdAt`;
 * - Zeitanteil der Kennung und `createdAt` widersprechen sich.
 *
 * Die letzten beiden Punkte sind neu und nicht kosmetisch: der Vergleich zweier
 * Generationen stuetzt sich auf beides. Ein beschaedigter Wert - etwa eine
 * Kennung ohne Zeitanteil oder ein `createdAt`, das nicht dazu passt - koennte
 * sich sonst dauerhaft als „neuer" durchsetzen und jede echte Generation
 * blockieren. Lieber gar keine Generation als eine falsche.
 *
 * `null` heisst ausdruecklich „Legacy“ und nicht „Fehler“: der Leser faellt
 * damit auf das Verhalten vor O3a zurueck, statt eine brauchbare Antwort
 * wegzuwerfen.
 *
 * @param {unknown} raw
 * @returns {NewsSnapshotPointer|null}
 */
export function normalizeSnapshotPointer(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    if (raw.schemaVersion !== NEWS_SNAPSHOT_SCHEMA_VERSION) return null;

    const snapshotId = typeof raw.snapshotId === 'string' ? raw.snapshotId.trim() : '';
    const match = SNAPSHOT_ID_PATTERN.exec(snapshotId);
    if (match === null) return null;

    const createdAt = toIsoTimestamp(raw.createdAt);
    if (createdAt === null) return null;

    // Der Zeitanteil der Kennung ist die Sortiergrundlage; weicht er vom
    // Zeitstempel ab, ist mindestens einer der beiden Werte beschaedigt.
    if (Number(match[1]) !== Date.parse(createdAt)) return null;

    return {
        schemaVersion: NEWS_SNAPSHOT_SCHEMA_VERSION,
        snapshotId,
        createdAt,
        articleCount: toNonNegativeInteger(raw.articleCount),
        runId: typeof raw.runId === 'string' && raw.runId !== '' ? raw.runId : null,
    };
}

/**
 * Header einer generationsgebundenen Antwort.
 *
 * @param {NewsSnapshotPointer|null} pointer
 * @returns {Record<string, string>}
 */
export function snapshotHeaders(pointer) {
    if (!pointer) return {};

    // `createdAt` ist Pflicht: ein normalisierter Zeiger hat ihn immer, und ohne
    // ihn koennte die Gegenseite den Zeiger gar nicht erst annehmen.
    return {
        [SNAPSHOT_ID_HEADER]: pointer.snapshotId,
        [SNAPSHOT_SCHEMA_HEADER]: String(pointer.schemaVersion),
        [SNAPSHOT_CREATED_AT_HEADER]: pointer.createdAt,
    };
}

/**
 * Liest die Generationsangaben einer Antwort.
 *
 * Eine Antwort ohne diese Header ist „Legacy“ und ergibt `null` - etwa eine
 * Kopie aus einem Edge-Cache von vor der Migration.
 *
 * @param {{ get(name: string): string|null }|null} headers
 * @returns {NewsSnapshotPointer|null}
 */
export function readSnapshotHeaders(headers) {
    if (!headers || typeof headers.get !== 'function') return null;

    const schemaVersion = Number(headers.get(SNAPSHOT_SCHEMA_HEADER));

    return normalizeSnapshotPointer({
        schemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : null,
        snapshotId: headers.get(SNAPSHOT_ID_HEADER),
        createdAt: headers.get(SNAPSHOT_CREATED_AT_HEADER),
    });
}

/**
 * Meldet der Server einen ausdruecklichen Rueckfall auf Legacy?
 *
 * @param {{ get(name: string): string|null }|null} headers
 * @returns {boolean}
 */
export function readSnapshotRollback(headers) {
    if (!headers || typeof headers.get !== 'function') return false;

    const value = headers.get(SNAPSHOT_ROLLBACK_HEADER);
    return typeof value === 'string' && value.trim().toLowerCase() === SNAPSHOT_ROLLBACK_VALUE;
}

/**
 * Header eines ausdruecklichen Legacy-Rollbacks.
 *
 * @returns {Record<string, string>}
 */
export function rollbackHeaders() {
    return { [SNAPSHOT_ROLLBACK_HEADER]: SNAPSHOT_ROLLBACK_VALUE };
}

/**
 * Vergleicht zwei Generationen.
 *
 * Zuerst nach `createdAt`, bei Gleichstand nach der Kennung. Beide Werte sind
 * durch `normalizeSnapshotPointer` garantiert vorhanden und widerspruchsfrei -
 * ein lexikografischer Vergleich auf einem beschaedigten Wert kann hier also
 * nicht mehr entstehen.
 *
 * @param {NewsSnapshotPointer|null} a
 * @param {NewsSnapshotPointer|null} b
 * @returns {-1|0|1} negativ, wenn `a` aelter ist als `b`
 */
export function compareSnapshots(a, b) {
    if (!a && !b) return 0;
    // Legacy gilt als aelter als jede echte Generation: eine Antwort ohne
    // Angabe stammt entweder aus der Zeit vor der Migration oder aus einem
    // Cache, der sie noch nicht kennt.
    if (!a) return -1;
    if (!b) return 1;

    if (a.snapshotId === b.snapshotId) return 0;

    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);

    if (aTime !== bTime) return aTime < bTime ? -1 : 1;

    // Gleicher Zeitpunkt, verschiedene Laeufe: die Kennung entscheidet
    // deterministisch, damit zwei Leser nie zu verschiedenen Ergebnissen
    // kommen.
    return a.snapshotId < b.snapshotId ? -1 : 1;
}

/**
 * Entscheidet, ob eine Antwort uebernommen wird.
 *
 * Die drei Regeln des Leseprotokolls:
 *
 * 1. **Gleiche Generation** – uebernehmen. Der Normalfall.
 * 2. **Neuere Generation** – uebernehmen *und* umpinnen. Der Rumpf ist bereits
 *    der neue Stand, ein erneuter Abruf waere nur eine zusaetzliche Runde.
 *    Ohne diese Regel bliebe ein Browser dauerhaft auf einem alten Stand
 *    haengen - genau der beobachtete GameStar-Fall.
 * 3. **Aeltere Generation** – verwerfen. So kann eine verspaetete oder aus dem
 *    Edge-Cache stammende Kopie den sichtbaren Stand nicht zurueckdrehen.
 *
 * Legacy-Antworten (ohne Angabe) sind akzeptabel, solange noch nichts gepinnt
 * ist. Ist bereits eine echte Generation gepinnt, gilt Legacy als aelter und
 * wird verworfen.
 *
 * Ein ausdrueckliches `rollback` ist der einzige Weg, eine gepinnte Generation
 * wieder aufzugeben. Ohne dieses Signal bleibt eine headerlose Antwort das, was
 * sie meistens ist: eine alte Kopie.
 *
 * @param {{
 *   pinned?: NewsSnapshotPointer|null,
 *   incoming?: NewsSnapshotPointer|null,
 *   rollback?: boolean,
 * }} [params]
 * @returns {{ accept: boolean, pin: NewsSnapshotPointer|null, reason: string }}
 */
export function decideSnapshotAcceptance({ pinned = null, incoming = null, rollback = false } = {}) {
    // Der Server gibt das Protokoll ausdruecklich auf. Die gepinnte Generation
    // wird dabei geloescht - sonst pinnte ein Reload aus der lokalen Kopie
    // sofort wieder die alte Generation und der Client bliebe haengen.
    if (rollback) {
        return { accept: true, pin: null, reason: SNAPSHOT_DECISIONS.LEGACY_ROLLBACK };
    }

    if (!incoming) {
        if (!pinned) {
            return { accept: true, pin: null, reason: SNAPSHOT_DECISIONS.LEGACY };
        }
        return { accept: false, pin: pinned, reason: SNAPSHOT_DECISIONS.LEGACY_AFTER_GENERATION };
    }

    if (!pinned) {
        return { accept: true, pin: incoming, reason: SNAPSHOT_DECISIONS.FIRST_GENERATION };
    }

    const order = compareSnapshots(incoming, pinned);
    if (order === 0) {
        return { accept: true, pin: pinned, reason: SNAPSHOT_DECISIONS.SAME_GENERATION };
    }
    if (order > 0) {
        return { accept: true, pin: incoming, reason: SNAPSHOT_DECISIONS.NEWER_GENERATION };
    }

    return { accept: false, pin: pinned, reason: SNAPSHOT_DECISIONS.OLDER_GENERATION };
}

/**
 * Entscheidet ueber eine Antwort der Hintergrundpruefung (Auto-Update).
 *
 * Der Poll zeigt nichts an und veraendert die gepinnte Generation deshalb
 * **nie** - auch nicht, um sie freizugeben. Die eigentliche Uebernahme eines
 * Rollbacks bleibt der Ladekette vorbehalten, also Reload oder manuellem
 * Refresh.
 *
 * Ein autoritativer Rollback muss hier aber **aufraeumen**: eine bereits
 * vorgemerkte Generation ist damit zurueckgezogen. Bliebe sie stehen, koennte
 * ein spaeterer Klick genau die Generation einspielen, die der Server gerade
 * widerrufen hat.
 *
 * @param {{
 *   pinned?: NewsSnapshotPointer|null,
 *   incoming?: NewsSnapshotPointer|null,
 *   rollback?: boolean,
 * }} [params]
 * @returns {{ accept: boolean, clearPending: boolean, reason: string }}
 */
export function planPollResponse({ pinned = null, incoming = null, rollback = false } = {}) {
    if (rollback) {
        return {
            // Nicht anzeigen: der sichtbare Stand aendert sich erst beim
            // naechsten Ladevorgang.
            accept: false,
            clearPending: true,
            reason: SNAPSHOT_DECISIONS.LEGACY_ROLLBACK,
        };
    }

    const decision = decideSnapshotAcceptance({ pinned, incoming });
    return { accept: decision.accept, clearPending: false, reason: decision.reason };
}

/**
 * Entscheidet ueber die Uebernahme vorgemerkter Auto-Update-Artikel.
 *
 * Zwischen dem Vormerken und dem Klick des Benutzers koennen Minuten liegen -
 * genug Zeit, damit der sichtbare Stand laengst weiter ist. Die Warteschlange
 * wird deshalb **beim Uebernehmen erneut** gegen die gepinnte Generation
 * geprueft, nicht nur beim Befuellen.
 *
 * Ohne diese Pruefung setzte ein Klick auf eine Warteschlange aus Generation B
 * eine bereits sichtbare Generation C wieder zurueck - inklusive der lokalen
 * Kopie.
 *
 * Diese Funktion ist die **einzige** Stelle, an der das entschieden wird;
 * `App.tsx` ruft genau sie auf.
 *
 * @param {{
 *   pinned?: NewsSnapshotPointer|null,
 *   pending?: { articles?: unknown[], snapshot?: NewsSnapshotPointer|null }|null,
 * }} [params]
 * @returns {{ adopt: boolean, snapshot: NewsSnapshotPointer|null, reason: string|null }}
 */
export function planPendingAdoption({ pinned = null, pending = null } = {}) {
    const articles = Array.isArray(pending?.articles) ? pending.articles : [];
    if (articles.length === 0) {
        return { adopt: false, snapshot: pinned, reason: null };
    }

    const decision = decideSnapshotAcceptance({
        pinned,
        incoming: pending?.snapshot ?? null,
    });

    return {
        adopt: decision.accept,
        // Bei Ablehnung bleibt die gepinnte Generation stehen: der sichtbare
        // Stand aendert sich nicht.
        snapshot: decision.accept ? (pending?.snapshot ?? null) : pinned,
        reason: decision.reason,
    };
}

/**
 * Haengt die gepinnte Generation an eine Endpunktadresse.
 *
 * Der Parameter macht den Edge-Cache generationsspezifisch: verschiedene
 * Generationen liegen unter verschiedenen Cache-Keys. Er sagt ausdruecklich
 * **nicht**, dass der Inhalt unter einer Kennung unveraenderlich waere - das
 * gilt erst mit den unveraenderlichen Generationen aus O3b. Deshalb bekommt
 * eine passende gepinnte Anfrage heute auch keine laengere Cache-Frist.
 *
 * @param {string} path
 * @param {NewsSnapshotPointer|{ snapshotId?: string }|null} pinned
 * @returns {string}
 */
export function withSnapshotQuery(path, pinned) {
    if (!pinned?.snapshotId) return path;

    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}${SNAPSHOT_QUERY_PARAM}=${encodeURIComponent(pinned.snapshotId)}`;
}
