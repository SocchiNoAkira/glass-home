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
        percentLeft: style.left,
        display: style.display,
      };
    });
    // The label is a sibling of the outline now, so it must be read separately.
    const swapLabel = await page.locator('.drag-target__label').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      // What element is actually painted at the label's own centre? If the
      // carried icon covers it, hit-testing returns the icon, not the label.
      const atCentre = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        text: node.textContent ?? '',
        zIndex: Number(style.zIndex),
        opacity: Number(style.opacity),
        width: rect.width,
        topmostClass: atCentre?.className?.toString?.() ?? '',
        coveredByIcon: atCentre?.closest?.('[data-instance-id]') != null,
      };
    });
    // Painted, non-zero, and labelled as a swap.
    expect(swap.opacity).toBeGreaterThan(0);
    expect(swap.display).not.toBe('none');
    expect(swap.width).toBeGreaterThan(20);
    expect(swap.height).toBeGreaterThan(20);
    expect(swap.borderStyle).toBe('solid');
    expect(swapLabel.text).toBe('交换');
    expect(swapLabel.opacity).toBeGreaterThan(0);
    expect(swapLabel.width).toBeGreaterThan(10);
    // This assertion is the regression guard for the label being buried under
    // the carried icon: it must be the topmost painted element at its centre.
    expect(swapLabel.coveredByIcon).toBe(false);

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
    //
    // The gutter is a narrow strip between two cell bodies, so it must be found
    // from the rendered cell edges. Deriving it from the *bottom edge* of the
    // row-3 cell plus half the gap is exact; adding whole strides to a cell
    // centre (as an earlier version did) lands inside the next row's body and
    // silently tests a swap instead of an insertion.
    const gap = await page.evaluate(() => {
      const first = document.querySelector<HTMLElement>('[data-grid-y="3"][data-instance-id]');
      const second = document.querySelector<HTMLElement>('[data-grid-y="4"][data-instance-id]');
      if (!first || !second) throw new Error('expected shortcut rows 3 and 4');
      const grid = document.querySelector<HTMLElement>('[data-testid="unified-grid"]');
      if (!grid) throw new Error('missing grid');
      const style = getComputedStyle(grid);
      const firstBottom = first.getBoundingClientRect().bottom;
      const secondTop = second.getBoundingClientRect().top;
      return {
        rowHeight: parseFloat(style.gridAutoRows),
        gapY: parseFloat(style.rowGap),
        // The real gutter, measured instead of assumed.
        gutterTop: firstBottom,
        gutterBottom: secondTop,
      };
    });
    const row = await itemCenter(page, 'github');
    const intoGutter = (gap.gutterTop + gap.gutterBottom) / 2;
    // Guard against a layout change that would silently make this land in a
    // cell body: the probe point must sit strictly inside the gap.
    expect(gap.gutterBottom).toBeGreaterThan(gap.gutterTop);
    expect(intoGutter).toBeGreaterThan(gap.gutterTop);
    expect(intoGutter).toBeLessThan(gap.gutterBottom);

    // Sweeping past the gutter must NOT push. This is the regression guard for
    // "one pixel into the gap shoved the neighbours": at this point the pointer
    // has only passed through, so the intent must still be a plain move.
    await drag(page, row, { x: row.x, y: intoGutter }, false);
    const afterSweep = await page.locator('.drag-target__label').textContent().catch(() => null);
    expect(afterSweep).not.toBe('插入推挤');

    // Holding still on the same gutter completes the dwell and only then
    // becomes an insertion.
    await page.mouse.move(row.x, intoGutter);
    await expect(page.locator('.drag-target__label')).toHaveText('插入推挤', { timeout: 5000 });
    const insert = await page.locator('.drag-target').evaluate((node) => ({
      kind: node.className,
      borderStyle: getComputedStyle(node).borderTopStyle,
      hasAccent: getComputedStyle(node, '::before').height !== 'auto',
    }));
    const insertLabel = await page.locator('.drag-target__label').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const atCentre = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { text: node.textContent ?? '', coveredByIcon: atCentre?.closest?.('[data-instance-id]') != null };
    });
    expect(insert.kind).toContain('drag-target--insert');
    expect(insert.borderStyle).toBe('dashed');
    expect(insertLabel.text).toBe('插入推挤');
    expect(insertLabel.coveredByIcon).toBe(false);
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
