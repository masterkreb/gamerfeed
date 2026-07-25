import { requireAdminAuth } from './server/admin-auth.js';

// Vercel Edge Middleware für den Schutz der statischen Admin-Seite.
// Die Admin-APIs prüfen die Authentifizierung zusätzlich in ihren Handlern.

export const config = {
    matcher: '/admin.html',
};

export default function middleware(request) {
    return requireAdminAuth(request) ?? undefined;
}
