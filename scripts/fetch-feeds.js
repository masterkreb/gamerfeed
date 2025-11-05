import 'dotenv/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sql = neon(process.env.DATABASE_URL);
const parser = new Parser({
    timeout: 15000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    }
});

function decodeHtmlEntities(text) {
    if (!text) return text;
    const entities = {
        '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
        '&nbsp;': ' ', '&copy;': '©', '&reg;': '®', '&euro;': '€'
    };
    return text
        .replace(/&([a-z]+);/gi, (match, entity) => entities[match] || match)
        .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
        .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractImageFromContent(content) {
    if (!content) return null;
    const $ = cheerio.load(content);
    const images = [];

    $('img').each((i, elem) => {
        const src = $(elem).attr('src');
        const width = parseInt($(elem).attr('width') || '0');
        const height = parseInt($(elem).attr('height') || '0');

        if (src && !src.includes('1x1') && !src.includes('tracking') && !src.includes('pixel')) {
            images.push({ src, size: width * height || 0 });
        }
    });

    if (images.length > 0) {
        images.sort((a, b) => b.size - a.size);
        return images[0].src;
    }
    return null;
}

function extractImageUrl(item, feedUrl) {
    let imageUrl = null;

    if (item.enclosure?.url && item.enclosure.type?.startsWith('image/')) {
        imageUrl = item.enclosure.url;
    } else if (item['media:content']?.$ || item['media:thumbnail']?.$) {
        const media = item['media:content']?.$ || item['media:thumbnail']?.$;
        if (media.url) imageUrl = media.url;
    }

    if (!imageUrl) {
        const contentFields = [
            item['content:encoded'],
            item.content,
            item.description,
            item.summary
        ];

        for (const field of contentFields) {
            if (field) {
                imageUrl = extractImageFromContent(field);
                if (imageUrl) break;
            }
        }
    }

    if (imageUrl && !imageUrl.startsWith('http')) {
        try {
            const feedDomain = new URL(feedUrl);
            imageUrl = new URL(imageUrl, feedDomain.origin).href;
        } catch (e) {
            console.error('Error converting relative URL:', e);
        }
    }

    if (imageUrl) {
        if (imageUrl.includes('gamespot.com') && imageUrl.includes('480x')) {
            imageUrl = imageUrl.replace('480x270', '1280x720');
        }
        if (imageUrl.includes('giantbomb.com') && imageUrl.includes('thumb')) {
            imageUrl = imageUrl.replace(/thumb_\d+/, 'original');
        }
        if (imageUrl.includes('heise.de') && imageUrl.includes('w=450')) {
            imageUrl = imageUrl.replace('w=450', 'w=800');
        }
        if (imageUrl.includes('golem.de') && (imageUrl.includes('1x1') || imageUrl.includes('cpx'))) {
            imageUrl = null;
        }
    }

    return imageUrl;
}

async function scrapeImage(articleUrl) {
    try {
        const { data } = await axios.get(articleUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const $ = cheerio.load(data);

        let ogImage = $('meta[property="og:image"]').attr('content');
        if (ogImage) return ogImage;

        let twitterImage = $('meta[name="twitter:image"]').attr('content');
        if (twitterImage) return twitterImage;

        const images = [];
        $('article img, .article img, main img').each((i, elem) => {
            const src = $(elem).attr('src');
            const width = parseInt($(elem).attr('width') || '0');
            const height = parseInt($(elem).attr('height') || '0');

            if (src && !src.includes('1x1') && !src.includes('tracking')) {
                images.push({ src, size: width * height });
            }
        });

        if (images.length > 0) {
            images.sort((a, b) => b.size - a.size);
            return images[0].src;
        }

        return null;
    } catch (error) {
        console.error(`   ❌ Scraping failed for ${articleUrl}:`, error.message);
        return null;
    }
}

async function fetchFeeds() {
    console.log('🚀 Starting feed fetch process...\n');

    try {
        const feeds = await sql`SELECT * FROM feeds WHERE enabled = true ORDER BY name`;
        console.log(`📊 Found ${feeds.length} enabled feeds\n`);

        const allArticles = [];

        for (const feed of feeds) {
            console.log(`Fetching: ${feed.name}...`);

            try {
                const feedData = await parser.parseURL(feed.url);
                const articles = feedData.items.slice(0, 5);

                for (const item of articles) {
                    let imageUrl = extractImageUrl(item, feed.url);

                    if (!imageUrl && feed.needs_scraping && item.link) {
                        console.log(`   🔍 Scraping image for: ${feed.name}`);
                        imageUrl = await scrapeImage(item.link);
                    }

                    allArticles.push({
                        source: feed.name,
                        title: decodeHtmlEntities(item.title || 'Untitled'),
                        link: item.link,
                        pubDate: item.pubDate || new Date().toISOString(),
                        imageUrl: imageUrl || undefined
                    });
                }

                console.log(`   ✅ Success: ${feed.name} (${articles.length} articles)`);

            } catch (error) {
                const statusCode = error.response?.status || error.code;
                console.log(`   ❌ Failed: ${feed.name} (${statusCode})`);
            }
        }

        allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        const cachePath = join(__dirname, '../public/news-cache.json');
        fs.writeFileSync(cachePath, JSON.stringify(allArticles, null, 2));

        console.log(`\n✅ Completed! Total articles: ${allArticles.length}`);
        console.log(`📦 Cache saved to: ${cachePath}`);

    } catch (error) {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    }
}

fetchFeeds();