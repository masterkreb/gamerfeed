import test from 'node:test';
import assert from 'node:assert/strict';
import {
    mapNewFeedToDatabaseRow,
    mapFeedRow,
    mapFeedRows,
    mapFeedUpdateToDatabaseRow,
} from '../../../server/feed-mapper.js';

function createDatabaseRow(overrides = {}) {
    return {
        id: 'destructoid',
        url: 'https://www.destructoid.com/feed/',
        name: 'Destructoid',
        language: 'en',
        priority: 'secondary',
        update_interval: 60,
        needs_scraping: true,
        ...overrides,
    };
}

function createRequestPayload(overrides = {}) {
    return {
        id: 'destructoid',
        url: 'https://www.destructoid.com/feed/',
        name: 'Destructoid',
        language: 'en',
        priority: 'secondary',
        needsScraping: true,
        ...overrides,
    };
}

test('bereitet neue Feeds ohne öffentliches Intervall für die bestehende Datenbankspalte vor', () => {
    const payload = createRequestPayload();
    delete payload.id;
    delete payload.needsScraping;

    assert.deepEqual(mapNewFeedToDatabaseRow(payload, 'destructoid-new'), {
        id: 'destructoid-new',
        name: 'Destructoid',
        url: 'https://www.destructoid.com/feed/',
        language: 'en',
        priority: 'secondary',
        needs_scraping: false,
        update_interval: 20,
    });
});

test('ignoriert alte oder manipulierte Intervallwerte aus Feed-Anfragen', () => {
    const payload = Object.freeze(createRequestPayload({ update_interval: 999, updateInterval: 888 }));

    const createRow = mapNewFeedToDatabaseRow(payload, 'destructoid-new');
    const updateRow = mapFeedUpdateToDatabaseRow(payload);

    assert.equal(createRow.update_interval, 20);
    assert.equal('updateInterval' in createRow, false);
    assert.equal('update_interval' in updateRow, false);
    assert.equal('updateInterval' in updateRow, false);
    assert.equal(payload.update_interval, 999);
    assert.equal(payload.updateInterval, 888);
});

test('übernimmt beim Bearbeiten nur die erlaubten Feed-Felder inklusive ID', () => {
    const payload = createRequestPayload({ internal_note: 'nicht übernehmen' });

    assert.deepEqual(mapFeedUpdateToDatabaseRow(payload), {
        id: 'destructoid',
        name: 'Destructoid',
        url: 'https://www.destructoid.com/feed/',
        language: 'en',
        priority: 'secondary',
        needs_scraping: true,
    });
});

test('übersetzt eine Feed-Datenbankzeile in den Frontend-Vertrag', () => {
    const row = createDatabaseRow({
        created_at: '2026-07-25T10:00:00.000Z',
        internal_note: 'nicht an den Client senden',
    });

    assert.deepEqual(mapFeedRow(row), {
        id: 'destructoid',
        url: 'https://www.destructoid.com/feed/',
        name: 'Destructoid',
        language: 'en',
        priority: 'secondary',
        needsScraping: true,
    });
});

test('behält false bei und entfernt interne Datenbankfelder', () => {
    const mappedFeed = mapFeedRow(createDatabaseRow({ needs_scraping: false }));

    assert.equal(mappedFeed.needsScraping, false);
    assert.equal('needs_scraping' in mappedFeed, false);
    assert.equal('update_interval' in mappedFeed, false);
});

test('verwendet false für null oder fehlendes needs_scraping', () => {
    assert.equal(mapFeedRow(createDatabaseRow({ needs_scraping: null })).needsScraping, false);

    const rowWithoutFlag = createDatabaseRow();
    delete rowWithoutFlag.needs_scraping;
    assert.equal(mapFeedRow(rowWithoutFlag).needsScraping, false);
});

test('verändert die ursprüngliche Datenbankzeile nicht', () => {
    const row = Object.freeze(createDatabaseRow());

    mapFeedRow(row);

    assert.equal(row.needs_scraping, true);
    assert.equal('needsScraping' in row, false);
});

test('mappt mehrere Zeilen in derselben Reihenfolge auf neue Objekte', () => {
    const first = createDatabaseRow();
    const second = createDatabaseRow({
        id: 'ign-de',
        name: 'IGN',
        url: 'https://de.ign.com/feed.xml',
        needs_scraping: false,
    });

    const mappedFeeds = mapFeedRows([first, second]);

    assert.deepEqual(mappedFeeds.map(feed => feed.id), ['destructoid', 'ign-de']);
    assert.notEqual(mappedFeeds[0], first);
    assert.notEqual(mappedFeeds[1], second);
});
