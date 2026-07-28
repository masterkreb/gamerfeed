# Admin-API: Verträge, Fehlercodes und Cache

Stand: 28. Juli 2026 (Roadmap-Paket S2)

Die geschützten Endpunkte `/api/feeds`, `/api/announcement` und
`/api/get-health-data` prüfen eingehendes JSON zur Laufzeit, antworten mit
stabilen Fehlercodes und liefern nichts Zwischenspeicherbares aus.

## Antwortformat

Erfolg ist der jeweilige Datensatz. Jeder Fehler sieht gleich aus:

```json
{
  "error": "Die Sprache muss de oder en sein.",
  "code": "validation_failed",
  "field": "language"
}
```

- `error` ist für Menschen und darf sich ändern.
- `code` ist für Programme und ändert sich **nicht** mehr stillschweigend.
- `field` erscheint nur bei Validierungsfehlern, die genau ein Feld betreffen.

Die Codes stehen in [`shared/api-errors.js`](../../shared/api-errors.js).

| Code | Status | Bedeutung |
|---|---|---|
| `unauthorized` | 401 | Zugangsdaten fehlen oder stimmen nicht |
| `forbidden` | 403 | authentifiziert, aber die Origin passt nicht (CSRF-Schutz) |
| `auth_unavailable` | 503 | auf dem Server sind keine Admin-Zugangsdaten konfiguriert |
| `method_not_allowed` | 405 | Methode auf diesem Endpunkt nicht vorgesehen |
| `invalid_json` | 400 | der Rumpf ist überhaupt kein gültiges JSON |
| `invalid_payload` | 400 | gültiges JSON, aber kein Objekt (Array, String, Zahl, `null`) |
| `validation_failed` | 400 | Objekt, aber ein Feld verletzt den Vertrag |
| `not_found` | 404 | der angesprochene Datensatz existiert nicht |
| `internal_error` | 500 | interner Fehler; Einzelheiten stehen ausschließlich im Log |

Die Trennung von `invalid_json` und `invalid_payload` ist Absicht: der Client
erkennt daran, ob sein Serialisierer oder sein Datenmodell falsch liegt.

`services/feeds-api.ts` liest `code` und `field` in `FeedsApiError` mit;
Antworten ohne diese Felder ergeben `null` statt eines Fehlers.

## Interne Fehler

Eine 500 nennt **nie** den Originaltext. Verbindungsfehler von Postgres oder KV
tragen Host, Benutzernamen, Tabellennamen, Query-Tokens und Stacktraces mit
sich; der Client bekommt stattdessen:

```json
{ "error": "Es ist ein interner Serverfehler aufgetreten.", "code": "internal_error" }
```

Der Originaltext geht über `logger.error` ins Serverlog. Tests belegen für jede
Methode, dass weder Verbindungszeichenfolge noch Token in der Antwort landen.

## Cache

| Antwort | Cache-Control |
|---|---|
| alle geschützten Admin-Antworten – auch 204, Fehler und Auth-Grenzen | `private, no-store` |
| öffentlicher `GET /api/announcement` | `s-maxage=60, stale-while-revalidate=120` |

`private` verbietet geteilte Caches (CDN, Proxy), `no-store` zusätzlich das
Ablegen im Browser. Eine gecachte 401 wäre genauso schädlich wie ein gecachter
Datensatz.

## Verträge

### Feed erstellen (`POST /api/feeds`)

| Feld | Regel |
|---|---|
| `name` | String, nach `trim` nicht leer, höchstens 120 Zeichen; wird getrimmt gespeichert |
| `url` | String, höchstens 2048 Zeichen, danach `shared/url-policy.js`; keine privaten oder lokalen Ziele |
| `language` | `de` oder `en` |
| `priority` | `primary` oder `secondary` |
| `needsScraping` | optional; wenn gesetzt, echtes Boolean. Fehlt es, gilt `false` |

`id` und `update_interval` vergibt ausschließlich der Server.

### Feed aktualisieren (`PUT /api/feeds`)

Wie oben, zusätzlich `id`: String, nach `trim` nicht leer, höchstens 160
Zeichen. Die ID wird **vor** den übrigen Feldern geprüft. Ein unbekannter Feed
ergibt 404 mit `not_found`.

### Feed löschen (`DELETE /api/feeds`)

Nur `id` nach derselben Regel. Der Löschvorgang ist **idempotent**: ein zweiter
Versuch ergibt wieder 204, keine 404. Sonst würde ein Doppelklick im Admin eine
Fehlermeldung erzeugen, obwohl das Ziel erreicht ist.

### Ankündigung speichern (`POST /api/announcement`)

| Feld | Regel |
|---|---|
| `message` | String, nach `trim` nicht leer, höchstens 500 Zeichen; wird getrimmt gespeichert |
| `type` | `info`, `warning`, `maintenance` oder `celebration` |
| `isActive` | optional; wenn gesetzt, echtes Boolean. Fehlt es, gilt `true` |

`id` und `createdAt` vergibt ausschließlich der Server; mitgeschickte Werte
werden verworfen. Die Grenzen stehen in
[`shared/announcement-contract.js`](../../shared/announcement-contract.js) und
begrenzen auch das Textfeld im Admin-Panel.

**Unbekannte Zusatzfelder werden ignoriert, nicht abgelehnt.** Ein Client, der
ein Feld mehr schickt, soll nicht ohne Not scheitern.

## Inaktive Ankündigungen

Der öffentliche `GET /api/announcement` liefert eine inaktive Ankündigung als
`null` – daran ändert sich nichts. Für den Admin gibt es einen ausdrücklich
geschützten Abruf:

```text
GET /api/announcement?admin=1
```

- verlangt **auch beim GET** Basic Authentication;
- liefert den gespeicherten Stand unverändert, aktiv oder nicht;
- trägt `private, no-store`.

Der Query-String ist Teil des Cache-Keys, der Admin-Abruf bekommt also einen
eigenen Eintrag und ist ohnehin unspeicherbar. Eine öffentliche Anfrage kann so
nicht an eine inaktive Ankündigung kommen. Jeder andere Parameterwert
(`?admin=0`, `?admin=true`, `?Admin=1`) bleibt der öffentliche Pfad.

Damit kann der Admin eine abgeschaltete Ankündigung wieder laden, bearbeiten,
aktivieren und löschen – vorher war sie für ihn unerreichbar.

## Testbarkeit

Die Handler liegen in `server/feeds-handler.ts`,
`server/announcement-handler.ts` und `server/health-data-handler.ts`. SQL, KV,
Uhr und Zugangsdaten werden injiziert; die Dateien unter `api/` sind nur noch
die Verdrahtung mit `@vercel/postgres` beziehungsweise `@vercel/kv`.

Gemeinsame Attrappen stehen in `tests/server/helpers/admin-api.js`. **Kein Test
berührt eine Datenbank oder einen KV-Speicher.**

## Bewusst nicht enthalten

- Kein Rate Limit für Admin-Authentifizierung – das ist S3.
- Keine Security-Header oder CSP – das ist S4.
- Keine Absicherung gegen doppelte Mutationen durch Doppelklick und keine
  Änderungen an Tabs oder Fokusverhalten – das sind A1a und A1b.
- Keine Prüfung auf Steuerzeichen im Ankündigungstext. Die Ausgabe läuft über
  React und ist damit escaped; eine eigene Zeichenprüfung würde die
  E-Mail-spezifische Logik aus `server/contact-utils.js` ohne Gewinn
  duplizieren.
