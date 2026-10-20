import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateEntries, setOccurrences } from '../lib/entries.js';
import { buildHome, publicEntry, makeAbsolutizer, sharedSecretOk } from '../lib/public-api.js';

const TODAY = '2026-10-20';
const sanitizeHtml = (h) => String(h || '').replace(/<script[\s\S]*?<\/script>/gi, '');

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, leader TEXT,
    start_date TEXT NOT NULL DEFAULT '', start_time TEXT, end_time TEXT, location TEXT, description TEXT NOT NULL,
    link TEXT, hero_image TEXT, video_url TEXT, preblast_url TEXT, preblast_content TEXT, section TEXT,
    submitter_name TEXT, submitter_email TEXT, submitter_phone TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, archived_at TEXT)`);
  migrateEntries(d);
  const add = (title, status, date, extra = {}) => {
    const { lastInsertRowid: id } = d.prepare(`INSERT INTO submissions (title, description, status, slug, submitter_email, hold_from_newsletter, archived_at, hero_image)
      VALUES (?, ?, ?, ?, 'pax@example.com', ?, ?, ?)`).run(title, extra.description || '<p>Hi</p><script>x()</script>', status,
      title.toLowerCase().replace(/\W+/g, '-'), extra.hold ? 1 : 0, extra.archived || null, extra.hero || null);
    if (date) setOccurrences(d, id, [{ date }]);
    return id;
  };
  add('Approved soon', 'approved', '2026-10-22', { hero: '/uploads/flyer.png' });
  add('Held from email', 'approved', '2026-11-02', { hold: true });
  add('Pending one', 'pending', '2026-10-23');
  add('Rejected one', 'rejected', '2026-10-23');
  add('Archived one', 'approved', '2026-10-23', { archived: '2026-10-01' });
  add('Past one', 'approved', '2026-09-01');
  return d;
}

const ctx = { ...makeAbsolutizer('https://submit.f3thefort.com'), sanitizeHtml };

test('home: only approved, unarchived, current entries; held entries still shown on the site', () => {
  const home = buildHome({ sqlite: db(), region: {}, today: TODAY, ctx });
  const titles = [...home.this_week.flatMap(d => d.entries), ...home.coming_up, ...home.ongoing].map(e => e.title);
  assert.deepEqual(titles.sort(), ['Approved soon', 'Held from email']);
});

test('public entries never carry submitter details and use absolute, sanitized URLs/HTML', () => {
  const home = buildHome({ sqlite: db(), region: {}, today: TODAY, ctx });
  const e = home.this_week[0].entries[0];
  const json = JSON.stringify(e);
  assert.doesNotMatch(json, /pax@example\.com|submitter/);
  assert.equal(e.hero_image, 'https://submit.f3thefort.com/uploads/flyer.png');
  assert.doesNotMatch(e.description_html, /<script/);
  assert.deepEqual(Object.keys(e).sort(), ['description_html', 'featured', 'hero_image', 'id', 'is_past', 'leader', 'link', 'location',
    'next_occurrence', 'occurrences', 'preblast_url', 'slug', 'summary', 'tags', 'title', 'upcoming_dates', 'video_url'].sort());
});

test('publicEntry drops non-http links', () => {
  const e = publicEntry({ id: 1, slug: 'x', title: 'X', tags: [], occurrences: [], next_occurrence: null, link: 'javascript:alert(1)', video_url: 'ftp://v', description: '' },
    { ...ctx, today: TODAY });
  assert.equal(e.link, null);
  assert.equal(e.video_url, null);
});

test('absolutizer rewrites upload paths in HTML and leaves full URLs alone', () => {
  const { abs, rewrite } = makeAbsolutizer('https://submit.f3thefort.com/');
  assert.equal(abs('/uploads/a.png'), 'https://submit.f3thefort.com/uploads/a.png');
  assert.equal(abs('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png');
  assert.equal(rewrite('<img src="/uploads/a.png">'), '<img src="https://submit.f3thefort.com/uploads/a.png">');
});

test('shared secret: required, exact, and fails closed when unset', () => {
  assert.equal(sharedSecretOk('abc123', 'abc123'), true);
  assert.equal(sharedSecretOk('abc124', 'abc123'), false);
  assert.equal(sharedSecretOk('abc', 'abc123'), false);
  assert.equal(sharedSecretOk(undefined, 'abc123'), false);
  assert.equal(sharedSecretOk('anything', ''), false);
});
