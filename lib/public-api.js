// Read-only public API for the f3thefort.com WordPress theme, plus the shared-secret
// submission endpoints it proxies its "Submit an event" form through.
//
// Only approved, unarchived entries are ever returned, and never submitter contact details.
// Unlike the newsletter, the site does show entries that are "held from the newsletter".

import { timingSafeEqual } from 'crypto';
import { listEntries, getEntryBySlug, getRegionSetting, listTags } from './entries.js';
import { selectAgenda } from './newsletter-agenda.js';
import { todayIsoDate } from './dates.js';

const PUBLIC_CACHE = 'public, max-age=60';

export function makeAbsolutizer(baseUrl) {
  const base = (baseUrl || '').replace(/\/$/, '');
  const abs = (url) => {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    return url.startsWith('/') ? base + url : url;
  };
  const rewrite = (html) => String(html || '').replace(/(src|href)="(\/uploads\/[^"]+)"/g, (_, attr, path) => `${attr}="${base}${path}"`);
  return { abs, rewrite };
}

/** The public shape of an entry: no submitter details, absolute image URLs, sanitized HTML. */
export function publicEntry(e, { abs, rewrite, sanitizeHtml, today }) {
  const next = e.next_occurrence;
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    leader: e.leader || null,
    location: e.location || null,
    summary: e.summary || null,
    description_html: rewrite(sanitizeHtml(e.description || '')),
    hero_image: abs(e.hero_image),
    link: e.link && /^https?:\/\//i.test(e.link) ? e.link : null,
    video_url: e.video_url && /^https?:\/\//i.test(e.video_url) ? e.video_url : null,
    preblast_url: e.preblast_url || null,
    featured: !!e.featured,
    tags: e.tags.map(t => ({ label: t.label, slug: t.slug, color: t.color })),
    occurrences: e.occurrences,
    next_occurrence: next || null,
    upcoming_dates: e.occurrences.filter(o => o.date >= today),
    is_past: e.occurrences.length > 0 && !next,
  };
}

function isPublic(e) {
  return e.status === 'approved' && !e.archived_at;
}

export function buildHome({ sqlite, region, today, ctx }) {
  const entries = listEntries(sqlite, { today }).filter(isPublic);
  // The site shows held entries; holding only affects the newsletter.
  const sel = selectAgenda(entries.map(e => ({ ...e, hold_from_newsletter: false })), today);
  const pub = (e) => publicEntry(e, { ...ctx, today });
  return {
    generated_at: new Date().toISOString(),
    today,
    range: sel.range,
    featured: sel.featured ? pub(sel.featured) : null,
    this_week: sel.thisWeek.map(d => ({ date: d.date, entries: d.entries.map(pub) })),
    coming_up: sel.comingUp.map(pub),
    ongoing: sel.ongoing.map(pub),
    tags: listTags(sqlite).filter(t => t.entry_count > 0).map(t => ({ label: t.label, slug: t.slug, color: t.color })),
    region,
  };
}

/** Region data for the site: everything public, with names only (no FNG contact details). */
export function buildRegion({ sqlite, statics, fngStats, weeklyFngs, ctx }) {
  const nantan = getRegionSetting(sqlite, 'nantan');
  return {
    nantan: nantan ? { text_html: ctx.rewrite(ctx.sanitizeHtml(nantan.text || '')), author: nantan.author || '', heading: nantan.heading || '', image: ctx.abs(nantan.image) } : null,
    fng_stats: fngStats ? { total: fngStats.total2026, goal: fngStats.goal, days_elapsed: fngStats.daysElapsed, year: fngStats.currentYear } : null,
    weekly_fngs: (weeklyFngs || []).map(f => f.f3_name).filter(Boolean),
    shovel_flags: (statics.shovelFlags || []).map(s => ({ from: s.from_name, to: s.to_name, ao: s.ao })),
    vqs: (statics.weeklyVqs || []).map(v => ({ name: v.name, ao: v.ao })),
    three_fs: ['fitness', 'fellowship', 'faith'].map(col => ({
      column: col,
      items: (statics.threeFsItems || []).filter(i => i.f_column === col).map(i => (i.item_type === 'link'
        ? { type: 'link', label: i.link_label, url: i.link_url }
        : { type: 'event', name: i.name, detail: i.detail })),
    })),
    slt: (statics.sltEntries || []).map(s => ({ role: s.role, name: s.name })),
    links: (statics.helpfulLinks || []).map(l => ({ label: l.label, name: l.name, url: l.url })),
  };
}

export function sharedSecretOk(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerPublicRoutes(app, { sqlite, sanitizeHtml, loadRegionInputs, createSubmission, upload, makeLimiter, windowMs, env = process.env }) {
  const ctx = () => ({ ...makeAbsolutizer(env.BASE_URL), sanitizeHtml });

  const regionNow = () => {
    const { statics, fngStats, weeklyFngs } = loadRegionInputs();
    return buildRegion({ sqlite, statics, fngStats, weeklyFngs, ctx: ctx() });
  };

  app.get('/api/public/home', (_req, res) => {
    try {
      res.set('Cache-Control', PUBLIC_CACHE);
      res.json(buildHome({ sqlite, region: regionNow(), today: todayIsoDate(), ctx: ctx() }));
    } catch (err) {
      console.error('GET /api/public/home error:', err.message);
      res.status(500).json({ error: 'Failed to load' });
    }
  });

  app.get('/api/public/region', (_req, res) => {
    try {
      res.set('Cache-Control', PUBLIC_CACHE);
      res.json(regionNow());
    } catch (err) {
      console.error('GET /api/public/region error:', err.message);
      res.status(500).json({ error: 'Failed to load' });
    }
  });

  app.get('/api/public/entries', (req, res) => {
    try {
      const today = todayIsoDate();
      const { tag, from, to, include_past } = req.query;
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
      let entries = listEntries(sqlite, { today }).filter(isPublic);
      if (include_past !== 'true') entries = entries.filter(e => e.lifecycle !== 'past');
      if (tag) entries = entries.filter(e => e.tags.some(t => t.slug === tag));
      if (from) entries = entries.filter(e => e.occurrences.some(o => o.date >= from));
      if (to) entries = entries.filter(e => e.occurrences.some(o => o.date <= to));
      res.set('Cache-Control', PUBLIC_CACHE);
      res.json({ today, items: entries.slice(0, limit).map(e => publicEntry(e, { ...ctx(), today })) });
    } catch (err) {
      console.error('GET /api/public/entries error:', err.message);
      res.status(500).json({ error: 'Failed to load' });
    }
  });

  app.get('/api/public/entries/:slug', (req, res) => {
    try {
      const today = todayIsoDate();
      const e = getEntryBySlug(sqlite, String(req.params.slug), today);
      if (!e || !isPublic(e)) return res.status(404).json({ error: 'Not found' });
      // Related: upcoming entries on the same day first, then ones sharing a tag.
      const others = listEntries(sqlite, { today }).filter(x => isPublic(x) && x.id !== e.id && x.next_occurrence);
      const sameDay = e.next_occurrence ? others.filter(x => x.next_occurrence.date === e.next_occurrence.date) : [];
      const tagIds = new Set(e.tags.map(t => t.id));
      const sameTag = others.filter(x => !sameDay.includes(x) && x.tags.some(t => tagIds.has(t.id)));
      const c = { ...ctx(), today };
      res.set('Cache-Control', PUBLIC_CACHE);
      res.json({ entry: publicEntry(e, c), same_day: sameDay.slice(0, 4).map(x => publicEntry(x, c)), related: sameTag.slice(0, 4).map(x => publicEntry(x, c)) });
    } catch (err) {
      console.error('GET /api/public/entries/:slug error:', err.message);
      res.status(500).json({ error: 'Failed to load' });
    }
  });

  // ── Submissions proxied by the WordPress theme ────────────────────
  const requireSharedSecret = (req, res, next) => {
    if (!env.FORT_SHARED_SECRET) return res.status(503).json({ error: 'Site submissions are not enabled on this server.' });
    if (!sharedSecretOk(req.get('X-Fort-Secret'), env.FORT_SHARED_SECRET)) return res.status(401).json({ error: 'Unauthorized' });
    next();
  };
  // After the secret check the forwarded visitor address can be trusted for rate limiting.
  const visitorKey = (req) => {
    const ip = req.get('X-Fort-Client-IP');
    return ip ? `wp:${ip.slice(0, 64)}` : null;
  };
  const submitLimiter = makeLimiter({ windowMs, max: 20, message: 'Too many submissions, please try again later.', keyFor: visitorKey });
  const uploadLimiter = makeLimiter({ windowMs, max: 40, message: 'Too many uploads, please try again later.', keyFor: visitorKey });

  app.post('/api/public/submissions', requireSharedSecret, submitLimiter, async (req, res) => {
    try {
      const { status, body } = await createSubmission(req.body, 'wordpress');
      // The site only needs to know it worked — don't echo the stored row back.
      res.status(status).json(status === 201 ? { success: true, id: body.id, status: 'pending' } : body);
    } catch (err) {
      console.error('POST /api/public/submissions error:', err.message);
      res.status(500).json({ error: 'Failed to create submission' });
    }
  });

  app.post('/api/public/upload', requireSharedSecret, uploadLimiter, (req, res) => {
    // Run multer here so its errors come back as JSON (the app-wide handler is registered
    // before these routes and wouldn't see them).
    upload.single('image')(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File too large. Maximum size is 5MB.' : (err.message || 'Upload failed');
        return res.status(400).json({ error: msg });
      }
      if (!req.file) return res.status(400).json({ error: 'No image provided' });
      res.json({ url: makeAbsolutizer(env.BASE_URL).abs(`/uploads/${req.file.filename}`) });
    });
  });
}
