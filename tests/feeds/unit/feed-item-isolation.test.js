import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedItems, parseRssXml } from '../../../scripts/fetch-feeds.js';

const FEED = Object.freeze({
    id: 'gamestar',
    name: 'GameStar',
    url: 'https://www.gamestar.de/feed.xml',
    language: 'de',
});

function rssItem({ title, link, pubDate, guid }) {
    return `
        <item>
            <title>${title}</title>
            <link>${link}</link>
            ${guid ? `<guid isPermaLink="false">${guid}</guid>` : ''}
            <pubDate>${pubDate}</pubDate>
            <description><![CDATA[<p>Zusammenfassung zu ${title}</p>]]></description>
        </item>`;
}

function rssFeed(items) {
    return `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
            <channel>
                <title>GameStar</title>
                ${items.join('\n')}
            </channel>
        </rss>`;
}

const GUELTIG_1 = { title: 'Erster Artikel', link: 'https://www.gamestar.de/a1', pubDate: 'Sat, 25 Jul 2026 18:37:34 +0000' };
const GUELTIG_2 = { title: 'Zweiter Artikel', link: 'https://www.gamestar.de/a2', pubDate: 'Sun, 26 Jul 2026 09:00:00 +0000' };
const GUELTIG_3 = { title: 'Dritter Artikel', link: 'https://www.gamestar.de/a3', pubDate: 'Mon, 27 Jul 2026 11:30:00 +0000' };

test('ein ungültiges Datum kostet nur dieses Element, nicht den Feed', () => {
    // Vor O2a warf `new Date(...).toISOString()` aus der Schleife heraus und
    // riss den gesamten Feed mit - die Quelle galt dann als fehlgeschlagen.
    const xml = rssFeed([
        rssItem(GUELTIG_1),
        rssItem({ title: 'Kaputtes Datum', link: 'https://www.gamestar.de/a-kaputt', pubDate: 'gestern irgendwann' }),
        rssItem(GUELTIG_2),
        rssItem(GUELTIG_3),
    ]);

    const { articles, skipped } = parseFeedItems(xml, FEED);

    assert.equal(articles.length, 3, 'alle gültigen Artikel bleiben erhalten');
    assert.deepEqual(articles.map(article => article.title), [
        'Erster Artikel',
        'Zweiter Artikel',
        'Dritter Artikel',
    ]);
    assert.equal(skipped.total, 1);
    assert.deepEqual(skipped.reasons, { invalid_date: 1 });
});

test('mehrere ungültige Daten werden einzeln gezählt', () => {
    const xml = rssFeed([
        rssItem({ ...GUELTIG_1, pubDate: 'kein Datum' }),
        rssItem(GUELTIG_2),
        rssItem({ ...GUELTIG_3, pubDate: '31.02.2026 kaputt' }),
    ]);

    const { articles, skipped } = parseFeedItems(xml, FEED);

    assert.equal(articles.length, 1);
    assert.equal(articles[0].title, 'Zweiter Artikel');
    assert.equal(skipped.reasons.invalid_date, 2);
});

test('gültige Datumsformate bleiben unverändert erhalten', () => {
    const xml = rssFeed([
        rssItem({ ...GUELTIG_1, pubDate: 'Sat, 25 Jul 2026 18:37:34 +0000' }),
        rssItem({ ...GUELTIG_2, pubDate: '2026-07-26T09:00:00Z' }),
    ]);

    const { articles, skipped } = parseFeedItems(xml, FEED);

    assert.equal(skipped.total, 0);
    assert.equal(articles[0].publicationDate, '2026-07-25T18:37:34.000Z');
    assert.equal(articles[1].publicationDate, '2026-07-26T09:00:00.000Z');
});

test('eine itembezogene Ausnahme beschädigt den restlichen Feed nicht', () => {
    // `feed.url` wird genau einmal je vollständigem Element gelesen (als Basis
    // der Link-Normalisierung). Ein Getter, der beim zweiten Zugriff wirft,
    // erzeugt damit gezielt eine unerwartete Ausnahme in Element zwei.
    let zugriffe = 0;
    const stolperFeed = {
        id: FEED.id,
        name: FEED.name,
        language: FEED.language,
        get url() {
            zugriffe += 1;
            if (zugriffe === 2) {
                throw new Error('unerwarteter Fehler mit https://geheim.example/pfad?token=abc');
            }
            return FEED.url;
        },
    };

    const xml = rssFeed([rssItem(GUELTIG_1), rssItem(GUELTIG_2), rssItem(GUELTIG_3)]);
    const { articles, skipped } = parseFeedItems(xml, stolperFeed);

    assert.equal(articles.length, 2, 'die übrigen Elemente überleben');
    assert.deepEqual(articles.map(article => article.title), ['Erster Artikel', 'Dritter Artikel']);
    assert.equal(skipped.total, 1);
    assert.deepEqual(skipped.reasons, { item_error: 1 });
});

test('der Skip-Bericht enthält weder Titel noch Adressen noch Inhalte', () => {
    const xml = rssFeed([
        rssItem(GUELTIG_1),
        rssItem({ title: 'Geheimer Titel', link: 'javascript:alert(1)', pubDate: GUELTIG_2.pubDate }),
        rssItem({ title: 'Anderer Titel', link: 'https://www.gamestar.de/a4', pubDate: 'kaputt' }),
    ]);

    const { skipped } = parseFeedItems(xml, FEED);
    const bericht = JSON.stringify(skipped);

    assert.equal(skipped.total, 2);
    assert.doesNotMatch(bericht, /Geheimer Titel|Anderer Titel/);
    assert.doesNotMatch(bericht, /javascript:|gamestar\.de/);
    assert.doesNotMatch(bericht, /Zusammenfassung/);
    // Nur Grund und Anzahl.
    assert.deepEqual(Object.keys(skipped).sort(), ['reasons', 'total']);
    for (const wert of Object.values(skipped.reasons)) {
        assert.equal(typeof wert, 'number');
    }
});

test('unvollständige und abgelehnte Elemente bekommen eigene Gründe', () => {
    const xml = rssFeed([
        rssItem(GUELTIG_1),
        rssItem({ title: '', link: 'https://www.gamestar.de/ohne-titel', pubDate: GUELTIG_2.pubDate }),
        rssItem({ title: 'Ohne Link', link: '', pubDate: GUELTIG_2.pubDate }),
        rssItem({ title: 'Verbotenes Schema', link: 'javascript:alert(1)', pubDate: GUELTIG_2.pubDate }),
        rssItem({ title: 'Kaputtes Datum', link: 'https://www.gamestar.de/a9', pubDate: 'nope' }),
    ]);

    const { articles, skipped } = parseFeedItems(xml, FEED);

    assert.equal(articles.length, 1);
    assert.equal(skipped.total, 4);
    assert.equal(skipped.reasons.incomplete, 2);
    assert.equal(skipped.reasons.invalid_link, 1);
    assert.equal(skipped.reasons.invalid_date, 1);
});

test('ein fehlerfreier Feed meldet keine übersprungenen Elemente', () => {
    const { articles, skipped } = parseFeedItems(
        rssFeed([rssItem(GUELTIG_1), rssItem(GUELTIG_2)]),
        FEED,
    );

    assert.equal(articles.length, 2);
    assert.deepEqual(skipped, { total: 0, reasons: {} });
});

test('parseRssXml bleibt als reine Artikelliste erhalten', () => {
    // Bestehende Aufrufer sollen unverändert weiterarbeiten können.
    const xml = rssFeed([
        rssItem(GUELTIG_1),
        rssItem({ ...GUELTIG_2, pubDate: 'kaputt' }),
    ]);

    const articles = parseRssXml(xml, FEED);

    assert.ok(Array.isArray(articles));
    assert.equal(articles.length, 1);
    assert.equal(articles[0].title, 'Erster Artikel');
});

test('ein nicht parsebarer Feed bleibt ein Feed-Fehler, kein Item-Fehler', () => {
    // Die Unterscheidung ist wichtig: hier ist wirklich die ganze Quelle
    // unbrauchbar, nicht nur ein Element.
    assert.throws(() => parseFeedItems('<html><body>keine Feeds hier</body></html>', FEED));
    assert.throws(() => parseFeedItems('', FEED));
});
