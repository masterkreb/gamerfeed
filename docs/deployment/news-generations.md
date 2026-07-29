# Generationsgebundenes Leseprotokoll der News-Caches

Stand: 29. Juli 2026 (Roadmap-Paket O3a)

## Das Problem

`news_cache`, `news_cache_16` und `news_cache_64` werden vom Cron **nacheinander**
geschrieben und danach unabhängig voneinander am Edge gecacht. Die progressive
Ladekette holt sie ebenfalls nacheinander. Ein Browser kann Preview, Medium und
Full damit aus drei verschiedenen Ständen zusammensetzen – und nichts im
Protokoll bemerkt es.

**Beobachtung vom 29. Juli 2026:** Das Frontend zeigte auch nach einem Hard
Refresh dauerhaft 25 deutsche und 13 englische Quellen. Im zeitgleich direkt
abgerufenen Full-Cache standen 26 deutsche und 13 englische. GameStar war im
Full-Cache vorhanden, im Browser nicht. VG247 fehlte in beiden – das ist ein
Feed-Thema und **kein** Protokollfehler.

## Der Vertrag

| Baustein | Wert |
|---|---|
| Zeiger-Key in KV | `news_snapshot_pointer` |
| `schemaVersion` | `1` |
| `snapshotId` | `<epochMs>-<runId>`, sortierbar |
| Header | `x-gamerfeed-snapshot-id`, `-schema`, `-created-at` |
| Query-Parameter | `?snapshot=<id>` |

Die Rechenregeln stehen an genau einer Stelle: `shared/news-snapshot.js`. Sie
kommt ohne `node:`-Importe aus und gilt deshalb im Cron (Node), in den
Endpunkten (Edge) und im Browser gleichermaßen.

### Warum Header und kein Umschlag

Bestehende Clients lesen `response.json()` als `Article[]`. Ein Umschlag
(`{ snapshotId, articles }`) hätte sie mitten in der Migration gebrochen. Header
ignorieren sie stillschweigend – genau das braucht eine Dual-Read-Migration.

**Der Rumpf bleibt ein nacktes Array.** Ein Regressionstest hält das fest.

## Schreibreihenfolge

Der Cron schreibt den Zeiger **zuletzt**, nach allen drei News-Caches. Damit
zeigt er nie auf Daten, die noch gar nicht vollständig geschrieben sind.

Ein Schreibfehler am Zeiger ist **nicht fatal**: die Caches stehen bereits, und
ein Leser ohne Zeiger fällt auf Legacy zurück. Den Kern-Publish deshalb
scheitern zu lassen wäre der schlechtere Tausch. Ein gescheiterter Lauf fasst
den bisherigen Zeiger nicht an.

## Lesereihenfolge

Jeder Endpunkt liest den Zeiger **vor** den Artikeln. Das ist keine Kosmetik:

- Zeiger zuerst, Daten danach → schreibt der Cron dazwischen, ist das Etikett
  höchstens **älter** als die Daten. Der Leser sieht in der nächsten Stufe die
  neuere Kennung und übernimmt sie – die Verwechslung heilt sich selbst.
- Daten zuerst, Zeiger danach → alter Inhalt trüge eine **neue** Kennung. Das
  könnte niemand mehr bemerken.

Ein wirklich atomarer Publish samt unveränderlicher Generationen bleibt **O3b**.
Bis dahin ist diese Reihenfolge die Absicherung.

## Die drei Leseregeln

Der Leser merkt sich die Generation der ersten brauchbaren Antwort und
vergleicht jede weitere damit:

| Fall | Verhalten |
|---|---|
| gleiche Generation | übernehmen |
| **neuere** Generation | übernehmen **und** umpinnen |
| **ältere** Generation | verwerfen |

Die zweite Regel ist der Kern des GameStar-Falls: der Rumpf *ist* bereits der
neue Stand, ein erneuter Abruf wäre nur eine zusätzliche Runde. Ohne sie bliebe
ein Browser dauerhaft auf einem alten Stand.

Die dritte Regel verhindert die Gegenrichtung: eine verspätete oder aus einem
älteren Edge-Cache stammende Kopie kann den sichtbaren Stand nicht zurückdrehen.

## Cache-Verhalten

| Anfrage | `Cache-Control` | Warum |
|---|---|---|
| ohne `?snapshot` | `s-maxage=60, stale-while-revalidate=300` | unverändert, für bestehende Clients |
| `?snapshot=` passend | `s-maxage=300, stale-while-revalidate=600` | der Inhalt zu einer Kennung ist unveränderlich |
| `?snapshot=` abweichend | `no-store` | sonst läge die Antwort einer anderen Generation dauerhaft unter der angefragten Kennung |

Der Query-Parameter macht den Edge-Cache **generationsspezifisch**: verschiedene
Generationen liegen unter verschiedenen Cache-Keys.

Bei Abweichung wird trotzdem **geliefert**, nicht verweigert. Der Rumpf ist ein
gültiger Stand, und die Header sagen, welcher – der Leser entscheidet dann
selbst. Ein 409 ließe ihn ohne Daten zurück.

## Legacy, Fallback und Rollback

`null` heißt im Protokoll überall **„Legacy"** und nie „Fehler".

| Situation | Verhalten |
|---|---|
| kein Zeiger in KV | alle Antworten ohne Header, Verhalten wie vor O3a |
| Zeiger unlesbar (KV-Fehler) | Ausfall wird protokolliert, News kommen trotzdem |
| Zeiger fehlerhaft oder unbekannte `schemaVersion` | gilt als Legacy |
| Antwort ohne Header bei bereits gepinnter Generation | verworfen (Legacy gilt als älter) |
| Antwort ohne Header, nichts gepinnt | übernommen |

**Rollback auf Legacy:** Zeiger löschen. Alle Endpunkte antworten sofort wieder
wie vor O3a; laufende Clients arbeiten weiter, neue pinnen nichts.

**Rollback auf eine ältere Generation:** Zeiger auf die ältere Kennung setzen.
Ein Client, der bereits auf der neueren steht, verwirft die ältere Antwort und
behält seinen konsistenten Stand – er dreht sich nicht mitten im Betrieb
zurück. Ein Reload beginnt sauber auf der zurückgesetzten Generation.

Das setzt voraus, dass die zugehörigen Cache-Inhalte noch vorhanden sind. Das
Vorhalten mehrerer Generationen ist **O3b** – heute existiert genau eine.

## Migrationsreihenfolge

1. **Leser zuerst** (dieses Paket): alle Consumer verstehen das Protokoll und
   fallen ohne Zeiger auf Legacy zurück. Deploybar, solange noch kein Cron-Lauf
   einen Zeiger geschrieben hat.
2. **Publisher danach**: der erste Cron-Lauf schreibt den Zeiger. Ab dann pinnen
   neue Clients; alte ignorieren die Header weiter.
3. **Legacy-Keys bleiben.** `news_cache`, `news_cache_16` und `news_cache_64`
   werden unverändert geschrieben und gelesen. Ihre Ablösung durch
   generationsgebundene Keys ist **O3b**.

Beide Schritte liegen im selben Commit, weil Leser und Publisher hier dasselbe
Repository sind. Die Reihenfolge bleibt trotzdem gültig: ein Deploy ohne
Cron-Lauf ist der Zustand aus Schritt 1.

## Consumer

| Consumer | Rolle |
|---|---|
| `/api/get-news-preview`, `-medium`, `/api/get-news` | melden die Generation, akzeptieren `?snapshot=` |
| `App.tsx` (progressive Ladekette, Refresh, Auto-Update) | pinnt und entscheidet nach den drei Regeln |
| `/api/gaming-news` | meldet die Generation als Meta-Angabe und Header |
| `/api/get-health-data` | meldet, auf welcher Generation `sourcesInCache` beruht |
| Merge-Basis des Cron | liest weiterhin `news_cache`; es gibt genau eine Generation |

Die Auswertung im Admin – „nicht im aktiven Snapshot" gegen „das Frontend sieht
einen anderen Snapshot" – ist **A1b**. O3a stellt nur die Angabe bereit.

## Bewusst nicht enthalten

- **O3b:** atomarer Publish, unveränderliche Generationen, Byte-Budget,
  Garbage Collection, Lease/CAS gegen konkurrierende Writer.
- **F1:** „latest request wins", Abort-Strategie und die Neustrukturierung des
  News-Lifecycles. O3a prüft nur die Generation einer Antwort; die Reihenfolge
  der Requests bleibt unverändert.
- **A1b:** Admin-Auswertung der Snapshot-Angabe.
- Keine Änderung an Legacy-Keys, Workflow-Zeitplan, Secrets, Vercel, Cyon oder
  am PHP-Proxy.

## Verbleibendes Risiko

Zwischen dem Lesen des Zeigers und dem Lesen der Artikel kann der Cron
schreiben. Die Lesereihenfolge macht daraus den **harmlosen** Fall (Etikett zu
alt statt zu neu), beseitigt ihn aber nicht. Ein Leser holt dann eine Stufe mehr
als nötig. Vollständig ausgeräumt wird das erst mit den unveränderlichen
Generationen aus O3b.
