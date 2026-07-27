import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isAllowedUrl,
    parseAllowedUrl,
    toAllowedUrl,
    UrlPolicyError,
} from '../../../shared/url-policy.js';

function expectRejection(rawUrl, code, options) {
    assert.throws(
        () => parseAllowedUrl(rawUrl, options),
        error => error instanceof UrlPolicyError && error.code === code,
        `${JSON.stringify(rawUrl)} hätte mit "${code}" abgelehnt werden müssen`,
    );
}

test('akzeptiert gewöhnliche http- und https-URLs', () => {
    for (const rawUrl of [
        'https://www.gamepro.de/rss/gamepro.rss',
        'http://example.com/feed',
        'https://example.com:8443/feed?x=1#teil',
        'https://beispiel.example/rss?a=b&c=d',
    ]) {
        const url = parseAllowedUrl(rawUrl);
        assert.ok(url instanceof URL, `${rawUrl} wurde abgelehnt`);
        assert.equal(isAllowedUrl(rawUrl), true);
    }
});

test('lehnt andere Schemata ab', () => {
    expectRejection('javascript:alert(1)', 'protocol_not_allowed');
    expectRejection('data:text/html,<script>alert(1)</script>', 'protocol_not_allowed');
    expectRejection('file:///etc/passwd', 'protocol_not_allowed');
    expectRejection('ftp://example.com/feed', 'protocol_not_allowed');
    // Gross-/Kleinschreibung darf nicht durchrutschen.
    expectRejection('JavaScript:alert(1)', 'protocol_not_allowed');
});

test('lehnt eingebettete Zugangsdaten ab', () => {
    expectRejection('https://nutzer:geheim@example.com/feed', 'credentials_not_allowed');
    expectRejection('https://nutzer@example.com/feed', 'credentials_not_allowed');
});

test('lehnt fehlende und syntaktisch ungültige Eingaben ab', () => {
    expectRejection('', 'missing_url');
    expectRejection('   ', 'missing_url');
    expectRejection(undefined, 'missing_url');
    expectRejection(null, 'missing_url');
    expectRejection(42, 'missing_url');
    expectRejection('kein-schema/feed', 'invalid_syntax');
    expectRejection('https://', 'invalid_syntax');
});

test('löst relative URLs nur gegen eine angegebene Basis auf', () => {
    const url = parseAllowedUrl('/rss/feed.xml', { base: 'https://example.com/artikel/1' });
    assert.equal(url.href, 'https://example.com/rss/feed.xml');

    // Ohne Basis bleibt eine relative Angabe ungültig.
    expectRejection('/rss/feed.xml', 'invalid_syntax');

    // Eine absolute URL gewinnt gegenüber der Basis.
    assert.equal(
        parseAllowedUrl('https://andere.example/x', { base: 'https://example.com/' }).host,
        'andere.example',
    );

    // Auch relativ aufgelöst bleibt das Schema geprüft.
    expectRejection('javascript:alert(1)', 'protocol_not_allowed', { base: 'https://example.com/' });
});

test('toAllowedUrl liefert null statt zu werfen', () => {
    assert.equal(toAllowedUrl('javascript:alert(1)'), null);
    assert.equal(toAllowedUrl(''), null);
    assert.equal(toAllowedUrl('https://example.com/x')?.href, 'https://example.com/x');
    assert.equal(isAllowedUrl('data:text/plain,x'), false);
});
