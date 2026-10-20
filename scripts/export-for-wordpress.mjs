#!/usr/bin/env node
/**
 * export-for-wordpress.mjs — writes everything the Fort Weekly WordPress plugin needs as one
 * JSON file: entries (with dates, tags, status, flags and private submitter details), tags,
 * the Nan'tan note and the region lists (Three F's, SLT, links, shovel flags, VQs).
 *
 *   node scripts/export-for-wordpress.mjs --db data/news.db --out fort-weekly-export.json
 *
 * Read-only: the database file is opened read-only and copied into memory. An older database
 * that hasn't had the entries migration yet (lib/entries.js) is migrated in that in-memory copy
 * only, never on disk. The output contains submitter emails and phone numbers: keep it private
 * and delete it after importing.
 */

import Database from 'better-sqlite3';
import { writeFileSync } from 'fs';
import { migrateEntries, listEntries, listTags, getRegionSetting } from '../lib/entries.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dbPath = arg('db', process.env.DB_PATH || 'dev.db');
const outPath = arg('out', 'fort-weekly-export.json');

const source = new Database(dbPath, { readonly: true, fileMustExist: true });
const sqlite = new Database(source.serialize());
source.close();
migrateEntries(sqlite);

const rows = (sql) => {
  try { return sqlite.prepare(sql).all(); } catch { return []; } // Table missing on an older database.
};

const entries = listEntries(sqlite, { includeArchived: true }).map(e => ({
  legacy_id: e.id,
  title: e.title,
  slug: e.slug,
  leader: e.leader || null,
  location: e.location || null,
  description: e.description || '',
  summary: e.summary || null,
  link: e.link || null,
  video_url: e.video_url || null,
  hero_image: e.hero_image || null,
  preblast_url: e.preblast_url || null,
  featured: e.featured,
  hold_from_newsletter: e.hold_from_newsletter,
  preblast_requested: e.preblast_requested,
  status: e.status,
  archived: !!e.archived_at,
  approved_at: e.approved_at || null,
  reject_reason: e.reject_reason || null,
  origin: e.origin || null,
  created_at: e.created_at || null,
  submitter: { name: e.submitter_name || null, email: e.submitter_email || null, phone: e.submitter_phone || null },
  occurrences: e.occurrences,
  tags: e.tags.map(t => t.slug),
}));

const nantan = getRegionSetting(sqlite, 'nantan') || {};
const region = {
  nantan: { text: nantan.text || '', author: nantan.author || '', heading: nantan.heading || '', image: nantan.image || null },
  three_fs: rows('SELECT * FROM three_fs_items ORDER BY f_column, position').map(i => ({
    column: i.f_column, type: i.item_type === 'link' ? 'link' : 'event',
    name: i.name || '', detail: i.detail || '', label: i.link_label || '', url: i.link_url || '',
  })),
  slt: rows('SELECT * FROM slt_entries ORDER BY position').map(s => ({ role: s.role, name: s.name })),
  links: rows('SELECT * FROM helpful_links ORDER BY position').map(l => ({ label: l.label, name: l.name, url: l.url })),
  shovel_flags: rows('SELECT * FROM shovel_flags ORDER BY position').map(s => ({ from: s.from_name, to: s.to_name, ao: s.ao })),
  vqs: rows('SELECT * FROM vqs ORDER BY position').map(v => ({ name: v.name, ao: v.ao })),
};

const out = {
  format: 'fort-weekly-export',
  version: 1,
  exported_at: new Date().toISOString(),
  tags: listTags(sqlite).map(t => ({ label: t.label, slug: t.slug, color: t.color, position: t.position })),
  entries,
  region,
};
writeFileSync(outPath, JSON.stringify(out, null, 2), { mode: 0o600 });
sqlite.close();

const byStatus = entries.reduce((acc, e) => { const k = e.archived ? 'archived' : e.status; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
console.log(`Wrote ${outPath}: ${entries.length} entries ${JSON.stringify(byStatus)}, ${out.tags.length} tags, ` +
  `region: ${region.three_fs.length} Three F's items, ${region.slt.length} SLT, ${region.links.length} links, ` +
  `${region.shovel_flags.length} shovel flags, ${region.vqs.length} VQs, Nan'tan note ${region.nantan.text ? 'yes' : 'no'}.`);
