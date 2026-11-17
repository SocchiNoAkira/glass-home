import { describe, expect, it } from 'vitest';
import { createDefaultWorkspace } from '@/src/domain/workspace/defaults';
import { addWidget, removeWidget } from '@/src/domain/workspace/commands';
import { validateWorkspace } from '@/src/domain/workspace/schema';
import { BUILTIN_SIZE_CONSTRAINTS, GRID_BREAKPOINTS, isValidConstrainedLayout, isValidSize } from '@/src/domain/grid/model';
import { WIDGET_CATALOG, widgetCatalogEntry } from '@/src/domain/widget/catalog';

/**
 * Adding and removing widgets is a data-model change, not just a button: the
 * validator used to require all four built-ins to exist in every breakpoint, so
 * these cases pin down both directions — a workspace with no widgets is valid,
 * and a widget that comes back is placed in all three layouts again.
 */

const TODO = 'builtin.todo' as const;

function withoutTodo() {
  return removeWidget(createDefaultWorkspace(), TODO);
}

describe('widget catalog', () => {
  it('offers exactly the built-ins this build can render', () => {
    expect(WIDGET_CATALOG.map((entry) => entry.widgetId).sort()).toEqual(
      ['builtin.calendar', 'builtin.clock', 'builtin.search', 'builtin.todo'],
    );
  });

  it('keeps every default footprint inside the widget size constraints', () => {
    for (const entry of WIDGET_CATALOG) {
      const constraint = BUILTIN_SIZE_CONSTRAINTS[entry.widgetId];
      if (!constraint) throw new Error(`${entry.widgetId} 缺少尺寸约束`);
      for (const columns of GRID_BREAKPOINTS) {
        const size = entry.footprint[columns];
        expect(size.w).toBeLessThanOrEqual(columns);
        expect(isValidSize(size, constraint), `${entry.widgetId} @ ${columns}`).toBe(true);
      }
    }
  });
});

describe('removing a widget', () => {
  it('drops the instance and its cell from all three layouts', () => {
    const original = createDefaultWorkspace();
    const removed = withoutTodo();

    expect(removed.widgets.map((widget) => widget.instanceId)).not.toContain(TODO);
    expect(removed.revision).toBe(original.revision + 1);
    for (const columns of GRID_BREAKPOINTS) {
      expect(removed.layouts[columns].some((item) => item.instanceId === TODO)).toBe(false);
      expect(isValidConstrainedLayout(removed.layouts[columns], columns)).toBe(true);
    }
    // The type stays declared: the gallery is driven by what this build ships.
    expect(removed.installedWidgets.some((widget) => widget.widgetId === TODO)).toBe(true);
    expect(validateWorkspace(removed)).toEqual(removed);
  });

  it('is a no-op for an instance that is not there', () => {
    const removed = withoutTodo();
    expect(removeWidget(removed, TODO)).toBe(removed);
  });
});

describe('adding a widget', () => {
  it('places it in the first free cell of every breakpoint', () => {
    const added = addWidget(withoutTodo(), TODO);
    const entry = widgetCatalogEntry(TODO);
    if (!entry) throw new Error('to-do must be in the catalog');

    expect(added.widgets.map((widget) => widget.instanceId)).toContain(TODO);
    for (const columns of GRID_BREAKPOINTS) {
      const item = added.layouts[columns].find((candidate) => candidate.instanceId === TODO);
      expect(item).toMatchObject({ kind: 'widget', w: entry.footprint[columns].w, h: entry.footprint[columns].h });
      expect(isValidConstrainedLayout(added.layouts[columns], columns)).toBe(true);
    }
    expect(validateWorkspace(added)).toEqual(added);
  });

  it('refuses a second instance of the same type', () => {
    // One instance per type: the to-do widget's data lives under a namespace
    // named after the widget id, so a copy would share (and clear) the same list.
    expect(() => addWidget(createDefaultWorkspace(), TODO)).toThrow('已经在主屏幕上');
  });

  it('round-trips: remove then add restores a valid workspace', () => {
    const original = createDefaultWorkspace();
    const restored = addWidget(withoutTodo(), TODO);
    expect(restored.widgets).toHaveLength(original.widgets.length);
    for (const columns of GRID_BREAKPOINTS) {
      expect(restored.layouts[columns]).toHaveLength(original.layouts[columns].length);
      expect(isValidConstrainedLayout(restored.layouts[columns], columns)).toBe(true);
    }
    expect(() => validateWorkspace(restored)).not.toThrow();
  });
});

describe('widget validation rules that must stay', () => {
  it('rejects an instance whose type is not declared in installedWidgets', () => {
    const workspace = createDefaultWorkspace();
    const undeclared = {
      ...workspace,
      installedWidgets: workspace.installedWidgets.filter((widget) => widget.widgetId !== TODO),
    };
    expect(() => validateWorkspace(undeclared)).toThrow('缺少内置组件声明');
  });

  it('rejects an instance of an unknown widget type', () => {
    const workspace = createDefaultWorkspace();
    const unknown = {
      ...workspace,
      widgets: workspace.widgets.map((widget) => widget.widgetId === TODO ? { ...widget, widgetId: 'builtin.third-party' } : widget),
    };
    expect(() => validateWorkspace(unknown)).toThrow('只能导入已支持的内置组件');
  });

  it('rejects two instances sharing one storage namespace', () => {
    const workspace = createDefaultWorkspace();
    const shared = {
      ...workspace,
      widgets: workspace.widgets.map((widget) => widget.widgetId === TODO
        ? { ...widget, storageNamespace: 'builtin.calendar' }
        : widget),
    };
    expect(() => validateWorkspace(shared)).toThrow('命名空间不能重复');
  });

  it('accepts a home screen with no widgets at all', () => {
    const empty = ['builtin.clock', 'builtin.search', 'builtin.calendar', 'builtin.todo']
      .reduce((workspace, widgetId) => removeWidget(workspace, widgetId), createDefaultWorkspace());
    expect(empty.widgets).toHaveLength(0);
    expect(validateWorkspace(empty)).toEqual(empty);
    for (const columns of GRID_BREAKPOINTS) {
      expect(empty.layouts[columns]).toHaveLength(empty.shortcuts.length);
    }
  });
});
