import { getPreviewServer, setPreviewServer } from './preview-server';

export default async function globalTeardown() {
    const server = getPreviewServer();
    if (!server) return;

    // close() beendet den HTTP-Server im selben Prozess - es bleibt kein
    // Kindprozess zurueck, der nach dem Testlauf weiterliefe.
    await server.close();
    setPreviewServer(null);
}
