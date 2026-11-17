import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { captureViewport, cleanupProfile, clickButton, launchExtension, openNewTab, waitForSaved } from './helpers';

test('captures the production home, editing and settings across breakpoints', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  const pageErrors: string[] = [];
  const unexpectedRequests: string[] = [];
  try {
    const page = await openNewTab(context, extensionId);
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') unexpectedRequests.push(request.url());
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await captureViewport(page, 'stage-1-default-edge.png');
    const performance = await page.evaluate(() => {
      const navigation = globalThis.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return {
        domContentLoadedMs: navigation?.domContentLoadedEventEnd,
        loadMs: navigation?.loadEventEnd,
        resources: globalThis.performance.getEntriesByType('resource').length,
      };
    });
    await clickButton(page, '编辑主屏幕');
    await expect(page.getByRole('button', { name: '完成', exact: true })).toBeVisible();
    await captureViewport(page, 'stage-1-edit-edge.png');
    await clickButton(page, '完成');
    await clickButton(page, '打开设置');
    await captureViewport(page, 'stage-1-settings-edge.png');
    await page.getByLabel('外观', { exact: true }).selectOption('light');
    await page.getByLabel('材质质量', { exact: true }).selectOption('off');
    await clickButton(page, '保存设置');
    await waitForSaved(page);
    await expect(page.getByRole('status').filter({ hasText: '设置已保存' })).toHaveCount(0);
    await captureViewport(page, 'stage-1-light-solid-edge.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('unified-grid')).toHaveAttribute('data-columns', '5');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await captureViewport(page, 'stage-1-narrow-edge.png');
    await fs.writeFile('artifacts/stage-1-visual-report.json', `${JSON.stringify({ capturedAt: new Date().toISOString(), browser: context.browser()?.browserType().name(), performance, pageErrors, unexpectedRequests, note: 'Navigation timings are one local production-page sample, not a performance budget or cross-browser guarantee. No navigation was submitted during capture.' }, null, 2)}\n`);
    expect(pageErrors).toEqual([]);
    expect(unexpectedRequests).toEqual([]);
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});
