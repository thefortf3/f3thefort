import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  migrateEntries, listEntries, getEntry, setOccurrences, setTags, normalizeOccurrences,
  legacyToOccurrence, slugify, uniqueSlug, nextOccurrence, getRegionSetting,
} from '../lib/entries.js';
import { buildSubmissionMessage, notifySubmission } from '../lib/slack.js';

const TODAY = '2026-10-20';

/** A database shaped like production before the entries migration. */
function legacyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, leader TEXT, start_date TEXT NOT NULL DEFAULT '',
      start_time TEXT, end_time TEXT, location TEXT, description TEXT NOT NULL, link TEXT, hero_image TEXT,
      video_url TEXT, preblast_url TEXT, preblast_content TEXT, section TEXT, position INTEGER DEFAULT 0,
      show_in_upcoming INTEGER DEFAULT 0, submitter_name TEXT, submitter_email TEXT, submitter_phone TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, archived_at TEXT
    );
    CREATE TABLE sections (id TEXT PRIMARY KEY, label TEXT NOT NULL, accent TEXT NOT NULL, position INTEGER DEFAULT 0);
    INSERT INTO sections VALUES ('desk','Header','#6C3483',0), ('whats-hot','What''s Hot in The Fort','#8B2E2E',1),
      ('individual-init','Individual Initiative','#3A7D5C',2), ('still-fresh','Still Fresh','#D4A017',3);
    CREATE TABLE recurring_events (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, time TEXT, name TEXT NOT NULL,
      location TEXT, note TEXT, blurb TEXT, link_url TEXT, event_date TEXT, position INTEGER DEFAULT 0);
  `);
  const ins = db.prepare(`INSERT INTO submissions (title, leader, start_date, start_time, end_time, location, description, section, archived_at)
    VALUES (@title, @leader, @start_date, @start_time, @end_time, @location, @description, @section, @archived_at)`);
  const base = { leader: null, start_time: null, end_time: null, location: null, description: '<p>x</p>', section: null, archived_at: null };
  ins.run({ ...base, title: 'Q School - It\'s Back', start_date: '2026-10-20', start_time: '0515', section: 'whats-hot' });
  ins.run({ ...base, title: 'Ruck and Roll', start_date: '2026-10-24T09:15', section: 'individual-init', end_time: '2026-10-24T10:30' });
  ins.run({ ...base, title: 'La Grama', start_date: '', start_time: 'Weekly / As Needed', section: 'whats-hot' });
  ins.run({ ...base, title: 'Brand new idea', start_date: '2026-11-02' });
  ins.run({ ...base, title: 'Desk of the Nan\'tan', leader: 'Band Camp', start_date: '', description: '<p>What freedom…</p>', section: 'desk' });
  ins.run({ ...base, title: 'Old archived', start_date: '2026-05-01', section: 'still-fresh', archived_at: '2026-06-01' });
  const re = db.prepare('INSERT INTO recurring_events (day, time, name, location, blurb, event_date, position) VALUES (?,?,?,?,?,?,?)');
  re.run('Sat', '0730', 'Coffeteria — East', 'Humble Cup', 'Coffee after the workout.', '2026-10-24', 0);
  re.run('Sat', '0730', 'Coffeteria — East', 'Humble Cup', null, '2026-10-31', 1);
  re.run('Wed', '0630', 'The Testament', 'Waffle House', null, '2026-10-21', 2);
  re.run('Mon', null, 'Old shape row', null, null, null, 3);
  return db;
}

test('backfills status: sectioned rows approved, unsorted rows pending', () => {
  const db = legacyDb();
  migrateEntries(db);
  const byTitle = Object.fromEntries(db.prepare('SELECT title, status FROM submissions').all().map(r => [r.title, r.status]));
  assert.equal(byTitle["Q School - It's Back"], 'approved');
  assert.equal(byTitle['La Grama'], 'approved');
  assert.equal(byTitle['Brand new idea'], 'pending');
});

test('legacy dates become occurrences, including ISO start_date and end_time', () => {
  const db = legacyDb();
  migrateEntries(db);
  const ruck = listEntries(db, { today: TODAY }).find(e => e.title === 'Ruck and Roll');
  assert.deepEqual(ruck.occurrences, [{ date: '2026-10-24', start_time: '0915', end_time: '10:30' }]);
  const grama = listEntries(db, { today: TODAY }).find(e => e.title === 'La Grama');
  assert.deepEqual(grama.occurrences, []);
  assert.equal(grama.lifecycle, 'ongoing');
});

test('sections become tags (I2 label for Individual Initiative) plus a Weekly tag', () => {
  const db = legacyDb();
  migrateEntries(db);
  const tags = db.prepare('SELECT label, slug, legacy_section FROM tags ORDER BY position').all();
  assert.deepEqual(tags.map(t => t.label), ["What's Hot", 'I2', 'Still Fresh', 'Weekly']);
  const ruck = listEntries(db, { today: TODAY }).find(e => e.title === 'Ruck and Roll');
  assert.deepEqual(ruck.tags.map(t => t.label), ['I2']);
});

test("the desk entry becomes the Nan'tan setting and is excluded from the entries list", () => {
  const db = legacyDb();
  migrateEntries(db);
  assert.deepEqual(getRegionSetting(db, 'nantan'), { text: '<p>What freedom…</p>', author: 'Band Camp', heading: "Desk of the Nan'tan", image: '' });
  assert.ok(!listEntries(db, { today: TODAY }).some(e => e.title.startsWith('Desk')));
});

test('recurring events are grouped into one approved Weekly entry per name + location', () => {
  const db = legacyDb();
  migrateEntries(db);
  const entries = listEntries(db, { today: TODAY });
  const coffee = entries.filter(e => e.title === 'Coffeteria — East');
  assert.equal(coffee.length, 1);
  assert.equal(coffee[0].status, 'approved');
  assert.equal(coffee[0].origin, 'recurring');
  assert.deepEqual(coffee[0].occurrences.map(o => o.date), ['2026-10-24', '2026-10-31']);
  assert.equal(coffee[0].summary, 'Coffee after the workout.');
  assert.deepEqual(coffee[0].tags.map(t => t.slug), ['weekly']);
  assert.ok(!entries.some(e => e.title === 'Old shape row'), 'rows without a date are skipped');
});

test('migration is idempotent — running it again changes nothing', () => {
  const db = legacyDb();
  migrateEntries(db);
  const snapshot = () => ({
    subs: db.prepare('SELECT COUNT(*) c FROM submissions').get().c,
    occs: db.prepare('SELECT COUNT(*) c FROM occurrences').get().c,
    tags: db.prepare('SELECT COUNT(*) c FROM tags').get().c,
    links: db.prepare('SELECT COUNT(*) c FROM submission_tags').get().c,
  });
  const before = snapshot();
  migrateEntries(db);
  assert.deepEqual(snapshot(), before);
});

test('legacy columns are left intact for the classic board and newsletter', () => {
  const db = legacyDb();
  migrateEntries(db);
  const row = db.prepare("SELECT section, start_date, start_time FROM submissions WHERE title = 'Ruck and Roll'").get();
  assert.deepEqual(row, { section: 'individual-init', start_date: '2026-10-24T09:15', start_time: null });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM recurring_events').get().c, 4);
});

test('entries sort by next occurrence, then ongoing, then past (most recent first)', () => {
  const db = legacyDb();
  migrateEntries(db);
  const order = listEntries(db, { today: TODAY, includeArchived: true }).map(e => e.title);
  // Same-day entries sort by start time: Coffeteria (0730) before Ruck and Roll (0915) on Oct 24.
  assert.deepEqual(order.slice(0, 5), ["Q School - It's Back", 'The Testament', 'Coffeteria — East', 'Ruck and Roll', 'Brand new idea']);
  assert.equal(order.at(-1), 'Old archived');
});

test('setOccurrences validates, de-dupes, sorts, and mirrors the first date into legacy columns', () => {
  const db = legacyDb();
  migrateEntries(db);
  const id = db.prepare("SELECT id FROM submissions WHERE title = 'Brand new idea'").get().id;
  setOccurrences(db, id, [{ date: '2026-12-03', start_time: '1730' }, { date: '2026-11-05', start_time: '1730' }, { date: '2026-11-05', start_time: '1730' }]);
  const e = getEntry(db, id, TODAY);
  assert.deepEqual(e.occurrences.map(o => o.date), ['2026-11-05', '2026-12-03']);
  assert.equal(e.start_date, '2026-11-05');
  assert.throws(() => normalizeOccurrences([{ date: '2026-02-30' }]), /Invalid occurrence date/);
});

test('setTags rejects unknown tag ids', () => {
  const db = legacyDb();
  migrateEntries(db);
  assert.throws(() => setTags(db, 1, [9999]), /Unknown tag/);
});

test('lifecycle and next occurrence', () => {
  assert.deepEqual(nextOccurrence([{ date: '2026-10-01' }, { date: '2026-10-25' }], TODAY), { date: '2026-10-25' });
  assert.equal(nextOccurrence([{ date: '2026-10-01' }], TODAY), null);
  assert.deepEqual(legacyToOccurrence('', 'Weekly'), null);
  assert.deepEqual(legacyToOccurrence('2026-10-20', '0515', '06:00'), { date: '2026-10-20', start_time: '0515', end_time: '06:00' });
});

test('slugs are readable and unique', () => {
  const db = legacyDb();
  migrateEntries(db);
  assert.equal(slugify("Q School - It's Back"), 'q-school-its-back');
  assert.equal(slugify('Dads & 2.0’s'), 'dads-and-2-0s');
  const slugs = db.prepare('SELECT slug FROM submissions').all().map(r => r.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(uniqueSlug(db, 'Ruck and Roll'), 'ruck-and-roll-2');
});

test('Slack: dry-run without config; failures never throw', async () => {
  const entry = { id: 7, title: 'Beers for Beetus', occurrences: [{ date: '2026-10-24', start_time: '1100' }], location: 'Print Shop', submitter_name: 'Slash' };
  const msg = buildSubmissionMessage(entry, 'http://localhost:3000');
  assert.match(JSON.stringify(msg), /admin#entry-7/);
  assert.match(JSON.stringify(msg), /Sat, Oct 24 1100/);
  assert.deepEqual(await notifySubmission(entry, { env: {} }), { sent: false, dryRun: true });
  const boom = async () => { throw new Error('network down'); };
  const r = await notifySubmission(entry, { env: { SLACK_BOT_TOKEN: 'x', SLACK_APPROVAL_CHANNEL: 'C1' }, fetchImpl: boom });
  assert.equal(r.sent, false);
  assert.match(r.error, /network down/);
});
