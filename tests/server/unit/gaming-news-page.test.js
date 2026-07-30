import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createGamingNewsHandler } from '../../../api/gaming-news.ts';

// SEO1: `/gaming-news` ist die bereits servergerenderte Einstiegsseite. Geprueft
// werden Struktur und wechselseitige Verlinkung, nicht das genaue Wording der
// Artikelliste.

const APP_ORIGIN = 'https://gamerfeed.vercel.app';

function article(id, overrides = {}) {
    return {
        id,
        title: `Artikel ${id}`,
        source: 'GameStar',
        publicationDate: new Date().toISOString(),
        summary: 'Zusammenfassung',
        link: `https://beispiel.example/${id}`,
        imageUrl: `https://beispiel.example/${id}.jpg`,
        language: 'de',
        ...overrides,
    };
}

/** Legacy-Cache genuegt: geprueft wird die Seite, nicht das Leseprotokoll. */
function legacyCache(articles) {
    return {
        async get(key) {
            return key === 'news_cache' ? articles : null;
        },
    };
}

async function renderPage(articles) {
    const handler = createGamingNewsHandler(legacyCache(articles), {
        legacyRollback: true,
    });
    const response = await handler(new Request(`${APP_ORIGIN}/gaming-news`));
    assert.equal(response.status, 200);

    const html = await response.text();
    return { html, document: parseHTML(html).document };
}

const SAMPLE = [
    article('1'),
    article('2', { source: 'IGN', language: 'en' }),
    article('3', { source: 'PC Gamer', language: 'en' }),
];

test('/gaming-news hat genau eine H1', async () => {
    const { document } = await renderPage(SAMPLE);
    const headings = document.querySelectorAll('h1');

    assert.equal(
        headings.length,
        1,
        `erwartet genau eine H1, gefunden ${headings.length}`,
    );
    assert.ok((headings[0].textContent ?? '').trim().length >= 5);
});

test('/gaming-news erklaert Nutzen, Quellenprinzip und Aktualisierung in eigenem Text', async () => {
    const { document } = await renderPage(SAMPLE);
    const intro = document.querySelector('[data-seo="intro"]');

    assert.ok(intro, 'kein eigenstaendiger Einleitungstext gefunden');

    const text = (intro.textContent ?? '').replace(/\s+/g, ' ').trim();
    assert.ok(
        text.length >= 120,
        `der Einleitungstext ist mit ${text.length} Zeichen zu kurz`,
    );

    // Quellenprinzip und Aktualisierung muessen benannt sein, damit der Text
    // mehr aussagt als die reine Artikelzahl darueber.
    assert.match(text, /RSS|Feed|Quellen/i);
    assert.match(text, /aktualisier|Minuten|laufend/i);

    // Der eigene Text darf keine fremde Artikelzusammenfassung wiederholen.
    for (const item of SAMPLE) {
        assert.ok(
            !text.includes(item.summary) && !text.includes(item.title),
            `der Einleitungstext uebernimmt fremde Artikelinhalte: ${item.title}`,
        );
    }
});

test('/gaming-news setzt einen Canonical auf sich selbst', async () => {
    const { document } = await renderPage(SAMPLE);
    const canonical = document.querySelector('link[rel="canonical"]');

    assert.ok(canonical, 'kein Canonical vorhanden');
    assert.equal(canonical.getAttribute('href'), `${APP_ORIGIN}/gaming-news`);
    assert.equal(
        document.querySelector('meta[name="robots"]')?.getAttribute('content'),
        'index, follow',
    );
});

test('/gaming-news verlinkt die App mit einem gewoehnlichen Link zurueck', async () => {
    const { document } = await renderPage(SAMPLE);

    const backLinks = [...document.querySelectorAll('a')].filter(node => {
        const href = node.getAttribute('href') ?? '';
        return href === APP_ORIGIN
            || href === `${APP_ORIGIN}/`
            || href === '/';
    });

    assert.ok(
        backLinks.length > 0,
        'kein Rueckweg zur App gefunden',
    );
    for (const link of backLinks) {
        assert.notEqual(
            link.getAttribute('rel'),
            'nofollow',
            'der Rueckweg zur App darf nicht auf nofollow stehen',
        );
    }
});

test('/gaming-news bleibt ohne JavaScript nutzbar und ohne verstecktes SEO-Beiwerk', async () => {
    const { html, document } = await renderPage(SAMPLE);

    assert.equal(
        document.querySelectorAll('script:not([type="application/ld+json"])').length,
        0,
        'die Seite braucht JavaScript',
    );
    assert.ok(
        !/aria-hidden\s*=\s*"true"/i.test(html),
        'die Seite enthaelt aria-hidden markierte Inhalte',
    );
    assert.ok(
        !/display\s*:\s*none/i.test(html),
        'die Seite enthaelt ausgeblendete Inhalte',
    );
    assert.ok(
        !/SearchAction/i.test(html),
        'die Seite verspricht eine SearchAction',
    );
});

test('/gaming-news nennt nur gemessene Zahlen aus dem aktiven Bestand', async () => {
    const { document } = await renderPage(SAMPLE);
    const intro = document.querySelector('[data-seo="intro"]');
    const text = (intro.textContent ?? '').replace(/\s+/g, ' ');

    // Der eigene Einleitungstext ist zeitstabil: die tatsaechlichen Zahlen
    // stehen daneben und werden aus den Daten abgeleitet.
    assert.ok(
        !/\d+\s*\+?\s*(?:[\p{L}]+[\s,]+){0,4}(?:quellen|sources)/iu.test(text),
        `der Einleitungstext verdrahtet eine Quellenzahl: ${text}`,
    );

    const hero = document.querySelector('.hero')?.textContent ?? '';
    assert.match(hero, /3 Artikel aus 3 Quellen/);
});

test('/gaming-news beschreibt die Aktualisierung als Plan, nicht als Zusage', async () => {
    const { document } = await renderPage(SAMPLE);
    const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');

    // Der Workflow ist auf 7,27,47 geplant, GitHub stellt geplante Laeufe aber
    // global in eine Warteschlange. Ein blankes "alle 20 Min." waere eine
    // Zusage, die das Projekt nicht halten kann.
    assert.match(
        text,
        /\d+\s*Min/i,
        'der Takt wird gar nicht mehr genannt',
    );

    for (const sentence of text.split(/(?<=[.;—–])\s+/)) {
        if (!/\d+\s*Min/i.test(sentence)) {
            continue;
        }
        assert.match(
            sentence,
            /geplant|ungef(?:ä|ae)hr|etwa|ca\.|circa|Verz(?:ö|oe)gerung/i,
            `Taktangabe ohne Einschraenkung: ${sentence.trim()}`,
        );
    }
});

test('/gaming-news verspricht keine Vollstaendigkeit der Quellen', async () => {
    const { document } = await renderPage(SAMPLE);
    const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');

    const match = text.match(
        /\b(?:alle[nmr]?|jede[nmrs]?|s(?:ä|ae)mtliche[nmrs]?)\s+(?:\p{L}+\s+){0,2}(?:quellen|redaktionen)\b/iu,
    );
    assert.equal(
        match,
        null,
        `Vollstaendigkeitsversprechen gefunden: ${match?.[0]}`,
    );
});

test('/gaming-news bleibt bei leerem Bestand eine ehrliche 503', async () => {
    const handler = createGamingNewsHandler(legacyCache([]), {
        legacyRollback: true,
    });
    const response = await handler(new Request(`${APP_ORIGIN}/gaming-news`));

    assert.equal(response.status, 503);
});
