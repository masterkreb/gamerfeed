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

## Schutzmaßnahmen und Grenzen

Der Proxy:

- akzeptiert nur `GET`;
- vergleicht die Zieladresse exakt mit seiner Allowlist;
- folgt keinen Redirects;
- erlaubt cURL ausschließlich HTTPS;
- begrenzt die dekomprimierte Antwort auf 5 MiB;
- reicht den HTTP-Status der Quelle durch.

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
4. den Feed-Workflow manuell starten.

Falls sich Hostname oder Pfad des Proxys ändern, muss ausschließlich das
GitHub-Secret `FEED_PROXY_URL` aktualisiert werden. Es ist keine Vercel-
Umgebungsvariable.
