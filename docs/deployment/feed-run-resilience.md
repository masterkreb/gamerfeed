# Belastbarkeit des Cron-Laufs

Stand: 28. Juli 2026 (Roadmap-Paket O2a)

Der Cron-Lauf spricht mit lauter Systemen, die er nicht kontrolliert: 15+
Feed-Quellen, fremde Artikelseiten, Groq und ein externes PHP-Hosting. O2a legt
fest, was passiert, wenn eines davon sich falsch verhält.

## Ein kaputtes Element kostet nur dieses Element

Vorher riss ein einziges ungültiges `pubDate` den ganzen Feed mit:
`new Date(...).toISOString()` warf aus der Element-Schleife heraus, der Aufrufer
wertete das als Parse-Fehler der Quelle, und **alle** gültigen Artikel dieses
Feeds gingen verloren.

`parseFeedItems` prüft das Datum jetzt ausdrücklich und klammert zusätzlich
jedes Element in `try/catch`. Gezählt wird nach Grund:

| Grund | Bedeutung |
|---|---|
| `incomplete` | Titel, Link oder Datum fehlt |
| `invalid_date` | Datum nicht lesbar |
| `invalid_link` | Adresse von der Ausgabe-Policy abgelehnt |
| `invalid_image` | Bildadresse abgelehnt – der Artikel bleibt, das Bild fällt weg |
| `item_error` | unerwartete Ausnahme in genau diesem Element |

Der Bericht enthält **nur Grund und Anzahl**. Titel, Adressen und Artikelinhalte
tauchen nirgends auf – auch nicht der Text einer Ausnahme, die solche Daten
mitführen könnte. Der Feed-Status trägt zusätzlich `skippedItemCount` und nennt
die Gründe in `message`.

`parseRssXml` bleibt als reine Artikelliste erhalten, damit bestehende Aufrufer
unverändert weiterarbeiten. Wer den Zähler braucht, nimmt `parseFeedItems`.

Ein wirklich unbrauchbarer Feed (kein XML, kein RSS/Atom) bleibt weiterhin ein
Fehler der ganzen Quelle – das ist die richtige Aussage.

## Grenzen externer Abrufe

| Abruf | Timeout | Größe |
|---|---|---|
| Feed direkt | 15 s | 5 MB |
| Feed über Proxy | 20 s | 5 MB |
| Artikelseite (OG-Scraping) | 5 s | 2 MB |
| Groq | 20 s | 256 KB |

Alle Grenzen sind Parameter und damit ohne echte Wartezeit prüfbar.

Gelesen wird überall über `scripts/limited-response.js`. Das ist wichtiger, als
es klingt: die Prüfung zählt die **tatsächlich gelesenen Bytes** und bricht den
Stream ab. Eine `Content-Length` allein genügt nicht – ohne diesen Header könnte
eine Gegenstelle beliebig lange senden. Bei Überschreitung wird der Stream über
`reader.cancel()` geschlossen, damit keine Verbindung offen weiterläuft.

Der SSRF- und Redirect-Schutz aus `scripts/outbound-policy.js` bleibt unverändert
davor: ein abgelehntes Ziel erreicht das Netz nicht, jeder Weiterleitungsschritt
wird erneut geprüft.

## Trends sind optional

Groq-Aufrufe laufen über `scripts/groq-client.js`. Jeder Fehler – Timeout,
Providerfehler, zu große oder ungültige Antwort – endet als
`{ content: null, error }` und **nie** als geworfene Ausnahme.

Die Trendphase läuft nach dem Kern-Publish und fängt ihre Fehler selbst ab. Ein
bereits veröffentlichter Lauf wird dadurch nicht nachträglich zu `fatal` und
sein Kern-Publish nicht als veraltet markiert.

Providerfehlertexte werden auf 200 Zeichen gekürzt und laufen durch die
Bereinigung. Ungültiges JSON wird ohne Rohtext gemeldet – er stammt vom Provider.
Der API-Schlüssel steht ausschließlich im `Authorization`-Header.

## Der Proxy ist die Ausnahme

```js
PROXY_ELIGIBLE_SOURCES = ['gamepro']
```

Nur ausdrücklich freigegebene Quellen dürfen den externen PHP-Proxy versuchen.
GamePro steht darauf, weil es Anfragen aus dem GitHub-Actions-Netz mit HTTP 403
beantwortet – dafür gibt es den Umweg.

**XboxDynasty steht bewusst nicht darauf.** Der dort einmalig beobachtete Timeout
ist ein vorübergehendes Problem der Quelle und kein Grund, fremdes Hosting zu
belasten. Vorher genügte irgendein fehlgeschlagener Direktabruf, um den Proxy zu
bemühen.

Die Entscheidung liegt bewusst auf dieser Seite und nicht beim PHP-Skript. Die
exakte Allowlist des Proxys bleibt unverändert und zusätzlich wirksam;
`tools/feed-proxy.php` und das Hosting werden von O2a nicht angefasst.

## Konfiguration wird vorab geprüft

`scripts/feed-run-config.js` trennt zwei Klassen:

| Klasse | Werte | Fehlt einer |
|---|---|---|
| **Core** | `POSTGRES_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Lauf endet kontrolliert und fatal, **vor** dem ersten SQL-, KV-, Recorder- oder HTTP-Zugriff |
| **Optional** | `GROQ_API_KEY`, `FEED_PROXY_URL` | genau diese Zusatzfunktion wird übersprungen, der Kernlauf läuft weiter |

Ein Wert gilt nur als vorhanden, wenn er ein nicht-leerer String ist.
**Leerzeichen zählen nicht** – ein versehentlich als `" "` gesetztes GitHub-Secret
ist genauso unbrauchbar wie ein fehlendes, bestünde aber jede naive
Truthiness-Prüfung.

`FEED_PROXY_URL` wird zusätzlich syntaktisch geprüft und muss `https` verwenden;
ein `http`-Wert wäre ein stiller Downgrade auf einen unverschlüsselten Umweg.

Gemeldet wird **ausschließlich der Variablenname**, nie ein Wert – auch nicht die
verworfene Proxy-Adresse, die selbst ein GitHub-Secret ist.

## Testbarkeit

`main()` nimmt seine äußeren Abhängigkeiten als Parameter: `env`, `store`,
`database`, `createRecorder`, `fetchImpl`, `lookup`, `groqFetch`, `exit` und
`logger`. In Produktion gelten unverändert die bisherigen Vorgaben
(`process.env`, `@vercel/kv`, `@vercel/postgres`, der gebundene Transport,
`process.exit`).

Nur so lässt sich die zentrale Zusage belegen: bei fehlendem Core-Wert zeigen
alle Spies **null Aufrufe**. Die Tests in
`tests/feeds/integration/feed-run-orchestration.test.js` verwenden zusätzlich
eine Netz-Attrappe, die jeden unerwarteten Zugriff auffallen lässt. Kein Test
kontaktiert einen echten Feed, Groq, das Hosting, PostgreSQL oder KV.

## Bewusst nicht enthalten

O2a begrenzt **einzelne** Aufrufe. Nicht Bestandteil sind:

- globale Laufdeadline und Scrape-Budget sowie der Ergebniszustand `degraded`
  (O2b);
- generationsgebundener oder atomarer Cache-Publish (O3a/O3b);
- Historie und Alarmierung (O4);
- neue Parallelisierung, Abhängigkeits-Upgrades, Plattform- oder
  Hosting-Änderungen.

Die Summe aller Einzelgrenzen ist damit weiterhin nicht gegen das
30-Minuten-Hardlimit des Workflows gedeckelt – das ist genau die Lücke, die O2b
schließt.
