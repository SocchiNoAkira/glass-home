import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import { extensionPath } from './tests/e2e/helpers';

/**
 * Traces and failure screenshots go to a per-run directory in the OS temp dir,
 * not to a fixed in-repo path. Playwright clears its `outputDir` at startup, and
 * a leftover populated directory turns that into a large recursive delete that
 * some safety wrappers refuse — the run then fails before the first test. A path
 * that does not exist yet needs no deletion at all.
 */
const runOutputDir = path.join(os.tmpdir(), 'glass-home-playwright', new Date().toISOString().replace(/[:.]/g, '-'));

/**
 * Always hidden. A visible Edge window steals focus and keyboard from whatever
 * else the machine is doing, and a regression run must never interfere with
 * normal use. There is deliberately no switch to re-enable it.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Stage 4 adds the data-management cases; the pattern must include them or a
  // plain `playwright test` run would silently skip the newest acceptance work.
  testMatch: 'stage-[1-4]*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: runOutputDir,
  reporter: [['list'], ['json', { outputFile: './artifacts/e2e-results.json' }]],
  use: {
    headless: true,
    channel: 'msedge',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    },
  },
});
