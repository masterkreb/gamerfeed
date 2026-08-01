const DESTRUCTOID_UPLOADS_PATH = '/wp-content/uploads/';
const DESTRUCTOID_THEME_ICONS_PATH = '/wp-content/themes/destructoid2025/assets/img/icons/';
const IGNORED_RSS_CONTENT_IMAGE_PARTS = [
    'placeholder.svg',
    'cpx.golem.de',
    'feedburner.com',
    'feedsportal.com',
    'gravatar.com',
];

function getSourceIdentifiers(source) {
    if (typeof source === 'string') return [source];
    if (!source || typeof source !== 'object') return [];

    return [source.id, source.name, source.source].filter(Boolean);
}

export function isDestructoidSource(source) {
    return getSourceIdentifiers(source)
        .some(value => String(value).trim().toLowerCase() === 'destructoid');
}

export function isXboxDynastySource(source) {
    return getSourceIdentifiers(source)
        .some(value => String(value).trim().toLowerCase() === 'xboxdynasty');
}

export function isPlaceholderImageUrl(imageUrl) {
    if (!imageUrl) return false;

    try {
        return new URL(imageUrl).hostname.toLowerCase() === 'placehold.co';
    } catch {
        return String(imageUrl).toLowerCase().includes('placehold.co');
    }
}

export function isKnownNonArticleImageUrl(imageUrl, source) {
    if (!imageUrl) return false;

    const normalizedUrl = String(imageUrl).trim().toLowerCase();
    if (normalizedUrl.includes('s.w.org/images/core/emoji')) return true;

    return isDestructoidSource(source)
        && normalizedUrl.includes(DESTRUCTOID_THEME_ICONS_PATH);
}

export function isDestructoidUploadImageUrl(imageUrl) {
    if (!imageUrl) return false;

    try {
        const parsedUrl = new URL(imageUrl, 'https://www.destructoid.com/');
        const hostname = parsedUrl.hostname.toLowerCase();
        const isDestructoidHost = hostname === 'destructoid.com' || hostname.endsWith('.destructoid.com');

        return isDestructoidHost
            && parsedUrl.pathname.toLowerCase().startsWith(DESTRUCTOID_UPLOADS_PATH);
    } catch {
        return false;
    }
}

export function shouldUseRssContentImage(imageUrl, feed) {
    if (!imageUrl || isKnownNonArticleImageUrl(imageUrl, feed)) return false;
    if (!isDestructoidSource(feed)) return true;

    return isDestructoidUploadImageUrl(imageUrl);
}

export function selectRssContentImageUrl(imageSources, feed) {
    for (const imageUrl of imageSources) {
        if (!imageUrl) continue;

        const normalizedUrl = String(imageUrl).trim().toLowerCase();
        if (
            normalizedUrl.startsWith('data:')
            || IGNORED_RSS_CONTENT_IMAGE_PARTS.some(part => normalizedUrl.includes(part))
            || !shouldUseRssContentImage(imageUrl, feed)
        ) {
            continue;
        }

        return imageUrl;
    }

    return null;
}

export function shouldScrapeMissingImage(feed) {
    return isDestructoidSource(feed)
        || isXboxDynastySource(feed)
        || Boolean(feed?.needs_scraping ?? feed?.needsScraping);
}

export function hasUsableStoredImage(article) {
    const imageUrl = article?.imageUrl;

    return Boolean(imageUrl)
        && !isPlaceholderImageUrl(imageUrl)
        && !isKnownNonArticleImageUrl(imageUrl, article?.source);
}

export function needsStoredImageRepair(article) {
    return !hasUsableStoredImage(article);
}

export function chooseMergedImageUrl(existingArticle, incomingArticle) {
    if (hasUsableStoredImage(incomingArticle)) return incomingArticle.imageUrl;
    if (hasUsableStoredImage(existingArticle)) return existingArticle.imageUrl;

    return incomingArticle?.imageUrl ?? existingArticle?.imageUrl ?? null;
}
