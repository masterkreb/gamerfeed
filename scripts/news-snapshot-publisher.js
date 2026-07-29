// Groessenbegrenzter, unveraenderlicher News-Publish (Roadmap O3b).
//
// Eine Generation wird unter eigenen Keys aufgebaut. Erst wenn Full, Preview,
// Medium, Manifest und die drei Legacy-Keys erfolgreich geschrieben sind,
// schaltet ein letzter Write den Active-Pointer um. Bis dahin sehen moderne
// Leser ausschliesslich die vorherige vollstaendige Generation.

import { randomUUID } from 'node:crypto';
import {
    buildSnapshotPointer,
    compareSnapshots,
    createSnapshotId,
    normalizeSnapshotPointer,
    NEWS_SNAPSHOT_POINTER_KEY,
} from '../shared/news-snapshot.js';
import {
    NEWS_SNAPSHOT_KEY_PREFIX,
    NEWS_SNAPSHOT_LEGACY_KEYS,
    NEWS_SNAPSHOT_VARIANTS,
    newsSnapshotMetadataKey,
    newsSnapshotPayloadKey,
    normalizeNewsSnapshotMetadata,
    parseNewsSnapshotKey,
    previousSnapshotId,
} from '../shared/news-snapshot-store.js';

export const NEWS_SNAPSHOT_PUBLISH_LEASE_KEY = 'news_snapshot_publish_lease';
export const NEWS_SNAPSHOT_PUBLISH_LEASE_MS = 5 * 60 * 1000;
export const NEWS_SNAPSHOT_PUBLISH_LEASE_WAIT_MS = 30 * 1000;
export const NEWS_SNAPSHOT_PUBLISH_LEASE_POLL_MS = 250;
export const NEWS_SNAPSHOT_GC_GRACE_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_NEWS_PAYLOAD_MAX_BYTES = Object.freeze({
    full: 9 * 1024 * 1024,
    medium: 2 * 1024 * 1024,
    preview: 512 * 1024,
});

export const DEFAULT_NEWS_PAYLOAD_SAFETY_RESERVE_BYTES = 64 * 1024;
export const DEFAULT_MAX_SERIALIZED_ARTICLE_BYTES = 64 * 1024;

export const NEWS_ARTICLE_FIELD_LIMITS = Object.freeze({
    id: 512,
    title: 600,
    source: 160,
    publicationDate: 64,
    summary: 2_000,
    link: 4_096,
    imageUrl: 4_096,
});

const ENV_BUDGET_KEYS = Object.freeze({
    full: 'NEWS_CACHE_FULL_MAX_BYTES',
    medium: 'NEWS_CACHE_MEDIUM_MAX_BYTES',
    preview: 'NEWS_CACHE_PREVIEW_MAX_BYTES',
});

const UTF8 = 'utf8';

export class NewsSnapshotPublishError extends Error {
    constructor(message, code = 'snapshot_publish_failed') {
        super(message);
        this.name = 'NewsSnapshotPublishError';
        this.code = code;
    }
}

export class NewsSnapshotPublishConflictError extends NewsSnapshotPublishError {
    constructor(message) {
        super(message, 'snapshot_publish_conflict');
        this.name = 'NewsSnapshotPublishConflictError';
    }
}

function serializedBytes(value) {
    return Buffer.byteLength(JSON.stringify(value), UTF8);
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/**
 * Liest die optionalen Bytebudgets. Fehlerhafte Werte schalten die Grenze nie
 * ab, sondern fallen auf die konservativen Vorgaben zurueck.
 */
export function readNewsPayloadBudgetConfiguration(env = process.env) {
    const maxBytes = {};
    for (const variant of Object.keys(ENV_BUDGET_KEYS)) {
        maxBytes[variant] = positiveInteger(
            env[ENV_BUDGET_KEYS[variant]],
            DEFAULT_NEWS_PAYLOAD_MAX_BYTES[variant],
            { min: 128 * 1024, max: 9 * 1024 * 1024 },
        );
    }

    const safetyReserveBytes = positiveInteger(
        env.NEWS_CACHE_SAFETY_RESERVE_BYTES,
        DEFAULT_NEWS_PAYLOAD_SAFETY_RESERVE_BYTES,
        { min: 1024, max: 1024 * 1024 },
    );

    return { maxBytes, safetyReserveBytes };
}

function truncateText(value, limit) {
    if (value.length <= limit) return value;
    let truncated = value.slice(0, limit);
    const last = truncated.charCodeAt(truncated.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) truncated = truncated.slice(0, -1);
    return truncated;
}

function requiredString(raw, field) {
    if (typeof raw?.[field] !== 'string') return null;
    const value = raw[field].trim();
    return value === '' ? null : value;
}

function normalizeArticle(raw, maxSerializedArticleBytes) {
    let rawBytes;
    try {
        rawBytes = serializedBytes(raw);
    } catch {
        return { article: null, reason: 'invalid' };
    }

    if (rawBytes > maxSerializedArticleBytes) {
        return { article: null, reason: 'oversized' };
    }

    const id = requiredString(raw, 'id');
    const title = requiredString(raw, 'title');
    const source = requiredString(raw, 'source');
    const publicationDate = requiredString(raw, 'publicationDate');
    const summary = typeof raw?.summary === 'string' ? raw.summary.trim() : '';
    const link = requiredString(raw, 'link');
    const imageUrl = requiredString(raw, 'imageUrl');
    const language = raw?.language;

    if (
        !id
        || !title
        || !source
        || !publicationDate
        || !link
        || !imageUrl
        || !['de', 'en'].includes(language)
        || id.length > NEWS_ARTICLE_FIELD_LIMITS.id
        || publicationDate.length > NEWS_ARTICLE_FIELD_LIMITS.publicationDate
        || link.length > NEWS_ARTICLE_FIELD_LIMITS.link
        || imageUrl.length > NEWS_ARTICLE_FIELD_LIMITS.imageUrl
    ) {
        return { article: null, reason: 'invalid' };
    }

    const dateMs = Date.parse(publicationDate);
    if (!Number.isFinite(dateMs)) return { article: null, reason: 'invalid' };

    const article = {
        id,
        title: truncateText(title, NEWS_ARTICLE_FIELD_LIMITS.title),
        source: truncateText(source, NEWS_ARTICLE_FIELD_LIMITS.source),
        publicationDate: new Date(dateMs).toISOString(),
        summary: truncateText(summary, NEWS_ARTICLE_FIELD_LIMITS.summary),
        link,
        imageUrl,
        language,
    };

    if (typeof raw.needsScraping === 'boolean') {
        article.needsScraping = raw.needsScraping;
    }

    const bytes = serializedBytes(article);
    if (bytes > maxSerializedArticleBytes) {
        return { article: null, reason: 'oversized' };
    }

    return { article, bytes, dateMs, reason: null };
}

function arrayBytes(entries) {
    if (entries.length === 0) return 2;
    return 2 + entries.reduce((sum, entry) => sum + entry.bytes, 0) + entries.length - 1;
}

function fitVariant(entries, { maxCount, maxBytes, safetyReserveBytes }) {
    const effectiveMaxBytes = maxBytes - safetyReserveBytes;
    if (effectiveMaxBytes < 2) {
        throw new NewsSnapshotPublishError(
            'Das konfigurierte News-Bytebudget ist kleiner als seine Sicherheitsreserve.',
            'snapshot_budget_invalid',
        );
    }

    const individuallyUsable = entries.filter(entry => entry.bytes + 2 <= effectiveMaxBytes);
    const selected = individuallyUsable.slice(0, maxCount);
    let bytes = arrayBytes(selected);

    while (selected.length > 0 && bytes > effectiveMaxBytes) {
        const removed = selected.pop();
        // Exakte JSON-Array-Rechnung ohne bei jedem entfernten Artikel das
        // ganze Array erneut zu serialisieren: Objektbytes plus das nun
        // entfallene Komma (solange noch ein Eintrag uebrig bleibt).
        bytes -= removed.bytes + (selected.length > 0 ? 1 : 0);
    }

    return {
        entries: selected,
        articles: selected.map(entry => entry.article),
        bytes,
        maxBytes,
        effectiveMaxBytes,
        dropped: entries.length - selected.length,
    };
}

/**
 * Normalisiert, sortiert und begrenzt alle drei Payloads deterministisch.
 *
 * Zuerst werden unbrauchbare beziehungsweise einzeln zu grosse Artikel
 * verworfen. Danach bleibt die stabile newest-first-Reihenfolge erhalten; wenn
 * ein Gesamtbudget nicht reicht, fallen ausschliesslich die aeltesten Eintraege
 * am Ende weg.
 */
export function prepareNewsSnapshotPayloads(articles, {
    maxBytes = DEFAULT_NEWS_PAYLOAD_MAX_BYTES,
    safetyReserveBytes = DEFAULT_NEWS_PAYLOAD_SAFETY_RESERVE_BYTES,
    maxSerializedArticleBytes = DEFAULT_MAX_SERIALIZED_ARTICLE_BYTES,
} = {}) {
    if (!Array.isArray(articles)) {
        throw new NewsSnapshotPublishError('News-Payload ist kein Array.', 'snapshot_payload_invalid');
    }

    const stats = {
        input: articles.length,
        accepted: 0,
        skippedInvalid: 0,
        skippedOversized: 0,
        droppedByBudget: { full: 0, preview: 0, medium: 0 },
    };

    const normalized = [];
    articles.forEach((raw, index) => {
        const result = normalizeArticle(raw, maxSerializedArticleBytes);
        if (!result.article) {
            if (result.reason === 'oversized') stats.skippedOversized += 1;
            else stats.skippedInvalid += 1;
            return;
        }

        normalized.push({ ...result, index });
    });

    normalized.sort((a, b) => b.dateMs - a.dateMs || a.index - b.index);

    const full = fitVariant(normalized, {
        maxCount: Number.MAX_SAFE_INTEGER,
        maxBytes: maxBytes.full,
        safetyReserveBytes,
    });

    if (articles.length > 0 && full.articles.length === 0) {
        throw new NewsSnapshotPublishError(
            'Kein Artikel passt sicher in den Full-Cache.',
            'snapshot_payload_empty',
        );
    }

    const retainedEntries = full.entries;
    const preview = fitVariant(retainedEntries.slice(0, 16), {
        maxCount: 16,
        maxBytes: maxBytes.preview,
        safetyReserveBytes,
    });
    const medium = fitVariant(retainedEntries.slice(0, 64), {
        maxCount: 64,
        maxBytes: maxBytes.medium,
        safetyReserveBytes,
    });

    stats.accepted = full.articles.length;
    stats.droppedByBudget.full = full.dropped;
    stats.droppedByBudget.preview = Math.max(0, Math.min(retainedEntries.length, 16) - preview.articles.length);
    stats.droppedByBudget.medium = Math.max(0, Math.min(retainedEntries.length, 64) - medium.articles.length);

    return { full, preview, medium, stats };
}

function buildMetadata(pointer, payloads) {
    const sources = [...new Set(payloads.full.articles.map(article => article.source))];

    return {
        ...pointer,
        complete: true,
        sources,
        payloads: {
            full: {
                key: newsSnapshotPayloadKey(pointer.snapshotId, NEWS_SNAPSHOT_VARIANTS.FULL),
                count: payloads.full.articles.length,
                bytes: payloads.full.bytes,
            },
            preview: {
                key: newsSnapshotPayloadKey(pointer.snapshotId, NEWS_SNAPSHOT_VARIANTS.PREVIEW),
                count: payloads.preview.articles.length,
                bytes: payloads.preview.bytes,
            },
            medium: {
                key: newsSnapshotPayloadKey(pointer.snapshotId, NEWS_SNAPSHOT_VARIANTS.MEDIUM),
                count: payloads.medium.articles.length,
                bytes: payloads.medium.bytes,
            },
        },
    };
}

async function acquirePublishLease(store, token, {
    leaseMs,
    waitMs,
    pollMs,
    sleep,
    clock,
}) {
    const deadline = clock() + waitMs;

    while (true) {
        const result = await store.set(
            NEWS_SNAPSHOT_PUBLISH_LEASE_KEY,
            token,
            { nx: true, px: leaseMs },
        );
        if (result !== null && result !== false && result !== 0) return;

        const remaining = deadline - clock();
        if (remaining <= 0) {
            throw new NewsSnapshotPublishConflictError(
                'Ein anderer Lauf veroeffentlicht bereits eine News-Generation.',
            );
        }
        await sleep(Math.min(pollMs, remaining));
    }
}

const RELEASE_LEASE_SCRIPT = [
    'if redis.call("get", KEYS[1]) == ARGV[1] then',
    '  return redis.call("del", KEYS[1])',
    'end',
    'return 0',
].join('\n');

const ACTIVATE_POINTER_SCRIPT = [
    'if redis.call("get", KEYS[1]) ~= ARGV[1] then',
    '  return 0',
    'end',
    'redis.call("set", KEYS[2], ARGV[2])',
    'return 1',
].join('\n');

async function releasePublishLease(store, token, logger, redact) {
    try {
        if (typeof store.eval === 'function') {
            await store.eval(
                RELEASE_LEASE_SCRIPT,
                [NEWS_SNAPSHOT_PUBLISH_LEASE_KEY],
                [token],
            );
        }
        // Ohne atomaren Compare-and-Delete bleibt die Lease bewusst bis zu
        // ihrem TTL stehen. Ein get/del-Fallback koennte eine inzwischen neu
        // erworbene Lease eines anderen Writers loeschen.
    } catch (error) {
        logger.warn?.(`   ⚠️  Snapshot-Lease wird ueber ihr TTL freigegeben: ${redact(
            error instanceof Error ? error.message : String(error),
        )}`);
    }
}

async function activatePointer(store, token, pointer) {
    if (typeof store.eval !== 'function') {
        throw new NewsSnapshotPublishError(
            'Der Snapshot-Speicher unterstuetzt keine atomare Pointer-Aktivierung.',
            'snapshot_atomic_activation_unavailable',
        );
    }

    const activated = await store.eval(
        ACTIVATE_POINTER_SCRIPT,
        [NEWS_SNAPSHOT_PUBLISH_LEASE_KEY, NEWS_SNAPSHOT_POINTER_KEY],
        [token, JSON.stringify(pointer)],
    );
    if (activated !== 1 && activated !== '1') {
        throw new NewsSnapshotPublishConflictError(
            'Die Writer-Lease ging vor der Pointer-Aktivierung verloren.',
        );
    }
}

function candidatePointer({ createdAt, runId, articleCount, current }) {
    const snapshotId = createSnapshotId(createdAt, runId);
    if (!snapshotId) {
        throw new NewsSnapshotPublishError(
            'Der Startzeitpunkt des Laufs ist keine gueltige Snapshot-Zeit.',
            'snapshot_time_invalid',
        );
    }

    const pointer = buildSnapshotPointer({ snapshotId, createdAt, articleCount, runId });
    const normalized = normalizeSnapshotPointer(pointer);
    if (!normalized) {
        throw new NewsSnapshotPublishError(
            'Der Generationszeiger konnte nicht normalisiert werden.',
            'snapshot_pointer_invalid',
        );
    }

    return {
        ...normalized,
        previousSnapshotId: current?.snapshotId ?? null,
    };
}

async function writeImmutable(store, key, value) {
    const result = await store.set(key, value, { nx: true });
    if (result === null || result === false || result === 0) {
        throw new NewsSnapshotPublishConflictError(
            'Ein unveraenderlicher Key dieser News-Generation existiert bereits.',
        );
    }
}

async function writeGeneration(store, leaseToken, pointer, payloads, metadata) {
    await writeImmutable(store, metadata.payloads.full.key, payloads.full.articles);
    await writeImmutable(store, metadata.payloads.preview.key, payloads.preview.articles);
    await writeImmutable(store, metadata.payloads.medium.key, payloads.medium.articles);
    await writeImmutable(store, newsSnapshotMetadataKey(pointer.snapshotId), metadata);

    // Dual-Write fuer alte Deployments und einen bewussten Legacy-Rollback.
    // Der Pointer folgt trotzdem zuletzt, damit moderne Leser nie eine
    // Teilgeneration sehen.
    await store.set(NEWS_SNAPSHOT_LEGACY_KEYS.full.key, payloads.full.articles);
    await store.set(NEWS_SNAPSHOT_LEGACY_KEYS.preview.key, payloads.preview.articles);
    await store.set(NEWS_SNAPSHOT_LEGACY_KEYS.medium.key, payloads.medium.articles);

    // Aktivierung und Lease-Pruefung sind **ein** Redis-Schritt. Ein alter
    // Writer kann den Pointer damit auch dann nicht zurueckdrehen, wenn seine
    // Lease waehrend eines ungewoehnlich langsamen Publishes abgelaufen ist
    // und inzwischen ein neuer Writer uebernommen hat.
    await activatePointer(store, leaseToken, pointer);
}

async function scanSnapshotKeys(store) {
    if (typeof store.scan !== 'function') return [];

    const keys = [];
    let cursor = 0;
    do {
        const result = await store.scan(cursor, {
            match: `${NEWS_SNAPSHOT_KEY_PREFIX}:*`,
            count: 200,
        });
        if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[1])) break;
        cursor = result[0];
        keys.push(...result[1]);
    } while (String(cursor) !== '0');

    return keys;
}

/**
 * Entfernt alte Voll- und Teilgenerationen erst nach der Grace Period.
 *
 * Aktiv und vorherig sind unabhaengig vom Alter immer geschuetzt. Ein Fehler
 * hier macht den bereits aktivierten Publish nicht nachtraeglich fatal.
 */
export async function garbageCollectNewsSnapshots(store, {
    activePointer,
    now = () => new Date(),
    graceMs = NEWS_SNAPSHOT_GC_GRACE_MS,
    logger = console,
    redact = message => String(message),
} = {}) {
    try {
        const active = normalizeSnapshotPointer(activePointer);
        const keep = new Set([
            active?.snapshotId,
            previousSnapshotId(activePointer),
        ].filter(Boolean));
        const cutoff = now().getTime() - graceMs;
        let removed = 0;

        for (const key of await scanSnapshotKeys(store)) {
            const parsed = parseNewsSnapshotKey(key);
            if (!parsed || keep.has(parsed.snapshotId)) continue;

            const createdMs = Number(parsed.snapshotId.split('-', 1)[0]);
            if (!Number.isFinite(createdMs) || createdMs > cutoff) continue;

            await store.del(key);
            removed += 1;
        }

        return { removed };
    } catch (error) {
        logger.warn?.(`   ⚠️  Snapshot-Aufraeumen fehlgeschlagen: ${redact(
            error instanceof Error ? error.message : String(error),
        )}`);
        return { removed: 0, failed: true };
    }
}

/**
 * Baut und aktiviert eine neue Generation.
 */
export async function publishNewsSnapshot({
    store,
    articles,
    runId,
    createdAt,
    env = process.env,
    logger = console,
    redact = message => String(message),
    now = () => new Date(),
    leaseMs = NEWS_SNAPSHOT_PUBLISH_LEASE_MS,
    leaseWaitMs = NEWS_SNAPSHOT_PUBLISH_LEASE_WAIT_MS,
    leasePollMs = NEWS_SNAPSHOT_PUBLISH_LEASE_POLL_MS,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    clock = () => Date.now(),
    garbageCollect = true,
    payloadOptions = {},
} = {}) {
    if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
        throw new TypeError('Ein lesender und schreibender Snapshot-Speicher ist erforderlich.');
    }

    const budgetConfiguration = readNewsPayloadBudgetConfiguration(env);
    const payloads = prepareNewsSnapshotPayloads(articles, {
        ...budgetConfiguration,
        ...payloadOptions,
    });

    const leaseToken = `${String(runId || 'unknown')}:${randomUUID()}`;
    await acquirePublishLease(store, leaseToken, {
        leaseMs,
        waitMs: leaseWaitMs,
        pollMs: leasePollMs,
        sleep,
        clock,
    });

    try {
        const rawCurrent = await store.get(NEWS_SNAPSHOT_POINTER_KEY);
        const current = normalizeSnapshotPointer(rawCurrent);
        const pointer = candidatePointer({
            createdAt,
            runId,
            articleCount: payloads.full.articles.length,
            current,
        });

        if (current && compareSnapshots(pointer, current) <= 0) {
            throw new NewsSnapshotPublishConflictError(
                'Eine gleich alte oder neuere News-Generation ist bereits aktiv.',
            );
        }

        const metadata = buildMetadata(pointer, payloads);
        if (!normalizeNewsSnapshotMetadata(metadata)) {
            throw new NewsSnapshotPublishError(
                'Das Snapshot-Manifest ist unvollstaendig.',
                'snapshot_metadata_invalid',
            );
        }

        await writeGeneration(store, leaseToken, pointer, payloads, metadata);

        logger.log?.(
            `   ✅ News-Snapshot ${pointer.snapshotId}: `
            + `${payloads.full.articles.length} Artikel / ${payloads.full.bytes} Bytes`,
        );
        if (payloads.stats.skippedInvalid > 0 || payloads.stats.skippedOversized > 0) {
            logger.warn?.(
                `   ⚠️  Snapshot-Eingaben verworfen: ${payloads.stats.skippedInvalid} ungueltig, `
                + `${payloads.stats.skippedOversized} einzeln zu gross`,
            );
        }
        if (payloads.stats.droppedByBudget.full > 0) {
            logger.warn?.(
                `   ⚠️  ${payloads.stats.droppedByBudget.full} aelteste Artikel `
                + 'wegen des Full-Bytebudgets entfernt',
            );
        }

        if (garbageCollect) {
            await garbageCollectNewsSnapshots(store, {
                activePointer: pointer,
                now,
                logger,
                redact,
            });
        }

        return { pointer, metadata, payloads };
    } finally {
        await releasePublishLease(store, leaseToken, logger, redact);
    }
}

/**
 * Bewusster Rollback auf die unmittelbar vorherige Generation.
 *
 * Die drei Legacy-Keys werden zuerst auf denselben Inhalt gestellt, danach
 * schaltet ein einzelner Pointer-Write um. Der aktuelle Snapshot wird dabei
 * zur neuen vorherigen Generation, sodass der Rueckweg erhalten bleibt.
 */
export async function rollbackToPreviousNewsSnapshot({
    store,
    runId = 'rollback',
    leaseMs = NEWS_SNAPSHOT_PUBLISH_LEASE_MS,
    leaseWaitMs = NEWS_SNAPSHOT_PUBLISH_LEASE_WAIT_MS,
    leasePollMs = NEWS_SNAPSHOT_PUBLISH_LEASE_POLL_MS,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    clock = () => Date.now(),
    logger = console,
    redact = message => String(message),
} = {}) {
    const leaseToken = `${runId}:${randomUUID()}`;
    await acquirePublishLease(store, leaseToken, {
        leaseMs,
        waitMs: leaseWaitMs,
        pollMs: leasePollMs,
        sleep,
        clock,
    });

    try {
        const rawCurrent = await store.get(NEWS_SNAPSHOT_POINTER_KEY);
        const current = normalizeSnapshotPointer(rawCurrent);
        const targetId = current ? previousSnapshotId(rawCurrent) : null;
        if (!current || !targetId) {
            throw new NewsSnapshotPublishError(
                'Keine vorherige News-Generation fuer einen Rollback vorhanden.',
                'snapshot_rollback_unavailable',
            );
        }

        const metadata = normalizeNewsSnapshotMetadata(
            await store.get(newsSnapshotMetadataKey(targetId)),
        );
        if (!metadata || metadata.snapshotId !== targetId) {
            throw new NewsSnapshotPublishError(
                'Die vorherige News-Generation ist nicht vollstaendig.',
                'snapshot_rollback_incomplete',
            );
        }

        const full = await store.get(metadata.payloads.full.key);
        const preview = await store.get(metadata.payloads.preview.key);
        const medium = await store.get(metadata.payloads.medium.key);
        if (
            !Array.isArray(full) || full.length !== metadata.payloads.full.count
            || !Array.isArray(preview) || preview.length !== metadata.payloads.preview.count
            || !Array.isArray(medium) || medium.length !== metadata.payloads.medium.count
        ) {
            throw new NewsSnapshotPublishError(
                'Mindestens ein Payload der vorherigen Generation fehlt.',
                'snapshot_rollback_incomplete',
            );
        }

        await store.set(NEWS_SNAPSHOT_LEGACY_KEYS.full.key, full);
        await store.set(NEWS_SNAPSHOT_LEGACY_KEYS.preview.key, preview);
        await store.set(NEWS_SNAPSHOT_LEGACY_KEYS.medium.key, medium);

        const pointer = {
            ...normalizeSnapshotPointer(metadata),
            previousSnapshotId: current.snapshotId,
        };
        await activatePointer(store, leaseToken, pointer);

        return { pointer, metadata };
    } finally {
        await releasePublishLease(store, leaseToken, logger, redact);
    }
}
