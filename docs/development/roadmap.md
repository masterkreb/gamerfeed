# GamerFeed – Projekt-Roadmap

Stand: 30. Juli 2026

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
- **P2**: wichtige Stabilisierung, Wartbarkeit oder ein durch Messdaten
  belegtes Produktionsproblem
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
damit erst mit **O3b**, das die unveränderlichen Generationen liefert. 593
zentrale Tests und 17 Browser-Abnahmen laufen erfolgreich.

**Stand 29. Juli 2026 (Branch `codex/f1-latest-request-wins`):** F1 ist
abgeschlossen. Preview, Medium, Full und manueller Refresh haben einen
gemeinsamen Controller mit Abort und Request-Epoche; verspätete Antworten
verändern weder State, Pin noch lokale Kopie. Full läuft auch nach einem
Medium-Fehler, Auto-Update-Abfragen werden bei sichtbaren Zustandswechseln
entwertet, und Refresh-Fehler behalten vorhandene Artikel. 604 zentrale Tests
und 21 Browser-Abnahmen laufen erfolgreich. Als nächstes ist O3b bereit: erst
sein unveränderlicher Publish aktiviert die in O3a vorbereitete Inhaltsbindung.

**Stand 29. Juli 2026 (Branch `codex/o3b-atomic-snapshot-publish`):** O3b ist
abgeschlossen. Full, Preview und Medium werden unter unveränderlichen
Generations-Keys größenbegrenzt aufgebaut; Manifest und Legacy-Keys stehen vor
der abschließenden Pointer-Aktivierung. Eine Lease mit monotoner Prüfung und
atomarer Besitzprüfung beim Umschalten serialisiert konkurrierende Writer,
aktive und vorherige Generation bleiben
lesbar, und ältere Orphans werden erst nach Grace Period entfernt. Alle
Consumer lesen belegbar gebundene Daten; Health benötigt dafür nicht mehr den
Full-Payload. 626 zentrale Tests und 21 Browser-Abnahmen laufen erfolgreich.
Damit sind alle P1-Codepakete der Roadmap abgeschlossen.

**Stand 30. Juli 2026 (Branch `codex/f3a-keyboard-dom`):** F3a ist
abgeschlossen. Gespeicherte Suchen lassen sich mit Enter auswählen und mit
Leertaste löschen; Suchfeld, Speichern und Löschen besitzen lokalisierte
Accessible Names. `ArticleCard` verwendet in allen drei Layouts einen
gestreckten Titel-Link innerhalb eines semantischen `article`, während
Favoriten- und Optionsaktionen außerhalb des Links liegen. Der benannte
Optionsdialog räumt seinen verzögerten Fokus beim Schließen auf und gibt den
Fokus auch bei schnellem Escape zuverlässig zurück. 628 zentrale Tests und 23
Browser-Abnahmen laufen erfolgreich.

**Stand 30. Juli 2026 (Branch `codex/f3b-article-card-updates`):** F3b ist
abgeschlossen. `ArticleCard` verwendet weiterhin `React.memo`, aber ohne den
unvollständigen Sondervergleich, der nur ID, Bild und Titel kannte. Neue
Artikelobjekte werden deshalb auch bei geänderter Zusammenfassung, Adresse,
Quelle, Sprache oder Veröffentlichungszeit neu gerendert. Ein Regressionstest
prüft jedes dieser Felder separat bei unveränderter Artikel-ID. 629 zentrale
Tests und 23 Browser-Abnahmen laufen erfolgreich.

**Stand 30. Juli 2026 (Branch `codex/f4a-persisted-state-validation`):** F4a
ist abgeschlossen. Alle durch den gemeinsamen Hook gespeicherten Zustände
besitzen jetzt einen Laufzeit-Decoder. Kaputtes JSON, falsche Formen,
unbekannte Enum-Werte und entfernte Keys fallen je Zustand auf einen festen
Default zurück. `cachedNews` prüft zusätzlich jeden Artikel sowie eine
optionale Generation; blockiertes Schreiben nimmt dem laufenden React-State
nicht seinen neuen Wert. 637 zentrale Tests und 23 Browser-Abnahmen laufen
erfolgreich.

**Stand 30. Juli 2026 (Branch `codex/f4b-i18n-consistency`):** F4b ist
abgeschlossen. Artikel-, Trend- und Admin-Datumswerte folgen jetzt der
gewählten App-Sprache statt der Browsersprache. Verbliebene sichtbare und
barrierefreie Texte der bearbeiteten Frontend- und Admin-Komponenten liegen in
den DE-/EN-Ressourcen; interne Fehlerdetails bleiben im Log statt in der
Oberfläche. Ein Sprachwechsel aktualisiert Datum, Texte und Accessible Names
ohne Reload. 639 zentrale Tests und 23 Browser-Abnahmen laufen erfolgreich.

**Stand 30. Juli 2026 (Branch `claude/a1a-admin-mutations`):** A1a ist
abgeschlossen. Alle fünf mutierenden Admin-Aktionen laufen über einen synchron
gesetzten `useRef`-Latch, der zwei Ereignisse desselben Render-Zyklus auf genau
einen POST, PUT oder DELETE reduziert und im `finally` wieder freigegeben wird.
Speichern und Löschen einer Ankündigung teilen sich diesen Latch. Das Löschen
einer Ankündigung verlangt jetzt eine fokussierte Bestätigung im `alertdialog`,
und Fehler erhalten Eingaben, Datensätze und den jeweiligen Dialog. 650 zentrale
Tests und 23 Browser-Abnahmen laufen erfolgreich. Als nächstes ist A1b bereit.

**Stand 30. Juli 2026 (Branch `claude/a1b-admin-health-semantics`):** A1b ist
abgeschlossen. Die vier Admin-Reiter sind vollwertige ARIA-Tabs mit stabilen
IDs, `aria-controls`, `aria-labelledby`, roving `tabIndex` sowie Pfeiltasten,
Home und End; die beiden Aufklapp-Schaltflächen tragen eindeutige lokalisierte
Namen. Das Health Center nennt drei getrennte Kennzahlen – konfigurierte Feeds,
Quellen im aktiven News-Snapshot und Quellen in der noch verwendbaren lokalen
Browserkopie – und vergleicht Generationen nur, wenn beide Kennungen belegbar
sind. Die unscharfe Namensnormalisierung ist entfernt: unzuordenbare
Snapshot-Namen werden getrennt ausgewiesen, statt einen ähnlich geschriebenen
Feed gesund zu melden. Die irreführenden Aktualisieren-Symbole je Feed-Zeile
sind entfallen; der zentrale Knopf lädt ausdrücklich nur den gespeicherten
Bericht. Der Legenden-Reiter beschreibt dieselbe Semantik ohne Verweise auf die
alte Dateiarchitektur und ohne den nie gesetzten Zustand „Prüfe“. 672 zentrale
Tests und 23 Browser-Abnahmen laufen erfolgreich.

**Stand 30. Juli 2026 (Branch `claude/f5-snapshot-discovery`):** F5 ist
abgeschlossen und wurde **vor** O4 eingeschoben. Ein Browser mit gepinnter
Generation A blieb dauerhaft auf altem Stand, weil schon der erste Versuch
`?snapshot=A` mitschickte und der Server die direkt vorherige Generation
zulässigerweise weiter auslieferte. Der erste Versuch jeder autoritativen
Ladung und der Auto-Update-Poll fragen jetzt ungebunden; erst die angenommene
Antwort bindet die Folgestufen. 680 zentrale Tests und 25 Browser-Abnahmen
laufen erfolgreich.

**Stand 30. Juli 2026 (Branch `claude/a1c-admin-startcache-clarity`):** A1c ist
abgeschlossen. Der lokale Startcache hält bewusst nur die ersten 32 Artikel;
dass darin die meisten aktiven Quellen fehlen, ist der Normalfall. Trotzdem
kommentierte fast jede gesunde Feed-Zeile das als Snapshot-Unterschied. Eine
Zeile entsteht jetzt ausschließlich aus Backend-Status und aktivem
News-Snapshot, während der Startcache nur noch global als eigene Kennzahl mit
seiner tatsächlichen Artikel- und Quellenzahl erscheint. 688 zentrale Tests und
25 Browser-Abnahmen laufen erfolgreich.

**Stand 30. Juli 2026 (Branch `claude/o4a-run-summary`):** O4 ist in O4a bis
O4d geteilt, und **O4a** ist abgeschlossen. Jeder Lauf schreibt bei gesetztem
`GITHUB_STEP_SUMMARY` einen strukturierten Bericht: Ergebnis, Grund, Dauern,
Feed-Zähler, Fehler- und Warnquote mit dokumentiertem Nenner, aktive
Snapshot-Kennung samt Artikelzahlen und Bytegrößen sowie eine begrenzte Tabelle
je Quelle mit Transport und wirklich beobachtetem HTTP-Status. Die
Zusammenfassung ist reine Beobachtbarkeit und kann weder Ergebnis noch
Exit-Code verändern. Auch ein Abbruch in der Vorprüfung bekommt seinen – dann
minimalen – Bericht. 741 zentrale Tests und 25 Browser-Abnahmen laufen
erfolgreich. O4b bleibt als nächster Betriebsbaustein geplant; wegen der
gemessenen fehlenden Google-Indexierung wird zunächst SEO0/SEO1 eingeordnet.

**Stand 30. Juli 2026 (Search-Console-Baseline SEO0):** SEO0 ist
abgeschlossen. Die Sitemap wird erfolgreich gelesen und beide öffentlichen
URLs bestehen den Live-Test, trotzdem stehen **0 indexierte Seiten** zwei
nicht indexierten gegenüber. Die Startseite wurde zuletzt am 25. Juni
erfolgreich gecrawlt und danach nicht indexiert; `/gaming-news` wurde gefunden,
aber nicht gecrawlt. Die letzten 28 Tage brachten 0 Impressionen und 0 Klicks,
und der Links-Bericht kennt weder interne noch externe Links. Es gibt keine
manuelle Maßnahme und kein Sicherheitsproblem. Damit ist SEO1 das nächste
Arbeitspaket vor O4b. Baseline, Leitplanken und Mess-Gate:
[`docs/development/seo-indexing.md`](seo-indexing.md).

**Stand 30. Juli 2026 (Branch `claude/seo1-crawlable-entry`):** **SEO1** ist
abgeschlossen. `index.html` liefert innerhalb von `#root` einen sichtbaren
Fallback mit genau einer H1, eigener Beschreibung und einem gewöhnlichen Link
auf `/gaming-news`; React ersetzt ihn beim Start, danach bleibt genau eine
sichtbare H1. Der bisher nirgends gerenderte Footer ist eingehängt und trägt
den lokalisierten Rückweg. `/gaming-news` hat unter der H1 einen eigenen
Einleitungstext zu Nutzen, Quellenprinzip und Aktualisierung. Statische
Metadaten nennen keine feste Quellenzahl mehr, und die nicht einlösbare
`SearchAction` ist entfernt. 759 zentrale Tests und 30 Browser-Abnahmen laufen
erfolgreich.

Ob die Änderungen wirken, entscheidet **nicht** dieser Branch: SEO2 beginnt
erst nach Merge und Production-Rollout und ist eine manuelle Abnahme in der
Search Console. Ein technisch indexierbares HTML erzwingt keine Indexierung.

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
| F1 | P1 | erledigt | Progressive News-Ladekette gegen veraltete Antworten absichern |
| O3b | P1 | erledigt | News-Caches größenbegrenzt und konsistent veröffentlichen |
| F3a | P2 | erledigt | Zentrale Tastatur- und DOM-Probleme im Frontend beheben |
| F3b | P2 | erledigt | Veraltetes ArticleCard-Rendering verhindern |
| F4a | P2 | erledigt | Persistierten Zustand robust validieren |
| F4b | P2 | erledigt | Verbliebene i18n-Inkonsistenzen schließen |
| A1a | P2 | erledigt | Admin-Mutationen synchron absichern |
| A1b | P2 | erledigt | Admin-Tabs und Health-Beschriftung korrigieren |
| F5 | P1 | erledigt | Aktive Snapshot-Generation zuverlässig entdecken |
| A1c | P2 | erledigt | Lokalen Startcache im Admin verständlich darstellen |
| O4a | P2 | erledigt | Strukturierter Laufbericht und GitHub-Step-Summary |
| SEO0 | P2 | erledigt | Search-Console-Baseline und SEO-Leitplanken festhalten |
| SEO1 | P2 | erledigt | Crawlbare Einstiege und ehrliche Metadaten herstellen |
| SEO2 | P2 | bereit | Indexierungs- und Mess-Gate nach Production-Rollout |
| SEO3 | P3 | später | Genau einen eigenständigen Content-Pilot aus Messdaten ableiten |
| SEO4 | P3 | Entscheidung nötig | Eigene Domain und externe Reichweite festlegen |
| O4b | P2 | geplant | Begrenzte Laufhistorie |
| O4c | P2 | Entscheidung nötig | Unabhängige Alarmierung |
| O4d | P2 | geplant | Isolierter Proxy-Fingerprint |
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

**Status:** erledigt als **sichere Dual-Read-Vorbereitung**. O3a definierte das
Protokoll und verdrahtete alle Consumer zunächst inert; O3b hat es inzwischen
mit den unveränderlichen Generationen aktiviert.

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
bloß fehlende Angabe bleibt eine alte Kopie und dreht nichts zurück. Eine
Rollback-Antwort ist nie cachebar, und ein Rollback im Poll-Pfad räumt eine
vorgemerkte, inzwischen zurückgezogene Generation weg. Die
Health-API meldete bis O3b `snapshot: null` – eine Zuordnung über die
Artikelzahl wäre geraten gewesen, weil zwei Generationen dieselbe haben können.

**Warum O3a allein noch nicht aktivierte:** Eine Kennung darf nur Inhalt bezeichnen, der
nachweisbar zu ihr gehört. `news_cache`, `news_cache_16` und `news_cache_64`
sind veränderlich; ein Leser kann den Zeiger vor und die Artikel nach einem
Publish erwischen, und **keine Lesereihenfolge** schließt das aus. Der Cron
schrieb deshalb damals keinen Zeiger, sondern entwertete einen vorhandenen vor
jedem Publish; die Endpunkte meldeten eine Generation nur über eine
ausdrücklich injizierte Quelle. Die inzwischen umgesetzten unveränderlichen
Generationen aus **O3b** liefern nun diese belegbare Quelle – erst damit greift
der Schutz gegen gemischte Generationen wirklich.

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

**Status:** erledigt. `scripts/news-snapshot-publisher.js` misst und begrenzt
Full, Preview und Medium, schreibt jede Generation unter eigenen Keys und
aktiviert ihren Pointer zuletzt. `shared/news-snapshot-store.js` bindet alle
Reader an Manifest und Payload derselben Kennung, hält aktiv und vorherig
lesbar und fällt kontrolliert auf Legacy zurück. Eine fünfminütige Lease,
höchstens 30 Sekunden Warten innerhalb der O2b-Deadline, ein monotones
Vergleichen nach Laufstart und eine atomare Besitzprüfung bei der Aktivierung
verhindern das Zurückdrehen durch konkurrierende Writer. Garbage Collection entfernt ältere Voll- und Teilgenerationen erst
nach 24 Stunden. Health liest Quellen und Generation aus dem Manifest statt aus
dem Full-Cache; `/gaming-news` nennt denselben Snapshot als Header und
Meta-Angabe. Ein getesteter Rollback auf die vorherige Generation sowie die
optionale Betriebsflagge `NEWS_SNAPSHOT_LEGACY_ROLLBACK` decken beide
Rückwege ab. Einzelheiten:
[`docs/deployment/news-generations.md`](../deployment/news-generations.md).

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

### F5 – Aktive Snapshot-Generation zuverlässig entdecken

**Status:** erledigt. Priorität P1, eingeschoben vor O4.

**Warum:** `?snapshot=<id>` setzt eine **bereits gewählte** Generation
konsistent fort. Es ist kein Suchmittel. Weil O3b die direkt vorherige
Generation bewusst lesbar hält, beantwortet der Server eine Anfrage mit
`?snapshot=A` weiterhin mit A – auch wenn längst B aktiv ist. Vor F5 hängten
sowohl die autoritative Ladekette als auch der Auto-Update-Poll die gepinnte
Kennung an **jede** Anfrage, einschließlich des ersten Versuchs. Ein Browser
mit lokal gespeicherter Generation A konnte B deshalb nie entdecken und zeigte
dauerhaft alte Artikel. Produktiv beobachtet: im Backend lag ein neuerer
Artikel, das bereits geöffnete Frontend blieb älter.

**Umfang:**

- Entdeckung von Fortsetzung trennen: der **erste** Versuch einer
  autoritativen Ladung fragt ungebunden – initiale Preview, Full-Fallback
  ohne vorher angenommene Antwort und manueller Refresh;
- Auto-Update-Polls fragen den aktiven Stand ungebunden ab;
- sobald eine Antwort angenommen und ihre Generation gewählt ist, tragen die
  folgenden Medium- und Full-Stufen genau diese Generation;
- verworfene Antworten – ältere, headerlose ohne Rollback-Signal oder
  unbrauchbare – verändern weder sichtbare Artikel noch Pin noch lokale Kopie;
- der Poll pinnt weiterhin nicht: Artikel und Generation bleiben gemeinsam
  vorgemerkt und werden erst über die vorhandene Übernahmeaktion sichtbar;
- Rollback-Signal, Request-Epochen, Abort-Verhalten und Latest-request-wins
  bleiben unverändert;
- keine Backend-, KV-, Vercel- oder Cron-Änderungen.

**Abnahme:**

- ein Browser mit gepinnter Generation A entdeckt eine aktive Generation B,
  auch wenn eine Anfrage mit `?snapshot=A` weiterhin A liefern würde;
- der erste Request einer Ladekette trägt keine Generation, alle Folgestufen
  genau die angenommene;
- nach einem Preview-Fehler bleibt auch der Full-Fallback ungebunden, solange
  noch keine Antwort angenommen wurde;
- ältere, headerlose und Rollback-Antworten verhalten sich unverändert;
- eine Chromium-Abnahme reproduziert den Fall mit einer Attrappe, die gepinnte
  A-Anfragen tatsächlich mit A beantwortet.

Erfüllt durch die Deferred-Promise-Fälle in
`tests/frontend/unit/news-load-controller.test.js`, den Verdrahtungswächter in
`tests/frontend/unit/news-generation-wiring.test.js` und die Chromium-Abnahmen
in `tests/e2e/news-generation.spec.ts`. Gegenprobe: mit wieder durchgehend
gepinnten Adressen fallen vier Controller-Tests und beide neuen
Chromium-Abnahmen, mit gepinntem Poll der Verdrahtungswächter.

### A1c – Lokalen Startcache im Admin verständlich darstellen

**Status:** erledigt. Priorität P2, eingeordnet vor O4.

**Warum:** Der Browser speichert als Startcache absichtlich nur die ersten
`LOCAL_NEWS_CACHE_MAX_ARTICLES` (32) Artikel. Bei 39 aktiven Quellen fehlen
darin zwangsläufig die meisten. A1b bezog diesen Cache trotzdem in die
Bewertung jeder Feed-Zeile ein, sodass an fast jedem gesunden Feed stand: „Nur
in der lokalen Kopie dieses Browsers fehlt die Quelle noch – ein
Snapshot-Unterschied, kein Feed-Ausfall.“ Technisch nicht falsch, als
Feed-Diagnose aber irreführend: Das Fehlen im begrenzten Startcache ist
normalerweise gar kein Snapshot-Unterschied.

**Umfang:**

- Feed-Zeilen ausschließlich aus Backend-Status und aktivem News-Snapshot
  ableiten; `AdminFeedHealthRow` kennt den Startcache nicht mehr;
- bei gesunden Feeds keinen Hinweis mehr auf das Fehlen im Startcache;
- den Startcache global eindeutig als **begrenzten** Startcache beschreiben und
  seine tatsächliche Artikel- und Quellenzahl nennen, ohne Gleichheit mit dem
  vollständigen Snapshot zu erwarten;
- gleiche `snapshotId` heißt gleiche Generation, auch bei weniger Quellen;
- zwei belegbar verschiedene Kennungen bleiben deutlich als unterschiedliche
  Generationen sichtbar;
- der Warnungsbereich nennt weiterhin sofort einen konfigurierten Feed ohne
  Artikel im aktiven Snapshot;
- DE und EN vollständig; keine Änderungen an Feed-Abruf, Snapshot-Protokoll,
  Cachegröße oder APIs.

**Abnahme:**

- ein gesunder Feed im aktiven Snapshot, aber nicht im Startcache, bleibt
  schlicht OK und bekommt keinen Zusatz;
- ein Feed ohne Artikel im aktiven Snapshot bleibt eine Warnung, auch wenn er
  im Startcache liegt;
- gleiche Snapshot-ID mit unterschiedlichen Quellenzahlen wird als gleiche
  Generation beschrieben;
- verschiedene Snapshot-IDs bleiben mit beiden Kennungen sichtbar;
- gerenderte Tests belegen die Texte in Deutsch und Englisch.

Erfüllt durch die erweiterten Tests in
`tests/frontend/unit/admin-health-report.test.js`. Gegenproben: mit wieder
mitgerechnetem Startcache fallen drei Tests, mit der alten Beschriftung zwei.

### O4 – Beobachtbarkeit des Cron-Laufs

Das ursprüngliche O4 bündelte vier unabhängige Fragen: einen Bericht je Lauf,
eine Historie über mehrere Läufe, einen Alarmkanal und einen Versionsabgleich
des manuell deployten Proxys. Sie brauchen verschiedene Speicher,
verschiedene Entscheidungen und verschiedene Abnahmen. O4 ist deshalb in vier
Teilpakete geteilt, die einzeln abgeschlossen werden.

#### O4a – Strukturierter Laufbericht und GitHub-Step-Summary

**Status:** erledigt.

`scripts/feed-run-summary.js` baut den Bericht rein und ohne Seiteneffekte aus
Daten, die der Lauf ohnehin hat: `feed_run_status`, `feed_health_status` und
dem Ergebnis des Snapshot-Publishers. **Es entstehen keine neuen KV-Schlüssel.**
Transportweg und HTTP-Status je Feed werden ausschließlich im Arbeitsspeicher
des laufenden Prozesses gesammelt.

Der Bericht nennt Lauf-ID, Ergebnis, bereinigten Degraded- oder Fatalgrund,
Gesamt- und Phasendauern, die Feed-Zähler, Fehler- und Warnquote, die aktive
Snapshot-Kennung mit Artikelzahl und Bytegröße von Full, Medium und Preview
sowie eine begrenzte Tabelle je Feed.

**Eindeutige Semantik:**

- `proxy` heißt, dass die **erfolgreiche** Antwort wirklich vom Proxy kam –
  nicht, dass ein Proxyversuch möglich gewesen wäre;
- eine wegen Zeitbudget zurückgestellte Quelle bekommt `none` und **keinen**
  erfundenen HTTP-Status;
- ein HTTP-Status erscheint nur, wenn er wirklich beobachtet wurde;
- die Artikelzahl zählt nur die in **diesem** Lauf gelieferten Artikel; alte,
  lediglich beibehaltene Artikel stehen dort nie;
- **Nenner der Fehlerquote ist `success + warning + error`.** Unbewertete Feeds
  (`unknown`) bleiben außen vor und werden getrennt genannt. Warnungen stehen im
  Nenner, aber nie im Zähler; damit sie nicht unbemerkt mit echten Fehlern
  verschmelzen, gibt es die Warnquote als eigene Zahl.

Geschrieben wird nur bei gesetztem und nicht leerem `GITHUB_STEP_SUMMARY`, über
einen injizierbaren Writer. Die Zusammenfassung ist **ausschließlich zusätzliche
Beobachtbarkeit**: Weder ein Fehler des Writers noch einer des Berichtsaufbaus
verändert Ergebnis oder Exit-Code, und ein bereits vorhandener Fatalfehler wird
nie überdeckt. Auch `degraded` und `fatal` bekommen eine Zusammenfassung.

Das gilt ebenso für einen Abbruch in der **Vorprüfung**, also vor Recorder und
Feed-Liste. Er bekommt einen bewusst minimalen Bericht: Ergebnis, Lauf-ID und
den bereits sicheren Konfigurationsfehler, der nichts als Variablennamen nennt.
Phasen-, Feed- und Snapshot-Abschnitte entfallen dort ganz – Nullen über nie
betrachtete Quellen wären erfundene Aussagen. Die Reihenfolge bleibt
unverändert: kein Recorder, kein SQL, kein KV, kein HTTP, kein Groq.

Einzelheiten und Grenzen:
[`docs/deployment/feed-run-summary.md`](../deployment/feed-run-summary.md).

**Abnahme:**

- ein Run beantwortet ohne Rohlog-Suche Dauer, Transport, Item-Zahl,
  Fehlerquote, Snapshot und Payload-Größe;
- die Zusammenfassung enthält weder Secrets noch Querystrings, keine Feed- oder
  Proxy-Adressen und keine Artikeltexte;
- ohne `GITHUB_STEP_SUMMARY` entsteht kein Schreibversuch;
- ein Schreibfehler verändert weder Ergebnis noch Exit-Code.

Erfüllt durch `tests/feeds/unit/feed-run-summary.test.js`, die
Transportfälle in `tests/feeds/unit/feed-fetch-utils.test.js` und die
Integrationsfälle gegen das echte `main()` in
`tests/feeds/integration/feed-run-orchestration.test.js`.

#### O4b – Begrenzte Laufhistorie

**Status:** geplant. Nach dem ausdrücklich priorisierten SEO1-Paket wieder
einordnen.

- eine begrenzte Historie über mehrere Läufe hinaus führen, damit ein Trend
  überhaupt sichtbar wird – der Heartbeat kennt nur den letzten Lauf;
- Speicherort, Aufbewahrung und Größengrenze ausdrücklich festlegen;
- die Historie darf den Kern-Publish weder verzögern noch gefährden.

**Abnahme:**

- eine definierte Zahl vergangener Läufe ist abrufbar, ältere fallen
  deterministisch heraus;
- die Historie enthält weder Secrets noch vollständige Proxy-URLs;
- ein Fehler beim Schreiben der Historie macht einen erfolgreichen Lauf nicht
  `fatal`.

#### O4c – Unabhängige Alarmierung

**Status:** Entscheidung des Projektinhabers nötig – Kanal und Plattform sind
offen.

- einen Alarmkanal für veralteten Cache oder ungewöhnlich hohe Fehlerquote
  festlegen; **ein ausgefallener Workflow darf nicht sein eigener einziger
  Monitor sein**;
- Schwellen, Deduplizierung und Recovery-Meldung definieren.

**Abnahme:**

- Alarm, Deduplizierung und Recovery werden mit ausgefallenem sowie wieder
  gesundem Cron getestet;
- der Alarmweg funktioniert auch dann, wenn der Workflow gar nicht mehr läuft;
- keine Secrets in den Meldungen.

#### O4d – Isolierter Proxy-Fingerprint

**Status:** geplant.

- einen nicht geheimen Versionsfingerprint verwenden, damit der manuell
  deployte PHP-Proxy und das Repository verglichen werden können.

**Abnahme:**

- ein isolierter Smoke-Test vergleicht den erwarteten Proxy-Fingerprint, ohne
  Produktionscache oder Feed-Anbieter zu verändern;
- der Fingerprint verrät die Proxy-Adresse nicht;
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

**Status:** erledigt. `services/news-load-controller.ts` besitzt die komplette
Stufenkette. Abort und Request-Epoche stellen gemeinsam sicher, dass nur die
aktuelle Ladung State, `localStorage` und Snapshot-Pin ändern darf. Passive
Auto-Update-Abfragen werden von Refresh, Unmount und einer sichtbaren
Pending-Übernahme entwertet.

**Warum:** Vor F1 konnte eine verspätete Medium- oder Full-Antwort der
initialen Ladekette einen neueren manuellen Refresh wieder überschreiben.
Scheiterte Medium, wurde Full nicht mehr versucht.

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
- eine nach den O3a-Regeln ältere oder unbrauchbare `snapshotId` wird
  verworfen; eine belegbar neuere Generation bleibt weiterhin übernehmbar;
- Deferred-Promise-Tests decken Reihenfolge, Fallback und Fehlerzustände ab;
- ein Chromium-Smoke ergänzt T0 für den vollständigen Stufenablauf.

Erfüllt durch Deferred-Promise-Tests in
`tests/frontend/unit/news-load-controller.test.js` und die Chromium-Abnahmen in
`tests/e2e/news-loading.spec.ts`. Die Trennung von Request-Reihenfolge und
Inhaltsgeneration ist in
`docs/development/progressive-news-loading.md` dokumentiert.

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

**Status:** erledigt. Gespeicherte Suchen verwenden native Buttons mit
`onClick`, sodass Browser Enter und Leertaste korrekt abbilden. Suchfeld,
Speichern und Entfernen sind in DE/EN eindeutig benannt. Die drei
`ArticleCard`-Layouts sind semantische `article`-Container mit einem
gestreckten Titel-Link; sämtliche Aktionsbuttons und Share-Links sind dessen
Geschwister statt ungültig verschachtelte Nachfahren. Der Optionsdialog trägt
einen Accessible Name, ist geschlossen `inert`, schließt mit Escape und löscht
vor der Fokus-Rückgabe seinen verzögerten Fokus-Timer. Unit-Tests prüfen die
DOM-Struktur und den schnellen Escape-Fall, Chromium Enter, Leertaste, Maus,
fehlende Navigation und Fokus-Rückgabe.

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

**Status:** erledigt. Der handgeschriebene `React.memo`-Vergleich ist entfernt;
der sichere Standardvergleich bleibt aktiv. Dadurch löst jedes neue
Artikelobjekt eine Aktualisierung aus, ohne die Optimierung für vollständig
unveränderte Props aufzugeben. Der Regressionstest ändert Zusammenfassung,
Link, Quelle, Sprache und Datum einzeln bei gleicher ID und prüft jeweils die
gerenderte Ausgabe.

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

**Status:** erledigt. `shared/persisted-state.ts` enthält reine Decoder für
Theme, ViewMode, String-Arrays, nullable Strings und `cachedNews`.
`useLocalStorage` verlangt einen passenden Decoder, nutzt ihn beim ersten
Lesen, beim Schreiben und bei `storage`-Events und setzt einen entfernten oder
unbrauchbaren Wert auf den Default des jeweiligen Aufrufers zurück. Die
dokumentierten Defaults sind `light`, `grid`, leere Arrays,
`{ articles: [], timestamp: 0 }` und `null` für die geschlossene Ankündigung.
Ein abgelehnter Browser-Schreibzugriff verhindert die aktuelle
State-Aktualisierung nicht.

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

**Status:** erledigt. `shared/i18n-locale.ts` bildet die aktive i18n-Sprache
einheitlich auf das Datums-Locale ab. Artikel, Trends, Announcement-Zeitstempel
und Cron-Heartbeat verwenden diese Auswahl. Bekannte hart codierte UI-Texte in
den bearbeiteten Komponenten sind durch DE-/EN-Schlüssel ersetzt; technische
Fehlerdetails werden weiterhin protokolliert, aber nicht ungefiltert angezeigt.
Ein React-Regressionstest wechselt die Sprache ohne Remount und prüft Datum,
sichtbaren Fehlertext und Accessible Names in beiden Sprachen.

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

**Status:** erledigt. `hooks/useMutationLatch.ts` setzt die Sperre synchron über
`useRef`, bevor der erste `await` läuft, und gibt sie in jedem Erfolgs- und
Fehlerpfad über `finally` wieder frei; die State-Kopie `isMutating` steuert nur
noch Beschriftung, `aria-busy` und `disabled`. Feed-POST/PUT (`FeedFormModal`)
und Feed-DELETE (`AdminPanel`) haben je einen eigenen Latch, Speichern und
Löschen einer Ankündigung teilen sich bewusst einen gemeinsamen, damit nicht
synchron ein POST und ein DELETE nebeneinander starten.

Das Löschen einer Ankündigung erfolgt nicht mehr unmittelbar, sondern über einen
`alertdialog` mit `useDialogFocus`: initialer Fokus auf „Abbrechen“, Fokusfalle,
Escape schließt vor Beginn der Mutation und ist währenddessen gesperrt – dieselbe
Regel wie im Feed-Löschdialog. Fehlt der Auslöser nach erfolgreicher Löschung,
greift ein Fallback-Fokus; beim Feed ist das „Neuen Feed hinzufügen“, bei der
Ankündigung das Textfeld, weil der Speichern-Knopf ohne Nachricht deaktiviert und
damit nicht fokussierbar wäre. Fehler verwerfen weder Eingaben noch Datensätze
und bleiben als lokalisierte Meldung sichtbar, während der interne Text nur ins
Log geht.

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

Erfüllt durch `tests/frontend/unit/admin-mutation-guards.test.js` und die
erweiterten Tests in `tests/frontend/unit/announcement-tab.test.js`. Beide lösen
je Flow zwei Aktionen ohne `await` dazwischen aus und belegen gegen den
Ausgangsstand, dass ohne Latch zwei Requests entstanden wären.

### A1b – Admin-Tabs und Health-Semantik

**Status:** erledigt. Die Reiterleiste folgt derselben Semantik wie der
Einstellungsdialog (`admin-tab-<id>` / `admin-panel-<id>`, `aria-selected`,
`aria-controls`, `aria-labelledby`, roving `tabIndex`, Pfeiltasten mit Umlauf,
Home und End); Tastaturnavigation setzt Auswahl **und** Fokus. Die
Aufklapp-Schaltflächen für Fehler- und Warnungsdetails unterscheiden in ihrem
Namen Fehler von Warnungen und Ein- von Ausblenden und steuern dauerhaft
gerenderte Bereiche.

`services/admin-health-report.ts` leitet den Bericht rein und ohne i18n ab und
trennt drei Kennzahlen: konfigurierte Feeds aus der Datenbank, Quellen mit
Artikeln im aktiven News-Snapshot und Quellen in der lokalen Browserkopie.
Letztere zählt nur, wenn sie derselbe Laufzeit-Decoder wie im Frontend annimmt
und sie innerhalb der gemeinsamen 30-Minuten-Frist aus
`shared/local-news-cache.ts` liegt – dieselbe Konstante verwendet auch
`App.tsx`. Verglichen werden Generationen ausschließlich über zwei belegbare
Kennungen; eine fehlende heißt „Legacy/unbekannt“, nie „gleich“. Damit trennt
das Admin den Fall VG247 (erfolgreich abgerufen, aber nicht im aktiven
Snapshot: Warnung) sauber von GameStar (im aktiven Snapshot, nur in einer
älteren lokalen Kopie nicht: OK mit Hinweis, kein Feed-Ausfall).

Der Legenden-Reiter beschreibt dieselben Regeln: keine Dateinamen der alten
Architektur, keine behauptete Live-Prüfung einzelner Feeds und kein Eintrag
„Prüfe“ mehr, weil dieser Zeilenstatus nirgends gesetzt wird.

Backend-Abrufstatus und Snapshot-Präsenz bleiben getrennt. Eine Backend-Warnung
bleibt deshalb immer eine Warnung: Der Cron vergibt sie für eine wegen
Zeitbudget zurückgestellte Quelle und für einen erfolgreich abgerufenen, aber
leeren Feed. Beide behalten ihre **älteren** Artikel im aktiven Snapshot, und
deren Präsenz belegt keinen erfolgreichen Abruf. Die bereits cron-seitig
bereinigte Meldung erscheint in einem lokalisierten Satz zusammen mit der
getrennten Snapshot-Aussage.

Die unscharfe Namensnormalisierung ist entfernt. Zugeordnet wird nur über exakt
gleiche Quellennamen; Snapshot-Namen ohne passenden Feed werden separat
aufgelistet, statt einen ähnlich geschriebenen Feed auf „OK“ zu setzen. Jeder
konfigurierte Feed bleibt eine eigene Zeile. Die redundanten
Aktualisieren-Symbole je Feed-Zeile führten in Wahrheit denselben globalen
Abruf aus und sind entfallen; der zentrale Knopf heißt „Gespeicherten
Statusbericht neu laden“ und nennt ausdrücklich, dass weder ein RSS-Abruf noch
ein GitHub-Action-Lauf startet.

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

Erfüllt durch `tests/frontend/unit/admin-panel-a11y.test.js` und
`tests/frontend/unit/admin-health-report.test.js`. Beide prüfen die echte
Admin-Komponente; die reine Ableitung wird zusätzlich mit kontrollierter Uhr
direkt getestet. Ein gerenderter Test prüft den Legenden-Reiter in DE und EN.
Gegenproben: mit wiederhergestellter Namensnormalisierung beziehungsweise mit
„fehlende Kennung gilt als gleich“ fallen jeweils zwei Tests, ohne die
ausdrückliche Behandlung von `warning` fünf, mit den alten Legendentexten der
Legenden-Test.

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

## Meilenstein 6: Auffindbarkeit und messbares SEO

Dieser Meilenstein reagiert auf einen gemessenen Produktionszustand, nicht auf
eine allgemeine SEO-Vermutung. Die React-App wird nicht umgeschrieben. Zuerst
entsteht ein kleiner hybrider Versuch mit crawlbarem HTML; erst Search-Console-
Daten entscheiden über zusätzliche Seiten oder eine größere Architektur.

Einzelheiten und die zeitgebundene Baseline:
[`docs/development/seo-indexing.md`](seo-indexing.md).

### SEO0 – Search-Console-Baseline und Leitplanken

**Status:** erledigt.

Am 30. Juli 2026 wurden Leistung, Seitenindexierung, Sitemap, URL-Prüfung,
Links, manuelle Maßnahmen und Sicherheitsprobleme geprüft:

- 0 indexierte und 2 nicht indexierte URLs;
- Startseite am 25. Juni erfolgreich gecrawlt, aber nicht indexiert;
- `/gaming-news` gefunden, aber nicht gecrawlt beziehungsweise indexiert;
- Sitemap erfolgreich gelesen und beide URLs in aktuellen Live-Tests
  technisch indexierbar;
- 0 Klicks und 0 Impressionen in den letzten 28 Tagen;
- keine erkannten internen oder externen Links;
- keine manuelle Maßnahme und kein Sicherheitsproblem.

Diese Daten enthalten keine Kontoadresse, Tokens oder vollständigen
Search-Console-Exporte. Sie begründen SEO1, garantieren aber keine spätere
Indexierung.

### SEO1 – Crawlbare Einstiege und ehrliche Metadaten

**Status:** erledigt. Priorität P2, ausdrücklich vor O4b eingeordnet.

**Warum:** Die Startseite lieferte im ursprünglichen HTML nur einen leeren
React-Container. `/gaming-news` ist zwar servergerendert und in der Sitemap,
wird aus der laufenden App aber nirgends mit einem normalen Link erschlossen.
Statische Metadaten nennen eine längst veraltete exakte Quellenzahl, und die
strukturierten Daten versprechen `?search=`, obwohl die App diesen URL-Parameter
nicht als Suche verarbeitet.

**Umfang:**

- alle statischen Startseiten-Texte in Meta-, Open-Graph-, Twitter- und
  strukturierten Daten zeitstabil formulieren, ohne exakte Quellenzahl;
- die `SearchAction` vollständig entfernen; keine neue URL-Suche in diesem
  Paket implementieren;
- innerhalb von `#root` einen kleinen, ohne JavaScript sichtbaren
  HTML-Fallback mit genau einer Überschrift, einer eigenen Beschreibung und
  einem normalen Link zu `/gaming-news` liefern;
- der Fallback ist weder versteckt noch außerhalb des Viewports platziert und
  enthält keine dynamische beziehungsweise kopierte Artikelliste;
- die laufende React-App verlinkt `/gaming-news` sichtbar und lokalisiert,
  vorzugsweise im Footer; nach dem React-Start bleibt genau eine sichtbare H1;
- `/gaming-news` erhält einen kurzen eigenständigen Einleitungstext, der
  Nutzen, Quellenprinzip und Aktualisierung erklärt, ohne fremde
  Artikelzusammenfassungen als eigene Inhalte auszugeben;
- die bereits vorhandene Rückverlinkung von `/gaming-news` zur App bleibt eine
  normale, crawlbare Verbindung;
- die SEO-Dokumentation und relevante Architekturhinweise werden mit dem
  tatsächlichen Verhalten synchronisiert.

**Nicht enthalten:**

- kein React-, Vite- oder Framework-Rewrite;
- keine neue Datenbank und kein Wechsel vom KV-Snapshot;
- keine neuen Quellen-, Themen-, Plattform- oder Datumsseiten;
- kein Sitemap-Generator, keine Search-Console-API und kein automatischer
  Indexierungsantrag;
- kein Deployment und keine Änderung an Google-, Vercel- oder
  GitHub-Einstellungen.

**Abnahme:**

- ein Test des ursprünglichen `index.html` und des Production-Builds findet
  eine sichtbare H1, eigenen Beschreibungstext und einen internen
  `/gaming-news`-Link bereits ohne JavaScript;
- kein statischer SEO-Text enthält „über 15“ oder eine andere fest verdrahtete
  Quellenanzahl; die strukturierten Daten enthalten keine `SearchAction`;
- ein gerenderter Frontend-Test und eine Chromium-Abnahme belegen den
  lokalisierten Link, ohne die bestehende App-Navigation zu beschädigen;
- Handler-Tests belegen H1, eigenen Einleitungstext, Canonical und die
  wechselseitigen Links von `/gaming-news`;
- JavaScript-Ansicht und HTML-Fallback geben keine widersprüchlichen Aussagen
  aus und erzeugen nach App-Start keine doppelte H1;
- `npm test`, `npm run typecheck`, `npm run build`, `npm run test:e2e` und
  beide Diff-Checks sind erfolgreich.

**Ergebnis:** Alle Abnahmepunkte sind erfüllt. 759 zentrale Tests und 30
Browser-Abnahmen laufen erfolgreich.

Bewusst **nicht** angefasst, weil außerhalb des Umfangs: Die Meta-Description
von `/gaming-news` entsteht weiterhin aus den ersten drei Artikeltiteln. Das ist
kein eigener redaktioneller Fließtext, sondern eine Auflistung – der neue
Einleitungstext daneben ist davon unabhängig. Ob die Description auf einen
eigenen zeitstabilen Text umgestellt wird, entscheidet SEO2 anhand der dann
sichtbaren Snippets.

Ebenfalls unverändert: `?search=` bleibt keine adressierbare Suche. Eine
`SearchAction` darf erst wieder entstehen, wenn dieser Parameter tatsächlich
als URL-Suche funktioniert.

### SEO2 – Indexierungs- und Mess-Gate

**Status:** bereit. Erst nach Merge und Production-Rollout von SEO1.

SEO2 ist überwiegend eine manuelle Abnahme, kein neuer Funktionsblock:

- beide URLs in der Search Console live testen;
- bei erfolgreichem Test jeweils einmal die Indexierung beantragen;
- nach 7, 14 und 28 Tagen Indexierungszustand, Klicks, Impressionen,
  thematische Suchanfragen und erkannte Links festhalten;
- Unterschiede zur SEO0-Baseline dokumentieren, ohne persönliche Konto- oder
  Token-Daten zu speichern.

**Gate:** Mindestens eine indexierte URL oder echte thematische Impressionen
sind ein positives Signal. Bleiben nach 28 Tagen beide URLs trotz erfolgreichem
Live-Test ausgeschlossen, beginnt SEO3 nicht. Dann werden zuerst Inhalt,
Domain, Canonical-Signale und der aktuelle Ausschlussgrund erneut geprüft.

### SEO3 – Ein eigenständiger Content-Pilot

**Status:** später. Priorität P3, nur nach positivem SEO2-Gate.

- aus echten Suchanfragen oder einem klaren Nutzerproblem genau einen
  dauerhaft pflegbaren Seitentyp auswählen;
- eigenen Nutzen und eigene Einordnung liefern, statt nur fremde Titel neu zu
  gruppieren;
- vor einer Vervielfältigung den einzelnen Pilot erneut messen.

**Abnahme:** Inhalt, URL-Lebenszyklus, Aktualisierung, Canonical, interne
Verlinkung und Rückbau sind vor Implementierung festgelegt. Ohne belastbaren
Pilot entstehen keine automatisch vervielfältigten SEO-Seiten.

### SEO4 – Eigene Domain und externe Reichweite

**Status:** Entscheidung des Projektinhabers nötig. Priorität P3.

- vor einer größeren URL-Struktur entscheiden, ob die Vercel-Subdomain
  dauerhaft bleibt oder eine eigene Domain verwendet wird;
- bei einem Wechsel Redirects, Canonicals, Sitemap, Search-Console-Property
  und Rollback gemeinsam planen;
- externe Reichweite, passende Verweise und Community-/Social-Verteilung als
  Produktarbeit behandeln – HTML allein erzeugt keine Nachfrage;
- Messung so bewerten, dass zustimmungsabhängiges Google Analytics nicht als
  vollständige Besucherzählung missverstanden wird.

Diese Entscheidung blockiert den kleinen SEO1/SEO2-Versuch nicht, aber eine
breite Content- und URL-Strategie.

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
