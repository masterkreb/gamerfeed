# AGENTS.md - KI-Kontext für GamerFeed

> Diese Datei dient als Schnellreferenz für KI-Assistenten (GitHub Copilot, Claude, etc.)

## 📋 Projektübersicht

**GamerFeed** ist ein Gaming-News-Aggregator, der Artikel aus 15+ deutschen und englischen Quellen sammelt und übersichtlich darstellt.

- **Typ:** Single-Page-Application (SPA)
- **Status:** Produktiv auf Vercel
- **Sprache:** Deutsch (Commits, Dokumentation)

---

## 🛠️ Tech Stack

| Bereich | Technologie |
|---------|-------------|
| Frontend | React 19, TypeScript (Strict Mode), Tailwind CSS v4 |
| Build | Vite 8 (Rolldown), `build.rolldownOptions` in `vite.config.ts` |
| Laufzeit | Node.js 24.x (bewusst fixiert, auch im Workflow) |
| Styling | Tailwind CSS v4 (lokal, NICHT CDN) mit `@tailwindcss/postcss` |
| i18n | i18next (DE/EN) |
| Backend | Vercel Serverless Functions |
| Datenbank | Neon PostgreSQL (Feed-Quellen) |
| Cache | Vercel KV (Artikel, Trends, Announcements) |
| Cron | GitHub Actions (alle 20 Min) |
| Feed-Fallback | Externes PHP/cURL-Hosting (optional) |
| KI-API | Groq (llama-3.1-8b-instant) für Trends |

---

## 📁 Projektstruktur

```
├── App.tsx                 # Hauptkomponente (State, Routing, Logic)
├── index.tsx               # Entry Point
├── admin.tsx               # Admin Panel Entry
├── i18n.ts                 # Sprachkonfiguration
├── types.ts                # TypeScript Interfaces
├── middleware.js           # Admin Auth (Basic Auth)
│
├── api/                    # Vercel Serverless Functions
│   ├── get-news.ts         # Alle Artikel abrufen
│   ├── get-news-preview.ts # Erste 16 Artikel (Progressive Loading)
│   ├── get-news-medium.ts  # Erste 64 Artikel
│   ├── get-trends.ts       # KI-Trends abrufen
│   ├── get-health-data.ts  # Feed-Status für Admin
│   ├── feeds.ts            # CRUD für Feed-Quellen
│   ├── announcement.ts     # Ankündigungs-Banner CRUD
│   └── contact.ts          # Kontaktformular (Node.js + Gmail SMTP)
│
├── components/
│   ├── Header.tsx          # Navigation, Theme, Refresh, Language
│   ├── FilterBar.tsx       # Such- und Filteroptionen
│   ├── ArticleCard.tsx     # Einzelne Artikel-Darstellung
│   ├── SettingsModal.tsx   # Vier Reiter: Quellen, Rechtliches, Über uns, Kontakt
│   ├── LanguageSwitcher.tsx
│   ├── ScrollToTopButton.tsx
│   ├── TrendsView.tsx      # KI-Trend-Anzeige
│   ├── AnnouncementBanner.tsx
│   ├── FavoritesHeader.tsx
│   ├── Footer.tsx
│   ├── Icons.tsx           # SVG Icons als Komponenten
│   ├── ErrorBoundary.tsx
│   ├── ErrorFallback.tsx
│   └── admin/              # Admin-Panel Komponenten
│       ├── AdminPanel.tsx
│       ├── FeedManagementTab.tsx
│       ├── FeedFormModal.tsx
│       ├── HealthCenterTab.tsx
│       ├── HealthLegendTab.tsx
│       ├── AnnouncementTab.tsx
│       └── healthTypes.ts
│
├── contexts/
│   └── FilterContext.tsx   # Filter-State (React Context)
│
├── hooks/
│   ├── useDialogFocus.ts   # Fokusfalle, Escape, Fokus-Rückgabe für Dialoge
│   ├── useFeeds.ts         # Feed-Daten fetchen
│   └── useLocalStorage.ts  # localStorage Hook
│
├── services/
│   └── feeds-api.ts        # HTTP-Zugriff für Feed-Verwaltung
│
├── scripts/
│   ├── fetch-feeds.js      # Cron-Job Script (GitHub Actions)
│   ├── feed-fetch-utils.js # Getesteter Feed-Abruf mit Retry/Proxy-Fallback
│   ├── feed-image-utils.js # Bildauswahl und -validierung für Artikel
│   ├── feed-run-budget.js  # Zeit- und Scrape-Budget eines Laufs
│   ├── feed-run-config.js  # Core- und optionale Konfiguration des Laufs
│   ├── feed-run-recorder.js # Reihenfolge und Schreibregeln des Heartbeats
│   ├── groq-client.js      # Begrenzter Zugang zur Groq-API
│   └── limited-response.js # Begrenztes Lesen fremder HTTP-Antworten
│
├── server/                 # Getestete Backend-Hilfslogik
│   ├── admin-api.js            # Antwortbau und Rumpflesen der Admin-APIs
│   ├── announcement-handler.ts # Ankündigungen inkl. geschütztem Admin-Abruf
│   ├── feeds-handler.ts        # Feed-CRUD mit injizierbarem SQL
│   ├── health-data-handler.ts  # Feed-Status und Frischebericht für das Admin
│   └── news-cache-handler.ts   # Gemeinsame Logik der News-Endpunkte
├── shared/                 # Gemeinsame Frontend-/Backend-Verträge
│   ├── announcement-contract.js # Typen, Längengrenze und Parser
│   ├── news-snapshot.js         # Generationsgebundenes Leseprotokoll
│   ├── api-errors.js            # Stabile Fehlercodes und Cache-Vorgabe
│   └── feed-health-model.js     # Cron-Heartbeat, Frische, FEED_STALE_AFTER_MS
├── tests/                  # Zentrale Tests nach Fachbereich und Testart
├── docs/
│   ├── deployment/        # Betrieb, Release, Rollback und Domain-Anleitungen
│   └── development/
│       └── roadmap.md      # Priorisierte Arbeitspakete und Abnahmekriterien
├── tools/
│   └── feed-proxy.php      # Manuell deployter externer Feed-Fallback
│
├── src/
│   └── index.css           # Tailwind-v4-Konfiguration + Custom Styles
│
├── postcss.config.js       # PostCSS mit @tailwindcss/postcss
└── vite.config.ts          # Vite Konfiguration
```

---

## ✨ Features

### Frontend
- ✅ Dark Mode / Light Mode
- ✅ Sprachumschaltung (DE/EN) mit automatischer Browser-Erkennung
- ✅ 3 Layouts: Grid, Liste, Kompakt
- ✅ Filter: Zeitraum, Quelle, Sprache
- ✅ Volltextsuche mit gespeicherten Suchen
- ✅ Favoriten-System (localStorage)
- ✅ Quellen stummschalten (localStorage)
- ✅ Progressive Loading (16 → 64 → alle Artikel)
- ✅ Auto-Update alle 5 Min mit Badge + Tab-Titel
- ✅ Toast-Benachrichtigungen (Swipe-to-Dismiss: links/hoch)
- ✅ Scroll-to-Top Button
- ✅ Focus-Ring nur bei Tastatur-Navigation
- ✅ Ankündigungs-Banner (vom Admin gesteuert)
- ✅ Kontaktformular im Einstellungsdialog (Gmail SMTP + reCAPTCHA v3)

### Einstellungsdialog (`SettingsModal`)

Vier Reiter in einem einzigen Dialog:

| Reiter | Inhalt |
|--------|--------|
| Quellen | Quellen stummschalten, gruppiert nach Sprache, mit Sammelauswahl je Sprache |
| Rechtliches | Impressum und Datenschutzerklärung |
| Über uns | Projektbeschreibung, Funktionen, Technik |
| Kontakt | Kontaktformular |

Wichtige Eigenschaften:

- Die Komponente bleibt in `App.tsx` dauerhaft gemountet und rendert bei
  `isOpen=false` nur `null`. Der Formularzustand überlebt das Schließen.
- Alle vier Tabpanels werden gerendert; inaktive tragen `hidden`. So zeigt
  `aria-controls` nie auf eine fehlende ID, und `useDialogFocus` blendet sie
  über den `[hidden]`-Filter aus der Fokusfalle aus.
- Der Dialog ist **jederzeit** schließbar, auch während eines laufenden
  Kontakt-Versands. Ein Sperren würde den Benutzer bei einer hängenden Anfrage
  festhalten.

### Barrierefreiheit von Dialogen

`hooks/useDialogFocus.ts` ist die gemeinsame Grundlage für Admin-Formulardialog,
Admin-Löschdialog, mobilen Filterdialog und `SettingsModal`. Er liefert
Fokusfalle, initialen Fokus, Escape-Behandlung, Fokus-Rückgabe an das auslösende
Element und optional `canClose` zum Blockieren während laufender Aktionen.

Die Reiter im Einstellungsdialog sind vollwertige ARIA-Tabs: `role="tablist"`,
`role="tab"`, `aria-selected`, `aria-controls`, `role="tabpanel"`,
`aria-labelledby`, roving `tabIndex` sowie Pfeiltasten mit Umlauf, Home und End.
Die textlastigen Reiter „Rechtliches" und „Über uns" haben `tabIndex={0}`, damit
sie ohne Bedienelemente per Tastatur erreichbar und scrollbar sind.

### Kontaktformular

Integriert im Reiter „Kontakt" von `SettingsModal`, Gegenstelle ist
`api/contact.ts` (bewusst eine Node.js Function, weil Nodemailer nicht auf Edge
läuft).

- Gemeinsamer Vertrag in `shared/contact-contract.js` (Feldlängen, reCAPTCHA-Action)
- reCAPTCHA v3 wird erst beim Aktivieren des Reiters nachgeladen
- `grecaptcha.execute()` hat eine eigene Zeitgrenze; der Versand selbst
  **nicht** – eine clientseitige Grenze könnte kürzer sein als die erlaubte
  Serverlaufzeit und einen Fehler anzeigen, obwohl die Mail zugestellt wird
- Ein Wiedereintritts-Guard verhindert doppelte Übermittlung
- Erfolg wird über `role="status"` / `aria-live="polite"` angekündigt, Fehler
  über `role="alert"`, der Sendezustand über `aria-busy` am Formular
- Serverseitig: Pflichtfeld- und Längenprüfung, E-Mail-Validierung, Schutz vor
  Steuerzeichen und Header-Injection, keine Formulardaten in Logs

### Backend
- ✅ Vercel KV Cache (news_cache, news_cache_16, news_cache_64)
- ✅ 60 Tage Artikel-Retention (max. 10.000 Artikel)
- ✅ Feed Health Status Tracking mit Cron-Heartbeat und Frische-Schwelle
- ✅ Validierter Feed-Abruf mit Retry und optionalem PHP-Proxy-Fallback
- ✅ Einzelne fehlerhafte Feed-Items werden übersprungen, nicht der ganze Feed
- ✅ Alle externen Abrufe mit Abort-Timeout und Byte-Limit
- ✅ Globale Laufdeadline und Scrape-Budget mit den Zuständen `success`, `degraded`, `fatal`
- ✅ KI-Trend-Analyse (täglich + wöchentlich)
- ✅ Deduplizierung nach Verlagsgruppen (SOURCE_GROUPS)

### Admin-Panel (/admin.html)
- ✅ Basic Auth geschützt
- ✅ Feed-Verwaltung (CRUD)
- ✅ Health Center (Feed-Status, letzter Lauf, Kern-Publish, Inhaltsfrische)
- ✅ Ankündigungs-System (Info, Warnung, Wartung, Feier)

---

## 🎨 Styling-Konventionen

### Tailwind CSS v4
- **Import:** `@import "tailwindcss"` in `src/index.css`
- **NICHT verwenden:** `ring-opacity-*`, `bg-opacity-*` (deprecated)
- **Stattdessen:** `ring-black/5`, `bg-black/50` (Slash-Syntax)
- **Dark Mode:** `dark:` Prefix (class-basiert)
- **Cursor:** Base-Styles in CSS für `button`, `a`, `select`, etc.

### Farben
- Primary: `indigo-500/600`
- Background Light: `slate-50`, `white`
- Background Dark: `zinc-900`, `zinc-800`
- Text Light: `slate-800`, `slate-600`
- Text Dark: `zinc-100`, `zinc-400`

---

## 📦 Wichtige Vercel KV Keys

| Key | Inhalt |
|-----|--------|
| `news_cache` | Alle Artikel (Array) |
| `news_cache_16` | Erste 16 Artikel |
| `news_cache_64` | Erste 64 Artikel |
| `news_snapshot_pointer` | Aktive Cache-Generation (`snapshotId`, `createdAt`) |
| `feed_health_status` | Status pro Feed, mit `lastAttemptAt`/`lastSuccessAt` |
| `feed_run_status` | Veränderlicher Attempt-Status des Cron-Laufs |
| `feed_publish_status` | Letzter erfolgreicher Kern-Publish |
| `daily_trends` | Tägliche KI-Trends |
| `weekly_trends` | Wöchentliche KI-Trends |
| `site_announcement` | Aktuelles Banner |

## 🫀 Cron-Heartbeat und Frische

Ein alter grüner `feed_health_status` sagt nichts darüber aus, ob der Workflow
noch läuft. `shared/feed-health-model.js` trennt deshalb drei Fragen, die
Cron-Skript, Health-API und Admin-Panel gemeinsam beantworten:

- **Läuft der Workflow?** `feed_run_status` – veränderlicher Versuch mit `runId`,
  `startedAt`, `finishedAt`, Ergebnis, bereinigtem Fatalfehler, Feed-Zählern und
  Phasendauern. Bleibt `running`, bis **alle** Phasen durch sind; `finishedAt`
  fällt erst nach der Trendphase.
- **Wurde veröffentlicht?** `feed_publish_status.lastCorePublishAt` – nur nach
  erfolgreich geschriebenen News-Caches. Ein gescheiterter Versuch lässt den
  Schlüssel unangetastet.
- **Wann kam zuletzt etwas an?** `feed_publish_status.lastContentUpdateAt` –
  steigt nur, wenn mindestens ein Feed Artikel geliefert hat. Das belegt
  **nicht**, dass die Artikel neu waren; eine Novelty-Erkennung gehört nicht zu
  O1.

Als **veraltet** gilt ein Alter **über** `FEED_STALE_AFTER_MS` (fest 50 Minuten);
genau auf der Schwelle noch nicht, ein fehlender Zeitstempel immer. Ein
Zeitstempel weiter als `FEED_CLOCK_SKEW_TOLERANCE_MS` (2 Minuten) in der Zukunft
gilt als ungültig und nie als frisch. `lastSuccessAt` je Feed kann nur vorwärts
laufen. Fatalfehler und Feed-Meldungen werden vor dem Speichern von
Secret-Werten, URL-Zugangsdaten und Querystrings befreit.

`scripts/feed-run-recorder.js` entscheidet, **ob** überhaupt geschrieben werden
darf: einen nicht sicher gelesenen historischen Stand nie mit Ersatzwerten
überschreiben, und einen Abbruch vor der Feed-Liste von einer geladenen, aber
leeren Liste unterscheiden.

Ein Schreibfehler bei `feed_health_status` bleibt **fatal** (Exit-Code ≠ 0), wie
schon vor O1 – sonst meldet ein Lauf Erfolg, obwohl das Admin auf altem Stand
steht. Nur die neuen Metadaten `feed_run_status` und `feed_publish_status` sind
best effort.

Einzelheiten, Datenformate und Grenzen: `docs/deployment/feed-heartbeat.md`.

---

## 🔐 Sicherheit von Admin und Kontakt

Die Admin-Absicherung liegt zentral in `server/admin-auth.js`.

- `middleware.js` schützt `/admin.html` per Basic Authentication
- Die Admin-APIs prüfen die Authentifizierung **zusätzlich selbst** und
  verlassen sich nicht auf die Middleware
- `api/feeds` und `api/get-health-data` sind vollständig geschützt;
  `api/announcement` erlaubt öffentliches GET, aber geschützte Mutationen und
  einen geschützten Admin-Abruf (`?admin=1`)
- Mutationen verlangen zusätzlich eine exakt übereinstimmende Origin (CSRF)
- Fehlende `ADMIN_USERNAME`/`ADMIN_PASSWORD` führen zu 503 – es gibt keine
  Standardzugangsdaten
- `ADMIN_USERNAME` darf keinen Doppelpunkt enthalten, das Passwort schon
- `requireAdminAuth`/`requireAdminMutation` liefern Text (für die Middleware),
  `requireAdminApiAuth`/`requireAdminApiMutation` JSON mit stabilem Fehlercode

## 📜 Verträge und Fehler der Admin-APIs

Eingehendes JSON wird zur Laufzeit geprüft, nicht per TypeScript-Cast:

- `server/feed-validation.js` – `parseFeedCreatePayload`,
  `parseFeedUpdatePayload`, `parseFeedDeletePayload`; nutzt die bestehende
  `shared/url-policy.js` weiter
- `shared/announcement-contract.js` – Typenliste, Längengrenze und Parser;
  begrenzt auch das Textfeld im Admin-Panel
- `server/admin-api.js` – Antwortbau und Rumpflesen

Jeder Fehler antwortet als `{ error, code, field? }` mit einem stabilen Code aus
`shared/api-errors.js`. **Interne Datenbank-, KV- und Providerfehler erscheinen
nie in Client-Antworten** – eine 500 liefert immer dieselbe generische Meldung
und `code: "internal_error"`, der Originaltext geht ausschließlich ins Log.

Alle geschützten Admin-Antworten tragen `Cache-Control: private, no-store`, auch
204, Fehler und Auth-Grenzen. Nur der öffentliche `GET /api/announcement` behält
`s-maxage=60, stale-while-revalidate=120`.

Fehlercodes, Feldregeln, der Admin-Abruf für inaktive Ankündigungen und die
bewussten Grenzen stehen in `docs/deployment/admin-api.md`.

Das Kontaktformular prüft serverseitig Typen, Pflichtfelder, Feldlängen und
E-Mail-Format, schützt vor Steuerzeichen und Header-Injection und schreibt keine
Formulardaten oder Adressen in Logs. reCAPTCHA v3 wird gegen `success`, Score
≥ 0.5, die Action `contact_form` und optional erlaubte Hostnamen geprüft.

## 🛡️ Outbound-Policy

Serverseitige Abrufe laufen nicht mehr direkt über `fetch`. Adressen aus der
Feed-Verwaltung und aus RSS-Inhalten werden vorher geprüft:

- `shared/url-policy.js` – syntaktisch, ohne `node:`-Importe, deshalb auch in
  der Edge-Runtime nutzbar (nur http/https, keine Zugangsdaten, Host vorhanden)
- `scripts/outbound-policy.js` – Adressprüfung über `net.BlockList` sowie
  Weiterleitungen mit erneuter Prüfung je Hop

Eine abgelehnte Adresse erreicht das Netzwerk nicht und wird auch nicht über den
PHP-Proxy abgerufen. Ablehnungen werden nicht wiederholt.

Für Artikel- und Bildadressen aus RSS-Inhalten gilt zusätzlich
`normalizeContentUrl` aus derselben gemeinsamen Schicht - beim Feed-Ingest, beim
OG-Scraping, in der Artikelkarte und im statischen HTML unter `/gaming-news`.
Ein abgelehnter Artikel wird isoliert übersprungen; an den Ausgabestellen
entfallen `href` und `src`, statt eine unzulässige Adresse auszugeben.

Der Transport ist über `undici` mit eigenem `connect.lookup` an die geprüften
Adressen gebunden, deshalb greift DNS-Rebinding zwischen Prüfung und Verbindung
nicht. Gesperrte Bereiche, verbleibende Grenzen und die noch ausstehende
Bestandsprüfung `node scripts/check-feed-urls.js` stehen in
`docs/deployment/outbound-policy.md`.

## 🧯 Belastbarkeit des Cron-Laufs

Der Lauf spricht mit Systemen, die er nicht kontrolliert. Die Regeln dafür:

- **Ein kaputtes Element kostet nur dieses Element.** `parseFeedItems` prüft das
  Datum ausdrücklich und klammert jedes Element in `try/catch`; gezählt wird nach
  Grund (`incomplete`, `invalid_date`, `invalid_link`, `invalid_image`,
  `item_error`). Der Bericht enthält **nur Grund und Anzahl** – keine Titel,
  Adressen oder Inhalte. `parseRssXml` bleibt als reine Artikelliste erhalten.
- **Jeder externe Abruf hat Timeout und Byte-Limit:** Feed 15 s / 5 MB, Proxy
  20 s / 5 MB, Artikelseite 5 s / 2 MB, Groq 20 s / 256 KB. Gelesen wird überall
  über `scripts/limited-response.js`, das die real gelesenen Bytes zählt und den
  Stream abbricht – eine `Content-Length` allein genügt nicht.
- **Trends sind optional.** `scripts/groq-client.js` liefert jeden Fehler als
  Wert statt als Ausnahme; die Trendphase fängt ihre Fehler selbst ab, damit ein
  bereits erfolgter Kern-Publish nicht nachträglich zu `fatal` wird.
- **Konfiguration wird vorab geprüft.** `scripts/feed-run-config.js` trennt Core
  (`POSTGRES_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` – fehlt einer, endet
  der Lauf fatal **vor** dem ersten SQL-, KV-, Recorder- oder HTTP-Zugriff) von
  optional (`GROQ_API_KEY`, `FEED_PROXY_URL` – Zusatzfunktion wird übersprungen).
  Leerzeichen zählen nicht als Wert; gemeldet wird nur der Variablenname.
- `main()` nimmt `env`, `store`, `database`, `createRecorder`, `fetchImpl`,
  `lookup`, `groqFetch`, `exit` und `logger` als Parameter, damit genau diese
  Reihenfolge prüfbar ist. In Produktion gelten die bisherigen Vorgaben.

Einzelheiten und die bewussten Grenzen: `docs/deployment/feed-run-resilience.md`.

## ⏱️ Laufdeadline, Scrape-Budget und Ergebniszustände

O2a hat jeden **einzelnen** Aufruf begrenzt, O2b ihre **Summe**. Der Workflow
hat `timeout-minutes: 30`; ein harter Actions-Abbruch läuft nicht durch den
Fehlerpfad und hinterlässt einen halben Heartbeat.

- **`CORE_DEADLINE_MS` (18 Minuten ab Skriptstart)** begrenzt die Kernphasen und
  lässt 12 Minuten Sicherheitsreserve. Konfigurierbar über
  `FEED_CORE_DEADLINE_MS`; ein unbrauchbarer Wert fällt auf die Vorgabe zurück,
  statt die Grenze abzuschalten. **Der Worst Case passt bewusst nicht hinein:**
  40 Quellen mit je zwei Versuchen à 15 s wären allein rund 20 Minuten. Die
  Deadline ist keine Kapazitätsplanung, sondern die Zusage, dass Kern-Publish
  und Heartbeat immer vor dem Hardlimit fallen – der Rest wird zurückgestellt.
- **80 Artikel-Seitenabrufe pro Lauf** (`FEED_SCRAPE_LIMIT`) gelten **gemeinsam**
  für neue OG-Scrapes und den Backfill – sonst umginge der eine Weg die Grenze
  des anderen.
- **Zwei Mechanismen, nicht einer:** vor jeder Quelle und jedem Seitenabruf wird
  die Restzeit geprüft, *und* ein Timer bricht beim Erreichen der Deadline eine
  bereits laufende Anfrage über einen gemeinsamen `AbortController` ab.
  `requestSignal` kürzt zusätzlich jedes Einzeltimeout auf die Restzeit.
- **Zurückgestellt ist nicht gescheitert.** Eine Quelle, die nicht mehr drankam,
  bekommt `warning` statt `error`, behält ihr `lastSuccessAt` und ihre alten
  Artikel. Offene Bild-Scrapes werden über `distributeBySourceFairly` reihum auf
  die Quellen verteilt, bekommen einen Platzhalter und sind im nächsten Lauf
  wieder Kandidaten.
- **Ergebniszustände:** `success` = vollständiger Kernlauf **ohne**
  zurückgestellte Arbeit; `degraded` = sicherer Kern-Publish, aber Arbeit wurde
  wegen Deadline oder Budget zurückgestellt (Exit-Code 0); `fatal` = kein
  vertrauenswürdiger Kernabschluss. Die Entscheidung trifft ausschließlich
  `resolveRunResult`; der Grund steht bereinigt als `degradedReason` im
  Heartbeat und im Admin.
- **Optionale Phasen entfallen früh**: unterschreitet die Restzeit drei Minuten,
  wird die Trendphase gar nicht erst begonnen – das zählt als Zurückstellung.
  Ein fehlender `GROQ_API_KEY` dagegen nicht.
- **Die Feed-Parallelität bleibt unverändert** bei genau einem offenen Request;
  ein Regressionstest misst das.
- `createRunBudget` nimmt `now`, `setTimer`, `clearTimer` und
  `createTimeoutSignal`, `main()` zusätzlich `budget` und `sleep`. Die
  Grenzfälle vor, auf und nach der Deadline laufen deshalb ohne echte Wartezeit.

Einzelheiten: `docs/deployment/feed-run-budget.md`.

## 🧬 Generationsgebundenes Leseprotokoll

Die drei News-Caches werden **nacheinander** geschrieben und unabhängig
voneinander am Edge gecacht. Ohne weiteres Zutun kann ein Browser Preview,
Medium und Full aus drei verschiedenen Ständen zusammensetzen – beobachtet am
29. Juli 2026, als das Frontend dauerhaft 25 statt 26 deutsche Quellen zeigte.

- **Der Cron schreibt zuletzt einen Zeiger** (`news_snapshot_pointer`) mit
  `schemaVersion`, `snapshotId` und `createdAt`. Er zeigt damit nie auf
  unvollständig geschriebene Daten. Ein Schreibfehler dort ist **nicht fatal**.
- **Jede News-Antwort trägt die Generation als Header**, nicht als Umschlag.
  Der Rumpf bleibt ein nacktes Array – bestehende Clients merken nichts.
- **Endpunkte lesen den Zeiger vor den Artikeln.** Schreibt der Cron dazwischen,
  ist das Etikett höchstens *älter* als die Daten und nie neuer; das heilt sich
  beim nächsten Abruf selbst.
- **Drei Leseregeln:** gleiche Generation übernehmen, neuere übernehmen *und*
  umpinnen, ältere verwerfen. Die zweite Regel verhindert, dass ein Browser auf
  einem alten Stand hängen bleibt; die dritte, dass eine verspätete Kopie den
  Stand zurückdreht.
- **`?snapshot=<id>`** macht den Edge-Cache generationsspezifisch: passend
  länger cachebar, abweichend `no-store`, ungepinnt unverändert.
- **`null` heißt überall „Legacy", nie „Fehler".** Fehlender, unlesbarer oder
  unbekannt versionierter Zeiger fällt auf das Verhalten vor O3a zurück.
- Consumer sind die drei News-Endpunkte, `App.tsx`, `/api/gaming-news` und die
  Health-API. Die Merge-Basis des Cron liest weiterhin `news_cache`.

Einzelheiten, Rollback und Migrationsreihenfolge:
`docs/deployment/news-generations.md`.

## 🔌 Feed-Proxy

Einzelne Quellen – aktuell GamePro – beantworten Anfragen aus dem
GitHub-Actions-Netz mit HTTP 403. Für diese Fälle gibt es `tools/feed-proxy.php`
auf einem externen Webhosting.

- Der Proxy wird **nur für Quellen aus `PROXY_ELIGIBLE_SOURCES`** versucht
  (aktuell ausschließlich GamePro). Ein gewöhnlicher Timeout einer anderen
  Quelle führt nicht mehr zum Umweg über fremdes Hosting
- **Wird nicht von Vercel deployt.** Nach jeder Änderung an der Datei muss sie
  manuell auf das Hosting hochgeladen werden
- Die Adresse steht im GitHub-Actions-Secret `FEED_PROXY_URL`, nicht bei Vercel
- Der Proxy akzeptiert nur GET, vergleicht die Ziel-URL exakt gegen eine
  Allowlist, folgt keinen Redirects, erlaubt nur HTTPS und begrenzt die Antwort
- `FEED_PROXY_URL` verbirgt nur die Adresse und ist **kein** Authentifizierungs-Token
- Ohne das Secret läuft der Cron-Job weiter, nur ohne Fallback
- Betrieb und Grenzen: `docs/deployment/feed-proxy.md`

Der Hosting-Edge weist Anfragen sporadisch mit 415 ab, bevor PHP läuft. Da das
Skript diesen Status nie selbst erzeugt, behandelt `scripts/feed-fetch-utils.js`
415 **nur auf dem Proxy-Weg** als vorübergehend und wiederholt die Anfrage.

---

## 🔧 Häufige Befehle

```bash
# Development
npm run dev

# Alle Tests (zentral unter tests/)
npm test

# Nur die Feed-Tests des Cron-Jobs
npm run test:feeds

# Browser-Abnahmen (Chromium, eigener Runner)
npm run test:e2e

# TypeScript prüfen
npm run typecheck

# Production Build
npm run build

# Manueller Cache-Update (lokal) - schreibt in die konfigurierte KV/DB,
# also kein harmloser Testlauf
node scripts/fetch-feeds.js
```

Nach Codeänderungen `npm test`, `npm run typecheck` und `git diff --check`
ausführen; `npm run build` zusätzlich, sobald Frontend, Build-Konfiguration oder
Abhängigkeiten betroffen sind. Für reine Dokumentationsänderungen genügt eine
Sichtprüfung.

## 🧪 Tests und CI

Alle Tests liegen zentral unter `tests/`, nie neben den Produktivdateien:

```text
tests/
├── feeds/{unit,integration,helpers}
├── frontend/{unit,helpers}
└── server/{unit,helpers}
```

Die Helfer unter `tests/server/helpers/` stellen SQL-, KV- und Logger-Attrappen
sowie eine feste Uhr bereit; `tests/feeds/helpers/` bündelt zusätzlich alle
Außenkanten des Cron-Laufs samt kontrollierter Uhr und gestellten Timern. Kein
Test berührt eine echte Datenbank, einen echten KV-Speicher oder eine echte
Wartezeit.

Grundlage sind `node:test`, `node:assert`, Linkedom und React über Vite SSR.

Für echte Navigation, Cookies und Netzwerkverhalten gibt es zusätzlich eine
kleine Chromium-Suite unter `tests/e2e/` mit `npm run test:e2e`. Sie ist von
`npm test` getrennt (`*.test.js` gegen `*.spec.ts`), stellt alle API-Antworten
selbst und bricht Anfragen an fremde Herkünfte ab. Einzelheiten in
`docs/development/e2e-tests.md`.

`.github/workflows/ci.yml` läuft bei Push auf `main`, bei Pull Requests und
manuell, in dieser Reihenfolge: `npm ci`, `php -l tools/feed-proxy.php`,
`npm test`, `npm run typecheck`, `npm run build`. Ist lokal keine PHP-CLI
verfügbar, übernimmt CI den Syntaxcheck von `tools/feed-proxy.php` – PHP dafür
nicht ungefragt installieren.

**Bekannte Eigenheit des Frontend-Harness:** React ermittelt beim ersten Import
von `react-dom` einmalig über `'oninput' in document`, ob native Input-Events
unterstützt werden. Linkedom definiert die Eigenschaft nicht, weshalb
`tests/frontend/helpers/react-test-root.js` sie vorher setzt. Ohne diese Zeile
wählt React einen Polyfill-Pfad und `onChange` feuert bei Textfeldern nie.

---

## 📝 Git-Konventionen

- **Sprache:** Deutsch
- **Format:** `type: Beschreibung`
- **Types:** `feat`, `fix`, `chore`, `refactor`, `docs`
- **Beispiele:**
  - `feat: ESC-Taste schließt Settings Modal`
  - `fix: Cursor pointer für Buttons wiederhergestellt`
  - `chore: CSS Migration Check Script entfernt`

---

## ⚠️ Bekannte Einschränkungen

- `npm run dev` nutzt für `/api` den Proxy zur produktiven GamerFeed-API
- Für lokale Änderungen an Serverless Functions: `vercel dev` nutzen
- GitHub Actions braucht die Core-Secrets `POSTGRES_URL`, `KV_REST_API_URL` und `KV_REST_API_TOKEN`; ohne sie endet der Lauf sofort. `GROQ_API_KEY` und `FEED_PROXY_URL` sind optional und schalten nur ihre Zusatzfunktion ab
- `FEED_CORE_DEADLINE_MS` und `FEED_SCRAPE_LIMIT` sind optionale Grenzen; ohne sie gelten 18 Minuten und 80 Seitenabrufe
- Der PHP-Feed-Proxy wird separat und manuell betrieben: `docs/deployment/feed-proxy.md`

---

## 🔄 Letzte Änderungen

- **Nov 2025:** Tailwind CDN → Lokaler Build (v4)
- **Nov 2025:** ESC schließt Modals
- **Nov 2025:** Ankündigungs-Banner System
- **Nov 2025:** Toast Swipe-to-Dismiss (links + hoch)
- **Nov 2025:** Auto-Update mit Badge + Tab-Titel
- **Dez 2025:** Artikel-Retention auf 60 Tage reduziert + Max 10.000 Artikel (Vercel KV 10MB Limit)
- **Juli 2026:** News-Cache-Endpunkte auf gemeinsame Logik in `server/news-cache-handler.ts` vereinheitlicht
- **Juli 2026:** Feed-Verwaltung über `services/feeds-api.ts` und `hooks/useFeeds.ts` mit sichtbaren Fehlerzuständen
- **Juli 2026:** Dialoge auf `useDialogFocus` vereinheitlicht (Admin-Dialoge, mobiler Filter, Einstellungen)
- **Juli 2026:** GamePro liefert an GitHub Actions HTTP 403; tote öffentliche Proxies entfernt, eigener PHP-Proxy als Fallback eingeführt
- **Juli 2026:** Feed-Abruf nach `scripts/feed-fetch-utils.js` extrahiert – Wiederholungen, Größenbegrenzung, Feed-Validierung, getrennte Direkt- und Proxy-Fehler
- **Juli 2026:** Einstellungsdialog mit echten ARIA-Tabs, angekündigten Formularmeldungen und jederzeit möglichem Schließen
- **Juli 2026:** Cron-Heartbeat (O1): Attempt-Status, Kern-Publish und Inhaltsfrische getrennt geführt, veraltete Daten ab 50 Minuten sichtbar; Workflow startet zu Minute 7/27/47
- **Juli 2026:** Admin-APIs (S2): Laufzeitverträge statt TypeScript-Casts, stabile Fehlercodes, keine internen Fehlertexte mehr im Client, `private, no-store` auf allen geschützten Antworten, inaktive Ankündigungen im Admin wieder bearbeitbar
- **Juli 2026:** Generationsgebundenes Leseprotokoll (O3a): jede News-Antwort nennt ihre Cache-Generation, der Leser pinnt sie und verwirft ältere Antworten; fehlender Zeiger fällt auf Legacy zurück
- **Juli 2026:** Laufdeadline und Scrape-Budget (O2b): 18-Minuten-Deadline mit kontrolliertem Gesamtabbruch, 80 Seitenabrufe pro Lauf, faire Verteilung zurückgestellter Bild-Scrapes, Ergebniszustand `degraded` getrennt von `success` und `fatal`
- **Juli 2026:** Belastbarkeit des Cron-Laufs (O2a): fehlerhafte Items einzeln überspringen, Timeout und Byte-Limit für HTML- und Groq-Abrufe, Proxy nur für GamePro, Core-Konfiguration vor dem ersten externen Zugriff geprüft

---

## 💡 Hinweise für KI-Assistenten

1. **Commits auf Deutsch** schreiben
2. **Tailwind v4 Syntax** verwenden (keine deprecated Klassen)
3. **README.md** enthält ausführliche Architektur-Dokumentation
4. **localStorage** wird für User-Settings verwendet
5. **Vercel KV** für serverseitige Daten
6. Bei Fragen zur Architektur: README.md lesen
7. Bei einem Domainwechsel: `docs/deployment/custom-domain.md` vollständig abarbeiten
8. Bei Roadmap-Arbeit `docs/development/roadmap.md` lesen und nur ein ausdrücklich beauftragtes Arbeitspaket bearbeiten; ausdrücklich beauftragte Hotfixes außerhalb der Roadmap bleiben möglich und werden danach eingeordnet
9. Die Roadmap erlaubt keine ungefragten externen Deployments, Secret- oder Plattformänderungen
10. Production-Änderungen folgen `docs/deployment/release-process.md`; kein direkter Push auf `main`
