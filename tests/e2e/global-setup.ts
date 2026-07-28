import { preview } from 'vite';
import { PREVIEW_PORT, PREVIEW_URL, setPreviewServer } from './preview-server';

export default async function globalSetup() {
    const server = await preview({
        preview: {
            port: PREVIEW_PORT,
            strictPort: true,
            host: '127.0.0.1',
        },
        logLevel: 'warn',
    });

    setPreviewServer(server);
    // eslint-disable-next-line no-console
    console.log(`Preview-Server läuft unter ${PREVIEW_URL}`);
}
