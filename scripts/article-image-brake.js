// Bremse fuer den Play3-Bildpfad - nur im Speicher eines Laufs.
//
// Play3 liefert im RSS keine Bilder. Jede Artikelseite wird deshalb einzeln
// abgerufen: zuerst direkt, danach ueber den eng begrenzten Bildmodus des
// PHP-Proxys. Lehnt ein Weg schon den ersten Versuch ab, provoziert jeder weitere
// Artikel nur dieselbe Antwort - und kostet Budget, Zeit und die Geduld der
// Gegenstelle.
//
// Die Bremse haelt deshalb je Weg fest, ob er fuer den Rest des **laufenden**
// Laufs ausgesetzt ist. Ihr Zustand lebt ausschliesslich im Arbeitsspeicher: es
// gibt keinen KV-Schluessel, und ein neuer Lauf beginnt immer ohne Bremse. Genau
// so kehrt GamerFeed von selbst zum Direktabruf zurueck, sobald er wieder
// funktioniert - jeder Lauf prueft den Direktweg wieder genau einmal.
//
// Das Modul ist reine Zustandslogik ohne Netz, Uhr oder Log. Wer einen Versuch
// ausfuehrt, meldet sein Ergebnis mit `record()` und protokolliert die Meldung,
// falls dabei eine Bremse gegriffen hat.

/** Die beiden Wege, auf denen eine Play3-Artikelseite abgerufen wird. */
export const ARTICLE_IMAGE_ROUTES = Object.freeze({
    DIRECT: 'direct',
    PROXY: 'proxy',
});

/** Direktweg: diese Antworten setzen ihn fuer den Rest des Laufs aus. */
export const DIRECT_STOP_STATUSES = Object.freeze([401, 403, 429]);

/**
 * Proxyweg: diese Antworten setzen ihn fuer den Rest des Laufs aus.
 *
 * Ein 422 heisst hier vermutlich, dass die hochgeladene PHP-Datei den Bildmodus
 * noch nicht kennt und jede Adresse wie eine Feed-Adresse gegen ihre Allowlist
 * prueft.
 */
export const PROXY_STOP_STATUSES = Object.freeze([401, 403, 422, 429]);

/**
 * Proxyweg: so viele Fehlschlaege in Folge setzen ihn aus.
 *
 * Als Fehlschlag zaehlen Netzwerkfehler, Zeitueberschreitungen und 5xx-Antworten
 * - alles, was keine verwertbare Antwort der Gegenstelle ist. Eine einzelne
 * Stoerung bremst deshalb noch nicht; jede andere Antwort setzt den Zaehler
 * zurueck.
 */
export const PROXY_MAX_CONSECUTIVE_FAILURES = 3;

const DIRECT_STOP_SET = new Set(DIRECT_STOP_STATUSES);
const PROXY_STOP_SET = new Set(PROXY_STOP_STATUSES);

/**
 * Was ein gemeldetes Ergebnis ausgeloest hat. `null` heisst: keine Bremse gegriffen.
 *
 * @typedef {{
 *   route: string,
 *   reason: 'status' | 'failures',
 *   status: number | null,
 *   failures: number,
 * }} BrakeEngagement
 */

/**
 * Erzeugt die Bremse eines Laufs.
 *
 * Einzelartikel-Ergebnisse - ein 404, eine Seite ohne Bild - bremsen nie: sie
 * betreffen nur diesen Artikel.
 */
export function createArticleImageBrake() {
    const stopped = {
        [ARTICLE_IMAGE_ROUTES.DIRECT]: false,
        [ARTICLE_IMAGE_ROUTES.PROXY]: false,
    };
    let consecutiveProxyFailures = 0;

    return {
        /**
         * Ist dieser Weg fuer den Rest des Laufs ausgesetzt?
         *
         * @param {string} route
         * @returns {boolean}
         */
        isStopped(route) {
            return stopped[route] === true;
        },

        /**
         * Meldet das Ergebnis eines Versuchs.
         *
         * `status` ist der gemeldete HTTP-Status, `failed` ein Versuch ganz ohne
         * Antwort (Netzwerkfehler oder Zeitueberschreitung). Eine Bremse greift
         * hoechstens einmal je Weg und Lauf; danach liefert der Weg `null`, damit
         * pro Bremse genau eine Meldung entsteht.
         *
         * @param {string} route
         * @param {{ status?: number | null, failed?: boolean }} [outcome]
         * @returns {BrakeEngagement | null}
         */
        record(route, { status = null, failed = false } = {}) {
            if (stopped[route] !== false) return null;

            if (route === ARTICLE_IMAGE_ROUTES.DIRECT) {
                if (!DIRECT_STOP_SET.has(status)) return null;

                stopped[route] = true;
                return { route, reason: 'status', status, failures: 0 };
            }

            if (PROXY_STOP_SET.has(status)) {
                stopped[route] = true;
                return { route, reason: 'status', status, failures: 0 };
            }

            if (failed || (typeof status === 'number' && status >= 500)) {
                consecutiveProxyFailures += 1;
                if (consecutiveProxyFailures < PROXY_MAX_CONSECUTIVE_FAILURES) return null;

                stopped[route] = true;
                return { route, reason: 'failures', status, failures: consecutiveProxyFailures };
            }

            // Eine verwertbare Antwort - auch ein 404 oder eine Seite ohne Bild -
            // belegt, dass der Weg funktioniert.
            consecutiveProxyFailures = 0;
            return null;
        },
    };
}
