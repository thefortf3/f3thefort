import { defineConfig, devices } from '@playwright/test';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function globalSetup() {
  const proc = spawn('node', ['server.js'], {
    cwd: join(__dirname),
    env: { ...process.env, ADMIN_PASSWORD: 'test123' },
    stdio: 'pipe',
  });

  // Wait for server to be ready
  const wait = async (url, maxRetries = 30) => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(url);
        if (res.ok) return;
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Server failed to start');
  };

  await wait('http://localhost:3000/api/submissions');

  // Cleanup on exit
  process.on('exit', () => proc.kill());
  process.on('SIGTERM', () => { proc.kill(); process.exit(1); });
}

export default defineConfig({
  globalSetup: join(__dirname, 'tests/global-setup.js'),
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3001',
    actionTimeout: 5000,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
