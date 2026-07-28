# Outbound-Policy für serverseitige Abrufe

Der Feed-Cron ruft Adressen ab, die aus der Feed-Verwaltung und aus
RSS-Inhalten stammen. Ohne Schutz könnte eine solche Adresse den Cron dazu
bringen, interne Ziele zu kontaktieren – etwa Loopback, private Netze oder den
Metadaten-Endpunkt einer Cloud-Umgebung unter `169.254.169.254`.

Die Policy liegt in zwei Schichten:

| Datei | Läuft in | Prüft |
|---|---|---|
| `shared/url-policy.js` | Edge und Node | Schema, Zugangsdaten, Host vorhanden |
| `scripts/outbound-policy.js` | nur Node | aufgelöste Adressen, Weiterleitungen |

Die syntaktische Schicht ist bewusst frei von `node:`-Importen, damit die
Edge-Function `api/feeds.ts` sie mitbenutzen kann.

Die gesperrten Bereiche stehen **einmal** in `shared/ip-ranges.js`. Der Cron
baut daraus eine `net.BlockList`, die Edge-Seite prüft IP-Literale mit einer
reinen JavaScript-Umsetzung gegen dieselbe Liste. Ein Kreuztest hält beide
Umsetzungen deckungsgleich – ohne ihn würden die Listen mit der Zeit
auseinanderlaufen, und die Feed-Verwaltung akzeptierte Adressen, die der Cron
anschließend ablehnt.

## Was abgelehnt wird

**Syntaktisch:** alles außer `http:` und `https:` (also auch `javascript:`,
`data:` und `file:`), URLs mit eingebetteten Zugangsdaten und URLs ohne Host.

**Nach Adresse:** Loopback, private Bereiche, Carrier-Grade NAT, Link-local
einschließlich der Cloud-Metadaten, Multicast, reservierte und
Dokumentationsbereiche – für IPv4 und IPv6. IPv4-mapped IPv6-Adressen wie
`::ffff:127.0.0.1` werden über die IPv4-Regeln miterfasst; das ist in
`tests/feeds/unit/outbound-policy.test.js` festgehalten.

Alternative Schreibweisen numerischer Adressen (dezimal `2130706433`, oktal
`0177.0.0.1`, hexadezimal `0x7f000001`) normalisiert bereits der URL-Parser zu
`127.0.0.1` und fallen damit unter dieselben Regeln.

**Gemischte DNS-Antworten:** Enthält eine Antwort auch nur eine gesperrte
Adresse, wird das gesamte Ziel abgelehnt. Andernfalls bliebe offen, welche
Adresse der Verbindungsaufbau am Ende wählt.

**Weiterleitungen:** Automatisches Folgen ist abgeschaltet. Jeder Hop wird
erneut vollständig geprüft, Schleifen werden erkannt und die Anzahl ist
begrenzt.

Eine abgelehnte Adresse erreicht das Netzwerk nicht: Die Prüfung läuft
vollständig vor dem Absetzen der Anfrage. Ein abgelehntes Ziel wird auch nicht
stellvertretend über den PHP-Proxy abgerufen.

**Der Proxy-Endpunkt selbst unterliegt derselben Policy.** Die Adresse aus
`FEED_PROXY_URL` muss also öffentlich auflösen. Ein Proxy auf einem internen
Host oder unter `localhost` würde abgelehnt – für eine lokale Erprobung ist das
ein bewusster Nebeneffekt, kein Fehler.

## Ausgabe-Policy für Inhalts-URLs

Artikel- und Bildadressen stammen aus fremden RSS-Inhalten und werden zusätzlich
zur Outbound-Prüfung normalisiert. `normalizeContentUrl` aus
`shared/url-policy.js` liefert entweder eine absolute, geprüfte Adresse oder
`null`. Relative Angaben werden nur gegen eine übergebene Basis aufgelöst:
Artikel-Links gegen die Feed-Adresse, Bildadressen gegen den Artikel-Link.

Dieselbe Funktion gilt an allen vier Stellen, damit die Regel nicht mehrfach
gepflegt werden muss:

| Ort | Verhalten bei Ablehnung |
|---|---|
| Feed-Ingest (`parseRssXml`) | Artikel wird übersprungen; abgelehntes Bild lässt den Artikel bestehen |
| OG-Scraping | gescrapte Adresse wird verworfen |
| Artikelkarte (SPA) | Karte bleibt sichtbar, aber ohne `href` und ohne `src` |
| `/gaming-news` | Eintrag wird als `div` statt als Anker ausgegeben |

Verworfene Elemente werden am Ende eines Feeds gebündelt nach Grund gemeldet.
Ein einzelnes ungültiges Element beschädigt weder den Cache noch den restlichen
Feed.

Die Prüfung an den Ausgabestellen ist bewusst redundant zum Ingest: Ältere
Cache-Einträge stammen aus der Zeit davor, und dem Cache wird nicht vertraut.

## Gebundener Transport gegen DNS-Rebinding

Eine Vorabprüfung allein genügt nicht: `fetch()` löst den Host anschließend
erneut auf, und zwischen Prüfung und Verbindung könnte ein Angreifer mit sehr
kurzer TTL auf eine private Adresse wechseln.

Deshalb läuft der Abruf über `undici` mit einem eigenen `connect.lookup`. Dieser
Lookup gibt ausschließlich geprüfte Adressen heraus; enthält die Antwort eine
gesperrte Adresse, bekommt der Transport gar keine Adresse, sondern einen
Fehler. Da undici sich genau mit dem verbindet, was der Lookup liefert, ist die
Verbindung an das geprüfte Ziel gebunden – ein zweiter, ungeprüfter
Auflösungsschritt findet nicht statt.

Die Vorabprüfung bleibt zusätzlich bestehen. Sie lehnt ab, bevor überhaupt ein
Verbindungsaufbau beginnt, und erfüllt damit „kein abgewiesener Request erreicht
das Netzwerk".

Verbleibende Grenzen, bewusst benannt:

- Der Schutz gilt für den Node-Cron. Die Edge-Runtime hat keinen DNS-Zugriff und
  prüft deshalb nur syntaktisch.
- `undici` ist damit eine bewusste Laufzeitabhängigkeit des Cron-Skripts.
- Ein Ziel, das zum Zeitpunkt des Abrufs auf eine öffentliche Adresse zeigt,
  bleibt erlaubt – die Policy schützt vor internen Zielen, nicht vor
  unerwünschten öffentlichen.

## Vor dem Aktivieren: Bestand prüfen

Alle konfigurierten Feed-Adressen lassen sich vorab read-only gegen die Policy
prüfen. Das Skript schreibt nichts und setzt keine Abrufe ab:

```bash
node scripts/check-feed-urls.js
```

Es braucht `POSTGRES_URL` und beendet sich mit Code 1, sobald mindestens eine
Adresse abgelehnt würde. Eine Ablehnung ist immer zuerst zu klären: Entweder ist
die Adresse falsch, oder die Policy ist für diesen Fall zu eng.

> **Release-Gate abgeschlossen:** Am 28. Juli 2026 gegen den produktiven
> Bestand ausgeführt – **40 von 40 Feed-Adressen** passieren die Policy, keine
> Ablehnung. Damit ist belegt, dass die Policy den tatsächlichen Bestand nicht
> zu eng fasst.
>
> Die Adressen in `tests/feeds/unit/outbound-policy.test.js` bleiben eine
> Regressionssicherung und ersetzen diesen Lauf nicht. Er ist zu wiederholen,
> wenn Feeds hinzukommen oder die gesperrten Bereiche in `shared/ip-ranges.js`
> erweitert werden.

## Verhalten in der Feed-Verwaltung

`api/feeds.ts` prüft beim Anlegen und Ändern die syntaktische Schicht und
antwortet bei einer unzulässigen Adresse mit **400** und einer verständlichen
Begründung, zum Beispiel:

```json
{ "error": "Die Feed-Adresse wurde abgelehnt: Nur http und https sind erlaubt, nicht \"javascript:\"." }
```

Die Adressauflösung findet dort bewusst **nicht** statt: Die Edge-Runtime hat
keinen DNS-Zugriff, und eine Prüfung zum Zeitpunkt des Speicherns wäre ohnehin
nur eine Momentaufnahme. Verbindlich ist die Prüfung im Cron unmittelbar vor
dem Abruf.
