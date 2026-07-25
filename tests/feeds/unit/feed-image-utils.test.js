import test from 'node:test';
import assert from 'node:assert/strict';
import {
    chooseMergedImageUrl,
    hasUsableStoredImage,
    isDestructoidSource,
    isDestructoidUploadImageUrl,
    isKnownNonArticleImageUrl,
    needsStoredImageRepair,
    selectRssContentImageUrl,
    shouldScrapeMissingImage,
    shouldUseRssContentImage,
} from '../../../scripts/feed-image-utils.js';

const DESTRUCTOID_FEED = {
    id: 'destructoid',
    name: 'Destructoid',
    needs_scraping: false,
};

const HEART_ICON = '/wp-content/themes/destructoid2025/assets/img/icons/likes-off.png';
const UPLOAD_IMAGE = 'https://www.destructoid.com/wp-content/uploads/2026/07/article-image.jpg';

test('erkennt Destructoid anhand von Feed-ID, Name oder Artikelquelle', () => {
    assert.equal(isDestructoidSource(DESTRUCTOID_FEED), true);
    assert.equal(isDestructoidSource('Destructoid'), true);
    assert.equal(isDestructoidSource({ source: 'Destructoid' }), true);
    assert.equal(isDestructoidSource({ id: 'ign', name: 'IGN' }), false);
});

test('verwirft das Destructoid-Like-Icon, aber keine fremden Bilder mit gleichem Pfad', () => {
    assert.equal(isKnownNonArticleImageUrl(HEART_ICON, DESTRUCTOID_FEED), true);
    assert.equal(isKnownNonArticleImageUrl(HEART_ICON, 'IGN'), false);
});

test('akzeptiert für Destructoid nur echte Upload-Bilder aus dem RSS-Inhalt', () => {
    assert.equal(isDestructoidUploadImageUrl(UPLOAD_IMAGE), true);
    assert.equal(isDestructoidUploadImageUrl('/wp-content/uploads/2026/07/article-image.jpg'), true);
    assert.equal(shouldUseRssContentImage(UPLOAD_IMAGE, DESTRUCTOID_FEED), true);
    assert.equal(shouldUseRssContentImage(HEART_ICON, DESTRUCTOID_FEED), false);
    assert.equal(shouldUseRssContentImage('https://example.com/banner.jpg', DESTRUCTOID_FEED), false);
    assert.equal(shouldUseRssContentImage('https://example.com/banner.jpg', { name: 'IGN' }), true);
});

test('überspringt ein UI-data-src und verwendet das echte Destructoid-src', () => {
    assert.equal(
        selectRssContentImageUrl([HEART_ICON, UPLOAD_IMAGE], DESTRUCTOID_FEED),
        UPLOAD_IMAGE,
    );
    assert.equal(
        selectRssContentImageUrl([HEART_ICON], DESTRUCTOID_FEED),
        null,
    );
});

test('fordert für Destructoid bei fehlendem RSS-Bild immer den OG-Fallback an', () => {
    assert.equal(shouldScrapeMissingImage(DESTRUCTOID_FEED), true);
    assert.equal(shouldScrapeMissingImage({ name: 'IGN', needs_scraping: false }), false);
    assert.equal(shouldScrapeMissingImage({ name: 'IGN', needs_scraping: true }), true);
});

test('markiert Placeholder und bestehende Destructoid-Icons zur Cache-Reparatur', () => {
    const validArticle = { source: 'Destructoid', imageUrl: UPLOAD_IMAGE };
    const iconArticle = { source: 'Destructoid', imageUrl: `https://www.destructoid.com${HEART_ICON}` };
    const placeholderArticle = { source: 'IGN', imageUrl: 'https://placehold.co/600x400?text=IGN' };

    assert.equal(hasUsableStoredImage(validArticle), true);
    assert.equal(needsStoredImageRepair(validArticle), false);
    assert.equal(needsStoredImageRepair(iconArticle), true);
    assert.equal(needsStoredImageRepair(placeholderArticle), true);
});

test('Merge behält ein echtes Bild, aber niemals ein altes Herz vor einem neuen Placeholder', () => {
    const validArticle = { source: 'Destructoid', imageUrl: UPLOAD_IMAGE };
    const iconArticle = { source: 'Destructoid', imageUrl: `https://www.destructoid.com${HEART_ICON}` };
    const placeholderArticle = { source: 'Destructoid', imageUrl: 'https://placehold.co/600x400?text=Destructoid' };

    assert.equal(chooseMergedImageUrl(iconArticle, validArticle), UPLOAD_IMAGE);
    assert.equal(chooseMergedImageUrl(validArticle, placeholderArticle), UPLOAD_IMAGE);
    assert.equal(chooseMergedImageUrl(iconArticle, placeholderArticle), placeholderArticle.imageUrl);
});
