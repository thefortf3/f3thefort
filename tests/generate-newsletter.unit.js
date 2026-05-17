#!/usr/bin/env node
/**
 * Unit tests for newsletter generation (generate-newsletter.mjs)
 * Uses Node.js built-in test runner.
 *
 * Run:  node --test tests/generate-newsletter.unit.js
 */

import { describe, it } from 'node:test';
import { equal, deepEqual, ok, match } from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// ─── Helpers ─────────────────────────────────────────────────────────

/** Run the generator and return the HTML string */
async function runGenerator(outputPath) {
  const { default: generator } = await import(
    join(projectRoot, 'generate-newsletter.mjs')
  );
  // The generator writes to file; we just verify the file exists and is valid HTML
  return readFileSync(outputPath, 'utf-8');
}

/** Create a temporary test DB with known entries (unique path per call) */
function createTestDB(entries, suffix = Date.now()) {
  const dbPath = resolve(projectRoot, `test-temp-${suffix}.db`);
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      leader TEXT,
      start_date TEXT NOT NULL,
      end_time TEXT,
      location TEXT,
      description TEXT NOT NULL,
      link TEXT,
      section TEXT,
      submitter_name TEXT,
      submitter_email TEXT,
      submitter_phone TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const stmt = db.prepare(`
    INSERT INTO submissions (title, leader, start_date, end_time, location, description, link, section)
    VALUES (@title, @leader, @start_date, @end_time, @location, @description, @link, @section)
  `);

  for (const entry of entries) {
    stmt.run(entry);
  }

  db.close();
  return dbPath;
}

/** Clean up temp DB */
function cleanupDB(dbPath) {
  try { unlinkSync(dbPath); } catch { /* ignore */ }
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('static-data.json', () => {
  it('should be valid JSON with required structure', () => {
    const data = JSON.parse(readFileSync(join(projectRoot, 'static-data.json'), 'utf-8'));

    ok(data.masthead, 'masthead should exist');
    ok(data.masthead.eyebrow, 'masthead.eyebrow should exist');
    ok(data.masthead.title, 'masthead.title should exist');
    ok(data.masthead.subtitle, 'masthead.subtitle should exist');

    ok(data.issue, 'issue should exist');
    ok(data.issue.organization, 'issue.organization should exist');

    ok(data.footer, 'footer should exist');
    ok(data.footer.submitUrl, 'footer.submitUrl should exist');
    ok(data.footer.motto, 'footer.motto should exist');

    ok(data.sections, 'sections should exist');
    equal(Array.isArray(data.sections), true, 'sections should be an array');
  });

  it('should have exactly 4 sections in correct order', () => {
    const data = JSON.parse(readFileSync(join(projectRoot, 'static-data.json'), 'utf-8'));

    equal(data.sections.length, 4);
    equal(data.sections[0].id, 'whats-hot');
    equal(data.sections[1].id, 'individual-init');
    equal(data.sections[2].id, 'still-fresh');
    equal(data.sections[3].id, 'helpful-links');

    equal(data.sections[0].order, 1);
    equal(data.sections[1].order, 2);
    equal(data.sections[2].order, 3);
    equal(data.sections[3].order, 4);
  });

  it('should have correct section labels', () => {
    const data = JSON.parse(readFileSync(join(projectRoot, 'static-data.json'), 'utf-8'));

    equal(data.sections[0].label, "This Week's Hot");
    equal(data.sections[1].label, 'Individual Initiative');
    equal(data.sections[2].label, 'Still Fresh');
    equal(data.sections[3].label, 'Helpful Links');
  });
});

describe('generate-newsletter.mjs — HTML output', () => {
  let testDbPath;
  let outputPath;

  it('should generate HTML with masthead from static-data.json', async () => {
    testDbPath = createTestDB([
      {
        title: 'Test Event',
        leader: 'Leader One',
        start_date: '2026-05-20T09:00',
        end_time: '2026-05-20T11:00',
        location: 'Test Park',
        description: '<p>Test description</p>',
        link: '',
        section: 'whats-hot',
      },
    ], 1);
    outputPath = resolve(projectRoot, 'test-output.html');

    const { spawn } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      const proc = spawn('node', ['generate-newsletter.mjs', `--output=${outputPath}`, `--db=${testDbPath}`], {
        cwd: projectRoot,
      });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    });

    const html = readFileSync(outputPath, 'utf-8');

    ok(html.includes('<title>The Fort'), 'should have correct title');
    ok(html.includes('Weekly Notification'), 'should have masthead eyebrow');
    ok(html.includes('The <em>Fort</em>'), 'should have masthead title');
    ok(html.includes('Events &amp; notifications'), 'should have masthead subtitle');

    cleanupDB(testDbPath);
    try { unlinkSync(outputPath); } catch { /* ignore */ }
  });

  it('should include entries grouped by section from DB', async () => {
    testDbPath = createTestDB([
      {
        title: 'Hot Event',
        leader: 'L1',
        start_date: '2026-05-20T09:00',
        end_time: '2026-05-20T11:00',
        location: 'Park A',
        description: '<p>Hot event desc</p>',
        link: '',
        section: 'whats-hot',
      },
      {
        title: 'Fresh Event',
        leader: 'L2',
        start_date: '2026-06-01T10:00',
        end_time: '',
        location: 'Park B',
        description: '<p>Fresh event desc</p>',
        link: '',
        section: 'still-fresh',
      },
      {
        title: 'Indiv Event',
        leader: 'L3',
        start_date: '2026-07-01T10:00',
        end_time: '',
        location: 'Park C',
        description: '<p>Indiv event desc</p>',
        link: '',
        section: 'individual-init',
      },
      {
        title: 'Link Resource',
        leader: '',
        start_date: '',
        end_time: '',
        location: '',
        description: '<p>Helpful link resource</p>',
        link: 'https://example.com/resource',
        section: 'helpful-links',
      },
    ], 2);
    outputPath = resolve(projectRoot, 'test-output2.html');

    const { spawn } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      const proc = spawn('node', ['generate-newsletter.mjs', `--output=${outputPath}`, `--db=${testDbPath}`], {
        cwd: projectRoot,
      });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    });

    const html = readFileSync(outputPath, 'utf-8');

    ok(html.includes("This Week's Hot"), 'should have whats-hot section label');
    ok(html.includes('Individual Initiative'), 'should have individual-init section label');
    ok(html.includes('Still Fresh'), 'should have still-fresh section label');
    ok(html.includes('Helpful Links'), 'should have helpful-links section label');

    ok(html.includes('Hot Event'), 'should include whats-hot entry');
    ok(html.includes('Fresh Event'), 'should include still-fresh entry');
    ok(html.includes('Link Resource'), 'should include helpful-links entry');

    ok(html.includes('https://example.com/resource'), 'should include link from entry');

    ok(html.includes('L1'), 'should include leader L1');
    ok(html.includes('L2'), 'should include leader L2');
    ok(html.includes('L3'), 'should include leader L3');

    ok(html.includes('📅'), 'should include date emoji');
    ok(html.includes('📍'), 'should include location emoji');

    // Link-only card should have special class
    ok(html.includes('event-card--link'), 'should have link-only card class');

    cleanupDB(testDbPath);
    try { unlinkSync(outputPath); } catch { /* ignore */ }
  });

  it('should generate dark theme CSS', async () => {
    testDbPath = createTestDB([
      {
        title: 'Dark Theme Test',
        leader: '',
        start_date: '2026-05-20T09:00',
        end_time: '',
        location: '',
        description: '<p>Test</p>',
        link: '',
        section: 'whats-hot',
      },
    ], 3);
    outputPath = resolve(projectRoot, 'test-output3.html');

    const { spawn } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      const proc = spawn('node', ['generate-newsletter.mjs', `--output=${outputPath}`, `--db=${testDbPath}`], {
        cwd: projectRoot,
      });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    });

    const html = readFileSync(outputPath, 'utf-8');

    // Dark background
    ok(html.includes('--color-bg: #0D0D0D'), 'should have dark background');
    ok(html.includes('--color-card: #1E1E1E'), 'should have dark card color');
    ok(html.includes('--color-text: #E8E4DF'), 'should have light text color');

    // Red accent
    ok(html.includes('--color-accent: #C43A3A'), 'should have red accent');
    ok(html.includes('--color-accent-light: #E05050'), 'should have red accent light');
    ok(html.includes('--color-accent-glow'), 'should have accent glow');

    // Footer
    ok(html.includes('submit.f3thefort.com'), 'should have submit URL in footer');
    ok(html.includes('SYITG'), 'should have motto in footer');

    // Fonts
    ok(html.includes('Playfair+Display'), 'should load Playfair Display font');
    ok(html.includes('Source+Serif+4'), 'should load Source Serif 4 font');
    ok(html.includes('DM+Sans'), 'should load DM Sans font');

    cleanupDB(testDbPath);
    try { unlinkSync(outputPath); } catch { /* ignore */ }
  });

  it('should format dates correctly', async () => {
    testDbPath = createTestDB([
      {
        title: 'Date Format Test',
        leader: '',
        start_date: '2026-05-23T06:30',
        end_time: '2026-05-23T08:00',
        location: 'Test Location',
        description: '<p>Testing date format.</p>',
        link: '',
        section: 'whats-hot',
      },
    ], 4);
    outputPath = resolve(projectRoot, 'test-output4.html');

    const { spawn } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      const proc = spawn('node', ['generate-newsletter.mjs', `--output=${outputPath}`, `--db=${testDbPath}`], {
        cwd: projectRoot,
      });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    });

    const html = readFileSync(outputPath, 'utf-8');

    // May 23, 2026 is a Saturday, 6:30 AM to 8:00 AM
    ok(html.includes('Sat, May 23'), 'should format day and month correctly');
    ok(html.includes('6:30 AM'), 'should format start time correctly');
    ok(html.includes('8:00 AM'), 'should format end time correctly');

    // Should not have "Invalid" or "NaN"
    ok(!html.includes('Invalid'), 'should not contain "Invalid"');
    ok(!html.includes('NaN'), 'should not contain "NaN"');

    cleanupDB(testDbPath);
    try { unlinkSync(outputPath); } catch { /* ignore */ }
  });

  it('should escape HTML in titles and descriptions', async () => {
    testDbPath = createTestDB([
      {
        title: '<script>alert("xss")</script>Bad Title',
        leader: '',
        start_date: '2026-05-23T09:00',
        end_time: '',
        location: '',
        description: '<p>Normal desc</p>',
        link: '',
        section: 'whats-hot',
      },
    ], 5);
    outputPath = resolve(projectRoot, 'test-output5.html');

    const { spawn } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      const proc = spawn('node', ['generate-newsletter.mjs', `--output=${outputPath}`, `--db=${testDbPath}`], {
        cwd: projectRoot,
      });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    });

    const html = readFileSync(outputPath, 'utf-8');

    // Should escape <script> tags in title
    ok(!html.includes('<script>alert'), 'should escape script tags in title');
    ok(html.includes('&lt;script&gt;'), 'should use HTML entities for escaped tags');

    cleanupDB(testDbPath);
    try { unlinkSync(outputPath); } catch { /* ignore */ }
  });

  it('should generate valid HTML structure', async () => {
    testDbPath = createTestDB([
      {
        title: 'Valid HTML Test',
        leader: '',
        start_date: '2026-05-23T09:00',
        end_time: '',
        location: '',
        description: '<p>Test</p>',
        link: '',
        section: 'whats-hot',
      },
    ], 6);
    outputPath = resolve(projectRoot, 'test-output6.html');

    const { spawn } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      const proc = spawn('node', ['generate-newsletter.mjs', `--output=${outputPath}`, `--db=${testDbPath}`], {
        cwd: projectRoot,
      });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    });

    const html = readFileSync(outputPath, 'utf-8');

    ok(html.startsWith('<!DOCTYPE html>'), 'should start with DOCTYPE');
    ok(html.includes('<html lang="en">'), 'should have html lang attribute');
    ok(html.includes('<head>'), 'should have head section');
    ok(html.includes('<body>'), 'should have body section');
    ok(html.includes('</html>'), 'should close html tag');
    ok(html.includes('<style>'), 'should have inline styles');
    ok(html.includes('<header class="masthead">'), 'should have masthead header');
    ok(html.includes('<footer class="newsletter-footer">'), 'should have footer');
    ok(html.includes('<article class="event-card">'), 'should have event cards');
    ok(html.includes('class="container"'), 'should have container');

    cleanupDB(testDbPath);
    try { unlinkSync(outputPath); } catch { /* ignore */ }
  });

  it('should handle empty database (no submissions)', async () => {
    testDbPath = createTestDB([], 7);
    outputPath = resolve(projectRoot, 'test-output7.html');

    const { spawn } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      const proc = spawn('node', ['generate-newsletter.mjs', `--output=${outputPath}`, `--db=${testDbPath}`], {
        cwd: projectRoot,
      });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    });

    const html = readFileSync(outputPath, 'utf-8');

    ok(html.includes('<title>The Fort'), 'should still generate valid HTML');
    ok(html.includes('0 Entries'), 'should show 0 entries count');
    ok(html.includes('Weekly Notification'), 'should still have masthead');
    ok(html.includes('SYITG'), 'should still have footer');

    // No section headers should appear (empty sections)
    ok(!html.includes('This Week\'s Hot'), 'should not show empty sections');

    cleanupDB(testDbPath);
    try { unlinkSync(outputPath); } catch { /* ignore */ }
  });

  it('should output to custom path via --output flag', async () => {
    testDbPath = createTestDB([
      {
        title: 'Custom Path Test',
        leader: '',
        start_date: '2026-05-23T09:00',
        end_time: '',
        location: '',
        description: '<p>Test</p>',
        link: '',
        section: 'whats-hot',
      },
    ], 8);
    const customOutput = resolve(projectRoot, 'test-custom-output.html');

    const { spawn } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      const proc = spawn('node', ['generate-newsletter.mjs', `--output=${customOutput}`], {
        cwd: projectRoot,
      });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    });

    ok(readFileSync(customOutput, 'utf-8').length > 1000, 'should write to custom path');

    cleanupDB(testDbPath);
    try { unlinkSync(customOutput); } catch { /* ignore */ }
  });
});

describe('generate-newsletter.mjs — section ordering', () => {
  let testDbPath;
  let outputPath;

  it('should render sections in the order defined in static-data.json', async () => {
    testDbPath = createTestDB([
      {
        title: 'Helpful Link',
        leader: '',
        start_date: '',
        end_time: '',
        location: '',
        description: '<p>Link</p>',
        link: 'https://example.com',
        section: 'helpful-links',
      },
      {
        title: 'Hot Event',
        leader: 'L1',
        start_date: '2026-05-20T09:00',
        end_time: '',
        location: '',
        description: '<p>Hot</p>',
        link: '',
        section: 'whats-hot',
      },
      {
        title: 'Fresh Event',
        leader: 'L2',
        start_date: '2026-06-01T10:00',
        end_time: '',
        location: '',
        description: '<p>Fresh</p>',
        link: '',
        section: 'still-fresh',
      },
      {
        title: 'Indiv Event',
        leader: 'L3',
        start_date: '2026-07-01T10:00',
        end_time: '',
        location: '',
        description: '<p>Indiv</p>',
        link: '',
        section: 'individual-init',
      },
    ], 9);
    outputPath = resolve(projectRoot, 'test-output8.html');

    const { spawn } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      const proc = spawn('node', ['generate-newsletter.mjs', `--output=${outputPath}`, `--db=${testDbPath}`], {
        cwd: projectRoot,
      });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    });

    const html = readFileSync(outputPath, 'utf-8');

    // Find positions of section headers
    const hotIdx = html.indexOf("This Week's Hot");
    const indivIdx = html.indexOf('Individual Initiative');
    const freshIdx = html.indexOf('Still Fresh');
    const linkIdx = html.indexOf('Helpful Links');

    ok(hotIdx > 0, 'should have whats-hot section');
    ok(indivIdx > 0, 'should have individual-init section');
    ok(freshIdx > 0, 'should have still-fresh section');
    ok(linkIdx > 0, 'should have helpful-links section');

    // Verify order: whats-hot < individual-init < still-fresh < helpful-links
    ok(hotIdx < indivIdx, 'whats-hot should come before individual-init');
    ok(indivIdx < freshIdx, 'individual-init should come before still-fresh');
    ok(freshIdx < linkIdx, 'still-fresh should come before helpful-links');

    cleanupDB(testDbPath);
    try { unlinkSync(outputPath); } catch { /* ignore */ }
  });
});
