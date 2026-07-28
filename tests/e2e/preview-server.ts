import type { PreviewServer } from 'vite';

// Der Preview-Server wird programmgesteuert im Playwright-Hauptprozess
// gestartet und beendet, statt ihn ueber `webServer.command` als Kindprozess
// zu starten. Unter Windows ueberlebten dessen Prozesse das Testende, sodass
// sich `npm run test:e2e` nicht mehr selbst beendete.
//
// globalSetup und globalTeardown laufen im selben Prozess, teilen sich also
// dieses Modul und damit die Instanz.

export const PREVIEW_PORT = 4173;
export const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

let server: PreviewServer | null = null;

export function setPreviewServer(instance: PreviewServer | null) {
    server = instance;
}

export function getPreviewServer() {
    return server;
}
