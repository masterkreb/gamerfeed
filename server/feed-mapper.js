// Kept only for compatibility with the existing database column. Scheduling
// remains global: GitHub Actions fetches every feed every 20 minutes.
const LEGACY_DATABASE_UPDATE_INTERVAL_MINUTES = 20;

function mapEditableFeedDatabaseFields(payload) {
    return {
        name: payload.name,
        url: payload.url,
        language: payload.language,
        priority: payload.priority,
        needs_scraping: payload.needsScraping ?? false,
    };
}

export function mapNewFeedToDatabaseRow(payload, id) {
    return {
        id,
        ...mapEditableFeedDatabaseFields(payload),
        update_interval: LEGACY_DATABASE_UPDATE_INTERVAL_MINUTES,
    };
}

export function mapFeedUpdateToDatabaseRow(payload) {
    return {
        id: payload.id,
        ...mapEditableFeedDatabaseFields(payload),
    };
}

export function mapFeedRow(row) {
    return {
        id: row.id,
        url: row.url,
        name: row.name,
        language: row.language,
        priority: row.priority,
        needsScraping: row.needs_scraping ?? false,
    };
}

export function mapFeedRows(rows) {
    return rows.map(mapFeedRow);
}
