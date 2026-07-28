// Laufzeitvertrag für Ankündigungen (Roadmap-Paket S2).
//
// Liegt in `shared/`, weil Admin-Panel und Edge-Handler dieselben Grenzen
// verwenden: das Textfeld begrenzt genauso, wie der Server prüft. Bewusst ohne
// `node:`-Importe, damit der Vertrag in der Edge-Runtime läuft.

/**
 * Muss deckungsgleich mit `AnnouncementType` in `types.ts` bleiben.
 * `tests/server/unit/announcement-contract.test.js` prüft das.
 *
 * @type {ReadonlyArray<import('../types').AnnouncementType>}
 */
export const ANNOUNCEMENT_TYPES = Object.freeze([
    'info',
    'warning',
    'maintenance',
    'celebration',
]);

export const ANNOUNCEMENT_MESSAGE_MAX_LENGTH = 500;

/**
 * Prüft und normalisiert eine eingehende Ankündigung.
 *
 * Unbekannte Zusatzfelder werden ignoriert statt abgelehnt; `id` und
 * `createdAt` vergibt ausschliesslich der Server und werden deshalb aus dem
 * Eingangsobjekt nicht übernommen.
 *
 * @param {unknown} payload
 * @returns {{ value: { message: string, type: import('../types').AnnouncementType, isActive: boolean }|null,
 *            error: string|null, field: string|null }}
 */
export function parseAnnouncementPayload(payload) {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return { value: null, error: 'Es wurden keine Ankündigungsdaten übermittelt.', field: null };
    }

    const { isActive, message, type } = payload;

    if (typeof message !== 'string' || message.trim() === '') {
        return { value: null, error: 'Die Nachricht der Ankündigung fehlt.', field: 'message' };
    }

    if (message.length > ANNOUNCEMENT_MESSAGE_MAX_LENGTH) {
        return {
            value: null,
            error: `Die Nachricht darf höchstens ${ANNOUNCEMENT_MESSAGE_MAX_LENGTH} Zeichen lang sein.`,
            field: 'message',
        };
    }

    if (!ANNOUNCEMENT_TYPES.includes(type)) {
        return {
            value: null,
            error: `Der Typ muss einer von ${ANNOUNCEMENT_TYPES.join(', ')} sein.`,
            field: 'type',
        };
    }

    // Nur ein wirklich fehlendes Feld bedeutet "aktiv" – das war schon vor S2
    // so. Ein gesetztes Feld muss ein Boolean sein: sonst würde etwa der String
    // "false" die Ankündigung veröffentlichen. Auch ein ausdrückliches null
    // wird abgelehnt, statt still auf "aktiv" zu fallen.
    if (isActive !== undefined && typeof isActive !== 'boolean') {
        return { value: null, error: '„isActive" muss true oder false sein.', field: 'isActive' };
    }

    return {
        value: {
            message: message.trim(),
            type,
            isActive: isActive === undefined ? true : isActive,
        },
        error: null,
        field: null,
    };
}
