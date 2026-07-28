import { defineConfig, devices } from '@playwright/test';
import { PREVIEW_URL } from './tests/e2e/preview-server';

// Chromium-Grundgerüst für Browser-Abnahmen. Bewusst getrennt von `npm test`:
// die Node-Suite sucht `tests/**/*.test.js`, die Browser-Suite `*.spec.ts`.
// Dadurch startet `npm test` die Browser-Tests nicht versehentlich mit.

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/*.spec.ts',

    // In CI darf kein `test.only` durchrutschen, und ein einzelner Flake soll
    // den Lauf nicht dauerhaft rot färben.
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

    // Artefakte entstehen nur bei Fehlern; ein grüner Lauf hinterlässt nichts.
    outputDir: './test-results',
    use: {
        baseURL: PREVIEW_URL,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    // Der Preview-Server wird in globalSetup programmgesteuert gestartet und in
    // globalTeardown wieder geschlossen - beides im Playwright-Hauptprozess.
    // Ueber `webServer.command` gestartete Kindprozesse ueberlebten unter
    // Windows das Testende, sodass sich der Lauf nicht selbst beendete.
    //
    // Der Produktions-Build laeuft im test:e2e-Script davor. Getestet wird
    // bewusst nicht der Dev-Server: dessen /api-Proxy zeigt auf die produktive API.
    globalSetup: './tests/e2e/global-setup.ts',
    globalTeardown: './tests/e2e/global-teardown.ts',
});
