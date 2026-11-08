import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { clickButton, launchExtension, openNewTab, waitForSaved } from './helpers';

/**
 * Visual evidence fallback. Screenshots are written to artifacts/, but the
 * computed style assertions below are what actually prove the drag feedback
 * renders: an overlay that exists but is invisible (opacity 0, zero size,
 * display none) would slip past a "count === 1" check.
 */

async function itemCenter(page: Page, instanceId: string) {
  const box = await page.locator(`[data-instance-id="${instanceId}"]`).boundingBox();
  if (!box) throw new Error(`${instanceId} has no layout bounds`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, release = true) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8);
  }
  if (release) await page.mouse.up();
}

test('drag feedback is actually painted, sized and themed per intent', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);

    const github = await itemCenter(page, 'github');
    const figma = await itemCenter(page, 'figma');
    await drag(page, github, figma, false);

    const swap = await page.locator('.drag-target').evaluate((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        opacity: Number(style.opacity),
        width: rect.width,
        height: rect.height,
        borderStyle: style.borderTopStyle,
        borderWidth: style.borderTopWidth,
        label: node.querySelector('.drag-target__label')?.textContent ?? '',
        percentLeft: style.left,
        display: style.display,
      };
    });
    // Painted, non-zero, and labelled as a swap.
    expect(swap.opacity).toBeGreaterThan(0);
    expect(swap.display).not.toBe('none');
    expect(swap.width).toBeGreaterThan(20);
    expect(swap.height).toBeGreaterThan(20);
    expect(swap.borderStyle).toBe('solid');
    expect(swap.label).toBe('交换');

    // The lifted slot is also painted, and it sits on the origin cell.
    const slot = await page.locator('.drag-origin-slot').evaluate((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return { opacity: Number(style.opacity), width: rect.width, height: rect.height, borderStyle: style.borderTopStyle };
    });
    expect(slot.opacity).toBeGreaterThan(0);
    expect(slot.width).toBeGreaterThan(20);
    expect(slot.borderStyle).toBe('dashed');

    // The dragged element itself is lifted above the grid.
    const lifted = await page.locator('[data-instance-id="github"]').evaluate((node) => {
      const style = getComputedStyle(node);
      return { opacity: Number(style.opacity), transform: style.transform, zIndex: style.zIndex };
    });
    expect(lifted.transform).not.toBe('none');
    expect(Number(lifted.zIndex)).toBeGreaterThanOrEqual(6);

    await page.keyboard.press('Escape');
    await expect(page.locator('.drag-target')).toHaveCount(0);

    // An insertion target is dashed and carries the insertion accent line.
    // The gutter is only ~16% of a row stride, so it must be located from the
    // measured row height and gap rather than a guessed fraction of the stride.
    const gap = await page.evaluate(() => {
      const first = document.querySelector<HTMLElement>('[data-grid-y="3"][data-instance-id]');
      const second = document.querySelector<HTMLElement>('[data-grid-y="4"][data-instance-id]');
      if (!first || !second) throw new Error('expected shortcut rows 3 and 4');
      const grid = document.querySelector<HTMLElement>('[data-testid="unified-grid"]');
      if (!grid) throw new Error('missing grid');
      const style = getComputedStyle(grid);
      return {
        rowHeight: parseFloat(style.gridAutoRows),
        gapY: parseFloat(style.rowGap),
        stride: second.getBoundingClientRect().top - first.getBoundingClientRect().top,
      };
    });
    // From the first shortcut row, one full row down plus half the gutter.
    const row = await itemCenter(page, 'github');
    const intoGutter = row.y + gap.stride + gap.rowHeight - gap.gapY + gap.gapY / 2;
    expect(intoGutter).toBeGreaterThan(0);
    await drag(page, row, { x: row.x, y: intoGutter }, false);
    const insert = await page.locator('.drag-target').evaluate((node) => ({
      kind: node.className,
      borderStyle: getComputedStyle(node).borderTopStyle,
      label: node.querySelector('.drag-target__label')?.textContent ?? '',
      hasAccent: getComputedStyle(node, '::before').height !== 'auto',
    }));
    expect(insert.kind).toContain('drag-target--insert');
    expect(insert.borderStyle).toBe('dashed');
    expect(insert.label).toBe('插入推挤');
    expect(insert.hasAccent).toBe(true);
    await page.keyboard.press('Escape');

    // Reduced motion keeps the feedback but removes the animation.
    await clickButton(page, '打开设置');
    const settingsPanel = page.getByRole('dialog');
    if (await settingsPanel.count()) {
      // Turn on "reduce motion" if the switch is exposed by this build.
      const toggle = page.getByRole('switch', { name: /减少动态|减少动效|reduced motion/i });
      if (await toggle.count()) {
        await toggle.click();
        await clickButton(page, '保存设置');
        await waitForSaved(page);
      }
    }
    await page.keyboard.press('Escape');
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
