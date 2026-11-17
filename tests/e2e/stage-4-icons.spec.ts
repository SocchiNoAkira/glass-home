import { test, expect } from '@playwright/test';
import http from 'node:http';
import zlib from 'node:zlib';
import { cleanupProfile, clickButton, launchExtension, openNewTab, waitForSaved } from './helpers';

/**
 * Site icons come from the browser's own `_favicon` store, not from the
 * extension fetching the site. Two consequences are tested here:
 *
 * - a site the browser has seen gets its real icon, and the tile drops the
 *   letter;
 * - a site the browser has never seen keeps its letter, because Chromium answers
 *   `_favicon` with a generic globe and that globe must not replace every
 *   unmatched shortcut's initials.
 *
 * A local HTTP server supplies the icon, so the case does not depend on the
 * internet or on any third-party site's availability.
 */

/**
 * A real 16x16 PNG, encoded here instead of pasted as base64: Chromium's
 * favicon pipeline re-encodes the image into its database, and a picture that
 * only a lenient `<img>` decoder accepts is silently dropped (the store then
 * keeps answering with the generic globe).
 */
function solidPng(size: number, rgb: readonly [number, number, number]): Buffer {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x += 1) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ICON_PNG = solidPng(16, [30, 120, 200]);

async function startIconSite() {
  const server = http.createServer((request, response) => {
    if (request.url === '/icon.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(ICON_PNG);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>Icon host</title><link rel="icon" href="/icon.png"><h1>icon host</h1>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('icon server did not start');
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

test('shows a browser-cached site icon and keeps the letter when there is none', async () => {
  const site = await startIconSite();
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    for (const [title, url] of [['图标站点', site.url], ['无图标站点', 'https://no-icon-for-this-domain.invalid/']] as const) {
      await clickButton(page, '添加快捷方式');
      await page.getByLabel('名称', { exact: true }).fill(title);
      await page.getByLabel('网址', { exact: true }).fill(url);
      await clickButton(page, '添加到主屏幕');
      await waitForSaved(page);
    }

    // Visiting the site is what puts its icon into the browser's store. This is
    // the user's own browsing, not something the extension does behind them.
    const visit = await context.newPage();
    await visit.goto(site.url);
    await visit.waitForTimeout(1500);
    await visit.close();

    await page.reload();
    await waitForSaved(page);

    const known = page.getByRole('link', { name: '打开 图标站点', exact: true });
    const favicon = known.locator('.shortcut__favicon');
    await expect(favicon).toBeVisible();
    expect(await favicon.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    // The letter is replaced, not layered under a transparent icon.
    await expect(known.locator('.shortcut__initials')).toHaveCount(0);

    const unknown = page.getByRole('link', { name: '打开 无图标站点', exact: true });
    await expect(unknown.locator('.shortcut__favicon')).toHaveCount(0);
    await expect(unknown.locator('.shortcut__initials')).toBeVisible();
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
    site.server.close();
  }
});
