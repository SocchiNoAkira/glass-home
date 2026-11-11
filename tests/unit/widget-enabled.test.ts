import { describe, expect, it } from 'vitest';
import type { Workspace, WidgetInstance } from '@/src/domain/workspace/model';
import { createDefaultWorkspace } from '@/src/domain/workspace/defaults';
import { validateWorkspace } from '@/src/domain/workspace/schema';

/**
 * P15: `enabled: false` must actually disable a built-in widget.
 *
 * The host used to check `enabled` only *after* every built-in branch had
 * already returned, and the schema forbids unknown ids — so that branch was
 * unreachable and a disabled built-in rendered as fully working. The data model
 * carries the flag; it has to mean something.
 *
 * The rendering rule itself lives in `WidgetHost` (a React component, not unit-
 * testable here), so these cases pin the data side and the invariant the host
 * relies on: a disabled instance survives validation and is distinguishable.
 */

function disable(workspace: Workspace, instanceId: string): Workspace {
  return {
    ...workspace,
    widgets: workspace.widgets.map((widget): WidgetInstance => (
      widget.instanceId === instanceId ? { ...widget, enabled: false } : widget
    )),
  };
}

describe('P15: disabled built-in widgets', () => {
  it('keeps a disabled instance valid, so an imported backup can carry one', () => {
    // This is precisely why the host must handle it: the schema accepts
    // `enabled: false`, so data can arrive with it.
    const workspace = disable(createDefaultWorkspace(), 'builtin.todo');
    expect(() => validateWorkspace(workspace)).not.toThrow();
    expect(workspace.widgets.find((widget) => widget.instanceId === 'builtin.todo')?.enabled).toBe(false);
  });

  it('flags exactly the disabled instance, leaving the others enabled', () => {
    const workspace = disable(createDefaultWorkspace(), 'builtin.clock');
    const disabled = workspace.widgets.filter((widget) => !widget.enabled);
    expect(disabled.map((widget) => widget.instanceId)).toEqual(['builtin.clock']);
  });

  it('does not disturb the layout when an instance is disabled', () => {
    // Disabling is a state change, not a layout change: the cell must stay put,
    // otherwise the host's "disabled card in the same cell" would be a lie.
    const before = createDefaultWorkspace();
    const after = disable(before, 'builtin.search');
    for (const columns of ['10', '8', '5'] as const) {
      expect(after.layouts[columns]).toEqual(before.layouts[columns]);
    }
  });
});
