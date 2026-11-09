import { describe, expect, it } from 'vitest';
import { createDefaultWorkspace } from '@/src/domain/workspace/defaults';
import { validateBackup } from '@/src/domain/workspace/schema';
import { WIDGET_NAMESPACE_QUOTA_BYTES } from '@/src/domain/workspace/model';
import { localKey, evaluateQuota, payloadBytes } from '@/src/infrastructure/persistence/widgetStorage';

/**
 * Stage 4A: a backup must carry widget data (baseline 14.3), and the validator
 * is the only thing standing between a hand-edited file and another user's
 * namespace. These cases pin the rules that matter for privacy.
 */

function backup(widgetData?: unknown) {
  const workspace = createDefaultWorkspace();
  const base = {
    format: 'glass-home-backup' as const,
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    workspace,
    assets: [],
  };
  return widgetData === undefined ? base : { ...base, widgetData };
}

const todoRecord = { namespace: 'builtin.todo', key: 'state', payload: JSON.stringify({ items: [], version: 1 }), updatedAt: new Date().toISOString() };

describe('backup widget data', () => {
  it('accepts a backup that carries a declared namespace', () => {
    const parsed = validateBackup(backup([todoRecord]));
    expect(parsed.widgetData).toHaveLength(1);
    expect(parsed.widgetData?.[0]?.key).toBe('state');
  });

  it('keeps an absent widget-data field absent, so old backups do not wipe widget rows', () => {
    const parsed = validateBackup(backup());
    // The importer relies on this: `?? []` here would turn "older file" into
    // "the user had no data" and delete an existing to-do list on import.
    expect(parsed.widgetData).toBeUndefined();
  });

  it('accepts an explicitly empty widget-data array as "this backup has none"', () => {
    const parsed = validateBackup(backup([]));
    expect(parsed.widgetData).toEqual([]);
  });

  it('rejects a namespace the workspace does not declare', () => {
    // Injecting rows into an undeclared namespace is how one widget would read
    // another's data, so this is the central isolation guard.
    expect(() => validateBackup(backup([{ ...todoRecord, namespace: 'com.evil.notes' }]))).toThrow('未声明');
  });

  it('rejects duplicate records for the same namespace and key', () => {
    expect(() => validateBackup(backup([todoRecord, todoRecord]))).toThrow('不能重复');
  });

  it('rejects a key that already contains the namespace prefix', () => {
    expect(() => validateBackup(backup([{ ...todoRecord, key: 'builtin.todo:state' }]))).toThrow('命名空间前缀');
  });

  it('rejects a payload that is not JSON', () => {
    expect(() => validateBackup(backup([{ ...todoRecord, payload: '{not json' }]))).toThrow('有效的 JSON');
  });

  it('weights every record of one namespace together, not just the last one', () => {
    // Two records that each pass the per-record schema limit but sum past the
    // namespace quota must fail together: validating them one at a time is
    // exactly how a backup would exceed the storage quota it hits on import.
    const chunk = 'x'.repeat(Math.ceil(WIDGET_NAMESPACE_QUOTA_BYTES / 2) + 100);
    const make = (key: string) => ({ ...todoRecord, key, payload: JSON.stringify({ blob: chunk }) });
    const single = payloadBytes(JSON.parse(make('a').payload));
    expect(single).toBeLessThan(WIDGET_NAMESPACE_QUOTA_BYTES);
    expect(single * 2).toBeGreaterThan(WIDGET_NAMESPACE_QUOTA_BYTES);
    expect(() => validateBackup(backup([make('a'), make('b')]))).toThrow('配额');
  });
});

describe('widget storage key handling', () => {
  it('strips exactly the caller namespace, keeping dotted ids intact', () => {
    // A namespaced widgetId contains colons-free dots, but the local key may
    // itself contain one; splitting on the first ':' is the wrong move.
    expect(localKey('com.example.notes', 'com.example.notes:draft')).toBe('draft');
    expect(localKey('builtin.todo', 'builtin.todo:state')).toBe('state');
  });

  it('returns the key unchanged when the namespace prefix is absent', () => {
    expect(localKey('builtin.todo', 'state')).toBe('state');
  });

  it('judges quota on the net change so rewriting the same payload still fits', () => {
    const atLimit = WIDGET_NAMESPACE_QUOTA_BYTES;
    const verdict = evaluateQuota(atLimit, 100, 100);
    expect(verdict.fits).toBe(true);
  });
});
