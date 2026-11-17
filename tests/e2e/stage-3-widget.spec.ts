import { test, expect, type Page } from '@playwright/test';
import { cleanupProfile, captureViewport, launchExtension, openNewTab, readStoredWorkspace } from './helpers';

/**
 * Stage 3 acceptance in real Edge: the built-in to-do widget, its per-instance
 * storage, and the v1 -> v2 workspace migration.
 *
 * The migration case is the important one: every pre-existing user has a v1
 * payload without the to-do widget, and the v2 validator requires it. If the
 * upgrade does not run on load, those users land on the recovery screen.
 */

interface StoredWorkspace {
  schemaVersion: number;
  revision: number;
  widgets: { instanceId: string; widgetId: string; storageNamespace: string }[];
  layouts: Record<'10' | '8' | '5', { instanceId: string; x: number; y: number; w: number; h: number }[]>;
}

const todo = (page: Page) => page.locator('[data-widget-instance="builtin.todo"]');

async function readWidgetData(page: Page, namespace: string): Promise<unknown> {
  return page.evaluate(async (ns) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('glass-home');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('widget-data', 'readonly');
    const store = transaction.objectStore('widget-data');
    const value = await new Promise((resolve, reject) => {
      const request = store.get(`${ns}:state`);
      request.onsuccess = () => resolve(request.result?.payload ?? null);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return value;
  }, namespace);
}

test('adds to-dos, persists them across reload and keeps them out of the Workspace', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await expect(todo(page)).toBeVisible();
    await expect(todo(page)).toHaveAttribute('data-todo-loaded', 'true');
    await expect(page.getByTestId('todo-empty')).toBeVisible();

    const workspaceBefore = await readStoredWorkspace(page) as StoredWorkspace;
    const input = page.locator('.todo-widget__input');
    await input.fill('买牛奶');
    await input.press('Enter');
    await expect(page.locator('.todo-widget__item')).toHaveCount(1);
    await expect(todo(page)).toHaveAttribute('data-todo-count', '1');

    await input.fill('写周报');
    await input.press('Enter');
    await expect(page.locator('.todo-widget__item')).toHaveCount(2);

    // A checkbox must not create a layout transaction: the Workspace revision
    // is the layout's, and ticking a to-do is not a layout change.
    const workspaceAfter = await readStoredWorkspace(page) as StoredWorkspace;
    expect(workspaceAfter.revision).toBe(workspaceBefore.revision);
    await expect(page.getByRole('button', { name: '撤销布局', exact: true })).toBeDisabled();

    // Completing one item reorders the list and updates the counts.
    await page.locator('.todo-widget__checkbox').first().check();
    await expect(todo(page)).toHaveAttribute('data-todo-remaining', '1');

    // Persisted per instance, not in the workspace payload.
    const stored = await readWidgetData(page, 'builtin.todo') as string | null;
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? '{}').items).toHaveLength(2);

    await page.reload();
    await expect(todo(page)).toHaveAttribute('data-todo-loaded', 'true');
    await expect(page.locator('.todo-widget__item')).toHaveCount(2);
    await captureViewport(page, 'stage-3-todo-edge.png');
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('rejects blank and over-long input with a visible reason', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    const input = page.locator('.todo-widget__input');
    const addButton = page.locator('.todo-widget__add');

    // Blank input keeps the add button disabled rather than silently doing nothing.
    await expect(addButton).toBeDisabled();
    await input.fill('    ');
    await expect(addButton).toBeDisabled();
    await input.press('Enter');
    await expect(page.locator('.todo-widget__item')).toHaveCount(0);

    // maxLength stops over-long input at the source; the domain limit is 120.
    await input.fill('x'.repeat(200));
    const value = await input.inputValue();
    expect(value.length).toBeLessThanOrEqual(120);
    await input.press('Enter');
    await expect(page.locator('.todo-widget__item')).toHaveCount(1);
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('deletes and clears completed items, and the clear button disables when empty', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    const input = page.locator('.todo-widget__input');
    for (const text of ['a', 'b', 'c']) {
      await input.fill(text);
      await input.press('Enter');
    }
    await expect(page.locator('.todo-widget__item')).toHaveCount(3);

    // Nothing completed yet, so clearing is a no-op button.
    await expect(page.locator('.todo-widget__clear')).toBeDisabled();

    await page.locator('.todo-widget__checkbox').first().check();
    await expect(page.locator('.todo-widget__clear')).toBeEnabled();
    await page.locator('.todo-widget__clear').click();
    await expect(page.locator('.todo-widget__item')).toHaveCount(2);

    // Remove the remaining first item through its delete affordance.
    //
    // Locate by `data-todo-id`, not by position: completing an item reorders the
    // list (unfinished first), so `.first()` may point at a different element by
    // the time the click lands.
    await page.locator('.todo-widget__item').first().hover();
    const firstId = await page.locator('.todo-widget__item').first().getAttribute('data-todo-id');
    expect(firstId).toBeTruthy();
    await page.locator(`[data-todo-id="${firstId}"] .todo-widget__remove`).click();
    await expect(page.locator(`[data-todo-id="${firstId}"]`)).toHaveCount(0);
    await expect(page.locator('.todo-widget__item')).toHaveCount(1);

    await page.reload();
    await expect(page.locator('.todo-widget__item')).toHaveCount(1);
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('upgrades a v1 workspace on load instead of demanding recovery', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);

    // Rewrite the stored workspace into an authentic v1 payload: schemaVersion 1
    // with no to-do widget anywhere.
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('glass-home');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const read = database.transaction('workspaces', 'readonly').objectStore('workspaces');
      const current = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const request = read.get('glass-home-workspace');
        request.onsuccess = () => resolve(request.result as Record<string, unknown>);
        request.onerror = () => reject(request.error);
      });
      const layouts = current.layouts as Record<string, { instanceId: string }[]>;
      const stripped = Object.fromEntries(Object.entries(layouts).map(([columns, items]) => [
        columns, items.filter((item) => item.instanceId !== 'builtin.todo'),
      ]));
      const widgets = (current.widgets as { widgetId: string }[]).filter((widget) => widget.widgetId !== 'builtin.todo');
      const v1 = {
        ...current,
        schemaVersion: 1,
        layouts: stripped,
        widgets,
        installedWidgets: (current.installedWidgets as { widgetId: string }[])
          .filter((widget) => widget.widgetId !== 'builtin.todo'),
      };
      const write = database.transaction('workspaces', 'readwrite').objectStore('workspaces');
      await new Promise<void>((resolve, reject) => {
        const request = write.put(v1);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      database.close();
    });

    await page.reload();

    // The app must come up normally, not on the recovery card.
    await expect(page.getByTestId('glass-home-app')).toBeVisible();
    await expect(page.getByRole('heading', { name: '主屏幕需要恢复' })).toHaveCount(0);
    // The migration writes the upgrade back, so the stored workspace is now v2.
    const migrated = await readStoredWorkspace(page) as StoredWorkspace;
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.widgets.some((widget) => widget.widgetId === 'builtin.todo')).toBe(true);
    for (const columns of ['10', '8', '5'] as const) {
      expect(migrated.layouts[columns].some((item) => item.instanceId === 'builtin.todo')).toBe(true);
    }
    // Shortcuts and their cells survived the upgrade untouched.
    await expect(page.locator('[data-instance-id="github"]')).toBeVisible();
    await captureViewport(page, 'stage-3-migrated-edge.png');
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('the to-do widget survives a full browser restart', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  let page = await openNewTab(context, extensionId);
  let reopened: Awaited<ReturnType<typeof launchExtension>> | undefined;
  try {
    const input = page.locator('.todo-widget__input');
    await input.fill('重启后仍在');
    await input.press('Enter');
    await expect(page.locator('.todo-widget__item')).toHaveCount(1);

    // Close the whole browser, then reopen against the same profile.
    await context.close();
    reopened = await launchExtension(userDataDir);
    page = await openNewTab(reopened.context, reopened.extensionId);
    await expect(todo(page)).toHaveAttribute('data-todo-loaded', 'true');
    await expect(page.locator('.todo-widget__item')).toHaveCount(1);
    await expect(page.locator('.todo-widget__item')).toContainText('重启后仍在');
  } finally {
    await reopened?.context.close();
    await cleanupProfile(userDataDir);
  }
});
