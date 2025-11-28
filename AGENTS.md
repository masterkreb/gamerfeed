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
| Frontend | React 18, TypeScript, Tailwind CSS v4 |
| Build | Vite |
| Styling | Tailwind CSS v4 (lokal, NICHT CDN) mit `@tailwindcss/postcss` |
| i18n | i18next (DE/EN) |
| Backend | Vercel Serverless Functions |
| Datenbank | Neon PostgreSQL (Feed-Quellen) |
| Cache | Vercel KV (Artikel, Trends, Announcements) |
| Cron | GitHub Actions (alle 20 Min) |
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
│   └── announcement.ts     # Ankündigungs-Banner CRUD
│
├── components/
│   ├── Header.tsx          # Navigation, Theme, Refresh, Language
│   ├── FilterBar.tsx       # Such- und Filteroptionen
│   ├── ArticleCard.tsx     # Einzelne Artikel-Darstellung
│   ├── SettingsModal.tsx   # Quellen stummschalten
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
│       └── healthService.ts
│
├── contexts/
│   └── FilterContext.tsx   # Filter-State (React Context)
│
├── hooks/
│   ├── useFeeds.ts         # Feed-Daten fetchen
│   └── useLocalStorage.ts  # localStorage Hook
│
├── services/
│   ├── newsService.ts      # News-API Calls
│   └── feeds.ts            # Feed-Service
│
├── scripts/
│   └── fetch-feeds.js      # Cron-Job Script (GitHub Actions)
│
├── src/
│   └── index.css           # Tailwind Imports + Custom Styles
│
├── tailwind.config.js      # Tailwind Konfiguration
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
- ✅ ESC schließt Modals
- ✅ Focus-Ring nur bei Tastatur-Navigation
- ✅ Ankündigungs-Banner (vom Admin gesteuert)

### Backend
- ✅ Vercel KV Cache (news_cache, news_cache_16, news_cache_64)
- ✅ 120 Tage Artikel-Retention
- ✅ Feed Health Status Tracking
- ✅ KI-Trend-Analyse (täglich + wöchentlich)
- ✅ Deduplizierung nach Verlagsgruppen (SOURCE_GROUPS)

### Admin-Panel (/admin.html)
- ✅ Basic Auth geschützt
- ✅ Feed-Verwaltung (CRUD)
- ✅ Health Center (Feed-Status)
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
| `feed_health_status` | Status pro Feed |
| `daily_trends` | Tägliche KI-Trends |
| `weekly_trends` | Wöchentliche KI-Trends |
| `site_announcement` | Aktuelles Banner |

---

## 🔧 Häufige Befehle

```bash
# Development
npm run dev

# Production Build
npm run build

# Manueller Cache-Update (lokal)
node scripts/fetch-feeds.js

# Type Check
npx tsc --noEmit
```

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

- Progressive Loading funktioniert nur auf Vercel (nicht lokal mit `npm run dev`)
- Für lokales Testen: `vercel dev` nutzen
- GitHub Actions braucht Secrets: `POSTGRES_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `GROQ_API_KEY`

---

## 🔄 Letzte Änderungen

- **Nov 2025:** Tailwind CDN → Lokaler Build (v4)
- **Nov 2025:** ESC schließt Modals
- **Nov 2025:** Ankündigungs-Banner System
- **Nov 2025:** Toast Swipe-to-Dismiss (links + hoch)
- **Nov 2025:** Auto-Update mit Badge + Tab-Titel
- **Nov 2025:** 120 Tage Artikel-Retention (vorher 60)

---

## 💡 Hinweise für KI-Assistenten

1. **Commits auf Deutsch** schreiben
2. **Tailwind v4 Syntax** verwenden (keine deprecated Klassen)
3. **README.md** enthält ausführliche Architektur-Dokumentation
4. **localStorage** wird für User-Settings verwendet
5. **Vercel KV** für serverseitige Daten
6. Bei Fragen zur Architektur: README.md lesen
