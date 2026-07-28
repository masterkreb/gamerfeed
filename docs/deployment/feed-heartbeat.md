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
| Ist der Inhalt neu? | `feed_publish_status.lastContentUpdateAt` | „Inhaltsfrische“ |

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

Die Schwelle ist fest im Code dokumentiert, nicht über eine Umgebungsvariable
konfigurierbar. Sie ist damit Teil des geprüften Verhaltens; ein Testlauf kann
sie über den Parameter `staleAfterMs` überschreiben.

Damit die Läufe nicht schon durch die Warteschlange in die Schwelle laufen,
startet der Workflow seit O1 zu den Minuten `7,27,47` statt zur stark belasteten
Minute `0`.

## KV-Schlüssel

### `feed_run_status` – veränderlicher Versuch

Wird **zweimal je Lauf** geschrieben: beim Start mit `result: "running"` und am
Ende mit dem Ergebnis. Ein hart abgebrochener Lauf (Actions-Timeout) hinterlässt
deshalb einen Datensatz ohne `finishedAt`; gemessen wird dann `startedAt`.

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
- Bricht ein Lauf ab, **bevor** die Feed-Liste gelesen wurde, bleibt der
  gespeicherte Status vollständig erhalten, statt durch ein leeres Objekt ersetzt
  zu werden.
- Feeds, die in der Datenbank gelöscht wurden, verschwinden beim nächsten
  vollständigen Lauf aus dem Status.

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
    "run": { "at": "…", "ageMs": 629000, "isStale": false, "runId": "…", "result": "success", "…": null },
    "corePublish": { "at": "…", "ageMs": 630000, "isStale": false, "articleCount": 4213 },
    "content": { "at": "…", "ageMs": 630000, "isStale": false, "newestArticleAt": "…" }
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
Reihenfolge schreiben. Die Auswirkung ist konservativ – der ältere Lauf trägt
einen älteren `lastContentUpdateAt` ein und die Anzeige meldet eher zu viel
Alter – aber sie ist real. Monotone Aktivierung beziehungsweise Lease/CAS gehört
zu O3b und D2.

**Was hier bewusst noch nicht drin ist:**

- Keine Historie über den letzten Lauf hinaus und kein Alarmkanal – das ist O4.
  Der Heartbeat muss heute noch aktiv im Admin abgerufen werden.
- Kein Zeitbudget und kein Ergebniszustand `degraded` – das ist O2b.
- Die drei News-Caches werden weiterhin nacheinander geschrieben. Schlägt ein
  Schreibvorgang dazwischen fehl, wird der Kern-Publish **nicht** fortgeschrieben;
  der Heartbeat meldet dann eher zu viel Alter als zu wenig. Die atomare
  Veröffentlichung folgt mit O3b.
