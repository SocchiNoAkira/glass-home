import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { captureViewport, clickButton, launchExtension, openNewTab, readStoredWorkspace } from './helpers';

/**
 * Stage 2B-2 acceptance in real Edge: the compact tidy and the local
 * rearrangement fallback. Baseline 14.2 #19 is the important one here — a tidy
 * must not touch persisted data until the user confirms it.
 */

interface Stored {
  revision: number;
  layouts: Record<'10' | '8' | '5', { instanceId: string; x: number; y: number; w: number; h: number; locked: boolean }[]>;
}

/** Spread the shortcuts out so the default layout really has gaps to tidy. */
async function scatterLayout(page: Page) {
  await clickButton(page, '编辑主屏幕');
  await page.locator('#layout-object').selectOption('github');
  await page.locator('#layout-x').fill('0');
  await page.locator('#layout-y').fill('9');
  await clickButton(page, '生成预览');
  await clickButton(page, '确认并保存');
  await expect(page.locator('.local-status')).toHaveAttribute('data-save-state', 'saved');
}

test('compact tidy previews without persisting, then commits as one undoable transaction', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await scatterLayout(page);

    const before = await readStoredWorkspace(page) as Stored;
    // github was parked on row 9, so the page is taller than it needs to be.
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-y', '9');

    await clickButton(page, '紧凑整理');

    // 14.2 #19: the preview must not write anything.
    const preview = page.locator('.layout-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('紧凑整理');
    await expect(preview).toContainText('页面高度');
    expect(await readStoredWorkspace(page)).toEqual(before);

    // The rendered layout already shows the tidied result before saving.
    await expect(page.locator('[data-instance-id="github"]')).not.toHaveAttribute('data-grid-y', '9');
    expect(await readStoredWorkspace(page)).toEqual(before);

    await captureViewport(page, 'stage-2b2-compact-preview-edge.png');

    // Cancelling restores the committed layout exactly.
    await clickButton(page, '取消');
    await expect(preview).toHaveCount(0);
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-y', '9');
    expect(await readStoredWorkspace(page)).toEqual(before);

    // Confirming writes exactly one revision and one history entry.
    await clickButton(page, '紧凑整理');
    await clickButton(page, '确认并保存');
    await expect(page.locator('.local-status')).toHaveAttribute('data-save-state', 'saved');
    const committed = await readStoredWorkspace(page) as Stored;
    expect(committed.revision).toBe(before.revision + 1);
    expect(committed.layouts[10]).not.toEqual(before.layouts[10]);
    // A tidy only touches the current breakpoint.
    expect(committed.layouts[8]).toEqual(before.layouts[8]);
    expect(committed.layouts[5]).toEqual(before.layouts[5]);

    // Sizes and instance set are untouched.
    expect(committed.layouts[10].map((i) => `${i.instanceId}:${i.w}x${i.h}`).sort())
      .toEqual(before.layouts[10].map((i) => `${i.instanceId}:${i.w}x${i.h}`).sort());

    await captureViewport(page, 'stage-2b2-compact-committed-edge.png');

    // One undo restores the whole tidy.
    await clickButton(page, '撤销布局');
    await expect.poll(async () => {
      const stored = await readStoredWorkspace(page) as Stored;
      return JSON.stringify(stored.layouts);
    }, { timeout: 10_000 }).toBe(JSON.stringify(before.layouts));
    await expect(page.locator('[data-instance-id="github"]')).toHaveAttribute('data-grid-y', '9');
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('compact tidy never moves a locked object and keeps it in place after undo', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await clickButton(page, '编辑主屏幕');

    // Lock the calendar where it is, then park an icon far down the page.
    await page.locator('#layout-object').selectOption('builtin.calendar');
    await clickButton(page, '锁定对象');
    await clickButton(page, '确认并保存');
    await expect(page.locator('.local-status')).toHaveAttribute('data-save-state', 'saved');

    await page.locator('#layout-object').selectOption('figma');
    await page.locator('#layout-x').fill('0');
    await page.locator('#layout-y').fill('9');
    await clickButton(page, '生成预览');
    await clickButton(page, '确认并保存');
    await expect(page.locator('.local-status')).toHaveAttribute('data-save-state', 'saved');

    const before = await readStoredWorkspace(page) as Stored;
    const calendarBefore = before.layouts[10].find((i) => i.instanceId === 'builtin.calendar')!;

    await clickButton(page, '紧凑整理');
    await expect(page.locator('.layout-preview')).toBeVisible();

    // 14.2 #10: the locked widget keeps its exact cell in the preview.
    await expect(page.locator('[data-instance-id="builtin.calendar"]'))
      .toHaveAttribute('data-grid-x', String(calendarBefore.x));
    await expect(page.locator('[data-instance-id="builtin.calendar"]'))
      .toHaveAttribute('data-grid-y', String(calendarBefore.y));

    await clickButton(page, '确认并保存');
    await expect(page.locator('.local-status')).toHaveAttribute('data-save-state', 'saved');
    const committed = await readStoredWorkspace(page) as Stored;
    const calendarAfter = committed.layouts[10].find((i) => i.instanceId === 'builtin.calendar')!;
    expect(calendarAfter).toEqual(calendarBefore);

    // The scattered icon did move up, so the tidy actually did something.
    const figmaAfter = committed.layouts[10].find((i) => i.instanceId === 'figma')!;
    expect(figmaAfter.y).toBeLessThan(9);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('a tidy on an already compact layout reports no changes instead of writing', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    const before = await readStoredWorkspace(page) as Stored;
    await clickButton(page, '编辑主屏幕');
    await clickButton(page, '紧凑整理');

    // Either the button produces a real preview, or the default layout is
    // already dense and the solver refuses with an explanation. Neither may
    // write a revision.
    const preview = page.locator('.layout-preview');
    const toast = page.locator('.toast');
    if (await preview.count()) {
      await expect(preview).toContainText('影响');
      expect(await readStoredWorkspace(page)).toEqual(before);
      await clickButton(page, '取消');
    } else {
      await expect(toast).toBeVisible();
      expect(await readStoredWorkspace(page)).toEqual(before);
    }
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('dragging into a crowded block still lands legally via local rearrangement', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    const before = await readStoredWorkspace(page) as Stored;

    // Park github far down, then drag the calendar widget onto the dense
    // shortcut block. A plain push has no cheap answer there.
    await scatterLayout(page);
    const calendar = await page.locator('[data-instance-id="builtin.calendar"]').boundingBox();
    if (!calendar) throw new Error('calendar has no bounds');
    const github = await page.locator('[data-instance-id="github"]').boundingBox();
    if (!github) throw new Error('github has no bounds');

    const from = { x: calendar.x + calendar.width / 2, y: calendar.y + calendar.height / 2 };
    const to = { x: github.x + github.width / 2, y: github.y + github.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
    }
    await page.mouse.up();
    await expect(page.locator('.local-status')).toHaveAttribute('data-save-state', 'saved');

    const after = await readStoredWorkspace(page) as Stored;
    // Whatever path the solver took, the persisted layout must stay legal and
    // keep every instance exactly once with unchanged sizes.
    const ids = after.layouts[10].map((i) => i.instanceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(before.layouts[10].map((i) => i.instanceId)));
    expect(after.layouts[10].map((i) => `${i.instanceId}:${i.w}x${i.h}`).sort())
      .toEqual(before.layouts[10].map((i) => `${i.instanceId}:${i.w}x${i.h}`).sort());

    // No overlaps: every pair of cells is disjoint.
    for (const a of after.layouts[10]) {
      for (const b of after.layouts[10]) {
        if (a.instanceId === b.instanceId) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.instanceId} overlaps ${b.instanceId}`).toBe(false);
      }
    }
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
