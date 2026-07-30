# SEO, Indexierung und messbare Auffindbarkeit

Stand: 30. Juli 2026

Dieses Dokument hält die gemessene Ausgangslage und die Leitplanken für
SEO-Arbeit an GamerFeed fest. Es ist keine Zusage, viele Seiten zu erzeugen
oder die React-Anwendung umzuschreiben. Die Arbeit läuft als kleiner,
messbarer Versuch: erst crawlbare Einstiege herstellen, dann die Wirkung in
der Google Search Console beobachten und erst danach über weitere Inhalte
entscheiden.

## Gemessene Ausgangslage

Die Search Console wurde am 30. Juli 2026 mit der bestehenden
URL-Präfix-Property `https://gamerfeed.vercel.app/` geprüft.

| Signal | Stand |
|---|---|
| Indexierte Seiten | 0 |
| Nicht indexierte Seiten | 2 |
| Startseite | am 25. Juni 2026 erfolgreich gecrawlt, danach „Gecrawlt – zurzeit nicht indexiert“ |
| `/gaming-news` | gefunden, aber nicht gecrawlt beziehungsweise nicht indexiert |
| Sitemap | `/sitemap.xml` erfolgreich gelesen, 2 URLs erkannt |
| Letzte 28 Tage | 0 Klicks, 0 Impressionen |
| Letzte 3 Monate | 0 Klicks, 57 Impressionen, ausschließlich für die Startseite |
| Links-Bericht | 0 erkannte externe und 0 erkannte interne Links |
| Manuelle Maßnahmen | keine |
| Sicherheitsprobleme | keine |

Beide URLs bestanden am 30. Juli 2026 den Live-Test der Search Console:
Abruf und Indexierung sind technisch erlaubt. Der Startseiten-Test meldete
keine JavaScript-Konsolenfehler. Fünf von vierzig nicht geladenen Ressourcen
waren fremde Artikelbilder; sie erklären die fehlende Indexierung nicht.

Die Zahlen sind ein zeitgebundener Ausgangspunkt, kein dauerhaftes Urteil.
Search-Console-Berichte laufen verzögert ein und Google entscheidet unabhängig,
ob eine technisch indexierbare URL tatsächlich in den Index aufgenommen wird.

## Was daraus folgt

Die React-SPA wird nicht pauschal ersetzt:

- Google kann die heutige Anwendung im Live-Test rendern.
- Die Startseite liefert im ursprünglichen HTML trotzdem nur einen leeren
  React-Container. Ein zusätzlicher Render-Schritt bleibt unnötig fragil und
  andere Crawler müssen JavaScript nicht ausführen.
- `/gaming-news` liefert bereits fertiges HTML und bleibt die
  servergerenderte SEO-Einstiegsseite.
- Speicherung und Darstellung sind getrennte Fragen. Ein Wechsel von KV zu
  einer Artikeldatenbank macht die Startseite nicht automatisch crawlbar oder
  schneller sichtbar.

Das Ziel ist deshalb eine hybride Architektur: React bleibt für die
interaktive App zuständig, während wichtige Einstiegsseiten bereits im ersten
HTML sinnvolle, crawlbare Inhalte und normale interne Links liefern.

## Leitplanken

- Kein kompletter Rewrite und keine Framework-Migration nur für SEO.
- Kein versteckter, außerhalb des Viewports platzierter oder mit
  `aria-hidden` markierter Artikelblock für Crawler.
- Ein HTML-Fallback der Startseite muss ohne JavaScript sichtbar, inhaltlich
  wahr und der interaktiven Seite semantisch gleichwertig sein. React darf ihn
  beim Start durch die App ersetzen.
- Keine statische exakte Quellenzahl in Meta-, Open-Graph-, Twitter- oder
  strukturierten Daten. Die Zahl ändert sich; statische Texte sprechen von
  zahlreichen deutschen und internationalen Quellen.
- Keine `SearchAction`, solange `?search=` nicht tatsächlich als
  adressierbare Suche funktioniert.
- Normale interne `<a href>`-Links verbinden Startseite und `/gaming-news` in
  beide Richtungen. Eine Sitemap ersetzt diese Verlinkung nicht.
- Eigenständiger Text erklärt Nutzen, Auswahl und Aktualisierung von
  GamerFeed. Titel oder Zusammenfassungen fremder Anbieter werden nicht als
  eigene redaktionelle Inhalte ausgegeben.
- Keine massenhaft erzeugten Quellen-, Themen- oder Datumsseiten ohne
  Messdaten und eigenständigen Nutzen.
- Search-Console-Zugangsdaten, OAuth-Tokens, Kontoadressen und vollständige
  Exporte gehören nie ins Repository.

## Gestufter Versuch

### Phase 1 – Crawlbare Einstiege

Arbeitspaket SEO1 setzt nur die technische und inhaltliche Grundlage:

1. ehrliche, zeitstabile Metadaten auf der Startseite;
2. Entfernung der nicht funktionierenden `SearchAction`;
3. ein sichtbarer, nicht versteckter HTML-Fallback im React-Container mit
   Überschrift, kurzer eigener Beschreibung und Link zu `/gaming-news`;
4. ein lokalisierter sichtbarer Link aus der laufenden App zu
   `/gaming-news`;
5. ein stärkerer eigener Einleitungstext auf `/gaming-news`, ohne fremde
   Artikeltexte zu kopieren;
6. Regressionstests für das ursprüngliche HTML, die React-Ansicht und die
   servergerenderte News-Seite.

Sitemap-Umbau, neue URL-Typen, Datenbankmigration, Search-Console-API und
automatisierte Indexierungsanträge gehören nicht zu SEO1.

### Phase 2 – Indexierungs-Gate

Nach Production-Deployment von SEO1 werden beide URLs manuell live geprüft und
einmal zur Indexierung eingereicht. Danach werden nach 7, 14 und 28 Tagen
mindestens diese Werte festgehalten:

- Indexierungszustand je URL;
- Klicks und Impressionen;
- Suchanfragen ohne reine `site:`-Operatoren;
- erkannte interne und externe Links;
- neue Crawl- oder Darstellungsfehler.

Das Gate gilt als positives Signal, sobald mindestens eine URL indexiert ist
und/oder echte thematische Impressionen erhält. Es ist keine Garantie für eine
bestimmte Position oder Besucherzahl.

Bleiben nach 28 Tagen beide URLs trotz erfolgreichem Live-Test ausgeschlossen,
werden keine weiteren SEO-Seitentypen erzeugt. Dann werden zuerst Inhalt,
Domain, kanonische Signale und Googles aktueller Ausschlussgrund erneut
bewertet.

### Phase 3 – Ein Content-Pilot

Nur nach positivem Gate wird genau **ein** zusätzlicher, dauerhaft pflegbarer
Seitentyp gewählt. Die Auswahl folgt echten Suchanfragen oder einem klaren
Nutzerproblem. Denkbar sind eine eigenständige kuratierte Zusammenfassung oder
eine hilfreiche Plattformübersicht; automatisch vervielfältigte dünne
Quellenseiten sind kein Ziel.

Vor einer breiteren URL-Struktur wird entschieden, ob GamerFeed dauerhaft auf
der Vercel-Subdomain oder auf einer eigenen Domain betrieben wird. Ein späterer
Domainwechsel ist möglich, erzeugt aber zusätzliche Redirect-, Canonical- und
Search-Console-Arbeit.

### Phase 4 – Reichweite außerhalb der Technik

Indexierbares HTML allein erzeugt noch keine Nachfrage. Nach dem technischen
Pilot werden getrennt bewertet:

- eigene Domain und Markenauftritt;
- nachvollziehbare Verweise von passenden eigenen oder fremden Websites;
- freiwillige Verteilung über passende Community- und Social-Kanäle;
- datenschutzgerechte Erfolgsmessung neben dem zustimmungsabhängigen
  Google-Analytics-Signal.

Diese Phase ist eine Produkt- und Vertriebsentscheidung, kein automatischer
Codeauftrag.
