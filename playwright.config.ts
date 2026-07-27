import { defineConfig, devices } from '@playwright/test';

// Chromium-Grundgerüst für Browser-Abnahmen. Bewusst getrennt von `npm test`:
// die Node-Suite sucht `tests/**/*.test.js`, die Browser-Suite `*.spec.ts`.
// Dadurch startet `npm test` die Browser-Tests nicht versehentlich mit.

const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

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

    // Getestet wird der Produktions-Build, nicht der Dev-Server: dessen
    // /api-Proxy zeigt auf die produktive API.
    webServer: {
        command: `npm run build && npx vite preview --port ${PREVIEW_PORT} --strictPort`,
        url: PREVIEW_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
