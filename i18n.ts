import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
    en: {
        translation: {
            // Header
            "header.title": "GamerFeed",
            "header.refresh": "Refresh news",
            "header.toggleTheme": "Toggle theme",
            "header.openSettings": "Open settings",
            "header.backToApp": "Back to App",

            // View Modes
            "viewMode.grid": "Grid View",
            "viewMode.list": "List View",
            "viewMode.compact": "Compact View",

            // Filter Bar
            "filter.search.placeholder": "Search articles by keyword...",
            "filter.search.clear": "Clear search",
            "filter.search.save": "Save",
            "filter.search.saved": "Saved",
            "filter.search.savedSearches": "Saved Searches",
            "filter.time.label": "Time",
            "filter.time.all": "All Time",
            "filter.time.today": "Today",
            "filter.time.yesterday": "Yesterday",
            "filter.time.7d": "Last 7 days",
            "filter.language.label": "Language",
            "filter.language.all": "All",
            "filter.source.label": "Source",
            "filter.source.allSources": "All Sources ({{count}})",
            "filter.source.allGerman": "All German ({{count}})",
            "filter.source.allEnglish": "All English ({{count}})",
            "filter.source.germanSources": "German Sources",
            "filter.source.englishSources": "English Sources",
            "filter.favorites": "Favorites",
            "filter.reset": "Reset",
            "filter.filters": "Filters",
            "filter.apply": "Show {{count}} Article",
            "filter.apply_other": "Show {{count}} Articles",
            "filter.noArticles": "No Articles to Show",
            "filter.noMatchWarning": "No articles match your filters",
            "filter.noMatchHint": "Try adjusting your selection to see more results",

            // Search Results
            "search.title": "Search Results",
            "search.titleFavorites": "Searching in Favorites",
            "search.showing": "{{count}} article for: ",
            "search.showing_other": "{{count}} articles for: ",
            "search.inFavorites": " in your favorites",
            "search.clearSearch": "Clear Search",

            // Favorites
            "favorites.viewing": "Viewing Your Favorites",
            "favorites.showing": "Showing all {{count}} favorite.",
            "favorites.showing_other": "Showing all {{count}} favorites.",
            "favorites.showingFiltered": "Showing {{filtered}} of {{total}} favorite.",
            "favorites.showingFiltered_other": "Showing {{filtered}} of {{total}} favorites.",
            "favorites.noMatch": "No favorites match your current filters.",
            "favorites.resetToViewAll": "Reset to view all",
            "favorites.viewAll": "View All Articles",
            "favorites.none": "No Favorites Yet",
            "favorites.noneHint": "Click the star icon",
            "favorites.noneHint2": "on an article to save it here.",
            "favorites.browseAll": "Browse All Articles",

            // Article Card
            "article.addToFavorites": "Add to favorites",
            "article.removeFromFavorites": "Remove from favorites",
            "article.moreOptions": "More options",
            "article.share": "Share",
            "article.copyLink": "Copy Link",
            "article.copied": "Copied!",
            "article.mute": "Mute {{source}}",
            "article.back": "Back",
            "article.articleOptions": "Article Options",

            // Share Options
            "share.x": "X",
            "share.facebook": "Facebook",
            "share.reddit": "Reddit",
            "share.whatsapp": "WhatsApp",
            "share.email": "Email",

            // Time Formats
            "time.today": "Today at {{time}}",
            "time.yesterday": "Yesterday at {{time}}",

            // Empty States
            "empty.noResults": "No results for \"{{query}}\"",
            "empty.noResultsHint": "Try checking your spelling or using different keywords.",
            "empty.noFavorites": "No Favorites Yet",
            "empty.noFavoritesHint": "Click the star icon on an article to save it here.",
            "empty.noMatch": "No Articles Match Your Filters",
            "empty.noMatchHint": "Try adjusting your selection or reset all filters.",
            "empty.noArticles": "No Articles Found",
            "empty.noArticlesHint": "There are currently no articles to display. Please check back later.",

            // Settings
            "settings.title": "Settings",
            "settings.close": "Close settings",
            "settings.done": "Done",
            "settings.manage": "Manage Feed Sources",
            "settings.manageHint": "Check a source to hide it from your feed and the filter menu.",
            "settings.noSources": "No sources loaded yet.",
            "settings.germanSources": "German Sources",
            "settings.englishSources": "English Sources",
            "settings.unmuteAll": "Unmute All",

            // Toast Messages
            "toast.sourceMuted": "\"{{source}}\" has been muted. Manage in Settings (⚙️).",
            "toast.undo": "Undo",
            "toast.favoriteAdded": "Article added to favorites.",

            // Footer
            "footer.rights": "All rights reserved.",
            "footer.tagline": "Made with ❤️ for gaming enthusiasts. News sourced from various public RSS feeds.",

            // Loading & Errors
            "loading.articles": "Loading articles...",
            "loading.refreshing": "Refreshing articles...",
            "error.couldNotLoad": "Could not load news",
            "error.tryAgain": "Try Again",
            "error.generic": "Oops! Something went wrong.",
            "error.genericHint": "An unexpected error occurred which prevented the application from loading correctly. You can try to refresh the page to resolve the issue.",
            "error.genericHintPersist": "If the problem persists, please check back later.",
            "error.refreshPage": "Refresh Page",

            // Accessibility
            "a11y.skipToContent": "Skip to main content",
        }
    },
    de: {
        translation: {
            // Header
            "header.title": "GamerFeed",
            "header.refresh": "News aktualisieren",
            "header.toggleTheme": "Design wechseln",
            "header.openSettings": "Einstellungen öffnen",
            "header.backToApp": "Zurück zur App",

            // View Modes
            "viewMode.grid": "Kachelansicht",
            "viewMode.list": "Listenansicht",
            "viewMode.compact": "Kompaktansicht",

            // Filter Bar
            "filter.search.placeholder": "Artikel nach Stichwort durchsuchen...",
            "filter.search.clear": "Suche löschen",
            "filter.search.save": "Speichern",
            "filter.search.saved": "Gespeichert",
            "filter.search.savedSearches": "Gespeicherte Suchen",
            "filter.time.label": "Zeitraum",
            "filter.time.all": "Alle",
            "filter.time.today": "Heute",
            "filter.time.yesterday": "Gestern",
            "filter.time.7d": "Letzte 7 Tage",
            "filter.language.label": "Sprache",
            "filter.language.all": "Alle",
            "filter.source.label": "Quelle",
            "filter.source.allSources": "Alle Quellen ({{count}})",
            "filter.source.allGerman": "Alle Deutschen ({{count}})",
            "filter.source.allEnglish": "Alle Englischen ({{count}})",
            "filter.source.germanSources": "Deutsche Quellen",
            "filter.source.englishSources": "Englische Quellen",
            "filter.favorites": "Favoriten",
            "filter.reset": "Zurücksetzen",
            "filter.filters": "Filter",
            "filter.apply": "{{count}} Artikel anzeigen",
            "filter.apply_other": "{{count}} Artikel anzeigen",
            "filter.noArticles": "Keine Artikel zum Anzeigen",
            "filter.noMatchWarning": "Keine Artikel entsprechen deinen Filtern",
            "filter.noMatchHint": "Versuche deine Auswahl anzupassen, um mehr Ergebnisse zu sehen",

            // Search Results
            "search.title": "Suchergebnisse",
            "search.titleFavorites": "Suche in Favoriten",
            "search.showing": "{{count}} Artikel für: ",
            "search.showing_other": "{{count}} Artikel für: ",
            "search.inFavorites": " in deinen Favoriten",
            "search.clearSearch": "Suche löschen",

            // Favorites
            "favorites.viewing": "Deine Favoriten",
            "favorites.showing": "Zeige {{count}} Favorit.",
            "favorites.showing_other": "Zeige alle {{count}} Favoriten.",
            "favorites.showingFiltered": "Zeige {{filtered}} von {{total}} Favorit.",
            "favorites.showingFiltered_other": "Zeige {{filtered}} von {{total}} Favoriten.",
            "favorites.noMatch": "Keine Favoriten entsprechen deinen aktuellen Filtern.",
            "favorites.resetToViewAll": "Zurücksetzen, um alle anzuzeigen",
            "favorites.viewAll": "Alle Artikel anzeigen",
            "favorites.none": "Noch keine Favoriten",
            "favorites.noneHint": "Klicke auf das Stern-Symbol",
            "favorites.noneHint2": "bei einem Artikel, um ihn hier zu speichern.",
            "favorites.browseAll": "Alle Artikel durchsuchen",

            // Article Card
            "article.addToFavorites": "Zu Favoriten hinzufügen",
            "article.removeFromFavorites": "Aus Favoriten entfernen",
            "article.moreOptions": "Weitere Optionen",
            "article.share": "Teilen",
            "article.copyLink": "Link kopieren",
            "article.copied": "Kopiert!",
            "article.mute": "{{source}} stummschalten",
            "article.back": "Zurück",
            "article.articleOptions": "Artikel-Optionen",

            // Share Options
            "share.x": "X",
            "share.facebook": "Facebook",
            "share.reddit": "Reddit",
            "share.whatsapp": "WhatsApp",
            "share.email": "E-Mail",

            // Time Formats
            "time.today": "Heute um {{time}}",
            "time.yesterday": "Gestern um {{time}}",

            // Empty States
            "empty.noResults": "Keine Ergebnisse für \"{{query}}\"",
            "empty.noResultsHint": "Überprüfe deine Rechtschreibung oder verwende andere Suchbegriffe.",
            "empty.noFavorites": "Noch keine Favoriten",
            "empty.noFavoritesHint": "Klicke auf das Stern-Symbol bei einem Artikel, um ihn hier zu speichern.",
            "empty.noMatch": "Keine Artikel entsprechen deinen Filtern",
            "empty.noMatchHint": "Passe deine Auswahl an oder setze alle Filter zurück.",
            "empty.noArticles": "Keine Artikel gefunden",
            "empty.noArticlesHint": "Es gibt derzeit keine Artikel anzuzeigen. Bitte schau später wieder vorbei.",

            // Settings
            "settings.title": "Einstellungen",
            "settings.close": "Einstellungen schließen",
            "settings.done": "Fertig",
            "settings.manage": "Feed-Quellen verwalten",
            "settings.manageHint": "Wähle eine Quelle aus, um sie aus deinem Feed und dem Filtermenü auszublenden.",
            "settings.noSources": "Noch keine Quellen geladen.",
            "settings.germanSources": "Deutsche Quellen",
            "settings.englishSources": "Englische Quellen",
            "settings.unmuteAll": "Alle einblenden",

            // Toast Messages
            "toast.sourceMuted": "\"{{source}}\" wurde stummgeschaltet. Verwalten in den Einstellungen (⚙️).",
            "toast.undo": "Rückgängig",
            "toast.favoriteAdded": "Artikel zu Favoriten hinzugefügt.",

            // Footer
            "footer.rights": "Alle Rechte vorbehalten.",
            "footer.tagline": "Mit ❤️ für Gaming-Enthusiasten gemacht. News von verschiedenen öffentlichen RSS-Feeds.",

            // Loading & Errors
            "loading.articles": "Lade Artikel...",
            "loading.refreshing": "Aktualisiere Artikel...",
            "error.couldNotLoad": "News konnten nicht geladen werden",
            "error.tryAgain": "Erneut versuchen",
            "error.generic": "Hoppla! Etwas ist schiefgelaufen.",
            "error.genericHint": "Ein unerwarteter Fehler ist aufgetreten, der das Laden der Anwendung verhindert hat. Du kannst versuchen, die Seite zu aktualisieren, um das Problem zu beheben.",
            "error.genericHintPersist": "Wenn das Problem weiterhin besteht, schau bitte später noch einmal vorbei.",
            "error.refreshPage": "Seite aktualisieren",

            // Accessibility
            "a11y.skipToContent": "Zum Hauptinhalt springen",
        }
    }
};

i18n
    .use(initReactI18next)
    .init({
        resources,
        lng: 'de', // Standard: Deutsch
        fallbackLng: 'en',
        interpolation: {
            escapeValue: false
        }
    });


// Ganz am Ende von i18n.ts:
console.log('🌍 i18n initialized! Current language:', i18n.language);

export default i18n;