# Play3-Startseite pruefen

Isolierte Diagnose fuer die Frage, ob ein GitHub-Actions-Runner Bildadressen
von Play3s Startseite den aktuellen RSS-Artikeln zuordnen kann. Die Diagnose
ist **kein neuer Bildfallback** und repariert keine gespeicherten Artikel.
Diagnose und [produktiver Startseiten-Fallback](feed-images.md#play3-ein-startseiten-batch)
teilen sich die Zuordnungslogik in `scripts/source-image-resolvers.js`. Der
Diagnoselauf selbst bleibt weiterhin rein lesend und unabhängig vom Feed-Cron.

## Start

1. Die neuen Diagnose-Dateien auf einem Branch committen und pushen.
2. Einen neuen Pull Request, gerne als Entwurf, oeffnen. Der Workflow
   `Play3-Startseite pruefen` startet einmal beim Oeffnen, falls der PR die
   Workflow- oder Skriptdatei aendert. Ein Merge ist dafuer nicht notwendig.
3. Im zugehoerigen Actions-Lauf die Summary oder den Schritt
   `Startseite einmalig pruefen` ansehen.

Es gibt keinen automatischen Lauf bei weiteren Commits, einem erneuten
Oeffnen desselben PRs oder einem normalen Feed-Lauf. Ein bewusst gewollter
weiterer Test ist ueber `Re-run jobs` moeglich. Sobald der Workflow auf dem
Default-Branch liegt, ist auch `Run workflow` verfuegbar. Nicht nur fuer den
Test mergen und keine produktiven Secrets hinzufuegen.

Lokal laesst sich dieselbe Diagnose mit `node scripts/check-play3-homepage.js`
starten. Ein lokales Ergebnis beweist **nicht** die Erreichbarkeit aus GitHub
Actions oder von Cyon.

## Grenzen

- Hoechstens zwei GET-Anfragen: zuerst `https://www.play3.de/`, danach bei
  erkannter Artikelliste `https://www.play3.de/feed/`.
- Bestehende Outbound-Policy und dieselben Header wie beim Feed-Abruf;
  pro Anfrage 15 Sekunden und 2 MiB. Keine Wiederholungen oder Redirects.
- Keine Artikel-, Bild-, API-, Proxy-, Datenbank- oder Cache-Abrufe.
- Keine Secrets, keine Aenderung am Feed-Cron, keine produktiven Schreibrechte.
- Nur Rasterbild-URLs auf `www.play3.de/wp-content/uploads/` innerhalb des
  zugehoerigen Artikellinks werden gezaehlt. Lazy-Loading und `noscript`
  werden beruecksichtigt, Logos, SVG-Platzhalter und benachbarte Karten nicht.
- Bericht nur mit Zaehlern, Statuscodes und Laufzeiten, ohne fremde Inhalte,
  Artikeladressen, Antwort-Header oder rohe Fehlermeldungen.

## Ergebnis

`images_found` (Exit-Code 0) bedeutet: mindestens ein RSS-Artikel besitzt auf
der Startseite eine zugeordnete Bildadresse. Es beweist weder, dass die
Bilddatei selbst abrufbar ist, noch eine vollstaendige Abdeckung, dauerhafte
Erreichbarkeit oder eine Freigabe zur Weiterverwendung.

Andere Ergebnisse liefern Exit-Code 1 nur in diesem separaten Diagnosejob:

- `homepage_unavailable` / `feed_unavailable`: Abruf gescheitert; HTTP-Status
  und begrenzter Fehlergrund stehen im Bericht, soweit beobachtet.
- `homepage_not_recognized` / `feed_not_recognized`: Antwort angekommen,
  aber erwartete Artikellinks beziehungsweise RSS-Struktur nicht erkannt.
- `no_matches`: RSS lesbar, aber keine passende Bildadresse gefunden.

`nicht gemessen` ist kein Nullwert. Ein gescheiterter Startseiten-Abruf
verhindert den zweiten Request; dann ist der RSS-Feed `nicht angefragt`.
Ein roter Diagnoselauf veraendert weder den Feed-Cache noch dessen Health-Status.
