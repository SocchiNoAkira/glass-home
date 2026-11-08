import { expect, chromium, type BrowserContext, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

export const extensionPath = path.resolve('.output/chrome-mv3');

export async function launchExtension(existingUserDataDir?: string) {
  const userDataDir = existingUserDataDir ?? await fs.mkdtemp(path.join(process.cwd(), 'artifacts', 'edge-profile-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge', headless: false, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const preferencesPath = path.join(userDataDir, 'Default', 'Preferences');
  await expect.poll(async () => {
    try {
      const preferences = JSON.parse(await fs.readFile(preferencesPath, 'utf8')) as {
        extensions?: { chrome_url_overrides?: { newtab?: { active?: boolean; entry?: string }[] } };
      };
      return preferences.extensions?.chrome_url_overrides?.newtab?.find(
        (entry) => entry.active && entry.entry?.endsWith('/newtab.html'),
      )?.entry ?? '';
    } catch { return ''; }
  }, { timeout: 15_000 }).toMatch(/^chrome-extension:\/\/[a-z]{32}\/newtab\.html$/);
  const preferences = JSON.parse(await fs.readFile(preferencesPath, 'utf8')) as {
    extensions: { chrome_url_overrides: { newtab: { entry: string }[] } };
  };
  const entry = preferences.extensions.chrome_url_overrides.newtab[0]?.entry;
  if (!entry) throw new Error('Glass Home is not registered as the new-tab override in Edge');
  return { context, extensionId: new URL(entry).host, userDataDir };
}

export async function openNewTab(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto('chrome://newtab');
  await expect(page).toHaveURL(`chrome-extension://${extensionId}/newtab.html`);
  await expect(page.getByTestId('glass-home-app')).toBeVisible();
  await waitForSaved(page);
  await page.bringToFront();
  return page;
}

export async function waitForSaved(page: Page): Promise<void> {
  await expect(page.locator('.local-status')).toHaveAttribute('data-save-state', 'saved');
}

export async function click(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled({ timeout: 5000 });
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('Control has no layout bounds');
  await locator.page().mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

export async function clickButton(page: Page, name: string | RegExp): Promise<void> {
  await click(page.getByRole('button', { name, exact: typeof name === 'string' }));
}

export async function clickTab(page: Page, name: string): Promise<void> {
  await click(page.getByRole('tab', { name, exact: true }));
}

export async function captureViewport(page: Page, filename: string): Promise<void> {
  await page.bringToFront();
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  const session = await page.context().newCDPSession(page);
  try {
    const image = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    await fs.writeFile(path.join('artifacts', filename), Buffer.from(image.data, 'base64'));
  } finally {
    await session.detach();
  }
}

export async function readStoredWorkspace(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('glass-home', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('workspaces', 'readonly');
    const value = await new Promise((resolve, reject) => {
      const request = transaction.objectStore('workspaces').get('glass-home-workspace');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return value;
  });
}
