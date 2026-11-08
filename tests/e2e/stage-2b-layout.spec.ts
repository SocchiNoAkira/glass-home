import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickButton, launchExtension, openNewTab, readStoredWorkspace, waitForSaved } from './helpers';

/**
 * Stage 2B-1 acceptance in a real Edge window.
 *
 * Product baseline 7.1 makes a drag start in normal mode too, so the first
 * case never enters edit mode: it proves the 6px threshold separates a layout
 * drag from a navigation click and that nothing is persisted until release.
 */

/** Centre point of a grid item, in viewport coordinates. */
async function itemCenter(page: Page, instanceId: string) {
  const box = await page.locator(`[data-instance-id="${instanceId}"]`).boundingBox();
  if (!box) throw new Error(`${instanceId} has no layout bounds`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Vertical distance between two adjacent grid rows, read from the rendered
 * grid. The gap is CSS-driven, so measuring beats hard-coding a pixel value.
 */
async function rowStride(page: Page): Promise<number> {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll<HTMLElement>('[data-testid="unified-grid"] [data-instance-id]')];
    const first = items.find((item) => item.dataset.gridY === '3');
    const second = items.find((item) => item.dataset.gridY === '4');
    if (!first || !second) throw new Error('expected the default shortcut rows 3 and 4');
    return second.getBoundingClientRect().top - first.getBoundingClientRect().top;
  });
}

/** Press, cross the 6px threshold in steps, and optionally release. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, release = true) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps);
  }
  if (release) await page.mouse.up();
}

test('drags an icon in normal mode, previews without persisting and cancels with Esc', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    const before = await readStoredWorkspace(page);
    const stride = await rowStride(page);

    const github = await itemCenter(page, 'github');
    // Two rows down is an empty row in the default 10-column layout.
    const target = { x: github.x, y: github.y + stride * 2 };

    await drag(page, github, target, false);

    // The drag surface, the lifted slot and the resolved target are all live.
    await expect(page.locator('[data-testid="unified-grid"]')).toHaveAttribute('data-drag-instance', 'github');
    await expect(page.locator('.drag-origin-slot')).toHaveCount(1);
    await expect(page.locator('.drag-target')).toBeVisible();
    // A drag must never navigate, even though normal mode clicks do.
    await expect(page).toHaveURL(`chrome-extension://${extensionId}/newtab.html`);
    // Release is the only write, and this release has not happened yet.
    expect(await readStoredWorkspace(page)).toEqual(before);

    await page.keyboard.press('Escape');

    await expect(page.locator('[data-testid="unified-grid"]')).not.toHaveAttribute('data-drag-instance', 'github');
    await expect(page.locator('.drag-target')).toHaveCount(0);
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-y', '3');
    expect(await readStoredWorkspace(page)).toEqual(before);
    // Esc removed the preview, so the preview banner must not linger.
    await expect(page.locator('.layout-preview-banner')).toHaveCount(0);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('commits a drag on release and keeps it undoable', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    const before = await readStoredWorkspace(page) as { revision: number; layouts: Record<'10' | '8' | '5', unknown[]> };
    const stride = await rowStride(page);

    const github = await itemCenter(page, 'github');
    const figma = await itemCenter(page, 'figma');
    // Same row, one cell right: the icon body of figma means "swap".
    await drag(page, github, figma);

    await waitForSaved(page);
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-x', '1');
    await expect(page.locator('[data-instance-id="figma"]')).toHaveAttribute('data-grid-x', '0');

    const committed = await readStoredWorkspace(page) as { revision: number; layouts: Record<'10' | '8' | '5', unknown[]> };
    expect(committed.revision).toBe(before.revision + 1);
    expect(committed.layouts[10]).not.toEqual(before.layouts[10]);
    // A local drag must not rewrite the other breakpoints.
    expect(committed.layouts[8]).toEqual(before.layouts[8]);
    expect(committed.layouts[5]).toEqual(before.layouts[5]);

    await clickButton(page, '撤销布局');
    // The save status is already 'saved' from the commit, so polling the
    // persisted layout is what actually proves the undo landed.
    await expect.poll(async () => {
      const stored = await readStoredWorkspace(page) as { layouts: Record<'10' | '8' | '5', unknown[]> };
      return JSON.stringify(stored.layouts);
    }, { timeout: 10_000 }).toBe(JSON.stringify(before.layouts));
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-x', '0');

    // Confirms the pointer transaction survived a full reload.
    await page.reload();
    await waitForSaved(page);
    await expect(page.getByRole('button', { name: '撤销布局', exact: true })).toBeDisabled();
    expect(stride).toBeGreaterThan(0);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('a second drag right after the first cannot be overwritten by a stale preview', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    const github = await itemCenter(page, 'github');
    const figma = await itemCenter(page, 'figma');

    await drag(page, github, figma);
    await waitForSaved(page);
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-x', '1');

    // Immediately start the next drag from the committed position.
    const figmaNow = await itemCenter(page, 'figma');
    const githubNow = await itemCenter(page, 'github');
    await drag(page, figmaNow, githubNow);
    await waitForSaved(page);

    // The second swap must round-trip back to the original arrangement.
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-x', '0');
    await expect(page.locator('[data-instance-id="figma"]')).toHaveAttribute('data-grid-x', '1');
    await expect(page.locator('.drag-target')).toHaveCount(0);
    await expect(page.locator('[data-testid="unified-grid"]')).not.toHaveAttribute('data-drag-instance', 'github');
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('arrow keys move the focused object and Alt+Arrow resizes a widget, keeping focus', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await clickButton(page, '编辑主屏幕');

    const github = page.locator('[data-instance-id="github"]');
    await github.focus();
    await page.keyboard.press('ArrowRight');
    await waitForSaved(page);

    await expect(github).toHaveAttribute('data-grid-x', '1');
    // Product baseline 7.4: focus stays on the object that was operated on.
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-instance-id'))).toBe('github');

    // Undo must restore the keyboard move like any other layout transaction.
    await clickButton(page, '撤销布局');
    await waitForSaved(page);
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-x', '0');

    // A 1x1 shortcut cannot be resized, so Alt+Arrow must be a no-op, not an error.
    await page.locator('[data-instance-id="github"]').focus();
    await page.keyboard.press('Alt+ArrowRight');
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-w', '1');
    await expect(page.locator('.toast--error')).toHaveCount(0);

    // The calendar widget grows one row and stays focused.
    const calendar = page.locator('[data-instance-id="builtin.calendar"]');
    await calendar.focus();
    await page.keyboard.press('Alt+ArrowDown');
    await waitForSaved(page);
    await expect(calendar).toHaveAttribute('data-grid-h', '3');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-instance-id'))).toBe('builtin.calendar');

    await clickButton(page, '撤销布局');
    await waitForSaved(page);
    await expect(page.locator('[data-instance-id="builtin.calendar"]')).toHaveAttribute('data-grid-h', '2');
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('a locked object refuses to drag and refuses keyboard moves', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await clickButton(page, '编辑主屏幕');

    // Lock the calendar through the existing inspector, which is the 2A path.
    await page.locator('#layout-object').selectOption('builtin.calendar');
    await clickButton(page, '锁定对象');
    await clickButton(page, '确认并保存');
    await waitForSaved(page);
    await expect(page.locator('[data-instance-id="builtin.calendar"]')).toHaveAttribute('data-locked', 'true');

    const before = await readStoredWorkspace(page);

    // Dragging a locked widget must start nothing at all.
    const calendar = await itemCenter(page, 'builtin.calendar');
    await drag(page, calendar, { x: calendar.x - 160, y: calendar.y });
    await expect(page.locator('[data-testid="unified-grid"]')).not.toHaveAttribute('data-drag-instance', 'builtin.calendar');
    expect(await readStoredWorkspace(page)).toEqual(before);

    // Arrow keys must not move it either, and must not push anything aside.
    await page.locator('[data-instance-id="builtin.calendar"]').focus();
    await page.keyboard.press('ArrowDown');
    await waitForSaved(page);
    await expect(page.locator('[data-instance-id="builtin.calendar"]')).toHaveAttribute('data-grid-y', '0');
    expect(await readStoredWorkspace(page)).toEqual(before);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
