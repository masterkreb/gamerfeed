import type { NewsSnapshotPointer } from '../types';
import { decodeCachedNews } from './persisted-state';

/** Schlüssel der lokalen Artikelkopie im `localStorage`. */
export const LOCAL_NEWS_CACHE_KEY = 'cachedNews';

/**
 * Gültigkeitsdauer der lokalen Artikelkopie.
 *
 * Bewusst gemeinsam für App und Admin: Das Admin behauptet sonst eine andere
 * Grenze als das Frontend tatsächlich anwendet, und die beiden Werte laufen bei
 * der nächsten Änderung auseinander.
 */
export const LOCAL_NEWS_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Größe des lokalen Startcaches in Artikeln.
 *
 * Der Browser speichert bewusst **nur den Anfang** der Liste, damit der Start
 * schnell bleibt und `localStorage` nicht überläuft. Deshalb enthält die Kopie
 * regelmäßig deutlich weniger Quellen als der aktive Snapshot – das ist der
 * Normalfall und kein Hinweis auf ein Feed-Problem.
 */
export const LOCAL_NEWS_CACHE_MAX_ARTICLES = 32;

export type LocalNewsCacheState =
    | { status: 'missing' }
    | { status: 'unreadable' }
    | { status: 'expired'; timestamp: number }
    | {
        status: 'usable';
        timestamp: number;
        /** Tatsächlich gespeicherte Artikel, höchstens `LOCAL_NEWS_CACHE_MAX_ARTICLES`. */
        articleCount: number;
        sources: string[];
        /** `null` heißt Legacy oder ohne Angabe – nie „gleich wie aktiv“. */
        snapshot: NewsSnapshotPointer | null;
    };

/**
 * Liest die lokale Artikelkopie mit **demselben** Laufzeit-Decoder wie das
 * Frontend und meldet, ob sie dort überhaupt noch verwendbar wäre.
 *
 * Die vier Zustände sind bewusst unterscheidbar: Nur `usable` erlaubt Aussagen
 * über die im Browser sichtbaren Quellen. Ein fehlender, unlesbarer oder
 * abgelaufener Eintrag bleibt „unbekannt“ und darf keine Zuordnung erfinden.
 */
export function readLocalNewsCache(
    rawValue: string | null,
    now: number,
    ttlMs: number = LOCAL_NEWS_CACHE_TTL_MS,
): LocalNewsCacheState {
    if (rawValue === null) {
        return { status: 'missing' };
    }

    let decoded;
    try {
        decoded = decodeCachedNews(JSON.parse(rawValue));
    } catch {
        return { status: 'unreadable' };
    }

    if (decoded === undefined) {
        return { status: 'unreadable' };
    }

    // Dieselbe Frischeprüfung wie in `App.tsx`: nur eine dort noch verwendete
    // Kopie darf im Admin als „vom Frontend verwendbar“ gelten.
    if (!(now - decoded.timestamp < ttlMs)) {
        return { status: 'expired', timestamp: decoded.timestamp };
    }

    return {
        status: 'usable',
        timestamp: decoded.timestamp,
        articleCount: decoded.articles.length,
        sources: [...new Set(decoded.articles.map(article => article.source))],
        snapshot: decoded.snapshot ?? null,
    };
}
