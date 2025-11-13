
# GamerFeed - Ein Moderner Gaming-News-Aggregator

GamerFeed ist ein schlanker und moderner News-Aggregator, der die neuesten Nachrichten aus der Welt der Videospiele von zahlreichen deutsch- und englischsprachigen Quellen bündelt. Die Anwendung ist als schnelle, responsive und hochgradig anpassbare Single-Page-Application (SPA) konzipiert.

## ✨ Hauptfunktionen

- **Umfassende Nachrichten-Aggregation**: Sammelt Artikel aus einer Vielzahl von RSS-Feeds.
- **Moderne Benutzeroberfläche**: Ein sauberes, responsives Design, gebaut mit React und Tailwind CSS.
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
- **Admin-Panel**: Ein passwortgeschütztes Admin-Panel zur einfachen Verwaltung der Feed-Quellen in der Datenbank.

---

## 🛠️ Architektur-Überblick

GamerFeed nutzt eine hybride Architektur, die auf Geschwindigkeit und Zuverlässigkeit ausgelegt ist.

1.  **Datenerfassung (Cron Job via GitHub Actions)**:
    - Alle 30 Minuten wird das Node.js-Skript `scripts/fetch-feeds.js` durch einen GitHub-Workflow ausgeführt.
    - Das Skript holt die Liste der RSS-Feeds aus einer **Vercel Postgres**-Datenbank (powered by Neon).
    - Es parst die XML-Feeds, extrahiert und bereinigt Artikeldaten, optimiert Bild-URLs und nutzt bei Bedarf einen Scraping-Fallback.
    - Die verarbeiteten Artikel werden in `public/news-cache.json` gespeichert.
    - Der Status jedes Feeds wird in `public/feed-health-status.json` protokolliert.
    - Wenn sich diese Dateien ändern, werden sie automatisch in das Git-Repository committet und gepusht.

2.  **Frontend-Anwendung (React)**:
    - Die Hauptanwendung ist eine statische React-App.
    - Beim Laden holt sie die Artikel direkt aus der statischen `news-cache.json`-Datei. Dies sorgt für extrem schnelle Ladezeiten und entlastet jegliche Server-Infrastruktur.
    - Benutzereinstellungen wie Favoriten, Theme oder stummgeschaltete Quellen werden ausschließlich im `localStorage` des Browsers gespeichert, was die Privatsphäre wahrt.

3.  **Admin-Panel (Vercel Edge)**:
    - Das Admin-Panel (`/admin.html`) ist eine separate, passwortgeschützte React-Anwendung.
    - Der Schutz wird durch **Vercel Middleware** (`middleware.js`) realisiert, die eine HTTP Basic Authentication erzwingt, bevor die Seite geladen wird.
    - Das Panel kommuniziert mit einer API (`/api/feeds.ts`), die als Vercel Edge Function läuft, um Feed-Quellen in der Postgres-Datenbank zu erstellen, zu bearbeiten oder zu löschen (CRUD).

### Warum diese Architektur?

Die Wahl der Technologien und Dienste zielt darauf ab, eine hochperformante, wartungsarme und kostengünstige Anwendung zu schaffen, die idealerweise komplett im Rahmen von Free Tiers betrieben werden kann.

-   **Vercel für das Frontend**: Vercel ist optimal für das Hosting von statischen React-Anwendungen (Vite). Es bietet ein globales CDN für blitzschnelle Ladezeiten, automatische Deployments aus Git und integrierte Edge Functions für die schlanke Admin-API – alles mit einem großzügigen kostenlosen Kontingent.

-   **Neon (via Vercel Postgres) für die Datenbank**: Die Datenbankanforderungen sind minimal – sie speichert nur die Liste der Feed-Quellen. Vercel Postgres, das auf der serverless-Architektur von **Neon** basiert, ist hierfür perfekt. Es bietet eine kostenlose Stufe, die für diesen Anwendungsfall mehr als ausreicht, und skaliert bei Bedarf automatisch.

-   **GitHub Actions für den Cron Job**: Warum nicht Vercel Cron Jobs? Vercels kostenloses Kontingent erlaubt nur eine Ausführung pro Tag. Für einen News-Aggregator, der aktuell bleiben soll, ist das zu selten. **GitHub Actions** bietet hier eine flexible und kostenlose Alternative, die es uns ermöglicht, den Feed-Update-Prozess zuverlässig alle 30 Minuten zu starten. Dieser Ansatz entkoppelt die zeitgesteuerte Datenerfassung vom Hosting-Provider und sorgt für eine robuste "serverless" Lösung.

---

## 🚀 Lokale Installation und Ausführung

Folge diesen Schritten, um das Projekt lokal auf deinem Rechner auszuführen.

### Voraussetzungen

- [Node.js](https://nodejs.org/) (Version 20 oder höher)
- [npm](https://www.npmjs.com/)

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
    Erstelle eine Datei namens `.env` im Hauptverzeichnis des Projekts und füge die folgenden Variablen hinzu. Diese werden für das Admin-Panel und die Skripte benötigt.

    ```env
    # Verbindung zur Vercel Postgres-Datenbank (powered by Neon)
    POSTGRES_URL="postgres://..."

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
    - Das Admin-Panel findest du unter `http://localhost:3000/admin.html`. Du wirst nach den in der `.env`-Datei festgelegten Anmeldedaten gefragt.

### Manuelles Aktualisieren des Caches

Um den News-Cache lokal zu aktualisieren, führe das Fetch-Skript aus:

```bash
node scripts/fetch-feeds.js
```

Dieses Skript benötigt eine gültige `POSTGRES_URL` in der `.env`-Datei.

---

## ☁️ Deployment auf Vercel

Das Projekt ist für ein Deployment auf [Vercel](https://vercel.com/) vorkonfiguriert.

1.  **Projekt importieren**: Importiere dein geklontes Git-Repository in Vercel.
2.  **Umgebungsvariablen konfigurieren**: Füge im Vercel-Projekt-Dashboard die oben genannten Umgebungsvariablen (`POSTGRES_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`) hinzu.
3.  **GitHub Actions einrichten**:
    - Damit der automatische Workflow zur Cache-Aktualisierung funktioniert, musst du die `POSTGRES_URL` auch in deinem GitHub-Repository als "Secret" hinterlegen.
    - Gehe zu `Settings` > `Secrets and variables` > `Actions`.
    - Erstelle ein neues "Repository secret" mit dem Namen `POSTGRES_URL` und füge den Verbindung-String deiner Datenbank ein.

Der Workflow (`.github/workflows/update-feeds.yml`) wird nun alle 30 Minuten automatisch ausgeführt und hält deine Live-Anwendung auf dem neuesten Stand.