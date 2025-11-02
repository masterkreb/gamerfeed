// Vercel Edge Middleware für Admin-Bereich Schutz
// Funktioniert mit Vite/statischen Seiten

export const config = {
    matcher: '/admin.html',
};

export default function middleware(request) {
    const basicAuth = request.headers.get('authorization');

    // Hole Admin-Credentials aus Environment Variables
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'changeme';

    if (basicAuth) {
        const authValue = basicAuth.split(' ')[1];
        try {
            const [user, pwd] = atob(authValue).split(':');

            if (user === adminUsername && pwd === adminPassword) {
                // Authentifizierung erfolgreich - Request durchlassen
                return;
            }
        } catch (e) {
            // Fehlerhafte Auth-Header
        }
    }

    // Wenn nicht authentifiziert, fordere Login an
    return new Response('Authentication required', {
        status: 401,
        headers: {
            'WWW-Authenticate': 'Basic realm="Admin Area"',
        },
    });
}