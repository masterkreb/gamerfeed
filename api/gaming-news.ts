import { kv } from '@vercel/kv';
import type { Article } from '../types';

export const config = {
    runtime: 'edge',
};

function timeAgo(dateString: string): string {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 2) return 'gerade eben';
    if (diffMins < 60) return `vor ${diffMins} Min.`;
    if (diffHours < 24) return `vor ${diffHours} Std.`;
    return `vor ${diffDays} ${diffDays === 1 ? 'Tag' : 'Tagen'}`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatDateDE(date: Date): string {
    return date.toLocaleDateString('de-DE', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

export default async function handler(req: Request) {
    try {
        const articles = await kv.get<Article[]>('news_cache');

        if (!articles || articles.length === 0) {
            return new Response('Keine Artikel verfügbar.', { status: 503 });
        }

        const today = new Date();
        const todayStr = formatDateDE(today);
        const year = today.getFullYear();

        const sourcesCount = new Set(articles.map(a => a.source)).size;
        const topArticles = articles.slice(0, 20);
        const remainingCount = Math.max(0, articles.length - 20);

        // Meta description uses first 3 article titles
        const metaDesc = `Gaming News vom ${todayStr}: ${topArticles
            .slice(0, 3)
            .map(a => escapeHtml(a.title.substring(0, 55)))
            .join(' · ')}`;

        const articleRows = topArticles.map(article => {
            const isDE = article.language === 'de';
            const badgeBg = isDE ? '#EEEDFE' : '#E1F5EE';
            const badgeColor = isDE ? '#3C3489' : '#085041';

            return `
        <a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer" class="article">
            <span class="badge" style="background:${badgeBg};color:${badgeColor};">${escapeHtml(article.source)}</span>
            <div class="article-body">
                <p class="article-title">${escapeHtml(article.title)}</p>
                <p class="article-meta">${timeAgo(article.publicationDate)}</p>
            </div>
        </a>`;
        }).join('');

        const html = `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gaming News heute — ${escapeHtml(todayStr)} | GamerFeed</title>
    <meta name="description" content="${metaDesc}">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="https://gamerfeed.vercel.app/gaming-news">

    <meta property="og:title" content="Gaming News heute — ${escapeHtml(todayStr)} | GamerFeed">
    <meta property="og:description" content="${articles.length} aktuelle Gaming-Artikel aus ${sourcesCount} Quellen">
    <meta property="og:url" content="https://gamerfeed.vercel.app/gaming-news">
    <meta property="og:type" content="website">
    <meta property="og:locale" content="de_DE">

    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="Gaming News heute | GamerFeed">
    <meta name="twitter:description" content="${articles.length} aktuelle Gaming-Artikel aus ${sourcesCount} Quellen">

    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": "Gaming News heute — ${escapeHtml(todayStr)}",
        "description": "Aktuelle Gaming-Nachrichten aus ${sourcesCount} Quellen",
        "url": "https://gamerfeed.vercel.app/gaming-news",
        "publisher": {
            "@type": "Organization",
            "name": "GamerFeed",
            "url": "https://gamerfeed.vercel.app"
        }
    }
    </script>

    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
            background: #f4f4f0;
            color: #1a1a1a;
            line-height: 1.5;
        }
        .container {
            max-width: 680px;
            margin: 0 auto;
            background: #fff;
            min-height: 100vh;
            border-left: 0.5px solid #e5e5e0;
            border-right: 0.5px solid #e5e5e0;
        }
        .header {
            background: #fafaf8;
            border-bottom: 0.5px solid #e5e5e0;
            padding: 14px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .logo {
            font-size: 18px;
            font-weight: 700;
            color: #534AB7;
            text-decoration: none;
            letter-spacing: -0.3px;
        }
        .header-date {
            font-size: 13px;
            color: #888;
        }
        .hero {
            padding: 20px 20px 18px;
            border-bottom: 0.5px solid #e5e5e0;
        }
        .hero h1 {
            font-size: 22px;
            font-weight: 700;
            letter-spacing: -0.4px;
            margin-bottom: 6px;
        }
        .hero p {
            font-size: 14px;
            color: #666;
        }
        .section-label {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.09em;
            color: #bbb;
            padding: 14px 20px 8px;
        }
        .article {
            display: flex;
            gap: 12px;
            padding: 11px 20px;
            border-bottom: 0.5px solid #f0f0ec;
            text-decoration: none;
            align-items: flex-start;
            transition: background 0.1s;
        }
        .article:hover { background: #fafaf8; }
        .badge {
            font-size: 11px;
            font-weight: 600;
            padding: 3px 8px;
            border-radius: 4px;
            white-space: nowrap;
            flex-shrink: 0;
            margin-top: 1px;
        }
        .article-body { min-width: 0; }
        .article-title {
            font-size: 14px;
            font-weight: 500;
            color: #1a1a1a;
            line-height: 1.45;
            margin-bottom: 3px;
        }
        .article-meta {
            font-size: 12px;
            color: #aaa;
        }
        .more-label {
            padding: 12px 20px;
            border-bottom: 0.5px solid #f0f0ec;
        }
        .more-label p {
            font-size: 13px;
            color: #bbb;
        }
        .cta {
            margin: 20px;
            padding: 18px 20px;
            background: #EEEDFE;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
        }
        .cta-title {
            font-size: 15px;
            font-weight: 600;
            color: #3C3489;
            margin-bottom: 4px;
        }
        .cta-sub {
            font-size: 12px;
            color: #534AB7;
        }
        .cta-btn {
            display: inline-block;
            font-size: 14px;
            font-weight: 600;
            background: #534AB7;
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: 10px 18px;
            text-decoration: none;
            white-space: nowrap;
            cursor: pointer;
        }
        .cta-btn:hover { background: #3C3489; }
        .footer {
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #bbb;
            border-top: 0.5px solid #e5e5e0;
        }
        .footer a { color: #534AB7; text-decoration: none; }
        @media (max-width: 500px) {
            .cta { flex-direction: column; align-items: flex-start; }
            .hero h1 { font-size: 20px; }
        }
    </style>
</head>
<body>
<div class="container">

    <header class="header">
        <a href="https://gamerfeed.vercel.app" class="logo">GamerFeed</a>
        <span class="header-date">${escapeHtml(todayStr)}</span>
    </header>

    <div class="hero">
        <h1>Gaming News heute</h1>
        <p>${articles.length} Artikel aus ${sourcesCount} Quellen &mdash; wird alle 20 Min. aktualisiert</p>
    </div>

    <div class="section-label">Neueste Meldungen</div>

    ${articleRows}

    ${remainingCount > 0 ? `
    <div class="more-label">
        <p>+ ${remainingCount} weitere Artikel — alle in der App</p>
    </div>` : ''}

    <div class="cta">
        <div>
            <div class="cta-title">Alle News mit Bildern und Filtern</div>
            <div class="cta-sub">Dark Mode &middot; Nach Quelle filtern &middot; Favoriten speichern</div>
        </div>
        <a href="https://gamerfeed.vercel.app" class="cta-btn">Zur App &rarr;</a>
    </div>

    <footer class="footer">
        <p>
            &copy; ${year} GamerFeed &middot;
            <a href="https://gamerfeed.vercel.app">gamerfeed.vercel.app</a>
            &middot; News aus &ouml;ffentlichen RSS-Feeds
        </p>
    </footer>

</div>
</body>
</html>`;

        return new Response(html, {
            status: 200,
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                // Cache 20 minutes on edge (matches cron interval), stale ok for 1 hour
                'Cache-Control': 's-maxage=1200, stale-while-revalidate=3600',
            },
        });

    } catch (error) {
        console.error('Error in /api/gaming-news:', error);
        return new Response('Fehler beim Laden der News.', { status: 500 });
    }
}