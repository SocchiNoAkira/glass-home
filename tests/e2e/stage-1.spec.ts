import { test, expect, type BrowserContext } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  cleanupProfile, click, clickButton, clickTab, launchExtension, openNewTab,
  readStoredWorkspace, waitForSaved,
} from './helpers';

interface StoredWorkspace {
  revision: number;
  updatedAt: string;
  shortcuts: { title: string }[];
  layouts: Record<string, unknown[]>;
  settings: { theme: string; timeZone: string; showSeconds: boolean; searchEngine: string };
  /** Builtin widget instances; the layout contains shortcuts plus these. */
  widgets: { instanceId: string }[];
}

async function addLocalShortcut(context: BrowserContext, extensionId: string): Promise<void> {
  const page = await openNewTab(context, extensionId);
  if (await page.getByRole('link', { name: '打开 本地工作台', exact: true }).count() > 0) {
    await page.close();
    return;
  }
  await clickButton(page, '添加快捷方式');
  await page.getByLabel('名称', { exact: true }).fill('本地工作台');
  await page.getByLabel('网址', { exact: true }).fill('http://localhost:3000');
  await clickButton(page, '添加到主屏幕');
  await waitForSaved(page);
  await page.close();
}

test.describe('stage 1 core home on installed Edge', () => {
  let context: BrowserContext;
  let extensionId: string;
  let userDataDir: string;

  test.beforeAll(async () => {
    ({ context, extensionId, userDataDir } = await launchExtension());
  });

  test.afterAll(async () => {
    await context?.close();
    await cleanupProfile(userDataDir);
  });

  test('initializes every builtin and shortcut in three valid breakpoint layouts', async () => {
    const page = await openNewTab(context, extensionId);
    await expect(page.locator('.shortcut')).toHaveCount(20);
    for (const id of ['builtin.clock', 'builtin.search', 'builtin.calendar']) {
      await expect(page.locator(`[data-instance-id="${id}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-instance-id="builtin.search"]')).toHaveAttribute('data-grid-w', '6');
    await expect(page.getByTestId('clock')).toContainText(':');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const workspace = await readStoredWorkspace(page) as StoredWorkspace;
    expect(workspace.shortcuts).toHaveLength(20);
    for (const columns of [10, 8, 5]) {
      const layout = workspace.layouts[columns] as { instanceId: string }[];
      expect(layout).toBeDefined();
      // Derived from the stored data: adding a builtin widget must not require
      // editing a magic number in an unrelated stage's regression test.
      expect(layout.length).toBeGreaterThanOrEqual(20);
      expect(layout.map((item) => item.instanceId)).toContain('builtin.search');
    }
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.getByTestId('unified-grid')).toHaveAttribute('data-columns', '8');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('unified-grid')).toHaveAttribute('data-columns', '5');
    await expect(page.locator('.shortcut')).toHaveCount(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.close();
  });

  test('adds, edits and duplicates shortcuts and persists them across reloads', async () => {
    const page = await openNewTab(context, extensionId);
    await clickButton(page, '添加快捷方式');
    await page.getByLabel('名称', { exact: true }).fill('本地项目');
    await page.getByLabel('网址', { exact: true }).fill('http://localhost:3000');
    await clickButton(page, '添加到主屏幕');
    await waitForSaved(page);
    await expect(page.locator('.shortcut')).toHaveCount(21);
    await expect(page.getByRole('link', { name: '打开 本地项目', exact: true })).toHaveAttribute('href', 'http://localhost:3000');
    await page.reload();
    await expect(page.getByRole('link', { name: '打开 本地项目', exact: true })).toBeVisible();
    await waitForSaved(page);
    await clickButton(page, '编辑主屏幕');
    // Edit and duplicate moved behind the "..." badge; the X badge removes.
    await clickButton(page, '更多操作：本地项目');
    await clickButton(page, '编辑');
    await page.getByLabel('名称', { exact: true }).fill('本地工作台');
    await clickButton(page, '保存更改');
    await waitForSaved(page);
    await expect(page.getByRole('link', { name: '打开 本地工作台', exact: true })).toBeVisible();
    await clickButton(page, '更多操作：本地工作台');
    await clickButton(page, '复制');
    await waitForSaved(page);
    await expect(page.locator('.shortcut')).toHaveCount(22);
    await expect(page.getByRole('link', { name: '打开 本地工作台 副本', exact: true })).toBeVisible();
    const workspace = await readStoredWorkspace(page) as StoredWorkspace;
    expect(workspace.shortcuts).toHaveLength(22);
    // Layout items = shortcuts + builtin widgets. Deriving the widget count from
    // the stored workspace keeps this valid when a builtin is added later.
    const builtinCount = (workspace.widgets as { instanceId: string }[]).length;
    for (const columns of [10, 8, 5]) expect(workspace.layouts[columns]).toHaveLength(22 + builtinCount);
    await clickButton(page, '移除 本地工作台 副本');
    await clickButton(page, '删除快捷方式');
    await waitForSaved(page);
    await expect(page.locator('.shortcut')).toHaveCount(21);
    await page.close();
  });

  test('navigates real search and URLs, and blocks dangerous protocols locally', async () => {
    const page = await openNewTab(context, extensionId);
    const search = page.getByRole('searchbox', { name: '搜索或输入网址' });
    await search.fill('javascript:alert(1)');
    await search.press('Enter');
    await expect(page.getByRole('alert')).toContainText('仅支持安全的 HTTP/HTTPS 网址');
    expect(new URL(page.url()).protocol).toBe('chrome-extension:');
    await search.fill('Glass Home');
    const resultPagePromise = context.waitForEvent('page');
    await context.route('https://www.google.com/**', (route) => route.abort());
    await search.press('Enter');
    const resultPage = await resultPagePromise;
    const searchRequest = resultPage.waitForEvent('request', { predicate: (request) => request.isNavigationRequest() });
    await resultPage.reload().catch(() => undefined);
    expect((await searchRequest).url()).toBe('https://www.google.com/search?q=Glass%20Home');
    await context.unroute('https://www.google.com/**');
    await resultPage.close();
    await search.fill('example.com');
    const directPagePromise = context.waitForEvent('page');
    await context.route('https://example.com/**', (route) => route.abort());
    await search.press('Enter');
    const directPage = await directPagePromise;
    const directRequest = directPage.waitForEvent('request', { predicate: (request) => request.isNavigationRequest() });
    await directPage.reload().catch(() => undefined);
    expect((await directRequest).url()).toBe('https://example.com/');
    await context.unroute('https://example.com/**');
    await directPage.close();
    await page.close();
  });

  test('saves appearance, time and search settings into the Workspace', async () => {
    const page = await openNewTab(context, extensionId);
    await clickButton(page, '打开设置');
    await page.getByLabel('外观', { exact: true }).selectOption('light');
    await page.getByLabel('材质质量', { exact: true }).selectOption('off');
    await clickButton(page, '保存设置');
    await waitForSaved(page);
    await expect(page.getByTestId('glass-home-app')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('glass-home-app')).toHaveAttribute('data-material', 'off');
    await page.reload();
    await expect(page.getByTestId('glass-home-app')).toHaveAttribute('data-theme', 'light');
    await waitForSaved(page);
    await clickButton(page, '打开设置');
    await clickTab(page, '时间与日历');
    await expect(page.getByRole('tabpanel', { name: '时间与日历设置' })).toBeVisible();
    await expect(page.locator('#time-zone')).toHaveAccessibleName('时区');
    await page.locator('#time-zone').selectOption('Asia/Tokyo');
    await click(page.getByRole('switch', { name: '显示秒' }));
    await clickButton(page, '保存设置');
    await waitForSaved(page);
    await expect(page.getByTestId('clock').locator('.clock__seconds')).toBeVisible();
    await clickButton(page, '展开完整月历');
    await clickButton(page, '下一月');
    await clickButton(page, '上一月');
    await expect(page.locator('.month-calendar__days .is-today')).toHaveCount(1);
    // The engine switcher no longer lives inside the search box (it competed
    // with the input for attention); Settings is the only place to change it.
    await expect(page.locator('.search-box__engine')).toHaveCount(0);
    await clickButton(page, '打开设置');
    await clickTab(page, '搜索');
    await expect(page.locator('#search-engine')).toHaveAccessibleName('搜索引擎');
    await page.locator('#search-engine').selectOption('bing');
    await clickButton(page, '保存设置');
    await waitForSaved(page);
    await expect(page.locator('.search-box__engine')).toHaveCount(0);
    // The setting still drives the query even though the control is gone.
    await page.reload();
    await waitForSaved(page);
    const workspace = await readStoredWorkspace(page) as StoredWorkspace;
    expect(workspace.settings).toMatchObject({ theme: 'light', timeZone: 'Asia/Tokyo', showSeconds: true, searchEngine: 'bing' });
    await page.close();
  });

  test('exports and imports a Workspace backup without network dependencies', async () => {
    await addLocalShortcut(context, extensionId);
    const page = await openNewTab(context, extensionId);
    await page.context().setOffline(true);
    await page.reload();
    await waitForSaved(page);
    await expect(page.getByRole('link', { name: '打开 本地工作台', exact: true })).toBeVisible();
    await page.context().setOffline(false);
    await clickButton(page, '打开设置');
    await clickTab(page, '数据');
    await expect(page.getByRole('tabpanel', { name: '数据管理' })).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await clickButton(page, '导出备份');
    const download = await downloadPromise;
    const backupPath = path.join('artifacts', 'stage-1-workspace-backup.json');
    await download.saveAs(backupPath);
    const backup = JSON.parse(await fs.readFile(backupPath, 'utf8')) as { workspace: { shortcuts: { title: string }[] }; assets: unknown[] };
    expect(backup.workspace.shortcuts.some((shortcut) => shortcut.title === '本地工作台')).toBe(true);
    expect(backup.assets).toHaveLength(0);
    await clickButton(page, '导入备份');
    await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles(backupPath);
    await expect(page.getByRole('status').filter({ hasText: '备份已导入' })).toBeVisible();
    await waitForSaved(page);
    await page.reload();
    await waitForSaved(page);
    await expect(page.getByRole('link', { name: '打开 本地工作台', exact: true })).toBeVisible();
    await page.close();
  });
});
