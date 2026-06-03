import 'dotenv/config';
import express from 'express';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, desc, count, isNull, isNotNull } from 'drizzle-orm';
import { submissions, fngs, newsletter_sends, audit_log } from './schema.js'; // newsletter_sends kept for history route
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { getCampaignStatusForDate, upsertScheduledCampaign, getNextSundayDateStr } from './lib/mailchimp.js';
import multer from 'multer';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// Idempotent migration: create audit_log table
sqlite.exec(`CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  submission_title TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

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

app.post('/api/upload/image', upload.single('image'), (req, res) => {
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
  const cookie = req.headers.cookie || '';
  const auth = cookie.includes(`adminAuth=${ADMIN_PASSWORD}`);
  res.json({ authenticated: auth });
});

// GET /api/newsletter/preview-data — weekly FNGs for the generate modal
app.get('/api/newsletter/preview-data', requireAuth, async (req, res) => {
  try {
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

// POST /api/newsletter/campaign — create or update the scheduled Mailchimp campaign
app.post('/api/newsletter/campaign', requireAuth, async (req, res) => {
  const filePath = path.join(__dirname, 'newsletter-dark.html');
  if (!existsSync(filePath)) {
    return res.status(400).json({ error: 'Newsletter not generated yet. Please preview the newsletter first.' });
  }
  try {
    const htmlContent = readFileSync(filePath, 'utf8');
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
    const args = [`--output=${outputPath}`];
    if (req.body.vqs) args.push(`--vqs=${req.body.vqs}`);
    await execFileAsync('node', ['generate-newsletter.mjs', ...args], { cwd: __dirname, env: { ...process.env, BASE_URL: process.env.BASE_URL || `http://localhost:${PORT}` } });
    console.log('Newsletter generated successfully');
    res.json({ success: true, url: '/newsletter-dark' });
  } catch (err) {
    console.error('Newsletter generation failed:', err.message);
    res.status(500).json({ error: err.message || 'Failed to generate newsletter' });
  }
});

function getCookieValue(cookieHeader, name) {
  const match = cookieHeader.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]*)`));
  return match ? decodeURIComponent(match[1].trim()) : undefined;
}

// Admin auth middleware
function requireAuth(req, res, next) {
  const password = req.body?.password;
  const rawCookie = req.headers.cookie || '';
  const sessionAuth = req.cookies?.adminAuth || getCookieValue(rawCookie, 'adminAuth');

  if (sessionAuth === ADMIN_PASSWORD) {
    req.adminAuthenticated = true;
    return next();
  }

  if (password === ADMIN_PASSWORD) {
    res.cookie('adminAuth', ADMIN_PASSWORD, { httpOnly: true, sameSite: 'strict' });
    req.adminAuthenticated = true;
    return next();
  }

  res.status(401).json({ error: 'Invalid password' });
}

// ============================================================
// API Routes
// ============================================================

// GET /api/submissions — List all submissions with pagination
app.get('/api/submissions', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 8));
    const offset = (page - 1) * limit;
    const showArchived = req.query.archived === 'true';

    const condition = showArchived ? isNotNull(submissions.archived_at) : isNull(submissions.archived_at);

    const rows = await db.select().from(submissions)
      .where(condition)
      .orderBy(desc(submissions.start_date))
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
app.get('/api/submissions/:id', async (req, res) => {
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

// POST /api/submissions — Create new submission
app.post('/api/submissions', async (req, res) => {
  try {
    const { title, leader, start_date, end_time, location, description, link, hero_image, submitter_name, submitter_email, submitter_phone } = req.body;

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

    const [row] = await db.insert(submissions).values({
      title,
      leader: leader || null,
      start_date,
      end_time: end_time || null,
      location: location || null,
      description,
      link: link || null,
      hero_image: hero_image || null,
      submitter_name: submitter_name || null,
      submitter_email: submitter_email || null,
      submitter_phone: submitter_phone || null,
    }).returning();

    logAudit(row.id, 'created', row.title, { section: null });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST /api/submissions error:', err.message);
    res.status(500).json({ error: 'Failed to create submission' });
  }
});

// PATCH /api/submissions/:id — Update submission fields (admin only)
const ALLOWED_SECTIONS = ['whats-hot', 'individual-init', 'desk', 'still-fresh', 'helpful-links', null];

app.patch('/api/submissions/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const [existing] = await db.select().from(submissions).where(eq(submissions.id, id));
    if (!existing) return res.status(404).json({ error: 'Submission not found' });

    const { section, hero_image, title, leader, start_date, end_time, location, description, link } = req.body;

    if (section !== undefined && !ALLOWED_SECTIONS.includes(section)) {
      return res.status(400).json({ error: 'Invalid section value' });
    }

    const updates = {};
    if (section !== undefined) updates.section = section;
    if (hero_image !== undefined) updates.hero_image = hero_image;
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
app.get('/api/fngs', async (req, res) => {
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
app.get('/api/fngs/stats', async (req, res) => {
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

// Admin routes

// POST /api/admin/login — Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  if (password === ADMIN_PASSWORD) {
    res.cookie('adminAuth', ADMIN_PASSWORD, { httpOnly: true, sameSite: 'strict' });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// POST /api/admin/logout — Logout
app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('adminAuth');
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
