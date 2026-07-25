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
