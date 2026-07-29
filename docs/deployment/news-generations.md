# Generationsgebundener Publish der News-Caches

Stand: 29. Juli 2026 (Roadmap-Pakete O3a, F1 und O3b)

## Ergebnis

Das in O3a vorbereitete Leseprotokoll ist mit O3b aktiv. Preview, Medium und
Full werden nicht mehr nur unter drei veränderlichen Keys gespeichert, sondern
zusätzlich als vollständige **unveränderliche Generation**. Erst ein letzter
Write auf `news_snapshot_pointer` macht sie sichtbar.

Damit kann ein Browser nicht mehr unbemerkt drei verschiedene Cache-Stände
zusammensetzen. F1 ergänzt diesen Inhaltsschutz um zeitliche Request-Ownership:
eine verspätete ältere Anfrage darf State, lokale Kopie und Pin nicht mehr
verändern.

Auslöser war die Beobachtung vom 29. Juli 2026: Das Frontend zeigte dauerhaft
25 deutsche Quellen, während der gleichzeitig gelesene Full-Cache 26 enthielt.
GameStar fehlte nur im Browser; VG247 fehlte auch im Full-Cache und war damit
ein anderes Problem.

## Speichervertrag

| Rolle | Key |
|---|---|
| Aktive Generation | `news_snapshot_pointer` |
| Full-Payload | `news_snapshot:<snapshotId>:full` |
| Preview-Payload | `news_snapshot:<snapshotId>:preview` |
| Medium-Payload | `news_snapshot:<snapshotId>:medium` |
| Vollständiges Manifest | `news_snapshot:<snapshotId>:meta` |
| Publish-Lease | `news_snapshot_publish_lease` |
| Legacy Full/Preview/Medium | `news_cache`, `news_cache_16`, `news_cache_64` |

Eine `snapshotId` hat weiterhin das Format `<epochMs>-<lauf>`. Der Zeitanteil
entspricht dem **Startzeitpunkt des Laufs**, nicht dem Zeitpunkt seines letzten
Writes. So kann ein älter gestarteter Lauf einen später gestarteten nicht als
vermeintlich neuer überholen.

Das Manifest enthält:

- den normalisierten O3a-Zeiger (`schemaVersion`, `snapshotId`, `createdAt`,
  `articleCount`, `runId`);
- `complete: true`;
- die eindeutige Quellenliste;
- für Full, Preview und Medium den exakten Key, die Artikelzahl und die
  serialisierte Bytezahl.

`feed_run_status` bleibt bewusst außerhalb der Generation: Ein laufender oder
gescheiterter Versuch darf einen unveränderlichen, bereits aktiven Inhalt nicht
umschreiben.

## Schreibreihenfolge

`scripts/news-snapshot-publisher.js` führt genau diese Reihenfolge aus:

1. eine atomare Lease per `SET NX PX` erwerben;
2. den aktuellen Pointer unter der Lease lesen und einen gleich alten oder
   neueren Stand ablehnen;
3. Full, Preview und Medium per `SET NX` unter ihren Generations-Keys schreiben;
4. das Manifest als Vollständigkeitsmarke schreiben;
5. die drei Legacy-Keys aus exakt denselben begrenzten Payloads aktualisieren;
6. **zuletzt** den Active-Pointer in einem atomaren Redis-Skript nur dann
   umschalten, wenn der Writer seine Lease noch besitzt;
7. alte Generationen best effort aufräumen;
8. die Lease per atomarem Compare-and-Delete freigeben; scheitert das, läuft
   sie nach ihrem TTL aus.

Ein Fehler in Schritt 3 bis 6 beendet den Lauf fatal. Der bisherige Pointer
bleibt aktiv; ein moderner Leser sieht nie eine Teilgeneration. Bereits
geschriebene, aber nicht aktivierte Keys sind harmlose Orphans und werden erst
nach der Grace Period entfernt. Ein vorhandener Generations-Key wird niemals
überschrieben – auch nicht, wenn dieselbe Lauf-ID erneut angeboten wird.

Die Lease gilt fünf Minuten. Ein zweiter Writer wartet höchstens 30 Sekunden,
begrenzt durch die verbleibende O2b-Kerndeadline. Nach dem Erwerb schützt der
monotone Vergleich zusätzlich davor, dass ein älter gestarteter Lauf einen
neueren aktiven Pointer zurücksetzt. Sollte ein ungewöhnlich langsamer Publish
seine Lease dennoch verlieren, schlägt die atomare Aktivierung fehl, statt den
Pointer danach zurückzudrehen. Tests decken beide Überlappungsrichtungen und
diesen Lease-Verlust ab.

## Bytebudgets und Artikelgrenzen

Vor dem ersten Publish werden **alle drei JSON-Payloads tatsächlich
serialisiert gemessen**.

| Payload | Standard-Maximum |
|---|---:|
| Full | 9 MiB |
| Medium | 2 MiB |
| Preview | 512 KiB |
| Sicherheitsreserve je Payload | 64 KiB |
| einzelner Eingabeartikel | 64 KiB serialisiert |

Optionale Konfiguration:

| Variable | Bedeutung |
|---|---|
| `NEWS_CACHE_FULL_MAX_BYTES` | Maximum des Full-Payloads |
| `NEWS_CACHE_MEDIUM_MAX_BYTES` | Maximum des Medium-Payloads |
| `NEWS_CACHE_PREVIEW_MAX_BYTES` | Maximum des Preview-Payloads |
| `NEWS_CACHE_SAFETY_RESERVE_BYTES` | ungenutzte Reserve unter jedem Maximum |

Fehlerhafte Werte schalten die Grenze nicht ab, sondern fallen auf die Vorgabe
zurück. Eine Reserve, die größer als ein Payload-Budget ist, beendet den
Publish vor jeder Aktivierung.

Zusätzlich gelten feste Feldgrenzen: ID 512, Titel 600, Quelle 160,
Publikationsdatum 64, Zusammenfassung 2.000 sowie Link und Bildadresse je 4.096
Zeichen. Textfelder werden kontrolliert gekürzt; zu lange IDs oder URLs,
unlesbare Daten und ein bereits als Eingabe einzeln über 64 KiB großer Artikel
werden ohne Inhaltsdaten im Log übersprungen.

Danach wird stabil nach Datum absteigend sortiert. Bei gleichem Zeitpunkt bleibt
die Eingabereihenfolge erhalten. Reicht ein Gesamtbudget nicht, fallen
ausschließlich die ältesten Artikel am Ende weg. Preview und Medium bleiben
Teilmengen des begrenzten Full-Payloads.

## Leseregeln

`shared/news-snapshot-store.js` ist die gemeinsame, Edge-kompatible
Speicherschicht.

Ein Leser:

1. liest den Active-Pointer;
2. akzeptiert aus einer Anfrage nur die aktive oder direkt vorherige
   `snapshotId`;
3. verlangt ein gültiges vollständiges Manifest;
4. liest den daraus abgeleiteten unveränderlichen Payload-Key;
5. prüft mindestens, dass die Artikelzahl zum Manifest passt;
6. fällt erst danach auf den passenden Legacy-Key zurück – immer ohne
   Snapshot-Header.

Die vorherige Generation bleibt lesbar, damit ein Browser mit laufender
Preview/Medium/Full-Kette nicht mitten im Wechsel seinen Stand verliert. Eine
unbekannte oder bereits aufgeräumte ID liefert stattdessen den aktiven Stand
mit `Cache-Control: no-store`; fremder Inhalt wird nie unter der angefragten ID
gespeichert.

Der Rumpf der JSON-Endpunkte bleibt ein nacktes `Article[]`. Die Generation
reist weiterhin in diesen Headern:

- `x-gamerfeed-snapshot-id`
- `x-gamerfeed-snapshot-schema`
- `x-gamerfeed-snapshot-created-at`

## Consumer

| Consumer | Gebundene Quelle ab O3b |
|---|---|
| `/api/get-news-preview` | unveränderlicher Preview-Payload |
| `/api/get-news-medium` | unveränderlicher Medium-Payload |
| `/api/get-news` | unveränderlicher Full-Payload |
| `App.tsx` / News-Controller | O3a-Pin plus F1-Request-Epoche |
| `/api/gaming-news` | Full-Payload, Snapshot als Header und Meta-Angabe |
| `/api/get-health-data` | Manifest mit Quellenliste, ohne Full-Payload |
| Merge-Basis des Cron | aktiver Full-Payload, danach Legacy-Fallback |
| lokale Kopie `cachedNews` | Artikel und Generation gemeinsam |

Die Health-API liest für `sourcesInCache` nicht mehr mehrere Megabyte Artikel.
Ihre Quellenliste und `snapshot` stammen aus demselben Manifest. Fehlt es,
bleibt der bestehende Legacy-Fallback erhalten.

## Rollback

### Auf die vorherige Generation

`rollbackToPreviousNewsSnapshot` in
`scripts/news-snapshot-publisher.js` ist der getestete Wartungsbaustein. Er
prüft Manifest und alle drei Payloads der vorherigen Generation, schreibt
zuerst dieselben Werte in die Legacy-Keys und schaltet danach den Pointer um.
Der zuvor aktive Stand wird zur neuen vorherigen Generation; der Rückweg bleibt
erhalten.

Es gibt bewusst keinen automatisch laufenden CLI-Befehl dafür: Er wäre ein
Production-Schreibzugriff und muss als eigener, geprüfter Wartungsschritt
freigegeben werden.

### Auf Legacy

Die nicht geheime Variable
`NEWS_SNAPSHOT_LEGACY_ROLLBACK=true` (alternativ `1`) ist die kontrollierte
Betriebsflagge:

- die drei JSON-Endpunkte lesen Legacy und senden
  `x-gamerfeed-snapshot-rollback: legacy`;
- jede Rollback-Antwort trägt `Cache-Control: no-store`;
- `/gaming-news` liest den Legacy-Full-Cache ohne Snapshot-Angabe;
- die Health-API meldet `snapshot: null`.

Das Signal ist nötig, damit bereits gepinnte Browser ihre Generation bewusst
aufgeben. Eine bloß headerlose alte Edge-Kopie darf das weiterhin nicht.

Die Variable wurde im Rahmen von O3b **nirgends extern gesetzt**. Aktivierung,
Vercel-Redeploy und spätere Entfernung bleiben eine ausdrückliche
Production-Entscheidung.

## Garbage Collection

Aktive und direkt vorherige Generation werden unabhängig von ihrem Alter nie
entfernt. Alle anderen vollständigen oder unvollständigen Generations-Keys
werden erst nach 24 Stunden Grace Period gelöscht.

Das Aufräumen läuft nach der Pointer-Aktivierung und ist best effort. Ein
Fehler dort macht einen bereits erfolgreich veröffentlichten Inhalt nicht
nachträglich fatal; der nächste Lauf versucht es erneut.

## Abnahme und Rollout-Prüfung

Automatisiert geprüft werden:

- Fault-Injection bei Lease, jedem Payload, Manifest, jedem Legacy-Key und
  Pointer;
- aktive Leser sehen nach jedem Fehler nur einen vollständigen Stand;
- echte Überlappung zweier Writer und verspäteter älterer Writer;
- Rollback auf vorherig, Legacy-Fallback und Garbage Collection;
- exakte Bytezahlen, Sicherheitsreserve, extrem großer Einzelartikel,
  Feldgrenzen sowie stabile newest-first-Reihenfolge;
- alle Consumer einschließlich `/gaming-news` und Health-Metadaten.

Nach dem Production-Rollout bleiben manuell:

1. den ersten erfolgreichen geplanten Feed-Lauf abwarten;
2. bei Preview, Medium und Full dieselbe Snapshot-ID in den Headern prüfen;
3. im Admin verifizieren, dass `snapshot` zur Quellenliste gehört;
4. bei einem Rollback die Variable bewusst setzen, den Rollout prüfen und nach
   der Stabilisierung wieder entfernen.

Keine dieser Plattformaktionen gehört zum Codepaket O3b.

## Bewusste Grenzen

- Die Legacy-Keys bleiben während der Migration veränderlich. Nur alte Clients,
  die das Generationsprotokoll noch nicht verstehen, können dort weiterhin
  zeitversetzte Stände sehen.
- Die Lease schützt den kurzen kritischen Publish, nicht den gesamten
  Feed-Abruf. Der monotone Vergleich verwendet den Laufstart und verhindert
  anschließend ein Zurückdrehen.
- Eine History über mehr als aktive und vorherige Generation ist nicht Teil
  von O3b; Betriebsmetriken und Alarmierung folgen in O4.
- Ein sicherer lokaler Dry-Run/`--write`-Ablauf bleibt D2. O3b stellt nur sicher,
  dass ein explizit schreibender überlappender Lauf den Pointer nicht
  zurückdreht.
