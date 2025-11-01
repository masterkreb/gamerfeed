// scripts/fetch-feeds.js
// Fetches RSS feeds and saves to public/news-cache.json

import { sql } from '@vercel/postgres';
import fs from 'fs';
import path from 'path';

// Import your RSS parsing logic (simplified version)
async function fetchArticles() {
    try {
        // Get feeds from database
        const { rows: feeds } = await sql`SELECT * FROM feeds;`;
        console.log(`Found ${feeds.length} feeds in database`);

        const articles = [];

        // Process all feeds (no timeout limit in GitHub Actions!)
        for (const feed of feeds) {
            try {
                console.log(`Fetching: ${feed.name}...`);

                const response = await fetch(feed.url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/rss+xml, application/xml'
                    },
                    signal: AbortSignal.timeout(10000)
                });

                if (!response.ok) {
                    console.warn(`Failed: ${feed.name} (${response.status})`);
                    continue;
                }

                const xmlString = await response.text();
                const feedArticles = parseRssXml(xmlString, feed);
                articles.push(...feedArticles);
                console.log(`✓ ${feed.name}: ${feedArticles.length} articles`);

                // Small delay to be nice
                await new Promise(r => setTimeout(r, 200));

            } catch (error) {
                console.error(`Error fetching ${feed.name}:`, error.message);
            }
        }

        console.log(`\nTotal articles fetched: ${articles.length}`);

        // Save to cache file
        const cacheDir = path.join(process.cwd(), 'public');
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        const cachePath = path.join(cacheDir, 'news-cache.json');
        fs.writeFileSync(cachePath, JSON.stringify(articles, null, 2));
        console.log(`Saved to ${cachePath}`);

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

function parseRssXml(xmlString, feed) {
    const articles = [];
    const isAtom = xmlString.includes('<feed');
    const itemPattern = isAtom ? /<entry[^>]*>([\s\S]*?)<\/entry>/gi : /<item[^>]*>([\s\S]*?)<\/item>/gi;
    const matches = xmlString.matchAll(itemPattern);

    for (const match of matches) {
        const itemXml = match[1];

        const title = itemXml.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/is)?.[1]?.trim();
        const link = isAtom
            ? itemXml.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1]
            : itemXml.match(/<link[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/is)?.[1]?.trim();
        const pubDate = isAtom
            ? itemXml.match(/<(?:published|updated)[^>]*>([^<]+)<\/(?:published|updated)>/i)?.[1]
            : itemXml.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/i)?.[1];

        if (!title || !link || !pubDate) continue;

        const desc = itemXml.match(/<(?:description|summary)[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/(?:description|summary)>/is)?.[1]?.trim() || '';
        const summary = desc.replace(/<[^>]+>/g, '').substring(0, 150);

        const imgMatch = itemXml.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i) ||
            itemXml.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image/i) ||
            desc.match(/<img[^>]+src=["']([^"']+)["']/i);

        const imageUrl = imgMatch?.[1] || `https://placehold.co/600x400/374151/d1d5db?text=${encodeURIComponent(feed.name.substring(0, 30))}`;

        articles.push({
            id: link,
            title,
            source: feed.name,
            publicationDate: new Date(pubDate).toISOString(),
            summary,
            link,
            imageUrl,
            language: feed.language
        });
    }

    return articles;
}

fetchArticles();