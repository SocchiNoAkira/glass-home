import { describe, expect, it } from 'vitest';
import { parseSafeHttpUrl, resolveSearchDestination, validateSearchTemplate } from '@/src/domain/search/search';

const settings = { searchEngine: 'google' as const, customSearchTemplate: '' };

describe('search navigation safety', () => {
  it('builds an encoded search query without contacting a suggestion service', () => {
    const result = resolveSearchDestination('玻璃 主屏幕 & local', settings);
    expect(result).toEqual({ ok: true, kind: 'search', url: 'https://www.google.com/search?q=%E7%8E%BB%E7%92%83%20%E4%B8%BB%E5%B1%8F%E5%B9%95%20%26%20local' });
  });

  it.each(['google', 'bing', 'baidu', 'duckduckgo'] as const)('supports %s', (searchEngine) => {
    const result = resolveSearchDestination('hello world', { ...settings, searchEngine });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toContain('hello%20world');
  });

  it('recognizes URLs and adds HTTPS for domain input', () => {
    expect(resolveSearchDestination('example.com/docs', settings)).toEqual({ ok: true, kind: 'url', url: 'https://example.com/docs' });
    expect(resolveSearchDestination('http://localhost:3000/test', settings)).toEqual({ ok: true, kind: 'url', url: 'http://localhost:3000/test' });
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'chrome://settings', 'https://user:pass@example.com'])('rejects %s', (input) => {
    expect(resolveSearchDestination(input, settings).ok).toBe(false);
    expect(parseSafeHttpUrl(input)).toBeUndefined();
  });

  it('searches for ambiguous domain-like terms rather than navigating incorrectly', () => {
    const result = resolveSearchDestination('什么是 example.com', settings);
    expect(result.ok && result.kind === 'search').toBe(true);
  });

  it('validates custom search templates and their protocol', () => {
    expect(validateSearchTemplate('https://example.com/search?q={query}')).toBeUndefined();
    expect(validateSearchTemplate('https://example.com/search')).toContain('{query}');
    expect(validateSearchTemplate('javascript:alert({query})')).toBeDefined();
    expect(resolveSearchDestination('test', { searchEngine: 'custom', customSearchTemplate: 'https://example.com/?q={query}' })).toEqual({ ok: true, kind: 'search', url: 'https://example.com/?q=test' });
  });
});
