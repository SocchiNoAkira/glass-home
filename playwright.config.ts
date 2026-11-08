import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'stage-[12]*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: './artifacts/playwright',
  reporter: [['list'], ['json', { outputFile: './artifacts/e2e-results.json' }]],
  use: {
    headless: false,
    channel: 'msedge',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [`--disable-extensions-except=${path.join(root, '.output/chrome-mv3')}`, `--load-extension=${path.join(root, '.output/chrome-mv3')}`],
    },
  },
});
