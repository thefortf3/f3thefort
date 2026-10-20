#!/usr/bin/env node
/**
 * Unit tests for the newsletter generator (scripts/generate-newsletter.mjs).
 * Uses the Node.js built-in test runner.
 *
 * Run:  node --test tests/generate-newsletter.unit.js
 *
 * The generator reads a SQLite DB and the HTML template at public/newsletter-template.html,
 * then writes a fully-rendered newsletter. These tests spin up a throwaway DB with a complete
 * schema (the generator joins/queries several tables), run the generator as a child process
 * with BASE_URL set, and assert on the produced HTML.
 */

import { describe, it, after } from 'node:test';
import { ok } from 'node:assert/strict';
import { readFileSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Track temp files so a single after() hook can clean them all up even if a test throws.
const tempFiles = new Set();
function tempPath(name) {
  const p = resolve(projectRoot, name);
  tempFiles.add(p);
  return p;
}

after(() => {
  for (const f of tempFiles) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────

const SUBMISSION_DEFAULTS = {
  leader: '', start_date: '', end_time: '', location: '',
  description: '', link: '', section: null,
};

/**
 * Build a temporary DB with the full schema the generator expects and seed the standard
 * sections. `submissionsList` entries may specify any subset of submission columns.
 */
function createTestDB(submissionsList, suffix) {
  const dbPath = tempPath(`test-temp-${suffix}.db`);
  try { unlinkSync(dbPath); } catch { /* fresh start */ }
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL, leader TEXT, start_date TEXT NOT NULL, start_time TEXT, end_time TEXT,
      location TEXT, description TEXT NOT NULL, link TEXT, hero_image TEXT, video_url TEXT,
      preblast_url TEXT, preblast_content TEXT, section TEXT, position INTEGER DEFAULT 0, show_in_upcoming INTEGER DEFAULT 0,
      submitter_name TEXT, submitter_email TEXT, submitter_phone TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, archived_at TEXT
    );
    CREATE TABLE sections (id TEXT PRIMARY KEY, label TEXT NOT NULL, accent TEXT NOT NULL, position INTEGER DEFAULT 0);
    CREATE TABLE fngs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, first_name TEXT, last_name TEXT,
      email TEXT, f3_name TEXT, ehed_by TEXT, workout_q_f3_name TEXT, ao TEXT, phone_number TEXT, year INTEGER
    );
    CREATE TABLE three_fs_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, f_column TEXT, item_type TEXT, name TEXT,
      detail TEXT, link_url TEXT, link_label TEXT, position INTEGER DEFAULT 0
    );
    CREATE TABLE slt_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, name TEXT, position INTEGER DEFAULT 0);
    CREATE TABLE helpful_links (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT, name TEXT, url TEXT, position INTEGER DEFAULT 0);
    CREATE TABLE shovel_flags (id INTEGER PRIMARY KEY AUTOINCREMENT, from_name TEXT, to_name TEXT, ao TEXT, position INTEGER DEFAULT 0);
    CREATE TABLE vqs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, ao TEXT, position INTEGER DEFAULT 0);
    CREATE TABLE recurring_events (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT, time TEXT, name TEXT, location TEXT, note TEXT, blurb TEXT, link_url TEXT, event_date TEXT, position INTEGER DEFAULT 0);

    INSERT INTO sections (id, label, accent, position) VALUES
      ('desk',            'Header',                  '#6C3483', 0),
      ('whats-hot',       'What''s Hot in The Fort', '#8B2E2E', 1),
      ('individual-init', 'Individual Initiative',   '#3A7D5C', 2),
      ('still-fresh',     'Still Fresh',             '#D4A017', 3);
  `);

  const stmt = db.prepare(`
    INSERT INTO submissions (title, leader, start_date, end_time, location, description, link, section)
    VALUES (@title, @leader, @start_date, @end_time, @location, @description, @link, @section)
  `);
  for (const entry of submissionsList) {
    stmt.run({ ...SUBMISSION_DEFAULTS, ...entry });
  }

  db.close();
  return dbPath;
}

/** Run the generator child process against a DB and return the rendered HTML. */
function runGenerator(dbPath, suffix) {
  const outputPath = tempPath(`test-output-${suffix}.html`);
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(
      'node',
      ['scripts/generate-newsletter.mjs', `--output=${outputPath}`, `--db=${dbPath}`],
      { cwd: projectRoot, env: { ...process.env, BASE_URL: 'http://localhost:3000' } }
    );
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      if (code === 0) resolvePromise(readFileSync(outputPath, 'utf-8'));
      else reject(new Error(`generator exited ${code}: ${stderr}`));
    });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('generate-newsletter — document structure', () => {
  it('produces a complete HTML document with masthead and footer', async () => {
    const db = createTestDB([
      { title: 'Structure Test', start_date: '2026-05-23T09:00', description: '<p>Test</p>', section: 'whats-hot' },
    ], 'structure');
    const html = await runGenerator(db, 'structure');

    ok(html.startsWith('<!DOCTYPE html>'), 'starts with DOCTYPE');
    ok(html.includes('<html lang="en">'), 'has html lang attribute');
    ok(html.includes('<head>') && html.includes('<body>'), 'has head and body');
    ok(html.includes('</html>'), 'closes html tag');
    ok(html.includes('<style>'), 'has inline styles');
    ok(html.includes('<title>The Fort'), 'title filled from generator');
    ok(html.includes('THE FORT <span>WEEKLY</span>'), 'has masthead heading');
    ok(html.includes('Upcoming events for the region'), 'has masthead subtitle');
    ok(html.includes('class="footer"'), 'has footer');
    ok(html.includes('The Fort F3'), 'footer copyright');
    ok(html.includes('/ 226'), 'FNG tracker rendered');
  });

  it('loads the expected web fonts', async () => {
    const db = createTestDB([
      { title: 'Font Test', start_date: '2026-05-23T09:00', description: '<p>Test</p>', section: 'whats-hot' },
    ], 'fonts');
    const html = await runGenerator(db, 'fonts');

    ok(html.includes('Oswald'), 'loads Oswald');
    ok(html.includes('Source+Serif+4'), 'loads Source Serif 4');
    ok(html.includes('JetBrains+Mono'), 'loads JetBrains Mono');
  });
});

describe('generate-newsletter — content rendering', () => {
  it('renders submissions grouped under their section with the right card types', async () => {
    const db = createTestDB([
      { title: 'Hot Event', leader: 'L1', start_date: '2026-05-23T06:30', end_time: '2026-05-23T08:00', location: 'Park A', description: '<p>Hot desc</p>', section: 'whats-hot' },
      { title: 'Indiv Event', leader: 'L3', start_date: '2026-07-01T10:00', location: 'Park C', description: '<p>Indiv</p>', section: 'individual-init' },
      { title: 'Fresh Event', leader: 'L2', start_date: '2026-06-01T10:00', location: 'Park B', description: '<p>Fresh</p>', section: 'still-fresh' },
    ], 'content');
    const html = await runGenerator(db, 'content');

    // Section labels
    ok(html.includes("What's Hot"), 'whats-hot section label');
    ok(html.includes('Individual Initiative'), 'individual-init section label');
    ok(html.includes('Still Fresh'), 'still-fresh section label');

    // Entries and leaders
    ok(html.includes('Hot Event') && html.includes('Indiv Event') && html.includes('Fresh Event'), 'all titles rendered');
    ok(html.includes('Q: L1'), 'leader rendered');

    // Card type per section
    ok(html.includes('class="event-card"'), 'whats-hot uses event card');
    ok(html.includes('class="initiative-entry"'), 'individual-init uses initiative entry');
    ok(html.includes('class="fresh-card"'), 'still-fresh uses fresh card');

    // Meta
    ok(html.includes('📌') && html.includes('Park A'), 'location rendered');
    ok(html.includes('📅'), 'date icon rendered');
  });

  it('formats dates without producing Invalid/NaN', async () => {
    const db = createTestDB([
      { title: 'Date Test', start_date: '2026-05-23T06:30', end_time: '2026-05-23T08:00', location: 'X', description: '<p>d</p>', section: 'whats-hot' },
    ], 'dates');
    const html = await runGenerator(db, 'dates');

    ok(html.includes('Sat, May 23'), 'formats weekday and month');
    ok(html.includes('0630') && html.includes('0800'), 'formats start and end time');
    ok(!html.includes('Invalid'), 'no "Invalid"');
    ok(!html.includes('NaN'), 'no "NaN"');
  });

  it('renders an empty database without sections', async () => {
    const db = createTestDB([], 'empty');
    const html = await runGenerator(db, 'empty');

    ok(html.includes('<title>The Fort'), 'still a valid document');
    ok(html.includes('/ 226'), 'tracker still present');
    // The dynamic section wrapper is only emitted when a section has entries (the bare
    // label text also appears in a static CSS comment, so match the rendered wrapper).
    ok(!html.includes('section section--whats-hot'), 'no dynamic section header when there are no entries');
  });
});

describe('generate-newsletter — XSS handling', () => {
  it('escapes HTML in titles', async () => {
    const db = createTestDB([
      { title: '<script>alert("xss")</script>Bad Title', start_date: '2026-05-23T09:00', description: '<p>ok</p>', section: 'whats-hot' },
    ], 'title-escape');
    const html = await runGenerator(db, 'title-escape');

    ok(!html.includes('<script>alert("xss")'), 'raw script not present');
    ok(html.includes('&lt;script&gt;'), 'title escaped to entities');
  });

  it('strips script/event-handler markup from descriptions', async () => {
    const db = createTestDB([
      { title: 'Desc XSS', start_date: '2026-05-23T09:00', description: '<p>safe</p><script>alert(1)</script><img src=x onerror=alert(2)>', section: 'whats-hot' },
    ], 'desc-sanitize');
    const html = await runGenerator(db, 'desc-sanitize');

    ok(html.includes('<p>safe</p>'), 'safe markup preserved');
    ok(!html.includes('<script>alert(1)'), 'script element removed');
    ok(!html.includes('onerror'), 'event handler attribute removed');
  });
});

describe('generate-newsletter — section ordering', () => {
  it('renders sections in their configured order regardless of insert order', async () => {
    const db = createTestDB([
      { title: 'Fresh Event', leader: 'L2', start_date: '2026-06-01T10:00', description: '<p>Fresh</p>', section: 'still-fresh' },
      { title: 'Indiv Event', leader: 'L3', start_date: '2026-07-01T10:00', description: '<p>Indiv</p>', section: 'individual-init' },
      { title: 'Hot Event', leader: 'L1', start_date: '2026-05-20T09:00', description: '<p>Hot</p>', section: 'whats-hot' },
    ], 'ordering');
    const html = await runGenerator(db, 'ordering');

    const hotIdx = html.indexOf("What's Hot");
    const indivIdx = html.indexOf('Individual Initiative');
    const freshIdx = html.indexOf('Still Fresh');

    ok(hotIdx > 0 && indivIdx > 0 && freshIdx > 0, 'all three sections present');
    ok(hotIdx < indivIdx, 'whats-hot before individual-init');
    ok(indivIdx < freshIdx, 'individual-init before still-fresh');
  });
});
