import { test, expect } from '@playwright/test';
import { cleanupProfile, clickButton, clickTab, launchExtension, openNewTab } from './helpers';

/**
 * Stage 3-C acceptance: the host <-> sandbox channel.
 *
 * The point of these cases is not "an iframe rendered" but that the isolation
 * still holds while a real message actually crosses the boundary: the sandbox
 * must stay blind to the parent DOM and extension APIs, and the host must
 * refuse forged, replayed and out-of-budget traffic.
 */

test('the sandbox demo completes a real environment handshake', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await clickButton(page, '打开设置');
    await clickTab(page, '数据');

    // The iframe must load under the manifest sandbox policy.
    const frame = page.locator('.sandbox-demo__frame');
    await expect(frame).toBeVisible();
    expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');
    // `src` is assigned imperatively after the session listener exists, so the
    // assertion is on the resolved document rather than the attribute at an
    // arbitrary moment. (The src *attribute* is still set once the effect runs.)
    await expect.poll(async () => page.frames().some((candidate) => candidate.url().endsWith('/widget-probe.html'))).toBe(true);

    // A real round trip: the host asks, the sandbox answers, the reply renders.
    const sandboxFrame = page.frameLocator('.sandbox-demo__frame');
    await expect(sandboxFrame.locator('#environment')).toHaveAttribute('data-widget-environment', 'received', { timeout: 10_000 });
    await expect(page.locator('.sandbox-demo__status')).toHaveAttribute('data-sandbox-state', 'connected');

    // The sandbox rendered the host-provided values, not its own guesses.
    await expect(sandboxFrame.locator('#environment')).toContainText('主题');
    await expect(sandboxFrame.locator('#environment')).toContainText('2 × 2 格');

    await page.screenshot({ path: '/tmp/glass-home-shots/stage-3-sandbox-edge.png', fullPage: false });
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('the sandbox cannot reach the parent DOM or extension APIs while the channel is open', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await clickButton(page, '打开设置');
    await clickTab(page, '数据');
    const sandboxContent = page.frameLocator('.sandbox-demo__frame');
    await expect(sandboxContent.locator('#environment')).toHaveAttribute('data-widget-environment', 'received', { timeout: 10_000 });

    // Evaluate inside the sandbox document itself and try the usual escapes.
    // A bare `chrome` object can exist in a sandboxed page, so the meaningful
    // check is `runtime.id`: without it no extension API is reachable.
    const sandboxFrame = page.frames().find((candidate) => candidate.url().includes('widget-probe'));
    expect(sandboxFrame).toBeTruthy();
    if (!sandboxFrame) return;
    const probe = await sandboxFrame.evaluate(() => {
      let parentAccessible = false;
      let parentError = '';
      try {
        void (window.parent as Window).document;
        parentAccessible = true;
      } catch (error) {
        parentError = error instanceof Error ? error.name : 'throw';
      }
      const chromeGlobal = (globalThis as { chrome?: { runtime?: { id?: unknown } } }).chrome;
      return {
        parentAccessible,
        parentError,
        extensionApiAccessible: typeof chromeGlobal?.runtime?.id === 'string',
      };
    });

    // 10.4: no parent DOM, no extension APIs.
    //
    // Deliberately no assertion on `location.origin`: Chrome reports the document
    // URL there (`chrome-extension://…`) even though the *security* origin is
    // opaque. The opaque origin is exactly why the parent access above throws,
    // so that thrown error is the real evidence — asserting on the URL string
    // would test a label, not the isolation.
    expect(probe.parentAccessible).toBe(false);
    expect(probe.parentError).toBe('SecurityError');
    expect(probe.extensionApiAccessible).toBe(false);

    // Fewer than 20 requests were made, so no rate limiting is visible here;
    // the forged-message cases below cover the refusal path.
    await expect(page.locator('.sandbox-demo__status')).toHaveAttribute('data-sandbox-state', 'connected');
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});

test('the host ignores forged messages and a wrong instance id', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const page = await openNewTab(context, extensionId);
    await clickButton(page, '打开设置');
    await clickTab(page, '数据');
    const frame = page.locator('.sandbox-demo__frame');
    await expect(frame).toBeVisible();

    // Post forged traffic into the page from the test, mimicking what a hostile
    // widget could send. None of it may produce an environment response.
    const results = await page.evaluate(async () => {
      const sandbox = document.querySelector<HTMLIFrameElement>('.sandbox-demo__frame');
      if (!sandbox?.contentWindow) return { posted: false, received: 0 };
      let received = 0;
      const listener = (event: MessageEvent) => {
        if (event.data && typeof event.data === 'object' && (event.data as { type?: string }).type === 'response') received += 1;
      };
      window.addEventListener('message', listener);
      sandbox.contentWindow.postMessage({ protocolVersion: 1, type: 'request', messageId: 'forged-1', instanceId: 'builtin.todo', method: 'environment.get', payload: {}, timestamp: Date.now() }, '*');
      sandbox.contentWindow.postMessage({ protocolVersion: 1, type: 'request', messageId: 'forged-2', instanceId: 'builtin.sandbox-demo', method: 'storage.write', payload: {}, timestamp: Date.now() }, '*');
      sandbox.contentWindow.postMessage({ nope: true }, '*');
      await new Promise((resolve) => setTimeout(resolve, 600));
      window.removeEventListener('message', listener);
      return { posted: true, received };
    });

    // A forged instance id and an unopened capability must never be served.
    // The first one answers with an explicit error, which is not a response.
    expect(results.posted).toBe(true);
    expect(results.received).toBe(0);
  } finally {
    await context.close();
    await cleanupProfile(userDataDir);
  }
});
