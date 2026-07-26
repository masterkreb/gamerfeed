# Wechsel auf eine eigene Domain

Diese Checkliste verhindert, dass bei einem späteren Wechsel von
`gamerfeed.vercel.app` auf eine eigene Domain sicherheits- oder
SEO-relevante Stellen vergessen gehen.

## 1. Ziel festlegen

- Eine Hauptadresse wählen, zum Beispiel `https://gamerfeed.ch`.
- Festlegen, ob `www.gamerfeed.ch` auf die Hauptadresse weiterleiten soll.
- Die bisherige `gamerfeed.vercel.app`-Adresse während der Umstellung erreichbar
  lassen und auf die neue Hauptadresse umleiten.

## 2. Vercel und DNS konfigurieren

1. Unter **Vercel → Project → Settings → Domains** die Hauptdomain und bei
   Bedarf die `www`-Domain hinzufügen.
2. Die von Vercel angezeigten DNS-Einträge beim Domainanbieter setzen.
3. Eine Domain als Hauptadresse verwenden und die andere darauf umleiten, damit
   keine doppelten Inhalte entstehen.

Aktuelle Anleitung:
[Vercel – Setting up a custom domain](https://vercel.com/docs/domains/set-up-custom-domain)

## 3. reCAPTCHA umstellen

1. Die neue Domain in der Google-reCAPTCHA-Administration zur bestehenden
   reCAPTCHA-v3-Site hinzufügen. Der vorhandene Site Key kann danach
   weiterverwendet werden.
2. In Vercel für **Production** den Wert aktualisieren:

   ```env
   RECAPTCHA_ALLOWED_HOSTNAMES=gamerfeed.ch,www.gamerfeed.ch,gamerfeed.vercel.app
   ```

3. Hostnamen ohne `https://`, Pfad oder abschliessenden Schrägstrich eintragen.
4. Die alte Vercel-Domain erst aus der Liste entfernen, wenn sie nicht mehr
   direkt verwendet werden soll.
5. Für dynamische Preview-Domains die Variable weiterhin weglassen oder für
   einen stabilen Preview-Branch einen eigenen exakten Hostnamen konfigurieren.

Google erlaubt mehrere Domains für dasselbe Schlüsselpaar. `localhost` muss für
lokale reCAPTCHA-Tests separat erlaubt sein:
[Google – Domain validation](https://developers.google.com/recaptcha/docs/domain_validation)

## 4. Produktions-URLs im Repository ersetzen

Vor der Umstellung alle aktuellen Treffer anzeigen:

```bash
rg -n -F "gamerfeed.vercel.app" --glob "!node_modules/**" --glob "!dist/**" .
```

Diese produktiven Stellen müssen geprüft werden:

| Datei | Zweck |
|---|---|
| `index.html` | Canonical URL, Open Graph, Twitter Card und strukturierte Daten |
| `api/gaming-news.ts` | Canonical URL, strukturierte Daten und sichtbare Links der News-Seite |
| `public/robots.txt` | Adresse der Sitemap |
| `public/sitemap.xml` | Indexierte Seitenadressen |
| `vite.config.ts` | Ziel des lokalen `/api`-Proxys, falls die alte Domain wegfällt |
| `server/contact-utils.js` | Text im Fuss der Kontakt-E-Mail |
| `README.md` und `QUICKSTART.md` | Beispiele und Betriebsdokumentation |

Die gleichnamige Datei `robots.txt` im Projektstamm ist keine Vite-Public-Datei
und sollte bei der nächsten Bereinigung entweder entfernt oder mit
`public/robots.txt` konsolidiert werden.

Treffer in Tests sind Testdaten und müssen nur angepasst werden, wenn die Tests
ausdrücklich die neue Produktionsdomain abbilden sollen.

## 5. Externe Dienste prüfen

- In Google Analytics die Standard-Website-URL beziehungsweise den Web-Datenstrom
  kontrollieren.
- Die neue Sitemap bei verwendeten Suchmaschinen-Werkzeugen erneut einreichen.
- Rechtliche Texte und Kontaktangaben auf die neue Domain prüfen.
- Falls weitere Dienste Domain-Allowlisten besitzen, dort beide Domains während
  der Übergangszeit freigeben.

## 6. Deployment und Abnahme

1. Codeänderungen committen und nach `main` pushen.
2. Nach Änderungen an Vercel-Variablen ein neues Production Deployment
   auslösen.
3. Beide Domainvarianten öffnen und die Weiterleitung kontrollieren.
4. Kontaktformular über die neue Domain absenden.
5. `/robots.txt`, `/sitemap.xml` und `/gaming-news` über die neue Domain öffnen.
6. Canonical-, Open-Graph- und Twitter-URLs im ausgelieferten HTML kontrollieren.
7. Abschliessend ausführen:

   ```bash
   npm test
   npm run typecheck
   npm run build
   ```

Ein Domainwechsel ist damit eine dokumentierte Konfigurationsaufgabe und
erfordert keinen Neuaufbau der Anwendung.
