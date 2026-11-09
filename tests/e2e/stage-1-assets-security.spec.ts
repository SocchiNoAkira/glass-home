import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { click, clickButton, clickTab, launchExtension, openNewTab, readStoredWorkspace, waitForSaved } from './helpers';
import { extensionPath } from './helpers';

test('exports and restores a local wallpaper with its Workspace in one flow', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await clickButton(page, '打开设置');
    const validPng = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Test canvas is unavailable');
      const gradient = context.createLinearGradient(0, 0, 8, 8);
      gradient.addColorStop(0, '#736b88');
      gradient.addColorStop(1, '#e6b6aa');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 8, 8);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    if (!validPng) throw new Error('Test image was not generated');
    await page.locator('input[type=file][accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'wallpaper.png', mimeType: 'image/png', buffer: Buffer.from(validPng, 'base64') });
    await expect(page.getByLabel('自定义壁纸预览')).toBeVisible();
    await clickButton(page, '保存设置');
    await waitForSaved(page);
    await expect(page.locator('.wallpaper__custom')).toHaveCSS('background-image', /^url\("blob:/);
    await clickButton(page, '打开设置');
    await clickTab(page, '数据');
    const downloadPromise = page.waitForEvent('download');
    await clickButton(page, '导出备份');
    const backupPath = path.join('artifacts', 'stage-1-assets-backup.json');
    await (await downloadPromise).saveAs(backupPath);
    await clickButton(page, '恢复默认');
    await click(page.getByRole('dialog', { name: '恢复默认主屏幕？' }).getByRole('button', { name: '恢复默认', exact: true }));
    await waitForSaved(page);
    await expect(page.locator('.wallpaper__custom')).toHaveCSS('background-image', 'none');
    await page.reload();
    await waitForSaved(page);
    await clickButton(page, '打开设置');
    await clickTab(page, '数据');
    await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles(backupPath);
    await waitForSaved(page);
    await expect(page.locator('.wallpaper__custom')).toHaveCSS('background-image', /^url\("blob:/);
    await page.reload();
    await waitForSaved(page);
    await expect(page.locator('.wallpaper__custom')).toHaveCSS('background-image', /^url\("blob:/);
    const backup = JSON.parse(await fs.readFile(backupPath, 'utf8')) as { assets: unknown[] };
    expect(backup.assets).toHaveLength(1);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('recovers from a corrupt Workspace using a valid backup and preserves raw export access', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await clickButton(page, '打开设置');
    await clickTab(page, '数据');
    const downloadPromise = page.waitForEvent('download');
    await clickButton(page, '导出备份');
    const backupPath = path.join('artifacts', 'stage-1-recovery-backup.json');
    await (await downloadPromise).saveAs(backupPath);
    await clickButton(page, '完成');
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        // No version: opening without one takes the current on-disk version, so
        // this keeps working across schema upgrades.
        const request = indexedDB.open('glass-home');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('workspaces', 'readwrite');
        transaction.objectStore('workspaces').put({ workspaceId: 'glass-home-workspace', broken: true });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: '主屏幕需要恢复' })).toBeVisible();
    const rawDownloadPromise = page.waitForEvent('download');
    await clickButton(page, '导出原始数据');
    expect((await rawDownloadPromise).suggestedFilename()).toMatch(/^glass-home-raw-/);
    await page.getByLabel('选择恢复备份').setInputFiles(backupPath);
    await waitForSaved(page);
    await expect(page.locator('.shortcut')).toHaveCount(20);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('persists an immediate post-submit reload and keeps the sandbox isolated', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await clickButton(page, '添加快捷方式');
    await page.getByLabel('名称', { exact: true }).fill('立即刷新');
    await page.getByLabel('网址', { exact: true }).fill('https://example.com');
    await clickButton(page, '添加到主屏幕');
    await page.reload();
    await waitForSaved(page);
    await expect(page.getByRole('link', { name: '打开 立即刷新', exact: true })).toBeVisible();

    // Isolation check against the stage 3 sandbox bridge. The probe page is now
    // a real widget that asks the host for its environment, so the old
    // `widget-probe-request` nonce handshake no longer exists. Playwright can
    // read the sandbox document even though the app cannot.
    // Isolation only holds when the page is embedded: as a top-level tab its
    // `window.parent` is itself, so `document` is reachable by definition.
    //
    // Evidence is taken from the *host* side, which is what actually matters:
    // if the host can read the frame's document, the sandbox is not isolating.
    // The sandbox's own report is deliberately not trusted — a page could claim
    // anything about itself.
    const sandboxResult = await page.evaluate((extensionOrigin) => new Promise<{
      parentAccess: string; extensionApiAccess: string;
    }>((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.src = `${extensionOrigin}/widget-probe.html`;
      frame.hidden = true;
      const timer = window.setTimeout(() => { frame.remove(); reject(new Error('sandbox probe timed out')); }, 8000);
      window.addEventListener('message', function receive(event) {
        if (event.source !== frame.contentWindow) return;
        const data = event.data as { type?: string; method?: string } | null;
        // Wait for the probe script to run, so the frame is fully live before
        // the host-side access attempt.
        if (!data || data.type !== 'event' || data.method !== 'sandbox.ready') return;
        window.clearTimeout(timer);
        window.removeEventListener('message', receive);
        let parentReadable = false;
        let extensionReachable = false;
        try {
          const sandboxWindow = frame.contentWindow as (Window & { chrome?: { runtime?: { id?: unknown } } }) | null;
          void sandboxWindow?.document;
          parentReadable = true;
          extensionReachable = typeof sandboxWindow?.chrome?.runtime?.id === 'string';
        } catch {
          // A cross-origin throw here is the isolation working as intended.
          parentReadable = false;
        }
        frame.remove();
        resolve({
          parentAccess: parentReadable ? 'accessible' : 'blocked',
          extensionApiAccess: extensionReachable ? 'accessible' : 'blocked',
        });
      });
      document.body.append(frame);
    }), `chrome-extension://${extensionId}`);
    expect(sandboxResult).toMatchObject({ parentAccess: 'blocked', extensionApiAccess: 'blocked' });
    const manifest = JSON.parse(await fs.readFile(path.join(extensionPath, 'manifest.json'), 'utf8')) as { permissions?: string[]; host_permissions?: string[]; content_security_policy?: { sandbox?: string } };
    expect(manifest.permissions ?? []).toEqual([]);
    expect(manifest.host_permissions ?? []).toEqual([]);
    expect(manifest.content_security_policy?.sandbox).not.toContain('unsafe-eval');
    expect(manifest.content_security_policy?.sandbox).toContain("connect-src 'none'");
    expect((await readStoredWorkspace(page) as { shortcuts: unknown[] }).shortcuts).toHaveLength(21);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
