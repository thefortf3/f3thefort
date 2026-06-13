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
import { importFngs } from './import-fngs.mjs';
import { generateNewsletter } from './generate-newsletter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Middleware
app.use(express.json());
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
    if (/^image\/(png|jpe?g|gif|webp|svg)$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

app.use('/uploads', express.static(uploadDir));

app.post('/api/upload/image', requireSameOrigin, upload.single('image'), (req, res) => {
  if (req.file) {
    res.json({ url: `/uploads/${req.file.filename}` });
  } else {
    res.status(400).json({ error: 'No image provided' });
  }
});

// Handle multer errors
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
  }
  if (err.message === 'Only image files are allowed') {
    return res.status(400).json({ error: err.message });
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

  // Convert Google Fonts <link> tags to @import in a dedicated <style> block.
  // Gmail strips any <style> block that contains @import, so we isolate the @import
  // in its own block — Gmail strips just that block, leaving the main CSS intact.
  // Apple Mail / iOS Mail will load the fonts from the separate block.
  const gFontsLinkRe = /<link\s[^>]*href="(https:\/\/fonts\.googleapis\.com\/css[^"]+)"[^>]*>/gi;
  const gFontsMatches = [...html.matchAll(gFontsLinkRe)];
  if (gFontsMatches.length) {
    const imports = gFontsMatches.map(m => `@import url('${m[1]}');`).join('\n');
    // Remove the original <link> tags (including preconnect hints)
    html = html.replace(/<link\s[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>/gi, '');
    // Inject a separate <style> block before the main one
    html = html.replace(/<style>/, `<style>${imports}</style>\n<style>`);
  }

  // Replace unfilled template placeholder
  html = html.replace(/\{\{ISSUE_YEAR\}\}/g, new Date().getFullYear().toString());

  // Remove body::before noise overlay — position:fixed unsupported in email
  html = html.replace(/body::before\s*\{[^}]+\}/g, 'body::before { display: none; }');

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
    res.json({ success: true, url: '/newsletter-dark' });
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
const GROQ_SYSTEM = "You are a newsletter editor. When given event information, write a concise summary suitable for inclusion in a community newsletter. The summary should capture what the event is about and why people should care. Write in third person. Sound human, no flowery language — the goal is to drive excitement and encourage participation. Use your own judgment on formatting: plain paragraphs, bullet lists, numbered steps, bold key details — whatever best serves the content. Return only valid HTML using basic tags (<p>, <ul>, <ol>, <li>, <strong>, <em>) with no preamble, commentary, or outer wrapper element. Do not wrap the output in quotation marks.";

app.post('/api/generate-snippet', requireSameOrigin, async (req, res) => {
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
    res.json({ snippet, images });
  } catch (err) {
    console.error('POST /api/generate-snippet error:', err.message);
    res.status(500).json({ error: 'Failed to generate snippet' });
  }
});

// POST /api/submissions — Create new submission
app.post('/api/submissions', requireSameOrigin, async (req, res) => {
  try {
    const { title, leader, start_date, end_time, location, description, link, hero_image, video_url, submitter_name, submitter_email, submitter_phone, preblast, preblast_content } = req.body;

    if (!title || !start_date || !description) {
      return res.status(400).json({ error: 'Missing required fields: title, start_date, description' });
    }

    if (end_time && start_date) {
      const startDate = new Date(start_date);
      const endDate = new Date(end_time);
      if (endDate <= startDate) {
        return res.status(400).json({ error: 'end_time must be after start_time' });
      }
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
      start_date,
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

    const { section, hero_image, video_url, title, leader, start_date, end_time, location, description, link } = req.body;

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
    if (start_date !== undefined) updates.start_date = start_date;
    if (end_time !== undefined) updates.end_time = end_time || null;
    if (location !== undefined) updates.location = location || null;
    if (description !== undefined) updates.description = description;
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
    const CONTENT_FIELDS = ['title', 'leader', 'start_date', 'end_time', 'location', 'description', 'link'];
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
app.post('/api/admin/login', (req, res) => {
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

// Serve newsletter.html for /newsletter route
app.get('/newsletter', (req, res) => {
  res.sendFile(path.join(__dirname, 'newsletter.html'));
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

// Catch-all — serve index.html for any other route
app.get('{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Newsletter server running on http://localhost:${PORT}`);
});

export { app, server };
