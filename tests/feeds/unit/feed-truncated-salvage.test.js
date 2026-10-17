import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import {
    fetchFeedXml,
    isFeedXml,
    salvageTruncatedFeed,
    salvageTruncatedFeedXml,
} from '../../../scripts/feed-fetch-utils.js';
import {
    FEED_FORMATS,
    countingResponse,
    createSyntheticFeed,
    entriesCompleteWithin,
    readEntryTitles,
} from '../helpers/synthetic-feeds.js';

// Rettung zu grosser Feeds: Ueberschreitet ein Feed die Byte-Grenze, werden die
// bis dahin vollstaendig gelesenen Eintraege ausgewertet, und nur der
// abgeschnittene Rest faellt weg. Alle Feeds sind synthetisch und stammen von
// keiner echten Quelle; kein Test beruehrt das Netz.

const ERWARTETES_ENDE = {
    rss: '</item></channel></rss>',
    rdf: '</item></rdf:RDF>',
    atom: '</entry></feed>',
    'atom-prefixed': '</atom:entry></atom:feed>',
};

// Handgeschriebener RSS-Feed fuer die Sonderfaelle: so lassen sich die Zeichen,
// auf die es ankommt, genau setzen.
const KOPF = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>T</title>\n';

function item(number, inhalt = '') {
    return `<item><title>Artikel ${number}</title>${inhalt}</item>`;
}

// === Die reine Funktion: Formate ===

test('kürzt jedes Feed-Format auf die vollständigen Einträge und schließt die offenen Elemente', () => {
    for (const format of FEED_FORMATS) {
        const feed = createSyntheticFeed(format, 6, { contentBytes: 600 });
        // Der Schnitt liegt mitten im vierten Eintrag.
        const partial = feed.xml.slice(0, feed.entryStartChars[3] + 200);

        const result = salvageTruncatedFeed(partial);

        assert.ok(result, format);
        assert.equal(result.entryCount, 3, format);
        assert.equal(result.xml, feed.xml.slice(0, feed.entryEndChars[2]) + feed.closers, format);
        assert.ok(result.xml.endsWith(ERWARTETES_ENDE[format]), `${format}: ${result.xml.slice(-40)}`);
        assert.equal(isFeedXml(result.xml), true, format);
        assert.deepEqual(readEntryTitles(result.xml), feed.titles.slice(0, 3), format);
        assert.equal(salvageTruncatedFeedXml(partial), result.xml, `${format}: dieselbe Rettung als reiner Text`);
    }
});

test('RSS 1.0 bekommt kein zusätzliches </channel>, weil channel dort neben den Einträgen steht', () => {
    const feed = createSyntheticFeed('rdf', 5, { contentBytes: 400 });
    const result = salvageTruncatedFeed(feed.xml.slice(0, feed.entryStartChars[2] + 100));

    assert.equal(result.entryCount, 2);
    assert.equal(result.xml.split('</channel>').length - 1, 1, 'das eine </channel> aus dem Kopf des Feeds');
    assert.ok(result.xml.endsWith('</item></rdf:RDF>'));
});

test('das Wurzel-Endtag folgt der Schreibweise und dem Präfix des Dokuments', () => {
    const rss = '<RSS version="2.0"><Channel>'
        + '<Item><Title>A</Title></Item><Item><Title>B</Title></Item><Item><Ti';
    assert.equal(
        salvageTruncatedFeedXml(rss),
        '<RSS version="2.0"><Channel><Item><Title>A</Title></Item><Item><Title>B</Title></Item></Channel></RSS>',
    );

    const rdf = '<RDF:RDF xmlns:RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        + '<channel/><item><title>A</title></item><item><ti';
    assert.equal(
        salvageTruncatedFeedXml(rdf),
        '<RDF:RDF xmlns:RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><channel/><item><title>A</title></item></RDF:RDF>',
    );

    const atom = '<a:feed xmlns:a="http://www.w3.org/2005/Atom"><a:entry><a:title>A</a:title></a:entry><a:entry><a:ti';
    assert.equal(
        salvageTruncatedFeedXml(atom),
        '<a:feed xmlns:a="http://www.w3.org/2005/Atom"><a:entry><a:title>A</a:title></a:entry></a:feed>',
    );
});

test('die Wurzel wird genauso bestimmt wie in isFeedXml', () => {
    for (const wurzel of [
        'rss', 'RSS', 'feed', 'atom:feed', 'foo:feed', 'rdf:RDF', 'RDF:RDF', // Feed-Wurzeln
        'rdf', 'RDF', 'html', 'channel', 'rss2', // keine Feed-Wurzeln
    ]) {
        // `item` und `entry` stehen nebeneinander: je nach Wurzel zaehlt eines.
        const eintraege = '<item><title>A</title></item><entry><title>B</title></entry>';
        const vollstaendig = `<${wurzel}>${eintraege}</${wurzel}>`;
        const abgeschnitten = `<${wurzel}>${eintraege}<item><ti`;

        assert.equal(
            salvageTruncatedFeed(abgeschnitten) !== null,
            isFeedXml(vollstaendig),
            wurzel,
        );
    }
});

// === Die reine Funktion: Schnittstellen ===

test('ein Schnitt genau hinter dem Ende-Tag behält den Eintrag, einer mitten darin nicht', () => {
    for (const format of FEED_FORMATS) {
        const feed = createSyntheticFeed(format, 4, { contentBytes: 300 });
        const ende = feed.entryEndChars[1];

        assert.equal(salvageTruncatedFeed(feed.xml.slice(0, ende)).entryCount, 2, `${format}: genau hinter </…>`);
        assert.equal(salvageTruncatedFeed(feed.xml.slice(0, ende - 1)).entryCount, 1, `${format}: das > fehlt`);
        assert.equal(salvageTruncatedFeed(feed.xml.slice(0, ende - 3)).entryCount, 1, `${format}: der Name ist abgeschnitten`);
    }
});

test('ohne vollständigen Eintrag gibt es nichts zu retten', () => {
    for (const format of FEED_FORMATS) {
        const feed = createSyntheticFeed(format, 3, { contentBytes: 300 });

        for (const position of [
            0,
            1,
            10, // mitten in der XML-Deklaration
            feed.entryStartChars[0] - 5, // im Kopf des Feeds
            feed.entryStartChars[0], // unmittelbar vor dem ersten Eintrag
            feed.entryStartChars[0] + 150, // mitten im ersten Eintrag
            feed.entryEndChars[0] - 1, // dem ersten Eintrag fehlt das letzte Zeichen
        ]) {
            const partial = feed.xml.slice(0, position);
            assert.equal(salvageTruncatedFeed(partial), null, `${format} @${position}`);
            assert.equal(salvageTruncatedFeedXml(partial), null, `${format} @${position}`);
        }
    }
});

test('nicht lesbare Eingaben liefern null statt zu werfen', () => {
    for (const eingabe of [undefined, null, 42, {}, [], true, '', ' ', '\n\n']) {
        assert.equal(salvageTruncatedFeed(eingabe), null, String(eingabe));
        assert.equal(salvageTruncatedFeedXml(eingabe), null, String(eingabe));
    }
});

test('Text, der kein Feed ist, wird nie gerettet', () => {
    const eintraege = '<item><title>A</title></item>'.repeat(3);

    for (const text of [
        `<!DOCTYPE html><html><head><title>Challenge</title></head><body>${eintraege}</body></html>`,
        `<html><body>${eintraege}</body></html>`,
        `<svg xmlns="http://www.w3.org/2000/svg">${eintraege}</svg>`,
        `<?xml version="1.0"?><root>${eintraege}</root>`,
        eintraege, // Einträge ohne Wurzel
        '{"items": [{"title": "A"}, {"title": "B"}]}',
        'Just a moment...',
        '<rss/>', // selbstschließende Wurzel
        '<rss/><item><title>A</title></item><item><ti', // Einträge neben einer geschlossenen Wurzel
        '<rss version="2.0"', // schon die Wurzel ist abgeschnitten
        '</rss>',
    ]) {
        assert.equal(salvageTruncatedFeed(text), null, text.slice(0, 50));
    }
});

test('Prolog mit BOM, Deklaration, Kommentar, Anweisung und einfacher DOCTYPE wird übersprungen', () => {
    const prolog = '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<?xml-stylesheet type="text/xsl" href="/feed.xsl"?>\n'
        + '<!-- Erzeugt von </item> -->\n'
        + '<!DOCTYPE rss PUBLIC "-//Beispiel//DTD RSS 0.91//EN" "https://beispiel.example/a>b.dtd">\n';
    const vollstaendig = `${prolog}<rss version="0.91"><channel><title>T</title>${item(1)}`;

    const result = salvageTruncatedFeed(`${vollstaendig}<item><ti`);

    assert.equal(result.entryCount, 1);
    assert.equal(result.xml, `${vollstaendig}</channel></rss>`);
});

test('eine DOCTYPE mit internem Subset wird nicht geraten', () => {
    // Im Subset können Entities stehen, die der Scanner nicht kennt - auch ein
    // leeres Subset ist deshalb kein Fall für eine Rettung.
    for (const subset of ['[<!ENTITY x "y">]', '[<!ENTITY x "y"><!ENTITY z "w">]', '[]', '[ ]']) {
        const partial = `<?xml version="1.0"?><!DOCTYPE rss ${subset}><rss><channel>`
            + `${item(1)}${item(2)}<item><ti`;

        assert.equal(salvageTruncatedFeed(partial), null, subset);
    }
});

test('ist die Wurzel schon geschlossen, bleibt der ganze Feed erhalten', () => {
    // Genau ein Zeichen Leerraum hinter </rss> kann die Grenze sprengen.
    for (const format of FEED_FORMATS) {
        const feed = createSyntheticFeed(format, 3, { contentBytes: 200 });

        const result = salvageTruncatedFeed(feed.xml);

        assert.equal(result.entryCount, 3, format);
        assert.equal(result.xml, feed.xml.trimEnd(), format);
    }
});

// === Die reine Funktion: Sonderfaelle ===

test('ein </item> als Text in einem geschlossenen CDATA-Abschnitt ist kein Eintragsende', () => {
    const cdata = '<content:encoded><![CDATA[<p>So endet ein Eintrag: </item></channel></rss></p>]]></content:encoded>';
    const vollstaendig = KOPF + item(1, cdata) + item(2, cdata);

    const result = salvageTruncatedFeed(`${vollstaendig}<item><title>Artikel 3</title><content:encoded><![CDATA[Anfang`);

    assert.equal(result.entryCount, 2);
    assert.equal(result.xml, `${vollstaendig}</channel></rss>`);
    assert.deepEqual(readEntryTitles(result.xml), ['Artikel 1', 'Artikel 2']);

    // Der Text im CDATA ist unverändert angekommen und nicht zerschnitten.
    const document = new DOMParser().parseFromString(result.xml, 'text/xml');
    assert.match(
        document.getElementsByTagName('content:encoded')[0].textContent,
        /So endet ein Eintrag: <\/item><\/channel><\/rss>/,
    );
});

test('ein </item> in einem abgeschnittenen CDATA-Abschnitt wird nicht für ein Eintragsende gehalten', () => {
    const vollstaendig = KOPF + item(1) + item(2);
    const partial = `${vollstaendig}<item><title>Artikel 3</title><content:encoded><![CDATA[Text mit </item> und mehr`;

    // Die Voraussetzung: eine einfache Textsuche fände hinter dem zweiten
    // Eintrag noch ein </item> und schnitte mitten im CDATA ab.
    assert.ok(partial.lastIndexOf('</item>') > vollstaendig.length);

    const result = salvageTruncatedFeed(partial);

    assert.equal(result.entryCount, 2);
    assert.equal(result.xml, `${vollstaendig}</channel></rss>`);
    assert.doesNotMatch(result.xml, /Artikel 3|CDATA/);
});

test('ein </item> in einem Kommentar oder einer Anweisung ist ebenfalls nur Text', () => {
    const kommentar = '<!-- ein Hinweis mit </item> und </channel> -->';
    const anweisung = '<?hinweis </item> ?>';
    const vollstaendig = KOPF + item(1, kommentar) + item(2, anweisung) + item(3, kommentar + anweisung);

    // Geschlossen: beide Abschnitte werden als Ganzes übersprungen.
    const geschlossen = salvageTruncatedFeed(`${vollstaendig}<item><ti`);
    assert.equal(geschlossen.entryCount, 3);
    assert.equal(geschlossen.xml, `${vollstaendig}</channel></rss>`);

    // Abgeschnitten: das </item> darin darf keinen Schnitt auslösen.
    for (const offen of [
        '<item><title>Artikel 4</title><!-- Hinweis mit </item> und mehr',
        '<item><title>Artikel 4</title><?hinweis </item> und mehr',
    ]) {
        const result = salvageTruncatedFeed(vollstaendig + offen);
        assert.equal(result.entryCount, 3, offen);
        assert.equal(result.xml, `${vollstaendig}</channel></rss>`, offen);
    }
});

test('ein > im Attributwert beendet das Tag nicht', () => {
    const vollstaendig = KOPF
        + item(1, '<source url="https://beispiel.example/q?a=1>2">Quelle</source>')
        + item(2, "<source url='https://beispiel.example/q?a=1>2'>Quelle</source>");

    const result = salvageTruncatedFeed(`${vollstaendig}<item><title>Artikel 3</title><source url="https://b`);

    assert.equal(result.entryCount, 2);
    assert.equal(result.xml, `${vollstaendig}</channel></rss>`);
});

test('ein Text, der mitten in einem Konstrukt endet, kostet nur den angefangenen Eintrag', () => {
    const vollstaendig = KOPF + item(1) + item(2);

    for (const ende of [
        '<item><title>Artikel 3</title><lin',
        '<item><title>Artikel 3</title><link rel',
        '<item><title>Artikel 3</title><link rel=',
        '<item><title>Artikel 3</title><link rel="',
        '<item><title>Artikel 3</title><link rel="alt',
        '<item><title>Artikel 3</title><link rel="alternate"',
        '<item><title>Artikel 3</title><link rel="alternate" ',
        '<item><title>Artikel 3</title><link rel="alternate"/',
        '<item><title>Artikel 3</title><!',
        '<item><title>Artikel 3</title><![CD',
        '<item><title>Artikel 3</title><![CDATA[',
        '<item><title>Artikel 3</title><!-',
        '<item><title>Artikel 3</title><?',
        '<item><title>Artikel 3</title></',
        '<item><title>Artikel 3</title></item',
        '<item><title>Artikel 3</title></item ',
        '<',
        '<it',
        ' ',
        '\n',
    ]) {
        const result = salvageTruncatedFeed(vollstaendig + ende);
        assert.equal(result?.entryCount, 2, JSON.stringify(ende));
        assert.equal(result?.xml, `${vollstaendig}</channel></rss>`, JSON.stringify(ende));
    }
});

test('ein nicht lesbares Konstrukt beendet das Lesen: Davor Gerettetes bleibt, dahinter wird nichts geraten', () => {
    const gut = KOPF + item(1) + item(2);

    for (const [name, beschaedigt] of [
        ['falsch geschachteltes Ende-Tag', '<item><title>Artikel 3</item>'],
        ['Ende-Tag in anderer Schreibweise', '<item><title>Artikel 3</TITLE></item>'],
        ['Ende-Tag ohne Gegenstück', '<item><title>Artikel 3</title></nichts></item>'],
        ['ein < im Text', '<item><title>Artikel < 3</title></item>'],
        ['Attribut ohne Anführungszeichen', '<item><title lang=de>Artikel 3</title></item>'],
        // Das erste Zeichen des Werts (q) kehrt vor einem > wieder: ohne die
        // Pflicht zu Anführungszeichen hielte der Scanner `>Artikel 3 ` für den Wert.
        ['Attribut ohne Anführungszeichen mit wiederkehrendem Zeichen', '<item><title lang=q>Artikel 3 q></title></item>'],
        ['Attribut ohne Wert', '<item><title lang>Artikel 3</title></item>'],
        ['Attribut ohne Gleichheitszeichen', '<item><title lang x"y">Artikel 3</title></item>'],
        ['Attribute ohne Trennung', '<item><title a="1"b="2">Artikel 3</title></item>'],
        ['< im Attributwert', '<item><title lang="a<b">Artikel 3</title></item>'],
        ['fremde Deklaration im Dokument', '<item><!ELEMENT x><title>Artikel 3</title></item>'],
    ]) {
        // Hinter dem beschädigten Eintrag folgt ein gesunder: er bleibt ungelesen.
        const result = salvageTruncatedFeed(`${gut}${beschaedigt}${item(4)}<item><ti`);

        assert.equal(result?.entryCount, 2, name);
        assert.equal(result?.xml, `${gut}</channel></rss>`, name);
        assert.deepEqual(readEntryTitles(result.xml), ['Artikel 1', 'Artikel 2'], name);

        // Liegt die Beschädigung schon im ersten Eintrag, gibt es nichts Sicheres.
        assert.equal(
            salvageTruncatedFeed(`${KOPF}${beschaedigt}${item(2)}<item><ti`),
            null,
            `${name}: im ersten Eintrag`,
        );
    }
});

test('ein verschachteltes item ist kein Eintragsende', () => {
    const innen = '<group><item><title>innen</title></item></group>';
    const vollstaendig = KOPF + item(1);

    // Der äußere Eintrag ist noch offen: das fertige innere item schneidet nicht.
    const result = salvageTruncatedFeed(`${vollstaendig}<item><title>Artikel 2</title>${innen}<link>https://b`);
    assert.equal(result.entryCount, 1);
    assert.equal(result.xml, `${vollstaendig}</channel></rss>`);

    // Ist der äußere Eintrag fertig, zählt er einmal.
    const mitInnen = vollstaendig + item(2, innen);
    const zwei = salvageTruncatedFeed(`${mitInnen}<item><ti`);
    assert.equal(zwei.entryCount, 2);
    assert.equal(zwei.xml, `${mitInnen}</channel></rss>`);
});

test('ein leeres Eintragselement ist ein vollständiger Eintrag', () => {
    const result = salvageTruncatedFeed(`${KOPF}<item/><item  /><item><ti`);

    assert.equal(result.entryCount, 2);
    assert.equal(result.xml, `${KOPF}<item/><item  /></channel></rss>`);
});

test('ein vollständiger Feed ohne Einträge hat nichts zu retten', () => {
    assert.equal(salvageTruncatedFeed('<rss version="2.0"><channel><title>T</title></channel></rss>\n'), null);
    assert.equal(salvageTruncatedFeed('<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title></feed>\n'), null);
});

test('Namen mit Nicht-ASCII-Zeichen und Leerraum vor dem > eines Tags werden gelesen', () => {
    const eintrag1 = '<item größe="1"><title>Artikel 1</title><étoile>5</étoile></item >';
    const eintrag2 = '<item><título lang="es">Artikel 2</título><link\n\trel="x"\n\thref="https://b.example/"\n/></item\n>';
    const vollstaendig = KOPF + eintrag1 + eintrag2;

    const result = salvageTruncatedFeed(`${vollstaendig}<item><ti`);

    assert.equal(result?.entryCount, 2);
    assert.equal(result?.xml, `${vollstaendig}</channel></rss>`);
});

test('Ziffern, Punkt, Bindestrich und Namensraum in Namen gehören dazu', () => {
    // Etwa ein <h1> in einem XHTML-Inhalt oder ein Attribut wie data-x1.
    const inhalt = '<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml" data-x1="1">'
        + '<h1>Überschrift</h1><p xml:lang="de">Text<br/></p><my-tag.v2 a.b-c="d"/></div></content>';
    const vollstaendig = KOPF + item(1, inhalt) + item(2, inhalt);

    const result = salvageTruncatedFeed(`${vollstaendig}<item><title>Artikel 3</title>${inhalt.slice(0, 60)}`);

    assert.equal(result?.entryCount, 2);
    assert.equal(result?.xml, `${vollstaendig}</channel></rss>`);
});

test('eine tief verschachtelte Eingabe wirft nicht und wird nicht gerettet', () => {
    // Kein Rekursionsproblem: der Scanner arbeitet iterativ.
    const tief = `<rss><channel>${'<a>'.repeat(200_000)}`;

    assert.equal(salvageTruncatedFeed(tief), null);
});

test('eine unerwartete Ausnahme im Scanner wird zu null und nie weitergereicht', () => {
    // Die Rettung läuft im Fehlerpfad einer Antwort. Würde sie dort werfen, wertete
    // fetchTextWithRetry das als Netzwerkfehler und wiederholte den Abruf - genau
    // das, was bei Übergröße nicht passieren darf.
    const original = String.prototype.charCodeAt;
    const partial = `${KOPF}${item(1)}<item><ti`;
    let result;

    String.prototype.charCodeAt = function werfen() {
        throw new Error('kaputt');
    };
    try {
        result = salvageTruncatedFeed(partial);
    } finally {
        String.prototype.charCodeAt = original;
    }

    assert.equal(result, null);
    assert.equal(salvageTruncatedFeed(partial)?.entryCount, 1, 'danach arbeitet sie wieder');
});

// === Die reine Funktion: an jeder Stelle geschnitten ===

test('an jeder Schnittstelle des Feeds ist das Ergebnis genau die Menge der vollständigen Einträge', () => {
    for (const format of FEED_FORMATS) {
        // `tricky`: Ende-Tags als Text, Kommentar, Anweisung, > im Attribut, € und 🎮.
        const feed = createSyntheticFeed(format, 3, { contentBytes: 30, tricky: true });
        const wurzelEnde = feed.xml.trimEnd().length;

        for (let position = 0; position <= feed.xml.length; position += 1) {
            // Ein Surrogatpaar zu zerschneiden ergäbe keinen gelesenen Text.
            const hoch = feed.xml.charCodeAt(position - 1);
            const tief = feed.xml.charCodeAt(position);
            if (hoch >= 0xD800 && hoch <= 0xDBFF && tief >= 0xDC00 && tief <= 0xDFFF) continue;

            const fall = `${format} @${position}`;
            const erwartet = feed.entryEndChars.filter(ende => ende <= position).length;
            const result = salvageTruncatedFeed(feed.xml.slice(0, position));

            if (erwartet === 0) {
                assert.equal(result, null, fall);
                continue;
            }

            assert.ok(result, fall);
            assert.equal(result.entryCount, erwartet, fall);
            assert.equal(
                result.xml,
                position >= wurzelEnde
                    ? feed.xml.slice(0, wurzelEnde)
                    : feed.xml.slice(0, feed.entryEndChars[erwartet - 1]) + feed.closers,
                fall,
            );
            assert.equal(isFeedXml(result.xml), true, fall);
            assert.deepEqual(readEntryTitles(result.xml), feed.titles.slice(0, erwartet), fall);
        }
    }
});

// === fetchFeedXml über der Grenze ===

const FEED_URL = 'https://feeds.example.com/news.xml';
const PROXY_URL = 'https://proxy.example.com/feed-proxy.php';

function createFetchSequence(...results) {
    const calls = [];
    const fetchImpl = async url => {
        calls.push(String(url));
        const result = results.shift();
        if (!result) throw new Error('Unexpected fetch call');
        return typeof result === 'function' ? result() : result;
    };

    return { calls, fetchImpl };
}

function fetchTestFeed(options = {}) {
    return fetchFeedXml({
        feedName: 'Beispielquelle',
        feedUrl: FEED_URL,
        logger: null,
        // Gestellter Resolver: die Testadressen existieren im DNS nicht.
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        retryDelayMs: 1,
        sleep: async () => {},
        ...options,
    });
}

test('ein zu großer Feed wird auf seine vollständigen Einträge gekürzt und als Erfolg gemeldet', async () => {
    for (const format of FEED_FORMATS) {
        const feed = createSyntheticFeed(format, 6, { contentBytes: 800 });
        // Die Grenze liegt mitten im vierten Eintrag.
        const grenze = feed.entryEndBytes[2] + 300;
        assert.equal(entriesCompleteWithin(feed, grenze), 3, 'Voraussetzung');
        assert.ok(feed.totalBytes > grenze, 'Voraussetzung: der Feed ist zu groß');

        // Die Antwort trägt keine Content-Length; gemessen werden die gelesenen Bytes.
        const fetcher = createFetchSequence(new Response(feed.xml), new Response(feed.xml));
        const pausen = [];
        const result = await fetchTestFeed({
            fetchImpl: fetcher.fetchImpl,
            maxResponseBytes: grenze,
            sleep: async verzoegerung => pausen.push(verzoegerung),
        });

        assert.equal(result.truncated, true, format);
        assert.equal(result.salvagedEntryCount, 3, format);
        assert.equal(isFeedXml(result.xmlString), true, format);
        assert.deepEqual(readEntryTitles(result.xmlString), feed.titles.slice(0, 3), format);
        assert.ok(result.xmlString.endsWith(ERWARTETES_ENDE[format]), format);
        assert.equal(result.transport, 'direct', format);
        assert.equal(result.usedProxy, false, format);
        assert.equal(result.httpStatus, 200, format);
        assert.equal(result.lastError, null, format);
        assert.equal(result.directError, null, format);
        assert.equal(fetcher.calls.length, 1, `${format}: bei Übergröße keine Wiederholung`);
        assert.deepEqual(pausen, [], `${format}: und keine Pause`);
    }
});

test('ein Feed innerhalb der Grenze bleibt unverändert und trägt kein Kennzeichen', async () => {
    const feed = createSyntheticFeed('rss', 3, { contentBytes: 500 });

    // Genau auf der Grenze ist noch nicht darüber; darunter erst recht nicht.
    for (const grenze of [feed.totalBytes, feed.totalBytes + 1000]) {
        const fetcher = createFetchSequence(new Response(feed.xml));
        const result = await fetchTestFeed({ fetchImpl: fetcher.fetchImpl, maxResponseBytes: grenze });

        assert.equal(result.xmlString, feed.xml, `Grenze ${grenze}`);
        assert.equal(result.truncated, false, `Grenze ${grenze}`);
        assert.equal(result.salvagedEntryCount, null, `Grenze ${grenze}`);
        assert.equal(result.lastError, null, `Grenze ${grenze}`);
    }
});

test('schon ein Byte über der Grenze wird als zu groß gewertet und gerettet', async () => {
    const feed = createSyntheticFeed('rss', 3, { contentBytes: 500 });
    const fetcher = createFetchSequence(new Response(feed.xml));

    // Es fehlt nur der abschließende Zeilenumbruch hinter </rss>.
    const result = await fetchTestFeed({
        fetchImpl: fetcher.fetchImpl,
        maxResponseBytes: feed.totalBytes - 1,
    });

    assert.equal(result.truncated, true);
    assert.equal(result.salvagedEntryCount, 3);
    assert.equal(result.xmlString, feed.xml.trimEnd());
});

test('liegt die Grenze im ersten Eintrag, scheitert der Feed wie bisher an der Grenze', async () => {
    for (const format of FEED_FORMATS) {
        const feed = createSyntheticFeed(format, 4, { contentBytes: 2000 });
        const grenze = feed.entryEndBytes[0] - 500;
        assert.equal(entriesCompleteWithin(feed, grenze), 0, 'Voraussetzung');

        const fetcher = createFetchSequence(new Response(feed.xml), new Response(feed.xml));
        const pausen = [];
        const result = await fetchTestFeed({
            fetchImpl: fetcher.fetchImpl,
            maxResponseBytes: grenze,
            sleep: async verzoegerung => pausen.push(verzoegerung),
        });

        assert.equal(result.xmlString, null, format);
        assert.equal(
            result.lastError,
            `Direct fetch response could not be read: response exceeds the ${grenze} byte limit`,
            format,
        );
        assert.notEqual(result.truncated, true, format);
        assert.equal(result.salvagedEntryCount, undefined, format);
        assert.equal(result.transport, 'none', format);
        assert.equal(fetcher.calls.length, 1, `${format}: ein zu großer Feed wird nicht wiederholt`);
        assert.deepEqual(pausen, [], format);
    }
});

test('eine zu große HTML-Seite wird nicht gerettet', async () => {
    const html = '<!DOCTYPE html><html><head><title>Challenge</title></head><body>'
        + `${'<item><title>x</title></item>'.repeat(100)}</body></html>`;
    const fetcher = createFetchSequence(new Response(html), new Response(html));

    const result = await fetchTestFeed({ fetchImpl: fetcher.fetchImpl, maxResponseBytes: 1000 });

    assert.equal(result.xmlString, null);
    assert.equal(result.lastError, 'Direct fetch response could not be read: response exceeds the 1000 byte limit');
    assert.notEqual(result.truncated, true);
    assert.equal(fetcher.calls.length, 1);
});

test('eine per Content-Length als zu groß angekündigte Antwort wird weiter ohne Lesen abgelehnt', async () => {
    const feed = createSyntheticFeed('rss', 6, { contentBytes: 800 });
    const grenze = feed.entryEndBytes[2] + 300;
    const { response, state } = countingResponse(feed.xml, {
        headers: { 'Content-Length': String(feed.totalBytes) },
    });

    const result = await fetchTestFeed({
        fetchImpl: createFetchSequence(response).fetchImpl,
        maxResponseBytes: grenze,
    });

    // Es wurde nichts gelesen, also gibt es auch nichts zu retten.
    assert.equal(state.chunksRead, 0, 'der Rumpf wird nicht gelesen');
    assert.equal(result.xmlString, null);
    assert.match(result.lastError, /exceeds the \d+ byte limit/);
    assert.notEqual(result.truncated, true);
});

test('nach der Grenze wird nichts mehr gelesen, und der Stream wird geschlossen', async () => {
    const feed = createSyntheticFeed('rss', 6, { contentBytes: 800 });
    const grenze = feed.entryEndBytes[2] + 300;
    const stueck = 700;
    const { response, state } = countingResponse(feed.xml, { chunkBytes: stueck });

    const result = await fetchTestFeed({
        fetchImpl: createFetchSequence(response).fetchImpl,
        maxResponseBytes: grenze,
    });

    assert.equal(result.truncated, true);
    assert.equal(result.salvagedEntryCount, 3);
    assert.equal(state.cancelled, true, 'der Stream wird geschlossen');
    // Gelesen wird bis zu dem Stück, das die Grenze überschreitet - kein Stück mehr.
    assert.equal(state.chunksRead, Math.floor(grenze / stueck) + 1);
    assert.ok(state.bytesRead < grenze + stueck);
    assert.ok(state.bytesRead < feed.totalBytes);
    // Verwertet wird höchstens, was innerhalb der Grenze lag, plus die Ende-Tags.
    assert.ok(
        Buffer.byteLength(result.xmlString) <= grenze + feed.closers.length,
        'nie mehr als die Grenze, abgesehen von den angehängten Ende-Tags',
    );
});

test('eine gerettete Antwort ersetzt den Proxy-Umweg', async () => {
    const feed = createSyntheticFeed('rss', 6, { contentBytes: 800 });
    const grenze = feed.entryEndBytes[2] + 300;
    const fetcher = createFetchSequence(new Response(feed.xml), new Response(feed.xml));

    const result = await fetchTestFeed({
        allowProxy: true,
        feedProxyUrl: PROXY_URL,
        fetchImpl: fetcher.fetchImpl,
        maxResponseBytes: grenze,
    });

    assert.equal(result.truncated, true);
    assert.equal(result.usedProxy, false);
    assert.equal(result.transport, 'direct');
    assert.equal(fetcher.calls.length, 1, 'der Proxy wird nicht kontaktiert');
});

test('ein nicht zu rettender zu großer Feed führt bei einer freigegebenen Quelle weiter zum Proxy', async () => {
    const feed = createSyntheticFeed('rss', 4, { contentBytes: 2000 });
    const grenze = feed.entryEndBytes[0] - 500;
    const kleiner = createSyntheticFeed('rss', 2, { contentBytes: 10 });
    const fetcher = createFetchSequence(new Response(feed.xml), new Response(kleiner.xml));

    const result = await fetchTestFeed({
        allowProxy: true,
        feedProxyUrl: PROXY_URL,
        fetchImpl: fetcher.fetchImpl,
        maxResponseBytes: Math.max(grenze, kleiner.totalBytes + 1),
    });

    // Die Grenze liegt weiter im ersten Eintrag des großen Feeds, der Proxy
    // liefert einen kleinen: das Verhalten vor der Rettung bleibt erhalten.
    assert.equal(entriesCompleteWithin(feed, Math.max(grenze, kleiner.totalBytes + 1)), 0, 'Voraussetzung');
    assert.equal(result.xmlString, kleiner.xml);
    assert.equal(result.transport, 'proxy');
    assert.equal(result.truncated, false);
    assert.equal(result.salvagedEntryCount, null);
    assert.match(result.directError, /exceeds the \d+ byte limit/);
    assert.equal(fetcher.calls.length, 2);
    assert.ok(fetcher.calls[1].startsWith(PROXY_URL));
});

test('eine Proxy-Antwort 413 bleibt ein Fehler ohne Rettung und ohne Wiederholung', async () => {
    const fetcher = createFetchSequence(
        new Response('Forbidden', { status: 403 }),
        new Response('Upstream response too large\n', { status: 413 }),
        // Eine Wiederholung bekäme diese Antwort - und sie ginge zu Lasten des Hostings.
        new Response(createSyntheticFeed('rss', 2).xml),
    );

    const result = await fetchTestFeed({
        allowProxy: true,
        feedProxyUrl: PROXY_URL,
        fetchImpl: fetcher.fetchImpl,
    });

    assert.equal(result.xmlString, null);
    assert.equal(result.httpStatus, 413);
    assert.match(result.proxyError, /Feed proxy failed with status 413/);
    assert.notEqual(result.truncated, true);
    assert.equal(fetcher.calls.length, 2, 'ein Direktversuch, ein Proxy-Versuch');
});

test('liefert der Proxy doch mehr als die Grenze, gilt dieselbe Rettung', async () => {
    // Der PHP-Proxy begrenzt selbst auf 5 MiB und antwortet darüber mit 413. Die
    // Rettung sitzt aber im gemeinsamen Abruf und gilt für beide Wege gleich.
    const feed = createSyntheticFeed('rss', 6, { contentBytes: 800 });
    const grenze = feed.entryEndBytes[2] + 300;
    const fetcher = createFetchSequence(
        new Response('Forbidden', { status: 403 }),
        new Response(feed.xml),
    );

    const result = await fetchTestFeed({
        allowProxy: true,
        feedProxyUrl: PROXY_URL,
        fetchImpl: fetcher.fetchImpl,
        maxResponseBytes: grenze,
    });

    assert.equal(result.truncated, true);
    assert.equal(result.salvagedEntryCount, 3);
    assert.equal(result.transport, 'proxy');
    assert.equal(result.usedProxy, true);
    assert.deepEqual(readEntryTitles(result.xmlString), feed.titles.slice(0, 3));
});
