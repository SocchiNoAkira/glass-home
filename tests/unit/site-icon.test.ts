import { describe, expect, it } from 'vitest';
import { faviconCandidates } from '@/src/infrastructure/favicon/siteIcon';

/**
 * The browser's `_favicon` store is keyed by *page URL*, not by host: visiting
 * `site.com/` does not give `site.com/app` an icon. Asking for the exact URL
 * first and the origin second is what makes a shortcut to a deep link still find
 * the site's icon once the user has opened the site at all.
 */
describe('favicon lookup candidates', () => {
  it('asks for the exact page first, then its origin', () => {
    expect(faviconCandidates('https://github.com/orgs/glass-home/repos?page=2')).toEqual([
      'https://github.com/orgs/glass-home/repos?page=2',
      'https://github.com/',
    ]);
  });

  it('does not ask twice when the URL is already the origin', () => {
    expect(faviconCandidates('https://example.com/')).toEqual(['https://example.com/']);
    expect(faviconCandidates('https://example.com')).toEqual(['https://example.com/']);
  });

  it('drops the fragment, which is not part of the page identity', () => {
    expect(faviconCandidates('https://example.com/docs#install')).toEqual([
      'https://example.com/docs',
      'https://example.com/',
    ]);
  });

  it('ignores pages that cannot have a site icon', () => {
    expect(faviconCandidates('chrome://settings')).toEqual([]);
    expect(faviconCandidates('file:///tmp/page.html')).toEqual([]);
    expect(faviconCandidates('not a url')).toEqual([]);
  });
});
