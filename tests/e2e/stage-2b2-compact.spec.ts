import { test, expect, type Page } from '@playwright/test';
import { cleanupProfile, clickButton, launchExtension, openNewTab, readStoredWorkspace } from './helpers';

/**
 * Compact tidy, now a single click: it solves, applies and commits in one
 * transaction, and stays undoable as that one transaction.
 *
 * The old flow required a preview plus confirmation. That panel is gone from the
 * product, so these cases drive the same behaviour through the bottom-bar tidy
 * button and check the persisted result directly.
 */

interface Stored {
  revision: number;
  layouts: Record<'10' | '8' | '5', { instanceId: string; x: number; y: number; w: number; h: number; locked: boolean }[]>;
}

async function itemCenter(page: Page, instanceId: string) {
  const box = await page.locator(`[data-instance-id="${instanceId}"]`).boundingBox();
  if (!box) throw new Error(`${instanceId} has no layout bounds`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Viewport point at the centre of one grid cell, derived from the rendered grid. */
async function cellCenter(page: Page, cellX: number, cellY: number) {
  return page.evaluate(({ cellX, cellY }) => {
    const grid = document.querySelector('[data-testid="unified-grid"]') as HTMLElement;
    const style = getComputedStyle(grid);
    const columns = Number(grid.getAttribute('data-columns'));
    const padLeft = Number.parseFloat(style.paddingLeft);
    const padTop = Number.parseFloat(style.paddingTop);
    const padRight = Number.parseFloat(style.paddingRight);
    const gapX = Number.parseFloat(style.columnGap);
    const gapY = Number.parseFloat(style.rowGap);
    const cellWidth = (grid.clientWidth - padLeft - padRight - gapX * (columns - 1)) / columns;
    const rect = grid.getBoundingClientRect();
    return {
      x: rect.left + padLeft + cellX * (cellWidth + gapX) + cellWidth / 2,
      y: rect.top + padTop + cellY * (Number.parseFloat(style.gridAutoRows) + gapY) + Number.parseFloat(style.gridAutoRows) / 2,
    };
  }, { cellX, cellY });
}

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
  }
  await page.mouse.up();
}

/** Park github on an empty row so the page really has vertical space to tidy. */
async function scatterGithub(page: Page) {
  await dragTo(page, await itemCenter(page, 'github'), await cellCenter(page, 5, 6));
  await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-y', '6');
}

/** Waits for the workspace to be rewritten, not just for the status dot. */
async function revisionOf(page: Page): Promise<number> {
  return (await readStoredWorkspace(page) as Stored).revision;
}

test('one tidy click persists as a single transaction and undoes as one', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await scatterGithub(page);
    const before = await readStoredWorkspace(page) as Stored;

    await clickButton(page, '编辑主屏幕');
    await clickButton(page, '整理布局');

    // No confirmation step: the tidy is on disk right after the click.
    await expect.poll(() => revisionOf(page), { timeout: 5000 }).toBe(before.revision + 1);
    const committed = await readStoredWorkspace(page) as Stored;
    expect(committed.layouts[10]).not.toEqual(before.layouts[10]);
    // A tidy only touches the current breakpoint.
    expect(committed.layouts[8]).toEqual(before.layouts[8]);
    expect(committed.layouts[5]).toEqual(before.layouts[5]);
    // Sizes and the instance set are untouched.
    expect(committed.layouts[10].map((item) => `${item.instanceId}:${item.w}x${item.h}`).sort())
      .toEqual(before.layouts[10].map((item) => `${item.instanceId}:${item.w}x${item.h}`).sort());
    // The scattered icon was pulled back up the page.
    await expect(page.locator('[data-instance-id="github"]')).not.toHaveAttribute('data-grid-y', '6');

    // One undo restores the whole tidy.
    await clickButton(page, '撤销布局');
    await expect.poll(async () => {
      const stored = await readStoredWorkspace(page) as Stored;
      return JSON.stringify(stored.layouts);
    }, { timeout: 10_000 }).toBe(JSON.stringify(before.layouts));
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-y', '6');
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('tidy never moves a locked widget and still compresses the rest', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await clickButton(page, '编辑主屏幕');

    // Lock the calendar where it is, then park an icon far down the page.
    await clickButton(page, '更多操作：日历');
    await clickButton(page, '锁定位置');
    await expect(page.locator('[data-instance-id="builtin.calendar"]')).toHaveAttribute('data-locked', 'true');

    await dragTo(page, await itemCenter(page, 'figma'), await cellCenter(page, 5, 8));
    await expect(page.locator('[data-instance-id="figma"]')).toHaveAttribute('data-grid-y', '8');
    await expect.poll(() => revisionOf(page), { timeout: 5000 }).toBeGreaterThan(0);

    const before = await readStoredWorkspace(page) as Stored;
    const calendarBefore = before.layouts[10].find((item) => item.instanceId === 'builtin.calendar');
    if (!calendarBefore) throw new Error('calendar missing from the stored layout');

    await clickButton(page, '整理布局');
    await expect.poll(() => revisionOf(page), { timeout: 5000 }).toBe(before.revision + 1);

    const committed = await readStoredWorkspace(page) as Stored;
    expect(committed.layouts[10].find((item) => item.instanceId === 'builtin.calendar')).toEqual(calendarBefore);
    // The scattered icon did move up, so the tidy actually did something.
    const figmaAfter = committed.layouts[10].find((item) => item.instanceId === 'figma');
    expect(figmaAfter?.y).toBeLessThan(8);
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('a second tidy on an already tidy layout reports it and writes nothing', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await scatterGithub(page);
    await clickButton(page, '编辑主屏幕');
    await clickButton(page, '整理布局');
    await expect(page.locator('.toast')).toContainText('已整理并保存');
    const settled = await readStoredWorkspace(page) as Stored;

    await clickButton(page, '整理布局');
    await expect(page.locator('.toast')).toContainText('已经是紧凑排列');
    // "Nothing to tidy" is an answer, not a write.
    expect(await readStoredWorkspace(page)).toEqual(settled);
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('dragging into a crowded block still lands legally via local rearrangement', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    const before = await readStoredWorkspace(page) as Stored;
    await scatterGithub(page);
    await expect.poll(() => revisionOf(page), { timeout: 5000 }).toBe(before.revision + 1);

    // Drag the calendar widget onto the dense shortcut block. A plain push has
    // no cheap answer there, so this exercises the local reflow fallback.
    await dragTo(page, await itemCenter(page, 'builtin.calendar'), await itemCenter(page, 'figma'));
    await expect(page.locator('.local-status')).toHaveAttribute('data-save-state', 'saved');

    const after = await readStoredWorkspace(page) as Stored;
    // Whatever path the solver took, the persisted layout must stay legal and
    // keep every instance exactly once with unchanged sizes.
    const ids = after.layouts[10].map((item) => item.instanceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(before.layouts[10].map((item) => item.instanceId)));
    expect(after.layouts[10].map((item) => `${item.instanceId}:${item.w}x${item.h}`).sort())
      .toEqual(before.layouts[10].map((item) => `${item.instanceId}:${item.w}x${item.h}`).sort());

    for (const a of after.layouts[10]) {
      for (const b of after.layouts[10]) {
        if (a.instanceId === b.instanceId) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.instanceId} overlaps ${b.instanceId}`).toBe(false);
      }
    }
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});
