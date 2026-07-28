import { requireAdminApiAuth, requireAdminApiMutation } from './admin-auth.js';
import {
    adminEmptyResponse,
    adminErrorResponse,
    adminJsonResponse,
    internalErrorResponse,
    methodNotAllowedResponse,
    readAdminJsonObject,
    validationErrorResponse,
} from './admin-api.js';
import {
    mapNewFeedToDatabaseRow,
    mapFeedRow,
    mapFeedRows,
    mapFeedUpdateToDatabaseRow,
} from './feed-mapper.js';
import {
    parseFeedCreatePayload,
    parseFeedDeletePayload,
    parseFeedUpdatePayload,
} from './feed-validation.js';
import { API_ERROR_CODES } from '../shared/api-errors.js';

/**
 * Tagged-Template-Funktion im Stil von `@vercel/postgres`.
 *
 * Die Abfragen bleiben bewusst im getesteten Handler statt in der dünnen
 * API-Datei; Tests reichen eine eigene Implementierung herein und kommen so
 * ohne Datenbank aus.
 */
export type FeedsSql = <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
) => Promise<{ rows: T[] }>;

interface FeedsHandlerOptions {
    sql: FeedsSql;
    /** Injizierbare Uhr: die Feed-ID enthält einen Zeitstempel. */
    now?: () => Date;
    /** Zugangsdaten; injizierbar, damit Tests `process.env` nicht anfassen. */
    env?: Record<string, string | undefined>;
    logger?: Pick<Console, 'error'>;
}

const ALLOWED_METHODS = 'GET, POST, PUT, DELETE';

// A helper function to create a new, URL-safe feed ID from its name
function createFeedId(name: string, now: Date): string {
    const sanitizedName = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
        .replace(/\s+/g, '-')          // Replace spaces with hyphens
        .replace(/-+/g, '-')           // Replace multiple hyphens with a single one
        .replace(/^-+|-+$/g, '');      // Trim leading/trailing hyphens

    return `${sanitizedName}-${now.getTime()}`;
}

export function createFeedsHandler({
    sql,
    now = () => new Date(),
    env = process.env,
    logger = console,
}: FeedsHandlerOptions) {
    return async function handler(req: Request): Promise<Response> {
        const authResponse = ['POST', 'PUT', 'DELETE'].includes(req.method)
            ? requireAdminApiMutation(req, env)
            : requireAdminApiAuth(req, env);
        if (authResponse) {
            return authResponse;
        }

        try {
            // --- GET all feeds ---
            if (req.method === 'GET') {
                const { rows } = await sql`SELECT * FROM feeds ORDER BY name;`;
                return adminJsonResponse(mapFeedRows(rows));
            }

            // --- POST (create) a new feed ---
            if (req.method === 'POST') {
                const { value: body, error: bodyError } = await readAdminJsonObject(req);
                if (bodyError) {
                    return bodyError;
                }

                const parsed = parseFeedCreatePayload(body);
                if (!parsed.value) {
                    return validationErrorResponse(parsed);
                }

                const feedRow = mapNewFeedToDatabaseRow(
                    parsed.value,
                    createFeedId(parsed.value.name, now()),
                );

                const result = await sql`
                    INSERT INTO feeds (id, name, url, language, priority, needs_scraping, update_interval)
                    VALUES (${feedRow.id}, ${feedRow.name}, ${feedRow.url}, ${feedRow.language}, ${feedRow.priority}, ${feedRow.needs_scraping}, ${feedRow.update_interval})
                    RETURNING *;
                `;

                return adminJsonResponse(mapFeedRow(result.rows[0]), 201);
            }

            // --- PUT (update) an existing feed ---
            if (req.method === 'PUT') {
                const { value: body, error: bodyError } = await readAdminJsonObject(req);
                if (bodyError) {
                    return bodyError;
                }

                const parsed = parseFeedUpdatePayload(body);
                if (!parsed.value) {
                    return validationErrorResponse(parsed);
                }

                const feedRow = mapFeedUpdateToDatabaseRow(parsed.value);

                const result = await sql`
                    UPDATE feeds
                    SET name = ${feedRow.name}, url = ${feedRow.url}, language = ${feedRow.language}, priority = ${feedRow.priority}, needs_scraping = ${feedRow.needs_scraping}
                    WHERE id = ${feedRow.id}
                    RETURNING *;
                `;

                if (!result.rows[0]) {
                    return adminErrorResponse(
                        404,
                        API_ERROR_CODES.NOT_FOUND,
                        'Es gibt keinen Feed mit dieser ID.',
                    );
                }

                return adminJsonResponse(mapFeedRow(result.rows[0]));
            }

            // --- DELETE a feed ---
            if (req.method === 'DELETE') {
                const { value: body, error: bodyError } = await readAdminJsonObject(req);
                if (bodyError) {
                    return bodyError;
                }

                const parsed = parseFeedDeletePayload(body);
                if (!parsed.value) {
                    return validationErrorResponse(parsed);
                }

                // Bewusst idempotent: ein zweiter Löschversuch ist kein Fehler
                // und soll im Admin keine Fehlermeldung erzeugen.
                await sql`DELETE FROM feeds WHERE id = ${parsed.value.id};`;
                return adminEmptyResponse(204);
            }

            return methodNotAllowedResponse(req.method, ALLOWED_METHODS);

        } catch (error) {
            // Der Originaltext bleibt im Log: er trägt Verbindungsdaten,
            // Tabellennamen und Stacktraces.
            logger.error('API Error in /api/feeds:', error);
            return internalErrorResponse();
        }
    };
}
