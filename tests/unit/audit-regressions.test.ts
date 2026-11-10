import { describe, expect, it } from 'vitest';
import { OccupancyGrid } from '@/src/domain/grid/occupancy';
import type { LayoutItem } from '@/src/domain/grid/model';
import { resolveSearchDestination, validateSearchTemplate, parseSafeHttpUrl } from '@/src/domain/search/search';

/**
 * Regression coverage for the 2026-11-10 audit findings.
 *
 * The audit suite lives in `audit/`, which is git-ignored, so it cannot protect
 * these behaviours over time. Each case here pins one fixed defect to a
 * permanent guard in the project's own suite.
 */

function item(instanceId: string, x: number, y: number, w = 1, h = 1): LayoutItem {
  return { instanceId, kind: w > 1 ? 'widget' : 'shortcut', breakpoint: 10, x, y, w, h, locked: false, order: 0 };
}

const settings = (overrides: Partial<{ searchEngine: 'google' | 'custom'; customSearchTemplate: string }> = {}) => ({
  searchEngine: 'google' as const, customSearchTemplate: '', ...overrides,
});

describe('P9: OccupancyGrid.clone keeps occupancy', () => {
  it('copies the cells without doubling the backing array', () => {
    const grid = OccupancyGrid.fromLayout([item('a', 0, 0, 2, 2)], 10);
    const copy = grid.clone();
    // The old clone pushed source cells onto an assigned array, so at() indexed
    // the empty first half and reported every cell as free.
    expect(copy.at(0, 0)).toBe('a');
    expect(copy.at(1, 1)).toBe('a');
    expect(copy.at(2, 0)).toBeUndefined();
    expect(copy.rows).toBe(grid.rows);
  });

  it('is an independent copy', () => {
    const grid = OccupancyGrid.fromLayout([item('a', 0, 0, 2, 2)], 10);
    const copy = grid.clone();
    copy.remove(item('a', 0, 0, 2, 2));
    expect(copy.at(0, 0)).toBeUndefined();
    expect(grid.at(0, 0)).toBe('a');
  });
});

describe('P2: host:port navigates instead of being refused', () => {
  it('navigates localhost and domain hosts with a port', () => {
    // `localhost:` and `example.com:` both match the generic scheme pattern;
    // treating that as a protocol made the port branch below unreachable.
    expect(resolveSearchDestination('localhost:3000', settings())).toMatchObject({ ok: true, kind: 'url' });
    expect(resolveSearchDestination('example.com:8080', settings())).toMatchObject({ ok: true, kind: 'url' });
    const result = resolveSearchDestination('localhost:3000', settings());
    if (result.ok) expect(new URL(result.url).port).toBe('3000');
  });

  it('still refuses genuine non-http protocols', () => {
    // The fix must not turn the guard into a no-op.
    for (const input of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'chrome://settings']) {
      const result = resolveSearchDestination(input, settings());
      expect(result.ok).toBe(false);
    }
  });

  it('keeps plain host and path inputs navigating', () => {
    expect(resolveSearchDestination('localhost', settings())).toMatchObject({ ok: true, kind: 'url' });
    expect(resolveSearchDestination('example.com/path', settings())).toMatchObject({ ok: true, kind: 'url' });
  });

  it('multi-word input still becomes a search', () => {
    expect(resolveSearchDestination('example.com docs', settings())).toMatchObject({ ok: true, kind: 'search' });
  });
});

describe('P3: host-position {query} templates are refused', () => {
  it('rejects a placeholder in the authority', () => {
    // Substituting the safe literal 'test' made validation pass, but a real
    // query is percent-encoded first: 'hello world' became a host containing a
    // space, i.e. not a URL, and navigation failed with no message at all.
    expect(validateSearchTemplate('https://{query}.example.com/')).toMatch(/域名或端口位置/);
  });

  it('reports failure instead of an unusable ok result', () => {
    const custom = settings({ searchEngine: 'custom', customSearchTemplate: 'https://{query}.example.com/' });
    for (const query of ['hello world', 'a/b']) {
      const result = resolveSearchDestination(query, custom);
      expect(result.ok).toBe(false);
    }
  });

  it('accepts a placeholder in the path or query string', () => {
    expect(validateSearchTemplate('https://example.com/search?q={query}')).toBeUndefined();
    expect(validateSearchTemplate('https://example.com/{query}')).toBeUndefined();
  });

  it('re-validates the substituted URL as a second gate', () => {
    const result = resolveSearchDestination('hello world', settings());
    expect(result.ok).toBe(true);
    if (result.ok) expect(parseSafeHttpUrl(result.url)).toBeDefined();
  });
});
