# SEO, Indexierung und messbare Auffindbarkeit

Stand: 31. Juli 2026

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
- Die Startseite lieferte im ursprünglichen HTML trotzdem nur einen leeren
  React-Container. Ein zusätzlicher Render-Schritt bleibt unnötig fragil und
  andere Crawler müssen JavaScript nicht ausführen. Seit SEO1 steht dort
  stattdessen ein kleiner, wahrer Fallback – kein Prerendering, keine
  Artikelkopie.
- `/gaming-news` liefert bereits fertiges HTML und bleibt die
  servergerenderte SEO-Einstiegsseite. Seit SEO1 ist sie aus der laufenden App
  über den Footer normal verlinkt und verweist ihrerseits zurück.
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
- Kein Vollständigkeitsversprechen. GamerFeed deckt genau die konfigurierten
  Feeds ab, nie „alle Quellen“ – das gilt für Metadaten und für sichtbare
  Produkttexte gleichermaßen.
- Keine garantierte Aktualisierungsfrequenz. Der Cron-Workflow ist zu
  Minute 7, 27 und 47 **geplant**, GitHub stellt geplante Läufe aber global in
  eine Warteschlange. Texte nennen den Takt deshalb als Plan mit möglichen
  Verzögerungen, nie als „Echtzeit“.
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

**Umgesetzt am 30. Juli 2026.** Arbeitspaket SEO1 setzt nur die technische und
inhaltliche Grundlage:

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

#### Wie der Fallback verschwindet

Der Fallback steht **innerhalb** von `#root` und trägt `data-seo="fallback"`.
`ReactDOM.createRoot(container)` leert den Container vor dem ersten Rendern –
genau deshalb braucht es weder ein Skript noch eine CSS-Regel, die ihn
ausblendet. Wer ihn nach außerhalb von `#root` verschiebt, erzeugt eine zweite
sichtbare H1 neben der Kopfzeile der App.

Da Tailwind erst mit dem JavaScript-Modul geladen wird, bringt der Fallback
seine wenigen CSS-Regeln in einem `<style>`-Block im `<head>` selbst mit. Keine
dieser Regeln verbirgt etwas, verschiebt etwas aus dem Viewport oder schrumpft
etwas auf Pixelgröße; die Tests prüfen genau das.

#### Wo die Regeln getestet werden

| Datei | Prüft |
|---|---|
| `tests/frontend/unit/seo-static-entry.test.js` | Quell-`index.html`: eine H1, eigene Beschreibung, interner Link, nichts Verstecktes, keine feste Quellenzahl, keine `SearchAction` |
| `tests/frontend/unit/footer-gaming-news-link.test.js` | gerenderter Footer-Link, in DE und EN unterschiedlich |
| `tests/frontend/unit/honest-product-claims.test.js` | sichtbare „Über uns“-Texte in DE und EN: keine feste Quellenzahl, keine Vollständigkeit, kein „Echtzeit“ |
| `tests/server/unit/gaming-news-page.test.js` | `/gaming-news`: eine H1, eigener Einleitungstext, Canonical, Rückweg zur App |
| `tests/e2e/seo-entry.spec.ts` | erzeugtes Production-HTML mit **und** ohne JavaScript, genau eine sichtbare H1 nach dem React-Start |

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
Artikeltiteln. Das ist eine Auflistung, kein eigener redaktioneller Fließtext,
und liegt außerhalb des SEO1-Umfangs. Ob sie auf einen eigenen zeitstabilen
Text umgestellt wird, entscheidet SEO2 anhand der dann sichtbaren Snippets.

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
| Live-Test Startseite | erledigt | technisch abrufbar und indexierbar |
| Live-Test `/gaming-news` | erledigt | technisch abrufbar und indexierbar |
| Indexierungsantrag Startseite | offen | Google lehnte den Versuch am 30. Juli wegen des überschrittenen Tageskontingents ab; es liegt keine Annahmebestätigung vor |
| Indexierungsantrag `/gaming-news` | offen | erst erneut versuchen, wenn Search Console wieder Anträge annimmt |
| Sitemap-Befund abgleichen | offen | Der Sitemap-Bericht hatte `/sitemap.xml` erfolgreich mit zwei URLs gelesen, die URL-Prüfung zeigte später jedoch „Vorübergehender Verarbeitungsfehler“; beide Ansichten erneut prüfen, bevor ein Defekt der öffentlichen Sitemap angenommen wird |
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
