// Admin API for the entries list: approval, multi-date occurrences, tags, featured/hold flags,
// and the Nan'tan message. Mounted alongside the classic /api/submissions routes, which keep
// working unchanged for /admin/classic.

import {
  getEntry, listEntries, listTags, setOccurrences, setTags, uniqueSlug, slugify,
  getRegionSetting, setRegionSetting,
} from './entries.js';

function stripTags(s) {
  return String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

const HTTP_URL = /^https?:\/\/\S+$/i;

/**
 * Tells the WordPress theme to drop its cached copy of the public API so an approval or edit
 * shows on the site right away. Does nothing unless SITE_FLUSH_URL and FORT_SHARED_SECRET are
 * set (they aren't locally), and never throws.
 */
export function flushSiteCache(env = process.env) {
  if (!env.SITE_FLUSH_URL || !env.FORT_SHARED_SECRET) return;
  fetch(env.SITE_FLUSH_URL, { method: 'POST', headers: { 'X-Fort-Secret': env.FORT_SHARED_SECRET } })
    .catch(err => console.error('Site cache flush failed:', err.message));
}

export function registerEntryRoutes(app, { sqlite, requireAuth, logAudit, postPreblast, sanitizeHtml }) {
  const parseId = (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid ID' }); return null; }
    return id;
  };
  const touch = (id) => sqlite.prepare('UPDATE submissions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);

  // ── Entries ──────────────────────────────────────────────────────
  app.get('/api/entries', requireAuth, (req, res) => {
    try {
      res.json({ items: listEntries(sqlite, { includeArchived: req.query.archived === 'true' }) });
    } catch (err) {
      console.error('GET /api/entries error:', err.message);
      res.status(500).json({ error: 'Failed to load entries' });
    }
  });

  app.get('/api/entries/:id', requireAuth, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    const entry = getEntry(sqlite, id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json(entry);
  });

  // Admin-created entries skip the approval queue.
  app.post('/api/entries', requireAuth, (req, res) => {
    try {
      const title = stripTags(req.body.title);
      if (!title) return res.status(400).json({ error: 'Title is required' });
      const { lastInsertRowid: id } = sqlite.prepare(`INSERT INTO submissions
        (title, start_date, description, status, approved_at, origin, slug, updated_at)
        VALUES (?, '', ?, 'approved', CURRENT_TIMESTAMP, 'admin', ?, CURRENT_TIMESTAMP)`)
        .run(title, sanitizeHtml(req.body.description || '<p></p>'), uniqueSlug(sqlite, title));
      logAudit(id, 'created', title, { by: 'admin' });
      res.status(201).json(getEntry(sqlite, id));
    } catch (err) {
      console.error('POST /api/entries error:', err.message);
      res.status(500).json({ error: 'Failed to create entry' });
    }
  });

  app.patch('/api/entries/:id', requireAuth, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    const existing = getEntry(sqlite, id);
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    const b = req.body || {};
    try {
      const cols = {};
      if (b.title !== undefined) {
        cols.title = stripTags(b.title);
        if (!cols.title) return res.status(400).json({ error: 'Title cannot be empty' });
      }
      for (const f of ['leader', 'location']) if (b[f] !== undefined) cols[f] = stripTags(b[f]) || null;
      if (b.summary !== undefined) cols.summary = stripTags(b.summary) || null;
      if (b.description !== undefined) cols.description = sanitizeHtml(b.description || '');
      for (const f of ['link', 'video_url']) {
        if (b[f] !== undefined) {
          const v = (b[f] || '').trim();
          if (v && !HTTP_URL.test(v)) return res.status(400).json({ error: `${f} must start with http:// or https://` });
          cols[f] = v || null;
        }
      }
      if (b.hero_image !== undefined) cols.hero_image = b.hero_image || null;
      if (b.hold_from_newsletter !== undefined) cols.hold_from_newsletter = b.hold_from_newsletter ? 1 : 0;
      if (b.featured !== undefined) cols.featured = b.featured ? 1 : 0;
      if (b.slug !== undefined) {
        const s = slugify(b.slug);
        if (!s) return res.status(400).json({ error: 'Slug cannot be empty' });
        if (sqlite.prepare('SELECT id FROM submissions WHERE slug = ? AND id != ?').get(s, id)) {
          return res.status(400).json({ error: 'That slug is already used by another entry' });
        }
        cols.slug = s;
      }

      sqlite.transaction(() => {
        // Only one featured entry at a time.
        if (cols.featured === 1) sqlite.prepare('UPDATE submissions SET featured = 0 WHERE id != ?').run(id);
        const keys = Object.keys(cols);
        if (keys.length) {
          sqlite.prepare(`UPDATE submissions SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`)
            .run(...keys.map(k => cols[k]), id);
        }
        if (b.occurrences !== undefined) setOccurrences(sqlite, id, b.occurrences);
        if (b.tags !== undefined) setTags(sqlite, id, b.tags);
        touch(id);
      })();

      const changed = [...Object.keys(cols), ...(b.occurrences !== undefined ? ['occurrences'] : []), ...(b.tags !== undefined ? ['tags'] : [])];
      if (changed.length) logAudit(id, 'updated', cols.title || existing.title, { fields: changed });
      if (existing.status === 'approved') flushSiteCache();
      res.json(getEntry(sqlite, id));
    } catch (err) {
      // setOccurrences / setTags throw plain Errors for bad input
      if (/occurrence|tag/i.test(err.message)) return res.status(400).json({ error: err.message });
      console.error('PATCH /api/entries/:id error:', err.message);
      res.status(500).json({ error: 'Failed to update entry' });
    }
  });

  app.post('/api/entries/:id/approve', requireAuth, async (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    const entry = getEntry(sqlite, id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    sqlite.prepare(`UPDATE submissions SET status = 'approved', approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP),
      reject_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    logAudit(id, 'approved', entry.title);

    // The pre-blast goes to WordPress only once the entry is approved — and only when posting is
    // explicitly switched on (it's off for local/dev runs).
    let warning = null;
    if (entry.preblast_requested && entry.preblast_content && !entry.preblast_url) {
      if (process.env.PREBLAST_POSTING === 'on') {
        try {
          const first = entry.occurrences[0];
          const url = await postPreblast(entry.title, entry.preblast_content, entry.leader, entry.location, first?.date || '', entry.link);
          sqlite.prepare('UPDATE submissions SET preblast_url = ? WHERE id = ?').run(url, id);
        } catch (err) {
          console.error('WordPress preblast post failed:', err.message);
          warning = `Approved, but the pre-blast could not be posted to WordPress: ${err.message}`;
        }
      } else {
        warning = 'Approved. Pre-blast posting is turned off here, so it was not sent to WordPress.';
      }
    }
    flushSiteCache();
    res.json({ ...getEntry(sqlite, id), warning });
  });

  app.post('/api/entries/:id/reject', requireAuth, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    const entry = getEntry(sqlite, id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    const reason = stripTags(req.body?.reason).slice(0, 500) || null;
    sqlite.prepare(`UPDATE submissions SET status = 'rejected', reject_reason = ?, featured = 0,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(reason, id);
    logAudit(id, 'rejected', entry.title, reason ? { reason } : null);
    if (entry.status === 'approved') flushSiteCache();
    res.json(getEntry(sqlite, id));
  });

  // Back to the approval queue (e.g. approved by mistake).
  app.post('/api/entries/:id/unapprove', requireAuth, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    const entry = getEntry(sqlite, id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    sqlite.prepare(`UPDATE submissions SET status = 'pending', featured = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    logAudit(id, 'unapproved', entry.title);
    flushSiteCache();
    res.json(getEntry(sqlite, id));
  });

  // ── Tags ─────────────────────────────────────────────────────────
  app.get('/api/tags', requireAuth, (_req, res) => res.json(listTags(sqlite)));

  app.post('/api/tags', requireAuth, (req, res) => {
    const label = stripTags(req.body?.label).slice(0, 40);
    if (!label) return res.status(400).json({ error: 'Label is required' });
    const slug = slugify(label);
    if (!slug) return res.status(400).json({ error: 'Label needs at least one letter or number' });
    if (sqlite.prepare('SELECT id FROM tags WHERE slug = ?').get(slug)) return res.status(400).json({ error: 'A tag with that name already exists' });
    const color = /^#[0-9a-f]{6}$/i.test(req.body?.color || '') ? req.body.color : '#9a9da5';
    const pos = sqlite.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tags').get().p;
    const { lastInsertRowid } = sqlite.prepare('INSERT INTO tags (label, slug, color, position) VALUES (?,?,?,?)').run(label, slug, color, pos);
    res.status(201).json(listTags(sqlite).find(t => t.id === Number(lastInsertRowid)));
  });

  app.patch('/api/tags/:id', requireAuth, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    const tag = sqlite.prepare('SELECT * FROM tags WHERE id = ?').get(id);
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    if (req.body?.label !== undefined) {
      const label = stripTags(req.body.label).slice(0, 40);
      const slug = slugify(label);
      if (!label || !slug) return res.status(400).json({ error: 'Label is required' });
      if (sqlite.prepare('SELECT id FROM tags WHERE slug = ? AND id != ?').get(slug, id)) return res.status(400).json({ error: 'A tag with that name already exists' });
      sqlite.prepare('UPDATE tags SET label = ?, slug = ? WHERE id = ?').run(label, slug, id);
    }
    if (req.body?.color !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(req.body.color)) return res.status(400).json({ error: 'Color must be a hex value like #8fb4d8' });
      sqlite.prepare('UPDATE tags SET color = ? WHERE id = ?').run(req.body.color, id);
    }
    flushSiteCache();
    res.json(listTags(sqlite).find(t => t.id === id));
  });

  app.delete('/api/tags/:id', requireAuth, (req, res) => {
    const id = parseId(req, res); if (id === null) return;
    if (!sqlite.prepare('SELECT id FROM tags WHERE id = ?').get(id)) return res.status(404).json({ error: 'Tag not found' });
    sqlite.transaction(() => {
      sqlite.prepare('DELETE FROM submission_tags WHERE tag_id = ?').run(id);
      sqlite.prepare('DELETE FROM tags WHERE id = ?').run(id);
    })();
    flushSiteCache();
    res.json({ success: true });
  });

  app.post('/api/tags/reorder', requireAuth, (req, res) => {
    const { order } = req.body || {};
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of tag ids' });
    const update = sqlite.prepare('UPDATE tags SET position = ? WHERE id = ?');
    sqlite.transaction(() => order.forEach((tid, pos) => update.run(pos, tid)))();
    res.json(listTags(sqlite));
  });

  // ── Region: Nan'tan message ──────────────────────────────────────
  app.get('/api/region/nantan', requireAuth, (_req, res) => {
    res.json(getRegionSetting(sqlite, 'nantan') || { text: '', author: '', heading: '', image: '' });
  });

  app.put('/api/region/nantan', requireAuth, (req, res) => {
    const b = req.body || {};
    const value = {
      text: sanitizeHtml(b.text || ''),
      author: stripTags(b.author).slice(0, 80),
      heading: stripTags(b.heading).slice(0, 120),
      image: typeof b.image === 'string' ? b.image : '',
    };
    setRegionSetting(sqlite, 'nantan', value);
    flushSiteCache();
    res.json(value);
  });
}
