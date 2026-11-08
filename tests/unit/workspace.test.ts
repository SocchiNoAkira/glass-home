import { describe, expect, it } from 'vitest';
import { createDefaultWorkspace } from '@/src/domain/workspace/defaults';
import { addShortcut, removeShortcut, updateSettings, updateShortcut } from '@/src/domain/workspace/commands';
import { validateBackup, validateWorkspace } from '@/src/domain/workspace/schema';
import { GRID_BREAKPOINTS, isValidLayout } from '@/src/domain/grid/model';
import type { Shortcut } from '@/src/domain/workspace/model';

function shortcut(id = 'new-shortcut'): Shortcut {
  return { id, title: 'Local app', url: 'https://example.com', icon: 'L', openTarget: 'new', accentColor: '#7775e9', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

describe('Workspace schema and commands', () => {
  it('places every builtin component and shortcut in all three breakpoint layouts', () => {
    const workspace = createDefaultWorkspace();
    expect(workspace.shortcuts).toHaveLength(20);
    for (const columns of GRID_BREAKPOINTS) {
      const layout = workspace.layouts[columns];
      expect(layout).toHaveLength(23);
      expect(isValidLayout(layout, columns)).toBe(true);
      for (const id of ['builtin.clock', 'builtin.search', 'builtin.calendar']) {
        expect(layout.find((item) => item.instanceId === id)?.kind).toBe('widget');
      }
    }
    expect(validateWorkspace(workspace)).toEqual(workspace);
  });

  it('adds, edits, duplicates and removes an independent shortcut through commands', () => {
    const original = createDefaultWorkspace();
    const added = addShortcut(original, shortcut());
    expect(added.revision).toBe(1);
    for (const columns of GRID_BREAKPOINTS) expect(isValidLayout(added.layouts[columns], columns)).toBe(true);
    const updated = updateShortcut(added, { ...shortcut(), title: 'Renamed' });
    expect(updated.shortcuts.find((item) => item.id === 'new-shortcut')?.title).toBe('Renamed');
    const removed = removeShortcut(updated, 'new-shortcut');
    expect(removed.shortcuts).toHaveLength(20);
    for (const columns of GRID_BREAKPOINTS) expect(removed.layouts[columns]).toHaveLength(23);
    expect(original.revision).toBe(0);
  });

  it('rejects overlapping, missing, duplicated and unsafe data', () => {
    const workspace = createDefaultWorkspace();
    expect(() => validateWorkspace({ ...workspace, layouts: { ...workspace.layouts, 10: workspace.layouts[10].slice(0, -1) } })).toThrow('不完整');
    const first = workspace.layouts[10][0]!;
    const second = workspace.layouts[10][1]!;
    expect(() => validateWorkspace({ ...workspace, layouts: { ...workspace.layouts, 10: [{ ...first, x: second.x, y: second.y }, ...workspace.layouts[10].slice(1)] } })).toThrow('不合法');
    expect(() => validateWorkspace({ ...workspace, shortcuts: [{ ...workspace.shortcuts[0]!, url: 'javascript:alert(1)' }, ...workspace.shortcuts.slice(1)] })).toThrow('有效的 HTTP/HTTPS');
  });

  it('validates theme and timezone updates before committing', () => {
    const workspace = updateSettings(createDefaultWorkspace(), { theme: 'light', timeZone: 'Asia/Tokyo', showSeconds: true });
    expect(workspace.settings.theme).toBe('light');
    expect(() => updateSettings(workspace, { timeZone: 'Not/AZone' })).toThrow('时区设置无效');
  });

  it('accepts a local backup but rejects unreferenced executable/data assets', () => {
    const workspace = createDefaultWorkspace();
    expect(validateBackup({ format: 'glass-home-backup', version: 1, exportedAt: new Date().toISOString(), workspace, assets: [] })).toBeDefined();
    expect(() => validateBackup({ format: 'glass-home-backup', version: 1, exportedAt: new Date().toISOString(), workspace, assets: [{ id: 'orphan', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }] })).toThrow('不一致');
  });
});
