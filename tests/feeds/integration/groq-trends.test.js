import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../scripts/fetch-feeds.js';
import { GROQ_REASONING_RESERVE_TOKENS } from '../../../scripts/groq-client.js';
import { createSpies, feedFetch, runMain as startMain } from '../helpers/feed-run-harness.js';

// Die Trendphase gegen das echte `main()` mit injizierten Außenkanten: kein
// Groq, kein KV, kein Netz. Geprüft wird, was an Groq gesendet wird, wie die
// Antwort ausgewertet wird und was im Protokoll steht, wenn sie nicht passt.
//
// Die Tagestrends berücksichtigen nur Artikel der letzten 24 Stunden. Die
// Standardquelle der Lauf-Tests liefert Artikel von Juli 2026 und würde Groq gar
// nicht erst erreichen; deshalb baut dieses Modul einen Feed mit frischen Daten.

async function runMain(spies, overrides = {}) {
    return startMain(main, spies, { sleep: async () => {}, ...overrides });
}

function frischerFeed(titel) {
    const eintraege = titel.map((text, index) => `
<item>
  <title>${text}</title>
  <link>https://testquelle.example/artikel-${index + 1}</link>
  <guid isPermaLink="false">frisch-${index + 1}</guid>
  <pubDate>${new Date(Date.now() - (index + 1) * 60_000).toUTCString()}</pubDate>
  <description><![CDATA[<p>Text</p>]]></description>
</item>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Quelle</title>${eintraege}
</channel></rss>`;
}

function groqAntwort(content, { finishReason = 'stop' } = {}) {
    return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content }, finish_reason: finishReason }],
    }), { status: 200 });
}

/** Antwortet je nach angefordertem Schema; ein anderes Format lässt den Aufruf scheitern. */
function groqNachSchema(antworten) {
    return async (_url, init) => {
        const name = JSON.parse(init.body).response_format?.json_schema?.name;
        if (!Object.hasOwn(antworten, name)) {
            throw new Error(`unerwartetes Antwortformat: ${name}`);
        }
        return antworten[name]();
    };
}

const trend = (topic, articleCount) => ({ topic, summary: `Zusammenfassung ${topic}`, articleCount });

const WOCHE_GUELTIG = () => groqAntwort(JSON.stringify({ overallSummary: 'Wochenfazit', trends: [trend('Thema A', 12)] }));

/** Datumsschlüssel wie `getDateKey` im Cron-Skript (UTC). */
function datumsschluessel(tageZurueck) {
    const tag = new Date();
    tag.setUTCDate(tag.getUTCDate() - tageZurueck);
    return tag.toISOString().substring(0, 10);
}

/** Legt einen Archiveintrag eines früheren Tages ab, damit die Wochenphase Daten hat. */
function archiviere(spies, tageZurueck, trends) {
    spies.kvStore[`daily_trends_archive:${datumsschluessel(tageZurueck)}`] = {
        trends,
        updatedAt: '2026-10-01T12:00:00.000Z',
    };
}

/** Sieben Einträge aus zwei Tagen: genug für die Wochenphase (mindestens fünf). */
function archiviereEineWoche(spies) {
    archiviere(spies, 1, [trend('Thema A', 4), trend('Thema B', 3), trend('Thema C', 2)]);
    archiviere(spies, 2, [trend('Thema A', 5), trend('Thema D', 1)]);
}

function gesendeteRumpfe(spies) {
    return spies.groqCalls.map(aufruf => JSON.parse(aufruf.init.body));
}

/** Alle Archivschlüssel der Tagestrends im Speicher. */
function archivschluessel(spies) {
    return Object.keys(spies.kvStore).filter(key => key.startsWith('daily_trends_archive:'));
}

/** Der Teil einer Logzeile hinter "Response shape: ". */
function formzeile(spies, meldung) {
    const zeile = spies.logLines.find(eintrag => eintrag.includes(meldung));
    assert.ok(zeile, `Logzeile fehlt: ${meldung}`);
    assert.match(zeile, /Response shape: /);
    return zeile.split('Response shape: ')[1];
}

// === Erwartete Schemas, bewusst ausgeschrieben statt aus dem Cron-Skript importiert ===

const ERWARTETES_TAGESFORMAT = {
    type: 'json_schema',
    json_schema: {
        name: 'daily_trends',
        strict: true,
        schema: {
            type: 'object',
            properties: {
                trends: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            topic: { type: 'string' },
                            summary: { type: 'string' },
                            articleCount: { type: 'integer' },
                        },
                        required: ['topic', 'summary', 'articleCount'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['trends'],
            additionalProperties: false,
        },
    },
};

const ERWARTETES_WOCHENFORMAT = {
    type: 'json_schema',
    json_schema: {
        name: 'weekly_trends',
        strict: true,
        schema: {
            type: 'object',
            properties: {
                overallSummary: { type: 'string' },
                trends: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            topic: { type: 'string' },
                            summary: { type: 'string' },
                            articleCount: { type: 'integer' },
                        },
                        required: ['topic', 'summary', 'articleCount'],
                        additionalProperties: false,
                    },
                },
            },
            required: ['overallSummary', 'trends'],
            additionalProperties: false,
        },
    },
};

/** Ein Lauf, in dem sowohl die Tages- als auch die Wochenphase Groq erreichen. */
async function laufMitBeidenAufrufen() {
    const spies = createSpies();
    archiviereEineWoche(spies);

    await runMain(spies, {
        fetchImpl: feedFetch(spies, { xml: frischerFeed(['Titel Eins', 'Titel Zwei']) }),
        groqFetch: spies.makeGroqFetch(groqNachSchema({
            daily_trends: () => groqAntwort(JSON.stringify({ trends: [trend('Thema E', 2)] })),
            weekly_trends: WOCHE_GUELTIG,
        })),
    });

    return { spies, rumpfe: gesendeteRumpfe(spies) };
}

// === Gesendetes Schema ===

test('Tages- und Wochenaufruf senden ihr strenges Schema als response_format', async () => {
    const { spies, rumpfe } = await laufMitBeidenAufrufen();

    assert.deepEqual(spies.exitCodes, []);
    assert.equal(rumpfe.length, 2, 'ein Tages- und ein Wochenaufruf');
    assert.deepEqual(rumpfe[0].response_format, ERWARTETES_TAGESFORMAT);
    assert.deepEqual(rumpfe[1].response_format, ERWARTETES_WOCHENFORMAT);

    // Die übrigen Angaben bleiben, wie sie waren.
    assert.equal(rumpfe[0].max_completion_tokens, 1500 + GROQ_REASONING_RESERVE_TOKENS);
    assert.equal(rumpfe[1].max_completion_tokens, 2000 + GROQ_REASONING_RESERVE_TOKENS);
    for (const rumpf of rumpfe) {
        assert.equal(rumpf.model, 'openai/gpt-oss-20b');
        assert.equal(rumpf.reasoning_effort, 'low');
        assert.equal(rumpf.include_reasoning, false);
        assert.equal('reasoning_format' in rumpf, false);
    }
});

const UNTERSTUETZTE_TYPEN = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean']);

/**
 * Die Pflichtregeln für `strict: true` laut Groq-Doku: alle Felder sind
 * `required`, jedes Objekt setzt `additionalProperties: false`.
 */
function strictVerstoesse(schema, pfad = '$') {
    if (!UNTERSTUETZTE_TYPEN.has(schema?.type)) {
        return [`${pfad}: Typ ${JSON.stringify(schema?.type)} ist nicht unterstützt`];
    }

    const verstoesse = [];
    if (schema.type === 'object') {
        const felder = Object.keys(schema.properties ?? {});
        if (schema.additionalProperties !== false) {
            verstoesse.push(`${pfad}: additionalProperties muss false sein`);
        }
        if (JSON.stringify([...(schema.required ?? [])].sort()) !== JSON.stringify([...felder].sort())) {
            verstoesse.push(`${pfad}: required muss genau alle Felder nennen`);
        }
        for (const feld of felder) {
            verstoesse.push(...strictVerstoesse(schema.properties[feld], `${pfad}.${feld}`));
        }
    }
    if (schema.type === 'array') {
        verstoesse.push(...strictVerstoesse(schema.items, `${pfad}[]`));
    }
    return verstoesse;
}

test('beide gesendeten Schemas erfüllen die Pflichtregeln für strict: true', async () => {
    const { rumpfe } = await laufMitBeidenAufrufen();

    for (const rumpf of rumpfe) {
        const format = rumpf.response_format;
        const name = format.json_schema.name;

        assert.equal(format.type, 'json_schema', name);
        assert.equal(format.json_schema.strict, true, name);
        assert.match(name, /^[A-Za-z0-9_-]{1,64}$/, 'der Name ist ein schlichter Bezeichner');
        assert.equal(format.json_schema.schema.type, 'object', `${name}: die Wurzel ist ein Objekt`);
        assert.deepEqual(strictVerstoesse(format.json_schema.schema), [], name);
    }
});

test('der Prüfer für strict: true erkennt Verstöße wirklich', () => {
    // Ohne diesen Gegenbeweis wäre ein Prüfer, der nie etwas findet, unbemerkt.
    const verstoesse = strictVerstoesse({
        type: 'object',
        properties: {
            a: { type: 'string' },
            b: { type: 'array', items: { type: 'object', properties: { c: { type: 'string' } }, required: [] } },
            d: { type: 'tuple' },
        },
        required: ['a'],
    });

    assert.deepEqual(verstoesse, [
        '$: additionalProperties muss false sein',
        '$: required muss genau alle Felder nennen',
        '$.b[]: additionalProperties muss false sein',
        '$.b[]: required muss genau alle Felder nennen',
        '$.d: Typ "tuple" ist nicht unterstützt',
    ]);
});

// === Prompt ===

test('der Tagesprompt fordert das Objekt mit trends und behält seine Regeln', async () => {
    const { rumpfe } = await laufMitBeidenAufrufen();
    const prompt = rumpfe[0].messages[1].content;

    // Die Formatvorgabe am Ende passt zum Schema.
    assert.match(prompt, /Antworte NUR im JSON-Format, keine Erklärungen:\s*\{\s*"trends": \[\s*\{"topic": "GTA 6"/);
    assert.doesNotMatch(prompt, /keine Erklärungen:\s*\[/, 'kein bares Array mehr');

    // Die inhaltlichen Regeln und die Titel sind unverändert vorhanden.
    assert.match(prompt, /die 5 wichtigsten Themen\/Trends/);
    assert.match(prompt, /Suche nach SPEZIFISCHEN Themen/);
    assert.match(prompt, /Zähle wie oft jedes Thema ungefähr vorkommt/);
    assert.match(prompt, /max 10 Wörter/);
    assert.match(prompt, /1\. Titel Eins\n2\. Titel Zwei/);
    assert.equal(rumpfe[0].messages[0].role, 'system');
});

test('der Wochenprompt fordert weiterhin das Objekt mit overallSummary und trends', async () => {
    const { rumpfe } = await laufMitBeidenAufrufen();
    const prompt = rumpfe[1].messages[1].content;

    assert.match(prompt, /Antworte NUR im JSON-Format:\s*\{\s*"overallSummary": /);
    assert.match(prompt, /"trends": \[/);
    assert.match(prompt, /1\. Thema A \(9 Artikel diese Woche\)/);
});

// === Tagestrends auswerten ===

test('Tagestrends werden aus { trends: [...] } gelesen, begrenzt und sortiert', async () => {
    const spies = createSpies();
    const antwort = [
        trend('Thema 1', 3), trend('Thema 2', 9), trend('Thema 3', 5), trend('Thema 4', 1),
        trend('Thema 5', 7), trend('Thema 6', 8), trend('Thema 7', 2),
    ];

    await runMain(spies, {
        fetchImpl: feedFetch(spies, { xml: frischerFeed(['Titel Eins']) }),
        groqFetch: spies.makeGroqFetch(groqNachSchema({
            daily_trends: () => groqAntwort(JSON.stringify({ trends: antwort })),
            weekly_trends: WOCHE_GUELTIG,
        })),
    });

    // Die ersten fünf der Antwort, nach articleCount absteigend.
    const erwartet = [antwort[1], antwort[4], antwort[2], antwort[0], antwort[3]];
    assert.deepEqual(spies.exitCodes, []);
    assert.ok(Array.isArray(spies.kvStore.daily_trends.trends), 'gespeichert wird ein Array, nicht das Objekt');
    assert.deepEqual(spies.kvStore.daily_trends.trends, erwartet);
    assert.equal(typeof spies.kvStore.daily_trends.updatedAt, 'string');

    // Das Archiv bekommt dasselbe Array.
    const archive = archivschluessel(spies);
    assert.equal(archive.length, 1);
    assert.deepEqual(spies.kvStore[archive[0]].trends, erwartet);

    assert.equal(spies.logLines.some(zeile => zeile.includes('Response shape')), false);
    assert.ok(spies.logLines.some(zeile => zeile.includes('Daily trends saved to LIVE cache')));
});

test('ein leeres trends-Array ist eine gültige Antwort und kein Formfehler', async () => {
    const spies = createSpies();

    await runMain(spies, {
        fetchImpl: feedFetch(spies, { xml: frischerFeed(['Titel Eins']) }),
        groqFetch: spies.makeGroqFetch(groqNachSchema({
            daily_trends: () => groqAntwort('{"trends":[]}'),
        })),
    });

    assert.deepEqual(spies.exitCodes, []);
    assert.deepEqual(spies.kvStore.daily_trends.trends, []);
    assert.deepEqual(archivschluessel(spies), [], 'nichts Leeres im Archiv');
    assert.equal(spies.groqCalls.length, 1, 'ohne Archiv gibt es keinen Wochenaufruf');
    assert.equal(spies.logLines.some(zeile => zeile.includes('Response shape')), false);
});

// === Falsche Form: überspringen und nur die Form protokollieren ===

const TAGES_MELDUNG = 'Groq daily trends are not an object with a "trends" array. Skipping.';

const FALSCHE_TAGESFORMEN = [
    {
        name: 'bares Array (die frühere Form)',
        content: '[{"topic":"Geheimes Thema","summary":"Geheime Zusammenfassung","articleCount":3}]',
        form: 'finish_reason=stop top_level=array',
    },
    {
        name: 'Objekt ohne trends',
        content: '{"results":[{"topic":"Geheimes Thema"}],"count":1}',
        form: 'finish_reason=stop top_level=object keys=results,count',
    },
    {
        name: 'trends ist kein Array',
        content: '{"trends":"Geheimes Thema"}',
        form: 'finish_reason=stop top_level=object keys=trends',
    },
    {
        name: 'trends ist null',
        content: '{"trends":null}',
        form: 'finish_reason=stop top_level=object keys=trends',
    },
    {
        name: 'JSON-Literal null',
        content: 'null',
        form: 'finish_reason=stop top_level=null',
    },
    {
        name: 'JSON-String',
        content: '"Geheimes Thema"',
        form: 'finish_reason=stop top_level=string',
    },
    {
        name: 'Fließtext statt JSON',
        content: 'Heute ist Geheimes Thema besonders wichtig.',
        form: 'finish_reason=stop top_level=unparsable',
    },
    {
        name: 'abgeschnittener Text',
        content: '{"trends":[{"topic":"Geheimes Thema","summ',
        finishReason: 'length',
        form: 'finish_reason=length top_level=unparsable',
    },
    {
        name: 'Antwort ohne finish_reason',
        content: '[]',
        finishReason: null,
        form: 'finish_reason=unknown top_level=array',
    },
];

test('eine falsche Form der Tagestrends wird übersprungen und nur ihre Form protokolliert', async () => {
    for (const fall of FALSCHE_TAGESFORMEN) {
        const spies = createSpies();

        await runMain(spies, {
            fetchImpl: feedFetch(spies, { xml: frischerFeed(['Titel Eins']) }),
            groqFetch: spies.makeGroqFetch(groqNachSchema({
                daily_trends: () => groqAntwort(fall.content, { finishReason: fall.finishReason }),
            })),
        });

        // Übersprungen heißt: nichts gespeichert, nichts archiviert, der Lauf bleibt grün.
        assert.deepEqual(spies.exitCodes, [], fall.name);
        assert.equal(spies.kvStore.feed_run_status.result, 'success', fall.name);
        assert.equal(Object.hasOwn(spies.kvStore, 'daily_trends'), false, fall.name);
        assert.deepEqual(archivschluessel(spies), [], fall.name);
        assert.equal(spies.groqCalls.length, 1, `${fall.name}: ohne Archiv kein Wochenaufruf`);

        // Genau eine Zeile mit Länge, finish_reason, oberster Ebene und höchstens fünf Schlüsseln.
        const meldungen = spies.logLines.filter(zeile => zeile.includes(TAGES_MELDUNG));
        assert.equal(meldungen.length, 1, fall.name);
        assert.equal(
            formzeile(spies, TAGES_MELDUNG),
            `length=${fall.content.length} ${fall.form}`,
            fall.name,
        );

        // Kein Inhalt, kein Titel, keine Zusammenfassung im Protokoll.
        assert.doesNotMatch(spies.logLines.join('\n'), /Geheim/, fall.name);
    }
});

test('ein abgelehntes response_format bleibt ein Providerfehler ohne Formzeile', async () => {
    const spies = createSpies();

    // Die Doku sagt nichts dazu, ob json_schema mit reasoning_effort und
    // include_reasoning zusammenpasst. Lehnt Groq die Anfrage ab, bleibt der Lauf
    // grün, und das Protokoll nennt den Providerfehler statt einer Formzeile.
    await runMain(spies, {
        fetchImpl: feedFetch(spies, { xml: frischerFeed(['Titel Eins']) }),
        groqFetch: spies.makeGroqFetch(async () => new Response(
            JSON.stringify({ error: { message: 'response_format is not supported for this request' } }),
            { status: 400 },
        )),
    });

    assert.deepEqual(spies.exitCodes, []);
    assert.equal(spies.kvStore.feed_run_status.result, 'success');
    assert.equal(Object.hasOwn(spies.kvStore, 'daily_trends'), false);
    assert.ok(spies.logLines.some(zeile => zeile.includes('Groq API error: status 400')));
    assert.equal(spies.logLines.some(zeile => zeile.includes('Response shape')), false);
});

// === Wochentrends ===

test('Wochentrends werden wie bisher aus dem Objekt gelesen und auf fünf begrenzt', async () => {
    const spies = createSpies();
    archiviereEineWoche(spies);
    const wochenTrends = [1, 2, 3, 4, 5, 6, 7].map(nummer => trend(`Woche ${nummer}`, 20 - nummer));

    await runMain(spies, {
        fetchImpl: feedFetch(spies, { xml: frischerFeed(['Titel Eins']) }),
        groqFetch: spies.makeGroqFetch(groqNachSchema({
            daily_trends: () => groqAntwort(JSON.stringify({ trends: [trend('Thema E', 2)] })),
            weekly_trends: () => groqAntwort(JSON.stringify({ overallSummary: 'Wochenfazit', trends: wochenTrends })),
        })),
    });

    assert.deepEqual(spies.exitCodes, []);
    assert.equal(spies.groqCalls.length, 2);
    assert.equal(spies.kvStore.weekly_trends.overallSummary, 'Wochenfazit');
    assert.deepEqual(spies.kvStore.weekly_trends.trends, wochenTrends.slice(0, 5));
    assert.equal(spies.logLines.some(zeile => zeile.includes('Response shape')), false);
});

const WOCHEN_MELDUNG = 'Groq weekly trends are not a JSON object. Skipping.';

const FALSCHE_WOCHENFORMEN = [
    {
        name: 'bares Array',
        content: '[{"topic":"Geheimes Thema","summary":"Geheime Zusammenfassung","articleCount":3}]',
        form: 'finish_reason=stop top_level=array',
    },
    {
        name: 'Fließtext statt JSON',
        content: 'Diese Woche dominierte Geheimes Thema.',
        form: 'finish_reason=stop top_level=unparsable',
    },
    {
        name: 'abgeschnittener Text',
        content: '{"overallSummary":"Geheime Woche","trends":[{"top',
        finishReason: 'length',
        form: 'finish_reason=length top_level=unparsable',
    },
    {
        name: 'JSON-Literal null',
        content: 'null',
        form: 'finish_reason=stop top_level=null',
    },
];

test('eine falsche Form der Wochentrends wird übersprungen und nur ihre Form protokolliert', async () => {
    for (const fall of FALSCHE_WOCHENFORMEN) {
        const spies = createSpies();
        archiviereEineWoche(spies);

        await runMain(spies, {
            fetchImpl: feedFetch(spies, { xml: frischerFeed(['Titel Eins']) }),
            groqFetch: spies.makeGroqFetch(groqNachSchema({
                daily_trends: () => groqAntwort(JSON.stringify({ trends: [trend('Thema E', 2)] })),
                weekly_trends: () => groqAntwort(fall.content, { finishReason: fall.finishReason }),
            })),
        });

        assert.deepEqual(spies.exitCodes, [], fall.name);
        assert.equal(spies.kvStore.feed_run_status.result, 'success', fall.name);
        assert.equal(spies.groqCalls.length, 2, fall.name);
        assert.equal(Object.hasOwn(spies.kvStore, 'weekly_trends'), false, fall.name);
        assert.ok(
            spies.logLines.some(zeile => zeile.includes('Weekly trends could not be generated')),
            fall.name,
        );

        const meldungen = spies.logLines.filter(zeile => zeile.includes(WOCHEN_MELDUNG));
        assert.equal(meldungen.length, 1, fall.name);
        assert.equal(
            formzeile(spies, WOCHEN_MELDUNG),
            `length=${fall.content.length} ${fall.form}`,
            fall.name,
        );
        assert.doesNotMatch(spies.logLines.join('\n'), /Geheim/, fall.name);
    }
});

test('zu wenig Archivdaten werden in Einträgen gemeldet, nicht in Tagen', async () => {
    const spies = createSpies();

    // Heute entstehen zwei Archiveinträge. Die Wochenphase verlangt mindestens fünf,
    // und die Meldung muss diese Einheit nennen: Einträge, nicht Tage.
    await runMain(spies, {
        fetchImpl: feedFetch(spies, { xml: frischerFeed(['Titel Eins']) }),
        groqFetch: spies.makeGroqFetch(groqNachSchema({
            daily_trends: () => groqAntwort(JSON.stringify({ trends: [trend('Thema A', 2), trend('Thema B', 1)] })),
        })),
    });

    const zeile = spies.logLines.find(eintrag => eintrag.includes('Not enough archive data found'));
    assert.ok(zeile, 'die Hinweiszeile fehlt');
    assert.match(zeile, /\(2 entries\)\. Need at least 5 trend entries\./);
    assert.doesNotMatch(zeile, /days/);
    assert.equal(spies.groqCalls.length, 1, 'ohne genug Einträge gibt es keinen Wochenaufruf');
});
