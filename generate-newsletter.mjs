#!/usr/bin/env node
/**
 * generate-newsletter.mjs
 *
 * Reads newsletter-template.html + submissions from dev.db,
 * fills placeholders with dynamic data, writes final HTML.
 *
 * Usage:
 *   node generate-newsletter.mjs              # Default → writes newsletter-dark.html
 *   node generate-newsletter.mjs --output X   # Write to X
 *   node generate-newsletter.mjs --db X       # Use DB at X
 *   node generate-newsletter.mjs --preview    # Output to stdout
 */

import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const outputFlag = args.find(a => a.startsWith('--output=')) || args.find(a => a.startsWith('--output'));
const outputPath = outputFlag
  ? outputFlag.replace('--output=', '').replace('--output ', '')
  : resolve(__dirname, 'newsletter-dark.html');

const dbPathArg = args.find(a => a.startsWith('--db=')) || args.find(a => a.startsWith('--db'));
const dbPath = dbPathArg
  ? dbPathArg.replace('--db=', '').replace('--db ', '')
  : (process.env.TEST_DB || resolve(__dirname, 'dev.db'));

const templatePath = resolve(__dirname, 'public', 'newsletter-template.html');
const previewOnly = args.includes('--preview');
const baseUrl = process.env.BASE_URL;
if (!baseUrl) {
  console.error('Error: BASE_URL environment variable is required (e.g., https://news.thelucks.org)');
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(startDate, endTime) {
  if (!startDate) return '';
  try {
    const d = new Date(startDate);
    if (isNaN(d.getTime())) return startDate;

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = days[d.getDay()];
    const month = months[d.getMonth()];
    const date = d.getDate();

    let hours = d.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const mins = d.getMinutes().toString().padStart(2, '0');

    let result = `${dayName}, ${month} ${date} — ${hours}:${mins} ${ampm}`;

    if (endTime) {
      const e = new Date(endTime);
      if (!isNaN(e.getTime())) {
        let eHours = e.getHours();
        const eAmpm = eHours >= 12 ? 'PM' : 'AM';
        eHours = eHours % 12 || 12;
        const eMins = e.getMinutes().toString().padStart(2, '0');
        result += ` to ${eHours}:${eMins} ${eAmpm}`;
      }
    }

    return result;
  } catch {
    return startDate;
  }
}

function getIssueDate() {
  const now = new Date();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const getOrdinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  };

  return `${months[monday.getMonth()]} ${monday.getDate()}${getOrdinal(monday.getDate())} – ${months[sunday.getMonth()]} ${sunday.getDate()}${getOrdinal(sunday.getDate())}, ${monday.getFullYear()}`;
}

function getHeaderDate() {
  const now = new Date();
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  const y = now.getFullYear();
  return `Issue ${m}.${d}.${y}`;
}

// ─── Database ────────────────────────────────────────────────────────
function getSubmissions(dbPath) {
  const db = new Database(dbPath);
  const stmt = db.prepare(`
    SELECT id, title, leader, start_date, end_time, location, description, link, hero_image, section
    FROM submissions
    WHERE section IS NOT NULL AND section != 'null'
    ORDER BY
      CASE section
        WHEN 'desk' THEN 0
        WHEN 'whats-hot' THEN 1
        WHEN 'individual-init' THEN 2
        WHEN 'still-fresh' THEN 3
        WHEN 'helpful-links' THEN 4
        ELSE 5
      END,
      start_date ASC
  `);
  const rows = stmt.all();
  db.close();
  return rows;
}

function getFngStats(dbPath) {
  const db = new Database(dbPath);
  const goal = 226;
  const now = new Date();
  const currentYear = now.getFullYear();
  const startOfYear = new Date(currentYear, 0, 1);
  const daysElapsed = Math.floor((now - startOfYear) / (1000 * 60 * 60 * 24)) + 1;
  const dailyRate = goal / 365;
  const expectedFngs = Math.floor(daysElapsed * dailyRate);

  const total2026 = db.prepare('SELECT COUNT(*) as total FROM fngs WHERE year = ?').get(currentYear);
  const totalAll = db.prepare('SELECT COUNT(*) as total FROM fngs').get();

  db.close();

  const progressPercent = Math.round((total2026.total / goal) * 100);
  const daysPct = Math.round((daysElapsed / 365) * 100);
  const onTrack = total2026.total >= expectedFngs;

  return {
    goal,
    currentYear,
    daysElapsed,
    dailyRate: Math.round(dailyRate * 100) / 100,
    expectedFngs,
    totalAll: totalAll.total,
    total2026: total2026.total,
    remaining: Math.max(0, goal - total2026.total),
    onTrack,
    progressPercent,
    daysPct,
  };
}

// ─── Section builders ────────────────────────────────────────────────
function buildNantanSection(submissions) {
  const desk = submissions.find(s => s.section === 'desk');
  if (!desk) return '';

  return `
  <!-- ===== DESK OF THE NANTAN ===== -->
  <div class="nantan">
    <div class="nantan-author">Desk of the Nan'tan — ${escapeHtml(desk.leader || 'Band Camp')}</div>
    <div class="nantan-title">${escapeHtml(desk.title)}</div>
    <div class="nantan-body">
      ${rewriteHtmlImages(desk.description)}
    </div>
  </div>`;
}

function buildRosterSection(submissions) {
  const fngs = submissions.filter(s => s.section === 'fngs');
  const vqs = submissions.filter(s => s.section === 'vqs');

  if (fngs.length === 0 && vqs.length === 0) return '';

  return `
  <!-- ===== FNG / VQ ROSTER ===== -->
  <div class="roster-grid">
    <div class="roster-card fng">
      <div class="roster-type">FNGs</div>
      <ul class="roster-names">
${fngs.map(f => `        <li>${escapeHtml(f.leader || f.title)}</li>`).join('\n')}
      </ul>
    </div>
    <div class="roster-card vq">
      <div class="roster-type">VQs</div>
      <ul class="roster-names">
${vqs.map(v => `        <li class="celebration">🥳 ${escapeHtml(v.leader || v.title)}</li>`).join('\n')}
      </ul>
    </div>
  </div>`;
}

function buildDynamicSections(submissions) {
  const sectionConfig = [
    { id: 'whats-hot', label: "What's Hot", number: '01', cardType: 'event' },
    { id: 'individual-init', label: 'Individual Initiative', number: '02', cardType: 'initiative' },
    { id: 'still-fresh', label: 'Still Fresh', number: '03', cardType: 'fresh' },
    { id: 'helpful-links', label: 'Helpful Links', number: '06', cardType: 'links' },
  ];

  const grouped = {};
  for (const secId of sectionConfig.map(s => s.id)) {
    grouped[secId] = submissions.filter(s => s.section === secId);
  }

  let html = '';
  let sectionNumber = 0;

  for (const config of sectionConfig) {
    const entries = grouped[config.id];
    if (!entries || entries.length === 0) continue;

    sectionNumber++;

    html += `
  <!-- ===== ${config.label} ===== -->
  <div class="section">
    <div class="section-header">
      <span class="section-number">${config.number}</span>
      <span class="section-name">${escapeHtml(config.label)}</span>
      <span class="section-accent"></span>
    </div>`;

    for (const sub of entries) {
      if (config.cardType === 'event') {
        html += buildEventCard(sub);
      } else if (config.cardType === 'initiative') {
        html += buildInitiativeCard(sub);
      } else if (config.cardType === 'fresh') {
        html += buildFreshCard(sub);
      } else if (config.cardType === 'links') {
        html += buildLinkItem(sub);
      }
    }

    html += `
  </div>`;
  }

  return html;
}

function buildEventCard(sub) {
  let html = `
    <article class="event-card">`;

  if (sub.hero_image) {
    html += `
      <img class="event-image" src="${escapeHtml(resolveAssetUrl(sub.hero_image))}" alt="${escapeHtml(sub.title)}">`;
  }

  html += `
      <div class="event-body">
        <div class="event-title">${escapeHtml(sub.title)}</div>`;

  if (sub.leader) {
    html += `
        <div class="event-q">Q: ${escapeHtml(sub.leader)}</div>`;
  }

  html += `
        <div class="event-meta">`;

  if (sub.start_date) {
    html += `
          <div class="event-meta-item"><span class="icon">📅</span> ${escapeHtml(formatDate(sub.start_date, sub.end_time))}</div>`;
  }

  if (sub.location) {
    html += `
          <div class="event-meta-item"><span class="icon">📌</span> ${escapeHtml(sub.location)}</div>`;
  }

  html += `
        </div>`;

  html += `
        <div class="event-desc">${rewriteHtmlImages(sub.description || '')}</div>`;

  if (sub.link) {
    html += `
        <a class="event-link" href="${escapeHtml(sub.link)}" target="_blank" rel="noopener">Details ↗</a>`;
  }

  html += `
      </div>
    </article>`;

  return html;
}

function buildInitiativeCard(sub) {
  let html = `
    <article class="initiative-card">
      <div class="initiative-title">${escapeHtml(sub.title)}</div>
      <div class="initiative-meta">`;

  if (sub.leader) {
    html += `
        <div class="initiative-meta-item"><span class="icon">Q:</span> ${escapeHtml(sub.leader)}</div>`;
  }

  if (sub.start_date) {
    html += `
        <div class="initiative-meta-item"><span class="icon">📅</span> ${escapeHtml(formatDate(sub.start_date, sub.end_time))}</div>`;
  }

  if (sub.location) {
    html += `
        <div class="initiative-meta-item"><span class="icon">📌</span> ${escapeHtml(sub.location)}</div>`;
  }

  html += `
      </div>
      <div class="initiative-desc">${rewriteHtmlImages(sub.description || '')}</div>`;

  if (sub.link) {
    html += `
      <a class="event-link" href="${escapeHtml(sub.link)}" target="_blank" rel="noopener">Details ↗</a>`;
  }

  html += `
    </article>`;

  return html;
}

function buildFreshCard(sub) {
  // Check if this is a "word of the month" style entry
  if (sub.title && sub.description && (
    sub.title.toLowerCase().includes('word') ||
    sub.description.toLowerCase().includes('integrity') ||
    sub.description.toLowerCase().includes('sacrifice') ||
    sub.description.toLowerCase().includes('alignment')
  )) {
    const wordMatch = sub.title?.match(/(\w+)$/i) || sub.description?.match(/(\w+)\s+is\s+being/i);
    const word = wordMatch ? wordMatch[1] : 'Integrity';
    const monthMatch = sub.description?.match(/May Theme[:\s]*(\w+)/i);
    const month = monthMatch ? `May: ${monthMatch[1]}` : 'May Theme';

    return `
    <div class="word-card">
      <div class="word-label">${escapeHtml(month)}</div>
      <div class="word-main">${escapeHtml(word)}</div>
      <div class="word-body">
        ${rewriteHtmlImages(sub.description)}
      </div>
    </div>`;
  }

  // Regular fresh card
  let html = `
    <article class="fresh-card">
      <div class="fresh-header">
        <div class="fresh-title">${escapeHtml(sub.title)}</div>`;

  if (sub.title && sub.title.toLowerCase().includes('yes')) {
    html += `
        <div class="fresh-tag">YES</div>`;
  }

  html += `
      </div>
      <div class="fresh-body">
        <div class="event-meta">`;

  if (sub.leader) {
    html += `
          <div class="event-meta-item"><span class="icon">Q:</span> ${escapeHtml(sub.leader)}</div>`;
  }

  if (sub.start_date) {
    html += `
          <div class="event-meta-item"><span class="icon">📅</span> ${escapeHtml(formatDate(sub.start_date, sub.end_time))}</div>`;
  }

  if (sub.location) {
    html += `
          <div class="event-meta-item"><span class="icon">📌</span> ${escapeHtml(sub.location)}</div>`;
  }

  html += `
        </div>
        <div class="event-desc">${rewriteHtmlImages(sub.description || '')}</div>
      </div>
    </article>`;

  return html;
}

function buildLinkItem(sub) {
  return `
    <li><span class="link-label">${escapeHtml(sub.title)}:</span> <a href="${escapeHtml(sub.link || '#')}" target="_blank" rel="noopener">${escapeHtml(sub.leader || 'Link')} ↗</a></li>`;
}

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

function resolveAssetUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return baseUrl + url;
  return url;
}

function rewriteHtmlImages(html) {
  if (!html) return '';
  return html.replace(/src="\/uploads\/([^"]+)"/g, `src="${baseUrl}/uploads/$1"`);
}

// ─── Main ────────────────────────────────────────────────────────────
function main() {
  const template = readFileSync(templatePath, 'utf-8');
  const submissions = getSubmissions(dbPath);
  const fngStats = getFngStats(dbPath);
  const issueDate = getIssueDate();
  const headerDate = getHeaderDate();

  // Build dynamic sections
  const nantanSection = buildNantanSection(submissions);
  const rosterSection = buildRosterSection(submissions);
  const dynamicSections = buildDynamicSections(submissions);

  // Replace placeholders
  let html = template
    .replace('{{TITLE}}', 'The Fort Weekly — ' + issueDate)
    .replace('{{HEADER_DATE}}', headerDate)
    .replace('{{FNG_COUNT}}', fngStats.total2026.toString())
    .replace('{{FNG_PROGRESS_PCT}}', fngStats.progressPercent.toString())
    .replace('{{ISSUE_YEAR}}', fngStats.currentYear.toString())
    .replace('{{FNG_DAYS}}', fngStats.daysElapsed.toString())
    .replace('{{DAYS_PCT}}', fngStats.daysPct.toString())
    .replace('{{NANTAN_SECTION}}', nantanSection)
    .replace('{{ROSTER_SECTION}}', rosterSection)
    .replace('{{DYNAMIC_SECTIONS}}', dynamicSections);

  if (previewOnly) {
    process.stdout.write(html);
  } else {
    writeFileSync(outputPath, html, 'utf-8');
    console.log(`Newsletter generated → ${outputPath}`);
  }
}

main();
