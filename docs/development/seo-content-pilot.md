# SEO-Content-Pilot und Reichweitenfolge

Stand: 1. August 2026

Dieses Dokument übersetzt den historischen Search-Console-Befund in zwei klar
begrenzte Arbeitspakete. Es ist weder ein Auftrag für massenhaft erzeugte
SEO-Seiten noch die Behauptung, eine eigene Domain allein erzeuge Besucher.

## Gemessenes Problem

Im maximal verfügbaren Search-Console-Zeitraum vom 17. Dezember 2025 bis
29. Juli 2026 erhielt ausschließlich die Startseite 114 Impressionen und einen
Klick. Die einzige thematisch nachvollziehbare sichtbare Suchanfrage war
`pixelcritics` mit 13 Impressionen, einem Klick und durchschnittlicher Position
76,2. Normale Gaming-News-Suchabsichten fehlen; Google meldet weiterhin null
erkannte externe und interne Links.

Die Seite hatte damit nicht hauptsächlich ein Snippet- oder CTR-Problem. Sie
wurde für die gewünschte Zielgruppe nahezu nie angeboten. Technische
Indexierbarkeit bleibt notwendig, ist aber kein ausreichender Reichweitenplan.

## SEO2a – Ehrliche Metadaten der News-Einstiegsseite

**Status:** bereit als nächstes kleines Codepaket.

`/gaming-news` nennt derzeit den bis zu 60 Tage gehaltenen Bestand von maximal
10.000 Artikeln „aktuell“ und baut seine Meta-Description aus drei gekürzten
fremden Überschriften. Das ist unnötig wechselhaft und kann mitten im Satz
abbrechen.

**Umfang:**

- eigene, zeitstabile Meta-, Open-Graph-, Twitter- und CollectionPage-
  Beschreibung statt einer Kette fremder Titel;
- den 60-Tage-Bestand weder als „10.000 aktuelle Artikel“ noch als
  Vollständigkeitsversprechen darstellen;
- sichtbare Bestandsaussagen klar von den tatsächlich gezeigten 20 neuesten
  Meldungen unterscheiden;
- das vorhandene Social-Preview-Bild auch für `/gaming-news` konsistent nutzen;
- keine neue URL, kein neues Schema, keine Keyword-Aufzählung und keine
  Änderung an Feed-, Cache- oder Snapshot-Logik.

**Abnahme:**

- Quell- und gerendertes HTML enthalten keine fremden Artikeltitel in der
  Meta-Description und keine falsche Aktualitätsaussage zum Retentionsbestand;
- Canonical, `index, follow`, Snapshotbindung und die 20 Artikel bleiben
  unverändert;
- bestehende SEO-, Server- und Browsertests bleiben grün; neue Tests halten die
  Textverträge fest.

## SEO3 – Eine Quellenübersicht als Content-Pilot

**Status:** vorbereitet, Suchabsicht und dauerhafte Pflege vor Codebeginn
bestätigen.

**Eine** servergerenderte Seite „Gaming-News-Quellen im Überblick“ soll Nutzern
helfen, deutsche und internationale Gaming-Redaktionen nach Sprache und
inhaltlichem Schwerpunkt zu verstehen. Sie ist kein Ranking und ersetzt nicht
die Originalseiten.

**Vorbedingung:**

- aktuelle Nachfrage für eine kleine Query-Familie wie „Gaming News Seiten“,
  „deutsche Gaming News“ oder „Gaming News Quellen“ mit einer belastbaren
  Quelle prüfen;
- festlegen, wer die eigenen Kurzbeschreibungen bei Quellenänderungen prüft;
- vor einer späteren Vervielfältigung über die dauerhafte Domain entscheiden.

**Umfang des einzelnen Piloten:**

- genau eine URL und ein selbstkanonischer, servergerenderter HTML-Einstieg;
- eigene Einleitung zu Auswahl, Sprachen, Aktualisierung und Grenzen;
- eine gepflegte Übersicht der tatsächlich konfigurierten Quellen mit eigenen
  Kurzbeschreibungen und Links zu den Redaktionen;
- gewöhnliche interne Links von der App beziehungsweise `/gaming-news` und
  zurück;
- Eintrag in Sitemap und Regressionstests für Indexierbarkeit, Ehrlichkeit und
  genau eine Pilot-URL.

**Nicht enthalten:**

- keine automatisch erzeugte Seite je Quelle, Plattform, Datum oder Suchwort;
- keine kopierten Anbieterbeschreibungen oder Artikelzusammenfassungen;
- kein ungeprüfter KI-Text und keine vorgetäuschte redaktionelle Bewertung;
- keine Datenbankmigration und kein Hostingwechsel als vermeintliche SEO-
  Abkürzung.

**Messung und Stoppregel:**

Indexzustand, nicht-operative Suchanfragen, Impressionen, Klicks und erkannte
Links werden nach 14 und 28 Tagen festgehalten. Ohne thematische Impressionen
oder einen anderen belegbaren Nutzen wird kein zweiter Seitentyp daraus
abgeleitet.

## SEO4 – Reichweite und Domain sind getrennte Entscheidungen

Eine eigene Domain stärkt einen dauerhaften Markenauftritt und vermeidet eine
spätere Migration vieler URLs. Sie erzeugt allein aber weder Rankings noch
Backlinks. Vor einer breiteren Content-Struktur wird sie entschieden; der eine
Pilot kann vorbereitet werden, ohne diese Entscheidung vorzutäuschen.

Externe Reichweite entsteht separat durch nachvollziehbare, passende Verweise
und freiwillige Verteilung. Link-Spam, gekaufte Massenlinks und automatisierte
Community-Posts sind ausdrücklich kein Bestandteil.
