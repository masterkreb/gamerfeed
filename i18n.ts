import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

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
            "filter.apply_one": "Show {{count}} Article",
            "filter.apply_other": "Show {{count}} Articles",
            "filter.noArticles": "No Articles to Show",
            "filter.noMatchWarning": "No articles match your filters",
            "filter.noMatchHint": "Try adjusting your selection to see more results",

            // Search Results
            "search.title": "Search Results",
            "search.titleFavorites": "Searching in Favorites",
            "search.showing_one": "{{count}} article for: ",
            "search.showing_other": "{{count}} articles for: ",
            "search.inFavorites": " in your favorites",
            "search.clearSearch": "Clear Search",

            // Favorites
            "favorites.viewing": "Viewing Your Favorites",
            "favorites.showing_one": "Showing {{count}} favorite.",
            "favorites.showing_other": "Showing all {{count}} favorites.",
            "favorites.showingFiltered_one": "Showing {{filtered}} of {{total}} favorite.",
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
            "a11y.changeLanguage": "Change language, current: {{lang}}",

            // Admin Panel
            "admin": {
                "panelTitle": "Admin Panel",
                "backToApp": "Back to App",
                "tabManagement": "Feed Management",
                "tabHealth": "Health Center",
                "tabLegend": "Health Legend",
                "failedFeedsTitle_one": "{{count}} Feed Failed in Backend",
                "failedFeedsTitle_other": "{{count}} Feeds Failed in Backend",
                "failedFeedsDesc": "The following feeds failed to be processed during the last automated backend run (GitHub Action). The details show the actual error message from the server.",
                "warningFeedsTitle_one": "{{count}} Feed with Warnings",
                "warningFeedsTitle_other": "{{count}} Feeds with Warnings",
                "warningFeedsDesc": "The following feeds were fetched successfully by the backend, but no recent articles appear on the live site. This could mean the feed is empty, outdated, or its articles were filtered out before caching.",
                "deleteModalTitle": "Delete Feed Source",
                "deleteModalConfirm": "Are you sure you want to delete \"{{name}}\"? This cannot be undone.",
                "cancel": "Cancel",
                "delete": "Delete",
                "management": {
                    "title": "All Feed Sources",
                    "total": "Total:",
                    "primary": "Primary:",
                    "secondary": "Secondary:",
                    "addNew": "Add New Feed",
                    "headerName": "Name",
                    "headerUrl": "URL",
                    "headerPriority": "Priority",
                    "headerLang": "Lang",
                    "headerInterval": "Interval",
                    "headerHealth": "Health",
                    "headerActions": "Actions",
                    "ariaCheckHealth": "Check health for {{name}}",
                    "ariaEdit": "Edit {{name}}",
                    "ariaDelete": "Delete {{name}}"
                },
                "health": {
                    "title": "Backend Feed Status",
                    "description": "Shows the result of the last automated backend fetch (GitHub Action).",
                    "refresh": "Refresh Backend Status",
                    "headerName": "Name",
                    "headerStatus": "Status",
                    "headerDetails": "Details",
                    "statusOk": "OK",
                    "statusWarning": "Warning",
                    "statusError": "Error",
                    "statusChecking": "Checking...",
                    "statusUnknown": "Unknown",
                    "detailNotProcessed": "Feed was not processed by the last backend run. Check GitHub Action logs for script errors.",
                    "detailBackendError": "Backend Error: {{message}}",
                    "detailOk": "Feed is live. The last backend fetch was successful.",
                    "detailWarningNotInCache": "Backend fetch successful, but no recent articles were found for the frontend cache. Feed name \"{{feedName}}\" not found in cache sources. The feed might be empty or outdated.",
                    "detailFetchError": "Failed to fetch status files: {{message}}"
                },
                "legend": {
                    "title": "Backend Status Legend",
                    "description": "The health status is now based entirely on the result of the last automated backend script (GitHub Action). It reflects what is actually live on the site, not a live check from your browser.",
                    "okTitle": "OK",
                    "okDesc": "The backend script successfully fetched the feed, AND its articles are present in the live `news-cache.json` file. The feed is working correctly.",
                    "warningTitle": "Warning",
                    "warningDesc": "The backend script successfully fetched the feed, but NO articles from it are in the live cache. This usually means the feed was valid but empty, or all its articles were too old to be included.",
                    "errorTitle": "Error",
                    "errorDesc": "A critical failure occurred during the backend process. This means the script could not fetch or parse the feed XML. The details column provides the specific error message from the server.",
                    "checkingTitle": "Checking",
                    "checkingDesc": "The admin panel is currently fetching the latest status reports from the backend-generated files (`feed-health-status.json` and `news-cache.json`).",
                    "unknownTitle": "Unknown",
                    "unknownDesc": "The health status for this feed has not been checked yet, or the status report could not be loaded.",
                    "errorsTitle": "Common Backend Error Explanations",
                    "errorsDesc": "When a feed check fails, it's often due to an issue with the feed provider's server. The backend script will report these issues. Here are some common ones you might see.",
                    "errorFormatMeaning": "Invalid Feed Format",
                    "errorFormatDesc": "The backend was able to download the feed, but the content was not valid XML. This often indicates the feed URL is broken or pointing to a non-feed webpage.",
                    "errorFetchMeaning": "Unreachable URL",
                    "errorFetchDesc": "The backend server could not reach the feed's URL. This could be due to a server timeout, a DNS issue, or the feed's server actively blocking requests from the script's host.",
                    "errorServerMeaning": "Server Errors",
                    "errorServerDesc": "The feed's server responded with a standard HTTP error code. 403 means access is forbidden, 404 means the URL does not exist, and 500+ errors indicate a problem on the source's server.",
                    "errorScriptMeaning": "Script Failure",
                    "errorScriptDesc": "If a feed is marked as not processed, it means the entire backend script may have failed before it could even attempt to fetch this specific feed. Check the GitHub Action logs for fatal errors."
                },
                "form": {
                    "titleEdit": "Edit Feed Source",
                    "titleAdd": "Add New Feed Source",
                    "ariaClose": "Close form",
                    "labelName": "Name",
                    "labelUrl": "URL",
                    "labelLang": "Language",
                    "labelPriority": "Priority",
                    "labelInterval": "Update Interval (minutes)",
                    "labelScraping": "Image requires scraping fallback?",
                    "errorUrlExists": "This feed URL already exists.",
                    "save": "Save"
                }
            }
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
            "filter.apply_one": "{{count}} Artikel anzeigen",
            "filter.apply_other": "{{count}} Artikel anzeigen",
            "filter.noArticles": "Keine Artikel zum Anzeigen",
            "filter.noMatchWarning": "Keine Artikel entsprechen deinen Filtern",
            "filter.noMatchHint": "Versuche deine Auswahl anzupassen, um mehr Ergebnisse zu sehen",

            // Search Results
            "search.title": "Suchergebnisse",
            "search.titleFavorites": "Suche in Favoriten",
            "search.showing_one": "{{count}} Artikel für: ",
            "search.showing_other": "{{count}} Artikel für: ",
            "search.inFavorites": " in deinen Favoriten",
            "search.clearSearch": "Suche löschen",

            // Favorites
            "favorites.viewing": "Deine Favoriten",
            "favorites.showing_one": "Zeige {{count}} Favorit.",
            "favorites.showing_other": "Zeige alle {{count}} Favoriten.",
            "favorites.showingFiltered_one": "Zeige {{filtered}} von {{total}} Favorit.",
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
            "a11y.changeLanguage": "Sprache ändern, aktuell: {{lang}}",

            // Admin Panel
            "admin": {
                "panelTitle": "Admin-Panel",
                "backToApp": "Zurück zur App",
                "tabManagement": "Feed-Verwaltung",
                "tabHealth": "System-Status",
                "tabLegend": "Status-Legende",
                "failedFeedsTitle_one": "{{count}} Feed im Backend fehlgeschlagen",
                "failedFeedsTitle_other": "{{count}} Feeds im Backend fehlgeschlagen",
                "failedFeedsDesc": "Die folgenden Feeds konnten während des letzten automatisierten Backend-Laufs (GitHub Action) nicht verarbeitet werden. Die Details zeigen die tatsächliche Fehlermeldung vom Server.",
                "warningFeedsTitle_one": "{{count}} Feed mit Warnungen",
                "warningFeedsTitle_other": "{{count}} Feeds mit Warnungen",
                "warningFeedsDesc": "Die folgenden Feeds wurden vom Backend erfolgreich abgerufen, aber es erscheinen keine aktuellen Artikel auf der Live-Seite. Das kann bedeuten, dass der Feed leer oder veraltet ist oder seine Artikel vor dem Caching herausgefiltert wurden.",
                "deleteModalTitle": "Feed-Quelle löschen",
                "deleteModalConfirm": "Möchtest du \"{{name}}\" wirklich löschen? Dies kann nicht rückgängig gemacht werden.",
                "cancel": "Abbrechen",
                "delete": "Löschen",
                "management": {
                    "title": "Alle Feed-Quellen",
                    "total": "Gesamt:",
                    "primary": "Primär:",
                    "secondary": "Sekundär:",
                    "addNew": "Neuen Feed hinzufügen",
                    "headerName": "Name",
                    "headerUrl": "URL",
                    "headerPriority": "Priorität",
                    "headerLang": "Spr.",
                    "headerInterval": "Intervall",
                    "headerHealth": "Status",
                    "headerActions": "Aktionen",
                    "ariaCheckHealth": "Status für {{name}} prüfen",
                    "ariaEdit": "{{name}} bearbeiten",
                    "ariaDelete": "{{name}} löschen"
                },
                "health": {
                    "title": "Backend-Feed-Status",
                    "description": "Zeigt das Ergebnis des letzten automatisierten Backend-Abrufs (GitHub Action).",
                    "refresh": "Backend-Status aktualisieren",
                    "headerName": "Name",
                    "headerStatus": "Status",
                    "headerDetails": "Details",
                    "statusOk": "OK",
                    "statusWarning": "Warnung",
                    "statusError": "Fehler",
                    "statusChecking": "Prüfe...",
                    "statusUnknown": "Unbekannt",
                    "detailNotProcessed": "Feed wurde beim letzten Backend-Lauf nicht verarbeitet. Überprüfe die GitHub Action-Protokolle auf Skriptfehler.",
                    "detailBackendError": "Backend-Fehler: {{message}}",
                    "detailOk": "Feed ist live. Der letzte Backend-Abruf war erfolgreich.",
                    "detailWarningNotInCache": "Backend-Abruf erfolgreich, aber es wurden keine aktuellen Artikel für den Frontend-Cache gefunden. Feed-Name \"{{feedName}}\" nicht in den Cache-Quellen gefunden. Der Feed könnte leer oder veraltet sein.",
                    "detailFetchError": "Statusdateien konnten nicht abgerufen werden: {{message}}"
                },
                "legend": {
                    "title": "Backend-Status-Legende",
                    "description": "Der Systemstatus basiert vollständig auf dem Ergebnis des letzten automatisierten Backend-Skripts (GitHub Action). Er spiegelt wider, was tatsächlich auf der Website live ist, nicht eine Live-Prüfung aus deinem Browser.",
                    "okTitle": "OK",
                    "okDesc": "Das Backend-Skript hat den Feed erfolgreich abgerufen UND seine Artikel sind in der `news-cache.json`-Datei vorhanden. Der Feed funktioniert korrekt.",
                    "warningTitle": "Warnung",
                    "warningDesc": "Das Backend-Skript hat den Feed erfolgreich abgerufen, aber KEINE Artikel davon sind im Live-Cache. Das bedeutet normalerweise, dass der Feed gültig, aber leer war oder alle Artikel zu alt waren, um aufgenommen zu werden.",
                    "errorTitle": "Fehler",
                    "errorDesc": "Während des Backend-Prozesses ist ein kritischer Fehler aufgetreten. Das bedeutet, das Skript konnte die Feed-XML nicht abrufen oder parsen. Die Detailspalte enthält die spezifische Fehlermeldung des Servers.",
                    "checkingTitle": "Prüfe",
                    "checkingDesc": "Das Admin-Panel ruft gerade die neuesten Statusberichte aus den vom Backend generierten Dateien (`feed-health-status.json` und `news-cache.json`) ab.",
                    "unknownTitle": "Unbekannt",
                    "unknownDesc": "Der Status für diesen Feed wurde noch nicht überprüft oder der Statusbericht konnte nicht geladen werden.",
                    "errorsTitle": "Häufige Backend-Fehlererklärungen",
                    "errorsDesc": "Wenn eine Feed-Überprüfung fehlschlägt, liegt das oft an einem Problem mit dem Server des Feed-Anbieters. Das Backend-Skript meldet diese Probleme. Hier sind einige häufige, die du sehen könntest.",
                    "errorFormatMeaning": "Ungültiges Feed-Format",
                    "errorFormatDesc": "Das Backend konnte den Feed herunterladen, aber der Inhalt war kein gültiges XML. Dies deutet oft darauf hin, dass die Feed-URL defekt ist oder auf eine Webseite ohne Feed verweist.",
                    "errorFetchMeaning": "URL nicht erreichbar",
                    "errorFetchDesc": "Der Backend-Server konnte die URL des Feeds nicht erreichen. Dies kann an einem Server-Timeout, einem DNS-Problem oder daran liegen, dass der Server des Feeds Anfragen vom Host des Skripts aktiv blockiert.",
                    "errorServerMeaning": "Server-Fehler",
                    "errorServerDesc": "Der Server des Feeds hat mit einem Standard-HTTP-Fehlercode geantwortet. 403 bedeutet, der Zugriff ist verboten, 404 bedeutet, die URL existiert nicht, und 500+ Fehler deuten auf ein Problem auf dem Server der Quelle hin.",
                    "errorScriptMeaning": "Skript-Fehler",
                    "errorScriptDesc": "Wenn ein Feed als nicht verarbeitet markiert ist, bedeutet das, dass das gesamte Backend-Skript möglicherweise fehlgeschlagen ist, bevor es überhaupt versuchen konnte, diesen spezifischen Feed abzurufen. Überprüfe die GitHub-Action-Protokolle auf schwerwiegende Fehler."
                },
                "form": {
                    "titleEdit": "Feed-Quelle bearbeiten",
                    "titleAdd": "Neue Feed-Quelle hinzufügen",
                    "ariaClose": "Formular schließen",
                    "labelName": "Name",
                    "labelUrl": "URL",
                    "labelLang": "Sprache",
                    "labelPriority": "Priorität",
                    "labelInterval": "Update-Intervall (Minuten)",
                    "labelScraping": "Bild erfordert Scraping-Fallback?",
                    "errorUrlExists": "Diese Feed-URL existiert bereits.",
                    "save": "Speichern"
                }
            }
        }
    }
};

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources,
        fallbackLng: 'de',
        interpolation: {
            escapeValue: false
        },
        detection: {
            order: ['localStorage', 'navigator'],
            caches: ['localStorage'],
        }
    });


// Ganz am Ende von i18n.ts:
console.log('🌍 i18n initialized! Current language:', i18n.language);

export default i18n;