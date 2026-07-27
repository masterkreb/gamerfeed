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

## Bekannte Grenze: DNS-Rebinding

**Diese Umsetzung schließt DNS-Rebinding nicht aus.**

Node stellt `undici` nicht als importierbares Modul bereit, deshalb lässt sich
beim globalen `fetch` die Verbindung nicht an die zuvor geprüften Adressen
binden. Zwischen Prüfung und Verbindungsaufbau bleibt ein Zeitfenster: Wer eine
Domain mit sehr kurzer TTL kontrolliert, kann dem Prüfschritt eine öffentliche
Adresse zeigen und dem Verbindungsaufbau eine private (TOCTOU).

Die Roadmap sieht dafür ausdrücklich den Fail-closed-Weg vor. Konkret heißt das
hier:

- jede Unsicherheit führt zur Ablehnung, nicht zum Durchlassen;
- eine Ablehnung wird **nicht** wiederholt, weil sie deterministisch ist;
- jeder Weiterleitungsschritt wird erneut geprüft;
- die Feed-Liste ist nicht öffentlich, sondern wird vom Admin gepflegt.

Ein vollständiger Schutz bräuchte entweder eine Bindung an die geprüfte Adresse
(zum Beispiel über `undici` als Abhängigkeit mit eigenem `connect`-Lookup) oder
einen Egress-Proxy, der die Regeln außerhalb des Prozesses durchsetzt. Beides
ist eine bewusste Erweiterung und kein stiller Nebeneffekt.

## Vor dem Aktivieren: Bestand prüfen

Alle konfigurierten Feed-Adressen lassen sich vorab read-only gegen die Policy
prüfen. Das Skript schreibt nichts und setzt keine Abrufe ab:

```bash
node scripts/check-feed-urls.js
```

Es braucht `POSTGRES_URL` und beendet sich mit Code 1, sobald mindestens eine
Adresse abgelehnt würde. Eine Ablehnung ist immer zuerst zu klären: Entweder ist
die Adresse falsch, oder die Policy ist für diesen Fall zu eng.

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
