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
│   ├── useMutationLatch.ts # Synchrone Sperre gegen doppelte Mutationen
│   ├── useFeeds.ts         # Feed-Daten fetchen
│   └── useLocalStorage.ts  # localStorage Hook
│
├── services/
│   ├── admin-health-report.ts  # Reine Ableitung der Admin-Kennzahlen
│   ├── feeds-api.ts        # HTTP-Zugriff für Feed-Verwaltung
│   └── news-load-controller.ts # Latest-request-wins für Preview/Medium/Full
│
├── scripts/
│   ├── fetch-feeds.js      # Cron-Job Script (GitHub Actions)
│   ├── feed-fetch-utils.js # Getesteter Feed-Abruf mit Retry/Proxy-Fallback
│   ├── feed-image-utils.js # Bildauswahl und -validierung für Artikel
│   ├── feed-run-budget.js  # Zeit- und Scrape-Budget eines Laufs
│   ├── feed-run-config.js  # Core- und optionale Konfiguration des Laufs
│   ├── feed-run-recorder.js # Reihenfolge und Schreibregeln des Heartbeats
│   ├── feed-run-summary.js # Laufbericht und GitHub-Step-Summary
│   ├── news-snapshot-publisher.js # Bytebudget, Lease, atomare Aktivierung und GC
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
│   ├── news-snapshot-store.js   # Unveränderliche Keys, Manifest und Dual-Read
│   ├── persisted-state.ts       # Decoder und Defaults für Browserzustand
│   ├── local-news-cache.ts      # Schlüssel, Frist und Lesen der lokalen Kopie
│   ├── i18n-locale.ts           # App-Sprache auf festes Datums-Locale abbilden
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
die beiden Admin-Löschdialoge (Feed und Ankündigung), den mobilen Filterdialog
und `SettingsModal`. Er liefert
Fokusfalle, initialen Fokus, Escape-Behandlung, Fokus-Rückgabe an das auslösende
Element und optional `canClose` zum Blockieren während laufender Aktionen.

Die Reiter im Einstellungsdialog sind vollwertige ARIA-Tabs: `role="tablist"`,
`role="tab"`, `aria-selected`, `aria-controls`, `role="tabpanel"`,
`aria-labelledby`, roving `tabIndex` sowie Pfeiltasten mit Umlauf, Home und End.
Die textlastigen Reiter „Rechtliches" und „Über uns" haben `tabIndex={0}`, damit
sie ohne Bedienelemente per Tastatur erreichbar und scrollbar sind.

Gespeicherte Suchen verwenden native Buttons und funktionieren mit Enter und
Leertaste. Suchfeld, Speichern und Entfernen besitzen lokalisierte Accessible
Names. `ArticleCard` ist in allen Layouts ein semantischer `article`; nur der
Titel ist der über ein Pseudoelement gestreckte Artikel-Link. Favorisieren,
Optionsdialog und Share-Links liegen als Geschwister außerhalb dieses Links.
Der benannte Optionsdialog ist geschlossen `inert`, räumt verzögerten Fokus
beim Schließen auf und gibt ihn mit Escape an seinen Auslöser zurück.

`ArticleCard` nutzt `React.memo` ausschließlich mit Reacts Standardvergleich.
Ein handgeschriebener Vergleich darf nicht nur ausgewählte Artikelfelder
betrachten, weil sonst etwa eine geänderte Zusammenfassung, Adresse, Quelle,
Sprache oder Veröffentlichungszeit bei gleicher ID veraltet sichtbar bleibt.
Artikel-Props werden als unveränderliche Objekte behandelt; aktualisierte
Inhalte bekommen ein neues `Article`-Objekt.

### Mutierende Admin-Aktionen

`hooks/useMutationLatch.ts` schützt jede mutierende Admin-Aktion gegen zwei
Ereignisse im **selben** Render-Zyklus. Ein Guard aus React-State (`isSaving`,
`isDeletingFeed`) genügt dafür nicht: Zwei synchrone Klicks oder Submits sehen
beide noch den alten Wert, weil React erst danach neu rendert. Der Latch liegt
deshalb in einem `useRef`, wird **vor dem ersten `await`** gesetzt und in jedem
Erfolgs- und Fehlerpfad über `finally` wieder freigegeben. Die State-Kopie
`isMutating` dient ausschließlich Beschriftung, `aria-busy` und `disabled`.

| Flow | Latch |
|---|---|
| Feed anlegen (POST) und bearbeiten (PUT) | `FeedFormModal` |
| Feed löschen (DELETE) | `AdminPanel` |
| Ankündigung speichern (POST) und löschen (DELETE) | `AnnouncementTab`, **gemeinsam** |

Speichern und Löschen einer Ankündigung teilen sich bewusst einen Latch, damit
nicht synchron ein POST und ein DELETE nebeneinander starten.

Ein Fehler verwirft nie Eingaben oder Datensätze: Der Feed-Formulardialog bleibt
mit allen Feldern offen, Feed und Ankündigung bleiben samt ihrem
Bestätigungsdialog erhalten, und Nachricht, Typ und Aktiv-Status der Ankündigung
stehen unverändert weiter. Interne Fehlertexte gehen nur ins Log; sichtbar sind
lokalisierte Meldungen.

Beide Löschungen laufen über einen `alertdialog` mit `useDialogFocus`: initialer
Fokus auf „Abbrechen“, Fokusfalle, Escape schließt **vor** Beginn der Mutation
und ist währenddessen gesperrt (`canClose`), Fokus-Rückgabe an den Auslöser.
Fehlt der Auslöser nach erfolgreicher Löschung, greift ein Fallback – die
Schaltfläche „Neuen Feed hinzufügen“ beziehungsweise das Ankündigungs-Textfeld.
Der Speichern-Knopf taugt dafür nicht: ohne Nachricht ist er deaktiviert und
damit nicht fokussierbar.

### Admin-Reiter und Health-Semantik

Die vier Admin-Reiter sind vollwertige ARIA-Tabs mit derselben Semantik wie im
Einstellungsdialog: stabile IDs (`admin-tab-<id>` / `admin-panel-<id>`),
`aria-selected`, `aria-controls`, `aria-labelledby`, roving `tabIndex` sowie
Pfeiltasten mit Umlauf, Home und End. Tastaturnavigation setzt Auswahl **und**
Fokus. Die beiden Aufklapp-Schaltflächen für Fehler- und Warnungsdetails tragen
lokalisierte Namen, die Fehler von Warnungen und Ein- von Ausblenden
unterscheiden, und steuern über `aria-controls` dauerhaft gerenderte Bereiche.

**Der Admin ruft keinen RSS-Feed live ab.** Die früheren Aktualisieren-Symbole
je Feed-Zeile führten in Wahrheit denselben globalen Abruf aus und sind deshalb
entfernt. Der zentrale Knopf heißt „Gespeicherten Statusbericht neu laden“ und
sagt ausdrücklich, dass weder ein RSS-Abruf noch ein GitHub-Action-Lauf startet.
Ein echter manueller Einzelquellen-Abruf ist bewusst kein Bestandteil.

`services/admin-health-report.ts` leitet den Bericht rein und ohne i18n ab. Es
unterscheidet **drei verschiedene Kennzahlen**, die voneinander abweichen dürfen:

| Kennzahl | Herkunft | Warum sie schwankt |
|---|---|---|
| Konfigurierte Feeds | `feeds`-Tabelle | ändert sich nur beim Anlegen oder Entfernen |
| Quellen im aktiven News-Snapshot | `sourcesInCache` der Health-API | je Lauf verschieden; eine Quelle ohne Artikel fehlt |
| Quellen im lokalen Startcache | `cachedNews` dieses Browsers | enthält nur die ersten 32 Artikel; hat deshalb **fast immer** weniger Quellen |

`shared/local-news-cache.ts` hält Schlüssel, Frist **und Größe** des Startcaches
an **einer** Stelle; `App.tsx` verwendet dieselben Konstanten. Als „vom Frontend
verwendbar“ gilt eine Kopie nur, wenn sie derselbe Laufzeit-Decoder aus
`shared/persisted-state.ts` annimmt **und** sie jünger als 30 Minuten ist.
Fehlend, unlesbar und abgelaufen bleiben unterscheidbar und ergeben „unbekannt“.

**Der lokale Startcache bewertet keine Feed-Zeile.** `LOCAL_NEWS_CACHE_MAX_ARTICLES`
beträgt 32; dass darin die meisten der aktiven Quellen fehlen, ist der Normalfall
und keine Diagnose. Eine Zeile entsteht deshalb ausschließlich aus Backend-Status
und aktivem News-Snapshot – `AdminFeedHealthRow` kennt den Startcache gar nicht.
Er erscheint nur global als eigene Kennzahl mit seiner tatsächlichen Artikel- und
Quellenzahl, ausdrücklich ohne Anspruch auf Gleichheit mit dem Snapshot. Beide
Zahlen werden getrennt pluralisiert – zwei Artikel können aus einer Quelle
stammen.

**Generationen werden nur verglichen, wenn beide Kennungen belegbar sind.** Eine
fehlende `snapshotId` heißt „Legacy/unbekannt“, nie „gleich“. Daraus folgen die
drei Aussagen `same`, `different` und `unknown` – und die Trennung zweier Fälle,
die vorher gleich aussahen:

- **VG247** wird erfolgreich abgerufen, hat aber keine Artikel im aktiven
  Snapshot: Warnung, „nicht im aktiven News-Snapshot“.
- **GameStar** steht im aktiven Snapshot: Status **OK**, ohne Zusatz. Ob die
  Quelle zusätzlich im begrenzten Startcache liegt, spielt für die Zeile keine
  Rolle.

Gleiche `snapshotId` heißt **gleiche Generation**, auch wenn der Startcache
weniger Quellen enthält – das liegt an seiner Größe, nicht an der Generation.
Zwei belegbar verschiedene Kennungen bleiben dagegen deutlich als
unterschiedliche Generationen ausgewiesen.

**Die unscharfe Namensnormalisierung ist entfernt.** Zugeordnet wird
ausschließlich über exakt gleiche Quellennamen. Ein Feed ohne exakte
Entsprechung bleibt eine Warnung statt still gesund zu werden, und
Snapshot-Quellennamen ohne passenden Feed werden separat als „nicht zugeordnet“
aufgelistet, statt zu verschwinden. Jeder konfigurierte Feed bleibt in jedem
Fall eine eigene Zeile: fehlend, ähnlich geschrieben, artikellos oder unbekannt.
Backend-Abrufstatus und Snapshot-Präsenz sind zwei getrennte Aussagen. Eine
Backend-**Warnung** bleibt deshalb immer eine Warnung, egal was der Snapshot
sagt: Der Cron vergibt sie unter anderem für eine wegen Zeitbudget
zurückgestellte Quelle, die ihre alten Artikel behält, und für einen erfolgreich
abgerufenen, aber leeren Feed. In beiden Fällen können noch **ältere** Artikel im
aktiven Snapshot liegen – ihre Präsenz belegt keinen erfolgreichen Abruf und darf
die Warnung nie in „OK“ umschlagen lassen. Die Snapshot-Aussage steht trotzdem
daneben, und die bereits cron-seitig bereinigte Backend-Meldung erscheint in
einem lokalisierten Satz.

Kann der gespeicherte Bericht gar nicht geladen werden, sind alle Zeilen
**unbekannt**, nicht rot: Nicht die Feeds sind ausgefallen, sondern der Bericht
über sie fehlt.
Der textlastige Legenden-Reiter trägt `tabIndex={0}`, damit er ohne
Bedienelemente per Tastatur erreichbar und scrollbar bleibt. Seine Texte
beschreiben genau diese Semantik: kein Verweis mehr auf `news-cache.json` oder
`feed-health-status.json`, OK nur bei `success` **und** exaktem Quellennamen im
aktiven Snapshot, Warnung für beide Ursachen. Den Eintrag „Prüfe“ gibt es nicht
mehr – es wird kein einzelner Feed live geprüft, und der Zeilenstatus `checking`
ist ersatzlos aus `HealthState` entfernt.

### Persistierter Browserzustand

`hooks/useLocalStorage.ts` akzeptiert nur noch Aufrufe mit einem
Laufzeit-Decoder aus `shared/persisted-state.ts`. Der generische TypeScript-Typ
allein schützt nicht vor manuell veränderten, alten oder beschädigten
`localStorage`-Werten.

| Key | Decoder | Default |
|---|---|---|
| `theme` | `decodeTheme` | `light` |
| `viewMode` | `decodeViewMode` | `grid` |
| `favorites`, `mutedSources`, `savedSearches` | `decodeStringArray` | `[]` |
| `cachedNews` | `decodeCachedNews` | `{ articles: [], timestamp: 0 }` |
| `dismissedAnnouncementId` | `decodeNullableString` | `null` |

Dieselben Regeln gelten beim ersten Lesen, beim Schreiben und bei
Cross-Tab-`storage`-Events. Ein entfernter Key, ein `localStorage.clear()` oder
kaputtes JSON setzt nur den betroffenen Zustand auf seinen Default.
`cachedNews` akzeptiert Legacy-Einträge ohne Generation, prüft aber jeden
Artikel und normalisiert eine vorhandene Generation über den bestehenden
Snapshot-Vertrag. Schlägt nur das persistente Schreiben fehl, bleibt der
aktuelle React-State benutzbar.

### Internationalisierung und Datumsformate

Sichtbare Texte und Accessible Names der App liegen in den DE-/EN-Ressourcen
von `i18n.ts`. Neue UI-Texte werden nicht direkt in JSX geschrieben.
Technische Fehlerdetails gehören in das bereinigte Log; die Oberfläche zeigt
eine lokalisierte, für Nutzer verständliche Meldung.

Datumswerte folgen ausschließlich der in i18next gewählten Sprache, nicht
`navigator.language` oder dem Prozess-Locale. `shared/i18n-locale.ts` bildet
Deutsch auf `de-DE` und alle übrigen unterstützten Sprachen auf `en-US` ab.
Komponenten beziehen die Sprache über `useTranslation`, damit ein
Sprachwechsel Texte, Datumswerte und Accessible Names ohne Reload aktualisiert.

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
- ✅ Feed-Verwaltung (CRUD) mit Löschbestätigung
- ✅ Mutationen gegen synchrone Doppelauslösung gesperrt
- ✅ Health Center (Feed-Status, letzter Lauf, Kern-Publish, Inhaltsfrische)
- ✅ Drei getrennte Quellen-Kennzahlen mit Snapshot-Vergleich
- ✅ Vollwertige ARIA-Tabs mit Pfeiltasten, Home und End
- ✅ Ankündigungs-System (Info, Warnung, Wartung, Feier) mit Löschbestätigung

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
| `news_snapshot_pointer` | Aktive vollständige Cache-Generation |
| `news_snapshot:<id>:{full,preview,medium,meta}` | Unveränderliche Payloads und Manifest |
| `news_snapshot_publish_lease` | Kurzlebige Lease gegen parallele Writer |
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

## 📋 Laufbericht in der Step-Summary

`scripts/feed-run-summary.js` fasst jeden Lauf für die Job-Übersicht von GitHub
Actions zusammen (O4a). Geschrieben wird **nur** bei gesetztem und nicht leerem
`GITHUB_STEP_SUMMARY`, über den injizierbaren `writeSummary`-Parameter von
`main()`.

Der Bericht entsteht rein aus Daten, die der Lauf ohnehin hat – `feed_run_status`,
`feed_health_status` und das Ergebnis des Snapshot-Publishers. **Es entstehen
keine neuen KV-Schlüssel:** Transport und HTTP-Status je Feed leben
ausschließlich im Arbeitsspeicher des laufenden Prozesses.

Vier Begriffe sind genau definiert:

- **`proxy`** heißt, dass die *erfolgreiche* Antwort wirklich vom Proxy kam –
  nicht, dass ein Proxyversuch möglich gewesen wäre. Eine zurückgestellte
  Quelle bekommt `none`.
- **Ein HTTP-Status erscheint nur, wenn er beobachtet wurde.** Nichts wird
  geraten; ein Verbindungsfehler und eine Zurückstellung zeigen `–`.
- **Artikel** sind nur die in *diesem* Lauf gelieferten. Alte, lediglich
  beibehaltene Artikel stehen dort nie.
- **Fehlerquote = `error / (success + warning + error)`.** `unknown` bleibt
  außen vor und wird getrennt genannt; Warnungen stehen im Nenner, aber nie im
  Zähler und bekommen eine eigene Warnquote.

Unbekannte Zahlen bleiben unbekannt: **`–` heißt, dass keine verlässliche
Messung vorliegt; `0` heißt, dass wirklich gemessen wurde.** Übersprungene Items
zählt nur ein tatsächlich durchgeführtes Parsen – Abruffehler, Zurückstellung
und Parse-Abbruch zeigen `–`. Dasselbe gilt für Dauer und Artikelzahl.

Die Bereinigung entfernt eingebettete Zugangsdaten aus **jeder** Adresse mit
`scheme://`, nicht nur aus HTTP(S): `postgres://user:pass@host?sslmode=…` wird
ebenso entschärft. Sie ist damit nicht darauf angewiesen, dass eine Meldung die
konfigurierte Verbindungszeichenfolge bytegenau wiederholt.

Die Zusammenfassung ist **ausschließlich zusätzliche Beobachtbarkeit**. Zwei
Schichten fangen Fehler ab – `writeRunSummary` selbst und der Aufrufer in
`main()` –, damit weder ein Schreibfehler noch ein Fehler beim Aufbau des
Berichts das Ergebnis, den Exit-Code oder einen vorhandenen Fatalfehler
verändert. Auch ein Abbruch in der **Vorprüfung** bekommt einen – dann
minimalen – Bericht, ohne die Reihenfolge vor dem ersten externen Zugriff
anzutasten. Sie enthält keine Secrets, Querystrings, Feed- oder Proxy-Adressen
und keine Artikeltexte; Feed-Namen werden für Markdown entschärft und die
Tabelle ist auf 50 Zeilen begrenzt.

Einzelheiten und Grenzen: `docs/deployment/feed-run-summary.md`.

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

O3a definiert die Leseregeln; **O3b aktiviert sie über unveränderliche
Generationen**:

- **Eigene Keys je Generation:** Full, Preview und Medium liegen unter
  `news_snapshot:<id>:*`. Ein strenges Manifest belegt Vollständigkeit,
  Artikelzahl, Bytezahl und Quellen.
- **Pointer zuletzt:** Der Cron schreibt Payloads, Manifest und dieselben
  begrenzten Legacy-Keys, bevor `news_snapshot_pointer` die Generation
  aktiviert. Ein Fehler davor lässt den alten vollständigen Stand sichtbar.
- **Bytebudgets statt Artikelzahl:** Full 9 MiB, Medium 2 MiB, Preview
  512 KiB, jeweils 64 KiB Reserve. Feldlängen und einzelne 64-KiB-Artikel sind
  begrenzt; bei Platzmangel fallen deterministisch die ältesten Einträge weg.
- **Parallele Writer:** Eine fünfminütige `SET NX PX`-Lease serialisiert den
  Publish. Nach dem Erwerb verhindert ein monotoner Vergleich nach Laufstart,
  dass ein älterer Lauf einen neueren Pointer zurücksetzt. Die abschließende
  Pointer-Aktivierung prüft den Lease-Besitz atomar; ein Writer mit abgelaufener
  Lease kann deshalb nicht nachträglich aktivieren. Das Warten bleibt innerhalb
  der O2b-Deadline.
- **Aktiv und vorherig bleiben:** Ein gepinnter Leser darf die aktive oder
  direkt vorherige Generation abrufen. Ältere und unvollständige Generationen
  werden erst nach 24 Stunden Grace Period best effort entfernt.
- **Jede News-Antwort trägt die Generation als Header**, nicht als Umschlag.
  Der Rumpf bleibt ein nacktes Array – bestehende Clients merken nichts.
- **Die Endpunkte melden nur, was belegt ist:** Produktion liest Manifest und
  Payload derselben unveränderlichen ID. Fehlt diese Bindung, gilt der
  Legacy-Fallback ohne Header.
- **Drei Leseregeln:** gleiche Generation übernehmen, neuere übernehmen *und*
  umpinnen, ältere verwerfen.
- **Entdeckung ist nicht Fortsetzung.** `?snapshot=<id>` setzt eine bereits
  gewählte Generation konsistent fort und taugt **nicht** zur Suche nach der
  aktiven. Weil die direkt vorherige Generation absichtlich lesbar bleibt,
  beantwortet der Server `?snapshot=A` weiter mit A – ein Browser, der schon
  seinen ersten Versuch pinnt, entdeckt eine neue Generation nie. Der erste
  Versuch jeder autoritativen Ladung fragt deshalb ungebunden (Preview,
  Full-Fallback ohne angenommene Antwort, manueller Refresh), ebenso der
  Auto-Update-Poll. Erst die angenommene Antwort bindet Medium und Full an genau
  ihre Generation; dafür führt der Controller `hasAcceptedResponse` getrennt von
  `hasUsableResponse`. Die Annahmeentscheidung bleibt unverändert, eine
  ungebundene Entdeckung öffnet also keinen Rückschritt.
- **Gepinnt wird nur, was sichtbar ist.** Der Auto-Update-Pfad pollt im
  Hintergrund und pinnt deshalb nicht; Artikel und Generation wandern gemeinsam
  in die Warteschlange und werden beim Klick über `planPendingAdoption` erneut
  geprüft. `persistCachedArticles` verlangt den Snapshot als ausdrücklichen
  Parameter.
- **Rollback braucht ein Signal.** Eine bloß fehlende Generationsangabe ist
  meistens eine alte Kopie und darf nichts zurückdrehen. Ein bewusster Rückfall
  meldet sich mit `x-gamerfeed-snapshot-rollback: legacy` und löscht die
  gepinnte Generation – auch in der lokalen Kopie. Eine Rollback-Antwort trägt
  **immer** `no-store`: das Signal ist eine kurzlebige Betriebsanweisung und
  darf nicht aus einem Edge-Cache nachwirken.
- **Ein Rollback im Poll-Pfad räumt auf.** Der Poll pinnt nicht, leert aber
  Warteschlange, Badge und Tab-Titel – eine zurückgezogene Generation darf nicht
  vorgemerkt bleiben. Wirksam wird der Rollback über Reload oder Refresh.
- **Die Health-API liest nur das Manifest.** Quellenliste und Snapshot stammen
  aus derselben Generation; der mehrere Megabyte große Full-Payload entfällt.
- **`?snapshot=<id>`**: abweichend `no-store`, passend und ungepinnt dieselbe
  Cache-Dauer wie bisher. Die HTTP-Frist bleibt während Dual-Read bewusst kurz,
  obwohl der Inhalt unter der Kennung nun unveränderlich ist.
- **Strenge Prüfung:** `snapshotId` muss `<epochMs>-<lauf>` entsprechen und zu
  `createdAt` passen. Ein beschädigter Wert könnte sonst lexikografisch jede
  echte Generation blockieren. Lieber gar keine Generation als eine falsche.
- **`null` heißt überall „Legacy", nie „Fehler".**
- **Auch die lokale Kopie zählt:** `cachedNews` ist 30 Minuten gültig, der
  Edge-Cache nur 60 Sekunden. Sie speichert deshalb ihre Generation mit.
- **Zwei Rollbacks:** `rollbackToPreviousNewsSnapshot` schaltet gebunden auf
  die vorherige Generation. `NEWS_SNAPSHOT_LEGACY_ROLLBACK=true` lässt alle
  Consumer Legacy lesen und sendet das ausdrückliche, nie cachebare Signal.

Einzelheiten, Grenzen und Migrationsreihenfolge:
`docs/deployment/news-generations.md`.

## 🔄 Progressive News-Ladekette

`services/news-load-controller.ts` ist seit F1 der einzige Besitzer von
Preview-, Medium-, Full- und manuellen Refresh-Requests.

- Jede autoritative Ladung hat eine Request-Epoche und einen
  `AbortController`. Eine neue Ladung oder Unmount bricht alte Arbeit ab; die
  Epochenprüfung verhindert Seiteneffekte selbst dann, wenn ein Fetch den Abort
  ignoriert.
- Nur die aktuelle Epoche darf Artikel, `localStorage`, Snapshot-Pin,
  Ladeindikatoren oder Fehlerzustände verändern.
- Medium und Full bleiben sequenziell, Full wird aber auch nach einem
  Medium-Fehler versucht.
- `error` ist ausschließlich blockierend, wenn keine verwendbaren Daten
  vorhanden sind. `backgroundError` lässt sichtbare Artikel stehen und meldet
  einen fehlgeschlagenen Refresh oberhalb der Liste.
- Auto-Update-Abfragen sind passiv: sie starten nicht neben einer sichtbaren
  Ladung und werden von Refresh, Unmount oder der Übernahme vorgemerkter Artikel
  entwertet.
- Diese Request-Ownership ergänzt O3a, ersetzt dessen Generationsprüfung aber
  nicht. Aktiviert wird die Inhaltsbindung weiterhin erst durch O3b.

Deferred-Promise- und Chromium-Fälle sowie die bewussten Grenzen stehen in
`docs/development/progressive-news-loading.md`.

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
- `NEWS_CACHE_*_MAX_BYTES` und `NEWS_CACHE_SAFETY_RESERVE_BYTES` sind optionale O3b-Grenzen; `NEWS_SNAPSHOT_LEGACY_ROLLBACK=true` ist eine bewusste, nie automatisch gesetzte Betriebsflagge
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
- **Juli 2026:** Generationsgebundenes Leseprotokoll (O3a): Vertrag, Leseregeln und alle Consumer stehen; aktiviert wird es erst mit den unveränderlichen Generationen aus O3b, bis dahin entwertet der Cron jeden Zeiger und alles antwortet als Legacy
- **Juli 2026:** Progressive Ladekette (F1): zentraler Request-Controller mit Abort und Epoche, Full läuft auch nach Medium-Fehlern, alte Antworten und Polls dürfen State oder lokale Kopie nicht mehr überschreiben
- **Juli 2026:** Konsistenter News-Publish (O3b): unveränderliche, bytebegrenzte Generationen mit Manifest, Pointer-last-Aktivierung, Writer-Lease, vorheriger Generation, Rollback und Garbage Collection
- **Juli 2026:** Tastatur und ArticleCard-DOM (F3a): gespeicherte Suchen per Enter/Leertaste, lokalisierte Accessible Names, Artikelaktionen außerhalb des gestreckten Links und zuverlässige Fokus-Rückgabe im Optionsdialog
- **Juli 2026:** ArticleCard-Aktualisierung (F3b): unvollständigen Memo-Sondervergleich entfernt und Änderungen aller sichtbaren Artikelfelder bei gleicher ID abgesichert
- **Juli 2026:** Persistierter Zustand (F4a): verpflichtende Laufzeit-Decoder, feste Defaults, sichere Cross-Tab-Löschung und validierte lokale News-Kopien
- **Juli 2026:** i18n-Konsistenz (F4b): Datumswerte an die App-Sprache gebunden, verbliebene UI- und ARIA-Texte nach DE/EN überführt und Sprachwechsel ohne Reload getestet
- **Juli 2026:** Admin-Mutationen (A1a): synchroner `useRef`-Latch für Feed-POST/PUT/DELETE und die gemeinsam gesperrten Ankündigungs-Mutationen, Bestätigungsdialog vor dem Löschen einer Ankündigung, Fehlerpfade erhalten Eingaben und Datensätze
- **Juli 2026:** Admin-Tabs und Health-Semantik (A1b): vollwertige ARIA-Tabs mit Pfeiltasten, benannte Aufklapp-Schaltflächen, drei getrennte Quellen-Kennzahlen mit belegbarem Snapshot-Vergleich, unscharfe Gesundmeldung entfernt, irreführende Einzelabruf-Symbole entfernt
- **Juli 2026:** Snapshot-Entdeckung (F5): der erste Versuch jeder Ladung und der Auto-Update-Poll fragen ungebunden, damit ein Browser mit gepinnter alter Generation die inzwischen aktive überhaupt sieht; erst die angenommene Antwort bindet die Folgestufen
- **Juli 2026:** Lokaler Startcache im Admin (A1c): der bewusst auf 32 Artikel begrenzte Browsercache bewertet keine Feed-Zeile mehr, sondern steht global als eigene Kennzahl mit echter Artikel- und Quellenzahl
- **Juli 2026:** Laufbericht (O4a): strukturierte Zusammenfassung je Lauf in der GitHub-Step-Summary mit Ergebnis, Dauern, Fehlerquote, Snapshot-Größen sowie Transport und beobachtetem HTTP-Status je Quelle – ohne neue KV-Schlüssel und ohne Einfluss auf Ergebnis oder Exit-Code
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
