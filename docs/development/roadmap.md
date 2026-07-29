# GamerFeed – Projekt-Roadmap

Stand: 29. Juli 2026

Diese Roadmap ordnet die technische Weiterentwicklung von GamerFeed. Sie ist
kein fester Veröffentlichungskalender und keine automatische Freigabe, alle
Punkte auf einmal umzusetzen. Produktideen, Änderungen an externen Diensten und
Produktions-Deployments bleiben bewusste Entscheidungen des Projektinhabers.

## So wird die Roadmap verwendet

Status:

- **bereit**: das nächste klar abgegrenzte Arbeitspaket
- **geplant**: fachlich eingeordnet, aber noch nicht beginnen
- **Entscheidung nötig**: benötigt vor der Umsetzung eine Produkt- oder
  Plattformentscheidung
- **später**: erst nach Messdaten oder erkennbarem Bedarf
- **erledigt**: umgesetzt, geprüft und dokumentiert

Priorität:

- **P0**: laufender Produktionsausfall oder unmittelbar ausnutzbare Lücke
- **P1**: bekanntes Sicherheits-, Datenschutz- oder Zuverlässigkeitsrisiko
- **P2**: wichtige Stabilisierung und Wartbarkeit
- **P3**: Optimierung erst nach Messdaten oder erkennbarem Bedarf

Es wird immer nur **ein Arbeitspaket** bearbeitet. Ein Arbeitspaket darf mehrere
kleine Commits haben, wenn dadurch Tests, Implementierung und Dokumentation
sauber getrennt bleiben. Nach einem vollständigen Meilenstein wird der gesamte
Git-Diff nochmals unabhängig geprüft.

### Definition of Done

Ein Arbeitspaket ist erst abgeschlossen, wenn:

1. das bisherige Verhalten vor einer riskanten Änderung durch Tests
   charakterisiert wurde;
2. die beschriebenen Abnahmekriterien erfüllt sind;
3. `npm test`, `npm run typecheck` und `git diff --check` erfolgreich sind;
   neue Dateien werden zusätzlich vollständig geprüft und nach dem Staging mit
   `git diff --cached --check` erfasst;
4. bei Frontend-, Build- oder Abhängigkeitsänderungen zusätzlich
   `npm run build` erfolgreich ist;
5. relevante Dokumentation im selben Arbeitspaket aktualisiert wurde;
6. notwendige manuelle Schritte ausdrücklich genannt, aber nicht ungefragt auf
   externen Systemen ausgeführt wurden.

## Aktuelle Ausgangslage

Am Ausgangspunkt dieser Roadmap (`1becba1`, Snapshot vom 27. Juli 2026):

- sind keine akuten P0-Produktionsblocker bekannt;
- laufen 129 zentrale Tests sowie TypeScript-Prüfung und Production-Build
  erfolgreich;
- prüft CI Pushes und Pull Requests mit Tests, PHP-Syntaxprüfung, Typecheck und
  Build;
- sind Feed-Abruf, eigener PHP-Fallback, Bildauswahl, Dialogfokus,
  Einstellungs-Tabs und Kontaktformular bereits gezielt abgesichert;
- ist kein Rewrite und kein Wechsel des State-Managements begründet.

Die wichtigsten verbleibenden Risiken liegen an Daten- und Netzwerkgrenzen,
bei der Erkennung veralteter Cron-Daten sowie in einigen noch ungetesteten
Browser- und Request-Abläufen.

**Stand 28. Juli 2026 (Branch `claude/roadmap-batch-1`):** S1a, S1b, T0 und F2
sind abgeschlossen. Serverseitige Abrufe laufen über einen an die geprüften
Adressen gebundenen Transport, Artikel- und Bildadressen unterliegen einer
gemeinsamen Ausgabe-Policy, es gibt ein Chromium-Grundgerüst mit eigenem
CI-Schritt, und der Consent-Lebenszyklus deckt Widerruf und erneute Zustimmung
ab. 178 zentrale Tests und 9 Browser-Abnahmen laufen erfolgreich. Damit
verschiebt sich das Hauptrisiko auf den Cron-Betrieb selbst – dort setzt O1 an.

**Stand 28. Juli 2026 (Branch `claude/o1-cron-heartbeat`):** O1 ist
abgeschlossen. Ein ausgefallener oder erfolgloser Cron-Lauf ist im Admin
erkennbar, statt als alter grüner Status weiterzulaufen. 236 zentrale Tests und
9 Browser-Abnahmen laufen erfolgreich. Das nächste Hauptrisiko ist die fehlende
Laufzeit-Validierung der Admin-Payloads – dort setzt S2 an. Beobachtbarkeit über
den letzten Lauf hinaus (Historie, Alarm) bleibt O4 vorbehalten.

**Stand 28. Juli 2026 (Branch `claude/s2-api-validation`):** S2 ist
abgeschlossen. Die Admin-APIs prüfen eingehendes JSON zur Laufzeit, antworten
mit stabilen Fehlercodes und geben keine internen Datenbank- oder KV-Meldungen
mehr an den Client. 343 zentrale Tests und 9 Browser-Abnahmen laufen
erfolgreich. Damit verschiebt sich das Hauptrisiko zurück auf den Feed-Lauf
selbst: einzelne fehlerhafte Items können weiterhin einen ganzen Feed verwerfen
und externe Aufrufe sind unbegrenzt – dort setzt O2a an.

**Stand 28. Juli 2026 (Branch `claude/o2a-feed-resilience`):** O2a ist
abgeschlossen. Ein kaputtes Einzelelement kostet nicht mehr die ganze Quelle,
jeder externe Aufruf hat Timeout und Byte-Limit, der Proxy wird nur noch für
GamePro versucht, und ein fehlender Core-Wert beendet den Lauf vor dem ersten
externen Zugriff. 427 zentrale Tests und 9 Browser-Abnahmen laufen erfolgreich.
Offen bleibt die **Summe** aller Aufrufe gegen das 30-Minuten-Hardlimit des
Workflows – dort setzt O2b an.

**Stand 28. Juli 2026 (Branch `claude/o2b-deadline-budget`):** O2b ist
abgeschlossen. Der Lauf hat jetzt eine Deadline von 18 Minuten mit 12 Minuten
Reserve vor dem 30-Minuten-Hardlimit, ein gemeinsames Budget von 80
Artikel-Seitenabrufen und drei klar getrennte Ergebniszustände. Zurückgestellte
Arbeit ergibt `degraded` statt stillschweigend `success`. 502 zentrale Tests und
9 Browser-Abnahmen laufen erfolgreich. Das nächste Hauptrisiko liegt bei den
zeitversetzt gecachten News-Endpunkten, die trotz Pointer verschiedene
Generationen liefern können – dort setzt O3a an.

**Stand 29. Juli 2026 (Branch `claude/o3a-generation-read-protocol`):** O3a ist
als sichere Dual-Read-Vorbereitung abgeschlossen. Vertrag, Leseregeln und alle
Consumer stehen und sind getestet; der am 29. Juli beobachtete GameStar-Fall ist
in beiden Richtungen als Regressionstest abgedeckt. **Aktiviert ist das
Protokoll nicht:** neben veränderlichen Legacy-Keys kann eine Kennung ihre
Zugehörigkeit nicht belegen, deshalb entwertet der Cron jeden Zeiger und alle
Endpunkte antworten als Legacy. Der Schutz gegen gemischte Generationen greift
damit erst mit **O3b**, das die unveränderlichen Generationen liefert. 586
zentrale Tests und 17 Browser-Abnahmen laufen erfolgreich.

## Empfohlene Reihenfolge

| ID | Priorität | Status | Ergebnis |
|---|---|---|---|
| R1 | P1 | erledigt | Release-Gate und Preview-Zugriffe abgesichert |
| S1a | P1 | erledigt | Serverziele und Redirects gegen SSRF absichern |
| S1b | P1 | erledigt | Artikel-, Bild- und Ausgabe-URLs sicher behandeln |
| T0 | P1 | erledigt | Kleines Chromium-E2E-Grundgerüst bereitstellen |
| F2 | P1 | erledigt | Consent-Widerruf und Cookie-Einstellungen vervollständigen |
| O1 | P1 | erledigt | Cron-Heartbeat und veraltete Health-Daten sichtbar machen |
| S2 | P1 | erledigt | Admin-API-Payloads validieren und Fehlerausgaben härten |
| O2a | P1 | erledigt | Einzelitem-Fehler, Secrets und Provider-Timeouts absichern |
| O2b | P1 | erledigt | Feed-Kernlauf mit Deadline und Scrape-Budget begrenzen |
| O3a | P1 | erledigt | Generationsgebundenes Leseprotokoll und Migration vorbereiten |
| F1 | P1 | **bereit** | Progressive News-Ladekette gegen veraltete Antworten absichern |
| O3b | P1 | geplant | News-Caches größenbegrenzt und konsistent veröffentlichen |
| F3a | P2 | geplant | Zentrale Tastatur- und DOM-Probleme im Frontend beheben |
| F3b | P2 | geplant | Veraltetes ArticleCard-Rendering verhindern |
| F4a | P2 | geplant | Persistierten Zustand robust validieren |
| F4b | P2 | geplant | Verbliebene i18n-Inkonsistenzen schließen |
| A1a | P2 | geplant | Admin-Mutationen synchron absichern |
| A1b | P2 | geplant | Admin-Tabs und Health-Beschriftung korrigieren |
| O4 | P2 | geplant | Historie, Alarmierung und Proxy-Version beobachtbar machen |
| D1 | P2 | Entscheidung nötig | Datenbankschema, Backup und Restore festlegen |
| D2 | P2 | geplant | Lokale Produktionsschreibvorgänge explizit absichern |
| S3 | P2 | Entscheidung nötig | Rate Limits und SMTP-Laufzeit festlegen |
| S4 | P2 | Entscheidung nötig | Security Headers und CSP einführen |
| X1 | P2 | Entscheidung nötig | Externen PHP-Proxy authentifizieren |
| SC1 | P2 | geplant | GitHub-Actions- und Abhängigkeitswartung härten |

---

## Vorbedingung: Release-Entscheidung

### R1 – Release-Gate und Preview-Zugriffe

**Entscheidung vom 28. Juli 2026:** GamerFeed verwendet die sichere
Pull-Request-Variante mit verpflichtenden CI-/Vercel-Checks, geschütztem
`main`, Production-Secrets ausschließlich in Production und dokumentiertem
Rollback. Ruleset, Vercel-Umgebungen und Rücksprungziel sind verifiziert.
Pull Request #1 hat alle drei Pflichtchecks erfolgreich durchlaufen; R1 ist
damit erledigt. Einzelheiten:
[`docs/deployment/release-process.md`](../deployment/release-process.md).

**Warum:** CI prüft einen direkten Push erst nachträglich. Ohne geschützten
Branch oder Deployment-Gate kann Vercel einen fehlerhaften Commit bereits in
Production ausrollen.

**Entscheidung:**

- entweder den heutigen direkten `main`-Workflow bewusst beibehalten und das
  verbleibende Risiko dokumentieren;
- oder Pull Requests, erforderliche CI-/Vercel-Checks und Branch Protection
  einführen;
- Preview-Deployments erhalten keine produktiven Schreib-Secrets oder eigene
  Testressourcen;
- einen kurzen Rollback-Ablauf für Vercel dokumentieren.

**Abnahme:**

- der gewählte Ablauf ist als ADR oder Runbook dokumentiert;
- tatsächlicher Production-Trigger und – falls vorhanden – der freigebende
  Check sind nachweisbar dokumentiert;
- ein Preview-Smoke kann weder News-Cache noch Feed-Datenbank in Production
  verändern;
- ein Rollback auf die letzte funktionierende Version wurde ohne Datenmutation
  nachvollzogen;
- Plattformänderungen erfolgen nur nach ausdrücklicher Freigabe des
  Projektinhabers.

R1 ist entschieden und verifiziert; alle folgenden Arbeitspakete laufen über den
dort beschriebenen Pull-Request-Weg.

---

## Meilenstein 1: Sicherheits- und Datenverträge

### S1a – Serverziele und Redirects absichern

**Status:** erledigt. Der Transport ist über `undici` mit eigenem
`connect.lookup` an die geprüften Adressen gebunden; das Release-Gate wurde am
28. Juli 2026 mit 40/40 passierenden Feed-Adressen abgeschlossen.

**Warum:** Feed- und Artikelziele werden serverseitig abgerufen. Eine reine
Syntax- oder Hostname-Prüfung reicht nicht gegen DNS-Auflösungen auf private
Netze, Redirects oder DNS-Rebinding.

**Umfang:**

- eigene Outbound-Policy für Node-Abrufe, getrennt von der Browser-Ausgabe;
- nur bewusst erlaubte HTTP(S)-Ziele ohne eingebettete Zugangsdaten;
- alle A- und AAAA-Ergebnisse einschließlich IPv4-mapped IPv6 prüfen;
- automatische Redirects deaktivieren, jeden Hop erneut prüfen und Zahl sowie
  Schleifen begrenzen;
- Verbindung an das geprüfte Ziel binden oder eine nachweislich SSRF-sichere
  Egress-Lösung verwenden; falls die aktuelle Runtime das nicht zuverlässig
  ermöglicht, fail-closed beziehungsweise mit enger Allowlist arbeiten;
- die exakte PHP-Allowlist nicht durch eine allgemeinere Policy aufweichen;
- vor Aktivierung alle aktuell konfigurierten Feed-URLs read-only
  charakterisieren.

**Abnahme:**

- Tests mit injizierbarem Resolver für private und gemischte DNS-Antworten,
  IPv4/IPv6, IPv4-mapped IPv6, alternative numerische Adressen, Redirect auf
  private Ziele und Redirect-Schleifen;
- DNS-Rebinding/TOCTOU und die Grenzen der gewählten Runtime-Lösung sind im Code
  und in der Betriebsdokumentation nachvollziehbar behandelt;
- derzeit gültige öffentliche Produktions-Feeds funktionieren weiterhin;
- eine ungültige Feed-URL ergibt beim Admin eine verständliche 400-Antwort;
- kein abgewiesener Request erreicht das Netzwerk.

### S1b – Artikel-, Bild- und Ausgabe-URLs absichern

**Status:** erledigt.

**Warum:** RSS-Inhalte werden in der SPA und unter `/gaming-news` ausgegeben und
für Bilder teilweise serverseitig nachgeladen. Dafür gilt zusätzlich zur
Outbound-Policy eine syntaktische Ausgabe-Policy.

**Umfang:**

- Artikel- und Bild-URLs auf erlaubte HTTP(S)-Schemata und fehlende Credentials
  normalisieren;
- relative URLs nur gegen eine definierte öffentliche Basis auflösen;
- serverseitiges OG-Scraping über die Schutzschicht aus S1a führen;
- ungültige Links in der SPA und unter `/gaming-news` nicht anklickbar machen;
- abgelehnte Items protokollieren und isoliert überspringen.

**Abnahme:**

- Tests für `javascript:`, `data:`, Credentials, relative und fehlerhafte URLs;
- dieselbe Policy gilt für Feed-Ingest, OG-Scraping, React-Links und statisches
  HTML, ohne Logik zu duplizieren;
- ein ungültiger Artikel beschädigt weder Cache noch restlichen Feed;
- gültige Artikel- und Bild-URLs funktionieren unverändert.

### S2 – Runtime-Validierung und sichere API-Fehler

**Status:** erledigt. Feed- und Announcement-Payloads laufen über gemeinsame,
Edge-kompatible Parser (`server/feed-validation.js`,
`shared/announcement-contract.js`), die Objekttyp, Pflichtfelder, Stringlängen,
IDs, Enums, URLs und Booleans zur Laufzeit prüfen; die bestehende
`shared/url-policy.js` wird weiterverwendet. Fehler antworten einheitlich als
`{ error, code, field? }` mit stabilen Codes aus `shared/api-errors.js`;
interne SQL-, KV- und Providermeldungen erscheinen nicht mehr in
Client-Antworten. Alle geschützten Admin-Antworten tragen `private, no-store`,
der öffentliche Announcement-Abruf behält seine Cache-Semantik. Eine inaktive
Ankündigung ist über den geschützten Abruf `?admin=1` wieder ladbar,
bearbeitbar, aktivierbar und löschbar, bleibt öffentlich aber unsichtbar. Die
Handler liegen testbar unter `server/` mit injizierbarem SQL, KV, Uhr und
Zugangsdaten. Einzelheiten:
[`docs/deployment/admin-api.md`](../deployment/admin-api.md).

**Warum:** TypeScript-Casts prüfen eingehendes JSON nicht zur Laufzeit.
Feed-Verwaltung und Ankündigungen benötigen daher serverseitige Verträge.

**Umfang:**

- gemeinsame Parser für Feed- und Announcement-Payloads;
- Feldtypen, Längen, Enums, URLs, Zahlen und Booleans validieren;
- ungültiges oder nicht parsebares JSON als 400 melden;
- interne Exception-Texte nur serverseitig protokollieren;
- stabile, für den Client geeignete Fehlercodes verwenden;
- Admin-Antworten mit `private, no-store` ausliefern;
- inaktive Ankündigungen im Admin weiterhin bearbeitbar machen, ohne sie
  öffentlich anzuzeigen.

**Abnahme:**

- Handler-Tests für alle Methoden, Auth-Grenzen und wesentlichen Fehlpfade;
- keine Datenbank- oder Providerdetails in Client-Antworten;
- vorhandene gültige Admin-Abläufe bleiben unverändert nutzbar.

---

## Meilenstein 2: Feed- und Cache-Betrieb

### O1 – Heartbeat und Frische

**Status:** erledigt. `shared/feed-health-model.js` führt den veränderlichen
Attempt-Status (`feed_run_status`) getrennt vom letzten Kern-Publish
(`feed_publish_status`); `feed_health_status` schreibt `lastSuccessAt` je Feed
fort und wird von einem gescheiterten Versuch nicht zurückgesetzt.
`scripts/feed-run-recorder.js` entscheidet über Reihenfolge und Zulässigkeit der
Schreibvorgänge: der Versuch bleibt bis nach der Trendphase `running`, ein nicht
sicher gelesener historischer Stand wird nie mit Ersatzwerten überschrieben, und
ein Abbruch vor der Feed-Liste wird von einer geladenen, aber leeren Liste
unterschieden. Health-API und Admin zeigen Lauf, Kern-Publish und Inhaltsfrische
getrennt und ab `FEED_STALE_AFTER_MS` (50 Minuten) als „veraltet“; Zeitstempel
jenseits von `FEED_CLOCK_SKEW_TOLERANCE_MS` in der Zukunft gelten als ungültig.
Der Workflow startet zu den Minuten 7/27/47 statt zur Minute 0.

Bewusst nicht enthalten: die Inhaltsfrische belegt nur, dass eine Quelle
überhaupt Artikel geliefert hat, nicht dass darunter neue waren – eine
Novelty-Erkennung ist kein Bestandteil von O1. Einzelheiten:
[`docs/deployment/feed-heartbeat.md`](../deployment/feed-heartbeat.md).

**Warum:** Ein alter grüner `feed_health_status` bleibt momentan grün, auch
wenn der geplante Workflow nicht mehr läuft.

**Umfang:**

- einen veränderlichen Attempt-Status (`runId`, `startedAt`, `finishedAt`,
  Ergebnis und Fatalfehler) getrennt vom unveränderlichen aktiven Snapshot
  führen;
- Workflow-Frische, erfolgreichen Kern-Publish und Inhaltsfrische getrennt
  darstellen, unter anderem über `lastCorePublishAt`, Feed-Zähler,
  `lastSuccessAt` je Feed und neuesten Artikelzeitpunkt;
- minimale Phasen- und Feed-Dauern bereits hier erfassen;
- im Health-API und Admin ab der festen, dokumentierten Schwelle
  `FEED_STALE_AFTER_MS` (Standard: 50 Minuten) eindeutig „veraltet“ anzeigen;
- beim nächsten Workflow-Umbau den Zeitplan von der stark belasteten Minute
  `0` weg verschieben.

**Abnahme:**

- Grenztests direkt vor und an `FEED_STALE_AFTER_MS` bestimmen den
  Stale-Zustand deterministisch;
- ein fehlgeschlagener Versuch überschreibt `lastCorePublishAt` und
  Feed-`lastSuccessAt` nicht;
- ein technisch beendeter Lauf mit ausschließlich fehlgeschlagenen Feeds
  erscheint nicht als frischer Inhalt;
- letzter Versuch, letzter Kern-Publish und Inhaltsfrische sind im Admin
  unterscheidbar;
- Tests verwenden eine injizierbare Uhr und benötigen keine echte Wartezeit.

### O2a – Einzelitem-Fehler, Secrets und Provider-Timeouts

**Status:** erledigt. `parseFeedItems` prüft das Datum ausdrücklich und klammert
jedes Element einzeln; übersprungene Elemente werden nach Grund gezählt, ohne
Titel, Adressen oder Inhalte auszuweisen. `parseRssXml` bleibt als reine
Artikelliste erhalten. HTML- und Groq-Abrufe haben Abort-Timeout und Byte-Limit
über die gemeinsame `scripts/limited-response.js`, die auch bei Streams ohne
`Content-Length` greift und den Stream abbricht. Groq-Fehler enden als Wert
statt als Ausnahme und machen einen erfolgten Kern-Publish nicht nachträglich
alt. Der PHP-Proxy wird nur noch für Quellen aus `PROXY_ELIGIBLE_SOURCES`
(aktuell nur GamePro) versucht. `scripts/feed-run-config.js` trennt Core- von
optionaler Konfiguration; fehlt ein Core-Wert, endet der Lauf vor dem ersten
SQL-, KV-, Recorder- oder HTTP-Zugriff, was die Orchestrierungstests mit Spies
belegen. Einzelheiten:
[`docs/deployment/feed-run-resilience.md`](../deployment/feed-run-resilience.md).

**Warum:** Ein einzelnes ungültiges Datum kann derzeit einen ganzen Feed
verwerfen. Core- und optionale Provider-Konfiguration müssen außerdem
unterschiedlich behandelt und externe Aufrufe einzeln begrenzt werden.

**Umfang:**

- fehlerhafte Items einzeln überspringen und mitzählen;
- Groq- und HTML-Abrufe mit Abort-Timeout und Größenlimit versehen;
- Proxy nur für ausdrücklich dafür vorgesehene Quellen versuchen;
- Core-Secrets (`POSTGRES_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`) vor
  jedem externen Zugriff auf Vorhandensein prüfen, ohne Werte auszugeben;
- optionale Werte wie `GROQ_API_KEY` und `FEED_PROXY_URL` getrennt validieren
  und bei Fehlen kontrolliert überspringen.

**Abnahme:**

- Fixture mit einem ungültigen und mehreren gültigen Items behält die gültigen
  und weist einen Skip-Zähler aus;
- hängende HTML-Seiten oder Groq-Aufrufe enden über Abort-Signale;
- fehlendes Core-Secret beendet den Lauf vor SQL-, KV- oder HTTP-Zugriff;
  fehlende optionale Secrets verhindern den Kern-Publish nicht;
- optionale Trendfehler machen einen erfolgreichen News-Kernlauf nicht alt.

### O2b – Deadline und Scrape-Budget

**Status:** erledigt. `scripts/feed-run-budget.js` führt ein globales Budget:
`CORE_DEADLINE_MS` (18 Minuten ab Skriptstart, konfigurierbar über
`FEED_CORE_DEADLINE_MS`, 12 Minuten Sicherheitsreserve vor dem
30-Minuten-Hardlimit) und höchstens 80 Artikel-Seitenabrufe pro Lauf
(`FEED_SCRAPE_LIMIT`) – gemeinsam für neue OG-Scrapes und den Backfill, damit
der eine Weg die Grenze des anderen nicht umgeht. Der Worst Case passt bewusst
nicht in die Deadline: 40 Quellen mit je zwei Versuchen à 15 s wären allein rund
20 Minuten. Sie ist keine Kapazitätsplanung, sondern die Zusage, dass
Kern-Publish und Heartbeat immer vor dem Hardlimit fallen. Die Restzeit wird vor jeder
Quelle und jedem Seitenabruf geprüft **und** ein Timer bricht beim Erreichen der
Deadline eine bereits laufende Anfrage über einen gemeinsamen
`AbortController` ab; `requestSignal` kürzt zusätzlich jedes Einzeltimeout auf
die Restzeit. Eine zurückgestellte Quelle bekommt `warning` statt `error` und
behält `lastSuccessAt` samt ihren alten Artikeln; offene Bild-Scrapes werden über
`distributeBySourceFairly` reihum auf die Quellen verteilt, bekommen einen
Platzhalter und sind im nächsten Lauf wieder Kandidaten. Die Trendphase entfällt
früh, wenn die Restzeit drei Minuten unterschreitet. Ergebniszustände: `success`
nur bei vollständigem Kernlauf **ohne** zurückgestellte Arbeit, `degraded` bei
sicherem Kern-Publish mit zurückgestellter Arbeit (Exit-Code 0), `fatal`
unverändert ohne vertrauenswürdigen Kernabschluss; die Entscheidung trifft
ausschließlich `resolveRunResult`, der Grund steht bereinigt als
`degradedReason` im Heartbeat und im Admin. Die Feed-Parallelität bleibt
bewusst unverändert bei genau einem offenen Request – es gibt keine Messdaten,
die mehr rechtfertigen. Einzelheiten:
[`docs/deployment/feed-run-budget.md`](../deployment/feed-run-budget.md).

**Warum:** Feed-, Proxy- und Bildabrufe können zusammen das
30-Minuten-Hardlimit des Workflows erreichen. Ein harter Actions-Abbruch führt
nicht zuverlässig durch den normalen Fehlerpfad.

**Umfang:**

- neue Bild-Scrapes pro Lauf begrenzen;
- ein globales Zeitbudget einführen und optionale Arbeiten bei knapper
  Restzeit überspringen;
- Ergebniszustände `success`, `degraded` und `fatal` definieren;
- ein konfigurierbares `CORE_DEADLINE_MS` mit ausreichender Reserve vor dem
  30-Minuten-Hardlimit verwenden;
- zurückgestellte Bild-Scrapes fair über Quellen verteilen und in späteren
  Läufen erneut versuchen;
- Feed-Parallelität nur klein und kontrolliert erhöhen, falls Messdaten sie
  rechtfertigen.

**Abnahme:**

- hängende Feeds und Scrapes enden per Request- und Gesamtabbruch vor
  `CORE_DEADLINE_MS`;
- alte Artikel ausgefallener Quellen bleiben innerhalb der bestehenden
  Retention und Artikelgrenze erhalten; das Bytebudget folgt in O3b;
- es gibt keine unbegrenzte Zahl von Artikel-Seitenabrufen pro Lauf;
- übersprungene Arbeit führt deterministisch zu `degraded`, nicht unbemerkt zu
  `success`;
- kontrollierte Parallelität überschreitet nie das definierte Request-Limit.

### O3a – Generationsgebundenes Leseprotokoll und Migration

**Status:** erledigt als **sichere Dual-Read-Vorbereitung** – das Protokoll ist
vollständig definiert, in allen Consumern verdrahtet und getestet, in Produktion
aber bewusst **noch nicht aktiviert**.

`shared/news-snapshot.js` legt den Vertrag fest: `schemaVersion`, eine
sortierbare `snapshotId` (`<epochMs>-<lauf>`, Format und Übereinstimmung mit
`createdAt` werden erzwungen) und `createdAt`, übertragen als **Header** statt
als Umschlag – der Rumpf bleibt ein nacktes Array. Der Leser pinnt die erste
brauchbare Generation, hängt sie als `?snapshot=` an jede Folgeanfrage und
entscheidet nach drei Regeln: gleiche übernehmen, neuere übernehmen und
umpinnen, ältere verwerfen. Gepinnt wird nur, was auch sichtbar ist – der
Auto-Update-Pfad merkt Artikel samt ihrer Generation vor und prüft sie bei der
Übernahme erneut gegen den inzwischen sichtbaren Stand. Ein Rückfall auf Legacy
verlangt ein **ausdrückliches Signal** (`x-gamerfeed-snapshot-rollback`); eine
bloß fehlende Angabe bleibt eine alte Kopie und dreht nichts zurück. Die
Health-API meldet bis O3b `snapshot: null` – eine Zuordnung über die Artikelzahl
wäre geraten, weil zwei Generationen dieselbe haben können.

**Warum noch nicht aktiviert:** Eine Kennung darf nur Inhalt bezeichnen, der
nachweisbar zu ihr gehört. `news_cache`, `news_cache_16` und `news_cache_64`
sind veränderlich; ein Leser kann den Zeiger vor und die Artikel nach einem
Publish erwischen, und **keine Lesereihenfolge** schließt das aus. Der Cron
schreibt deshalb keinen Zeiger, sondern entwertet einen vorhandenen vor jedem
Publish; die Endpunkte melden eine Generation nur über eine ausdrücklich
injizierte Quelle, die in Produktion unverdrahtet bleibt. Die unveränderlichen
Generationen dafür bringt **O3b** – erst damit greift der Schutz gegen gemischte
Generationen wirklich.

Einzelheiten, Grenzen und Migrationsreihenfolge:
[`docs/deployment/news-generations.md`](../deployment/news-generations.md).

**Warum:** Ein einzelner Active-Pointer reicht bei drei zeitversetzten,
unabhängig am Edge gecachten Endpunkten nicht aus. Preview, Medium und Full
könnten trotz Pointer verschiedene Generationen liefern.

**Beobachtung vom 29. Juli 2026:** Das Frontend zeigte auch nach einem Hard
Refresh dauerhaft 25 deutsche und 13 englische Quellen. Im zeitgleich direkt
abgerufenen Full-Cache standen dagegen 26 deutsche und 13 englische Quellen:
GameStar war im Full-Cache vorhanden, im Browser aber nicht; VG247 fehlte in
beiden. Das beweist noch nicht allein, ob Edge-Cache, lokale 32er-Kopie oder die
progressive Ladekette den älteren Stand festhielt, ist aber ein konkreter
Regressionstest für das generationsgebundene Protokoll und später F1.

**Umfang:**

- ein versionsgebundenes Leseprotokoll definieren: Bootstrap-Antwort oder
  Manifest liefert `schemaVersion` und `snapshotId`, nachfolgende Requests
  pinnen diese Generation;
- Cache-Header beziehungsweise Cache-Keys generationsspezifisch behandeln und
  abweichende Antworten im Client verwerfen;
- alle Consumer berücksichtigen: Preview/Medium/Full, Merge-Basis des Cron,
  `/gaming-news` und Health-API;
- Leser zuerst als Dual-Read ausrollen: Generation verwenden, sonst auf
  Legacy-Keys zurückfallen;
- Rollback auf Legacy und auf die vorherige Generation dokumentieren.

**Abnahme:**

- ein Pointerwechsel zwischen Preview-, Medium- und Full-Request sowie
  unterschiedlich alte HTTP-Caches erzeugen keine gemischte sichtbare
  Generation;
- fehlender oder fehlerhafter Pointer fällt kontrolliert auf Legacy
  beziehungsweise die vorherige Generation zurück;
- bestehende Clients funktionieren während der schrittweisen Migration;
- ein Browser, dessen lokaler oder HTTP-gecachter Stand GameStar noch nicht
  enthält, übernimmt nach erfolgreicher Aktualisierung die vollständige
  gepinnte Generation und bleibt nicht dauerhaft bei 25 statt 26 deutschen
  Cache-Quellen;
- Contract-Tests decken jeden Consumer und einen Rollback ab.

### O3b – Konsistenter, größenbegrenzter Publish

**Zusätzlich seit O3a:** O3b **aktiviert** das generationsgebundene
Leseprotokoll. Erst unveränderliche Generationen können belegen, dass eine
Kennung zu einem Inhalt gehört; bis dahin bleibt der Zeiger leer und alle
Endpunkte antworten als Legacy. Konkret gehört dazu, die Snapshot-Quelle der
News-Endpunkte (`readSnapshot`) zu verdrahten, den Zeiger wieder zu schreiben,
`/api/gaming-news` an die Generation zu binden und die gebundene Quelle der
Health-API bereitzustellen.

**Warum:** Eine Artikelanzahl garantiert keine maximale Byte-Größe. Die drei
News-Keys werden zudem nacheinander geschrieben und können bei Fehlern
unterschiedliche Generationen enthalten.

**Umfang:**

- Full-, Preview- und Medium-Payload jeweils serialisiert messen;
- Feldlängen begrenzen und einen selbst einzeln zu großen Artikel kontrolliert
  überspringen;
- ein konfigurierbares Byte-Budget mit Sicherheitsreserve verwenden und bei
  Bedarf deterministisch die ältesten Artikel entfernen;
- eine vollständige, unveränderliche Generation schreiben und erst danach den
  Active-Pointer umschalten;
- Attempt-Status aus O1 nicht in den unveränderlichen Snapshot mischen;
- aktive und vorherige Generation für laufende Clients und Rollback behalten;
  ältere und unvollständige Generationen erst nach Grace Period entfernen;
- während der Migration Legacy-Keys weiter bedienen und erst nach
  nachgewiesener Umstellung aller Consumer entfernen;
- konkurrierende Writer durch Dry-Run/Lease/CAS oder monotone Aktivierung daran
  hindern, eine ältere Generation zuletzt zu aktivieren;
- Health-API aus Snapshot-Metadaten versorgen, statt den vollständigen
  News-Cache nur für die Quellenliste zu laden.

**Abnahme:**

- Fault-Injection nach jedem KV-Write, einschließlich Pointer-Fehler und
  verwaister Teilgeneration, lässt Leser nur einen vollständigen Snapshot
  sehen;
- zwei überlappende Läufe aktivieren niemals die ältere Generation zuletzt;
- Rollback, Legacy-Fallback und Garbage Collection sind getestet;
- die serialisierten Full-, 16er- und 64er-Payloads bleiben unter ihren Budgets,
  auch bei einem einzelnen extrem großen Eingabeartikel;
- Artikelreihenfolge bleibt stabil und newest-first.

### O4 – Historie, Alarmierung und Versionsdrift

**Status:** geplant, nachdem O1–O3b stehen.

- strukturierte Run- und Feed-Metriken sowie eine kurze
  `GITHUB_STEP_SUMMARY`;
- Dauer, Transportweg, HTTP-Status und Item-/Skip-Zahlen ohne Secrets
  nachvollziehbar machen;
- begrenzte Historie und einen unabhängigen Alarmkanal für veralteten Cache oder
  ungewöhnlich hohe Fehlerquote festlegen; ein ausgefallener Workflow darf
  nicht sein eigener einziger Monitor sein;
- nicht geheimen Versionsfingerprint verwenden, damit manuell deployter Proxy
  und Repository verglichen werden können.

**Abnahme:**

- ein Run beantwortet ohne Rohlog-Suche Dauer, Transport, Item-Zahl,
  Fehlerquote, Snapshot und Payload-Größe;
- Summary und Historie enthalten weder Secrets noch vollständige Proxy-URLs;
- Alarm, Deduplizierung und Recovery werden mit ausgefallenem sowie wieder
  gesundem Cron getestet;
- ein isolierter Smoke-Test vergleicht den erwarteten Proxy-Fingerprint, ohne
  Produktionscache oder Feed-Anbieter zu verändern;
- Authentifizierung und Rate Limit des Proxys bleiben ausschließlich X1.

---

## Meilenstein 3: Frontend-Zuverlässigkeit

### T0 – Chromium-E2E-Grundgerüst

**Status:** erledigt.

**Warum:** Linkedom prüft weder echte Browser-Navigation und Cookies noch
Netzwerk- und Fokusverhalten. F2 und spätere Browser-Abnahmen benötigen zuerst
eine kleine, neutrale Infrastruktur.

**Umfang:**

- Chromium-Runner unter `tests/e2e/` und Script `npm run test:e2e`;
- Dateimuster so trennen, dass `npm test` die Browser-Suite nicht versehentlich
  ein zweites Mal startet;
- Production-Build oder lokale Preview mit vollständig gemockten
  API-Antworten;
- eigener CI-Schritt ohne produktive Endpunkte oder Schreib-Secrets;
- ein neutraler Smoke-Test, der Start und initiale News-Anzeige prüft.

**Abnahme:**

- `npm run test:e2e` läuft lokal dokumentiert und in CI reproduzierbar;
- Netzwerkzugriffe auf echte Produktions-APIs schlagen im Test bewusst fehl;
- Browser-Artefakte werden nur bei Fehlern beziehungsweise gemäß dokumentierter
  Retention gespeichert;
- fachliche Smokes werden anschließend im jeweiligen Arbeitspaket ergänzt.

### F1 – Progressive Ladekette: „latest request wins“

**Status:** bereit – nächstes Code-Arbeitspaket. O3a hat das Leseprotokoll
bereitgestellt, das eine *ältere Generation* verwirft; wirksam wird es aber erst
mit O3b. Unabhängig davon offen bleiben die Reihenfolge der Requests selbst,
Abbruch bei Unmount und die Trennung blockierender von nicht blockierenden
Fehlern.

**Warum:** Eine verspätete Medium- oder Full-Antwort der initialen Ladekette
kann momentan einen neueren manuellen Refresh wieder überschreiben. Scheitert
Medium, wird Full nicht mehr versucht.

**Umfang:**

- den News-Lifecycle aus `App.tsx` in einen kleinen testbaren Hook oder
  Controller auslagern;
- Request-Generation oder Abort-Strategie verwenden;
- das generationsgebundene Protokoll aus O3a über die drei Stufen beibehalten;
- Full unabhängig vom Erfolg der Medium-Stufe versuchen;
- bereits sichtbare Cache- oder Preview-Daten bei Hintergrundfehlern behalten;
- Blocking-Fehler von nicht blockierenden Refresh-Fehlern unterscheiden.

**Abnahme:**

- verspätete ältere Antworten verändern weder React-State noch `localStorage`;
- Medium-Fehler verhindert Full nicht;
- Unmount und neuer Refresh brechen Arbeit ab oder invalidieren sie so, dass
  sie weder State noch Cache verändern darf;
- abweichende `snapshotId` wird verworfen;
- Deferred-Promise-Tests decken Reihenfolge, Fallback und Fehlerzustände ab;
- ein Chromium-Smoke ergänzt T0 für den vollständigen Stufenablauf.

### F2 – Consent-Lifecycle vervollständigen

**Status:** erledigt.

**Warum:** Analytics wird nach Zustimmung initialisiert, ein späterer Widerruf
stoppt den bereits geladenen Analytics-Lifecycle jedoch nicht vollständig.
Die Cookie-Einstellungen sind nach dem ersten Banner außerdem nicht dauerhaft
erreichbar.

**Umfang:**

- dauerhaft erreichbaren Link „Cookie-Einstellungen“ ergänzen;
- vor Opt-in keine Analytics-Anfrage;
- Zustimmung genau einmal initialisieren;
- Widerruf als `denied` anwenden, weitere Hits stoppen und Analytics-Cookies
  entfernen;
- erneute Zustimmung ohne doppeltes Skript ermöglichen.

**Abnahme:**

- Unit-Tests für Zustandswechsel;
- auf Basis von T0 kontrolliert ein echter Chromium-Test Netzwerk und Cookies;
- Datenschutzerklärung und tatsächliches Verhalten stimmen überein;
- eine rechtliche Beurteilung von Analytics/reCAPTCHA bleibt eine externe
  fachliche Aufgabe, kein stillschweigender Codeentscheid.

### F3a – Tastatur und gültige DOM-Struktur

**Umfang:**

- gespeicherte Suchen mit Enter und Leertaste auswählen und löschen;
- Suchfeld und Icon-only-Schaltflächen eindeutig benennen;
- in `ArticleCard` keine Buttons innerhalb eines Artikel-Links verschachteln;
- Optionsdialog benennen sowie Escape und Fokus-Rückgabe erhalten.

**Abnahme:**

- DOM- und Tastaturtests für alle genannten Interaktionen;
- Favorisieren oder Optionsmenü navigiert nie versehentlich zum Artikel;
- ein Chromium-Smoke auf Basis von T0 prüft gespeicherte Suche,
  ArticleCard-Aktionen und Fokus.

### F3b – ArticleCard-Aktualisierung

**Umfang:**

- unvollständigen `React.memo`-Vergleich entfernen oder alle gerenderten
  Artikelwerte berücksichtigen;
- keine größere Card-Neustrukturierung über F3a hinaus.

**Abnahme:**

- Änderungen an Summary, Link, Quelle, Sprache oder Datum werden trotz gleicher
  Artikel-ID gerendert;
- Regressionstest prüft Text, Datum und `href`;
- unveränderte Props verursachen keine nachweisbare funktionale Regression.

### F4a – Persistierten Zustand validieren

**Umfang:**

- Decoder und sichere Defaults mindestens für `cachedNews`, Theme, ViewMode und
  String-Arrays;
- kaputtes JSON, falsche Struktur und Cross-Tab-Entfernung werfen nie.

**Abnahme:**

- Unit-Tests decken kaputtes JSON, falsche Formen, unbekannte Enum-Werte und
  `storage`-Events mit entferntem Key ab;
- jeder betroffene Key fällt deterministisch auf seinen dokumentierten Default
  zurück.

### F4b – i18n-Konsistenz

**Umfang:**

- Artikeldatum an die gewählte i18n-Sprache statt `navigator.language` binden;
- verbliebene hart codierte sichtbare und ARIA-Texte nach DE/EN überführen.

**Abnahme:**

- Sprachwechsel aktualisiert Datum, sichtbare Texte und Accessible Names ohne
  Reload;
- DE- und EN-Tests verhindern neue hart codierte Texte in den bearbeiteten
  Komponenten.

---

## Meilenstein 4: Admin

### A1a – Admin-Mutationen

**Umfang:**

- synchronen Mutation-Latch für Feed- und Announcement-Aktionen verwenden;
- Löschung erst nach fokussierter Bestätigung;
- Fehler bewahren Eingaben und bestehenden Datensatz.

**Abnahme:**

- je mutierendem Flow erzeugen zwei synchrone identische Aktionen während
  desselben laufenden Requests genau einen POST, PUT oder DELETE; nach Abschluss
  bleibt eine legitime spätere Aktion möglich;
- Fehlerpfade geben Sperren im `finally` frei;
- Bestätigung erhält initialen Fokus, hält ihn fest, beachtet die definierte
  Escape-Regel und gibt den Fokus zurück.

### A1b – Admin-Tabs und Health-Semantik

**Umfang:**

- Admin-Tabs mit IDs, `aria-controls`, roving `tabIndex` und Pfeiltasten;
- unbenannte Accordion-Schaltflächen benennen;
- Health-Aktualisierung eindeutig als erneutes Laden des gespeicherten Status
  beschriften;
- „konfigurierte Feeds“ aus der Datenbank und „Quellen mit aktuellen Artikeln“
  im News-Cache als zwei verschiedene, zeitabhängige Kennzahlen benennen und
  erklären. Die am 28. Juli beobachteten 40 zu 38 waren deshalb nicht
  automatisch ein Zählfehler; am 29. Juli enthielt derselbe Cache bereits 39
  Quellen;
- fehlende Cache-Quellen vollständig und nachvollziehbar ausweisen, ohne die
  Zuordnung nur aus unscharf verglichenen Anzeigenamen abzuleiten. Die
  Beobachtung vom 29. Juli muss zwei Ursachen unterscheiden: VG247 fehlt auch
  im aktuellen Full-Cache und wird als erfolgreich abgerufen, aber ohne
  aktuelle Artikel erkannt; GameStar steht dagegen im aktuellen Full-Cache,
  fehlte jedoch im länger sichtbaren 38er-Frontend-Stand und ist deshalb kein
  Feed-Ausfall.

**Abnahme:**

- Tab-Tests prüfen Pfeiltasten, Home, End, `aria-controls` und roving
  `tabIndex`;
- Accordion-Schaltflächen besitzen eindeutige Accessible Names;
- die Oberfläche behauptet nicht, ein einzelner RSS-Feed werde live abgerufen;
- ein Fixture mit mehr konfigurierten Feeds als im Cache vertretenen Quellen
  zeigt beide Zahlen mit ihrer jeweiligen Bedeutung und erklärt jede
  Abweichung;
- der Admin unterscheidet „nicht im aktiven News-Snapshot“ von „Frontend nutzt
  noch einen anderen Snapshot“, sobald O3a die dafür nötigen Snapshot-IDs
  bereitstellt;
- gleiche, abweichend geschriebene oder derzeit artikelarme Quellennamen führen
  weder zu einer verschwundenen Zeile noch zu einer falschen Gesundmeldung.

Ein echter manueller Einzelquellen-Abruf ist ein separates, derzeit nicht
geplantes Produktfeature.

---

## Meilenstein 5: Release und Datenbetrieb

### D1 – Datenbankschema, Backup und Restore

**Status:** Entscheidung des Projektinhabers nötig.

- versioniertes SQL-Schema und nachvollziehbare Migrationen für `feeds`;
- Constraints wie eindeutige Feed-URL dort absichern, wo sie fachlich gelten;
- die historische Spalte `priority` bewusst entscheiden: Sie wird derzeit in
  API und Admin gespeichert und angezeigt, beeinflusst den Feed-Lauf aber
  nicht. Da alle aktiven Feeds weiterhin gemeinsam alle 20 Minuten laufen,
  entweder das tote Feld sauber aus Schema, Verträgen und Oberfläche entfernen
  oder eine konkrete, getestete Produktbedeutung dokumentieren – keine
  stillschweigende Rückkehr zu getrennten Abrufgruppen;
- anonymisierten lokalen Seed bereitstellen;
- Verantwortung, Aufbewahrung, RPO und RTO für Neon-Backups festlegen;
- Restore in eine getrennte Testumgebung mindestens einmal nachvollziehen.

**Abnahme:**

- eine leere sowie die aktuelle Datenbank lassen sich reproduzierbar auf den
  dokumentierten Stand migrieren;
- ein doppelter oder ungültiger Feed verletzt keine Datenkonsistenz;
- `priority` ist entweder vollständig entfernt oder besitzt eine sichtbare,
  getestete Wirkung; ein nur noch mitgeschlepptes Auswahlfeld bleibt nicht
  bestehen;
- Restore-Runbook nennt Eigentümer, Zielumgebung, Prüfung und Rückweg;
- ein Restore-Test verändert niemals Production.

### D2 – Sichere lokale Feed-Läufe

**Umfang:**

- lokaler Feed-Lauf standardmäßig Dry-Run;
- Schreiben nur mit explizitem `--write` und eindeutigem Ziel;
- Production-Ziel zusätzlich sichtbar bestätigen, ohne Secrets auszugeben;
- redigierte `.env.example` nur mit Variablennamen und Erklärungen;
- mit O3b eine Lease/CAS- oder monotone Aktivierung verwenden, damit ein älterer
  lokaler Lauf keinen neueren Action-Snapshot zurücksetzt.

**Abnahme:**

- Dry-Run führt keine SQL- oder KV-Mutation aus;
- `--write` ohne eindeutiges Ziel oder notwendige Production-Bestätigung bricht
  vor der ersten externen Mutation ab; ein Dry-Run darf die erforderlichen
  Daten weiterhin read-only abrufen;
- Tests mit überlappendem lokalem und Action-Lauf aktivieren nie die ältere
  Generation zuletzt;
- README unterscheidet Diagnose, Dry-Run und Production-Write eindeutig.

### S3 – Rate Limits und SMTP-Laufzeit

**Status:** Plattform- und Datenschutzentscheidung nötig.

- vorhandene Vercel-WAF-Regeln prüfen, bevor ein zweiter Rate-Limiter gebaut
  wird;
- `/api/contact` und Admin-Authentifizierung gegen wiederholte Versuche
  begrenzen und 429 testen;
- SMTP-Laufzeit explizit zur Function-Konfiguration passend begrenzen;
- gehäufte 401-, 429-, Captcha- und Delivery-Fehler ohne personenbezogene
  Inhalte beobachtbar machen.

**Abnahme:**

- dokumentierter Entscheid zwischen WAF und Anwendungslimiter verhindert
  doppelte, widersprüchliche Limits;
- Tests prüfen Grenzwert, 429, Retry-Verhalten und getrennte Schlüssel;
- legitime Einzelanfragen funktionieren weiter und Mail-Inhalte landen nie in
  Rate-Limit-Logs;
- Function-Laufzeit ist länger als interne Timeouts, aber bewusst begrenzt.

### S4 – Security Headers und CSP

**Status:** Plattform- und Datenschutzentscheidung nötig.

- CSP zuerst als Report-Only einführen, danach erst erzwingen;
- `frame-ancestors`, `nosniff`, Referrer- und Permissions-Policy ergänzen;
- nur tatsächlich benötigte Ziele für Analytics und reCAPTCHA freigeben.

**Abnahme:**

- Header-Smoke prüft Hauptseite, Admin und API;
- Report-Only-Phase zeigt keine unbeabsichtigt blockierten eigenen Ressourcen;
- erzwungene CSP lässt App, reCAPTCHA und den in F2 definierten Consent-Ablauf
  funktionieren;
- erlaubte Drittanbieter und Zweck jeder Ausnahme sind dokumentiert.

### X1 – Externen PHP-Proxy authentifizieren

**Status:** koordinierte Entscheidung und manuelles Hosting-Deployment nötig.

**Umfang:**

- separates Secret in einem Request-Header, nie in URL oder Querystring;
- generische Authfehler, hostseitiges Rate Limit und bestehende exakte
  GamePro-Allowlist beibehalten;
- Node-Fallback, GitHub Secret und PHP-Datei gemeinsam umstellen;
- Versionsfingerprint aus O4 für die Deploy-Prüfung verwenden.

**Abnahme:**

- isolierte Verhaltenstests prüfen Methode, Allowlist, fehlendes/falsches
  Secret, Größenlimit und Versionsheader;
- kein Test kontaktiert den Production-Proxy oder schreibt den
  Production-Cache;
- Secrets erscheinen weder in Log, URL noch Fehlermeldung;
- nach manueller Freigabe stimmt der produktive Fingerprint mit dem Repository
  überein.

### SC1 – Supply-Chain- und Workflow-Pflege

**Umfang:**

- GitHub Actions auf vollständige Commit-SHAs pinnen und lesbare
  Versionskommentare behalten;
- Dependabot für npm und GitHub Actions mit begrenzter Frequenz einrichten;
- Major-Upgrades getrennt und weiterhin manuell prüfen;
- explizites CI-Zeitlimit ergänzen.

**Abnahme:**

- Workflow-Syntax und kompletter CI-Lauf sind erfolgreich;
- Dependabot-Konfiguration validiert und erzeugt keine automatischen
  Production-Merges;
- SHA-Kommentare lassen die verwendete Release-Version erkennen;
- Update-Dokumentation verlangt weiterhin Tests, Typecheck und Build.

---

## Später – nur nach Messdaten oder konkretem Bedarf

Diese Punkte sind sinnvoll, aber aktuell nicht ausreichend begründet:

- ETag/`If-Modified-Since` für RSS-Feeds; Validatoren müssten über Läufe hinweg
  konsistent gespeichert und 304-Antworten gegen vorhandenen Cache geprüft
  werden;
- Delta-, Cursor- oder Pagination-Endpunkt statt vollständigem 60-Tage-Cache
  beim Auto-Update;
- stärkere Feed-Parallelisierung;
- Kompression oder Aufteilung des Full-Cache;
- Bundle-Splitting und Lazy Loading;
- Cross-Browser- und visuelle Regressionstests;
- automatisches Deployment des externen PHP-Proxys;
- Wechsel von Storage-Paketen oder Edge zu Node nur nach aktuellem
  Provider-Audit, Preview-Test und dokumentiertem Migrationsgrund;
- Basic Auth langfristig bestätigen oder nach eigener Produktentscheidung durch
  eine Identitätslösung mit MFA ersetzen;
- Aufteilung großer Dateien wie `App.tsx`, `SettingsModal.tsx`,
  `ArticleCard.tsx` oder `scripts/fetch-feeds.js` nur entlang bereits getesteter
  Verantwortlichkeiten.

## Bewusst nicht geplant

- kein kompletter Rewrite;
- kein neues globales State-Management ohne konkreten Bedarf;
- kein Verschieben der Tests aus `tests/`;
- kein pauschales 100-Prozent-Coverage-Ziel;
- keine öffentlichen Gratis-Proxies;
- keine ungezügelte Parallelisierung oder längere pauschale Retries;
- keine unterschiedlichen Abrufintervalle pro Feed: alle aktiven Feeds bleiben
  beim gemeinsamen 20-Minuten-Lauf;
- kein produktiver Schreibzugriff aus Preview-Deployments;
- kein automatisches Major-Upgrade von Node, Vite oder anderen Kernpaketen.

## Vorlage für die Übergabe eines Arbeitspakets

```text
Lies AGENTS.md und docs/development/roadmap.md vollständig.

Bearbeite ausschließlich Arbeitspaket <ID und Titel>. Beginne keine weiteren
Roadmap-Punkte. Prüfe zuerst den aktuellen Git-Stand und die bestehenden Tests.

Setze die Abnahmekriterien vollständig um, ergänze gezielte Regressionstests
unter tests/ und aktualisiere betroffene Dokumentation. Mache kleine deutsche
Commits, vermische keine unabhängigen Refactorings und führe die Definition of
Done aus. Führe keine externen Deployments, Secret-, GitHub- oder
Vercel-Änderungen ohne ausdrückliche Freigabe durch.

Berichte am Ende: Ausgangs- und End-Commit, geänderte Dateien, begründete
Entscheidungen, Testergebnisse, verbleibende Risiken und manuelle Schritte.
Nicht pushen, sofern das nicht ausdrücklich verlangt wurde.
```
