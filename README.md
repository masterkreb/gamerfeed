

# GamerFeed - Ein Moderner Gaming-News-Aggregator

GamerFeed ist ein schlanker und moderner News-Aggregator, der die neuesten Nachrichten aus der Welt der Videospiele von zahlreichen deutsch- und englischsprachigen Quellen bündelt. Die Anwendung ist als schnelle, responsive und hochgradig anpassbare Single-Page-Application (SPA) konzipiert.

## ✨ Hauptfunktionen

- **Umfassende Nachrichten-Aggregation**: Sammelt Artikel aus einer Vielzahl von RSS-Feeds.
- **Moderne Benutzeroberfläche**: Ein sauberes, responsives Design, gebaut mit React und Tailwind CSS (lokal gebaut, keine CDN-Abhängigkeit im App-Bundle).
- **⚡ Blitzschnelles Progressive Loading**: 3-stufiges Laden der Artikel für sofortige Anzeige (16 → 64 → alle Artikel). Eine neuere Ladung gewinnt immer gegen verspätete Antworten.
- **🔄 Auto-Update mit Live-Benachrichtigungen**: 
    - Automatische Prüfung auf neue Artikel alle 5 Minuten
    - Tab-Titel zeigt Anzahl neuer Artikel: `(5) GamerFeed`
    - Badge am Refresh-Button mit Puls-Animation
    - Toast-Benachrichtigung mit Swipe-to-Dismiss (links oder hoch wischen)
- **Mehrsprachigkeit**: Vollständig übersetzbar mit i18next. Erkennt automatisch die Browsersprache des Nutzers (Deutsch/Englisch) und merkt sich die Auswahl. Ein Wechsel aktualisiert Texte, Datumsformate und barrierefreie Beschriftungen ohne Neuladen.
- **Anpassbare Ansicht**:
    - **Themes**: Wähle zwischen Light- und Dark-Mode.
    - **Layouts**: Grid-, Listen- oder Kompaktansicht für Artikel.
- **Personalisierung**:
    - **Favoriten**: Speichere interessante Artikel, um sie später zu lesen.
    - **Quellen stummschalten**: Blende Nachrichten von Quellen aus, die dich nicht interessieren.
    - **Gespeicherte Suchen**: Speichere häufige Suchanfragen für schnellen Zugriff.
    - Beschädigte oder veraltete Browserwerte fallen kontrolliert auf sichere Standardeinstellungen zurück.
- **Leistungsstarke Filter & Suche**:
    - Filtere Artikel nach Zeitraum (Heute, Gestern, Letzte 7 Tage).
    - Filtere nach spezifischer Quelle oder Sprache (DE/EN).
    - Volltextsuche in Titeln und Zusammenfassungen.
- **Automatische Aktualisierung**: Ein GitHub-Action-Workflow aktualisiert den News-Cache alle 20 Minuten, sodass die angezeigten Nachrichten immer aktuell sind.
- **🤖 KI-gestützte Trend-Analyse**: Automatische Erkennung aktueller Gaming-Trends mit Groq AI (tägliche und wöchentliche Trends). Intelligente Deduplizierung von Artikeln gleicher Verlagsgruppen für akkuratere Trend-Berechnung.
- **✉️ Kontaktformular**: In den Einstellungen integriert, versendet über Gmail SMTP und ist mit reCAPTCHA v3 gegen automatisierte Zusendungen abgesichert. Server- und clientseitige Prüfung von Pflichtfeldern, Feldlängen und E-Mail-Format.
- **♿ Barrierefreiheit**:
    - Focus-Ring nur bei Tastatur-Navigation sichtbar (nicht bei Mausklicks).
    - Dialoge halten den Fokus fest und geben ihn beim Schließen an das auslösende Element zurück. Escape schließt sie; Admin-Dialoge blockieren das bewusst, solange gespeichert oder gelöscht wird.
    - Die Reiter der Einstellungen sind echte ARIA-Tabs mit Pfeiltasten-, Home- und End-Navigation.
    - Gespeicherte Suchen lassen sich mit Enter auswählen und mit Leertaste löschen; Such- und Icon-Schaltflächen besitzen eindeutige Namen.
    - Artikelaktionen liegen semantisch außerhalb des Artikel-Links und öffnen weder beim Favorisieren noch beim Optionsdialog versehentlich den Artikel.
    - Erfolgs- und Fehlermeldungen des Kontaktformulars werden Screenreadern angekündigt.
- **Admin-Panel**: Ein passwortgeschütztes Admin-Panel zur einfachen Verwaltung der Feed-Quellen, Überwachung ihres Status und Veröffentlichung von Ankündigungen.
- **📢 Ankündigungs-Banner**: Admins können wichtige Nachrichten (Info, Warnung, Wartung, Feier) als Banner für alle Benutzer anzeigen. Benutzer können Banner schließen (wird im localStorage gespeichert). Das Löschen einer Ankündigung verlangt – wie das Löschen einer Feed-Quelle – eine ausdrückliche Bestätigung.

---

## ⚡ Performance-Optimierung: Progressive Loading

GamerFeed nutzt eine innovative 3-stufige Lade-Strategie, um eine sofortige Anzeige von Inhalten zu gewährleisten:

### Wie es funktioniert:

1. **Stufe 1**: Die ersten 16 Artikel werden geladen und sofort angezeigt
2. **Stufe 2**: 64 Artikel werden nachgeladen
3. **Stufe 3**: Alle verbleibenden Artikel folgen im Hintergrund

Die tatsächliche Größe hängt von Artikelanzahl und Feldlängen ab. Die Ladedauer
wird zusätzlich von der Netzverbindung beeinflusst.

`services/news-load-controller.ts` besitzt die vollständige Ladekette. Ein
manueller Refresh oder Unmount bricht ältere Arbeit ab und entwertet sie
zusätzlich über eine Request-Epoche. Medium-Fehler verhindern Full nicht;
Hintergrundfehler behalten bereits sichtbare Artikel. Einzelheiten und
Testfälle: [Progressive News-Ladekette](docs/development/progressive-news-loading.md).

### Technische Umsetzung:

Der Cron-Job speichert drei optimierte Payloads pro unveränderlicher Generation
in Vercel KV. `news_cache_16`, `news_cache_64` und `news_cache` bleiben während
der Migration als Legacy-Kopien erhalten. Erst ein abschließender Pointer-Write
aktiviert eine vollständig geschriebene Generation:

- Preview: bis zu 16 Artikel für Instant Loading
- Medium: bis zu 64 Artikel für schnelles Nachladen
- Full: alle Artikel innerhalb des festen Bytebudgets

**Ergebnis**: Der Nutzer sieht Inhalte sofort, ohne auf das Laden des vollständigen Caches mit bis zu 10.000 Artikeln warten zu müssen.

---

## 🛠️ Architektur & Kernlogik

Dieses Projekt nutzt eine entkoppelte, "serverless" Architektur, die auf maximale Skalierbarkeit, geringe Wartung und Kosteneffizienz ausgelegt ist. Es ist entscheidend, die Rollen der einzelnen Komponenten zu verstehen.

### 💡 Free-Tier-Strategie

Das Projekt ist so konzipiert, dass es vollständig im kostenlosen Kontingent verschiedener Anbieter betrieben werden kann:

| Dienst | Anbieter | Zweck |
|--------|----------|-------|
| Hosting & Functions | Vercel (Free) | Frontend + API |
| PostgreSQL Datenbank | Neon (Free) | Feed-Quellen speichern |
| Redis Cache | Vercel KV (Free) | Artikel-Cache |
| Cron Jobs | GitHub Actions (Free) | Automatische Updates |
| KI-Analyse | Groq (Free) | Trend-Erkennung |

### Systemkomponenten

1.  **Frontend (React & Vite)**: Eine statische Single-Page-Application, die beim Start die Artikel dynamisch von API-Endpunkten abruft. Nutzt Progressive Loading für sofortige Content-Anzeige. Benutzereinstellungen werden im `localStorage` gespeichert und beim Lesen, Schreiben sowie bei Cross-Tab-Änderungen gegen Laufzeit-Decoder geprüft.
2.  **Datenbank (Neon PostgreSQL)**: Eine serverless Postgres-Datenbank, die ausschliesslich die Liste der zu verarbeitenden RSS-Feed-Quellen speichert. Alternativ kann auch Vercel Postgres verwendet werden.
3.  **Datencache (Vercel KV)**: Ein extrem schneller In-Memory-Datenspeicher, der mehrere optimierte Caches bereithält. **Artikel werden 60 Tage (2 Monate) gespeichert** (max. 10.000), ältere werden automatisch entfernt.
    - `news_cache`: Alle Artikel (vollständig)
    - `news_cache_16`: Erste 16 Artikel (Preview)
    - `news_cache_64`: Erste 64 Artikel (Medium)
    - `feed_health_status`: Systemstatus je Feed
    - `feed_run_status` & `feed_publish_status`: Cron-Heartbeat und letzter Kern-Publish
    - `news_snapshot_pointer`: aktive vollständige Cache-Generation
    - `news_snapshot:<id>:{full,preview,medium,meta}`: unveränderliche Payloads und Manifest
    - `daily_trends` & `weekly_trends`: KI-generierte Trends
4.  **Datenerfassung (GitHub Actions Cron Job)**: Ein Node.js-Skript (`scripts/fetch-feeds.js`), das alle 20 Minuten automatisch über einen GitHub-Workflow ausgeführt wird. Es ist das Herzstück der Datenaktualisierung. Falls eine freigegebene Quelle GitHub-Runner blockiert, kann der Workflow optional auf den extern betriebenen PHP-Fallback `tools/feed-proxy.php` zurückgreifen. Einrichtung und Grenzen stehen in der [Feed-Proxy-Betriebsanleitung](docs/deployment/feed-proxy.md).
5.  **API-Schicht (Vercel Functions)**: Schlanke Edge Functions für Datenabrufe sowie eine Node.js Function für den SMTP-Versand:
    *   `/api/get-news-preview`: Liefert erste 16 Artikel für sofortiges Laden
    *   `/api/get-news-medium`: Liefert erste 64 Artikel für schnelles Nachladen
    *   `/api/get-news`: Liefert alle gecachten Artikel
    *   `/api/feeds`: Dient dem Admin-Panel zur Verwaltung der Feed-Quellen
    *   `/api/get-health-data`: Liefert den Systemstatus an das Admin-Panel
    *   `/api/announcement`: Öffentlicher Abruf der aktiven Ankündigung, geschützte Verwaltung, geschützter Admin-Abruf über `?admin=1`
    *   `/api/get-trends`: Liefert KI-generierte Trends
    *   `/api/contact`: Prüft Kontaktanfragen und versendet sie per Gmail SMTP
6.  **Admin-Backend (mehrschichtiger Schutz)**: Die Middleware schützt die statische Admin-Seite. Die Admin-APIs prüfen Basic Authentication zusätzlich direkt im jeweiligen Handler und schützen schreibende Aufrufe per Same-Origin-Prüfung. Eingehendes JSON wird zur Laufzeit gegen gemeinsame Verträge geprüft; Fehler antworten mit stabilen Codes, interne Datenbank- und KV-Meldungen bleiben im Log. Einzelheiten: [Admin-API-Dokumentation](docs/deployment/admin-api.md).
7.  **KI-Integration (Groq API)**: Automatische Trend-Analyse mit Groq's llama-3.1-8b-instant Modell für Gaming-News.

---

### Entkoppelte Architektur: Wie Updates skalieren, ohne Deployments auszulösen

Eines der wichtigsten Konzepte dieses Projekts ist die **Entkopplung von Inhalts-Updates und Website-Deployments**. Dies ermöglicht häufige Aktualisierungen, ohne die Limits von Hosting-Plattformen (z. B. 100 Deployments/Tag bei Vercel) zu überschreiten.

#### 1. Der Datensammler (GitHub Actions Cron Job)

*   **Aufgabe:** Alle 20 Minuten sämtliche Feed-Quellen abrufen und die neuesten Nachrichten im zentralen Cache ablegen.
*   **Ablauf:**
    1.  Der GitHub-Workflow (`.github/workflows/update-feeds.yml`) startet das `fetch-feeds.js`-Skript.
    2.  Das Skript holt die Feed-Liste aus der Postgres-Datenbank.
    3.  Es ruft jeden Feed ab, verarbeitet die Artikel und generiert mehrere Datensätze:
        *   unveränderliche Full-, Preview- und Medium-Payloads samt Manifest
        *   `news_snapshot_pointer`: zuletzt aktivierte vollständige Generation
        *   `news_cache`, `news_cache_16`, `news_cache_64`: Legacy-Kopien aus denselben begrenzten Payloads
        *   `feed_health_status`: Protokoll über Erfolg/Misserfolg der Feed-Abrufe
        *   `feed_run_status`: Veränderlicher Status des laufenden bzw. letzten Versuchs
        *   `feed_publish_status`: Zeitpunkt des letzten erfolgreichen Kern-Publish
        *   `daily_trends` & `weekly_trends`: KI-generierte Trend-Analysen
    4.  Anschliessend schreibt das Skript diese Datensätze in den **Vercel KV Store**.
*   **WICHTIG:** Der Workflow committet **keine Dateien** mehr in das Git-Repository. Der Prozess ist vollständig vom Code der Webseite getrennt.
*   **Robustheit:** Der Prozess verhindert zuverlässig den Verlust bestehender Artikeldaten durch fehlerhafte Abrufe. Ein einzelnes kaputtes Feed-Element (etwa mit unlesbarem Datum) kostet nur dieses Element, nicht die ganze Quelle; jeder externe Abruf hat Timeout und Byte-Limit; die Pflichtkonfiguration wird geprüft, bevor die erste Verbindung aufgebaut wird. Einzelheiten: [Belastbarkeit des Cron-Laufs](docs/deployment/feed-run-resilience.md).
*   **Laufzeit:** Neben den Einzelgrenzen hat der Lauf ein **globales Budget**: eine Deadline von 18 Minuten (mit 12 Minuten Reserve vor dem 30-Minuten-Hardlimit des Workflows) und höchstens 80 Artikel-Seitenabrufe pro Lauf. Wird eine Grenze erreicht, wird die restliche Arbeit *zurückgestellt* statt abgeschnitten: die betroffenen Quellen behalten ihre alten Artikel, offene Bild-Scrapes werden fair über die Quellen verteilt und im nächsten Lauf erneut versucht. Ein solcher Lauf endet als `degraded`, nie stillschweigend als `success`. Einzelheiten: [Zeitbudget und Ergebniszustände](docs/deployment/feed-run-budget.md).

#### 2. Der Datenabruf (Frontend-Anwendung)

*   **Aufgabe:** Dem Benutzer blitzschnell die aktuellsten Nachrichten anzeigen.
*   **Ablauf (Progressive Loading):**
    1.  Die React-Anwendung sendet beim Start eine Anfrage an `/api/get-news-preview`.
    2.  Die ersten 16 Artikel werden sofort angezeigt (Stage 1).
    3.  Im Hintergrund wird `/api/get-news-medium` aufgerufen und 64 Artikel geladen (Stage 2).
    4.  Danach wird `/api/get-news` aufgerufen und alle Artikel geladen (Stage 3).
*   **Ergebnis:** Der Nutzer sieht Inhalte sofort, ohne Wartezeit. Die Daten sind immer so aktuell wie der letzte Cron-Job-Lauf.
*   **Latest request wins:** Preview, Medium, Full und manueller Refresh haben
    einen gemeinsamen Controller. Nur die aktuelle Request-Epoche darf
    React-State, Snapshot-Pin oder lokale Kopie verändern. Auto-Update-Abfragen
    sind passiv und werden durch einen Refresh beziehungsweise Unmount
    entwertet.
*   **Eine Generation, nicht drei:** Die drei Stufen werden nacheinander geholt und unabhängig voneinander am Edge gecacht. O3b schreibt sie deshalb unter unveränderlichen Generations-Keys und aktiviert den Pointer erst nach Payloads, Manifest und Legacy-Kopien. Jede Antwort nennt ihre belegte Cache-Generation; die erste brauchbare legt sie fest, eine neuere wird übernommen, eine ältere verworfen. Eine Lease schützt parallele Writer; die Pointer-Aktivierung prüft den Lease-Besitz atomar. Aktive und vorherige Generation bleiben lesbar, und Bytebudgets entfernen bei Bedarf deterministisch die ältesten Artikel. Einzelheiten und Rollback: [Generationsgebundener Publish](docs/deployment/news-generations.md).

---

### Admin-Panel: Die Logik des "Health Check"

Das "Health Center" im Admin-Panel ist ein intelligentes **Berichtssystem**, das den Zustand des letzten automatischen Backend-Laufs anzeigt. Es führt **keinen Live-Check** der Feeds aus Ihrem Browser durch.

Es basiert auf dem Abgleich von zwei Datensätzen, die vom "Datensammler" im Vercel KV Store abgelegt und über die API (`/api/get-health-data`) bereitgestellt werden:

1.  **`feed_health_status`**: Ein Protokoll. Hat das Skript den Feed erfolgreich abgerufen und geparst? (`status: "success"`) Oder gab es einen Fehler? (`status: "error"`).
2.  **Aktives Snapshot-Manifest**: Die gebundene Quellenliste der Generation,
    die tatsächlich von den News-Endpunkten ausgeliefert wird. Fehlt noch eine
    Generation oder läuft ein Legacy-Rollback, dient `news_cache` als Fallback.

Die Statusanzeige wird wie folgt ermittelt:

*   **Status: OK (Grün)**: Der Feed hat im `feed_health_status` den Status `success` **UND** die Quelle steht im aktiven Snapshot.
*   **Status: Warnung (Gelb)**: Der Feed hat den Status `success`, **ABER** die Quelle steht nicht im aktiven Snapshot. (Mögliche Gründe: Feed ist leer, Name stimmt nicht überein, etc.)
*   **Status: Fehler (Rot)**: Der Feed hat im `feed_health_status` den Status `error`. (Mögliche Gründe: URL nicht erreichbar, XML-Fehler, etc.)

#### Cron-Heartbeat: Wann ist ein grüner Status trotzdem alt?

Diese Feed-Tabelle beschreibt immer nur den **letzten** Lauf – auch wenn dieser
Lauf Stunden zurückliegt. Darüber steht deshalb der Heartbeat, der drei Fragen
getrennt beantwortet:

*   **Letzter Lauf**: Hat der Workflow überhaupt noch gestartet, und mit welchem Ergebnis – `abgeschlossen`, `eingeschränkt` oder `abgebrochen`? (`feed_run_status`)
*   **Letzter Kern-Publish**: Wurden die News-Caches wirklich geschrieben?
*   **Inhaltsfrische**: Wann hat zuletzt mindestens ein Feed überhaupt Artikel geliefert?

Die Inhaltsfrische sagt bewusst **nicht**, ob darunter *neue* Artikel waren – ein
unveränderter, aber technisch einwandfreier Feed hält sie grün. Eine
Novelty-Erkennung ist nicht Teil dieser Stufe.

Als **veraltet** gilt alles, was älter als 50 Minuten ist (`FEED_STALE_AFTER_MS`
in `shared/feed-health-model.js`); ein Zeitstempel mehr als 2 Minuten in der
Zukunft gilt als ungültig und nie als frisch. Ein fehlgeschlagener Lauf
überschreibt weder den letzten Kern-Publish noch das `lastSuccessAt` eines Feeds.

Ein **eingeschränkter** Lauf (`degraded`) ist kein Fehler: der Kern-Publish hat
stattgefunden, aber Arbeit wurde wegen der Laufdeadline oder des Scrape-Budgets
zurückgestellt. Der Grund steht direkt darunter im Panel.

Datenformate, Grenzfälle und Betriebshinweise stehen in der
[Heartbeat-Dokumentation](docs/deployment/feed-heartbeat.md).

---

## 🚀 Lokale Installation und Ausführung

### Voraussetzungen

- [Node.js](https://nodejs.org/) (Version 24; dieselbe Hauptversion wie CI und Vercel)
- [npm](https://www.npmjs.com/)
- Ein Vercel-Konto mit verbundenem Vercel Postgres und Vercel KV Speicher.
- (Optional) Groq API Key für Trend-Analyse

### Installationsschritte

1.  **Repository klonen**:
    ```bash
    git clone https://github.com/DEIN_BENUTZERNAME/gamerfeed-main.git
    cd gamerfeed-main
    ```

2.  **Abhängigkeiten installieren**:
    ```bash
    npm install
    ```
    Dies installiert automatisch alle benötigten Pakete aus `package.json`, inklusive:
    - React, Vite, TypeScript
    - Tailwind CSS, PostCSS, Autoprefixer
    - i18next für Mehrsprachigkeit
    - und weitere Dev-Dependencies

3.  **Umgebungsvariablen einrichten**:
    Erstelle eine Datei namens `.env` im Hauptverzeichnis des Projekts und füge die folgenden Variablen von deinem Vercel-Projekt hinzu.

    ```env
    # Verbindung zur Vercel Postgres-Datenbank
    POSTGRES_URL="postgres://..."

    # Verbindungen zum Vercel KV Store
    KV_REST_API_URL="https://..."
    KV_REST_API_TOKEN="..."

    # Groq API für Trend-Analyse (optional)
    GROQ_API_KEY="gsk_..."

    # Optionaler Feed-Fallback für einen manuellen lokalen Cache-Lauf.
    # In Produktion ist dies ein GitHub Actions Secret, keine Vercel-Variable.
    FEED_PROXY_URL="https://proxy.example/feed-proxy.php"

    # Zwingende Anmeldedaten für Admin-Seite und Admin-APIs
    ADMIN_USERNAME="dein_admin_benutzername"
    ADMIN_PASSWORD="dein_sicheres_passwort"

    # Kontaktformular: reCAPTCHA v3 und Gmail SMTP
    RECAPTCHA_SECRET_KEY="dein_recaptcha_secret_key"
    GMAIL_USER="deine-adresse@gmail.com"
    GMAIL_APP_PASSWORD="dein_google_app_passwort"

    # Optional; lokal inklusive localhost, in Produktion nur produktive Domains
    RECAPTCHA_ALLOWED_HOSTNAMES="localhost,gamerfeed.vercel.app"
    ```

4.  **Entwicklungsserver starten**:
    ```bash
    npm run dev
    ```

    Für das vollständige Admin-Panel inklusive Middleware und API-Routen verwende:
    ```bash
    vercel dev
    ```

5.  **Anwendung öffnen**:
    - Die Hauptanwendung ist unter `http://localhost:3000` erreichbar.
    - Das Admin-Panel findest du mit `vercel dev` unter `/admin.html`.

### Build für Production

```bash
npm run build
```

Dies erstellt einen optimierten Production-Build im `dist/`-Ordner:
- **Tailwind CSS**: Nur tatsächlich genutzte Klassen landen im Build
- **JavaScript**: Minifiziert und tree-shaked
- **Keine CDN-Abhängigkeiten für das App-Bundle**: Alle Bibliotheken werden lokal gebündelt. Zur Laufzeit werden weiterhin externe Dienste angesprochen: reCAPTCHA v3 lädt sein Skript von Google nach, dazu kommen die Backend-Dienste (Vercel KV, Neon PostgreSQL, Groq, Gmail SMTP).

### Tests und Qualitätsprüfung

Alle Tests liegen zentral unter `tests/` und sind dort nach Fachbereich sowie Testart gegliedert:

```text
tests/
├── e2e/
├── feeds/
│   ├── unit/
│   └── integration/
├── frontend/
│   ├── helpers/
│   └── unit/
└── server/
    └── unit/
```

```bash
npm test             # alle Tests
npm run test:feeds   # nur Feed-Tests für den Cron-Job
npm run typecheck    # TypeScript prüfen
npm run build        # Produktions-Build prüfen
```

Der Workflow `.github/workflows/ci.yml` führt bei Pull Requests und Pushes auf
`main` den PHP-Syntaxcheck für den Feed-Proxy, alle Tests, die
TypeScript-Prüfung und den Produktions-Build aus. Der Feed-Cron nutzt zusätzlich
die fokussierte Suite `test:feeds`. Die Tests sind kein separates Projekt und
werden nicht in den Frontend-Build importiert.

Die priorisierte technische Weiterentwicklung und die Abnahmekriterien der
einzelnen Arbeitspakete stehen in der
[Projekt-Roadmap](docs/development/roadmap.md). Sie ist eine Planungsgrundlage,
keine Aufforderung, mehrere Punkte gleichzeitig umzusetzen.

### Manuelles Aktualisieren des Caches

Um den Vercel KV Cache lokal zu aktualisieren, führe das Fetch-Skript aus. Es liest automatisch die Variablen aus deiner `.env`-Datei.
```bash
node scripts/fetch-feeds.js
```

---

## ☁️ Deployment auf Vercel

1.  **Projekt importieren**: Importiere dein geklontes Git-Repository in Vercel.
2.  **Datenbanken verbinden**: Verknüpfe dein Vercel-Projekt mit einer Vercel Postgres-Datenbank und einem Vercel KV Store.
3.  **Umgebungsvariablen konfigurieren**: Füge im Vercel-Projekt-Dashboard die von Frontend und API benötigten Variablen hinzu. Für das Kontaktformular werden zusätzlich `RECAPTCHA_SECRET_KEY`, `GMAIL_USER` und `GMAIL_APP_PASSWORD` benötigt. Mit `RECAPTCHA_ALLOWED_HOSTNAMES` kann die reCAPTCHA-Antwort auf die produktiven Domains eingeschränkt werden. `FEED_PROXY_URL` gehört ausschließlich zu GitHub Actions beziehungsweise zu einem manuellen lokalen Cache-Lauf, nicht zu Vercel.

Für einen späteren Wechsel auf eine eigene Domain gibt es eine vollständige
[Custom-Domain-Checkliste](docs/deployment/custom-domain.md).

Produktive Änderungen laufen ausschließlich über den dokumentierten
[Pull-Request- und Release-Prozess](docs/deployment/release-process.md).

### 4. GitHub Actions einrichten

Der automatische Abruf der Nachrichten (`fetch-feeds.js`) wird von GitHub Actions ausgeführt, nicht von Vercel. Daher muss GitHub Zugriff auf die Vercel-Datenbanken haben. Dies geschieht über "Secrets".

**🚨 WICHTIG: Ohne diesen Schritt wird die App keine neuen Nachrichten laden und der automatische Prozess wird fehlschlagen!** Der Fehler `Missing required environment variables` in deinen Action-Logs ist ein direktes Symptom für fehlende Secrets.

Diese Schlüssel werden **NICHT** in eine Datei im Projekt geschrieben. Sie werden sicher in den GitHub-Einstellungen deines Repositories gespeichert.

#### Schritt-für-Schritt-Anleitung:

1.  Gehe zu deinem GitHub-Repository.
2.  Klicke auf `Settings` (Einstellungen) > `Secrets and variables` (Geheimnisse und Variablen) > `Actions`.
3.  Klicke auf den Button `New repository secret`, um die folgenden Secrets **exakt wie benannt** zu erstellen.
4.  Die Datenbank- und KV-Werte findest du im Vercel-Projekt-Dashboard unter `Settings` > `Environment Variables`. Die Proxy-Adresse stammt vom externen PHP-Hosting.

| Secret-Name in GitHub           | Quelle/Wert                                     | Zweck                                           |
| ------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| `POSTGRES_URL`                  | Der Wert von `POSTGRES_URL` aus Vercel          | Verbindung zur Feed-Liste in Postgres           |
| `KV_REST_API_URL`               | Der Wert von `KV_REST_API_URL` aus Vercel       | Verbindung zum News-Cache (KV Store)            |
| `KV_REST_API_TOKEN`             | Der Wert von `KV_REST_API_TOKEN` aus Vercel     | Passwort für den News-Cache (KV Store)          |
| `GROQ_API_KEY`                  | Dein Groq API Key                               | KI-Trend-Analyse (optional)                     |
| `FEED_PROXY_URL`                | HTTPS-Adresse von `tools/feed-proxy.php`         | Optionaler Fallback für blockierte Feed-Quellen |

**Hinweis:** Andere von Vercel bereitgestellte Variablen wie `VERCEL_URL` werden für diesen Workflow nicht benötigt.

Der Proxy ist ein separat und manuell betriebener Produktionsbestandteil. Vor
dem Setzen des Secrets die
[Feed-Proxy-Betriebsanleitung](docs/deployment/feed-proxy.md) vollständig
abarbeiten.

Der Workflow (`.github/workflows/update-feeds.yml`) wird nun alle 20 Minuten automatisch ausgeführt und hält deine Live-Daten aktuell.

---

## 🚨 Fehlerbehebung (Troubleshooting)

### Fehler: `Missing required environment variables KV_REST_API_URL and KV_REST_API_TOKEN`

Dieser Fehler tritt im GitHub Actions Log auf und ist der häufigste Konfigurationsfehler.

*   **Ursache:** Das `fetch-feeds.js`-Skript, das von GitHub ausgeführt wird, hat keine Zugangsdaten, um sich mit deinem Vercel KV Store zu verbinden.
*   **Lösung:** Befolge die Schritte unter **"GitHub Actions einrichten"** sorgfältig. Stelle sicher, dass du die Secrets `KV_REST_API_URL` und `KV_REST_API_TOKEN` in den GitHub-Einstellungen deines Repositories korrekt angelegt hast. Die Namen müssen exakt übereinstimmen.

### Lokale API-Aufrufe

*   `npm run dev` leitet `/api` über den Vite-Proxy an die produktive GamerFeed-API weiter. Progressive Loading funktioniert damit gegen die produktiven Daten.
*   `vercel dev` führt die lokalen Serverless Functions aus und ist nötig, wenn Änderungen an API-Routen wie `/api/contact` lokal geprüft werden sollen.

---

## 📊 Technologie-Stack

- **Frontend**: React 19, TypeScript (Strict Mode), Tailwind CSS
- **Build Tool**: Vite 8 (Rolldown)
- **Internationalisierung**: i18next
- **Backend**: Vercel Functions (Edge und Node.js)
- **Datenbank**: Neon PostgreSQL (oder Vercel Postgres)
- **Cache**: Vercel KV (Redis)
- **CI/CD**: GitHub Actions
- **KI**: Groq API (llama-3.1-8b-instant)
- **Deployment**: Vercel


---

## 🤝 Beitragen

Contributions sind willkommen! Erstelle gerne Pull Requests oder öffne Issues für Verbesserungsvorschläge.

---


