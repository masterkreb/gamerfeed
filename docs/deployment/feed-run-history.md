# Begrenzte Laufhistorie

Stand: 31. Juli 2026 (Roadmap-Paket O4b)

Der Cron-Heartbeat aus O1 kennt genau **einen** Lauf: den letzten. Damit ist die
betriebliche Frage „läuft das seit Stunden schief oder war das ein einzelner
Ausrutscher?“ nicht beantwortbar – der nächste Lauf überschreibt den vorigen
Zustand. O4b legt deshalb eine begrenzte Historie **abgeschlossener** Läufe an.

Die Historie ist ausdrücklich reine Beobachtbarkeit. Sie darf den News-Publish,
das Laufergebnis und den Exit-Code unter keinen Umständen gefährden.

## Was die Historie nicht ist

- **Keine Alarmierung.** Niemand wird benachrichtigt; die Historie wird nur im
  Admin sichtbar, wenn jemand hinsieht. Ein Alarmkanal ist O4c.
- **Kein Nachweis, dass ein Workflow gelaufen ist.** Ein Lauf, der gar nicht
  erst gestartet ist, hinterlässt hier keinen Eintrag – die Lücke sieht aus wie
  „nichts passiert“. Genau diese Lücke schließt erst O4c: ein ausgefallener
  Workflow darf nicht sein eigener einziger Monitor sein.
- **Kein Proxy-Fingerprint.** Transportwege, Proxy-Adressen und die Frage, ob
  der deployte PHP-Proxy zum Repository passt, gehören zu O4d.
- **Kein Ersatz für den Laufbericht (O4a).** Der Bericht in der GitHub-Step-
  Summary bleibt der ausführliche Blick auf einen einzelnen Lauf, inklusive
  Transport und HTTP-Status je Quelle. Die Historie ist der kurze Blick über
  mehrere Läufe.

## KV-Schlüssel

| Key | Typ | Inhalt |
|---|---|---|
| `feed_run_history` | Redis Sorted Set | Bis zu 72 abgeschlossene Läufe, Score ist `finishedAt` in Millisekunden |

Die bestehenden Schlüssel `feed_run_status`, `feed_publish_status` und
`feed_health_status` bleiben unverändert. O4b legt genau einen neuen Schlüssel
an und fasst keinen bestehenden an.

### Warum ein Sorted Set und kein Array

Ein Array unter einem gewöhnlichen Schlüssel müsste gelesen, ergänzt und
zurückgeschrieben werden. Zwei gleichzeitig laufende Workflows – ein
verspäteter und ein planmäßiger – würden sich dabei gegenseitig überschreiben,
und ein Lauf verschwände still aus der Historie. Ein Sorted Set kennt `zadd` als
atomare Einzeloperation.

Weil der Score die **Abschlusszeit** ist und nicht die Schreibreihenfolge,
sortiert sich ein verspätet eintreffender Lauf korrekt ein, statt einen neueren
zu verdrängen.

### Größengrenze

```text
FEED_RUN_HISTORY_LIMIT = 72
```

Der Workflow ist auf alle 20 Minuten geplant; 72 Einträge entsprechen damit
**rechnerisch** rund einem Tag. Der tatsächlich abgedeckte Zeitraum kann kürzer
oder länger sein: verspätete Läufe aus der GitHub-Actions-Warteschlange
verschieben ihn, und ein nie gestarteter Lauf hinterlässt gar keinen Eintrag.
Die Zahl begrenzt also die Anzahl der Läufe, nicht die Zeitspanne.

Geschrieben und gekürzt wird in **einer** Transaktion:

```js
const transaction = store.multi();
transaction.zadd('feed_run_history', { score: finishedAtMs, member: entry });
transaction.zremrangebyrank('feed_run_history', 0, -73);
await transaction.exec();
```

`zremrangebyrank` entfernt die niedrigsten Ränge, also die ältesten
Abschlusszeiten. Übrig bleiben genau die 72 neuesten Einträge. Ohne das Kürzen
in derselben Transaktion entstünde zwischen „geschrieben“ und „gekürzt“ ein
Zustand mit unbegrenzter Größe.

## Datensatz pro Lauf

```json
{
  "schemaVersion": 1,
  "runId": "gha-4711-1",
  "startedAt": "2026-07-28T11:58:00.000Z",
  "finishedAt": "2026-07-28T12:00:00.000Z",
  "result": "degraded",
  "degradedReason": "Trendphase zurückgestellt",
  "fatalError": null,
  "feeds": { "total": 15, "success": 14, "warning": 1, "error": 0, "unknown": 0 },
  "durations": {
    "totalMs": 120000,
    "feedFetchMs": 40000,
    "imageScrapeMs": null,
    "imageBackfillMs": null,
    "publishMs": 900,
    "trendsMs": null
  }
}
```

### Schema-Version

`schemaVersion` wird **beim Lesen strikt geprüft**: nur genau
`FEED_RUN_HISTORY_SCHEMA_VERSION` wird angenommen. Eine fehlende, ältere oder
zukünftige Version ist ein einzelner ungültiger Eintrag und wird übersprungen –
sie wird nicht als aktuelle umgedeutet.

Das ist der eigentliche Zweck der Angabe. Ohne diese Prüfung würde ein Eintrag
aus einem anderen Schema stillschweigend als aktueller gelesen: fehlende Felder
erschienen als `0`, `null` oder „unbekannt“, ohne dass irgendwo sichtbar wäre,
dass hier ein fremdes Format geraten wurde.

Beim **Schreiben** wird die Version dagegen nicht geprüft, sondern vergeben:
`buildRunHistoryEntry()` übersetzt einen aktuellen Laufstatus – der die Version
des Heartbeat-Schemas trägt – in das aktuelle History-Schema.

Ein späteres Schema wird deshalb als bewusster Schnitt eingeführt: die alten
Einträge verschwinden aus der Anzeige, statt falsch gelesen zu werden, und die
Historie füllt sich innerhalb eines Tages wieder.

Genau **ein** Grundfeld je Ergebnis: ein `degraded` trägt `degradedReason`, ein
`fatal` trägt `fatalError`, ein `success` trägt keines von beiden. Ein
gespeicherter Widerspruch – „abgeschlossen“ neben „zurückgestellt: …“ – wäre im
Admin nicht handhabbar und wird schon beim Bauen des Eintrags aufgelöst.

### Was ausdrücklich nicht gespeichert wird

- keine O4a-Transportdetails (Proxy oder direkt, beobachteter HTTP-Status),
- keine Feed-Adressen und keine Proxy-Adresse,
- keine Artikeltexte, Titel oder Links,
- keine Einzelmeldungen je Feed – nur die fünf Zähler.

Gründe werden über dieselben Regeln bereinigt wie der Heartbeat
(`shared/feed-health-model.js`): erst die aufruferseitige Redaktion mit den
konfigurierten Secret-Werten, dann das Entfernen von URI-Zugangsdaten
(`scheme://user:pass@host`) und Querystrings (`scheme://host/pfad?token=…`),
zuletzt die Begrenzung auf **300 Zeichen**.

## Ergebniszustände

Gespeichert werden ausschließlich `success`, `degraded` und `fatal`.

`running` gehört nicht in die Historie: ein laufender Versuch ist nicht
abgeschlossen, hat kein `finishedAt` und wäre im Zeitverlauf nicht
einsortierbar. Der veränderliche `feed_run_status` bleibt die einzige Quelle für
„läuft gerade“.

## Wann geschrieben wird

Genau einmal je abgeschlossenem Lauf, in `scripts/feed-run-recorder.js`:

- nach `finish()` – für `success` und `degraded`,
- nach `recordFatal()` – für `fatal`,

und in beiden Fällen **erst nachdem** der finale `feed_run_status` geschrieben
wurde. Vor dem Kern-Publish wird nie in die Historie geschrieben; `begin()` und
`recordCorePublish()` fassen sie nicht an.

### Bekannte Grenzen

Zwei Abbrüche können konstruktionsbedingt **keinen** Historieneintrag
hinterlassen:

- **Ein harter Abbruch** des Prozesses (Runner-Timeout, `SIGKILL`, Absturz der
  Node-Laufzeit). Der Code, der den Eintrag schreiben würde, läuft nicht mehr.
- **Ein Abbruch in der Vorprüfung** ohne verfügbare KV-Konfiguration. Fehlen
  `KV_REST_API_URL` oder `KV_REST_API_TOKEN`, endet der Lauf vor dem ersten
  Speicherzugriff – es gibt dann gar keinen Speicher, in den geschrieben werden
  könnte.

In beiden Fällen bleibt der letzte Eintrag der des vorherigen Laufs. Eine Lücke
in der Historie ist deshalb **kein Beweis**, dass nichts passiert ist.

### Best effort heißt auch: begrenzt

Ein Fehler beim Schreiben der Historie wird ausschließlich bereinigt
protokolliert:

```text
   ⚠️  Laufhistorie konnte nicht ergänzt werden: …
```

Er wirft nicht, verändert `success`, `degraded` oder `fatal` nicht und
verändert den Exit-Code nicht. Ein Lauf, dessen News-Publish erfolgreich war,
bleibt erfolgreich – auch wenn der Sorted Set gerade nicht erreichbar ist.

Ein Speicher, der gar **nicht antwortet**, ist dabei etwas anderes als einer,
der einen Fehler meldet. Jeder Historienzugriff läuft deshalb gegen eine feste
Frist:

```text
FEED_RUN_HISTORY_TIMEOUT_MS = 3000   // 3 Sekunden
```

Drei Sekunden sind reichlich für eine einzelne KV-Transaktion und kurz genug,
um weder den Laufabschluss noch eine Admin-Anfrage spürbar zu verzögern. Ohne
diese Frist bliebe `finish()` unbegrenzt hängen, obwohl `feed_run_status`
bereits geschrieben und der Lauf fachlich fertig ist. Ein Zeitablauf wird
behandelt wie jeder andere Historienfehler.

Zwei Feinheiten sind Teil des geprüften Verhaltens:

- Der Zeitgeber wird auf **jedem** Abschlussweg abgeräumt, auch im Erfolgsfall –
  sonst hielte ein offener Timer den Node-Prozess des Cron-Laufs unnötig am
  Leben.
- Eine **verspätete Ablehnung** des überholten Zugriffs bekommt einen eigenen
  Handler. Ohne ihn beendete eine Ablehnung, die erst nach dem Zeitablauf
  eintrifft, den Prozess als unbehandelte Ablehnung – ausgerechnet ausgelöst
  von der Historie, die niemals ein Ergebnis verändern darf.

Die Zeitsteuerung ist an beiden Aufrufstellen injizierbar (`historyTimeoutMs`,
`setTimer`, `clearTimer`); kein Test wartet real.

## Health-API

Es entsteht **kein neuer öffentlicher Endpunkt**. Die bereits geschützte
Antwort von `/api/get-health-data` wird additiv erweitert:

```ts
runHistory: FeedRunHistoryEntry[] | null
```

- `[]` heißt: erfolgreich gelesen, aber noch keine Einträge vorhanden.
- `null` heißt: die Historie konnte nicht gelesen werden.

Der Unterschied ist die eigentliche Aussage. Ein geratenes `[]` im Fehlerfall
würde eine leere Historie behaupten, die niemand belegt hat.

Ein Lesefehler der Historie verwandelt die übrigen Health-Daten **nicht** in
einen 500er: der Feed-Status, die Quellenliste, der Heartbeat und der
Snapshot-Zeiger werden weiterhin mit Status 200 ausgeliefert. Authentifizierung
und `private, no-store` bleiben unverändert.

Der Read läuft gegen dieselbe Frist von 3 Sekunden. Ein hängender Speicher hält
die Antwort also nicht offen, obwohl alle übrigen Daten längst vorliegen; ein
Zeitablauf ergibt `runHistory: null` und niemals `[]`. Weder die Antwort noch
das Protokoll nennen dabei den Speicher oder den Schlüsselnamen.

Beschädigte Einzelelemente werden isoliert verworfen; ein unlesbarer Eintrag
nimmt die restliche Historie nicht mit.

## Anzeige im Admin

`components/admin/FeedRunHistoryPanel.tsx` steht im Health Center direkt unter
dem Heartbeat und unterscheidet drei Zustände:

| Zustand | Anzeige |
|---|---|
| `null` | „Die Laufhistorie ist derzeit nicht lesbar.“ |
| `[]` | „Es wurde noch kein abgeschlossener Lauf festgehalten.“ |
| Einträge | Zusammenfassung und Tabelle, neuester Lauf zuerst |

Die Tabelle zeigt je Lauf Abschlusszeit, Ergebnis, Gesamtdauer, Feed-Zähler und
den bereinigten Grund. Das Ergebnis wird immer durch **Text und Symbol**
getragen, nie allein durch Farbe. Datum und Uhrzeit folgen der aktuell
gewählten App-Sprache, nicht der Browsersprache; DE und EN sind vollständig
lokalisiert.

Die Zusammenfassung zählt ausdrücklich die **sichtbaren** Einträge – sie ist
eine Aussage über die vorliegende Historie, nicht über alle je gelaufenen
Versuche.

## Beteiligte Dateien

| Datei | Aufgabe |
|---|---|
| `shared/feed-run-history.js` | Schlüssel, Schema, Grenze, Builder und Normalizer |
| `shared/feed-run-history-store.js` | Sorted-Set-Adapter: atomarer begrenzter Write, absteigendes Lesen |
| `scripts/feed-run-recorder.js` | Integration nach `finish()` und `recordFatal()` |
| `server/health-data-handler.ts` | Additives `runHistory` in der geschützten Antwort |
| `components/admin/FeedRunHistoryPanel.tsx` | Darstellung im Health Center |

Beide `shared/`-Module kommen ohne `node:`-Importe und ohne Netzwerkzugriff
aus; dieselbe Logik läuft im Cron-Skript (Node), in der Health-API (Edge) und
im Admin-Panel (Browser).

## Tests

| Datei | Prüft |
|---|---|
| `tests/server/unit/feed-run-history.test.js` | Builder und Normalizer, Ergebniszustände, strikte Schema-Version, Bereinigung, Frist |
| `tests/server/unit/feed-run-history-store.test.js` | Transaktion, Kürzen, Reihenfolge, Lese- und Schreibfehler |
| `tests/feeds/unit/feed-run-recorder.test.js` | Wann geschrieben wird, und dass Historienfehler und Fristablauf folgenlos bleiben |
| `tests/server/unit/health-data-handler.test.js` | `runHistory` in der Antwort, `[]` gegen `null`, Status 200 bei Fehler und Fristablauf |
| `tests/frontend/unit/feed-run-history-panel.test.js` | Datenfall, Leerfall, Nicht-verfügbar-Fall, DE/EN, Symbol statt nur Farbe |

Kein Test berührt einen echten KV-Speicher, eine echte Datenbank, das Netz oder
eine echte Wartezeit: die Uhren sind fest, die Speicher sind vollständige
Attrappen. Ein hängender Speicher wird über ein nie aufgelöstes Promise und
Zeitgeber nachgestellt, die nur auf Zuruf feuern.
