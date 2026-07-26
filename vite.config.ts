import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
            '/api': {
                target: 'https://gamerfeed.vercel.app',
                changeOrigin: true,
            },
        },
    },
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.'),
        }
    },
    build: {
        rolldownOptions: {
            input: {
                main: path.resolve(__dirname, 'index.html'),
                admin: path.resolve(__dirname, 'admin.html'),
            },
        },
    },
});
