import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { captureViewport, clickButton, launchExtension, openNewTab, readStoredWorkspace, waitForSaved } from './helpers';

async function previewMove(page: import('@playwright/test').Page, object = 'github', x = 8, y = 2, preference?: 'auto' | 'push-first') {
  await clickButton(page, '编辑主屏幕');
  await page.locator('#layout-object').selectOption(object);
  await page.locator('#layout-x').fill(String(x));
  await page.locator('#layout-y').fill(String(y));
  if (preference) await page.locator('#layout-preference').selectOption(preference);
  await clickButton(page, '生成预览');
  await expect(page.locator('.layout-preview')).toBeVisible();
}

test('previews and cancels a move without changing the persisted Workspace', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    const before = await readStoredWorkspace(page);
    await previewMove(page);
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-x', '8');
    expect(await readStoredWorkspace(page)).toEqual(before);
    await captureViewport(page, 'stage-2a-preview-edge.png');
    await page.keyboard.press('Escape');
    await expect(page.locator('.layout-preview')).toHaveCount(0);
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-x', '0');
    expect(await readStoredWorkspace(page)).toEqual(before);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('commits, reloads and undoes/redoes a complete push chain in the same session', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    const before = await readStoredWorkspace(page) as {
      layouts: Record<'10' | '8' | '5', { instanceId: string; x: number; y: number }[]>;
      revision: number;
    };
    await previewMove(page, 'github', 1, 3, 'push-first');
    await expect(page.locator('.layout-preview')).toContainText('推挤');
    await expect(page.locator('.layout-preview')).toContainText('影响 11 个对象');
    await expect(page.locator('.layout-preview')).toContainText('youtube');
    await clickButton(page, '确认并保存');
    await waitForSaved(page);
    const committed = await readStoredWorkspace(page) as { layouts: Record<string, unknown[]>; revision: number };
    expect(committed.layouts[10]).not.toEqual(before.layouts[10]);
    expect(committed.layouts[8]).toEqual(before.layouts[8]);
    expect(committed.layouts[5]).toEqual(before.layouts[5]);
    expect(committed.revision).toBe(before.revision + 1);
    const changedInstanceIds = before.layouts['10'].filter((beforeItem) => {
      const afterItem = (committed.layouts['10'] as { instanceId: string; x: number; y: number }[])
        .find((item) => item.instanceId === beforeItem.instanceId);
      return afterItem && (afterItem.x !== beforeItem.x || afterItem.y !== beforeItem.y);
    }).map((item) => item.instanceId);
    expect(changedInstanceIds.length).toBeGreaterThan(1);
    await clickButton(page, '撤销布局');
    await waitForSaved(page);
    expect(await readStoredWorkspace(page)).toMatchObject({ layouts: before.layouts });
    await clickButton(page, '重做布局');
    await waitForSaved(page);
    expect(await readStoredWorkspace(page)).toMatchObject({ layouts: committed.layouts });
    await page.reload();
    await waitForSaved(page);
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-x', '1');
    await expect(page.getByRole('button', { name: '撤销布局', exact: true })).toBeDisabled();
    await captureViewport(page, 'stage-2a-committed-edge.png');
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('swaps icons and persists a Widget size preset and lock without changing other instances', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await previewMove(page, 'github', 1, 3);
    await expect(page.locator('.layout-preview')).toContainText('交换');
    await clickButton(page, '确认并保存');
    await waitForSaved(page);
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-x', '1');
    await expect(page.locator('[data-instance-id="figma"]')).toHaveAttribute('data-grid-x', '0');
    await page.locator('#layout-object').selectOption('builtin.calendar');
    await page.locator('#layout-size').selectOption('4x4');
    await expect(page.locator('.layout-preview')).toContainText('调整尺寸');
    await clickButton(page, '确认并保存');
    await waitForSaved(page);
    await clickButton(page, '锁定对象');
    await expect(page.locator('.layout-preview')).toContainText('锁定状态');
    await clickButton(page, '确认并保存');
    await waitForSaved(page);
    await page.reload();
    await waitForSaved(page);
    await expect(page.locator('[data-instance-id="builtin.calendar"]')).toHaveAttribute('data-grid-w', '4');
    await expect(page.locator('[data-instance-id="builtin.calendar"]')).toHaveAttribute('data-grid-h', '4');
    const stored = await readStoredWorkspace(page) as { layouts: Record<'10' | '8' | '5', { instanceId: string; locked: boolean }[]> };
    expect(stored.layouts[10].find((item) => item.instanceId === 'builtin.calendar')?.locked).toBe(true);
    expect(stored.layouts[8].find((item) => item.instanceId === 'builtin.calendar')?.locked).toBe(false);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('clears stale layout history after a shortcut add/remove operation', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await previewMove(page);
    await clickButton(page, '确认并保存');
    await waitForSaved(page);
    await expect(page.getByRole('button', { name: '撤销布局', exact: true })).toBeEnabled();
    await clickButton(page, '添加快捷方式');
    await page.getByLabel('名称', { exact: true }).fill('History guard');
    await page.getByLabel('网址', { exact: true }).fill('https://example.com');
    await clickButton(page, '添加到主屏幕');
    await waitForSaved(page);
    await expect(page.getByRole('button', { name: '撤销布局', exact: true })).toBeDisabled();
    await clickButton(page, '移除 History guard');
    await clickButton(page, '删除快捷方式');
    await waitForSaved(page);
    await expect(page.getByRole('button', { name: '撤销布局', exact: true })).toBeDisabled();
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('rolls back the preview and leaves no undo entry when the layout write fails', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    const before = await readStoredWorkspace(page);
    await page.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      Object.defineProperty(window, '__restoreLayoutTransaction', { value: original, configurable: true });
      IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args) {
        if (args[1] === 'readwrite') throw new DOMException('布局写入故障', 'InvalidStateError');
        return original.apply(this, args);
      } as typeof original;
    });
    await previewMove(page);
    await clickButton(page, '确认并保存');
    await expect(page.getByRole('alert')).toContainText('保存失败');
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-x', '0');
    await expect(page.getByRole('button', { name: '撤销布局', exact: true })).toBeDisabled();
    expect(await readStoredWorkspace(page)).toEqual(before);
    await page.reload();
    await waitForSaved(page);
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-x', '0');
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
