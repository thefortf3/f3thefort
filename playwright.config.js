import { defineConfig, devices } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = 'http://localhost:3001';

export default defineConfig({
  globalSetup: join(__dirname, 'tests/global-setup.js'),
  testDir: './tests',
  // Only run Playwright browser specs here; *.unit.js files run under `node --test`.
  testMatch: '**/*.spec.js',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    // requireSameOrigin gates the public POST endpoints; page.request calls don't set an
    // Origin on their own, so provide one that matches the server host.
    extraHTTPHeaders: { Origin: BASE_URL },
    actionTimeout: 5000,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
