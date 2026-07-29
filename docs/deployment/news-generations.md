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

## Was O3a liefert – und was nicht

O3a definiert das Leseprotokoll vollständig, verdrahtet es in allen Consumern
und testet es. **Aktiviert ist es in Produktion noch nicht.**

Der Grund steht im nächsten Abschnitt und ist nicht verhandelbar: eine
Snapshot-ID darf nur Inhalt kennzeichnen, der nachweisbar zu genau dieser
Generation gehört. Solange die drei News-Keys **veränderlich** sind, kann das
niemand belegen. Die unveränderlichen Generationen dafür bringt **O3b**.

Bis dahin gilt: der Cron schreibt keinen Zeiger, alle Endpunkte antworten als
Legacy, und das Verhalten ist exakt das von vor O3a.

## Warum eine Lesereihenfolge nicht reicht

Die naheliegende Idee – „erst den Zeiger lesen, dann die Artikel" – trägt
nicht. Der Cron überschreibt die Keys an Ort und Stelle, und ein Leser kann
mitten hinein geraten:

- **Zeiger zuerst** → die Antwort trägt eine *alte* Kennung auf *neuem* Inhalt.
- **Artikel zuerst** → sie trägt eine *neue* Kennung auf *altem* Inhalt.

Beides ist eine Falschaussage. Eine frühere Fassung dieses Dokuments nannte den
ersten Fall „harmlos, weil er sich selbst heilt". **Das war falsch:**

- Der Leser pinnt die alte Kennung, hält aber neuen Inhalt. Nichts an einer
  späteren Antwort deckt den Widerspruch auf, wenn inzwischen alle Stufen auf
  dem neuen Stand sind.
- Schlimmer: Die Antwort auf `?snapshot=<alt>` wurde unter genau dieser Kennung
  am Edge zwischengespeichert. Damit lägen unter **einer** Kennung
  **verschiedene** Inhalte – und die Grundannahme des Protokolls wäre verletzt.

Auch ein doppeltes Lesen des Zeigers (davor und danach, auf Gleichheit prüfen)
löst das nicht: während des gesamten Publish-Fensters steht der Zeiger noch auf
der alten Generation, während die Keys bereits kippen.

**Es gibt keine Leseseitenlösung.** Die Bindung muss aus der Speicherung
kommen – und das ist O3b.

## Der Vertrag

| Baustein | Wert |
|---|---|
| Zeiger-Key in KV | `news_snapshot_pointer` |
| `schemaVersion` | `1` |
| `snapshotId` | `<epochMs>-<lauf>`, Format erzwungen |
| Header | `x-gamerfeed-snapshot-id`, `-schema`, `-created-at` |
| Rollback-Signal | `x-gamerfeed-snapshot-rollback: legacy` |
| Query-Parameter | `?snapshot=<id>` |

Die Rechenregeln stehen an genau einer Stelle: `shared/news-snapshot.js`. Sie
kommt ohne `node:`-Importe aus und gilt deshalb im Cron (Node), in den
Endpunkten (Edge) und im Browser gleichermaßen.

### Strenge Prüfung beim Lesen

`normalizeSnapshotPointer` weist einen Zeiger vollständig ab, sobald etwas
nicht stimmt:

- unbekannte `schemaVersion`;
- `snapshotId` außerhalb von `^\d{1,15}-[A-Za-z0-9_-]{1,64}$`;
- fehlender oder unlesbarer `createdAt`;
- Zeitanteil der Kennung und `createdAt` widersprechen sich.

Die letzten beiden Punkte sind nicht kosmetisch. Der Vergleich zweier
Generationen stützt sich auf beide Werte; ein beschädigter Eintrag wie `"zzz"`
hätte im lexikografischen Vergleich jede echte Kennung geschlagen und dauerhaft
blockiert. **Lieber gar keine Generation als eine falsche.**

### Warum Header und kein Umschlag

Bestehende Clients lesen `response.json()` als `Article[]`. Ein Umschlag
(`{ snapshotId, articles }`) hätte sie mitten in der Migration gebrochen. Header
ignorieren sie stillschweigend – genau das braucht eine Dual-Read-Migration.

**Der Rumpf bleibt ein nacktes Array.** Ein Regressionstest hält das fest.

## Schreibseite: entwerten statt beschriften

Der Cron **schreibt keinen Zeiger**. Stattdessen entfernt er einen vorhandenen,
**bevor** er die veränderlichen Keys anfasst (`invalidateSnapshotPointer`).
Zwischen Entwertung und Publish gibt es damit keinen Moment, in dem eine alte
Kennung neuen Inhalt beschriften könnte.

Scheitert die Entwertung, läuft der Publish trotzdem weiter – die Artikel sind
wichtiger als das Etikett –, der Fall wird aber laut protokolliert, und der
nächste Lauf versucht es erneut. Ein gescheiterter Lauf fasst weder Keys noch
Zeiger an.

## Die drei Leseregeln

Sobald eine Generation existiert (also ab O3b), merkt sich der Leser die
Generation der ersten brauchbaren Antwort und vergleicht jede weitere damit:

| Fall | Verhalten |
|---|---|
| gleiche Generation | übernehmen |
| **neuere** Generation | übernehmen **und** umpinnen |
| **ältere** Generation | verwerfen |

Die zweite Regel ist der Kern des GameStar-Falls: der Rumpf *ist* bereits der
neue Stand. Ohne sie bliebe ein Browser dauerhaft auf einem alten Stand.

Die dritte Regel verhindert die Gegenrichtung: eine verspätete oder aus einem
älteren Edge-Cache stammende Kopie kann den sichtbaren Stand nicht zurückdrehen.

### Rollback braucht ein ausdrückliches Signal

Eine Antwort **ohne** Generationsangabe kann zweierlei bedeuten:

- eine alte Kopie aus einem Edge-Cache – die darf einen neueren Stand **nicht**
  zurückdrehen;
- einen bewussten Rückfall auf Legacy – der muss genau das dürfen.

Der Leser kann das nicht raten. Ohne Unterscheidung wäre der dokumentierte
Rollback für einen bereits gepinnten Client wirkungslos: er verwürfe jede
headerlose Antwort, und nach einem Reload pinnte die lokale Kopie dieselbe
Generation erneut – bis zum Ablauf der 30-Minuten-Kopie bliebe er auf dem alten
Stand.

Deshalb sagt der Server es ausdrücklich: `x-gamerfeed-snapshot-rollback: legacy`.
Nur wer dieses Signal sieht, gibt seine gepinnte Generation auf – und zwar
vollständig, inklusive der Generation in der lokalen Kopie, damit auch ein
Reload sauber beginnt. Eine Rollback-Antwort nennt **keine** Generation; sie
gibt eine auf.

Gesteuert wird das über `legacyRollback` an `createNewsCacheHandler` – eine
bewusste Betriebsentscheidung, kein Automatismus.

**Eine Rollback-Antwort wird nie zwischengespeichert.** Unabhängig vom
Query-Parameter trägt sie `Cache-Control: no-store`. Läge sie am Edge, käme das
Signal noch Minuten später bei Clients an, obwohl der Rollback längst beendet
und wieder eine gültige Generation aktiv ist – diese Clients gäben dann grundlos
ihre Generation auf. Ein Rollback ist eine kurzlebige Betriebsanweisung, keine
cachebare Eigenschaft des Inhalts.

**Grenze im Auto-Update-Pfad:** Der Poll verändert die gepinnte Generation nie –
auch nicht, um sie freizugeben. Er **räumt** aber auf: eine bereits vorgemerkte
Generation ist mit dem Rollback zurückgezogen, also werden Warteschlange, Badge
und Tab-Titel geleert. Bliebe die Warteschlange stehen, spielte ein späterer
Klick genau die Generation ein, die der Server gerade widerrufen hat.

Die eigentliche Übernahme des Rollbacks bleibt der Ladekette vorbehalten – also
Reload oder manueller Refresh –, genau dort, wo sich der sichtbare Stand ohnehin
ändert. Das ist die konservative Richtung: ein Poll-Ergebnis soll nie still den
Schutz aufheben, den der Pin bietet.

Beide Entscheidungen liegen als `planPollResponse` und `planPendingAdoption` in
`shared/news-snapshot.js`; `App.tsx` ruft genau sie auf.

### Pinnen nur, was sichtbar ist

Der Auto-Update-Pfad pollt im Hintergrund und zeigt nichts an. Er **pinnt
deshalb nicht**. Artikel und ihre Generation wandern gemeinsam in die
Warteschlange; gepinnt und lokal gespeichert wird erst, wenn der Benutzer die
Aktualisierung annimmt.

Ohne diese Trennung konnten vorgemerkte Artikel aus Generation B später unter
einer inzwischen gepinnten Generation C gespeichert werden. `persistCachedArticles`
verlangt seinen Snapshot deshalb als **ausdrücklichen Parameter** – die
gefährliche Variante lässt sich gar nicht mehr versehentlich hinschreiben.

Zusätzlich wird die Warteschlange **beim Klick erneut geprüft**
(`planPendingAdoption`): zwischen dem Vormerken und der Übernahme können
Minuten liegen. Ist der sichtbare Stand inzwischen weiter, wird die
Warteschlange verworfen statt eingespielt – State und lokale Kopie bleiben
unangetastet. Dieselbe Funktion nutzt `App.tsx`; die Regeln stehen also nur an
einer Stelle.

## Cache-Verhalten

| Anfrage | `Cache-Control` | Warum |
|---|---|---|
| ohne `?snapshot` | `s-maxage=60, stale-while-revalidate=300` | unverändert, für bestehende Clients |
| `?snapshot=` passend | `s-maxage=60, stale-while-revalidate=300` | **wie sonst auch** |
| `?snapshot=` abweichend | `no-store` | sonst läge die Antwort einer anderen Generation unter der angefragten Kennung |
| **Rollback-Antwort** (mit oder ohne `?snapshot`) | `no-store` | ein Rollback ist eine kurzlebige Betriebsanweisung, keine Eigenschaft des Inhalts |

Eine frühere Fassung gab passenden Anfragen eine längere Frist mit der
Begründung, der Inhalt unter einer Kennung sei unveränderlich. **Das gilt
nicht**, solange die News-Keys überschrieben werden. Eine längere Frist wäre
eine Zusage, die niemand einhält – deshalb bekommt eine gepinnte Anfrage exakt
dieselbe Cache-Dauer wie jede andere. Erst mit den unveränderlichen
Generationen aus O3b lässt sich das anders begründen.

Bei Abweichung wird trotzdem **geliefert**, nicht verweigert. Der Rumpf ist ein
gültiger Stand, und die Header sagen, welcher – der Leser entscheidet dann
selbst. Ein 409 ließe ihn ohne Daten zurück.

## Legacy, Fallback und Rollback

`null` heißt im Protokoll überall **„Legacy"** und nie „Fehler".

| Situation | Verhalten |
|---|---|
| kein Zeiger (der heutige Normalfall) | alle Antworten ohne Header, Verhalten wie vor O3a |
| Snapshot-Quelle unlesbar | Ausfall wird protokolliert, News kommen trotzdem |
| Zeiger fehlerhaft, unbekannt versioniert oder in sich widersprüchlich | gilt als Legacy |
| Antwort ohne Header bei bereits gepinnter Generation | verworfen (Legacy gilt als älter) |
| Antwort ohne Header, nichts gepinnt | übernommen |
| Antwort **mit** Rollback-Signal | übernommen, gepinnte Generation wird gelöscht |

**Rollback auf Legacy:** Zeiger löschen – exakt das, was der Cron ohnehin bei
jedem Publish tut – **und** `legacyRollback` an den Endpunkten setzen. Ohne das
Signal käme der Rollback bei bereits gepinnten Clients nicht an. Beide Schritte
gehören zusammen.

**Rollback auf eine ältere Generation:** erst ab O3b sinnvoll, weil es dafür
mehrere vorgehaltene Generationen braucht. Das Leseprotokoll ist darauf
vorbereitet: ein Client auf der neueren Generation verwirft die ältere Antwort
und behält seinen konsistenten Stand, ein Reload beginnt sauber auf der
zurückgesetzten Generation. Contract-Tests decken beide Fälle ab.

## Migrationsreihenfolge

1. **Leser zuerst** (dieses Paket): alle Consumer verstehen das Protokoll und
   fallen ohne Zeiger auf Legacy zurück. Der Cron entwertet bei jedem Publish.
   Dieser Zustand ist deploybar und verhält sich wie vor O3a.
2. **Unveränderliche Generationen** (O3b): erst dann kann ein Zeiger belegen,
   wozu ein Inhalt gehört. O3b aktiviert die Snapshot-Quelle der Endpunkte
   (`readSnapshot`) und schreibt den Zeiger.
3. **Legacy-Keys bleiben** bis zur nachgewiesenen Umstellung aller Consumer.

## Consumer

| Consumer | Rolle heute | ab O3b |
|---|---|---|
| `/api/get-news-preview`, `-medium`, `/api/get-news` | Legacy; `readSnapshot` unverdrahtet | melden die Generation, akzeptieren `?snapshot=` |
| `services/news-load-controller.ts` und `App.tsx` | Request-Ownership aktiv; Generationsregeln mangels Header inaktiv | beide Schutzschichten voll wirksam |
| `/api/gaming-news` | reiner Legacy-Consumer | Generation als Meta-Angabe und Header |
| `/api/get-health-data` | meldet `null`; `readSnapshot` unverdrahtet | meldet die Generation von `sourcesInCache` |
| Merge-Basis des Cron | liest `news_cache` | unverändert, bis O3b umstellt |
| lokale Kopie (`cachedNews`) | speichert ihre Generation mit | voll wirksam |

Die Health-API liest den gespeicherten Zeiger **gar nicht**. Sie meldet nur,
was eine ausdrücklich injizierte, belegbar gebundene Quelle liefert – und die
gibt es bis O3b nicht, also `snapshot: null`.

Eine frühere Fassung prüfte stattdessen, ob derselbe Zeiger vor und nach dem
Artikelabruf steht *und* seine `articleCount` zur gelesenen Artikelzahl passt.
**Das reicht nicht:** zwei Generationen können dieselbe Artikelzahl haben, und
dann stünde im Admin eine falsche Zuordnung – genau der Fehler, gegen den das
Protokoll antritt. Eine Heuristik ist hier schlimmer als gar keine Angabe.

Ein Fehler beim Lesen der Quelle beendet die Health-API nicht: der Zeiger ist
Diagnosebeiwerk, sein Ausfall wird protokolliert und gilt als Legacy.

Die lokale 32-Artikel-Kopie ist **30 Minuten** gültig, der Edge-Cache nur 60
Sekunden. Sie kann damit *neuer* sein als die Antwort, die zurückkommt – deshalb
bringt sie ihre Generation mit und pinnt sie, bevor der erste Request läuft. Ein
vor der Umstellung gespeicherter Eintrag hat das Feld nicht und gilt als Legacy.

Die Auswertung im Admin – „nicht im aktiven Snapshot" gegen „das Frontend sieht
einen anderen Snapshot" – ist **A1b**. O3a stellt nur die Angabe bereit.

## Bewusst nicht enthalten

- **O3b:** unveränderliche Generationen, atomarer Publish, Byte-Budget, Garbage
  Collection, Lease/CAS gegen konkurrierende Writer – **und damit die
  Aktivierung dieses Protokolls**.
- **A1b:** Admin-Auswertung der Snapshot-Angabe.
- Keine Änderung an Legacy-Keys, Workflow-Zeitplan, Secrets, Vercel, Cyon oder
  am PHP-Proxy.

F1 ist inzwischen umgesetzt: `services/news-load-controller.ts` entwertet
ältere Requests per Abort und Epoche. Diese zeitliche Request-Ownership ergänzt
die hier beschriebenen Inhaltsgenerationen; Einzelheiten stehen in
`docs/development/progressive-news-loading.md`.

## Verbleibende Grenzen

- **Das Protokoll ist inert.** Ohne Zeiger verhält sich alles wie vor O3a; die
  Mischung aus verschiedenen Generationen ist damit **noch nicht verhindert**.
  Der Schutz greift erst mit O3b.
- **Die Health-API meldet bis O3b nie eine Generation.** Das ist bewusst so:
  ohne belegbare Bindung wäre jede Angabe geraten.
- **Eine gescheiterte Entwertung** hinterlässt einen Zeiger neben neuem Inhalt.
  Die Endpunkte würden ihn heute nicht verwenden (`readSnapshot` ist
  unverdrahtet), der nächste Lauf räumt ihn weg – aber der Fall gehört
  beobachtet.
