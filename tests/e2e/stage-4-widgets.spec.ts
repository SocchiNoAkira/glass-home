import { test, expect, type Page } from '@playwright/test';
import { cleanupProfile, clickButton, click, launchExtension, openNewTab, waitForSaved } from './helpers';

/**
 * Widgets became removable/restorable (iOS-style): the gallery puts a type back
 * on the screen, the X badge takes it off, and the schema no longer demands that
 * every built-in exist. These three facts have to hold together — a screen
 * without the to-do widget must still validate and save, otherwise the removal
 * would only work until the next reload.
 *
 * Removal also clears the widget's stored data; the last step proves that by
 * re-adding the same type and seeing an empty list rather than the old item.
 */

const todoPayload = (page: Page) => page.evaluate(async () => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('glass-home');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const value = await new Promise<unknown>((resolve, reject) => {
    const store = database.transaction('widget-data', 'readonly').objectStore('widget-data');
    const request = store.get('builtin.todo:state');
    request.onsuccess = () => resolve(request.result?.payload ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return value;
});

test('removes a widget and adds it back from the gallery', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await expect(page.locator('[data-instance-id="builtin.todo"]')).toBeVisible();

    // Give the widget content first: "removed" and "removed and wiped" are
    // different claims, and only the second one is what the UI promises.
    await page.locator('.todo-widget__input').fill('移除前写下的事项');
    await page.keyboard.press('Enter');
    await expect(page.locator('.todo-widget__item')).toHaveCount(1);
    await expect.poll(() => todoPayload(page), { timeout: 5000 }).not.toBeNull();

    // Remove through the edit badge, like a shortcut.
    await clickButton(page, '编辑主屏幕');
    await click(page.getByRole('button', { name: '移除 待办 小组件' }));
    await expect(page.getByRole('dialog', { name: '移除「待办」？' })).toBeVisible();
    await click(page.getByRole('dialog', { name: '移除「待办」？' }).getByRole('button', { name: '移除小组件', exact: true }));
    await waitForSaved(page);

    await expect(page.locator('[data-instance-id="builtin.todo"]')).toHaveCount(0);
    // The stored list is gone too, which is what the confirm dialog states.
    await expect.poll(() => todoPayload(page), { timeout: 5000 }).toBeNull();
    // The removal is a workspace change, not a preview: it must survive a reload.
    await page.reload();
    await waitForSaved(page);
    await expect(page.locator('[data-instance-id="builtin.todo"]')).toHaveCount(0);

    // Add it back from the gallery.
    await clickButton(page, '编辑主屏幕');
    await click(page.getByRole('button', { name: '添加小组件' }));
    const gallery = page.getByRole('dialog', { name: '小组件' });
    await expect(gallery).toBeVisible();
    // A type that is already placed is not addable a second time.
    await expect(gallery.locator('.widget-card', { hasText: '时钟' })).toContainText('已在主屏幕');
    await expect(gallery.locator('.widget-card', { hasText: '待办' })).not.toContainText('已在主屏幕');
    await click(gallery.getByRole('button', { name: '添加待办小组件' }));
    await waitForSaved(page);

    await expect(page.locator('[data-instance-id="builtin.todo"]')).toBeVisible();
    // Data was cleared with the removal, so the re-added widget starts empty.
    await expect(page.locator('.todo-widget__item')).toHaveCount(0);
    await page.reload();
    await waitForSaved(page);
    await expect(page.locator('[data-instance-id="builtin.todo"]')).toBeVisible();
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});
