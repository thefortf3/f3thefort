// Entries: the approval-aware, multi-date, tagged view of `submissions`.
//
// Everything here is additive on top of the original schema so the classic admin board and
// classic newsletter keep working: `section`, `start_date`, `start_time`, `end_time` and the
// `recurring_events` table are left in place and still readable.

import { todayIsoDate, isIsoDate } from './dates.js';

export const STATUSES = ['pending', 'approved', 'rejected'];

// ─── Migration ───────────────────────────────────────────────────────

function addColumn(sqlite, table, def) {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
  } catch (e) {
    if (!e.message.includes('duplicate column name')) throw e;
  }
}

/** One-time data steps run once per database, recorded in `schema_migrations`. */
function once(sqlite, name, fn) {
  if (sqlite.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name)) return;
  sqlite.transaction(() => {
    fn();
    sqlite.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
  })();
}

export function migrateEntries(sqlite) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    ran_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  for (const def of [
    'status TEXT',
    'slug TEXT',
    'summary TEXT',
    'featured INTEGER DEFAULT 0',
    'hold_from_newsletter INTEGER DEFAULT 0',
    'approved_at TEXT',
    'reject_reason TEXT',
    'updated_at TEXT',
    'preblast_requested INTEGER DEFAULT 0',
    'origin TEXT',
  ]) addColumn(sqlite, 'submissions', def);
  sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS submissions_slug_idx ON submissions (slug)');

  sqlite.exec(`CREATE TABLE IF NOT EXISTS occurrences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    position INTEGER DEFAULT 0
  )`);
  sqlite.exec('CREATE INDEX IF NOT EXISTS occurrences_submission_idx ON occurrences (submission_id)');
  sqlite.exec('CREATE INDEX IF NOT EXISTS occurrences_date_idx ON occurrences (date)');

  sqlite.exec(`CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    color TEXT,
    position INTEGER DEFAULT 0,
    legacy_section TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS submission_tags (
    submission_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (submission_id, tag_id)
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS region_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Existing rows: anything already sorted into a section was effectively approved; unsorted
  // rows are the classic "Incoming" queue, i.e. pending.
  once(sqlite, '2026-10-20-backfill-status', () => {
    sqlite.exec(`UPDATE submissions
      SET status = CASE WHEN section IS NOT NULL AND section != 'null' THEN 'approved' ELSE 'pending' END,
          approved_at = CASE WHEN section IS NOT NULL AND section != 'null' THEN created_at ELSE NULL END
      WHERE status IS NULL`);
  });

  once(sqlite, '2026-10-20-backfill-slugs', () => {
    const rows = sqlite.prepare('SELECT id, title FROM submissions WHERE slug IS NULL ORDER BY id').all();
    for (const r of rows) {
      sqlite.prepare('UPDATE submissions SET slug = ? WHERE id = ?').run(uniqueSlug(sqlite, r.title, r.id), r.id);
    }
  });

  once(sqlite, '2026-10-20-occurrences-from-start-date', () => {
    const rows = sqlite.prepare('SELECT id, start_date, start_time, end_time FROM submissions').all();
    const insert = sqlite.prepare('INSERT INTO occurrences (submission_id, date, start_time, end_time, position) VALUES (?,?,?,?,0)');
    for (const r of rows) {
      const occ = legacyToOccurrence(r.start_date, r.start_time, r.end_time);
      if (occ) insert.run(r.id, occ.date, occ.start_time, occ.end_time);
    }
  });

  once(sqlite, '2026-10-20-tags-from-sections', () => {
    const defaults = {
      'whats-hot': { label: "What's Hot", color: '#d4a03c' },
      'individual-init': { label: 'I2', color: '#8fb4d8' },
      'still-fresh': { label: 'Still Fresh', color: '#a3c290' },
    };
    let sections = [];
    try {
      sections = sqlite.prepare("SELECT id, label, position FROM sections WHERE id != 'desk' ORDER BY position").all();
    } catch { /* no sections table on a fresh DB */ }
    const insertTag = sqlite.prepare('INSERT OR IGNORE INTO tags (label, slug, color, position, legacy_section) VALUES (?,?,?,?,?)');
    sections.forEach((s, i) => {
      const d = defaults[s.id] || { label: s.label, color: '#9a9da5' };
      insertTag.run(d.label, slugify(d.label) || s.id, d.color, i, s.id);
    });
    insertTag.run('Weekly', 'weekly', '#9a9da5', sections.length, null);
    sqlite.exec(`INSERT OR IGNORE INTO submission_tags (submission_id, tag_id)
      SELECT s.id, t.id FROM submissions s JOIN tags t ON t.legacy_section = s.section`);
  });

  // The "Header" (desk) entry is the Nan'tan's message, not an event: copy the current one into
  // region settings. The desk row itself is left alone for the classic newsletter.
  once(sqlite, '2026-10-20-nantan-from-desk', () => {
    const desk = sqlite.prepare(`SELECT title, leader, description, hero_image FROM submissions
      WHERE section = 'desk' AND archived_at IS NULL ORDER BY id DESC LIMIT 1`).get();
    if (desk) {
      setRegionSetting(sqlite, 'nantan', {
        text: desk.description || '',
        author: desk.leader || '',
        heading: desk.title || '',
        image: desk.hero_image || '',
      });
    }
  });

  // Hand-entered Upcoming Events become ordinary approved entries (one entry per name+location,
  // one occurrence per row). The recurring_events table stays for the classic newsletter.
  once(sqlite, '2026-10-20-recurring-events-to-entries', () => {
    let rows = [];
    try {
      rows = sqlite.prepare(`SELECT * FROM recurring_events WHERE event_date IS NOT NULL
        ORDER BY event_date, position`).all();
    } catch { return; }
    const weekly = sqlite.prepare("SELECT id FROM tags WHERE slug = 'weekly'").get();
    const groups = new Map();
    for (const r of rows) {
      const key = `${(r.name || '').trim().toLowerCase()}|${(r.location || '').trim().toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const group of groups.values()) {
      const first = group[0];
      const blurb = group.map(r => r.blurb).find(Boolean) || '';
      const note = group.map(r => r.note).find(Boolean) || '';
      const link = group.map(r => r.link_url).find(Boolean) || null;
      const summary = [blurb, note].filter(Boolean).join(' — ') || null;
      const { lastInsertRowid: id } = sqlite.prepare(`INSERT INTO submissions
        (title, start_date, location, description, link, status, approved_at, summary, origin, slug)
        VALUES (?, '', ?, ?, ?, 'approved', CURRENT_TIMESTAMP, ?, 'recurring', ?)`)
        .run(first.name, first.location || null, summary ? `<p>${escapeHtml(summary)}</p>` : '<p></p>', link, summary, uniqueSlug(sqlite, first.name));
      group.forEach((r, i) => {
        sqlite.prepare('INSERT INTO occurrences (submission_id, date, start_time, position) VALUES (?,?,?,?)')
          .run(id, r.event_date, r.time || null, i);
      });
      if (weekly) sqlite.prepare('INSERT OR IGNORE INTO submission_tags (submission_id, tag_id) VALUES (?,?)').run(id, weekly.id);
    }
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function slugify(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** A slug for `title` not used by any other submission (`excludeId` may keep its own). */
export function uniqueSlug(sqlite, title, excludeId = null) {
  const base = slugify(title) || 'entry';
  const taken = sqlite.prepare('SELECT id FROM submissions WHERE slug = ?');
  let slug = base;
  for (let n = 2; ; n++) {
    const row = taken.get(slug);
    if (!row || row.id === excludeId) return slug;
    slug = `${base}-${n}`;
  }
}

/** Converts the legacy single-date columns into one occurrence (or null when undated). */
export function legacyToOccurrence(startDate, startTime, endTime) {
  if (!startDate) return null;
  const [datePart, isoTime] = String(startDate).split('T');
  if (!isIsoDate(datePart)) return null;
  const start_time = startTime || (isoTime ? isoTime.slice(0, 5).replace(':', '') : null);
  let end_time = endTime || null;
  if (end_time && end_time.includes('T')) end_time = end_time.split('T')[1].slice(0, 5);
  return { date: datePart, start_time: start_time || null, end_time };
}

/** Validates and normalises a list of occurrences from a request body. */
export function normalizeOccurrences(list) {
  if (!Array.isArray(list)) throw new Error('occurrences must be an array');
  const seen = new Set();
  const out = [];
  for (const o of list) {
    const date = typeof o?.date === 'string' ? o.date.trim() : '';
    if (!isIsoDate(date)) throw new Error(`Invalid occurrence date: ${o?.date}`);
    const start_time = (o.start_time || '').toString().trim().slice(0, 40) || null;
    const end_time = (o.end_time || '').toString().trim().slice(0, 40) || null;
    const key = `${date}|${start_time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date, start_time, end_time });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || ''));
}

export function setOccurrences(sqlite, submissionId, occurrences) {
  const occs = normalizeOccurrences(occurrences);
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM occurrences WHERE submission_id = ?').run(submissionId);
    const insert = sqlite.prepare('INSERT INTO occurrences (submission_id, date, start_time, end_time, position) VALUES (?,?,?,?,?)');
    occs.forEach((o, i) => insert.run(submissionId, o.date, o.start_time, o.end_time, i));
    // Keep the legacy columns pointing at the first date so the classic board/newsletter still show it.
    const first = occs[0];
    sqlite.prepare('UPDATE submissions SET start_date = ?, start_time = ?, end_time = ? WHERE id = ?')
      .run(first ? first.date : '', first ? first.start_time : null, first ? first.end_time : null, submissionId);
  })();
  return occs;
}

export function setTags(sqlite, submissionId, tagIds) {
  if (!Array.isArray(tagIds)) throw new Error('tags must be an array of tag ids');
  const ids = [...new Set(tagIds.map(Number).filter(Number.isInteger))];
  const known = new Set(sqlite.prepare('SELECT id FROM tags').all().map(r => r.id));
  const unknown = ids.filter(id => !known.has(id));
  if (unknown.length) throw new Error(`Unknown tag id(s): ${unknown.join(', ')}`);
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM submission_tags WHERE submission_id = ?').run(submissionId);
    const insert = sqlite.prepare('INSERT INTO submission_tags (submission_id, tag_id) VALUES (?,?)');
    ids.forEach(id => insert.run(submissionId, id));
  })();
}

/** The first occurrence on/after `today`, or null if every date has passed (or none exist). */
export function nextOccurrence(occurrences, today = todayIsoDate()) {
  return occurrences.find(o => o.date >= today) || null;
}

/**
 * Where an entry currently sits: 'pending' / 'rejected' / 'archived' for those states;
 * otherwise 'upcoming' (has a future date), 'ongoing' (no dates at all) or 'past'.
 */
export function lifecycle(entry, today = todayIsoDate()) {
  if (entry.archived_at) return 'archived';
  if (entry.status === 'pending' || entry.status === 'rejected') return entry.status;
  if (entry.occurrences.length === 0) return 'ongoing';
  return nextOccurrence(entry.occurrences, today) ? 'upcoming' : 'past';
}

export function getRegionSetting(sqlite, key) {
  const row = sqlite.prepare('SELECT value FROM region_settings WHERE key = ?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

export function setRegionSetting(sqlite, key, value) {
  sqlite.prepare(`INSERT INTO region_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
    .run(key, JSON.stringify(value));
}

// ─── Reads ───────────────────────────────────────────────────────────

function attach(sqlite, rows, today) {
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);
  const marks = ids.map(() => '?').join(',');
  const occs = sqlite.prepare(`SELECT submission_id, date, start_time, end_time FROM occurrences
    WHERE submission_id IN (${marks}) ORDER BY date, position`).all(...ids);
  const tags = sqlite.prepare(`SELECT st.submission_id, t.id, t.label, t.slug, t.color FROM submission_tags st
    JOIN tags t ON t.id = st.tag_id WHERE st.submission_id IN (${marks}) ORDER BY t.position, t.label`).all(...ids);
  const occBy = new Map(ids.map(id => [id, []]));
  const tagBy = new Map(ids.map(id => [id, []]));
  for (const o of occs) occBy.get(o.submission_id).push({ date: o.date, start_time: o.start_time, end_time: o.end_time });
  for (const t of tags) tagBy.get(t.submission_id).push({ id: t.id, label: t.label, slug: t.slug, color: t.color });
  return rows.map(r => {
    const entry = {
      ...r,
      status: r.status || 'pending',
      featured: !!r.featured,
      hold_from_newsletter: !!r.hold_from_newsletter,
      preblast_requested: !!r.preblast_requested,
      occurrences: occBy.get(r.id),
      tags: tagBy.get(r.id),
    };
    entry.next_occurrence = nextOccurrence(entry.occurrences, today);
    entry.lifecycle = lifecycle(entry, today);
    return entry;
  });
}

export function getEntry(sqlite, id, today = todayIsoDate()) {
  const row = sqlite.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
  return row ? attach(sqlite, [row], today)[0] : null;
}

export function getEntryBySlug(sqlite, slug, today = todayIsoDate()) {
  const row = sqlite.prepare('SELECT * FROM submissions WHERE slug = ?').get(slug);
  return row ? attach(sqlite, [row], today)[0] : null;
}

/** Sort key: next date first (soonest first), then undated, then past (most recent first). */
function compareEntries(a, b) {
  const an = a.next_occurrence?.date, bn = b.next_occurrence?.date;
  if (an && bn) return an.localeCompare(bn) || (a.next_occurrence.start_time || '').localeCompare(b.next_occurrence.start_time || '') || a.title.localeCompare(b.title);
  if (an) return -1;
  if (bn) return 1;
  const al = a.occurrences.at(-1)?.date, bl = b.occurrences.at(-1)?.date;
  if (!al && !bl) return a.title.localeCompare(b.title);
  if (!al) return -1;
  if (!bl) return 1;
  return bl.localeCompare(al);
}

/**
 * All entries (optionally including archived) with occurrences, tags, next_occurrence and
 * lifecycle attached, sorted by next occurrence. Excludes the classic "Header" desk rows.
 */
export function listEntries(sqlite, { includeArchived = false, today = todayIsoDate() } = {}) {
  const rows = sqlite.prepare(`SELECT * FROM submissions
    WHERE (section IS NULL OR section != 'desk') ${includeArchived ? '' : 'AND archived_at IS NULL'}`).all();
  return attach(sqlite, rows, today).sort(compareEntries);
}

export function listTags(sqlite) {
  return sqlite.prepare(`SELECT t.*, (SELECT COUNT(*) FROM submission_tags st WHERE st.tag_id = t.id) AS entry_count
    FROM tags t ORDER BY t.position, t.label`).all();
}
