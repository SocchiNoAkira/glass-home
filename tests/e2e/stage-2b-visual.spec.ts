import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { captureViewport, clickButton, launchExtension, openNewTab, waitForSaved } from './helpers';

/**
 * Stage 2B-1 visual evidence. The drag target only exists while the pointer is
 * held down, so this test captures the live mid-drag state rather than a
 * settled page.
 */

async function itemCenter(page: Page, instanceId: string) {
  const box = await page.locator(`[data-instance-id="${instanceId}"]`).boundingBox();
  if (!box) throw new Error(`${instanceId} has no layout bounds`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  release = true,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8);
  }
  if (release) await page.mouse.up();
}

test('captures the live drag feedback in normal and edit mode', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    const stride = await page.evaluate(() => {
      const first = document.querySelector<HTMLElement>('[data-grid-y="3"][data-instance-id]');
      const second = document.querySelector<HTMLElement>('[data-grid-y="4"][data-instance-id]');
      if (!first || !second) throw new Error('expected shortcut rows 3 and 4');
      return second.getBoundingClientRect().top - first.getBoundingClientRect().top;
    });

    // Swap preview in normal mode: icon body over another icon.
    const github = await itemCenter(page, 'github');
    const figma = await itemCenter(page, 'figma');
    await drag(page, github, figma, false);
    await expect(page.locator('.drag-target')).toBeVisible();
    await captureViewport(page, 'stage-2b-drag-swap-edge.png');
    await page.mouse.up();
    await waitForSaved(page);

    // Insert preview: pointer in the vertical gutter between rows.
    const firstRow = await itemCenter(page, 'figma');
    await drag(page, firstRow, { x: firstRow.x - 120, y: firstRow.y + stride * 2 + stride / 2 }, false);
    await expect(page.locator('.drag-target')).toBeVisible();
    await captureViewport(page, 'stage-2b-drag-insert-edge.png');
    await page.keyboard.press('Escape');
    await expect(page.locator('.drag-target')).toHaveCount(0);

    // Edit mode keeps the dense grid visible while dragging.
    await clickButton(page, '编辑主屏幕');
    const clock = await itemCenter(page, 'builtin.clock');
    await drag(page, clock, { x: clock.x + 40, y: clock.y + stride }, false);
    await expect(page.locator('.drag-target')).toBeVisible();
    await captureViewport(page, 'stage-2b-drag-edit-mode-edge.png');
    await page.keyboard.press('Escape');
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
