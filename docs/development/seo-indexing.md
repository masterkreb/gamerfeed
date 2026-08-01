# SEO, Indexierung und messbare Auffindbarkeit

Stand: 1. August 2026

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

### Historischer Leistungsbefund vom 1. August 2026

Der maximal verfügbare Leistungszeitraum (16 Monate) enthält tatsächlich Daten
vom 17. Dezember 2025 bis 29. Juli 2026. Er bestätigt, dass eine frühere
Indexierung allein keinen relevanten Besucherstrom erzeugt hat:

| Signal | Stand |
|---|---|
| Klicks | 1 |
| Impressionen | 114 |
| Durchschnittliche CTR | 0,9 % |
| Durchschnittliche Position | 15,9 |
| Seiten mit Impressionen | ausschließlich die Startseite |
| Suchanfrage `pixelcritics` | 13 Impressionen, 1 Klick, durchschnittliche Position 76,2 |
| Übrige sichtbare Suchanfragen | überwiegend spezielle `site:vercel.app`-Operatorabfragen ohne Gaming-Absicht |
| Erkannte Links | 0 externe und 0 interne Links |

Die durchschnittliche Gesamtposition ist deshalb kein belastbares
Gaming-Ranking: sie wird überwiegend von ungewöhnlichen Operatorabfragen
getragen. Es gibt in diesem Zeitraum keine sichtbaren Impressionen für normale
Gaming-News-Suchabsichten. Das Hauptproblem lag damit schon während der
früheren Indexierung bei Relevanz, eigenständigem Nutzen und Bekanntheit, nicht
bei der Klickrate eines häufig gezeigten Ergebnisses.

## Was daraus folgt

Die React-SPA wird nicht pauschal ersetzt:

- Google kann die heutige Anwendung im Live-Test rendern.
- Der in SEO1 ergänzte sichtbare Text-Fallback löste zwar den leeren
  React-Container, blitzte auf langsameren Mobilgeräten aber als scheinbar
  vorgeschaltete Seite auf. Die UX-Korrektur vom 1. August entfernt ihn wieder.
  Die Startseite ist damit bewusst auf JavaScript-Rendering angewiesen.
- `/gaming-news` liefert bereits fertiges HTML und bleibt die
  servergerenderte SEO-Einstiegsseite. Sie steht in der Sitemap, ist aus der
  laufenden App unter „Über uns“ normal verlinkt und verweist ihrerseits zurück.
- Speicherung und Darstellung sind getrennte Fragen. Ein Wechsel von KV zu
  einer Artikeldatenbank macht die Startseite nicht automatisch crawlbar oder
  schneller sichtbar.

Für dieses bestehende Projekt bleibt die bewusste Trennung: React ist für die
interaktive Startseite zuständig, `/gaming-news` für den ohne JavaScript
nutzbaren News-Einstieg. Eine spätere neue Architektur darf beides von Anfang
an servergerendert zusammenführen; sie wird nicht in dieses Projekt
hineingezwungen.

## Leitplanken

- Kein kompletter Rewrite und keine Framework-Migration nur für SEO.
- Kein versteckter, außerhalb des Viewports platzierter oder mit
  `aria-hidden` markierter Artikelblock für Crawler.
- Kein sichtbarer SEO-Zwischeninhalt, der Besuchern vor der eigentlichen App
  kurz als zweite Seite erscheint. Es wird auch kein versteckter Ersatztext
  eingeführt.
- Keine statische exakte Quellenzahl in Meta-, Open-Graph-, Twitter- oder
  strukturierten Daten. Die Zahl ändert sich; statische Texte sprechen von
  zahlreichen deutschen und internationalen Quellen.
- Kein Vollständigkeitsversprechen. GamerFeed deckt genau die konfigurierten
  Feeds ab, nie „alle Quellen“ – das gilt für Metadaten und für sichtbare
  Produkttexte gleichermaßen.
- Keine garantierte Aktualisierungsfrequenz. Der Cron-Workflow ist zu
  Minute 7, 27 und 47 **geplant**, GitHub stellt geplante Läufe aber global in
  eine Warteschlange. Texte nennen den Takt deshalb als Plan mit möglichen
  Verzögerungen, nie als „Echtzeit“.
- Keine `SearchAction`, solange `?search=` nicht tatsächlich als
  adressierbare Suche funktioniert.
- `/gaming-news` bleibt in der Sitemap, verlinkt normal zur App zurück und ist
  in der App unter „Über uns“ als gewöhnlicher `<a href>` erreichbar.
- Eigenständiger Text erklärt Nutzen, Auswahl und Aktualisierung von
  GamerFeed. Titel oder Zusammenfassungen fremder Anbieter werden nicht als
  eigene redaktionelle Inhalte ausgegeben.
- Keine massenhaft erzeugten Quellen-, Themen- oder Datumsseiten ohne
  Messdaten und eigenständigen Nutzen.
- Search-Console-Zugangsdaten, OAuth-Tokens, Kontoadressen und vollständige
  Exporte gehören nie ins Repository.

## Gestufter Versuch

### Phase 1 – Crawlbare Einstiege

**Umgesetzt am 30. Juli 2026.** Arbeitspaket SEO1 setzt nur die technische und
inhaltliche Grundlage:

1. ehrliche, zeitstabile Metadaten auf der Startseite;
2. Entfernung der nicht funktionierenden `SearchAction`;
3. zunächst ein sichtbarer, nicht versteckter HTML-Fallback im
   React-Container; dieser Punkt wurde mit der UX-Korrektur vom 1. August
   bewusst wieder zurückgenommen;
4. ein lokalisierter sichtbarer Link aus der laufenden App zu
   `/gaming-news`;
5. ein stärkerer eigener Einleitungstext auf `/gaming-news`, ohne fremde
   Artikeltexte zu kopieren;
6. Regressionstests für das ursprüngliche HTML, die React-Ansicht und die
   servergerenderte News-Seite.

Sitemap-Umbau, neue URL-Typen, Datenbankmigration, Search-Console-API und
automatisierte Indexierungsanträge gehören nicht zu SEO1.

#### UX-Korrektur vom 1. August 2026

Der Fallback wurde vollständig aus `index.html` entfernt. `#root` ist vor dem
Modulstart leer; es gibt weder `data-seo="fallback"` noch zugehöriges CSS oder
einen versteckten Ersatz. Dadurch erscheint auf langsamen Geräten keine
Erklärungsseite mehr, bevor React übernimmt.

Das ist eine bewusste Abwägung: Die ursprüngliche Startseitenantwort enthält
weiterhin Titel, Description, Canonical, Robots, Open Graph, Twitter und
JSON-LD, aber keinen sichtbaren Body-Inhalt. Google kann die App laut Live-Test
rendern; einfache Crawler erhalten den servergerenderten News-Einstieg über
`/gaming-news` und die Sitemap. Diese Entscheidung wird nicht als
SEO-Verbesserung ausgegeben, sondern als UX-Korrektur des bestehenden Projekts.

Der hinter Infinite Scroll praktisch unerreichbare Footer wurde ebenfalls
entfernt. Sein normaler, lokalisierter `/gaming-news`-Link liegt nun im Reiter
„Über uns“. Infinite Scroll selbst bleibt unverändert.

#### Wo die Regeln getestet werden

| Datei | Prüft |
|---|---|
| `tests/frontend/unit/seo-static-entry.test.js` | Quell-`index.html`: leerer React-Container, kein alter Fallback, SEO-Kernangaben im Head, keine feste Quellenzahl, keine `SearchAction` |
| `tests/frontend/unit/settings-gaming-news-link.test.js` | gerenderter Link unter „Über uns“, in DE und EN unterschiedlich |
| `tests/frontend/unit/honest-product-claims.test.js` | sichtbare „Über uns“-Texte in DE und EN: keine feste Quellenzahl, keine Vollständigkeit, kein „Echtzeit“ |
| `tests/server/unit/gaming-news-page.test.js` | `/gaming-news`: eine H1, eigener Einleitungstext, Canonical, Rückweg zur App |
| `tests/e2e/seo-entry.spec.ts` | ohne JavaScript keine vorgeschaltete Textseite; nach React-Start genau eine sichtbare H1, erreichbarer About-Link und kein Footer |

#### Das Vorschaubild zählt mit

`public/social-preview.png` wird über `og:image` und `twitter:image` öffentlich
ausgeliefert und ist damit selbst ein SEO-Text. Es trug sichtbar
„Gaming-News aus allen Quellen“ und widersprach nach der Textkorrektur den
Titeln und Alt-Texten. Der Untertitel lautet jetzt
**„Gaming-News aus vielen Redaktionen“**.

Geändert wurde nur der Untertitel: Der alte Text wurde als Maske erkannt, der
Hintergrund darunter harmonisch interpoliert und der neue Text an derselben
linken Kante (x = 392, bündig mit der Wortmarke) und Grundlinie (y = 403)
gesetzt. Hintergrundgrafik, Logo und Wortmarke sind unverändert. Die
Abmessungen bleiben bei 1200 × 630; `seo-static-entry.test.js` prüft Format,
Abmessungen und die `og:image`/`twitter:image`-Verweise.

Wer das Bild erneut ändert: Ein Text im Bild lässt sich nicht automatisch
prüfen. Die Tests sichern nur Format und Abmessungen – der Satz selbst bleibt
eine Sichtprüfung.

#### Bewusst offen geblieben

Die Meta-Description von `/gaming-news` entsteht weiterhin aus den ersten drei
Artikeltiteln. Das ist eine Auflistung, kein eigener redaktioneller Fließtext.
Zusätzlich nennt die Seite den bis zu 60 Tage gehaltenen Gesamtbestand als
„aktuelle Artikel“. Der Langzeitbefund reicht aus, diese Aussagen im kleinen
Paket SEO2a zu bereinigen; dafür muss nicht auf ein Google-Snippet gewartet
werden.

`?search=` bleibt keine adressierbare Suche. Eine `SearchAction` darf erst
wieder entstehen, wenn dieser Parameter tatsächlich als URL-Suche funktioniert.

### Phase 2 – Indexierungs-Gate

**In Arbeit seit 30. Juli 2026.** SEO1 ist gemergt und produktiv. Diese Phase
besteht aus manuellen Schritten in der Search Console – kein Code, keine API,
kein automatischer Antrag.

Nach Production-Deployment von SEO1 werden beide URLs manuell live geprüft und
einmal zur Indexierung eingereicht. Danach werden nach 7, 14 und 28 Tagen
mindestens diese Werte festgehalten:

- Indexierungszustand je URL;
- Klicks und Impressionen;
- Suchanfragen ohne reine `site:`-Operatoren;
- erkannte interne und externe Links;
- neue Crawl- oder Darstellungsfehler.

#### Aktueller Abnahmestand

| Schritt | Status | Befund beziehungsweise nächste Aktion |
|---|---|---|
| Live-Test Startseite | erledigt | am 1. August erneut technisch abrufbar und indexierbar |
| Live-Test `/gaming-news` | erledigt | am 1. August erneut technisch abrufbar und indexierbar |
| Indexierungsantrag Startseite | offen | auch am 1. August wegen überschrittenem Tageskontingent ausdrücklich abgelehnt; es liegt keine Annahmebestätigung vor |
| Indexierungsantrag `/gaming-news` | offen | nach der Ablehnung der Startseite bewusst nicht nochmals gegen dasselbe Property-Kontingent versucht |
| Sitemap-Befund abgleichen | erledigt | Der Sitemap-Bericht zeigt `/sitemap.xml` als erfolgreich, zuletzt am 28. Juli gelesen, mit zwei erkannten Seiten. Ein zeitweise abweichender Hinweis der URL-Prüfung ist kein Beleg für einen Defekt der öffentlich mit HTTP 200 ausgelieferten Sitemap |
| Messpunkte nach 7, 14 und 28 Tagen | wartend | Fristen erst ab dem Tag zählen, an dem die Indexierungsanträge tatsächlich angenommen wurden |

Die Eingabe `https://gamerfeed.vercel.app` ohne abschließenden Slash wird von
der Search Console auf `https://gamerfeed.vercel.app/` normalisiert. Sie ist
keine dritte URL und umgeht weder Kontingent noch Indexierungszustand.

Ein lokaler Google-OAuth-Zugang würde diesen Schritt nicht beschleunigen: Die
URL-Prüfungs-API kann den bekannten Indexzustand auslesen, aber keinen normalen
Indexierungsantrag stellen. Die Google Indexing API ist für diese gewöhnlichen
GamerFeed-Seiten nicht vorgesehen. Ein OAuth-Zugang bleibt höchstens eine
spätere Option für automatisierte, nur lesende Messberichte.

Eine Erinnerung ist nur eine Bedienhilfe und nicht die maßgebliche
Aufgabenverwaltung. Falls zum Erinnerungszeitpunkt niemand online ist, bleiben
alle offenen Schritte in dieser Tabelle bestehen.

Beim nächsten Versuch wird die URL direkt geöffnet und **ohne vorherigen
Live-Test** „Indexierung beantragen“ gewählt. Der Antrag führt seine eigene
Prüfung aus. Um nicht unnötig weitere begrenzte URL-Prüfungen anzustoßen, wird
vorher kein separater Live-Test mehr ausgeführt. Der zweite Antrag folgt nur
nach bestätigter Annahme des ersten. Google veröffentlicht weder eine feste
Kontingentgröße noch eine garantierte Uhrzeit für dessen Rücksetzung.

Das Gate gilt als positives Signal, sobald mindestens eine URL indexiert ist
und/oder echte thematische Impressionen erhält. Es ist keine Garantie für eine
bestimmte Position oder Besucherzahl.

Bleiben nach 28 Tagen beide URLs trotz erfolgreichem Live-Test ausgeschlossen,
geht auch der vorbereitete SEO3-Pilot nicht in die Implementierung. Dann werden
zuerst Inhalt, Domain, kanonische Signale und Googles aktueller Ausschlussgrund
erneut bewertet.

### Phase 3 – Ein Content-Pilot

Der historische Leistungsbefund erlaubt die **Vorbereitung** eines einzelnen
Piloten schon während des Indexierungs-Gates: Die frühere Indexierung brachte
über Monate keine normalen Gaming-News-Suchanfragen. Vorbereitung bedeutet
noch keinen Production-Rollout und keine Vervielfältigung.

Die konkrete Hypothese ist eine einzige servergerenderte Seite
„Gaming-News-Quellen im Überblick“. Sie beantwortet die Frage, welche deutschen
und internationalen Redaktionen GamerFeed bündelt, worin ihre Schwerpunkte
liegen und wie die Auswahl beziehungsweise Aktualisierung funktioniert. Die
Beschreibungen sind eigene, überprüfte Texte; Feed-Titel oder Anbietertexte
werden nicht kopiert. Es entstehen insbesondere **keine** 39 automatischen
Einzelseiten.

Vor Implementierung wird die Suchabsicht einmal mit aktuellen externen Daten
geprüft. Danach gelten die Abnahmekriterien aus
[`seo-content-pilot.md`](seo-content-pilot.md). Liefert der einzelne Pilot nach
der vereinbarten Messzeit kein Signal, wird er nicht vervielfältigt.

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
