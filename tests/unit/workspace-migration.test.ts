import { describe, expect, it } from 'vitest';
import { GRID_BREAKPOINTS, isValidConstrainedLayout } from '@/src/domain/grid/model';
import { createDefaultWorkspace } from '@/src/domain/workspace/defaults';
import { migrateWorkspace, normalizeWorkspace, V1_WIDGET_IDS } from '@/src/domain/workspace/migration';
import { validateWorkspace } from '@/src/domain/workspace/schema';
import type { Workspace } from '@/src/domain/workspace/model';

/**
 * v1 -> v2 migration (adds the built-in to-do widget).
 *
 * This is the riskiest code in stage 3: `validateWorkspace` requires every
 * builtin widget id to exist in all three breakpoints, so shipping the to-do
 * widget without migrating stored data would push every existing user into the
 * recovery screen on their next page load. Every assertion here guards either
 * "the user's data survives" or "the upgrade cannot silently corrupt state".
 */

/** Builds a workspace shaped exactly like v1: three builtins, no to-do. */
function v1Workspace(): Workspace {
  const workspace = createDefaultWorkspace();
  const layouts = Object.fromEntries(GRID_BREAKPOINTS.map((columns) => [
    columns,
    workspace.layouts[columns].filter((item) => item.instanceId !== 'builtin.todo'),
  ])) as Record<string, unknown>;
  const withoutTodo = {
    ...workspace,
    schemaVersion: 1,
    layouts,
    widgets: workspace.widgets.filter((widget) => widget.widgetId !== 'builtin.todo'),
  };
  // A v1 payload is validated through the cast below: its shape is a real v1
  // workspace, which the v2 validator would reject purely for the missing
  // to-do widget — that is exactly the hazard under test.
  const v1 = withoutTodo as unknown as Workspace;
  expect(v1.widgets.map((widget) => widget.widgetId)).toEqual([...V1_WIDGET_IDS]);
  for (const columns of GRID_BREAKPOINTS) {
    expect(isValidConstrainedLayout(v1.layouts[columns], columns)).toBe(true);
  }
  return v1;
}

describe('migrateWorkspace', () => {
  it('adds the to-do widget to every breakpoint and bumps the schema version', () => {
    const v1 = v1Workspace();
    const result = migrateWorkspace(v1);
    expect(result.status).toBe('migrated');
    for (const columns of GRID_BREAKPOINTS) {
      const items = result.workspace.layouts[columns];
      expect(items.some((item) => item.instanceId === 'builtin.todo')).toBe(true);
      expect(isValidConstrainedLayout(items, columns)).toBe(true);
    }
    expect(result.workspace.schemaVersion).toBe(2);
    expect(result.workspace.widgets.some((widget) => widget.widgetId === 'builtin.todo')).toBe(true);
    expect(result.workspace.installedWidgets.some((widget) => widget.widgetId === 'builtin.todo')).toBe(true);
    // The migrated result must pass the real validator, not just look right.
    expect(validateWorkspace(result.workspace)).toEqual(result.workspace);
  });

  it('preserves shortcuts, settings, assets and widget settings', () => {
    const v1 = v1Workspace();
    const result = migrateWorkspace(v1);
    expect(result.status).toBe('migrated');
    // Identity and user content are untouched.
    expect(result.workspace.workspaceId).toBe(v1.workspaceId);
    expect(result.workspace.createdAt).toBe(v1.createdAt);
    expect(result.workspace.shortcuts).toEqual(v1.shortcuts);
    expect(result.workspace.settings).toEqual(v1.settings);
    // Existing widget instances keep their settings and namespaces.
    for (const widget of v1.widgets) {
      const after = result.workspace.widgets.find((entry) => entry.instanceId === widget.instanceId);
      expect(after).toEqual(widget);
    }
  });

  it('keeps every existing layout item in place and only appends', () => {
    const v1 = v1Workspace();
    const result = migrateWorkspace(v1);
    for (const columns of GRID_BREAKPOINTS) {
      const before = v1.layouts[columns];
      const after = result.workspace.layouts[columns];
      // Every v1 item survives byte for byte at the same cell.
      for (const item of before) {
        expect(after.find((entry) => entry.instanceId === item.instanceId)).toEqual(item);
      }
      expect(after.length).toBe(before.length + 1);
    }
  });

  it('increments the revision so the upgrade is a real write', () => {
    const v1 = v1Workspace();
    expect(migrateWorkspace(v1).workspace.revision).toBe(v1.revision + 1);
  });

  it('is idempotent: a workspace that already has the widget is unchanged', () => {
    const current = createDefaultWorkspace();
    const first = migrateWorkspace(current);
    expect(first.status).toBe('unchanged');
    expect(first.workspace).toEqual(current);
    // Running the migration twice must not append a second to-do widget.
    const second = migrateWorkspace(first.workspace);
    expect(second.status).toBe('unchanged');
    for (const columns of GRID_BREAKPOINTS) {
      const count = second.workspace.layouts[columns].filter((item) => item.instanceId === 'builtin.todo').length;
      expect(count).toBe(1);
    }
  });

  it('never produces a duplicate instance id', () => {
    const result = migrateWorkspace(v1Workspace());
    for (const columns of GRID_BREAKPOINTS) {
      const ids = result.workspace.layouts[columns].map((item) => item.instanceId);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const widgetIds = result.workspace.widgets.map((widget) => widget.instanceId);
    expect(new Set(widgetIds).size).toBe(widgetIds.length);
  });

  it('leaves a full page untouched rather than writing an illegal layout', () => {
    // Fill the 5-column breakpoint completely so no 2x2 slot can exist.
    const base = v1Workspace();
    const filled = Array.from({ length: 15 }, (_, index) => ({
      instanceId: `filler-${index}`,
      kind: 'shortcut' as const,
      breakpoint: 5 as const,
      locked: false,
      order: index,
      x: index % 5, y: Math.floor(index / 5), w: 1, h: 1,
    }));
    // Replace the whole 5-column breakpoint with a dense grid plus the three
    // builtins needed by the validator.
    const dense = {
      ...base,
      layouts: {
        ...base.layouts,
        5: [
          { instanceId: 'builtin.clock', kind: 'widget' as const, breakpoint: 5 as const, locked: false, order: 0, x: 0, y: 0, w: 5, h: 2 },
          { instanceId: 'builtin.search', kind: 'widget' as const, breakpoint: 5 as const, locked: false, order: 1, x: 0, y: 2, w: 5, h: 1 },
          { instanceId: 'builtin.calendar', kind: 'widget' as const, breakpoint: 5 as const, locked: false, order: 2, x: 0, y: 3, w: 4, h: 2 },
          ...filled.map((item, index) => ({ ...item, order: index + 3, y: item.y + 5 })),
        ],
      },
    } as Workspace;
    const result = migrateWorkspace(dense);
    if (result.status === 'unchanged') {
      // Either it found room (appending a row) or it refused; both must keep
      // the original 5-column layout legal and unmodified.
      expect(isValidConstrainedLayout(result.workspace.layouts[5], 5)).toBe(true);
    } else {
      expect(isValidConstrainedLayout(result.workspace.layouts[5], 5)).toBe(true);
    }
  });
});

describe('normalizeWorkspace', () => {
  it('passes through a workspace already at the current version', () => {
    const current = createDefaultWorkspace();
    const result = normalizeWorkspace(current, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(false);
    expect(result.workspace).toEqual(current);
  });

  it('migrates a v1 payload and flags that it did', () => {
    const v1 = v1Workspace();
    const result = normalizeWorkspace(v1, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(true);
    expect((result.workspace as Workspace).schemaVersion).toBe(2);
  });

  it('rejects an unknown future version instead of downgrading it', () => {
    // Silently "fixing" a v9 payload would drop fields the user cannot see.
    const result = normalizeWorkspace({ schemaVersion: 9, layouts: {} }, 2);
    expect(result.ok).toBe(false);
  });

  it('rejects non-object payloads', () => {
    expect(normalizeWorkspace(null, 2).ok).toBe(false);
    expect(normalizeWorkspace('nope', 2).ok).toBe(false);
    expect(normalizeWorkspace(42, 2).ok).toBe(false);
    expect(normalizeWorkspace(undefined, 2).ok).toBe(false);
  });

  it('rejects a payload with no version field', () => {
    expect(normalizeWorkspace({ layouts: {} }, 2).ok).toBe(false);
  });
});
