import { describe, expect, it } from 'vitest';
import { WIDGET_STORAGE_QUOTA_BYTES, evaluateQuota, payloadBytes } from '@/src/infrastructure/persistence/widgetStorage';

/**
 * Quota arithmetic for per-instance widget storage.
 *
 * The interesting case is the rewrite: a widget that saves the same payload
 * repeatedly once its namespace is nearly full must keep succeeding, which
 * only works when the old bytes are credited back. IndexedDB itself is covered
 * by the browser suite (stage-3-widget.spec.ts), since vitest runs without it.
 */

describe('payload measurement', () => {
  it('counts UTF-8 bytes, not characters', () => {
    // JSON.stringify('中') is `"中"`: two quote bytes plus three UTF-8 bytes
    // for the character, so a Chinese string costs 3 bytes per character.
    expect(payloadBytes('中')).toBe(5);
    // JSON.stringify('a') is `"a"`: two quotes plus one byte.
    expect(payloadBytes('a')).toBe(3);
    // JSON.stringify({ a: 1 }) is `{"a":1}`.
    expect(payloadBytes({ a: 1 })).toBe(7);
  });

  it('measures a to-do list as the stored JSON, not the object graph', () => {
    const items = [{ id: 'a', text: 'buy milk', done: false }];
    expect(payloadBytes({ items })).toBe(new TextEncoder().encode(JSON.stringify({ items })).byteLength);
  });
});

describe('quota decisions', () => {
  it('accepts a write that leaves room', () => {
    const verdict = evaluateQuota(0, 1024, undefined);
    expect(verdict).toEqual({ fits: true, nextUsage: 1024 });
  });

  it('accepts a write that lands exactly on the limit', () => {
    const verdict = evaluateQuota(0, WIDGET_STORAGE_QUOTA_BYTES, undefined);
    expect(verdict).toEqual({ fits: true, nextUsage: WIDGET_STORAGE_QUOTA_BYTES });
  });

  it('rejects a write that exceeds the limit by one byte', () => {
    const verdict = evaluateQuota(0, WIDGET_STORAGE_QUOTA_BYTES + 1, undefined);
    expect(verdict.fits).toBe(false);
  });

  it('credits the replaced payload back to the namespace', () => {
    // A namespace at 240 KB rewriting a 100 KB value with an identical one
    // must fit, because nothing is actually added.
    const rewritten = evaluateQuota(240 * 1024, 100 * 1024, 100 * 1024);
    expect(rewritten).toEqual({ fits: true, nextUsage: 240 * 1024 });
    // Without the credit it would have looked like 340 KB.
    expect(evaluateQuota(240 * 1024, 100 * 1024, undefined).fits).toBe(false);
  });

  it('accounts for growth when replacing a smaller value', () => {
    const grown = evaluateQuota(200 * 1024, 80 * 1024, 20 * 1024);
    // 200 + 80 - 20 = 260 KB, which is over the 256 KB limit.
    expect(grown).toEqual({ fits: false, nextUsage: 260 * 1024 });
  });

  it('accounts for shrinkage when replacing a larger value', () => {
    const shrunk = evaluateQuota(250 * 1024, 10 * 1024, 60 * 1024);
    expect(shrunk).toEqual({ fits: true, nextUsage: 200 * 1024 });
  });

  it('never reports a negative usage', () => {
    // Defensive: a stale previousBytes larger than the current usage must not
    // produce a negative number that later arithmetic could trust.
    const verdict = evaluateQuota(0, 100, 500);
    expect(verdict.nextUsage).toBeLessThan(100);
    expect(verdict.fits).toBe(true);
  });
});
