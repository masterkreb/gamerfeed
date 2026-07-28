# Cron-Heartbeat und Frische

Stand: 28. Juli 2026 (Roadmap-Paket O1)

Ein grüner `feed_health_status` sagte bisher nur, wie der **letzte** Lauf
ausgegangen ist – nicht, ob es diesen Lauf überhaupt noch gibt. Ein
ausgefallener Workflow blieb deshalb unbegrenzt grün.

Seit O1 werden drei Fragen getrennt beantwortet:

| Frage | Datenquelle | Anzeige im Admin |
|---|---|---|
| Läuft der Workflow überhaupt noch? | `feed_run_status` | „Letzter Lauf“ |
| Hat der Lauf wirklich veröffentlicht? | `feed_publish_status.lastCorePublishAt` | „Letzter Kern-Publish“ |
| Wann hat zuletzt ein Feed Artikel geliefert? | `feed_publish_status.lastContentUpdateAt` | „Inhaltsfrische“ |

> **Was „Inhaltsfrische“ nicht bedeutet:** Sie belegt nicht, dass **neue**
> Artikel erkannt wurden. Ein Feed, der unverändert dieselben Artikel liefert,
> schreibt die Inhaltsfrische genauso fort wie ein Feed mit echten Neuigkeiten.
> Eine Novelty- oder Deduplizierungserkennung gehört ausdrücklich nicht zu O1.
> Die Aussage lautet: „Mindestens eine Quelle hat überhaupt Artikel geliefert.“

Die gemeinsame Logik steht in [`shared/feed-health-model.js`](../../shared/feed-health-model.js)
und wird vom Cron-Skript, von der Health-API und vom Admin-Panel benutzt. Sie
enthält keinen Netzwerk- und keinen `node:`-Zugriff und läuft deshalb auch in
der Edge-Runtime.

## Schwelle

```text
FEED_STALE_AFTER_MS = 50 * 60 * 1000   // 50 Minuten
```

Der Workflow läuft alle 20 Minuten. 50 Minuten lassen zwei ausgefallene Läufe
plus die Anlaufverzögerung der GitHub-Actions-Warteschlange zu, bevor „veraltet“
angezeigt wird.

Die Grenze ist bewusst eindeutig definiert:

- Alter **kleiner als** die Schwelle: aktuell
- Alter **exakt gleich** der Schwelle: noch aktuell
- Alter **größer als** die Schwelle: veraltet
- **kein** Zeitstempel vorhanden: veraltet, nie „aktuell“

## Zeitstempel aus der Zukunft

```text
FEED_CLOCK_SKEW_TOLERANCE_MS = 2 * 60 * 1000   // 2 Minuten
```

GitHub-Runner, Vercel-Edge und KV laufen auf unterschiedlichen Uhren; ein paar
Sekunden Vorlauf sind normal und bleiben deshalb folgenlos. Ein Zeitstempel, der
**weiter als diese Toleranz** in der Zukunft liegt, wird konservativ als
ungültig behandelt: `isFuture: true` und damit auch `isStale: true`.

Ohne diese Regel würde ein einziger falsch gesetzter Wert – eine verstellte
Runner-Uhr, ein manuell geschriebener KV-Eintrag – unbegrenzt lange als „frisch“
gelten und genau den Ausfall verdecken, den der Heartbeat melden soll. Das Admin
zeigt solche Werte als „Zeitstempel in der Zukunft“ und blendet die Altersangabe
aus, statt ein negatives Alter anzuzeigen.

Die Schwelle ist fest im Code dokumentiert, nicht über eine Umgebungsvariable
konfigurierbar. Sie ist damit Teil des geprüften Verhaltens; ein Testlauf kann
sie über den Parameter `staleAfterMs` überschreiben.

Damit die Läufe nicht schon durch die Warteschlange in die Schwelle laufen,
startet der Workflow seit O1 zu den Minuten `7,27,47` statt zur stark belasteten
Minute `0`.

## KV-Schlüssel

### `feed_run_status` – veränderlicher Versuch

Wird **dreimal je Lauf** geschrieben:

1. beim Start mit `result: "running"`;
2. nach dem Kern-Publish – weiterhin `running`, nur mit nachgetragenen Zählern
   und Phasendauern;
3. am tatsächlichen Ende mit `finishedAt` und dem Ergebnis.

Der zweite Schreibvorgang setzt bewusst **nicht** auf `success`. Die Trendphase
läuft zu diesem Zeitpunkt noch; ein Abbruch oder Timeout zwischen Kern-Publish
und Laufende soll als hängen gebliebener Lauf sichtbar sein, nicht als sauber
beendeter. Ein Datensatz ohne `finishedAt` wird am `startedAt` gemessen und
damit nach `FEED_STALE_AFTER_MS` veraltet.

```json
{
  "schemaVersion": 1,
  "runId": "gha-1234567-1",
  "startedAt": "2026-07-28T11:47:02.104Z",
  "finishedAt": "2026-07-28T11:49:31.882Z",
  "result": "success",
  "fatalError": null,
  "feeds": { "total": 15, "success": 14, "warning": 0, "error": 1, "unknown": 0 },
  "durations": {
    "totalMs": 149778, "feedFetchMs": 61204, "imageScrapeMs": 52310,
    "imageBackfillMs": 21005, "publishMs": 812, "trendsMs": 14447
  }
}
```

- `runId` ist die GitHub-Actions-Run-ID (`gha-<run>-<attempt>`) oder bei lokalen
  Läufen `local-<uuid>`. Beide sind nicht geheim.
- `result` kennt heute `running`, `success` und `fatal`. `degraded` ist im
  Vertrag bereits vorgesehen, wird aber erst mit O2b vergeben.
- `fatalError` wird vor dem Speichern bereinigt: konfigurierte Secret-Werte,
  Zugangsdaten in URLs und Querystrings werden entfernt, die Meldung auf 300
  Zeichen gekürzt.

### `feed_publish_status` – letzter erfolgreicher Kern-Publish

Wird **ausschließlich** geschrieben, nachdem `news_cache`, `news_cache_16` und
`news_cache_64` erfolgreich gespeichert wurden. Ein gescheiterter Versuch lässt
den Schlüssel unangetastet.

```json
{
  "schemaVersion": 1,
  "runId": "gha-1234567-1",
  "lastCorePublishAt": "2026-07-28T11:49:30.220Z",
  "lastContentUpdateAt": "2026-07-28T11:49:30.220Z",
  "newestArticleAt": "2026-07-28T11:31:00.000Z",
  "articleCount": 4213,
  "feeds": { "total": 15, "success": 14, "warning": 0, "error": 1, "unknown": 0 },
  "durations": { "…": null }
}
```

Der Unterschied zwischen den beiden Zeitstempeln trägt die eigentliche Aussage:

- `lastCorePublishAt` steigt bei **jedem** geschriebenen News-Cache, auch wenn
  der Lauf nur die alten Artikel erneut veröffentlicht hat.
- `lastContentUpdateAt` steigt nur, wenn **mindestens ein Feed Artikel geliefert
  hat** (`feeds.success > 0`). Sonst wird der gespeicherte Wert unverändert
  weitergereicht.

Ein technisch beendeter Lauf, bei dem alle Feeds fehlgeschlagen sind, erscheint
dadurch als frischer Lauf mit frischem Publish, aber als **alter Inhalt**.

Umgekehrt gilt der Schluss **nicht**: `feeds.success > 0` beweist nur, dass eine
Quelle Artikel ausgeliefert hat, nicht dass darunter unbekannte waren. Ein
seit Stunden unveränderter, aber technisch einwandfreier Feed hält die
Inhaltsfrische grün. Wer das erkennen will, braucht eine Novelty-Erkennung –
die ist bewusst kein Bestandteil von O1.

Kann `previous` nicht sicher gelesen werden und hat der Lauf selbst keine
Artikel gesehen, wird `feed_publish_status` **gar nicht** geschrieben. Ein
geratenes `lastContentUpdateAt` wäre schlimmer als ein fehlender Schreibvorgang.

### `feed_health_status` – Status je Feed

Bestehender Schlüssel, abwärtskompatibel erweitert. `status` und `message`
bleiben unverändert; Leser, die nur diese beiden Felder kennen, funktionieren
weiter.

```json
{
  "gamestar": {
    "status": "success",
    "message": "Successfully fetched and parsed 25 articles.",
    "lastAttemptAt": "2026-07-28T11:47:14.900Z",
    "lastSuccessAt": "2026-07-28T11:47:14.900Z",
    "durationMs": 1422,
    "articleCount": 25
  }
}
```

- `lastSuccessAt` bedeutet: letzter Lauf, in dem **dieser Feed Artikel geliefert
  hat**. Ein `warning` (Feed erreichbar, aber leer) schreibt den Wert nicht fort.
- `message` wird wie `fatalError` bereinigt. Ein Transportfehler kann die
  Proxy-Adresse mitführen; der konfigurierte `FEED_PROXY_URL`-Wert und
  URL-Querystrings werden vor dem Speichern entfernt.
- Ein fehlgeschlagener Versuch übernimmt den gespeicherten `lastSuccessAt`
  unverändert. Er kann nur vorwärts laufen.

## Nicht jeder Schlüssel ist gleich wichtig

| Schlüssel | Schreibfehler im Normalablauf |
|---|---|
| `news_cache`, `news_cache_16`, `news_cache_64` | fatal, Exit-Code ≠ 0 |
| `feed_health_status` | **fatal, Exit-Code ≠ 0** |
| `feed_run_status`, `feed_publish_status` | best effort, nur Warnung |

`feed_health_status` gab es schon vor O1, und ein Schreibfehler war dort immer
fatal: es ist der Datensatz, auf dem die Feed-Tabelle im Admin steht. Bliebe er
folgenlos, meldete der Cron-Lauf Erfolg, obwohl das Admin-Panel auf altem Stand
steht – genau die Sorte stiller Ausfall, gegen die O1 antritt. Solange es den
Ergebniszustand `degraded` aus O2b nicht gibt, ist „fatal“ die einzige ehrliche
Antwort.

Die **mit O1 hinzugekommenen** Metadaten sind dagegen best effort. Ihr Verlust
kostet Beobachtbarkeit, aber keine Daten, und darf einen ansonsten gesunden
Kern-Publish nicht zu Fall bringen.

Im Abbruchpfad ist auch der `feed_health_status`-Write best effort: der Lauf ist
dort bereits gescheitert und endet ohnehin mit Exit-Code ≠ 0. Ein zweiter Fehler
beim Festhalten des Abbruchs darf den ursprünglichen Fehler nicht überdecken.

## Wann ein Lauf lieber gar nichts schreibt

Ein Schreibvorgang mit unvollständigen Ersatzwerten ist schlechter als keiner.
`scripts/feed-run-recorder.js` trifft deshalb drei Entscheidungen, bevor
überhaupt gespeichert wird:

| Situation | `feed_health_status` | `feed_publish_status` |
|---|---|---|
| Abbruch **vor** dem Laden der Feed-Liste | bleibt unverändert | bleibt unverändert |
| Feed-Liste geladen, aber **leer** | wird auf `{}` geleert | normal |
| Abbruch **nach** dem Laden der Feed-Liste | wird geschrieben, `lastSuccessAt` bleibt erhalten | bleibt unverändert |
| Bisheriger Feed-Status nicht lesbar | bleibt unverändert | normal |
| Bisheriger Kern-Publish nicht lesbar, Lauf **ohne** Artikel | normal | bleibt unverändert |
| Bisheriger Kern-Publish nicht lesbar, Lauf **mit** Artikeln | normal | wird geschrieben |

Die ersten beiden Zeilen sind bewusst getrennt: ein Abbruch vor der Feed-Liste
sagt **nichts** über die Feeds aus, eine erfolgreich geladene leere Liste dagegen
sehr wohl – nur dort dürfen gelöschte Feeds aus dem Status verschwinden.

Die beiden Reads laufen unabhängig voneinander. Ein kaputter oder unlesbarer
Publish-Datensatz führt nicht dazu, dass auch der Feed-Status als unbekannt gilt,
und umgekehrt.

## Antwort von `/api/get-health-data`

Die Antwort enthält zusätzlich zu `healthStatus` und `sourcesInCache` das Feld
`heartbeat` mit dem serverseitig berechneten Frischebericht:

```json
{
  "healthStatus": { "…": {} },
  "sourcesInCache": ["GameStar"],
  "heartbeat": {
    "now": "2026-07-28T12:00:00.000Z",
    "staleAfterMs": 3000000,
    "isStale": false,
    "run": { "at": "…", "ageMs": 629000, "isFuture": false, "isStale": false, "runId": "…", "result": "success" },
    "corePublish": { "at": "…", "ageMs": 630000, "isFuture": false, "isStale": false, "articleCount": 4213 },
    "content": { "at": "…", "ageMs": 630000, "isFuture": false, "isStale": false, "newestArticleAt": "…" }
  }
}
```

Das Alter wird auf dem Server gegen die Serverzeit gerechnet, nicht im Browser.
Eine falsch gestellte Uhr am Arbeitsplatz verändert die Anzeige damit nicht. Die
Anzeige tickt nicht mit – sie zeigt den Stand des letzten Abrufs; ein Klick auf
„Backend-Status aktualisieren“ holt einen neuen.

## Betrieb

**Kein Heartbeat vorhanden:** Nach dem Rollout fehlen `feed_run_status` und
`feed_publish_status` so lange, bis der erste Cron-Lauf sie schreibt (spätestens
20 Minuten). Bis dahin zeigt der Admin für Lauf, Publish und Inhalt „noch nie“ –
bewusst nicht „aktuell“. Die Feed-Tabelle funktioniert in dieser Zeit unverändert.

**Rückwärtskompatibilität:** Ein Rollback auf den Stand vor O1 ist möglich, ohne
Daten zu löschen. Die alte Fassung ignoriert die beiden neuen Schlüssel und die
zusätzlichen Felder in `feed_health_status`.

**Überlappende Läufe:** Der Workflow verwendet eine `concurrency`-Gruppe ohne
Abbruch, geplante Läufe warten also aufeinander. Ein **lokaler** Lauf parallel zu
einem Actions-Lauf kann die Heartbeat-Schlüssel dagegen sehr wohl in falscher
Reihenfolge schreiben.

Die Auswirkung ist **nicht** garantiert konservativ. Sie geht in beide
Richtungen:

- Ein älterer Lauf, der zuletzt schreibt, kann `lastContentUpdateAt`
  zurücksetzen – die Anzeige meldet dann zu viel Alter.
- Ein Lauf, der seinen Vorzustand vor dem parallelen Lauf gelesen hat, kann
  einen **zu neuen** `lastCorePublishAt` setzen, obwohl der zuletzt tatsächlich
  veröffentlichte Snapshot von einem anderen Lauf stammt. Ebenso setzt jeder
  startende Lauf `feed_run_status` auf `running` und lässt den Heartbeat damit
  frisch aussehen, auch wenn der parallele Lauf scheitert.

Der Heartbeat kann Frische in diesem Fall also auch zu **positiv** darstellen.
Monotone Aktivierung beziehungsweise Lease/CAS gehört zu O3b und D2; bis dahin
sollten lokale Schreibläufe nicht parallel zum Cron gestartet werden.

**Was hier bewusst noch nicht drin ist:**

- Keine Historie über den letzten Lauf hinaus und kein Alarmkanal – das ist O4.
  Der Heartbeat muss heute noch aktiv im Admin abgerufen werden.
- Kein Zeitbudget und kein Ergebniszustand `degraded` – das ist O2b.
- Die drei News-Caches werden weiterhin nacheinander geschrieben. Schlägt ein
  Schreibvorgang dazwischen fehl, wird der Kern-Publish **nicht** fortgeschrieben;
  der Heartbeat meldet dann eher zu viel Alter als zu wenig. Die atomare
  Veröffentlichung folgt mit O3b.
