# Zeitbudget, Scrape-Budget und Ergebniszustände des Cron-Laufs

Stand: 28. Juli 2026 (Roadmap-Paket O2b)

O2a hat jeden **einzelnen** externen Aufruf begrenzt. Ihre **Summe** war damit
weiterhin ungedeckelt. O2b schließt diese Lücke.

## Warum überhaupt eine Deadline

Der Workflow `update-feeds.yml` hat `timeout-minutes: 30`. Wird dieses Limit
erreicht, bricht GitHub den Job **hart** ab. Das ist der eigentliche Schaden:

- der Abbruch läuft **nicht** durch den normalen Fehlerpfad;
- `recordFatal` kommt nie dran, der Heartbeat bleibt bei `running` stehen;
- niemand erfährt, welche Phase die Zeit verbraucht hat.

Ein *eigener*, früher Abbruch ist deshalb besser als ein fremder, später: er
veröffentlicht noch, schreibt den Heartbeat und benennt den Grund.

## Die beiden Grenzen

| Grenze | Wert | Wo |
|---|---|---|
| `CORE_DEADLINE_MS` | 18 Minuten ab Skriptstart | `scripts/feed-run-budget.js` |
| Sicherheitsreserve bis zum Hardlimit | 12 Minuten | ergibt sich aus 30 − 18 |
| `MAX_ARTICLE_PAGE_FETCHES_PER_RUN` | 80 Seitenabrufe pro Lauf | `scripts/feed-run-budget.js` |
| Reserve für optionale Phasen | 3 Minuten Restzeit | `OPTIONAL_PHASE_MIN_REMAINING_MS` |

### Herleitung der 18 Minuten

Die 12 Minuten Reserve sind kein runder Wunschwert, sondern gehen an konkrete
Posten:

- Checkout, `npm ci` und `npm run test:feeds` laufen **vor** dem Skript – in der
  Praxis 2–4 Minuten;
- Kern-Publish (drei KV-Writes), Trendphase (höchstens zwei Groq-Aufrufe mit je
  20 s) und der abschließende Heartbeat liegen **nach** der Deadline;
- der Rest ist bewusst ungenutzter Puffer für einen langsamen Runner.

Die 18 Minuten passen zugleich zu den Einzelgrenzen aus O2a: 16 Feeds mit je
zwei Versuchen à 15 s ergeben schlimmstenfalls rund 8 Minuten, 80 Seitenabrufe
mit je 5 s Timeout und 0,5 s Pause rund 7,3 Minuten.

### Warum ein gemeinsames Seitenbudget

Neue OG-Scrapes und der Backfill alter Artikel rufen **dieselbe Art** fremder
Artikelseiten ab und kosten dieselbe Laufzeit. Zwei getrennte Budgets wären eine
Einladung, die Obergrenze über den jeweils anderen Weg zu umgehen. Die
bestehenden Backfill-Grenzen (30 gesamt, 5 je Quelle) bleiben als *innere*
Begrenzung erhalten.

## Wie die Deadline wirkt

Zwei Mechanismen, weil einer allein nicht reicht:

1. **Vor jedem Arbeitsschritt** – vor jeder Quelle, vor jedem Seitenabruf – wird
   die Restzeit geprüft. Das verhindert, dass überhaupt neue Arbeit beginnt.
2. **Während laufender Arbeit** feuert ein Timer auf die Deadline und bricht den
   gemeinsamen `AbortController` ab. Ohne ihn liefe eine hängende Gegenstelle
   trotz erreichter Deadline bis in ihr eigenes Einzeltimeout.

Zusätzlich kürzt `requestSignal(timeoutMs)` jedes Einzeltimeout auf die
Restzeit: keine Anfrage darf länger laufen, als der Lauf überhaupt noch hat.

Der Abbruchgrund ist ein **fester Satz ohne Adresse, Quelle oder
Konfigurationswert**. Er landet in Fehlertexten laufender Anfragen und damit
potenziell im Log – ein dynamischer Text wäre dort ein Leck.

## Zurückgestellt ist nicht gescheitert

| Fall | Feed-Status | Folge |
|---|---|---|
| Quelle nicht erreichbar | `error` | Fehler der Quelle |
| Quelle kam nicht mehr dran | `warning`, Meldung „Zurückgestellt: Zeitbudget des Laufs erschöpft." | kein Fehler der Quelle |

Eine zurückgestellte Quelle behält ihr `lastSuccessAt`, und ihre alten Artikel
bleiben im Cache – innerhalb der bestehenden Retention (60 Tage) und
Artikelgrenze (10.000). Das Bytebudget bleibt O3b vorbehalten.

### Faire Verteilung der Bild-Scrapes

Ohne Verteilung frisst die alphabetisch oder zufällig erste Quelle das gesamte
Scrape-Budget – und zwar **Lauf für Lauf dieselbe**. `distributeBySourceFairly`
ordnet die offenen Artikel deshalb reihum: erst je ein Artikel jeder Quelle,
dann der zweite jeder Quelle, und so weiter. Bei einem Budget von 3 und drei
Quellen bekommt jede genau einen Abruf.

Die Reihenfolge ist deterministisch (`Map` behält die Einfügereihenfolge), damit
der Effekt testbar bleibt.

### Reparierbar im nächsten Lauf

Ein zurückgestellter Artikel geht nicht verloren: er bekommt einen Platzhalter
(`placehold.co`). `needsStoredImageRepair` erkennt Platzhalter, deshalb ist der
Artikel im nächsten Lauf automatisch wieder Kandidat – entweder als neuer
Scrape (der Cache liefert kein brauchbares Bild) oder über den Backfill.

## Die drei Ergebniszustände

| Zustand | Bedeutung | Exit-Code |
|---|---|---|
| `success` | Kernlauf vollständig **und** keine Arbeit wegen des globalen Budgets zurückgestellt | 0 |
| `degraded` | sicherer Kern-Publish, aber Arbeit wurde kontrolliert zurückgestellt (Deadline oder Scrape-Budget) | 0 |
| `fatal` | kein vertrauenswürdiger Kernabschluss möglich | ≠ 0 |

Die Abgrenzung ist der Kern des Pakets:

- **`degraded` ist kein `success`.** Ein stillschweigendes `success` wäre die
  eigentliche Gefahr: der Heartbeat meldete einen vollständigen Stand, obwohl
  Quellen oder Bilder fehlen. Deshalb entscheidet genau eine Funktion darüber –
  `resolveRunResult` in `shared/feed-health-model.js`.
- **`degraded` ist kein `fatal`.** Der Kern-Publish hat stattgefunden, die Daten
  sind gültig, nur unvollständig. Der Lauf endet mit Exit-Code 0; ein roter
  Actions-Lauf wäre hier ein Fehlalarm.
- **Ein `fatal` fasst den gespeicherten Kern-Publish nie an.** Ein gescheiterter
  Versuch darf einen älteren, aber erfolgreichen Publish- oder Feed-Status nicht
  überschreiben – das galt schon in O1 und bleibt so.
- **Ein nicht schreibbarer `feed_health_status` bleibt `fatal`**, nicht
  `degraded`. `degraded` beschreibt *bewusst zurückgestellte* Arbeit bei sonst
  vertrauenswürdigem Stand; ein nicht geschriebener Feed-Status ist dagegen ein
  **unbekannter** Stand.

Der Grund steht als `degradedReason` im `feed_run_status`, läuft durch dieselbe
Bereinigung wie jede andere Meldung und erscheint im Admin-Panel unter „Letzter
Lauf". Ohne ihn wäre „eingeschränkt" nicht handhabbar: ein erschöpftes
Zeitbudget verlangt eine andere Reaktion als ein erschöpftes Scrape-Budget.

Ein `success` trägt nie einen `degradedReason` – der Zustand sagte sonst
„vollständig" und der Text „es fehlt etwas".

## Optionale Phasen entfallen früh

Unterschreitet die Restzeit `OPTIONAL_PHASE_MIN_REMAINING_MS`, wird die
Trendphase **gar nicht erst begonnen**. Anfangen und mittendrin abgeschnitten
werden wäre der schlechtere Tausch: die Trends sind verzichtbar, der saubere
Laufabschluss nicht.

Wichtig für die Auswertung: eine **wegen des Budgets** übersprungene Trendphase
macht den Lauf `degraded`. Eine wegen **fehlendem `GROQ_API_KEY`**
übersprungene nicht – das ist Konfiguration, keine Zurückstellung.

## Konfiguration

| Variable | Vorgabe | Bereich |
|---|---|---|
| `FEED_CORE_DEADLINE_MS` | 1.080.000 (18 min) | 60.000 bis 1.500.000 (25 min) |
| `FEED_SCRAPE_LIMIT` | 80 | 0 bis 1000 |

Beide sind optional. Ein **unbrauchbarer Wert schaltet die Grenze nicht ab**,
sondern fällt auf die Vorgabe zurück und meldet das – eine kaputte Zahl darf
weder eine unbegrenzte noch eine absurd kurze Laufzeit ergeben. Gemeldet wird
wie überall nur der Variablenname.

Auch das erlaubte Maximum bleibt 5 Minuten unter dem Hardlimit. Eine
Konfiguration kann die Sicherheitsreserve also verkleinern, aber nicht
beseitigen.

## Parallelität: bewusst unverändert

O2b **erhöht die Feed-Parallelität nicht**. Es gibt keine Messdaten, die das
rechtfertigen, und die Roadmap schließt ungezügelte Parallelisierung aus. Der
Lauf hält weiterhin genau **einen** offenen Request; ein Regressionstest misst
die größte gleichzeitige Anzahl und fällt auf, sobald sich das ändert.

## Testbarkeit

`createRunBudget` nimmt `now`, `setTimer`, `clearTimer` und
`createTimeoutSignal` als Parameter; `main()` nimmt zusätzlich `budget` und
`sleep`. Nur deshalb sind die Grenzfälle **direkt vor**, **genau auf** und
**nach** der Deadline ohne echte Wartezeit prüfbar.

In den Integrationstests liefert `createTimeoutSignal` bewusst ein Signal, das
nie von selbst feuert. Damit kann eine hängende Anfrage **ausschließlich** über
den kontrollierten Gesamtabbruch enden – genau die Zusage, die geprüft werden
soll.

Kein Test wartet echt, und keiner berührt einen Feed, Groq, KV, PostgreSQL,
Vercel, Cyon oder den Proxy.

## Bewusst nicht enthalten

- Byte-Budget und größenbegrenzter Publish (O3b);
- generationsgebundenes Leseprotokoll (O3a);
- Historie, Alarmierung und `GITHUB_STEP_SUMMARY` (O4) – O2b macht den Zustand
  im Heartbeat sichtbar, meldet ihn aber nicht aktiv;
- Änderungen am Workflow-Zeitplan, an Secrets, an Vercel, Cyon oder am
  PHP-Proxy.
