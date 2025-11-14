
# GamerFeed - Ein Moderner Gaming-News-Aggregator

GamerFeed ist ein schlanker und moderner News-Aggregator, der die neuesten Nachrichten aus der Welt der Videospiele von zahlreichen deutsch- und englischsprachigen Quellen bündelt. Die Anwendung ist als schnelle, responsive und hochgradig anpassbare Single-Page-Application (SPA) konzipiert.

## ✨ Hauptfunktionen

- **Umfassende Nachrichten-Aggregation**: Sammelt Artikel aus einer Vielzahl von RSS-Feeds.
- **Moderne Benutzeroberfläche**: Ein sauberes, responsives Design, gebaut mit React und Tailwind CSS.
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
- **Automatische Aktualisierung**: Ein GitHub-Action-Workflow aktualisiert den News-Cache alle 30 Minuten, sodass die angezeigten Nachrichten immer aktuell sind.
- **Admin-Panel**: Ein passwortgeschütztes Admin-Panel zur einfachen Verwaltung der Feed-Quellen und zur Überwachung ihres Status.

---

## 🛠️ Architektur & Kernlogik

Dieses Projekt nutzt eine entkoppelte, "serverless" Architektur, die auf maximale Skalierbarkeit, geringe Wartung und Kosteneffizienz ausgelegt ist. Es ist entscheidend, die Rollen der einzelnen Komponenten zu verstehen.

### Systemkomponenten

1.  **Frontend (React & Vite)**: Eine statische Single-Page-Application, die beim Start die Artikel dynamisch von einem API-Endpunkt (`/api/get-news`) abruft. Alle Benutzereinstellungen werden im `localStorage` gespeichert.
2.  **Datenbank (Vercel Postgres)**: Eine serverless Postgres-Datenbank, die ausschließlich die Liste der zu verarbeitenden RSS-Feed-Quellen speichert.
3.  **Datencache (Vercel KV)**: Ein extrem schneller In-Memory-Datenspeicher, der die gecachten Artikel (`news_cache`) und den Systemstatus (`feed_health_status`) für den schnellen Abruf durch die API bereithält.
4.  **Datenerfassung (GitHub Actions Cron Job)**: Ein Node.js-Skript (`scripts/fetch-feeds.js`), das alle 30 Minuten automatisch über einen GitHub-Workflow ausgeführt wird. Es ist das Herzstück der Datenaktualisierung.
5.  **API-Schicht (Vercel Edge Functions)**: Schlanke API-Endpunkte, die als Schnittstelle zwischen dem Frontend und dem Datencache (Vercel KV) dienen.
    *   `/api/get-news`: Liefert die gecachten Artikel an die Hauptanwendung.
    *   `/api/feeds`: Dient dem Admin-Panel zur Verwaltung der Feed-Quellen in der Postgres-Datenbank.
    *   `/api/get-health-data`: Liefert den Systemstatus an das Admin-Panel.
6.  **Admin-Backend (Middleware)**: Eine Middleware (`middleware.js`) sichert das Admin-Panels über Basic Authentication ab.

---

### Entkoppelte Architektur: Wie Updates skalieren, ohne Deployments auszulösen

Eines der wichtigsten Konzepte dieses Projekts ist die **Entkopplung von Inhalts-Updates und Website-Deployments**. Dies ermöglicht häufige Aktualisierungen, ohne die Limits von Hosting-Plattformen (z. B. 100 Deployments/Tag bei Vercel) zu überschreiten.

#### 1. Der Datensammler (GitHub Actions Cron Job)

*   **Aufgabe:** Alle 30 Minuten die neuesten Nachrichten sammeln und im zentralen Cache ablegen.
*   **Ablauf:**
    1.  Der GitHub-Workflow (`.github/workflows/update-feeds.yml`) startet das `fetch-feeds.js`-Skript.
    2.  Das Skript holt die Feed-Liste aus der Postgres-Datenbank.
    3.  Es ruft jeden Feed ab, verarbeitet die Artikel und generiert zwei Datensätze:
        *   Den `news-cache`: Eine bereinigte und sortierte Liste der Artikel.
        *   Den `feed-health-status`: Ein Protokoll über den Erfolg oder Misserfolg jedes Feed-Abrufs.
    4.  Anschließend schreibt das Skript diese beiden Datensätze in den **Vercel KV Store**.
*   **WICHTIG:** Der Workflow committet **keine Dateien** mehr in das Git-Repository. Der Prozess ist vollständig vom Code der Webseite getrennt.

#### 2. Der Datenabruf (Frontend-Anwendung)

*   **Aufgabe:** Dem Benutzer immer die aktuellsten, im Cache verfügbaren Nachrichten anzeigen.
*   **Ablauf:**
    1.  Wenn ein Benutzer die GamerFeed-Webseite lädt, startet die React-Anwendung.
    2.  Die Anwendung sendet eine Anfrage an den API-Endpunkt `/api/get-news`.
    3.  Die Vercel Edge Function, die diesen Endpunkt bedient, liest den `news-cache` blitzschnell aus dem Vercel KV Store.
    4.  Die Artikel werden als JSON an das Frontend zurückgegeben und angezeigt.
*   **Ergebnis:** Die angezeigten Daten sind immer so aktuell wie der letzte Lauf des "Datensammlers", ohne dass dafür ein neues Deployment der gesamten Seite notwendig war. Dies ist extrem effizient und skalierbar.

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

- [Node.js](https://nodejs.org/) (Version 20 oder höher)
- [npm](https://www.npmjs.com/)
- Ein Vercel-Konto mit verbundenem Vercel Postgres und Vercel KV Speicher.

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

3.  **Umgebungsvariablen einrichten**:
    Erstelle eine Datei namens `.env` im Hauptverzeichnis des Projekts und füge die folgenden Variablen von deinem Vercel-Projekt hinzu.

    ```env
    # Verbindung zur Vercel Postgres-Datenbank
    POSTGRES_URL="postgres://..."

    # Verbindungen zum Vercel KV Store
    KV_URL="redis://..."
    KV_REST_API_URL="https://..."
    KV_REST_API_TOKEN="..."
    KV_REST_API_READ_ONLY_TOKEN="..."

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

### Manuelles Aktualisieren des Caches

Um den Vercel KV Cache lokal zu aktualisieren, führe das Fetch-Skript aus. Es liest automatisch die Variablen aus deiner `.env`-Datei.
```bash
node scripts/fetch-feeds.js
```

---

## ☁️ Deployment auf Vercel

1.  **Projekt importieren**: Importiere dein geklontes Git-Repository in Vercel.
2.  **Datenbanken verbinden**: Verknüpfe dein Vercel-Projekt mit einer Vercel Postgres-Datenbank und einem Vercel KV Store.
3.  **Umgebungsvariablen konfigurieren**: Füge im Vercel-Projekt-Dashboard die oben genannten Umgebungsvariablen (`POSTGRES_URL`, `KV_*`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`) hinzu.
4.  **GitHub Actions einrichten**:
    - Damit der automatische Workflow funktioniert, musst du alle `POSTGRES_` und `KV_` Variablen auch in deinem GitHub-Repository als "Secrets" hinterlegen.
    - Gehe zu `Settings` > `Secrets and variables` > `Actions`.
    - Erstelle für jede Variable ein "Repository secret" mit dem exakt gleichen Namen.

Der Workflow (`.github/workflows/update-feeds.yml`) wird nun alle 30 Minuten automatisch ausgeführt und hält deine Live-Daten aktuell.
