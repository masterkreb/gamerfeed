# Laufbericht des Cron-Jobs (GitHub-Step-Summary)

Roadmap O4a. Jeder Lauf von `scripts/fetch-feeds.js` schreibt eine kurze
Zusammenfassung in die Job-Übersicht von GitHub Actions. Sie beantwortet die
wichtigsten Betriebsfragen, ohne dass jemand die vollständigen Rohlogs
durchsuchen muss.

## Wo sie erscheint

Die Zusammenfassung wird **nur** geschrieben, wenn `GITHUB_STEP_SUMMARY`
gesetzt und nicht leer ist – also praktisch nur im Actions-Kontext. Lokal
passiert nichts, und es wird nicht einmal ein Schreibversuch unternommen.

Das gilt für **jeden** Ausgang des Laufs, auch für einen Abbruch in der
Vorprüfung. Fehlt ein Core-Secret, entsteht ein bewusst minimaler Bericht:
Ergebnis, Lauf-ID und der Konfigurationsfehler, der nichts als Variablennamen
nennt. Phasen-, Feed- und Snapshot-Abschnitte fehlen dort vollständig – zu
diesem Zeitpunkt gab es weder Recorder noch Feed-Liste noch einen externen
Zugriff, und Nullen wären erfundene Aussagen. Die Reihenfolge der Vorprüfung
bleibt unangetastet.

Sie erscheint unter dem Workflow-Lauf im Reiter *Summary*.

## Was drinsteht

| Abschnitt | Inhalt |
|---|---|
| Kopf | Ergebnis (`success`, `degraded`, `fatal`), Lauf-ID, bereinigter Grund |
| Dauern | Gesamt, Feed-Abruf, Bild-Scraping, Bild-Backfill, Publish, Trends |
| Feeds | Zähler nach Erfolg, Warnung, Fehler, unbekannt sowie Fehler- und Warnquote |
| Snapshot | aktive Generation, Artikelzahl und Bytegröße von Full, Medium, Preview |
| Quellen | je Feed: Ergebnis, Dauer, gelieferte Artikel, übersprungene Items, Transport, HTTP-Status |

## Begriffe, die genau gemeint sind

**Transport** beschreibt den Weg, über den die **erfolgreiche** Antwort kam:

- `direct` – der Direktabruf hat funktioniert;
- `proxy` – erst der PHP-Proxy lieferte einen gültigen Feed. Das heißt
  ausdrücklich *nicht*, dass ein Proxyversuch bloß möglich gewesen wäre;
- `none` – es gab keine tragende Antwort. Das gilt auch für eine wegen des
  Zeitbudgets **zurückgestellte** Quelle: Sie ist nicht kaputt, sie kam nur
  nicht mehr dran.

**HTTP-Status** erscheint nur, wenn er wirklich beobachtet wurde. Ein
Verbindungsfehler oder eine zurückgestellte Quelle zeigt `–`; es wird nie ein
Status geraten. Nach einem gescheiterten Proxyversuch zählt der Status des
Proxys, weil er der zuletzt versuchte Weg war.

**Artikel** zählt ausschließlich die in **diesem** Lauf gelieferten Artikel.
Alte Artikel, die eine zurückgestellte oder leere Quelle im Snapshot behält,
erscheinen hier nicht – sonst sähe ein Lauf ohne jede Lieferung erfolgreich aus.

**`–` heißt: keine verlässliche Messung. `0` heißt: tatsächlich gemessen.**
Übersprungene Items werden nur gezählt, wenn das Parsen wirklich stattgefunden
hat. Ein Abruffehler, eine wegen des Zeitbudgets zurückgestellte Quelle und ein
Parse-Abbruch haben nie ein Element angesehen – sie zeigen deshalb `–`, nicht
`0`. Dasselbe gilt für Dauer und Artikelzahl. Eine `0` erscheint nur dort, wo
sie gemessen wurde, etwa bei einem erfolgreich geparsten Feed ohne verworfene
Elemente. Unbrauchbare Werte ergeben `–`, nie eine Zahl.

**Fehlerquote** hat einen festen Nenner:

```text
Fehlerquote  = error   / (success + warning + error)
Warnquote    = warning / (success + warning + error)
```

- `unknown` steht **nicht** im Nenner. Diese Quellen wurden in diesem Lauf gar
  nicht beurteilt, etwa weil er vorher abbrach. Sie mitzuzählen würde die Quote
  beschönigen, sie in den Zähler zu nehmen würde sie erfinden. Ihre Zahl steht
  deshalb ausdrücklich daneben.
- Warnungen stehen im Nenner, aber **nie** im Zähler. Eine zurückgestellte oder
  artikellose Quelle ist kein Abruffehler. Damit die beiden Befunde trotzdem
  nicht unbemerkt verschmelzen, wird die Warnquote getrennt ausgewiesen.

## Was garantiert nicht drinsteht

- keine Secret-Werte (`POSTGRES_URL`, `KV_REST_API_*`, `GROQ_API_KEY`,
  `FEED_PROXY_URL`) – es gilt dieselbe Bereinigung wie im Heartbeat;
- **keine eingebetteten Zugangsdaten**, und zwar unabhängig vom Schema:
  `sanitizeErrorMessage` entfernt `user:pass@` und den Querystring aus jeder
  Adresse mit `scheme://`, also auch aus `postgres://`, `postgresql://` und
  `redis://`. Die Zusage hängt damit **nicht** davon ab, dass eine Meldung die
  konfigurierte Verbindungszeichenfolge bytegenau wiederholt;
- keine vollständige Proxy-Adresse und keine Querystrings;
- keine Feed-URLs;
- keine Artikel-URLs, -Titel oder -Inhalte;
- keine Rohantworten von Anbietern.

Feed-Namen stammen aus der Datenbank und werden für Markdown entschärft:
Zeilenumbrüche und Steuerzeichen fallen weg, `|` und Formatierungszeichen
werden escaped, und die Länge ist begrenzt. Eine Quelle kann die Tabelle also
nicht zerlegen.

## Grenzen

- **Die Zusammenfassung ist ausschließlich zusätzliche Beobachtbarkeit.** Ein
  Fehler beim Schreiben – oder beim Aufbau des Berichts – verändert weder das
  Ergebnis des Laufs noch seinen Exit-Code und überdeckt niemals einen bereits
  vorhandenen Fatalfehler. Er wird nur protokolliert.
- Die Tabelle ist auf `SUMMARY_MAX_FEED_ROWS` (50) Zeilen begrenzt; weitere
  Quellen werden nur noch gezählt.
- **Es entstehen keine neuen KV-Schlüssel.** Transport und HTTP-Status leben
  ausschließlich im Arbeitsspeicher des laufenden Prozesses und werden nirgends
  gespeichert; das Schema von `feed_run_status`, `feed_publish_status` und
  `feed_health_status` bleibt unverändert.
- Es gibt **keine Historie** über den letzten Lauf hinaus – das ist O4b.
- Es gibt **keinen Alarmkanal**; ein ausgefallener Workflow schreibt auch keine
  Zusammenfassung. Das ist O4c.
- Es gibt **keinen Proxy-Fingerprint** – das ist O4d.
- Die bestehenden Garantien bleiben unangetastet: Ein Schreibfehler bei
  `feed_health_status` bleibt fatal, die Heartbeat-Metadaten bleiben best
  effort, und Preflight, Deadline, Snapshot-Publish sowie die Exit-Code-Semantik
  sind unverändert.

## Testbarkeit

`main()` nimmt `writeSummary` als Parameter. Tests reichen eine Attrappe herein
und brauchen deshalb keine echte Actions-Datei. Die reine Ableitung liegt in
`scripts/feed-run-summary.js` und ist ohne jeden Seiteneffekt prüfbar.
