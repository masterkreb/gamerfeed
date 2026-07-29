# Progressive News-Ladekette

Stand: 29. Juli 2026 (Roadmap-Paket F1)

## Das Problem

Die Startseite lädt News in drei Stufen: Preview, Medium und Full. Vor F1 war
Medium/Full eine freilaufende Promise-Kette in `App.tsx`. Daraus entstanden drei
unabhängige Fehler:

- ein manueller Refresh konnte eine alte Stufenkette nicht entwerten; ihre
  verspätete Antwort überschrieb anschließend den neueren Stand;
- ein Fehler der Medium-Stufe verhinderte den Full-Request vollständig;
- nach einem Unmount konnte noch laufende Arbeit weiterhin State oder
  `localStorage` verändern.

Das generationsgebundene Protokoll aus O3a löst davon nur einen Teil: Es erkennt
eine *ältere Inhaltsgeneration*, nicht aber zwei zeitlich überlappende Requests
derselben beziehungsweise einer Legacy-Generation. Beide Schutzschichten werden
deshalb benötigt.

## Ein Besitzer für die Ladekette

`services/news-load-controller.ts` besitzt Preview, Medium, Full und manuellen
Refresh. `App.tsx` verdrahtet nur noch State, lokale Kopie und Snapshot-Pin.

Jede autoritative Ladung erhält:

- eine monoton steigende interne Epoche;
- einen eigenen `AbortController`;
- die Information, ob bereits verwendbare Artikel sichtbar sind;
- genau einen Besitzer für Lade- und Fehlerzustände.

Eine neue Ladung erhöht zuerst die Epoche und bricht den bisherigen Controller
ab. **Nach jeder asynchronen Grenze** – Netzwerkantwort und JSON-Body – prüft
die alte Arbeit zusätzlich ihre Epoche. Der zweite Schutz ist notwendig, weil
Testattrappen, ein bereits aufgelöster Body oder einzelne Fetch-Implementierungen
ein Abort-Signal zu spät beachten können.

Nur die aktuelle Epoche darf:

- `articles` verändern;
- eine Generation pinnen oder freigeben;
- `cachedNews` in `localStorage` schreiben;
- Ladeindikatoren beenden;
- einen Fehlerzustand setzen.

## Stufen und Fallback

| Situation | Verhalten |
|---|---|
| Preview erfolgreich | sofort anzeigen, danach Medium versuchen |
| Medium erfolgreich | anzeigen, danach Full versuchen |
| Medium fehlgeschlagen | protokollieren, Full trotzdem versuchen |
| Full nach sichtbarer Preview fehlgeschlagen | sichtbare Artikel behalten, nicht blockierend melden |
| Preview fehlgeschlagen | genau ein direkter Full-Fallback |
| Preview und Full-Fallback fehlgeschlagen, keine Daten sichtbar | blockierender Erstladefehler |
| Manueller Refresh mit sichtbaren Daten fehlgeschlagen | Artikel behalten, Hinweis oberhalb der Liste |

Medium und Full bleiben sequenziell. Das begrenzt parallele große Antworten und
erhält den sichtbaren progressiven Aufbau; Full hängt aber nicht mehr am
Erfolgszweig von Medium.

## Auto-Update ist passiv

Der Fünf-Minuten-Poll zeigt Artikel nicht unmittelbar an und darf deshalb eine
sichtbare Ladung nicht verdrängen. `beginPassiveRequest()` startet ihn nur,
wenn keine autoritative Ladung aktiv ist und kein anderer Poll läuft.

Beginnt danach ein manueller Refresh oder wird die Komponente ausgehängt, wird
der Poll abgebrochen und entwertet. Auch das Übernehmen vorgemerkter Artikel
bricht einen laufenden Poll ab: dessen React-Closure enthält noch den vorherigen
Artikelstand und könnte sonst dieselben Artikel erneut vormerken.

Die O3a-Regeln bleiben zusätzlich bestehen:

- der Poll pinnt nicht;
- Artikel und Generation bleiben gemeinsam in der Warteschlange;
- Rollback leert Warteschlange und Badge;
- die Warteschlange wird beim Klick erneut gegen den sichtbaren Pin geprüft.

## Fehlerzustände

`App.tsx` hält zwei getrennte Zustände:

- `error`: blockierend, nur wenn keine verwendbaren Daten vorhanden sind;
- `backgroundError`: nicht blockierend, bereits sichtbare Artikel bleiben
  erhalten.

Ein abgebrochener oder durch eine neuere Epoche entwerteter Request erzeugt
keinen Benutzerfehler. Der Beginn eines neuen Ladevorgangs räumt beide früheren
Fehlerzustände auf.

## Tests

`tests/frontend/unit/news-load-controller.test.js` steuert jede Netzwerkantwort
über Deferred Promises. Die Tests decken verspätete Medium-/Full-Antworten,
Refresh, Unmount, Abort, Snapshot-Ablehnung, Preview-Fallback sowie blockierende
und nicht blockierende Fehler ab. Kein Test wartet auf ein echtes Zeitintervall.

`tests/e2e/news-loading.spec.ts` prüft im Production-Build mit Chromium:

- Preview → Medium → Full als sichtbare Reihenfolge;
- manuellen Refresh gegen eine verspätete Full-Stufe;
- Full trotz Medium-Fehler;
- sichtbare Artikel und Hinweis nach einem fehlgeschlagenen Refresh.

Alle API-Antworten werden gestellt; externe Anfragen bleiben durch das
gemeinsame E2E-Sicherheitsnetz blockiert.

## Bewusste Grenzen

- F1 ändert weder API-Cachezeiten noch den Fünf-Minuten-Poll.
- F1 aktiviert das O3a-Protokoll nicht. Unveränderliche Generationen und der
  atomare Publish bleiben O3b.
- Es gibt keinen pauschalen Retry. Nur der bereits fachlich vorhandene
  Preview→Full-Fallback wird einmal ausgeführt.
