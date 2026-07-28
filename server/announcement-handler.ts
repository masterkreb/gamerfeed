import type { Announcement } from '../types';
import { requireAdminApiAuth, requireAdminApiMutation } from './admin-auth.js';
import {
    adminJsonResponse,
    internalErrorResponse,
    methodNotAllowedResponse,
    readAdminJsonObject,
    validationErrorResponse,
} from './admin-api.js';
import { parseAnnouncementPayload } from '../shared/announcement-contract.js';

export const ANNOUNCEMENT_KV_KEY = 'site_announcement';

/**
 * Query-Parameter für den geschützten Admin-Abruf.
 *
 * Ein eigener Parameter statt einer stillen Erweiterung des öffentlichen GET:
 * die Antwort bekommt dadurch einen eigenen Cache-Key und trägt
 * `private, no-store`. Der öffentliche Pfad kann so gar nicht an eine inaktive
 * Ankündigung kommen – auch nicht über einen geteilten CDN-Eintrag.
 */
export const ANNOUNCEMENT_ADMIN_PARAM = 'admin';
export const ANNOUNCEMENT_ADMIN_VALUE = '1';

const PUBLIC_CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=120';
const ALLOWED_METHODS = 'GET, POST, DELETE';

interface AnnouncementKv {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<unknown>;
    del(key: string): Promise<unknown>;
}

interface AnnouncementHandlerOptions {
    kv: AnnouncementKv;
    /** Injizierbare Uhr: ID und createdAt enthalten einen Zeitstempel. */
    now?: () => Date;
    /** Zugangsdaten; injizierbar, damit Tests `process.env` nicht anfassen. */
    env?: Record<string, string | undefined>;
    logger?: Pick<Console, 'error'>;
}

function isAdminRequest(req: Request): boolean {
    try {
        return new URL(req.url).searchParams.get(ANNOUNCEMENT_ADMIN_PARAM) === ANNOUNCEMENT_ADMIN_VALUE;
    } catch {
        return false;
    }
}

function publicJsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': PUBLIC_CACHE_CONTROL,
        },
    });
}

export function createAnnouncementHandler({
    kv,
    now = () => new Date(),
    env = process.env,
    logger = console,
}: AnnouncementHandlerOptions) {
    return async function handler(req: Request): Promise<Response> {
        const wantsAdminView = isAdminRequest(req);

        // Der Admin-Modus ist immer geschützt – auch beim GET. Ohne diese Zeile
        // wäre der Parameter ein offener Weg an der Sichtbarkeitsregel vorbei.
        if (req.method !== 'GET' || wantsAdminView) {
            const authResponse = ['POST', 'DELETE'].includes(req.method)
                ? requireAdminApiMutation(req, env)
                : requireAdminApiAuth(req, env);
            if (authResponse) {
                return authResponse;
            }
        }

        try {
            if (req.method === 'GET') {
                const announcement = await kv.get<Announcement>(ANNOUNCEMENT_KV_KEY);

                // Der authentifizierte Admin sieht den gespeicherten Stand
                // unverändert, damit er eine abgeschaltete Ankündigung wieder
                // bearbeiten, aktivieren oder löschen kann.
                if (wantsAdminView) {
                    return adminJsonResponse(announcement ?? null);
                }

                if (!announcement || !announcement.isActive) {
                    return publicJsonResponse(null);
                }

                return publicJsonResponse(announcement);
            }

            // POST - Create/Update announcement (server-side protected)
            if (req.method === 'POST') {
                const { value: body, error: bodyError } = await readAdminJsonObject(req);
                if (bodyError) {
                    return bodyError;
                }

                const parsed = parseAnnouncementPayload(body);
                if (!parsed.value) {
                    return validationErrorResponse(parsed);
                }

                const timestamp = now();
                const announcement: Announcement = {
                    id: `announcement-${timestamp.getTime()}`,
                    message: parsed.value.message,
                    type: parsed.value.type,
                    isActive: parsed.value.isActive,
                    createdAt: timestamp.toISOString(),
                };

                await kv.set(ANNOUNCEMENT_KV_KEY, announcement);

                return adminJsonResponse(announcement);
            }

            // DELETE - Remove announcement (server-side protected)
            if (req.method === 'DELETE') {
                await kv.del(ANNOUNCEMENT_KV_KEY);
                return adminJsonResponse({ success: true });
            }

            return methodNotAllowedResponse(req.method, ALLOWED_METHODS);

        } catch (error) {
            // Der Originaltext bleibt im Log: KV-Fehler tragen Endpunkt und
            // Tokenreste mit sich.
            logger.error('Announcement API Error:', error);
            return internalErrorResponse();
        }
    };
}
