// Anzeige der begrenzten Laufhistorie im Health Center (Roadmap-Paket O4b).
//
// Keine echten KV-, SQL-, Netz- oder Wartezugriffe: die Historie wird als
// bereits normalisierte Liste hereingereicht, genau wie die Health-API sie
// ausliefert. Geprüft werden die drei unterscheidbaren Zustände, beide
// Sprachen und die Zusage, dass ein Ergebnis nicht allein über Farbe
// transportiert wird.

import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createServer } from 'vite';
import { createReactTestRoot } from '../helpers/react-test-root.js';
import {
    FEED_RUN_HISTORY_LIMIT,
    buildRunHistoryEntry,
} from '../../../shared/feed-run-history.js';

const vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    logLevel: 'silent',
    server: {
        middlewareMode: true,
    },
});

test.after(async () => {
    const { default: i18n } = await vite.ssrLoadModule('/i18n.ts');
    await i18n.changeLanguage('de');
    await vite.close();
});

const NOW = Date.parse('2026-07-28T12:00:00.000Z');

function eintrag({ runId = 'gha-1', ageMs = 0, result = 'success', totalMs = 120_000, ...rest } = {}) {
    return buildRunHistoryEntry({
        runId,
        startedAt: new Date(NOW - ageMs - totalMs).toISOString(),
        finishedAt: new Date(NOW - ageMs).toISOString(),
        result,
        feeds: { total: 15, success: 15, warning: 0, error: 0, unknown: 0 },
        durations: { totalMs },
        ...rest,
    });
}

async function renderPanel(entries) {
    const testRoot = await createReactTestRoot();
    await vite.ssrLoadModule('/i18n.ts');
    const { FeedRunHistoryPanel } = await vite.ssrLoadModule('/components/admin/FeedRunHistoryPanel.tsx');

    await testRoot.render(React.createElement(FeedRunHistoryPanel, { entries }));

    return {
        testRoot,
        panel() {
            return testRoot.container.querySelector('[data-run-history="panel"]');
        },
        state() {
            return testRoot.container
                .querySelector('[data-run-history="panel"]')
                ?.getAttribute('data-run-history-state');
        },
        rows() {
            return [...testRoot.container.querySelectorAll('[data-run-history-row]')];
        },
    };
}

test('vorhandene Einträge erscheinen als Tabelle, neuester Lauf zuerst', async () => {
    const view = await renderPanel([
        eintrag({ runId: 'gha-neu', ageMs: 0 }),
        eintrag({ runId: 'gha-mitte', ageMs: 20 * 60_000, result: 'degraded', degradedReason: 'Trendphase zurückgestellt' }),
        eintrag({ runId: 'gha-alt', ageMs: 40 * 60_000, result: 'fatal', fatalError: 'KV nicht erreichbar' }),
    ]);

    try {
        assert.equal(view.state(), 'data');

        const rows = view.rows();
        assert.equal(rows.length, 3);
        assert.deepEqual(
            rows.map(row => row.getAttribute('data-run-history-row')),
            ['success', 'degraded', 'fatal'],
        );

        const panel = view.panel();
        assert.match(panel.textContent, /Laufhistorie/);
        // Abschlusszeit, Ergebnis, Gesamtdauer, Feed-Zähler und Grund.
        assert.match(rows[0].textContent, /abgeschlossen/);
        assert.match(rows[0].textContent, /120 s/);
        assert.match(rows[0].textContent, /15 von 15 mit Artikeln/);
        assert.match(rows[1].textContent, /Trendphase zurückgestellt/);
        assert.match(rows[2].textContent, /KV nicht erreichbar/);
    } finally {
        await view.testRoot.cleanup();
    }
});

test('die Zusammenfassung zählt die sichtbaren Ergebnisse', async () => {
    const view = await renderPanel([
        eintrag({ runId: 'a', ageMs: 0 }),
        eintrag({ runId: 'b', ageMs: 20 * 60_000 }),
        eintrag({ runId: 'c', ageMs: 40 * 60_000, result: 'degraded', degradedReason: 'Deadline' }),
        eintrag({ runId: 'd', ageMs: 60 * 60_000, result: 'fatal', fatalError: 'Abbruch' }),
    ]);

    try {
        const summary = view.testRoot.container.querySelector('[data-run-history="summary"]');
        assert.match(summary.textContent, /4 festgehaltene Läufe/);
        assert.match(summary.textContent, /2 abgeschlossen/);
        assert.match(summary.textContent, /1 eingeschränkt/);
        assert.match(summary.textContent, /1 abgebrochen/);
    } finally {
        await view.testRoot.cleanup();
    }
});

test('eine gelesene, aber leere Historie wird als leer benannt', async () => {
    const view = await renderPanel([]);

    try {
        assert.equal(view.state(), 'empty');
        assert.match(view.panel().textContent, /noch kein abgeschlossener Lauf/i);
        assert.equal(view.rows().length, 0);
        assert.doesNotMatch(view.panel().textContent, /nicht lesbar/);
    } finally {
        await view.testRoot.cleanup();
    }
});

test('eine nicht lesbare Historie wird nicht als leer ausgegeben', async () => {
    const view = await renderPanel(null);

    try {
        assert.equal(view.state(), 'unavailable');
        assert.match(view.panel().textContent, /nicht lesbar/);
        assert.doesNotMatch(
            view.panel().textContent,
            /noch kein abgeschlossener Lauf/i,
            'ein Lesefehler behauptet keine leere Historie',
        );
        assert.equal(view.rows().length, 0);
    } finally {
        await view.testRoot.cleanup();
    }
});

test('das Ergebnis wird durch Text und Symbol getragen, nicht allein durch Farbe', async () => {
    const view = await renderPanel([
        eintrag({ runId: 'a', ageMs: 0 }),
        eintrag({ runId: 'b', ageMs: 20 * 60_000, result: 'degraded', degradedReason: 'Deadline' }),
        eintrag({ runId: 'c', ageMs: 40 * 60_000, result: 'fatal', fatalError: 'Abbruch' }),
    ]);

    try {
        const rows = view.rows();

        for (const [index, text] of ['abgeschlossen', 'eingeschränkt', 'abgebrochen'].entries()) {
            assert.match(rows[index].textContent, new RegExp(text), `${text} steht als Wort da`);
            assert.ok(
                rows[index].querySelector('svg') !== null,
                `${text} trägt zusätzlich ein Symbol`,
            );
        }

        // Die drei Ergebnisse sind auch ohne Farbwahrnehmung unterscheidbar:
        // die Beschriftungen sind verschieden.
        const beschriftungen = new Set(rows.map(row => row.textContent.match(/abgeschlossen|eingeschränkt|abgebrochen/)[0]));
        assert.equal(beschriftungen.size, 3);
    } finally {
        await view.testRoot.cleanup();
    }
});

test('eine unbekannte Gesamtdauer wird benannt statt als 0 s gezeigt', async () => {
    const view = await renderPanel([eintrag({ runId: 'a', durations: { totalMs: null }, totalMs: 0 })]);

    try {
        assert.match(view.rows()[0].textContent, /unbekannt/);
        assert.doesNotMatch(view.rows()[0].textContent, /0 s/);
    } finally {
        await view.testRoot.cleanup();
    }
});

test('ein erfolgreicher Lauf ohne Grund zeigt keinen leeren Platzhalter aus einem anderen Feld', async () => {
    const view = await renderPanel([eintrag({ runId: 'a' })]);

    try {
        const zellen = [...view.rows()[0].querySelectorAll('td')];
        assert.equal(zellen.at(-1).textContent, '-');
    } finally {
        await view.testRoot.cleanup();
    }
});

test('die Beschreibung nennt die tatsächliche Grenze der Historie', async () => {
    const view = await renderPanel([eintrag({ runId: 'a' })]);

    try {
        assert.match(view.panel().textContent, new RegExp(String(FEED_RUN_HISTORY_LIMIT)));
    } finally {
        await view.testRoot.cleanup();
    }
});

test('die Anzeige behauptet nicht, ausgefallene Workflows zu erkennen', async () => {
    const view = await renderPanel([eintrag({ runId: 'a' })]);

    try {
        assert.match(view.panel().textContent, /gar nicht erst gestartet ist, hinterlässt hier keinen Eintrag/);
    } finally {
        await view.testRoot.cleanup();
    }
});

test('Sprachwechsel übersetzt Beschriftungen und Datumsformat', async () => {
    const { default: i18n } = await vite.ssrLoadModule('/i18n.ts');
    const view = await renderPanel([
        eintrag({ runId: 'a', ageMs: 0 }),
        eintrag({ runId: 'b', ageMs: 20 * 60_000, result: 'fatal', fatalError: 'Abbruch' }),
    ]);

    try {
        const deutschesDatum = view.rows()[0].querySelector('th').textContent;
        assert.match(view.panel().textContent, /Abschlusszeit/);
        assert.match(view.panel().textContent, /Gesamtdauer/);
        assert.match(view.rows()[1].textContent, /abgebrochen/);
        assert.match(deutschesDatum, /28\.7\.2026/, 'deutsches Datumsformat');

        await act(async () => {
            await i18n.changeLanguage('en');
        });

        assert.match(view.panel().textContent, /Run history/);
        assert.match(view.panel().textContent, /Finished at/);
        assert.match(view.panel().textContent, /Total duration/);
        assert.match(view.rows()[1].textContent, /aborted/);

        const englischesDatum = view.rows()[0].querySelector('th').textContent;
        assert.match(englischesDatum, /7\/28\/2026/, 'englisches Datumsformat');
        assert.notEqual(englischesDatum, deutschesDatum);
    } finally {
        await act(async () => {
            await i18n.changeLanguage('de');
        });
        await view.testRoot.cleanup();
    }
});

test('die englische Fassung unterscheidet leer und nicht lesbar ebenfalls', async () => {
    const { default: i18n } = await vite.ssrLoadModule('/i18n.ts');

    try {
        await act(async () => {
            await i18n.changeLanguage('en');
        });

        const leer = await renderPanel([]);
        assert.equal(leer.state(), 'empty');
        assert.match(leer.panel().textContent, /No completed run has been recorded yet/);
        await leer.testRoot.cleanup();

        const fehlend = await renderPanel(null);
        assert.equal(fehlend.state(), 'unavailable');
        assert.match(fehlend.panel().textContent, /cannot be read right now/);
        await fehlend.testRoot.cleanup();
    } finally {
        await act(async () => {
            await i18n.changeLanguage('de');
        });
    }
});
