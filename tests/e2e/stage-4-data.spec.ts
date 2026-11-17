import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { captureViewport, cleanupProfile, click, clickButton, clickTab, launchExtension, openNewTab, readStoredWorkspace, waitForSaved } from './helpers';

/**
 * Stage 4 acceptance in real Edge: backup must carry widget data (baseline
 * 14.3) and the two clear entries must exist and actually work (baseline 12.4).
 *
 * The old-backup case is the subtle one. A file exported before `widgetData`
 * existed has no such field, and importing it must NOT wipe the to-do list that
 * is currently stored — "no field" and "empty list" are different facts.
 */

const todo = (page: Page) => page.locator('[data-widget-instance="builtin.todo"]');
const todoRow = (page: Page) => page.locator('[data-widget-namespace="builtin.todo"]');

async function readWidgetPayload(page: Page, namespace: string): Promise<unknown> {
  return page.evaluate(async (ns) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('glass-home');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise((resolve, reject) => {
      const store = database.transaction('widget-data', 'readonly').objectStore('widget-data');
      const request = store.get(`${ns}:state`);
      request.onsuccess = () => resolve(request.result?.payload ?? null);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return value;
  }, namespace);
}

/** Counts every row in every store, so "clear all" can be checked honestly. */
async function readStoreCounts(page: Page): Promise<{ workspaces: number; assets: number; widgetData: number }> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('glass-home');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // Store names are hyphenated (`widget-data`), the returned keys are not;
    // mapping explicitly keeps the two vocabularies from silently mismatching.
    const stores = { workspaces: 'workspaces', assets: 'assets', widgetData: 'widget-data' } as const;
    const counts: Record<string, number> = {};
    for (const [key, name] of Object.entries(stores)) {
      counts[key] = await new Promise<number>((resolve, reject) => {
        const request = database.transaction(name, 'readonly').objectStore(name).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    database.close();
    return counts as { workspaces: number; assets: number; widgetData: number };
  });
}

/**
 * Waits for the post-clear state instead of reading it once.
 *
 * `location.reload()` is asynchronous, and `waitForLoadState('load')` resolves
 * immediately against the page that is already loaded. Polling the stores is the
 * only honest synchronisation point: it waits for the new page to recreate the
 * default workspace, and still fails if that never happens.
 *
 * A poll can land mid-navigation, where `page.evaluate` throws
 * "Execution context was destroyed". That is not a failure — it means the
 * reload is in progress — so it is treated as "not settled yet" and retried.
 */
async function waitForClearedState(page: Page): Promise<void> {
  await expect.poll(async () => {
    try {
      const counts = await readStoreCounts(page);
      return counts.assets === 0 && counts.widgetData === 0 && counts.workspaces === 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Only navigation races are retried; a genuine read failure should fail.
      if (/Execution context was destroyed|because of a navigation|Target page, context or browser has been closed/.test(message)) {
        return false;
      }
      throw error;
    }
  }, { timeout: 15_000, intervals: [250, 500, 1000] }).toBe(true);
}

async function openDataTab(page: Page): Promise<void> {
  // A previous modal (settings, confirm) must be closed first: the next click
  // would otherwise be swallowed by an inert page behind a native dialog.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await clickButton(page, '打开设置');
  await clickTab(page, '数据');
}

async function addTodo(page: Page, text: string): Promise<void> {
  const input = page.locator('.todo-widget__input');
  await input.fill(text);
  await input.press('Enter');
}

test('a backup carries widget data and restores the to-do list after a full clear', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await expect(todo(page)).toHaveAttribute('data-todo-loaded', 'true');
    await addTodo(page, '备份前写下的事项');
    await expect(page.locator('.todo-widget__item')).toHaveCount(1);

    await openDataTab(page);
    const downloadPromise = page.waitForEvent('download');
    await clickButton(page, '导出备份');
    const backupPath = path.join('artifacts', 'stage-4-widget-backup.json');
    await (await downloadPromise).saveAs(backupPath);

    // The exported file must contain the record, not just the workspace.
    const backup = JSON.parse(await fs.readFile(backupPath, 'utf8')) as {
      widgetData?: { namespace: string; key: string; payload: string }[];
    };
    expect(backup.widgetData).toBeDefined();
    expect(backup.widgetData?.some((record) => record.namespace === 'builtin.todo' && record.key === 'state')).toBe(true);
    expect(JSON.parse(backup.widgetData!.find((record) => record.namespace === 'builtin.todo')!.payload).items).toHaveLength(1);

    // Clear everything, which must empty all three stores.
    await click(page.getByTestId('clear-all-data'));
    const confirmAll = page.getByRole('dialog', { name: '清除全部本地数据？' });
    await click(confirmAll.getByRole('button', { name: '清除全部数据', exact: true }));
    await page.waitForLoadState('load');
    await expect(page.getByTestId('glass-home-app')).toBeVisible();
    await waitForSaved(page);
    await waitForClearedState(page);
    await expect(page.locator('.todo-widget__item')).toHaveCount(0);

    // Import restores the list, proving widget data round-trips through a file.
    await openDataTab(page);
    await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles(backupPath);
    await waitForSaved(page);
    await expect(page.locator('.todo-widget__item')).toHaveCount(1);
    await expect(page.locator('.todo-widget__item')).toContainText('备份前写下的事项');
    const restored = await readWidgetPayload(page, 'builtin.todo') as string | null;
    expect(restored).not.toBeNull();
    await captureViewport(page, 'stage-4-backup-widget-data-edge.png');
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('clearing one widget drops only that widget data and keeps the widget in place', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await addTodo(page, '这条会被清掉');
    await expect(page.locator('.todo-widget__item')).toHaveCount(1);

    const shortcutsBefore = await page.locator('.grid-item--shortcut').count();
    const workspaceBefore = await readStoredWorkspace(page) as { revision: number };

    await openDataTab(page);
    // The per-widget row must show a real size, otherwise the clear entry stays
    // disabled and the feature is unreachable.
    await expect(todoRow(page).locator('[data-widget-bytes]')).not.toHaveText('0 B');
    await click(todoRow(page).getByRole('button', { name: '清除', exact: true }));

    const confirmOne = page.getByRole('dialog', { name: '清除「待办」的组件数据？' });
    await expect(confirmOne).toBeVisible();
    await click(confirmOne.getByRole('button', { name: '清除组件数据', exact: true }));

    // The widget stays, its contents go.
    await expect(todo(page)).toBeVisible();
    await expect(page.locator('.todo-widget__item')).toHaveCount(0);
    await expect(page.getByTestId('settings-notice')).toContainText('待办');
    await expect(page.locator('.grid-item--shortcut')).toHaveCount(shortcutsBefore);

    // Only the widget store changed: the layout revision is untouched because
    // clearing widget data is not a layout operation.
    const workspaceAfter = await readStoredWorkspace(page) as { revision: number };
    expect(workspaceAfter.revision).toBe(workspaceBefore.revision);
    expect(await readWidgetPayload(page, 'builtin.todo')).toBeNull();

    // Survives a reload: the clear was persisted, not just rendered.
    await page.reload();
    await waitForSaved(page);
    await expect(page.locator('.todo-widget__item')).toHaveCount(0);
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('an older backup without a widget-data field keeps the current to-do list', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await addTodo(page, '不应该被旧备份删掉');
    await expect(page.locator('.todo-widget__item')).toHaveCount(1);

    await openDataTab(page);
    const downloadPromise = page.waitForEvent('download');
    await clickButton(page, '导出备份');
    const fullPath = path.join('artifacts', 'stage-4-full-backup.json');
    await (await downloadPromise).saveAs(fullPath);

    // Rewrite the file into the shape a pre-stage-4 export had: no field.
    const legacy = JSON.parse(await fs.readFile(fullPath, 'utf8')) as Record<string, unknown>;
    delete legacy.widgetData;
    const legacyPath = path.join('artifacts', 'stage-4-legacy-backup.json');
    await fs.writeFile(legacyPath, JSON.stringify(legacy, null, 2));

    await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles(legacyPath);
    await waitForSaved(page);

    // The list is still there: "absent field" must not read as "empty list".
    await expect(page.locator('.todo-widget__item')).toHaveCount(1);
    await expect(page.locator('.todo-widget__item')).toContainText('不应该被旧备份删掉');
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('clear all data also removes custom images, and the screen comes back empty', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`));
    page.on('console', (message) => { if (message.type() === 'error') console.log(`[console.error] ${message.text()}`); });
    await clickButton(page, '打开设置');
    // Store one custom wallpaper so the assets store is genuinely non-empty.
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Test canvas is unavailable');
      context.fillStyle = '#7a6f8c';
      context.fillRect(0, 0, 8, 8);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    if (!png) throw new Error('Test image was not generated');
    await page.locator('input[type=file][accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'wallpaper.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await clickButton(page, '保存设置');
    // `waitForSaved` alone can resolve against the *previous* saved state while
    // the commit is still in flight, leaving the modal open. A native modal
    // dialog makes the rest of the page inert, so a later `fill` would land on
    // the dialog instead of the to-do input. Waiting for the dialog to close is
    // the real synchronisation point.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await waitForSaved(page);

    await addTodo(page, '清除前存在');
    // The write is fire-and-forget inside the widget, so the row is only a
    // reliable "it persisted" signal once the item is visible and the payload
    // has landed. Reading counts immediately races the IndexedDB write.
    await expect(page.locator('.todo-widget__item')).toHaveCount(1);
    await expect.poll(async () => (await readWidgetPayload(page, 'builtin.todo')) !== null, { timeout: 5000 }).toBe(true);
    const before = await readStoreCounts(page);
    expect(before.assets).toBe(1);
    expect(before.widgetData).toBeGreaterThan(0);

    await openDataTab(page);
    await click(page.getByTestId('clear-all-data'));
    const confirmAll = page.getByRole('dialog', { name: '清除全部本地数据？' });
    await click(confirmAll.getByRole('button', { name: '清除全部数据', exact: true }));
    await page.waitForLoadState('load');
    await expect(page.getByTestId('glass-home-app')).toBeVisible();
    await waitForSaved(page);
    await waitForClearedState(page);

    await expect(page.locator('.wallpaper__custom')).toHaveCSS('background-image', 'none');
    await expect(page.locator('.todo-widget__item')).toHaveCount(0);
    // The 20 curated shortcuts are a first-install experience. After an explicit
    // clear, the screen must come back empty instead of rebuilding the demo set.
    await expect(page.locator('.grid-item--shortcut')).toHaveCount(0);
    await expect(page.locator('.empty-state')).toBeVisible();
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});
