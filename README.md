

# GamerFeed - Ein Moderner Gaming-News-Aggregator

GamerFeed ist ein schlanker und moderner News-Aggregator, der die neuesten Nachrichten aus der Welt der Videospiele von zahlreichen deutsch- und englischsprachigen Quellen bündelt. Die Anwendung ist als schnelle, responsive und hochgradig anpassbare Single-Page-Application (SPA) konzipiert.

## ✨ Hauptfunktionen

- **Umfassende Nachrichten-Aggregation**: Sammelt Artikel aus einer Vielzahl von RSS-Feeds.
- **Moderne Benutzeroberfläche**: Ein sauberes, responsives Design, gebaut mit React und Tailwind CSS (lokal gebaut, keine CDN-Abhängigkeit).
- **⚡ Blitzschnelles Progressive Loading**: 3-stufiges Laden der Artikel für sofortige Anzeige (16 → 64 → alle Artikel).
- **🔄 Auto-Update mit Live-Benachrichtigungen**: 
    - Automatische Prüfung auf neue Artikel alle 5 Minuten
    - Tab-Titel zeigt Anzahl neuer Artikel: `(5) GamerFeed`
    - Badge am Refresh-Button mit Puls-Animation
    - Toast-Benachrichtigung mit Swipe-to-Dismiss (links oder hoch wischen)
- **Mehrsprachigkeit**: Vollständig übersetzbar mit i18next. Erkennt automatisch die Browsersprache des Nutzers (Deutsch/Englisch) und merkt sich die Auswahl.
- **Anpassbare Ansicht**:
    - **Themes**: Wähle zwischen Light- und Dark-Mode.
    - **Layouts**: Grid-, Listen- oder Kompaktansicht für Artikel.
- **Personalisierung**:
    - **Favoriten**: Speichere interessante Artikel, um sie später zu lesen.
    - **Quellen stummschalten**: Blende Nachrichten von Quellen aus, die dich nicht interessieren.
    - **Gespeicherte Suchen**: Speichere häufige Suchanfragen für schnellen Zugriff.
- **Leistungsstarke Filter & Suche**:
    - Filtere Artikel nach Zeitraum (Heute, Gestern, Letzte 7 Tage).
    - Filtere nach spezifischer Quelle oder Sprache (DE/EN).
    - Volltextsuche in Titeln und Zusammenfassungen.
- **Automatische Aktualisierung**: Ein GitHub-Action-Workflow aktualisiert den News-Cache alle 20 Minuten, sodass die angezeigten Nachrichten immer aktuell sind.
- **🤖 KI-gestützte Trend-Analyse**: Automatische Erkennung aktueller Gaming-Trends mit Groq AI (tägliche und wöchentliche Trends). Intelligente Deduplizierung von Artikeln gleicher Verlagsgruppen für akkuratere Trend-Berechnung.
- **♿ Barrierefreiheit**: Focus-Ring nur bei Tastatur-Navigation sichtbar (nicht bei Mausklicks).
- **Admin-Panel**: Ein passwortgeschütztes Admin-Panel zur einfachen Verwaltung der Feed-Quellen, Überwachung ihres Status und Veröffentlichung von Ankündigungen.
- **📢 Ankündigungs-Banner**: Admins können wichtige Nachrichten (Info, Warnung, Wartung, Feier) als Banner für alle Benutzer anzeigen. Benutzer können Banner schließen (wird im localStorage gespeichert).

---

## ⚡ Performance-Optimierung: Progressive Loading

GamerFeed nutzt eine innovative 3-stufige Lade-Strategie, um eine sofortige Anzeige von Inhalten zu gewährleisten:

### Wie es funktioniert:

1. **Stage 1 (Sofort)**: Die ersten 16 Artikel werden geladen und sofort angezeigt (~5KB)
2. **Stage 2 (0.3-0.5s)**: 64 Artikel werden nachgeladen (~20KB)
3. **Stage 3 (1-2s)**: Alle verbleibenden Artikel werden im Hintergrund geladen (~100KB)

### Technische Umsetzung:

Der Cron-Job speichert drei optimierte Cache-Versionen in Vercel KV:
- `news_cache_16`: Erste 16 Artikel für instant loading
- `news_cache_64`: Erste 64 Artikel für schnelles nachladen
- `news_cache`: Alle Artikel für vollständige Darstellung

**Ergebnis**: Der Nutzer sieht Inhalte sofort, ohne auf das Laden aller 10.000+ Artikel warten zu müssen.

---

## 🛠️ Architektur & Kernlogik

Dieses Projekt nutzt eine entkoppelte, "serverless" Architektur, die auf maximale Skalierbarkeit, geringe Wartung und Kosteneffizienz ausgelegt ist. Es ist entscheidend, die Rollen der einzelnen Komponenten zu verstehen.

### 💡 Free-Tier-Strategie

Das Projekt ist so konzipiert, dass es vollständig im kostenlosen Kontingent verschiedener Anbieter betrieben werden kann:

| Dienst | Anbieter | Zweck |
|--------|----------|-------|
| Hosting & Edge Functions | Vercel (Free) | Frontend + API |
| PostgreSQL Datenbank | Neon (Free) | Feed-Quellen speichern |
| Redis Cache | Vercel KV (Free) | Artikel-Cache |
| Cron Jobs | GitHub Actions (Free) | Automatische Updates |
| KI-Analyse | Groq (Free) | Trend-Erkennung |

### Systemkomponenten

1.  **Frontend (React & Vite)**: Eine statische Single-Page-Application, die beim Start die Artikel dynamisch von API-Endpunkten abruft. Nutzt Progressive Loading für sofortige Content-Anzeige. Alle Benutzereinstellungen werden im `localStorage` gespeichert.
2.  **Datenbank (Neon PostgreSQL)**: Eine serverless Postgres-Datenbank, die ausschliesslich die Liste der zu verarbeitenden RSS-Feed-Quellen speichert. Alternativ kann auch Vercel Postgres verwendet werden.
3.  **Datencache (Vercel KV)**: Ein extrem schneller In-Memory-Datenspeicher, der mehrere optimierte Caches bereithält. **Artikel werden 60 Tage (2 Monate) gespeichert** (max. 10.000), ältere werden automatisch entfernt.
    - `news_cache`: Alle Artikel (vollständig)
    - `news_cache_16`: Erste 16 Artikel (Preview)
    - `news_cache_64`: Erste 64 Artikel (Medium)
    - `feed_health_status`: Systemstatus
    - `daily_trends` & `weekly_trends`: KI-generierte Trends
4.  **Datenerfassung (GitHub Actions Cron Job)**: Ein Node.js-Skript (`scripts/fetch-feeds.js`), das alle 20 Minuten automatisch über einen GitHub-Workflow ausgeführt wird. Es ist das Herzstück der Datenaktualisierung.
5.  **API-Schicht (Vercel Edge Functions)**: Schlanke API-Endpunkte als Schnittstelle zwischen Frontend und Datencache:
    *   `/api/get-news-preview`: Liefert erste 16 Artikel für sofortiges Laden
    *   `/api/get-news-medium`: Liefert erste 64 Artikel für schnelles Nachladen
    *   `/api/get-news`: Liefert alle gecachten Artikel
    *   `/api/feeds`: Dient dem Admin-Panel zur Verwaltung der Feed-Quellen
    *   `/api/get-health-data`: Liefert den Systemstatus an das Admin-Panel
    *   `/api/announcement`: Verwaltung und Abruf von Ankündigungen
    *   `/api/trends`: Liefert KI-generierte Trends
6.  **Admin-Backend (Middleware)**: Eine Middleware (`middleware.js`) sichert das Admin-Panels über Basic Authentication ab.
7.  **KI-Integration (Groq API)**: Automatische Trend-Analyse mit Groq's llama-3.1-8b-instant Modell für Gaming-News.

---

### Entkoppelte Architektur: Wie Updates skalieren, ohne Deployments auszulösen

Eines der wichtigsten Konzepte dieses Projekts ist die **Entkopplung von Inhalts-Updates und Website-Deployments**. Dies ermöglicht häufige Aktualisierungen, ohne die Limits von Hosting-Plattformen (z. B. 100 Deployments/Tag bei Vercel) zu überschreiten.

#### 1. Der Datensammler (GitHub Actions Cron Job)

*   **Aufgabe:** Alle 20 Minuten die neuesten Nachrichten sammeln und im zentralen Cache ablegen.
*   **Ablauf:**
    1.  Der GitHub-Workflow (`.github/workflows/update-feeds.yml`) startet das `fetch-feeds.js`-Skript.
    2.  Das Skript holt die Feed-Liste aus der Postgres-Datenbank.
    3.  Es ruft jeden Feed ab, verarbeitet die Artikel und generiert mehrere Datensätze:
        *   `news_cache`: Vollständige Liste aller Artikel
        *   `news_cache_16`: Erste 16 Artikel (für Progressive Loading)
        *   `news_cache_64`: Erste 64 Artikel (für Progressive Loading)
        *   `feed_health_status`: Protokoll über Erfolg/Misserfolg der Feed-Abrufe
        *   `daily_trends` & `weekly_trends`: KI-generierte Trend-Analysen
    4.  Anschliessend schreibt das Skript diese Datensätze in den **Vercel KV Store**.
*   **WICHTIG:** Der Workflow committet **keine Dateien** mehr in das Git-Repository. Der Prozess ist vollständig vom Code der Webseite getrennt.
*   **Robustheit:** Der Prozess ist robust gestaltet und verhindert zuverlässig den Verlust von bestehenden Artikeldaten durch fehlerhafte Abrufe.

#### 2. Der Datenabruf (Frontend-Anwendung)

*   **Aufgabe:** Dem Benutzer blitzschnell die aktuellsten Nachrichten anzeigen.
*   **Ablauf (Progressive Loading):**
    1.  Die React-Anwendung sendet beim Start eine Anfrage an `/api/get-news-preview`.
    2.  Die ersten 16 Artikel werden sofort angezeigt (Stage 1).
    3.  Im Hintergrund wird `/api/get-news-medium` aufgerufen und 64 Artikel geladen (Stage 2).
    4.  Danach wird `/api/get-news` aufgerufen und alle Artikel geladen (Stage 3).
*   **Ergebnis:** Der Nutzer sieht Inhalte sofort, ohne Wartezeit. Die Daten sind immer so aktuell wie der letzte Cron-Job-Lauf.

---

### Admin-Panel: Die Logik des "Health Check"

Das "Health Center" im Admin-Panel ist ein intelligentes **Berichtssystem**, das den Zustand des letzten automatischen Backend-Laufs anzeigt. Es führt **keinen Live-Check** der Feeds aus Ihrem Browser durch.

Es basiert auf dem Abgleich von zwei Datensätzen, die vom "Datensammler" im Vercel KV Store abgelegt und über die API (`/api/get-health-data`) bereitgestellt werden:

1.  **`feed_health_status`**: Ein Protokoll. Hat das Skript den Feed erfolgreich abgerufen und geparst? (`status: "success"`) Oder gab es einen Fehler? (`status: "error"`).
2.  **`news_cache`**: Die finale Liste aller Artikel, die tatsächlich auf der Live-Seite angezeigt werden.

Die Statusanzeige wird wie folgt ermittelt:

*   **Status: OK (Grün)**: Der Feed hat im `feed_health_status` den Status `success` **UND** es gibt Artikel von dieser Quelle im `news_cache`.
*   **Status: Warnung (Gelb)**: Der Feed hat den Status `success`, **ABER** es gibt **keine** Artikel von dieser Quelle im `news_cache`. (Mögliche Gründe: Feed ist leer, Name stimmt nicht überein, etc.)
*   **Status: Fehler (Rot)**: Der Feed hat im `feed_health_status` den Status `error`. (Mögliche Gründe: URL nicht erreichbar, XML-Fehler, etc.)

---

## 🚀 Lokale Installation und Ausführung

### Voraussetzungen

- [Node.js](https://nodejs.org/) (Version 24 oder höher)
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

    # Anmeldedaten für das Admin-Panel (/admin.html)
    ADMIN_USERNAME="dein_admin_benutzername"
    ADMIN_PASSWORD="dein_sicheres_passwort"
    ```

4.  **Entwicklungsserver starten**:
    ```bash
    npm run dev
    ```

5.  **Anwendung öffnen**:
    - Die Hauptanwendung ist unter `http://localhost:3000` erreichbar.
    - Das Admin-Panel findest du unter `http://localhost:3000/admin.html`.

### Build für Production

```bash
npm run build
```

Dies erstellt einen optimierten Production-Build im `dist/`-Ordner:
- **Tailwind CSS**: Nur genutzte Klassen werden inkludiert (~65KB statt ~300KB CDN)
- **JavaScript**: Minifiziert und tree-shaked
- **Keine externe Abhängigkeiten**: Alles wird lokal gebündelt

### Manuelles Aktualisieren des Caches

Um den Vercel KV Cache lokal zu aktualisieren, führe das Fetch-Skript aus. Es liest automatisch die Variablen aus deiner `.env`-Datei.
```bash
node scripts/fetch-feeds.js
```

---

## ☁️ Deployment auf Vercel

1.  **Projekt importieren**: Importiere dein geklontes Git-Repository in Vercel.
2.  **Datenbanken verbinden**: Verknüpfe dein Vercel-Projekt mit einer Vercel Postgres-Datenbank und einem Vercel KV Store.
3.  **Umgebungsvariablen konfigurieren**: Füge im Vercel-Projekt-Dashboard die oben genannten Umgebungsvariablen (`POSTGRES_URL`, `KV_*`, `GROQ_API_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`) hinzu.

### 4. GitHub Actions einrichten

Der automatische Abruf der Nachrichten (`fetch-feeds.js`) wird von GitHub Actions ausgeführt, nicht von Vercel. Daher muss GitHub Zugriff auf die Vercel-Datenbanken haben. Dies geschieht über "Secrets".

**🚨 WICHTIG: Ohne diesen Schritt wird die App keine neuen Nachrichten laden und der automatische Prozess wird fehlschlagen!** Der Fehler `Missing required environment variables` in deinen Action-Logs ist ein direktes Symptom für fehlende Secrets.

Diese Schlüssel werden **NICHT** in eine Datei im Projekt geschrieben. Sie werden sicher in den GitHub-Einstellungen deines Repositories gespeichert.

#### Schritt-für-Schritt-Anleitung:

1.  Gehe zu deinem GitHub-Repository.
2.  Klicke auf `Settings` (Einstellungen) > `Secrets and variables` (Geheimnisse und Variablen) > `Actions`.
3.  Klicke auf den Button `New repository secret`, um die folgenden Secrets **exakt wie benannt** zu erstellen.
4.  Die Werte für die Secrets findest du in deinem Vercel-Projekt-Dashboard unter `Settings` > `Environment Variables`. Kopiere sie von dort.

| Secret-Name in GitHub           | Wert aus Vercel-Projekt                         | Zweck                                           |
| ------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| `POSTGRES_URL`                  | Der Wert von `POSTGRES_URL`                     | Verbindung zur Feed-Liste in Postgres           |
| `KV_REST_API_URL`               | Der Wert von `KV_REST_API_URL`                  | Verbindung zum News-Cache (KV Store)            |
| `KV_REST_API_TOKEN`             | Der Wert von `KV_REST_API_TOKEN`                | Passwort für den News-Cache (KV Store)          |
| `GROQ_API_KEY`                  | Dein Groq API Key                               | KI-Trend-Analyse (optional)                     |

**Hinweis:** Andere von Vercel bereitgestellte Variablen wie `VERCEL_URL` werden für diesen Workflow nicht benötigt.

Der Workflow (`.github/workflows/update-feeds.yml`) wird nun alle 20 Minuten automatisch ausgeführt und hält deine Live-Daten aktuell.

---

## 🚨 Fehlerbehebung (Troubleshooting)

### Fehler: `Missing required environment variables KV_REST_API_URL and KV_REST_API_TOKEN`

Dieser Fehler tritt im GitHub Actions Log auf und ist der häufigste Konfigurationsfehler.

*   **Ursache:** Das `fetch-feeds.js`-Skript, das von GitHub ausgeführt wird, hat keine Zugangsdaten, um sich mit deinem Vercel KV Store zu verbinden.
*   **Lösung:** Befolge die Schritte unter **"GitHub Actions einrichten"** sorgfältig. Stelle sicher, dass du die Secrets `KV_REST_API_URL` und `KV_REST_API_TOKEN` in den GitHub-Einstellungen deines Repositories korrekt angelegt hast. Die Namen müssen exakt übereinstimmen.

### Progressive Loading funktioniert nicht lokal

*   **Ursache:** Die API-Endpunkte (`/api/get-news-preview`, `/api/get-news-medium`) funktionieren nur auf Vercel oder mit `vercel dev`.
*   **Lösung:** Für lokales Testen nutze `vercel dev` statt `npm run dev`, oder teste direkt auf der Vercel Preview/Production URL.

---

## 📊 Technologie-Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS
- **Build Tool**: Vite
- **Internationalisierung**: i18next
- **Backend**: Vercel Edge Functions
- **Datenbank**: Neon PostgreSQL (oder Vercel Postgres)
- **Cache**: Vercel KV (Redis)
- **CI/CD**: GitHub Actions
- **KI**: Groq API (llama-3.1-8b-instant)
- **Deployment**: Vercel


---

## 🤝 Beitragen

Contributions sind willkommen! Erstelle gerne Pull Requests oder öffne Issues für Verbesserungsvorschläge.

---


