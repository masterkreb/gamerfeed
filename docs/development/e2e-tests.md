# Browser-Abnahmen mit Chromium

Die Node-Suite prüft Logik über Linkedom. Echte Navigation, Cookies, Netzwerk
und Fokusverhalten lassen sich damit nicht abbilden – dafür gibt es eine kleine
Chromium-Suite.

## Ausführen

```bash
npm run test:e2e
```

Das Script baut zuerst und startet dann `vite preview`. Beim ersten Mal muss der
Browser einmalig geladen werden:

```bash
npx playwright install chromium
```

## Aufbau

| Pfad | Zweck |
|---|---|
| `playwright.config.ts` | Runner und Artefakt-Regeln |
| `tests/e2e/global-setup.ts` | startet den Preview-Server |
| `tests/e2e/global-teardown.ts` | schließt ihn wieder |
| `tests/e2e/fixtures.ts` | API-Mocks und Netzwerkschutz |
| `tests/e2e/*.spec.ts` | die Abnahmen selbst |

Die beiden Suites sind bewusst getrennt: `npm test` sucht
`tests/**/*.test.js`, die Browser-Suite `tests/e2e/**/*.spec.ts`. Dadurch
startet `npm test` den Browser nicht versehentlich mit.

## Prozessende unter Windows

Der Preview-Server wird **programmgesteuert** in `globalSetup` gestartet und in
`globalTeardown` geschlossen, beides im Playwright-Hauptprozess. `webServer`
wird nicht verwendet.

Der Grund: Über `webServer.command` gestartete Prozesse überlebten unter Windows
das Testende, sodass `npm run test:e2e` nicht zurückkehrte. Ein direkter
Node-Aufruf statt `npm`/`npx` allein genügte dafür nicht – der Vite-Prozess
blieb weiterhin aktiv. Erst der Start im selben Prozess löst das zuverlässig,
weil `server.close()` keinen Kindprozess zurücklassen kann.

Der Produktions-Build läuft im `test:e2e`-Script davor, nicht im Setup.

Nachgemessen: drei aufeinanderfolgende Läufe, jeweils Exit 0 nach 11–13
Sekunden und kein zurückbleibender `node.exe`-Prozess.

## Consent-Tests und Bot-Erkennung

CookieConsent blendet sich bei `navigator.webdriver === true` absichtlich aus
(`hideFromBots`), und genau das setzt Playwright. Ohne Gegenmaßnahme fehlt der
Banner im Testbrowser – das ist **kein** Produktionsfehler.

`disableBotDetection` aus der Fixture neutralisiert die Kennzeichnung vor dem
Seitenaufbau. Das gilt ausschließlich im Test; die Anwendung bleibt unverändert.

## Warum der Produktions-Build und nicht der Dev-Server

`npm run dev` leitet `/api` an die produktive API weiter. Getestet wird deshalb
gegen `vite preview` auf dem gebauten `dist/`.

## Netzwerkschutz

Jeder Test bekommt über die Fixture zwei Regeln:

1. `/api/*` wird vollständig gestellt. Ein **nicht** gestellter API-Pfad
   antwortet mit 501 und fällt damit auf – er wird nicht an die produktive API
   weitergereicht.
2. Jede Anfrage an eine fremde Herkunft wird abgebrochen.

Beides ist nötig, weil auch der Preview-Server `/api` nach außen weiterleitet.

**Reihenfolge beachten:** Playwright ruft den *zuletzt* registrierten passenden
Handler zuerst auf. Der Catch-all in `blockExternalRequests` verwendet deshalb
`route.fallback()` und nicht `route.continue()` – sonst übergeht er die
API-Mocks, und die Tests laufen unbemerkt gegen echte Daten. Genau dieser Fehler
ist beim Aufbau aufgetreten und wird von
`tests/e2e/smoke.spec.ts` („Netzwerkschutz") überwacht.

Blockierte externe Ressourcen erzeugen `ERR_BLOCKED_BY_CLIENT` in der Konsole.
Das ist gewolltes Verhalten und wird in der Konsolenfehler-Prüfung ausgefiltert.

## Artefakte

Screenshot, Video und Trace entstehen nur bei Fehlern. Ein grüner Lauf
hinterlässt nichts. In CI werden sie als Artefakt `playwright-report` mit
7 Tagen Aufbewahrung hochgeladen; lokal liegen sie unter `test-results/` und
sind über `.gitignore` ausgeschlossen.

## In CI

`.github/workflows/ci.yml` enthält dafür den eigenen Job
**Browser-Abnahme (Chromium)**. Er bekommt keine Schreib-Secrets und spricht
keine produktiven Endpunkte an.

## Umfang

Aktuell nur ein neutraler Rauchtest: Start der Anwendung und erste
Artikelanzeige. Fachliche Abnahmen kommen in den jeweiligen Arbeitspaketen
dazu, nicht als Vorrat.
