import { test, expect } from '@playwright/test';
import { cleanupProfile, clickButton, clickTab, launchExtension, openNewTab, readStoredWorkspace, waitForSaved } from './helpers';

const titles = ['GitHub', 'Figma', 'Notion', 'Linear', 'Apple', 'YouTube', 'Gmail', 'Calendar', 'Vercel', 'MDN', 'ChatGPT', 'Claude', 'X', 'Dribbble', '翻译', '地图', '云端硬盘', '音乐', 'Wikipedia', '稍后阅读'];

test('restores shortcuts and settings after a full browser restart', async () => {
  let { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await clickButton(page, '添加快捷方式');
    await page.getByLabel('名称', { exact: true }).fill('重启后保留');
    await page.getByLabel('网址', { exact: true }).fill('https://example.com');
    await clickButton(page, '添加到主屏幕');
    await waitForSaved(page);
    await clickButton(page, '打开设置');
    await page.locator('#theme').selectOption('light');
    await clickButton(page, '保存设置');
    await waitForSaved(page);
    await context.close();
    ({ context, extensionId } = await launchExtension(userDataDir));
    const restored = await openNewTab(context, extensionId);
    await expect(restored.getByRole('link', { name: '打开 重启后保留', exact: true })).toBeVisible();
    await expect(restored.getByTestId('glass-home-app')).toHaveAttribute('data-theme', 'light');
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('shows an empty state after deleting every shortcut without losing builtins', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await clickButton(page, '编辑主屏幕');
    for (const title of titles) {
      await clickButton(page, `移除 ${title}`);
      await clickButton(page, '删除快捷方式');
      await waitForSaved(page);
    }
    await expect(page.locator('.shortcut')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '从这里，开始你的空间' })).toBeVisible();
    for (const id of ['builtin.clock', 'builtin.search', 'builtin.calendar']) {
      await expect(page.locator(`[data-instance-id="${id}"]`)).toBeVisible();
    }
    await page.reload();
    await waitForSaved(page);
    await expect(page.getByRole('heading', { name: '从这里，开始你的空间' })).toBeVisible();
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('suppresses accidental navigation after pointer movement without changing layout', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    const before = await readStoredWorkspace(page);
    const link = page.getByRole('link', { name: '打开 GitHub', exact: true });
    const bounds = await link.boundingBox();
    if (!bounds) throw new Error('Shortcut has no bounds');
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 35, y + 20, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(new URL(page.url()).protocol).toBe('chrome-extension:');
    expect(context.pages().filter((candidate) => candidate.url().startsWith('https://github.com'))).toHaveLength(0);
    expect(await readStoredWorkspace(page)).toEqual(before);
    const newPagePromise = context.waitForEvent('page');
    await context.route('https://github.com/**', (route) => route.abort());
    await link.click();
    const destination = await newPagePromise;
    await context.unroute('https://github.com/**');
    await destination.close();
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('rolls back a failed write and rejects an invalid backup without mutating the Workspace', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    const before = await readStoredWorkspace(page);
    await page.evaluate(() => {
      const original = IDBDatabase.prototype.transaction;
      Object.defineProperty(window, '__restoreTransaction', { value: original, configurable: true });
      IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args) {
        if (args[1] === 'readwrite') throw new DOMException('测试写入故障', 'InvalidStateError');
        return original.apply(this, args);
      } as typeof original;
    });
    await clickButton(page, '添加快捷方式');
    await page.getByLabel('名称', { exact: true }).fill('不应保留');
    await page.getByLabel('网址', { exact: true }).fill('https://example.com');
    await clickButton(page, '添加到主屏幕');
    await expect(page.getByRole('alert')).toContainText('保存失败');
    await expect(page.locator('.local-status')).toHaveAttribute('data-save-state', 'error');
    await expect(page.getByRole('link', { name: '打开 不应保留', exact: true })).toHaveCount(0);
    await page.evaluate(() => {
      const original = (window as unknown as { __restoreTransaction: typeof IDBDatabase.prototype.transaction }).__restoreTransaction;
      IDBDatabase.prototype.transaction = original;
    });
    await clickButton(page, '打开设置');
    await clickTab(page, '数据');
    await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"wrong"}') });
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    expect(await readStoredWorkspace(page)).toEqual(before);
    await page.reload();
    await waitForSaved(page);
    await expect(page.locator('.shortcut')).toHaveCount(20);
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});
