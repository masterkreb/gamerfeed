// Speicheradapter der begrenzten Laufhistorie (Roadmap-Paket O4b).
//
// Bewusst getrennt vom Datenmodell in `shared/feed-run-history.js`: hier steht
// ausschliesslich, *wie* der Redis-Sorted-Set angesprochen wird.
//
// Warum ein Sorted Set und kein Array unter einem gewoehnlichen Schluessel:
//
// - Ein Array muesste gelesen, ergaenzt und zurueckgeschrieben werden. Zwei
//   gleichzeitig laufende Workflows – ein verspaeteter und ein planmaessiger –
//   wuerden sich dabei gegenseitig ueberschreiben, und ein Lauf verschwaende
//   still aus der Historie.
// - Ein Sorted Set kennt `zadd` als atomare Einzeloperation. Das Kuerzen laeuft
//   in derselben `multi()`-Transaktion, damit zwischen „geschrieben“ und
//   „gekuerzt“ kein Zustand mit unbegrenzter Groesse entsteht.
//
// Der Score ist `finishedAt` in Millisekunden. Damit ist die Reihenfolge nicht
// die Schreibreihenfolge, sondern die tatsaechliche Abschlusszeit: ein
// verspaetet eintreffender Lauf sortiert sich korrekt ein, statt einen
// neueren zu verdraengen.
//
// Bewusst **ohne** `node:`-Importe: die Health-API liest die Historie aus der
// Edge-Runtime.

import {
    FEED_RUN_HISTORY_KEY,
    FEED_RUN_HISTORY_LIMIT,
    normalizeRunHistory,
    runHistoryScore,
} from './feed-run-history.js';

/**
 * Schreibt einen Eintrag und kuerzt die Historie in **einer** Transaktion.
 *
 * Wirft ausdruecklich nicht: die Historie ist reine Beobachtbarkeit und darf
 * weder das Laufergebnis noch den Exit-Code veraendern. Ein Fehler wird als
 * Ergebnis zurueckgegeben, damit der Aufrufer ihn bereinigt protokollieren
 * kann.
 *
 * @param {{ multi?: () => object }} store KV-Client mit Sorted-Set-Befehlen
 * @param {object} entry bereits normalisierter Historieneintrag
 * @param {{ key?: string, limit?: number }} [options]
 * @returns {Promise<{ ok: boolean, written: boolean, error: string|null }>}
 */
export async function appendRunHistoryEntry(store, entry, {
    key = FEED_RUN_HISTORY_KEY,
    limit = FEED_RUN_HISTORY_LIMIT,
} = {}) {
    const score = runHistoryScore(entry);
    if (score === null) {
        // Ohne verwertbares `finishedAt` gaebe es keinen Sortierschluessel. Das
        // ist kein Speicherfehler, sondern ein Eintrag, der nie haette gebaut
        // werden duerfen.
        return { ok: false, written: false, error: 'Eintrag ohne verwertbares finishedAt' };
    }

    try {
        if (typeof store?.multi !== 'function') {
            throw new Error('Der Speicher unterstützt keine Transaktion (multi).');
        }

        const transaction = store.multi();
        transaction.zadd(key, { score, member: entry });
        // `zremrangebyrank` entfernt die niedrigsten Raenge, also die aeltesten
        // Abschlusszeiten. Uebrig bleiben genau die `limit` neuesten Eintraege.
        // Bei limit = 72 heisst das: Rang 0 bis -73 faellt weg.
        transaction.zremrangebyrank(key, 0, -limit - 1);
        await transaction.exec();

        return { ok: true, written: true, error: null };
    } catch (error) {
        return {
            ok: false,
            written: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Liest die Historie, neueste zuerst.
 *
 * Ein Lesefehler wird **weitergereicht**: der Aufrufer muss zwischen „leer“ und
 * „nicht lesbar“ unterscheiden koennen. Beschaedigte Einzelelemente werden
 * dagegen isoliert uebersprungen und machen die uebrige Historie nicht
 * unbrauchbar.
 *
 * @param {{ zrange?: Function }} store
 * @param {{ key?: string, limit?: number }} [options]
 * @returns {Promise<object[]>}
 * @throws wenn der Speicher nicht gelesen werden kann
 */
export async function readRunHistory(store, {
    key = FEED_RUN_HISTORY_KEY,
    limit = FEED_RUN_HISTORY_LIMIT,
} = {}) {
    if (typeof store?.zrange !== 'function') {
        throw new Error('Der Speicher unterstützt keinen Sorted-Set-Zugriff (zrange).');
    }

    // `rev: true` dreht die Rangfolge um: Index 0 ist der hoechste Score, also
    // der zuletzt abgeschlossene Lauf.
    const raw = await store.zrange(key, 0, Math.max(0, limit - 1), { rev: true });

    return normalizeRunHistory(toEntryList(raw), { limit });
}

/**
 * Wandelt die Rohantwort des Speichers in eine Liste von Kandidaten.
 *
 * Der KV-Client deserialisiert JSON-Member ueblicherweise selbst. Ob am Ende
 * ein Objekt oder eine Zeichenkette ankommt, darf die Historie aber nicht
 * entscheiden – beides wird akzeptiert, alles andere faellt als beschaedigt
 * heraus.
 */
function toEntryList(raw) {
    if (!Array.isArray(raw)) return [];

    return raw.map(item => {
        if (typeof item !== 'string') return item;

        try {
            return JSON.parse(item);
        } catch {
            return null;
        }
    });
}
