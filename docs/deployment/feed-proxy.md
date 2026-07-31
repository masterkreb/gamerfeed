# Externen Feed-Proxy betreiben

Der optionale Feed-Proxy ist ein Fallback für einzelne RSS-Quellen, deren
Bot-Schutz Anfragen von GitHub-Actions-Rechenzentren blockiert. Die React-App
und die Vercel Functions verwenden ihn nicht. Er wird vom Workflow
`.github/workflows/update-feeds.yml` oder bei einem manuellen lokalen
Cache-Lauf aufgerufen, nachdem der direkte Feed-Abruf fehlgeschlagen ist.

## Voraussetzungen

- externes Webhosting mit PHP 8 und aktivierter cURL-Erweiterung;
- eine HTTPS-Adresse für den Proxy;
- Zugriff auf die GitHub Actions Secrets des Repositorys.

Der PHP-Proxy wird nicht von Vercel bereitgestellt und nicht automatisch
deployt.

## Deployment

1. `tools/feed-proxy.php` auf das externe Hosting kopieren, beispielsweise in
   ein öffentliches Verzeichnis wie `public_html/gamerfeed/`.
2. In der PHP-Datei die `$allowed`-Liste prüfen. Es werden ausschließlich exakt
   eingetragene Feed-URLs akzeptiert. Keine Präfixe oder Wildcards verwenden.
3. Falls auf dem Hosting eine PHP-CLI verfügbar ist, die hochgeladene Datei
   prüfen:

   ```bash
   php -l feed-proxy.php
   ```

4. Im GitHub-Repository unter **Settings → Secrets and variables → Actions**
   folgendes Secret anlegen:

   | Secret | Wert |
   |---|---|
   | `FEED_PROXY_URL` | Vollständige HTTPS-Adresse der PHP-Datei, ohne `url`-Parameter |

Ohne `FEED_PROXY_URL` arbeitet der Cron-Job weiterhin, verwendet aber nur den
direkten Feed-Abruf.

## Funktion prüfen

Die erlaubte URL muss URL-kodiert übergeben werden:

```bash
curl -i "https://proxy.example/feed-proxy.php?url=https%3A%2F%2Fwww.gamepro.de%2Frss%2Fgamepro.rss"
```

Erwartet wird HTTP 200 mit RSS-Inhalt. Eine nicht erlaubte Adresse muss HTTP 422
liefern:

```bash
curl -i "https://proxy.example/feed-proxy.php?url=https%3A%2F%2Fexample.com%2Ffeed.xml"
```

Danach den Workflow **Update RSS Feeds Cache** einmal manuell starten und im
Log kontrollieren, ob bei einem fehlgeschlagenen Direktabruf
`Feed proxy fetch successful` erscheint.

## Fingerprint prüfen

Seit O4d beantwortet der Proxy eine zweite, eng begrenzte Frage: **Liegt auf dem
Hosting noch dieselbe Datei wie im Repository?** Der manuelle Upload wird
nirgends automatisch abgeglichen, und eine vergessene Aktualisierung fällt sonst
erst auf, wenn ein Feed dauerhaft ausfällt.

### Der Modus

```bash
curl -i "https://proxy.example/feed-proxy.php?mode=fingerprint"
```

Erwartet wird HTTP 200 mit genau dieser Form:

```json
{"schemaVersion":1,"service":"gamerfeed-feed-proxy","algorithm":"sha256","fingerprint":"<64 Hexziffern>"}
```

Der Fingerprint ist der SHA-256-Hash des **kanonisierten** Dateiinhalts: CRLF
und einzelne CR werden vor dem Hash zu LF. Ein Upload per FTP im Textmodus oder
ein Windows-Editor ändert damit nichts am Ergebnis – nur eine echte inhaltliche
Änderung tut das.

Der Modus ist bewusst isoliert:

- Er ruft **niemals** den Upstream-Feed ab und fasst die Allowlist nicht an.
- Er steht **vor** der cURL-Prüfung; ein Hosting ohne cURL-Erweiterung meldet
  seine Version trotzdem, statt nur „Proxy is not configured correctly“.
- Ein mitgegebener `url`-Parameter wird ignoriert – der Modus gewinnt.
- `Cache-Control: no-store` und `X-Content-Type-Options: nosniff` gelten
  unverändert.

> **Der Fingerprint ist nicht geheim.** Er ist der Hash einer Datei, die
> öffentlich im Repository liegt, und verrät weder die Adresse des Endpunkts
> noch irgendein Secret. Geheim bleibt allein `FEED_PROXY_URL`.

### Der Vergleich

Den Workflow **Proxy-Fingerprint prüfen** manuell starten
(`.github/workflows/proxy-fingerprint.yml`, nur `workflow_dispatch`). Er
berechnet den erwarteten Fingerprint aus `tools/feed-proxy.php`, ruft den
Fingerprint-Modus über `FEED_PROXY_URL` ab und vergleicht beides.

Der Workflow ist **ausdrücklich nicht** Teil von `update-feeds.yml`: ein
abweichender Fingerprint soll eine ruhige Betriebsentscheidung auslösen, keinen
roten Cron-Lauf und keinen blockierten News-Publish. Er bekommt deshalb auch
weder Datenbank- noch KV-Secrets.

### Adressvertrag

Der Fingerprint-Workflow akzeptiert **exakt denselben** `FEED_PROXY_URL`-Vertrag
wie der Feed-Lauf – er benutzt dafür buchstäblich dieselbe Funktion
(`readOptionalProxyUrl` in `scripts/feed-run-config.js`):

- **HTTPS ist Pflicht.** Ein `http://` wird abgelehnt, statt still auf eine
  unverschlüsselte Verbindung herunterzustufen.
- Andere Protokolle, eingebettete Zugangsdaten (`https://nutzer:pw@…`) und
  syntaktisch ungültige Adressen werden ebenfalls abgelehnt.
- Vorhandene Queryparameter einer gültigen HTTPS-Adresse bleiben erhalten.

Eine abgelehnte Adresse löst **keinerlei** Netzwerkzugriff aus: die Prüfung
läuft vor dem Bau der Anfrageadresse, vor der DNS-Auflösung und vor jedem
Abruf. Das Ergebnis ist `missing_configuration`, und die Meldung nennt nur den
Variablennamen und den Grund – niemals Adresse, Host, Pfad oder Querystring.

Lokal geht derselbe Vergleich mit gesetztem `FEED_PROXY_URL`:

```bash
FEED_PROXY_URL="https://proxy.example/feed-proxy.php" node scripts/check-proxy-fingerprint.js
```

Der erwartete Fingerprint allein – ohne Abruf – lässt sich so berechnen:

```bash
node --input-type=module -e "
import { readFile } from 'node:fs/promises';
import { computeProxyFingerprint } from './scripts/proxy-fingerprint.js';
console.log(computeProxyFingerprint(await readFile('tools/feed-proxy.php', 'utf8')));
"
```

Derselbe Wert muss im Feld `fingerprint` der Endpunktantwort stehen.

### Produktionsabnahme von O4d

Das erstmalige Rollout-Gate wurde am **31. Juli 2026** geschlossen. Nach dem
manuellen Upload auf Cyon bestätigte der GitHub-Actions-Lauf
[30661491099](https://github.com/masterkreb/gamerfeed/actions/runs/30661491099),
dass der deployte Fingerprint mit `tools/feed-proxy.php` am Merge-Commit
`972d2ef` übereinstimmt. Der Workflow endete erfolgreich; weder Feed-Anbieter
noch Produktionscache oder Datenbank wurden dabei angesprochen.

Diese Abnahme belegt den damaligen Stand, ersetzt aber keine spätere Prüfung:
Nach jeder Änderung an `tools/feed-proxy.php` bleiben Upload und erneuter
Fingerprint-Vergleich erforderlich.

### Ergebnisse und ihre Bedeutung

| Ausgang | Bedeutung | Nächster Schritt |
|---|---|---|
| `ok` | Deployte Datei entspricht der Hauptkopie | nichts zu tun |
| `mismatch` | Der Endpunkt läuft mit einer **anderen** Fassung | Datei erneut hochladen, danach erneut prüfen |
| `missing_configuration` | `FEED_PROXY_URL` fehlt oder ist unbrauchbar | Secret prüfen |
| `unreadable_source` | `tools/feed-proxy.php` lokal nicht lesbar | Checkout prüfen |
| `request_failed` | Endpunkt nicht erreichbar, Zeitgrenze oder Transportfehler | Hosting prüfen; **keine** Aussage über die Version |
| `http_error` | Der Endpunkt antwortete mit einem Fehlerstatus | Hosting- und Serverprotokolle prüfen |
| `response_too_large` | Antwort über 4 KiB – vermutlich eine Fehlerseite | Endpunktpfad prüfen |
| `invalid_json` / `invalid_schema` | Antwort stammt nicht nachweislich von diesem Dienst | Pfad und hochgeladene Datei prüfen |

„Nicht erreichbar“ ist ausdrücklich etwas anderes als „andere Version“. Aus
einem Ausfall des Hostings darf keine Aussage über die deployte Datei abgeleitet
werden – deshalb sind die Ausgänge getrennt benannt.

Keine Meldung und kein Protokolleintrag enthält `FEED_PROXY_URL`, ihren
Querystring oder den Host; der Checker bereinigt jeden Text doppelt.

## Schutzmaßnahmen und Grenzen

Der Proxy:

- akzeptiert nur `GET`;
- vergleicht die Zieladresse exakt mit seiner Allowlist;
- folgt keinen Redirects;
- erlaubt cURL ausschließlich HTTPS;
- begrenzt die dekomprimierte Antwort auf 5 MiB;
- reicht den HTTP-Status der Quelle durch;
- beantwortet `?mode=fingerprint` ohne jeden Upstream-Abruf.

Der aktuelle Endpunkt besitzt noch keine gemeinsame Token-Authentifizierung.
Die Allowlist verhindert einen allgemeinen offenen Proxy, aber ein bekannter
Endpunkt könnte wiederholt aufgerufen und damit belastet werden. Deshalb:

- auf dem Webserver ein Rate-Limit aktivieren, sofern verfügbar;
- den Proxy niemals für beliebige Benutzer-URLs freigeben;
- Zugriffs- und Fehlerprotokolle beobachten;
- bei auffälliger Nutzung den Endpunkt vorübergehend deaktivieren.

Eine echte Token-Authentifizierung benötigt ein zusätzliches Secret sowohl auf
dem PHP-Hosting als auch in GitHub Actions und muss deshalb als koordinierte
Betriebsänderung eingeführt werden.

## Änderungen und Domainwechsel

`tools/feed-proxy.php` ist die Hauptkopie im Repository. Änderungen werden nicht
automatisch auf das externe Hosting übertragen. Nach jeder Änderung:

1. CI einschließlich PHP-Lint abwarten;
2. Datei erneut hochladen;
3. beide Smoke-Tests ausführen;
4. den Workflow **Proxy-Fingerprint prüfen** starten – er belegt, dass die
   hochgeladene Datei wirklich die neue ist;
5. den Feed-Workflow manuell starten.

Schritt 4 ist der eigentliche Gewinn von O4d: bis dahin war „hochgeladen“ eine
Behauptung, keine Feststellung.

Falls sich Hostname oder Pfad des Proxys ändern, muss ausschließlich das
GitHub-Secret `FEED_PROXY_URL` aktualisiert werden. Es ist keine Vercel-
Umgebungsvariable.
