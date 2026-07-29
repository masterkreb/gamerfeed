// Gemeinsame, Edge-kompatible Speicherregeln fuer unveraenderliche
// News-Generationen (Roadmap O3b).
//
// Diese Datei enthaelt absichtlich weder `node:`-Importe noch Providerlogik.
// Cron, Edge-Endpunkte und Tests leiten aus derselben Snapshot-ID dieselben
// Schluessel ab. Ein Leser nennt eine Generation nur, wenn sowohl ihr
// vollstaendiges Manifest als auch der dazugehoerige unveraenderliche Payload
// vorhanden sind.

import {
    NEWS_SNAPSHOT_SCHEMA_VERSION,
    NEWS_SNAPSHOT_POINTER_KEY,
    SNAPSHOT_ID_PATTERN,
    normalizeSnapshotPointer,
} from './news-snapshot.js';

export const NEWS_SNAPSHOT_KEY_PREFIX = 'news_snapshot';

export const NEWS_SNAPSHOT_VARIANTS = Object.freeze({
    FULL: 'full',
    PREVIEW: 'preview',
    MEDIUM: 'medium',
});

const VARIANTS = Object.freeze([
    NEWS_SNAPSHOT_VARIANTS.FULL,
    NEWS_SNAPSHOT_VARIANTS.PREVIEW,
    NEWS_SNAPSHOT_VARIANTS.MEDIUM,
]);

const LEGACY_KEYS = Object.freeze({
    [NEWS_SNAPSHOT_VARIANTS.FULL]: Object.freeze({ key: 'news_cache', limit: null }),
    [NEWS_SNAPSHOT_VARIANTS.PREVIEW]: Object.freeze({ key: 'news_cache_16', limit: 16 }),
    [NEWS_SNAPSHOT_VARIANTS.MEDIUM]: Object.freeze({ key: 'news_cache_64', limit: 64 }),
});

export function legacySnapshotRollbackEnabled(value) {
    return typeof value === 'string' && ['1', 'true'].includes(value.trim().toLowerCase());
}

function isSnapshotId(value) {
    return typeof value === 'string' && SNAPSHOT_ID_PATTERN.test(value);
}

function isVariant(value) {
    return VARIANTS.includes(value);
}

/**
 * Unveraenderlicher Payload-Key einer Generation.
 *
 * @param {unknown} snapshotId
 * @param {unknown} variant
 * @returns {string|null}
 */
export function newsSnapshotPayloadKey(snapshotId, variant) {
    if (!isSnapshotId(snapshotId) || !isVariant(variant)) return null;
    return `${NEWS_SNAPSHOT_KEY_PREFIX}:${snapshotId}:${variant}`;
}

/**
 * Manifest-Key einer Generation.
 *
 * Das Manifest wird erst geschrieben, nachdem alle drei Payloads vorhanden
 * sind. Es ist damit die Vollstaendigkeitsmarke einer Generation, nicht ihr
 * Aktivierungszeiger.
 *
 * @param {unknown} snapshotId
 * @returns {string|null}
 */
export function newsSnapshotMetadataKey(snapshotId) {
    if (!isSnapshotId(snapshotId)) return null;
    return `${NEWS_SNAPSHOT_KEY_PREFIX}:${snapshotId}:meta`;
}

/**
 * Liest die optionale vorherige Generation aus dem erweiterten Active-Pointer.
 *
 * Alte O3a-Leser ignorieren das Zusatzfeld. O3b nutzt es, damit laufende
 * Clients und ein Rollback genau eine Generation zurueck weiterhin lesen
 * koennen.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function previousSnapshotId(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return isSnapshotId(raw.previousSnapshotId) ? raw.previousSnapshotId : null;
}

function normalizePayloadDescriptor(raw, snapshotId, variant) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const expectedKey = newsSnapshotPayloadKey(snapshotId, variant);
    const count = Number(raw.count);
    const bytes = Number(raw.bytes);

    if (
        raw.key !== expectedKey
        || !Number.isSafeInteger(count)
        || count < 0
        || !Number.isSafeInteger(bytes)
        || bytes < 2
    ) {
        return null;
    }

    return { key: expectedKey, count, bytes };
}

/**
 * Strenge Vollstaendigkeitspruefung des unveraenderlichen Manifests.
 *
 * @param {unknown} raw
 * @returns {{
 *   schemaVersion: number,
 *   snapshotId: string,
 *   createdAt: string,
 *   articleCount: number,
 *   runId: string|null,
 *   complete: true,
 *   sources: string[],
 *   payloads: Record<'full'|'preview'|'medium', {key: string, count: number, bytes: number}>,
 * }|null}
 */
export function normalizeNewsSnapshotMetadata(raw) {
    const pointer = normalizeSnapshotPointer(raw);
    if (!pointer || raw.complete !== true) return null;

    const payloads = {};
    for (const variant of VARIANTS) {
        const descriptor = normalizePayloadDescriptor(
            raw.payloads?.[variant],
            pointer.snapshotId,
            variant,
        );
        if (!descriptor) return null;
        payloads[variant] = descriptor;
    }

    if (payloads.full.count !== pointer.articleCount) return null;

    if (!Array.isArray(raw.sources) || raw.sources.some(source => (
        typeof source !== 'string' || source.trim() === '' || source.length > 160
    ))) {
        return null;
    }

    return {
        ...pointer,
        createdAt: pointer.createdAt,
        complete: true,
        sources: [...new Set(raw.sources)],
        payloads,
    };
}

async function readGeneration(cache, snapshotId, variant) {
    const metadataKey = newsSnapshotMetadataKey(snapshotId);
    if (!metadataKey) return null;

    const metadata = normalizeNewsSnapshotMetadata(await cache.get(metadataKey));
    if (!metadata || metadata.snapshotId !== snapshotId) return null;

    const descriptor = metadata.payloads[variant];
    const articles = await cache.get(descriptor.key);
    if (!Array.isArray(articles) || articles.length !== descriptor.count) return null;

    return {
        articles,
        snapshot: normalizeSnapshotPointer(metadata),
        metadata,
        source: 'snapshot',
    };
}

async function readLegacy(cache, variant) {
    const legacy = LEGACY_KEYS[variant];
    let articles = await cache.get(legacy.key);

    if (!Array.isArray(articles) && legacy.limit !== null) {
        const full = await cache.get(LEGACY_KEYS.full.key);
        if (Array.isArray(full)) articles = full.slice(0, legacy.limit);
    }

    if (!Array.isArray(articles)) return null;

    return {
        articles,
        snapshot: null,
        metadata: null,
        source: 'legacy',
    };
}

/**
 * Liest einen nachweislich an seine Generation gebundenen Payload.
 *
 * Ein gepinnter Client darf nur die aktive oder unmittelbar vorherige
 * Generation anfragen. Ist sie nicht mehr vollstaendig vorhanden, wird die
 * aktive Generation versucht. Erst danach folgt der Legacy-Fallback – immer
 * ohne Snapshot-Header.
 *
 * @param {{ get(key: string): Promise<unknown> }} cache
 * @param {{
 *   variant?: 'full'|'preview'|'medium',
 *   requestedSnapshotId?: string|null,
 *   allowLegacy?: boolean,
 * }} [options]
 */
export async function readBoundNewsSnapshot(cache, {
    variant = NEWS_SNAPSHOT_VARIANTS.FULL,
    requestedSnapshotId = null,
    allowLegacy = true,
} = {}) {
    if (!isVariant(variant)) throw new TypeError(`Unbekannte Snapshot-Variante: ${variant}`);

    const rawActive = await cache.get(NEWS_SNAPSHOT_POINTER_KEY);
    const active = normalizeSnapshotPointer(rawActive);
    const previousId = active ? previousSnapshotId(rawActive) : null;

    if (active) {
        const requestedId = isSnapshotId(requestedSnapshotId)
            && (requestedSnapshotId === active.snapshotId || requestedSnapshotId === previousId)
            ? requestedSnapshotId
            : active.snapshotId;

        const requested = await readGeneration(cache, requestedId, variant);
        if (requested) return requested;

        if (requestedId !== active.snapshotId) {
            const current = await readGeneration(cache, active.snapshotId, variant);
            if (current) return current;
        }
    }

    return allowLegacy ? readLegacy(cache, variant) : null;
}

/**
 * Liest nur das Manifest des aktiven Snapshots.
 *
 * Die Health-API braucht Quellen und Generation, nicht mehrere Megabyte
 * Artikel. Ein unvollstaendiger oder ungueltiger Stand gilt als Legacy.
 *
 * @param {{ get(key: string): Promise<unknown> }} cache
 */
export async function readActiveNewsSnapshotMetadata(cache) {
    const rawActive = await cache.get(NEWS_SNAPSHOT_POINTER_KEY);
    const active = normalizeSnapshotPointer(rawActive);
    if (!active) return null;

    const key = newsSnapshotMetadataKey(active.snapshotId);
    const metadata = normalizeNewsSnapshotMetadata(await cache.get(key));
    return metadata?.snapshotId === active.snapshotId ? metadata : null;
}

/**
 * Erkennt einen generationsgebundenen Key fuer Garbage Collection.
 *
 * @param {unknown} key
 * @returns {{ snapshotId: string, suffix: string }|null}
 */
export function parseNewsSnapshotKey(key) {
    if (typeof key !== 'string') return null;

    const prefix = `${NEWS_SNAPSHOT_KEY_PREFIX}:`;
    if (!key.startsWith(prefix)) return null;

    const remainder = key.slice(prefix.length);
    const separator = remainder.lastIndexOf(':');
    if (separator <= 0) return null;

    const snapshotId = remainder.slice(0, separator);
    const suffix = remainder.slice(separator + 1);
    if (!isSnapshotId(snapshotId) || ![...VARIANTS, 'meta'].includes(suffix)) return null;

    return { snapshotId, suffix };
}

export const NEWS_SNAPSHOT_LEGACY_KEYS = LEGACY_KEYS;
