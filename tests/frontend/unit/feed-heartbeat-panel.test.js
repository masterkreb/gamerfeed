import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createServer } from 'vite';
import { createReactTestRoot } from '../helpers/react-test-root.js';
import {
    FEED_STALE_AFTER_MS,
    buildFreshnessReport,
} from '../../../shared/feed-health-model.js';

const vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    logLevel: 'silent',
    server: {
        middlewareMode: true,
    },
});

test.after(async () => {
    await vite.close();
});

const NOW = Date.parse('2026-07-28T12:00:00.000Z');

function isoAgo(ageMs) {
    return new Date(NOW - ageMs).toISOString();
}

// Derselbe Frischebericht, den die Health-API liefert – die Oberfläche bekommt
// also exakt den geprüften Vertrag zu sehen.
function heartbeatFor({ runAgeMs, publishAgeMs, contentAgeMs, feeds, result = 'success', fatalError = null, degradedReason = null }) {
    return buildFreshnessReport({
        run: {
            runId: 'gha-4711-1',
            startedAt: isoAgo(runAgeMs + 90_000),
            finishedAt: isoAgo(runAgeMs),
            result,
            fatalError,
            degradedReason,
            feeds,
            durations: { totalMs: 90_000 },
        },
        publish: publishAgeMs === null ? null : {
            runId: 'gha-4711-1',
            lastCorePublishAt: isoAgo(publishAgeMs),
            lastContentUpdateAt: contentAgeMs === null ? null : isoAgo(contentAgeMs),
            newestArticleAt: contentAgeMs === null ? null : isoAgo(contentAgeMs),
            articleCount: 1234,
            feeds,
        },
        now: NOW,
    });
}

async function renderPanel(heartbeat) {
    const testRoot = await createReactTestRoot();
    await vite.ssrLoadModule('/i18n.ts');
    const { FeedHeartbeatPanel } = await vite.ssrLoadModule('/components/admin/FeedHeartbeatPanel.tsx');

    await testRoot.render(React.createElement(FeedHeartbeatPanel, { heartbeat }));

    return {
        testRoot,
        card(name) {
            return testRoot.container.querySelector(`[data-heartbeat="${name}"]`);
        },
        state(name) {
            return testRoot.container
                .querySelector(`[data-heartbeat="${name}"]`)
                ?.getAttribute('data-heartbeat-state');
        },
    };
}

test('zeigt Lauf, Kern-Publish und Inhalt als drei unterscheidbare Zustände', async () => {
    const view = await renderPanel(heartbeatFor({
        runAgeMs: 3 * 60_000,
        publishAgeMs: 3 * 60_000,
        contentAgeMs: 3 * 60_000,
        feeds: { total: 15, success: 15, warning: 0, error: 0, unknown: 0 },
    }));

    try {
        assert.equal(view.state('run'), 'fresh');
        assert.equal(view.state('publish'), 'fresh');
        assert.equal(view.state('content'), 'fresh');

        const panel = view.card('panel');
        assert.equal(panel.getAttribute('data-heartbeat-stale'), 'false');
        assert.match(panel.textContent, /Letzter Lauf/);
        assert.match(panel.textContent, /Letzter Kern-Publish/);
        assert.match(panel.textContent, /Inhaltsfrische/);
        assert.match(panel.textContent, /gha-4711-1/);
        assert.match(panel.textContent, /vor 3 Minuten/);
        assert.match(panel.textContent, /15 von 15 Feeds mit Artikeln/);
    } finally {
        await view.testRoot.cleanup();
    }
});

test('ein technisch beendeter Lauf ohne erfolgreiche Feeds wird als alter Inhalt gezeigt', async () => {
    const view = await renderPanel(heartbeatFor({
        runAgeMs: 60_000,
        publishAgeMs: 60_000,
        contentAgeMs: 5 * 60 * 60 * 1000,
        feeds: { total: 15, success: 0, warning: 0, error: 15, unknown: 0 },
    }));

    try {
        assert.equal(view.state('run'), 'fresh', 'der Lauf selbst war erfolgreich');
        assert.equal(view.state('publish'), 'fresh', 'der Kern-Publish hat stattgefunden');
        assert.equal(view.state('content'), 'stale', 'der Inhalt ist trotzdem alt');
        assert.equal(view.card('panel').getAttribute('data-heartbeat-stale'), 'true');
        assert.match(view.card('publish').textContent, /0 von 15 Feeds mit Artikeln/);
    } finally {
        await view.testRoot.cleanup();
    }
});

test('ein ausgefallener Cron erscheint überall als veraltet', async () => {
    const view = await renderPanel(heartbeatFor({
        runAgeMs: FEED_STALE_AFTER_MS + 60_000,
        publishAgeMs: FEED_STALE_AFTER_MS + 60_000,
        contentAgeMs: FEED_STALE_AFTER_MS + 60_000,
        feeds: { total: 15, success: 15, warning: 0, error: 0, unknown: 0 },
    }));

    try {
        assert.equal(view.state('run'), 'stale');
        assert.equal(view.state('publish'), 'stale');
        assert.equal(view.state('content'), 'stale');
        assert.match(view.card('panel').textContent, /veraltet/);
    } finally {
        await view.testRoot.cleanup();
    }
});

test('ein abgebrochener Lauf nennt den bereinigten Fatalfehler', async () => {
    const view = await renderPanel(heartbeatFor({
        runAgeMs: 60_000,
        publishAgeMs: 40 * 60_000,
        contentAgeMs: 40 * 60_000,
        feeds: { total: 15, success: 0, warning: 0, error: 0, unknown: 15 },
        result: 'fatal',
        fatalError: 'Existing cache data from KV is corrupted',
    }));

    try {
        assert.match(view.card('run').textContent, /abgebrochen/);
        assert.match(view.card('run').textContent, /Existing cache data from KV is corrupted/);
        assert.equal(view.state('run'), 'fresh', 'der Versuch selbst ist jung');
        assert.equal(view.state('publish'), 'fresh', 'der alte Kern-Publish bleibt erhalten');
    } finally {
        await view.testRoot.cleanup();
    }
});

test('ohne Heartbeat wird kein grüner Zustand behauptet', async () => {
    const view = await renderPanel(null);

    try {
        const panel = view.card('panel');
        assert.match(panel.textContent, /Kein Heartbeat verfügbar/);
        assert.equal(view.card('run'), null);
        assert.equal(panel.getAttribute('data-heartbeat-stale'), null);
    } finally {
        await view.testRoot.cleanup();
    }
});

test('ein Zeitstempel aus der Zukunft wird als ungültig gekennzeichnet, nicht als aktuell', async () => {
    const view = await renderPanel(heartbeatFor({
        runAgeMs: -(24 * 60 * 60 * 1000),
        publishAgeMs: -(24 * 60 * 60 * 1000),
        contentAgeMs: -(24 * 60 * 60 * 1000),
        feeds: { total: 15, success: 15, warning: 0, error: 0, unknown: 0 },
    }));

    try {
        assert.equal(view.state('run'), 'invalid');
        assert.equal(view.state('publish'), 'invalid');
        assert.equal(view.state('content'), 'invalid');
        assert.equal(view.card('panel').getAttribute('data-heartbeat-stale'), 'true');
        assert.match(view.card('run').textContent, /Zeitstempel in der Zukunft/);
        assert.doesNotMatch(view.card('run').textContent, /vor -/, 'kein negatives Alter');
    } finally {
        await view.testRoot.cleanup();
    }
});

test('ein nie erfolgter Kern-Publish erscheint als unbekannt, nicht als aktuell', async () => {
    const view = await renderPanel(heartbeatFor({
        runAgeMs: 60_000,
        publishAgeMs: null,
        contentAgeMs: null,
        feeds: { total: 15, success: 0, warning: 0, error: 15, unknown: 0 },
    }));

    try {
        assert.equal(view.state('publish'), 'unknown');
        assert.equal(view.state('content'), 'unknown');
        assert.match(view.card('publish').textContent, /noch nie/);
    } finally {
        await view.testRoot.cleanup();
    }
});

test('ein eingeschränkter Lauf nennt Zustand und Grund', async () => {
    // Ohne den Grund wäre „eingeschränkt" nicht handhabbar: Zeitbudget und
    // Scrape-Budget verlangen völlig verschiedene Reaktionen.
    const view = await renderPanel(heartbeatFor({
        runAgeMs: 3 * 60_000,
        publishAgeMs: 3 * 60_000,
        contentAgeMs: 3 * 60_000,
        feeds: { total: 15, success: 13, warning: 2, error: 0, unknown: 0 },
        result: 'degraded',
        degradedReason: 'Zeitbudget erschöpft: 2 Quelle(n) zurückgestellt',
    }));

    try {
        const run = view.card('run');
        assert.match(run.textContent, /eingeschränkt/);
        assert.match(run.textContent, /Zurückgestellt/);
        assert.match(run.textContent, /2 Quelle/);
    } finally {
        await view.testRoot.cleanup();
    }
});

test('ein erfolgreicher Lauf zeigt keine Zurückstellung an', async () => {
    const view = await renderPanel(heartbeatFor({
        runAgeMs: 3 * 60_000,
        publishAgeMs: 3 * 60_000,
        contentAgeMs: 3 * 60_000,
        feeds: { total: 15, success: 15, warning: 0, error: 0, unknown: 0 },
    }));

    try {
        assert.doesNotMatch(view.card('run').textContent, /Zurückgestellt/);
    } finally {
        await view.testRoot.cleanup();
    }
});
