import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { copyFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  // Copy dev.db schema to test.db (drizzle-kit uses hardcoded dev.db)
  copyFileSync(join(__dirname, '..', 'dev.db'), join(__dirname, '..', 'test.db'));
  const proc = spawn('node', ['server.js'], {
    cwd: join(__dirname, '..'),
    env: {
      ...process.env,
      ADMIN_PASSWORD: 'test123',
      DB_PATH: join(__dirname, '..', 'test.db'),
      PORT: '3001',
      // The suite drives the public endpoints from one IP; don't let rate limiting block it.
      RATE_LIMIT_DISABLED: '1',
    },
    stdio: 'pipe',
  });

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

  // Poll a public endpoint — /api/submissions now requires auth and would 401 forever.
  await wait('http://localhost:3001/api/admin/check-auth');
}

export const teardown = async () => {
  // Playwright handles cleanup
};
