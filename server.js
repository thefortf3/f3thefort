import 'dotenv/config';
import express from 'express';
import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, desc, count, isNull, isNotNull, like, or, and, sql as drizzleSql } from 'drizzle-orm';
import { submissions, fngs, newsletter_sends, audit_log, sections, three_fs_items, slt_entries, helpful_links, shovel_flags, vqs } from './schema.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { getCampaignStatusForDate, upsertScheduledCampaign, getNextSundayDateStr } from './lib/mailchimp.js';
import { JSDOM } from 'jsdom';
import { postPreblast } from './lib/wordpress.js';
import multer from 'multer';
import juice from 'juice';
import * as cheerio from 'cheerio';
import { importFngs } from './scripts/import-fngs.mjs';
import { generateNewsletter } from './scripts/generate-newsletter.mjs';
import { sanitizeHtml } from './lib/sanitize-html.js';
import { rateLimit } from './lib/rate-limit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Behind the nginx reverse proxy in production: trust the first hop so req.ip reflects
// the real client (via X-Forwarded-For) for rate limiting rather than the proxy address.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Fail fast rather than fall back to a guessable default password — an unset
// ADMIN_PASSWORD in production would otherwise leave the admin dashboard wide open.
if (!ADMIN_PASSWORD) {
  console.error('FATAL: ADMIN_PASSWORD is not set. Refusing to start without an admin password.');
  process.exit(1);
}

// Middleware
// Default body-parser limit is 100kb, which a description carrying an inlined base64 image
// blows past — the request then dies with a 413 before any route or sanitizer runs. Images
// belong in /uploads (the editor inserts them as URLs), so 1mb is generous headroom for rich
// text while still bounding what an unauthenticated endpoint can buffer.
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, _res, next) => {
  req.cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').flatMap(part => {
      const [k, ...v] = part.trim().split('=');
      return k ? [[k.trim(), decodeURIComponent(v.join('='))]] : [];
    })
  );
  next();
});

// Database setup
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'dev.db');
const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite);

// Bootstrap: create tables if they don't exist (safe on existing DBs)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    leader TEXT,
    start_date TEXT NOT NULL,
    end_time TEXT,
    location TEXT,
    description TEXT NOT NULL,
    link TEXT,
    hero_image TEXT,
    section TEXT,
    submitter_name TEXT,
    submitter_email TEXT,
    submitter_phone TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    archived_at TEXT
  );
  CREATE TABLE IF NOT EXISTS newsletter_sends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT,
    subject TEXT,
    from_name TEXT,
    from_email TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    recipient_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS fngs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    f3_name TEXT,
    ehed_by TEXT,
    workout_q_f3_name TEXT,
    ao TEXT,
    phone_number TEXT,
    year INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Idempotent migration: add archived_at to existing DBs that predate the column
try {
  sqlite.exec(`ALTER TABLE submissions ADD COLUMN archived_at TEXT`);
} catch (e) {
  if (!e.message.includes('duplicate column name')) throw e;
}

// Idempotent migration: add position column to submissions
try {
  sqlite.exec(`ALTER TABLE submissions ADD COLUMN position INTEGER DEFAULT 0`);
} catch (e) {
  if (!e.message.includes('duplicate column name')) throw e;
}

// Idempotent migration: add video_url column to submissions
try {
  sqlite.exec(`ALTER TABLE submissions ADD COLUMN video_url TEXT`);
} catch (e) {
  if (!e.message.includes('duplicate column name')) throw e;
}

// Idempotent migration: add preblast columns to submissions
try {
  sqlite.exec(`ALTER TABLE submissions ADD COLUMN preblast_url TEXT`);
} catch (e) {
  if (!e.message.includes('duplicate column name')) throw e;
}
try {
  sqlite.exec(`ALTER TABLE submissions ADD COLUMN preblast_content TEXT`);
} catch (e) {
  if (!e.message.includes('duplicate column name')) throw e;
}

// Idempotent migration: add start_time column to submissions
try {
  sqlite.exec(`ALTER TABLE submissions ADD COLUMN start_time TEXT`);
} catch (e) {
  if (!e.message.includes('duplicate column name')) throw e;
}

// Idempotent migration: create audit_log table
sqlite.exec(`CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  submission_title TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

// Idempotent migration: create sections table and seed defaults
sqlite.exec(`CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  accent TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
sqlite.exec(`
  INSERT OR IGNORE INTO sections (id, label, accent, position) VALUES
    ('desk',           'Header',                  '#6C3483', 0),
    ('whats-hot',      'What''s Hot in The Fort',  '#8B2E2E', 1),
    ('individual-init','Individual Initiative',    '#3A7D5C', 2),
    ('still-fresh',    'Still Fresh',             '#D4A017', 3)
`);
// Rename legacy label if not yet updated
sqlite.prepare(`UPDATE sections SET label = 'Header' WHERE id = 'desk' AND label = 'Desk of the Nan''tan'`).run();

// Remove helpful-links from dynamic sections (it is now a protected static section)
try {
  sqlite.prepare(`UPDATE submissions SET section = NULL WHERE section = 'helpful-links'`).run();
  sqlite.prepare(`DELETE FROM sections WHERE id = 'helpful-links'`).run();
} catch (e) { /* already removed */ }

// Static section tables
sqlite.exec(`CREATE TABLE IF NOT EXISTS three_fs_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  f_column TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'event',
  name TEXT,
  detail TEXT,
  link_url TEXT,
  link_label TEXT,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
sqlite.exec(`CREATE TABLE IF NOT EXISTS slt_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);
sqlite.exec(`CREATE TABLE IF NOT EXISTS helpful_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

sqlite.exec(`CREATE TABLE IF NOT EXISTS vqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ao TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

sqlite.exec(`CREATE TABLE IF NOT EXISTS shovel_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_name TEXT NOT NULL,
  to_name TEXT NOT NULL,
  ao TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

// Seed Three F's items
if (sqlite.prepare('SELECT COUNT(*) as c FROM three_fs_items').get().c === 0) {
  sqlite.exec(`INSERT INTO three_fs_items (f_column, item_type, name, detail, link_url, link_label, position) VALUES
    ('fitness','link',NULL,NULL,'https://f3nation.us10.list-manage.com/track/click?u=31d40047f4100a853e297353d&id=f70e0acc16&e=c677564300','Full Workout List',0),
    ('fitness','link',NULL,NULL,'https://calendar.google.com/calendar/embed?src=5e3fs62uiaequ28n33p3mea3d8%40group.calendar.google.com&ctz=America%2FNew_York','Q Calendar',1),
    ('fellowship','event','Pizza in Fort Mill','1800–1900 · 3rd Thursday · Emilio''s, Arden Mill',NULL,NULL,0),
    ('fellowship','event','Coffeteria — East','0730 · Every Sat · Humble Cup',NULL,NULL,1),
    ('fellowship','event','Coffeteria — West','0730 · Every Sat · Tega Cay Deli',NULL,NULL,2),
    ('fellowship','link',NULL,NULL,'https://calendar.google.com/calendar/embed?src=jc1s2mmee1fsks6oij9374cslg%40group.calendar.google.com&ctz=America%2FNew_York','Fellowship Calendar',3),
    ('faith','event','The Testament','0630–0715 · Wed · Waffle House',NULL,NULL,0),
    ('faith','event','Hanging with Stang','0615–0700 · Thu · Kingsley Panera',NULL,NULL,1),
    ('faith','event','McGospel','0615–0700 · Fri · Kingsley Panera',NULL,NULL,2),
    ('faith','link',NULL,NULL,'https://calendar.google.com/calendar/embed?src=ht85v7p21jkfrk8oomekogk5ik%40group.calendar.google.com&ctz=America%2FNew_York','Faith Calendar',3)
  `);
}

// Seed SLT entries
if (sqlite.prepare('SELECT COUNT(*) as c FROM slt_entries').get().c === 0) {
  sqlite.exec(`INSERT INTO slt_entries (role, name, position) VALUES
    ('Nan''tan','Band Camp',0),
    ('1st F (East)','Time Machine',1),
    ('1st F (West)','Bonsai',2),
    ('2nd F','Liberty Bibberty',3),
    ('3rd F','Cornerstone',4),
    ('Weasel Shaker','Poppins',5),
    ('LDP','Cyclops',6),
    ('Comz','38 Special / Console',7),
    ('Newsletter','Bitcoin / Console / Ruby Slippers',8)
  `);
}

// Seed helpful links
if (sqlite.prepare('SELECT COUNT(*) as c FROM helpful_links').get().c === 0) {
  sqlite.exec(`INSERT INTO helpful_links (label, name, url, position) VALUES
    ('Q Schedule','GloomSchedule','https://app.gloomschedule.com/',0),
    ('FNG Capture','FNG Form','https://f3thefort.com',1),
    ('Q 101','Template','https://docs.google.com/document/d/1zFiVyspf1Xph6GIv-r-z5brONWUzhEYrBvXzbnKfdBc/edit?usp=sharing',2),
    ('LinkedIn','F3TheFort Group','https://www.linkedin.com/groups/7456081',3),
    ('Slack','Access Request','https://join.slack.com/t/f3thefort/shared_invite/zt-1endaagqa-nu0mQwqSr373Ib_aoZqVvg',4),
    ('Newsletter','Submit Entries','https://submit.f3thefort.com',5)
  `);
}

function logAudit(submissionId, action, title, detail = null) {
  sqlite.prepare(
    `INSERT INTO audit_log (submission_id, action, submission_title, detail) VALUES (?, ?, ?, ?)`
  ).run(submissionId, action, title, detail ? JSON.stringify(detail) : null);
}

// Image upload
const uploadDir = path.join(__dirname, 'public', 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // SVG is intentionally excluded: it can embed <script>, and uploads are served
    // from the same origin, so an SVG upload would be a stored-XSS vector.
    if (/^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

app.use('/uploads', express.static(uploadDir));

// Rate limiters for the public, unauthenticated endpoints. Windows are generous enough
// for a person composing a submission (a few uploads + snippet generations) but cap
// automated abuse — disk fill via uploads and Groq API cost via snippet generation.
const WINDOW_MS = 10 * 60 * 1000;
// Allow the test suite (which drives these endpoints from a single IP) to opt out.
const passthrough = (req, res, next) => next();
const makeLimiter = (opts) => (process.env.RATE_LIMIT_DISABLED === '1' ? passthrough : rateLimit(opts));
const submitLimiter = makeLimiter({ windowMs: WINDOW_MS, max: 20, message: 'Too many submissions, please try again later.' });
const uploadLimiter = makeLimiter({ windowMs: WINDOW_MS, max: 40, message: 'Too many uploads, please try again later.' });
const snippetLimiter = makeLimiter({ windowMs: WINDOW_MS, max: 20, message: 'Too many snippet requests, please try again later.' });
// Strict limiter for admin login — 5 attempts per 15 minutes per IP before lockout.
const loginLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 5, message: 'Too many login attempts, please try again later.' });

app.post('/api/upload/image', uploadLimiter, requireSameOrigin, upload.single('image'), (req, res) => {
  if (req.file) {
    res.json({ url: `/uploads/${req.file.filename}` });
  } else {
    res.status(400).json({ error: 'No image provided' });
  }
});

// Handle multer and body-parser errors
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
  }
  if (err.message === 'Only image files are allowed') {
    return res.status(400).json({ error: err.message });
  }
  // Express's default handler answers a 413 with an HTML error page, so the client's
  // response.json() rejects and the user is left with a generic "please try again" that
  // gives no hint the payload was the problem. Name the likely cause instead.
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      error: 'That entry is too large to submit. This usually means an image was pasted or '
        + 'dragged directly into the description — remove it and use the image button in the '
        + 'editor toolbar (or the hero image slot) to upload it instead.',
    });
  }
  next(err);
});

// GET /api/newsletter/history — Get newsletter send history
app.get('/api/newsletter/history', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    const rows = await db.select().from(newsletter_sends)
      .orderBy(desc(newsletter_sends.created_at))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(newsletter_sends);

    res.json({
      items: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch newsletter history' });
  }
});

// Admin auth check endpoint
app.get('/api/admin/check-auth', (req, res) => {
  res.json({ authenticated: validateSession(req.cookies?.adminSession) });
});

// GET /api/newsletter/preview-data — weekly FNGs for the generate modal
app.get('/api/newsletter/preview-data', requireAuth, async (req, res) => {
  try {
    const fngSheetUrl = process.env.FNG_SHEET_URL;
    if (fngSheetUrl) {
      try {
        await importFngs(DB_PATH, fngSheetUrl);
      } catch (err) {
        console.warn('FNG import warning:', err.message);
      }
    }

    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const currentYear = now.getFullYear();
    const allFngs = await db.select({
      f3_name: fngs.f3_name,
      ehed_by: fngs.ehed_by,
      ao: fngs.ao,
      timestamp: fngs.timestamp,
    }).from(fngs).where(eq(fngs.year, currentYear));

    const weeklyFngs = allFngs.filter(f => {
      if (!f.timestamp) return false;
      const d = new Date(f.timestamp);
      return !isNaN(d.getTime()) && d >= monday && d <= sunday;
    });

    res.json({ weeklyFngs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch preview data' });
  }
});

// GET /api/newsletter/campaign-status — check if a campaign exists for next Sunday
app.get('/api/newsletter/campaign-status', requireAuth, async (req, res) => {
  try {
    const dateStr = getNextSundayDateStr();
    const status = await getCampaignStatusForDate(dateStr);
    res.json({ ...status, dateStr });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to get campaign status' });
  }
});

// Resolve CSS custom properties and fix known email-client issues before sending to Mailchimp.
// Email clients (Gmail, Outlook, etc.) do not support CSS custom properties (var(--x)),
// so we extract the :root definitions and substitute literal values throughout the HTML.
function prepareForEmail(html) {
  // Extract --name: value pairs from :root {}
  const vars = {};
  const rootMatch = html.match(/:root\s*\{([^}]+)\}/);
  if (rootMatch) {
    for (const [, name, value] of rootMatch[1].matchAll(/--([^:]+):\s*([^;]+);/g)) {
      vars[`--${name.trim()}`] = value.trim();
    }
  }

  // Resolve a single var() call, recursing for chained references (max depth 5)
  function resolveVar(value, depth = 0) {
    if (depth > 5) return value;
    return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_, name, fallback) => {
      const resolved = vars[name];
      return resolved ? resolveVar(resolved, depth + 1) : (fallback || '');
    });
  }

  // Replace all var() references throughout the document
  html = html.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_, name, fallback) => {
    const resolved = vars[name];
    return resolved ? resolveVar(resolved) : (fallback || '');
  });

  // Google Fonts <link> tags are left as-is. Juice ignores <link> elements so they
  // survive to the final output. The preview browser and font-capable email clients
  // (Apple Mail, iOS) will load Oswald. Gmail strips <link> tags and falls back to
  // Impact/Arial Narrow — acceptable since all base styles are inlined.

  // Replace unfilled template placeholder
  html = html.replace(/\{\{ISSUE_YEAR\}\}/g, new Date().getFullYear().toString());

  // Remove body::before noise overlay — position:fixed unsupported in email
  html = html.replace(/body::before\s*\{[^}]+\}/g, 'body::before { display: none; }');

  // Replace clamp() font-sizes with fixed values — unsupported in Gmail/Outlook.
  // 48px (3rem at default scale) matches clamp(2.8rem, 8vw, 4.5rem) at ~600px email width.
  // Using px instead of rem avoids scaling issues when Gmail/Android root font-size differs.
  html = html.replace(/font-size:\s*clamp\([^)]+\)/g, 'font-size: 48px');

  // Push the responsive breakpoint from 640px → 480px so layouts don't collapse at
  // email client widths (~600px).
  html = html.replace(/@media\s*only\s+screen\s+and\s*\(max-width:\s*640px\)/g, '@media only screen and (max-width: 480px)');

  // Cap container to 600px (standard email width) and prevent horizontal overflow.
  html = html.replace(/max-width:\s*820px/, 'max-width: 600px');
  html = html.replace(/(body\s*\{[^}]*)overflow-x:\s*hidden/, '$1overflow-x: hidden');
  // Inject overflow-x:hidden on body if not already present
  html = html.replace(/(<body[^>]*style=")([^"]*)(")/,
    (_, open, styles, close) => open + (styles ? styles + '; ' : '') + 'overflow-x:hidden' + close);
  if (!html.match(/<body[^>]*style=/)) {
    html = html.replace(/<body([^>]*)>/, '<body$1 style="overflow-x:hidden">');
  }

  // Capture all @media blocks before Juice strips the <style> elements.
  // Everything else (base CSS) gets inlined; media queries cannot be inlined
  // so we preserve them separately and re-inject after.
  function extractMediaBlocks(css) {
    const blocks = [];
    let i = 0;
    while (i < css.length) {
      const start = css.indexOf('@media', i);
      if (start === -1) break;
      let depth = 0, j = start;
      while (j < css.length) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}' && --depth === 0) { j++; break; }
        j++;
      }
      blocks.push(css.slice(start, j));
      i = j;
    }
    return blocks.join('\n');
  }
  let mediaQueryCss = '';
  html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
    mediaQueryCss += extractMediaBlocks(css) + '\n';
  });

  // Inline all class-based CSS as style="" attributes and strip the <style> blocks.
  html = juice(html, { removeStyleTags: true, applyStyleTags: true, applyAttributesTableElements: false });

  // Re-inject only the @media rules — base styles are now all inline.
  if (mediaQueryCss.trim()) {
    html = html.replace('</head>', `<style>\n${mediaQueryCss.trim()}\n</style>\n</head>`);
  }

  // Gmail desktop strips <link> tags, so web fonts never load and the browser hits
  // the next fallback. Impact (second in the Oswald stack) is extremely heavy.
  // Remove it so the chain falls to 'Arial Narrow' which is condensed and close to Oswald.
  html = html.replace(/,\s*Impact/gi, '');

  // Post-Juice: convert CSS-table <div> layouts to real <table>/<td> elements.
  //
  // Problem: Juice inlines `display:table-cell` as a style="" attribute, and Gmail
  // Android scopes (not strips) head <style> — but scoped @media rules cannot beat
  // inline `display:table-cell` reliably because inline styles win at equal importance.
  //
  // Solution (same as Mailchimp): use real <td> elements, which have native
  // display:table-cell with NO inline style. The @media `display:block!important`
  // in <head> then easily overrides native behavior to stack columns on mobile.
  // Desktop keeps the side-by-side layout via native <td> rendering.
  //
  // The outer <div> is kept intact so its padding/border/background inline styles
  // (from Juice) remain on a reliable block element. Only the children become <td>.
  const $ = cheerio.load(html, { decodeEntities: false });

  // Get the value of a CSS property from an inline style string.
  function styleGet(s, prop) {
    for (const decl of (s || '').split(';')) {
      const [k, ...rest] = decl.split(':');
      if (k && k.trim().toLowerCase() === prop) return rest.join(':').trim();
    }
    return null;
  }

  // Return a style string with the given property names removed.
  function styleDrop(s, ...props) {
    return (s || '').split(';')
      .filter(d => !props.includes((d.split(':')[0] || '').trim().toLowerCase()))
      .join(';').replace(/^;+|;+$/, '').trim();
  }

  // Convert direct children of $el to <td> elements inside an injected <table>.
  // Extracts each child's CSS width and applies it as a width="" HTML attribute
  // (HTML attributes survive all email clients; inline CSS does not always).
  function cssTableToHtmlTable($el) {
    const children = $el.children();
    if (!children.length) return;
    const tds = children.map((_, c) => {
      const $c = $(c);
      const s = $c.attr('style') || '';
      const w = styleGet(s, 'width');
      const tdStyle = styleDrop(s, 'display', 'width');
      const wAttr = w ? ` width="${w}"` : '';
      const cls = $c.attr('class') ? ` class="${$c.attr('class')}"` : '';
      return `<td${cls}${wAttr} valign="top" style="${tdStyle}">${$c.html()}</td>`;
    }).get().join('');
    // Remove display:table properties from the outer div (no longer a CSS table).
    $el.attr('style', styleDrop($el.attr('style'), 'display', 'table-layout', 'border-spacing'));
    children.remove();
    $el.html(`<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${tds}</tr></table>`);
  }

  // Multi-column layouts → real HTML tables.
  $('.tracker').each((_, el) => cssTableToHtmlTable($(el)));         // FNG / Days (2-col)
  $('.roster-grid').each((_, el) => cssTableToHtmlTable($(el)));     // FNG / VQ roster (2-col)
  $('.three-fs').each((_, el) => cssTableToHtmlTable($(el)));        // Fun / Fitness / Faith (3-col)
  $('.fresh-header').each((_, el) => cssTableToHtmlTable($(el)));    // Still Fresh: title + badge
  $('.initiative-entry').each((_, el) => cssTableToHtmlTable($(el))); // Initiative: num + content

  // Remove section left-border accents for email — the original uses margin-left:-18px
  // to position the border outside the content column, which overflows the email canvas.
  $('.section--whats-hot, .section--individual-init, .section--still-fresh').css({
    'border-left': 'none', 'padding-left': '0', 'margin-left': '0',
  });
  // Tighten container padding for the narrower email canvas (600px vs 820px web).
  $('.container').css('padding', '0 12px');

  html = $.html();
  return html;
}

// POST /api/newsletter/campaign — create or update the scheduled Mailchimp campaign
app.post('/api/newsletter/campaign', requireAuth, async (req, res) => {
  const filePath = path.join(__dirname, 'newsletter-dark.html');
  if (!existsSync(filePath)) {
    return res.status(400).json({ error: 'Newsletter not generated yet. Please preview the newsletter first.' });
  }
  try {
    const htmlContent = prepareForEmail(readFileSync(filePath, 'utf8'));
    const result = await upsertScheduledCampaign(htmlContent);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to create campaign' });
  }
});

// Generate dark-themed newsletter endpoint
app.post('/api/newsletter/generate', requireAuth, async (req, res) => {
  console.log('Newsletter generation requested');
  try {
    const outputPath = path.join(__dirname, 'newsletter-dark.html');
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('x-forwarded-host') || req.get('host');
    const derivedBaseUrl = process.env.BASE_URL || `${proto}://${host}`;
    generateNewsletter({ dbPath: DB_PATH, outputPath, baseUrl: derivedBaseUrl });
    console.log('Newsletter generated successfully');
    res.json({ success: true, url: '/newsletter-email-preview' });
  } catch (err) {
    console.error('Newsletter generation failed:', err.message);
    res.status(500).json({ error: err.message || 'Failed to generate newsletter' });
  }
});

// Session store — token → expiry timestamp
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24h
const sessions = new Map();

function createSession() {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}

function validateSession(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(token); return false; }
  return true;
}

function destroySession(token) {
  sessions.delete(token);
}

// Periodically evict expired tokens — validateSession only deletes a token when it is
// looked up, so abandoned sessions would otherwise accumulate in memory indefinitely.
const sessionSweep = setInterval(() => {
  const now = Date.now();
  for (const [token, exp] of sessions) {
    if (now > exp) sessions.delete(token);
  }
}, 60 * 60 * 1000);
sessionSweep.unref?.(); // don't keep the event loop alive (e.g. in tests)

// Middleware: require valid session cookie
function requireAuth(req, res, next) {
  if (validateSession(req.cookies?.adminSession)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Middleware: only allow requests originating from this server (CSRF guard for public endpoints)
function requireSameOrigin(req, res, next) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers.host;
  const source = origin || referer;
  if (!source) return res.status(403).json({ error: 'Forbidden' });
  try {
    if (new URL(source).host === host) return next();
  } catch {}
  res.status(403).json({ error: 'Forbidden' });
}

// ============================================================
// API Routes
// ============================================================

// GET /api/submissions — List all submissions with pagination + optional search
app.get('/api/submissions', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 500));
    const offset = (page - 1) * limit;
    const showArchived = req.query.archived === 'true';
    const searchQ = req.query.q?.trim();

    let condition = showArchived ? isNotNull(submissions.archived_at) : isNull(submissions.archived_at);
    if (searchQ) {
      const pat = `%${searchQ}%`;
      condition = and(condition, or(like(submissions.title, pat), like(submissions.description, pat)));
    }

    const rows = await db.select().from(submissions)
      .where(condition)
      .orderBy(submissions.position, submissions.start_date)
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(submissions).where(condition);

    res.json({
      items: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// GET /api/submissions/:id — Get single submission
app.get('/api/submissions/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const [row] = await db.select().from(submissions).where(eq(submissions.id, id));
    if (!row) return res.status(404).json({ error: 'Submission not found' });

    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch submission' });
  }
});

// POST /api/generate-snippet — Generate a short newsletter snippet from HTML content via Groq
const GROQ_SYSTEM = "You are a newsletter editor. When given event information, write a short, punchy teaser suitable for a community newsletter — a couple sentences, not a summary of the whole event. Capture what the event is and why people should care enough to click through. Write in third person. Sound human, no flowery language — the goal is to drive excitement and encourage participation. A link to the full post with all the details (date, time, location, sign-up, etc.) will automatically be appended right after your teaser, so do not restate those details or try to be comprehensive — tease it, don't cover it. Do not add your own link, anchor tag, or call-to-action referencing a link yourself; the link is handled separately. Default to a single plain paragraph; only reach for a bullet or numbered list if the content is truly unreadable as prose. Return only valid HTML using basic tags (<p>, <ul>, <ol>, <li>, <strong>, <em>) with no preamble, commentary, or outer wrapper element. Do not wrap the output in quotation marks.";

app.post('/api/generate-snippet', snippetLimiter, requireSameOrigin, async (req, res) => {
  try {
    const { html } = req.body;
    if (!html) return res.status(400).json({ error: 'html is required' });

    const dom = new JSDOM(html);
    const plainText = dom.window.document.body.textContent || '';
    const images = [...dom.window.document.querySelectorAll('img')].map(img => img.outerHTML);

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        temperature: 0.4,
        messages: [
          { role: 'system', content: GROQ_SYSTEM },
          { role: 'user', content: `Write a newsletter snippet for the following event.\n\n${plainText}` },
        ],
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text().catch(() => '');
      console.error('Groq API error:', groqRes.status, err);
      return res.status(500).json({ error: 'Snippet generation failed' });
    }

    const data = await groqRes.json();
    let snippet = data.choices[0].message.content.trim();
    // Strip markdown code fences
    snippet = snippet.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '').trim();
    // Strip surrounding quotation marks (bare or inside first/last HTML tag)
    snippet = snippet.replace(/^["']|["']$/g, '').trim();
    snippet = snippet.replace(/^(<\w+[^>]*>)\s*["']/, '$1').replace(/["']\s*(<\/\w+>)$/, '$1').trim();
    // Safety net: the model is told the real link is appended separately and shouldn't add its
    // own, but sometimes does anyway (an <a> tag, or a bare "[link]"-style placeholder). Strip both.
    const snippetDom = new JSDOM(`<body>${snippet}</body>`);
    snippetDom.window.document.querySelectorAll('a').forEach(a => a.replaceWith(a.textContent));
    snippet = snippetDom.window.document.body.innerHTML.trim();
    snippet = snippet.replace(/[[(][^\])]*\blink\b[^\])]*[\])]/gi, '').trim();
    res.json({ snippet, images });
  } catch (err) {
    console.error('POST /api/generate-snippet error:', err.message);
    res.status(500).json({ error: 'Failed to generate snippet' });
  }
});

// POST /api/submissions — Create new submission
app.post('/api/submissions', submitLimiter, requireSameOrigin, async (req, res) => {
  try {
    const { title, leader, start_date, start_time, end_time, location, link, hero_image, video_url, submitter_name, submitter_email, submitter_phone, preblast } = req.body;
    // description and preblast_content are rich HTML from an unauthenticated endpoint —
    // sanitize before storage so neither the admin editor nor the newsletter renders attacker markup.
    const description = sanitizeHtml(req.body.description);
    const preblast_content = sanitizeHtml(req.body.preblast_content);

    if (!title || !description) {
      return res.status(400).json({ error: 'Missing required fields: title, description' });
    }

    if (preblast && !start_date) {
      return res.status(400).json({ error: 'A start date is required for pre-blast posts.' });
    }

    let preblastUrl = null;
    if (preblast && preblast_content) {
      try {
        preblastUrl = await postPreblast(title, preblast_content, leader, location, start_date, link);
      } catch (err) {
        console.error('WordPress preblast post failed:', err.message);
        return res.status(502).json({ error: `Failed to post to WordPress: ${err.message}` });
      }
    }

    const [row] = await db.insert(submissions).values({
      title,
      leader: leader || null,
      start_date: start_date || '',
      start_time: start_time || null,
      end_time: end_time || null,
      location: location || null,
      description,
      link: link || null,
      hero_image: hero_image || null,
      video_url: video_url || null,
      submitter_name: submitter_name || null,
      submitter_email: submitter_email || null,
      submitter_phone: submitter_phone || null,
      preblast_url: preblastUrl,
      preblast_content: (preblast && preblast_content) ? preblast_content : null,
    }).returning();

    logAudit(row.id, 'created', row.title, { section: null });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST /api/submissions error:', err.message);
    res.status(500).json({ error: 'Failed to create submission' });
  }
});

// POST /api/submissions/reorder — Update position order within a section (admin only)
app.post('/api/submissions/reorder', requireAuth, (req, res) => {
  try {
    const { section, order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of IDs' });
    const update = sqlite.prepare(`UPDATE submissions SET position = ? WHERE id = ?`);
    const tx = sqlite.transaction(() => {
      order.forEach((id, idx) => update.run(idx, id));
    });
    tx();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder submissions' });
  }
});

// PATCH /api/submissions/:id — Update submission fields (admin only)
app.patch('/api/submissions/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const [existing] = await db.select().from(submissions).where(eq(submissions.id, id));
    if (!existing) return res.status(404).json({ error: 'Submission not found' });

    const { section, hero_image, video_url, title, leader, start_date, start_time, end_time, location, description, link } = req.body;

    if (section !== undefined && section !== null) {
      const validSection = sqlite.prepare(`SELECT id FROM sections WHERE id = ?`).get(section);
      if (!validSection) return res.status(400).json({ error: 'Invalid section value' });
    }

    const updates = {};
    if (section !== undefined) updates.section = section;
    if (hero_image !== undefined) updates.hero_image = hero_image;
    if (video_url !== undefined) updates.video_url = video_url || null;
    if (title !== undefined) updates.title = title;
    if (leader !== undefined) updates.leader = leader || null;
    if (start_date !== undefined) updates.start_date = start_date || '';
    if (start_time !== undefined) updates.start_time = start_time || null;
    if (end_time !== undefined) updates.end_time = end_time || null;
    if (location !== undefined) updates.location = location || null;
    if (description !== undefined) updates.description = sanitizeHtml(description);
    if (link !== undefined) updates.link = link || null;

    const [row] = await db
      .update(submissions)
      .set(updates)
      .where(eq(submissions.id, id))
      .returning();

    // Audit log: section move
    if (section !== undefined && section !== existing.section) {
      logAudit(id, 'moved', row.title, { from: existing.section, to: section });
    }

    // Audit log: field updates (excluding section and hero_image)
    const CONTENT_FIELDS = ['title', 'leader', 'start_date', 'start_time', 'end_time', 'location', 'description', 'link'];
    const changedFields = CONTENT_FIELDS.filter(f => f in updates && updates[f] !== existing[f]);
    if (changedFields.length > 0) {
      logAudit(id, 'updated', row.title, { fields: changedFields });
    }

    res.json(row);
  } catch (err) {
    console.error('PATCH /api/submissions/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update submission' });
  }
});

// DELETE /api/submissions/:id — Archive submission (soft-delete, admin only)
app.delete('/api/submissions/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const [existing] = await db.select().from(submissions).where(eq(submissions.id, id));
    if (!existing) return res.status(404).json({ error: 'Submission not found' });

    await db.update(submissions)
      .set({ archived_at: new Date().toISOString() })
      .where(eq(submissions.id, id));

    logAudit(id, 'archived', existing.title);
    res.json({ success: true, archived: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to archive submission' });
  }
});

// POST /api/submissions/:id/restore — Restore archived submission (admin only)
app.post('/api/submissions/:id/restore', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const [existing] = await db.select().from(submissions).where(eq(submissions.id, id));
    if (!existing) return res.status(404).json({ error: 'Submission not found' });
    if (!existing.archived_at) return res.status(400).json({ error: 'Submission is not archived' });

    await db.update(submissions)
      .set({ archived_at: null })
      .where(eq(submissions.id, id));

    logAudit(id, 'restored', existing.title);
    res.json({ success: true, restored: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restore submission' });
  }
});

// DELETE /api/submissions/:id/permanent — Permanently delete an archived submission (admin only)
app.delete('/api/submissions/:id/permanent', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const [existing] = await db.select().from(submissions).where(eq(submissions.id, id));
    if (!existing) return res.status(404).json({ error: 'Submission not found' });
    if (!existing.archived_at) return res.status(400).json({ error: 'Only archived submissions can be permanently deleted' });

    logAudit(id, 'deleted', existing.title);
    await db.delete(submissions).where(eq(submissions.id, id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to permanently delete submission' });
  }
});

// ============================================================
// Changelog
// ============================================================

// GET /api/changelog — Changes since a given date (admin only)
app.get('/api/changelog', requireAuth, (req, res) => {
  try {
    const since = req.query.since
      ? new Date(req.query.since).toISOString()
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const until = new Date().toISOString();

    const rows = sqlite.prepare(
      `SELECT id, submission_id, action, submission_title, detail, created_at
       FROM audit_log WHERE created_at >= ? ORDER BY created_at ASC`
    ).all(since);

    const ACTION_ORDER = ['created', 'moved', 'updated', 'archived', 'restored', 'deleted'];
    const groups = {};
    ACTION_ORDER.forEach(a => { groups[a] = []; });

    // Deduplicate per action per submission: keep latest
    const seen = {}; // key: `${action}:${submission_id}`
    for (const row of rows) {
      const key = `${row.action}:${row.submission_id}`;
      seen[key] = row; // last write wins (rows are ASC so latest overwrites)
    }

    for (const row of Object.values(seen)) {
      if (groups[row.action]) {
        groups[row.action].push({
          submission_id: row.submission_id,
          title: row.submission_title,
          detail: row.detail ? JSON.parse(row.detail) : null,
          created_at: row.created_at,
        });
      }
    }

    const total = Object.values(groups).reduce((n, g) => n + g.length, 0);
    res.json({ period: { since, until }, groups, total });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch changelog' });
  }
});

// ============================================================
// FNG Routes
// ============================================================

// GET /api/fngs — List all FNGs with pagination
app.get('/api/fngs', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const year = req.query.year ? parseInt(req.query.year) : null;

    let query = db.select().from(fngs).orderBy(desc(fngs.timestamp)).limit(limit).offset(offset);

    if (year) {
      query = query.where(eq(fngs.year, year));
    }

    const rows = await query;

    let countQuery = db.select({ total: count() }).from(fngs);
    if (year) {
      countQuery = countQuery.where(eq(fngs.year, year));
    }
    const [{ total }] = await countQuery;

    res.json({
      items: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch FNGs' });
  }
});

// GET /api/fngs/stats — FNG progress stats
app.get('/api/fngs/stats', requireAuth, async (req, res) => {
  try {
    const goal = 226;
    const now = new Date();
    const currentYear = now.getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    const daysElapsed = Math.floor((now - startOfYear) / (1000 * 60 * 60 * 24)) + 1;
    const dailyRate = goal / 365;
    const expectedFngs = Math.floor(daysElapsed * dailyRate);

    const totalAll = await db.select({ total: count() }).from(fngs);
    const total2026 = await db.select({ total: count() }).from(fngs).where(eq(fngs.year, currentYear));

    res.json({
      goal,
      currentYear,
      daysElapsed,
      dailyRate: Math.round(dailyRate * 100) / 100,
      expectedFngs,
      totalAll: totalAll[0].total,
      total2026: total2026[0].total,
      remaining: goal - total2026[0].total,
      onTrack: total2026[0].total >= expectedFngs,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch FNG stats' });
  }
});

// POST /api/fngs — Create FNG entry (admin only)
app.post('/api/fngs', requireAuth, async (req, res) => {
  try {
    const { timestamp, first_name, last_name, email, f3_name, ehed_by, workout_q_f3_name, ao, phone_number } = req.body;

    if (!timestamp || !f3_name) {
      return res.status(400).json({ error: 'Missing required fields: timestamp, f3_name' });
    }

    const date = new Date(timestamp);
    const year = isNaN(date.getTime()) ? null : date.getFullYear();

    const [row] = await db.insert(fngs).values({
      timestamp,
      first_name: first_name || null,
      last_name: last_name || null,
      email: email || null,
      f3_name,
      ehed_by: ehed_by || null,
      workout_q_f3_name: workout_q_f3_name || null,
      ao: ao || null,
      phone_number: phone_number || null,
      year,
    }).returning();

    res.status(201).json(row);
  } catch (err) {
    console.error('POST /api/fngs error:', err.message);
    res.status(500).json({ error: 'Failed to create FNG entry' });
  }
});

// DELETE /api/fngs/:id — Delete FNG entry (admin only)
app.delete('/api/fngs/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const [row] = await db.delete(fngs).where(eq(fngs.id, id)).returning();
    if (!row) return res.status(404).json({ error: 'FNG entry not found' });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete FNG entry' });
  }
});

// ============================================================
// Sections API
// ============================================================

// GET /api/sections — List all sections ordered by position
app.get('/api/sections', requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(sections).orderBy(sections.position);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sections' });
  }
});

// POST /api/sections — Create a new section
app.post('/api/sections', requireAuth, (req, res) => {
  try {
    const { id, label, accent } = req.body;
    if (!id || !label || !accent) return res.status(400).json({ error: 'id, label, and accent are required' });
    if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'id must be lowercase alphanumeric with hyphens' });

    const maxPos = sqlite.prepare(`SELECT COALESCE(MAX(position), -1) as m FROM sections`).get().m;
    sqlite.prepare(`INSERT INTO sections (id, label, accent, position) VALUES (?, ?, ?, ?)`).run(id, label, accent, maxPos + 1);
    const row = sqlite.prepare(`SELECT * FROM sections WHERE id = ?`).get(id);
    res.status(201).json(row);
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) return res.status(409).json({ error: 'Section ID already exists' });
    res.status(500).json({ error: 'Failed to create section' });
  }
});

// PATCH /api/sections/:id — Update a section
app.patch('/api/sections/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { label, accent, position } = req.body;
    const existing = sqlite.prepare(`SELECT * FROM sections WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'Section not found' });

    if (id === 'desk' && (label !== undefined || accent !== undefined)) {
      return res.status(403).json({ error: 'This section is locked and cannot be renamed or recolored' });
    }

    if (label !== undefined) sqlite.prepare(`UPDATE sections SET label = ? WHERE id = ?`).run(label, id);
    if (accent !== undefined) sqlite.prepare(`UPDATE sections SET accent = ? WHERE id = ?`).run(accent, id);
    if (position !== undefined) sqlite.prepare(`UPDATE sections SET position = ? WHERE id = ?`).run(position, id);

    const row = sqlite.prepare(`SELECT * FROM sections WHERE id = ?`).get(id);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update section' });
  }
});

// DELETE /api/sections/:id — Delete a section (moves submissions to unsorted)
app.delete('/api/sections/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    if (id === 'desk') return res.status(403).json({ error: 'This section is locked and cannot be deleted' });
    const existing = sqlite.prepare(`SELECT * FROM sections WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ error: 'Section not found' });

    const tx = sqlite.transaction(() => {
      sqlite.prepare(`UPDATE submissions SET section = NULL WHERE section = ?`).run(id);
      sqlite.prepare(`DELETE FROM sections WHERE id = ?`).run(id);
    });
    tx();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete section' });
  }
});

// ============================================================
// Static Sections API (Three F's, SLT, Helpful Links)
// ============================================================

// ── Three F's ──────────────────────────────────────────────

app.get('/api/static/three-fs', requireAuth, (req, res) => {
  try {
    res.json(sqlite.prepare('SELECT * FROM three_fs_items ORDER BY f_column, position ASC').all());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch Three Fs items' });
  }
});

app.post('/api/static/three-fs/reorder', requireAuth, (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of IDs' });
    const update = sqlite.prepare('UPDATE three_fs_items SET position = ? WHERE id = ?');
    sqlite.transaction(() => order.forEach((id, idx) => update.run(idx, id)))();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder' });
  }
});

app.post('/api/static/three-fs', requireAuth, (req, res) => {
  try {
    const { f_column, item_type, name, detail, link_url, link_label } = req.body;
    if (!['fitness', 'fellowship', 'faith'].includes(f_column)) return res.status(400).json({ error: 'Invalid f_column' });
    if (!['event', 'link'].includes(item_type)) return res.status(400).json({ error: 'Invalid item_type' });
    const maxPos = sqlite.prepare('SELECT COALESCE(MAX(position),-1) as m FROM three_fs_items WHERE f_column = ?').get(f_column).m;
    const { lastInsertRowid } = sqlite.prepare(
      'INSERT INTO three_fs_items (f_column, item_type, name, detail, link_url, link_label, position) VALUES (?,?,?,?,?,?,?)'
    ).run(f_column, item_type, name || null, detail || null, link_url || null, link_label || null, maxPos + 1);
    res.status(201).json(sqlite.prepare('SELECT * FROM three_fs_items WHERE id = ?').get(lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: 'Failed to create item' });
  }
});

app.patch('/api/static/three-fs/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    if (!sqlite.prepare('SELECT id FROM three_fs_items WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
    const { item_type, name, detail, link_url, link_label } = req.body;
    if (item_type !== undefined) sqlite.prepare('UPDATE three_fs_items SET item_type = ? WHERE id = ?').run(item_type, id);
    if (name !== undefined) sqlite.prepare('UPDATE three_fs_items SET name = ? WHERE id = ?').run(name || null, id);
    if (detail !== undefined) sqlite.prepare('UPDATE three_fs_items SET detail = ? WHERE id = ?').run(detail || null, id);
    if (link_url !== undefined) sqlite.prepare('UPDATE three_fs_items SET link_url = ? WHERE id = ?').run(link_url || null, id);
    if (link_label !== undefined) sqlite.prepare('UPDATE three_fs_items SET link_label = ? WHERE id = ?').run(link_label || null, id);
    res.json(sqlite.prepare('SELECT * FROM three_fs_items WHERE id = ?').get(id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update item' });
  }
});

app.delete('/api/static/three-fs/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    if (!sqlite.prepare('SELECT id FROM three_fs_items WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
    sqlite.prepare('DELETE FROM three_fs_items WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// ── SLT ────────────────────────────────────────────────────

app.get('/api/static/slt', requireAuth, (req, res) => {
  try {
    res.json(sqlite.prepare('SELECT * FROM slt_entries ORDER BY position ASC').all());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch SLT entries' });
  }
});

app.post('/api/static/slt/reorder', requireAuth, (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of IDs' });
    const update = sqlite.prepare('UPDATE slt_entries SET position = ? WHERE id = ?');
    sqlite.transaction(() => order.forEach((id, idx) => update.run(idx, id)))();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder' });
  }
});

app.post('/api/static/slt', requireAuth, (req, res) => {
  try {
    const { role, name } = req.body;
    if (!role || !name) return res.status(400).json({ error: 'role and name are required' });
    const maxPos = sqlite.prepare('SELECT COALESCE(MAX(position),-1) as m FROM slt_entries').get().m;
    const { lastInsertRowid } = sqlite.prepare('INSERT INTO slt_entries (role, name, position) VALUES (?,?,?)').run(role, name, maxPos + 1);
    res.status(201).json(sqlite.prepare('SELECT * FROM slt_entries WHERE id = ?').get(lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: 'Failed to create SLT entry' });
  }
});

app.patch('/api/static/slt/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    if (!sqlite.prepare('SELECT id FROM slt_entries WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
    const { role, name } = req.body;
    if (role !== undefined) sqlite.prepare('UPDATE slt_entries SET role = ? WHERE id = ?').run(role, id);
    if (name !== undefined) sqlite.prepare('UPDATE slt_entries SET name = ? WHERE id = ?').run(name, id);
    res.json(sqlite.prepare('SELECT * FROM slt_entries WHERE id = ?').get(id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update SLT entry' });
  }
});

app.delete('/api/static/slt/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    if (!sqlite.prepare('SELECT id FROM slt_entries WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
    sqlite.prepare('DELETE FROM slt_entries WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete SLT entry' });
  }
});

// ── Helpful Links ───────────────────────────────────────────

app.get('/api/static/links', requireAuth, (req, res) => {
  try {
    res.json(sqlite.prepare('SELECT * FROM helpful_links ORDER BY position ASC').all());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch helpful links' });
  }
});

app.post('/api/static/links/reorder', requireAuth, (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of IDs' });
    const update = sqlite.prepare('UPDATE helpful_links SET position = ? WHERE id = ?');
    sqlite.transaction(() => order.forEach((id, idx) => update.run(idx, id)))();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder' });
  }
});

app.post('/api/static/links', requireAuth, (req, res) => {
  try {
    const { label, name, url } = req.body;
    if (!label || !name || !url) return res.status(400).json({ error: 'label, name, and url are required' });
    const maxPos = sqlite.prepare('SELECT COALESCE(MAX(position),-1) as m FROM helpful_links').get().m;
    const { lastInsertRowid } = sqlite.prepare('INSERT INTO helpful_links (label, name, url, position) VALUES (?,?,?,?)').run(label, name, url, maxPos + 1);
    res.status(201).json(sqlite.prepare('SELECT * FROM helpful_links WHERE id = ?').get(lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: 'Failed to create link' });
  }
});

app.patch('/api/static/links/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    if (!sqlite.prepare('SELECT id FROM helpful_links WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
    const { label, name, url } = req.body;
    if (label !== undefined) sqlite.prepare('UPDATE helpful_links SET label = ? WHERE id = ?').run(label, id);
    if (name !== undefined) sqlite.prepare('UPDATE helpful_links SET name = ? WHERE id = ?').run(name, id);
    if (url !== undefined) sqlite.prepare('UPDATE helpful_links SET url = ? WHERE id = ?').run(url, id);
    res.json(sqlite.prepare('SELECT * FROM helpful_links WHERE id = ?').get(id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update link' });
  }
});

app.delete('/api/static/links/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    if (!sqlite.prepare('SELECT id FROM helpful_links WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
    sqlite.prepare('DELETE FROM helpful_links WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete link' });
  }
});

// VQ Routes
app.get('/api/static/vqs', requireAuth, (req, res) => {
  try {
    res.json(sqlite.prepare('SELECT * FROM vqs ORDER BY position ASC').all());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch VQs' });
  }
});

app.post('/api/static/vqs/reorder', requireAuth, (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
    const update = sqlite.prepare('UPDATE vqs SET position = ? WHERE id = ?');
    const tx = sqlite.transaction((ids) => ids.forEach((id, pos) => update.run(pos, id)));
    tx(order);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder VQs' });
  }
});

app.post('/api/static/vqs', requireAuth, (req, res) => {
  try {
    const { name, ao } = req.body;
    if (!name || !ao) return res.status(400).json({ error: 'name and ao are required' });
    const maxPos = sqlite.prepare('SELECT COALESCE(MAX(position),-1) as m FROM vqs').get().m;
    const { lastInsertRowid } = sqlite.prepare('INSERT INTO vqs (name, ao, position) VALUES (?,?,?)').run(name, ao, maxPos + 1);
    res.status(201).json(sqlite.prepare('SELECT * FROM vqs WHERE id = ?').get(lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: 'Failed to create VQ' });
  }
});

app.patch('/api/static/vqs/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    if (!sqlite.prepare('SELECT id FROM vqs WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
    const { name, ao } = req.body;
    if (name !== undefined) sqlite.prepare('UPDATE vqs SET name = ? WHERE id = ?').run(name, id);
    if (ao !== undefined) sqlite.prepare('UPDATE vqs SET ao = ? WHERE id = ?').run(ao, id);
    res.json(sqlite.prepare('SELECT * FROM vqs WHERE id = ?').get(id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update VQ' });
  }
});

app.delete('/api/static/vqs/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    if (!sqlite.prepare('SELECT id FROM vqs WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
    sqlite.prepare('DELETE FROM vqs WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete VQ' });
  }
});

// Shovel Flag Routes
app.get('/api/static/shovel-flags', requireAuth, (req, res) => {
  try {
    res.json(sqlite.prepare('SELECT * FROM shovel_flags ORDER BY position ASC').all());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch shovel flags' });
  }
});

app.post('/api/static/shovel-flags/reorder', requireAuth, (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
    const update = sqlite.prepare('UPDATE shovel_flags SET position = ? WHERE id = ?');
    const tx = sqlite.transaction((ids) => ids.forEach((id, pos) => update.run(pos, id)));
    tx(order);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder shovel flags' });
  }
});

app.post('/api/static/shovel-flags', requireAuth, (req, res) => {
  try {
    const { from_name, to_name, ao } = req.body;
    if (!from_name || !to_name || !ao) return res.status(400).json({ error: 'from_name, to_name, and ao are required' });
    const maxPos = sqlite.prepare('SELECT COALESCE(MAX(position),-1) as m FROM shovel_flags').get().m;
    const { lastInsertRowid } = sqlite.prepare('INSERT INTO shovel_flags (from_name, to_name, ao, position) VALUES (?,?,?,?)').run(from_name, to_name, ao, maxPos + 1);
    res.status(201).json(sqlite.prepare('SELECT * FROM shovel_flags WHERE id = ?').get(lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: 'Failed to create shovel flag' });
  }
});

app.patch('/api/static/shovel-flags/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    if (!sqlite.prepare('SELECT id FROM shovel_flags WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
    const { from_name, to_name, ao } = req.body;
    if (from_name !== undefined) sqlite.prepare('UPDATE shovel_flags SET from_name = ? WHERE id = ?').run(from_name, id);
    if (to_name !== undefined) sqlite.prepare('UPDATE shovel_flags SET to_name = ? WHERE id = ?').run(to_name, id);
    if (ao !== undefined) sqlite.prepare('UPDATE shovel_flags SET ao = ? WHERE id = ?').run(ao, id);
    res.json(sqlite.prepare('SELECT * FROM shovel_flags WHERE id = ?').get(id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update shovel flag' });
  }
});

app.delete('/api/static/shovel-flags/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    if (!sqlite.prepare('SELECT id FROM shovel_flags WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
    sqlite.prepare('DELETE FROM shovel_flags WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete shovel flag' });
  }
});

// Admin routes

// POST /api/admin/login — Login
app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid password' });

  const token = createSession();
  res.cookie('adminSession', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_TTL,
  });
  res.json({ success: true });
});

// POST /api/admin/logout — Logout
app.post('/api/admin/logout', (req, res) => {
  destroySession(req.cookies?.adminSession);
  res.clearCookie('adminSession');
  res.json({ success: true });
});

// Serve admin.html for /admin route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve newsletter-dark.html for /newsletter-dark route
app.get('/newsletter-dark', (req, res) => {
  const filePath = path.join(__dirname, 'newsletter-dark.html');
  if (existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Newsletter not generated yet. Use admin dashboard to generate.');
  }
});

// Serve the email-prepared HTML (juice-inlined, var() resolved) for testing
app.get('/newsletter-email-preview', (req, res) => {
  const filePath = path.join(__dirname, 'newsletter-dark.html');
  if (!existsSync(filePath)) {
    return res.status(404).send('Newsletter not generated yet. Use admin dashboard to generate.');
  }
  const html = prepareForEmail(readFileSync(filePath, 'utf8'));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Catch-all — serve index.html for any other route
app.get('{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Newsletter server running on http://localhost:${PORT}`);
});

export { app, server };
