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

const templatePath = resolve(__dirname, 'public', 'newsletter-template.html');
let baseUrl = process.env.BASE_URL || '';

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

    const hours = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');

    let result = `${dayName}, ${month} ${date} — ${hours}${mins}`;

    if (endTime) {
      const e = new Date(endTime);
      if (!isNaN(e.getTime())) {
        const eHours = e.getHours().toString().padStart(2, '0');
        const eMins = e.getMinutes().toString().padStart(2, '0');
        result += `-${eHours}${eMins}`;
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
  const daysUntilSunday = now.getDay() === 0 ? 0 : 7 - now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  const m = (sunday.getMonth() + 1).toString().padStart(2, '0');
  const d = sunday.getDate().toString().padStart(2, '0');
  const y = sunday.getFullYear();
  return `Issue ${m}.${d}.${y}`;
}

// ─── Database ────────────────────────────────────────────────────────
function getSubmissions(dbPath) {
  const db = new Database(dbPath);
  const rows = db.prepare(`
    SELECT s.id, s.title, s.leader, s.start_date, s.end_time, s.location,
           s.description, s.link, s.hero_image, s.video_url, s.section, s.position,
           s.preblast_url
    FROM submissions s
    LEFT JOIN sections sec ON s.section = sec.id
    WHERE s.section IS NOT NULL AND s.section != 'null' AND s.archived_at IS NULL
    ORDER BY COALESCE(sec.position, 999) ASC, s.position ASC, s.start_date ASC
  `).all();
  db.close();
  return rows;
}

function getSections(dbPath) {
  const db = new Database(dbPath);
  const rows = db.prepare(`SELECT id, label, accent FROM sections ORDER BY position ASC`).all();
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

function getWeeklyFngs(dbPath) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const db = new Database(dbPath);
  const currentYear = now.getFullYear();
  const rows = db.prepare(
    'SELECT f3_name, ehed_by, ao, timestamp FROM fngs WHERE year = ? ORDER BY timestamp ASC'
  ).all(currentYear);
  db.close();

  return rows.filter(row => {
    if (!row.timestamp) return false;
    const d = new Date(row.timestamp);
    return !isNaN(d.getTime()) && d >= monday && d <= sunday;
  });
}

// ─── Static section data ─────────────────────────────────────────────
function getStaticSections(dbPath) {
  const db = new Database(dbPath);
  const threeFsItems = db.prepare('SELECT * FROM three_fs_items ORDER BY f_column, position ASC').all();
  const sltEntries = db.prepare('SELECT * FROM slt_entries ORDER BY position ASC').all();
  const helpfulLinks = db.prepare('SELECT * FROM helpful_links ORDER BY position ASC').all();
  const shovelFlags = db.prepare('SELECT * FROM shovel_flags ORDER BY position ASC').all();
  const weeklyVqs = db.prepare('SELECT * FROM vqs ORDER BY position ASC').all();
  db.close();
  return { threeFsItems, sltEntries, helpfulLinks, shovelFlags, weeklyVqs };
}

function buildThreeFsSection(items) {
  const cols = [
    { id: 'fitness', num: '1', label: 'Fitness' },
    { id: 'fellowship', num: '2', label: 'Fellowship' },
    { id: 'faith', num: '3', label: 'Faith' },
  ];

  const colsHtml = cols.map(col => {
    const colItems = items.filter(i => i.f_column === col.id);
    const itemsHtml = colItems.map(item => {
      if (item.item_type === 'link') {
        return `
        <div class="mini-event">
          <a class="mini-cal-link" href="${escapeHtml(item.link_url || '#')}" target="_blank" rel="noopener">${escapeHtml(item.link_label || 'Link')} ↗</a>
        </div>`;
      }
      return `
        <div class="mini-event">
          ${item.name ? `<div class="mini-event-name">${escapeHtml(item.name)}</div>` : ''}
          ${item.detail ? `<div class="mini-event-detail">${escapeHtml(item.detail)}</div>` : ''}
        </div>`;
    }).join('');

    return `
    <div class="three-f-col">
      <div class="three-f-head"><span class="three-f-num">${col.num}</span><span class="three-f-label">${col.label}</span></div>
      <div class="three-f-body">${itemsHtml}
      </div>
    </div>`;
  }).join('');

  return `
<!-- ===== THE THREE F's ===== -->
<div class="section section--reference">
  <div class="section-header">
    <span class="section-number">04</span>
    <span class="section-name">The Three F's</span>
    <span class="section-accent"></span>
  </div>
  <div class="three-fs">${colsHtml}
  </div>
</div>`;
}

function buildSltSection(entries) {
  if (entries.length === 0) return '';
  const entriesHtml = entries.map(e =>
    `    <div class="slt-entry"><span class="slt-entry-role">${escapeHtml(e.role)}</span><span class="slt-entry-sep">—</span><span class="slt-entry-name">${escapeHtml(e.name)}</span></div>`
  ).join('\n');

  return `
<!-- ===== SLT ===== -->
<div class="section section--reference">
  <div class="section-header">
    <span class="section-number">05</span>
    <span class="section-name">Shared Leadership Team</span>
    <span class="section-accent"></span>
  </div>
  <div class="slt-roster">
${entriesHtml}
  </div>
</div>`;
}

function buildHelpfulLinksSection(links) {
  if (links.length === 0) return '';
  const linksHtml = links.map(l =>
    `    <a class="links-stack-item" href="${escapeHtml(l.url)}" target="_blank" rel="noopener"><span class="links-stack-label">${escapeHtml(l.label)}</span><span class="links-stack-name">${escapeHtml(l.name)}</span><span class="links-stack-arrow">↗</span></a>`
  ).join('\n');

  return `
<!-- ===== HELPFUL LINKS ===== -->
<div class="section section--reference section--helpful-links">
  <div class="section-header">
    <span class="section-number">06</span>
    <span class="section-name">Helpful Links</span>
    <span class="section-accent"></span>
  </div>
  <div class="links-stack">
${linksHtml}
  </div>
</div>`;
}

function buildShovelFlagSection(flags) {
  if (flags.length === 0) return '';
  const rows = flags.map(f =>
    `    <div class="shovel-flag-item">
      <span class="shovel-flag-from">${escapeHtml(f.from_name)}</span>
      <span class="shovel-flag-arrow">→</span>
      <span class="shovel-flag-to">${escapeHtml(f.to_name)}</span>
      <span class="shovel-flag-ao">@ ${escapeHtml(f.ao)}</span>
    </div>`
  ).join('\n');

  return `
<!-- ===== SHOVEL FLAG HAND-OFF ===== -->
<div class="section section--shovel-flag">
  <div class="section-header">
    <span class="section-number">&#9873;</span>
    <span class="section-name">Shovel Flag Hand-off</span>
    <span class="section-accent"></span>
  </div>
  <div class="shovel-flag-list">
${rows}
  </div>
</div>`;
}

// ─── Section builders ────────────────────────────────────────────────
function buildNantanSection(submissions) {
  const desk = submissions.find(s => s.section === 'desk');
  if (!desk) return '';

  const hasHero = !!desk.hero_image;
  const heroHtml = hasHero
    ? `\n    <img class="nantan-hero" src="${escapeHtml(resolveAssetUrl(desk.hero_image))}" alt="${escapeHtml(desk.title)}">`
    : '';

  return `
  <!-- ===== HEADER ===== -->
  <div class="nantan${hasHero ? ' nantan--has-hero' : ''}">
    ${heroHtml}
    <span class="nantan-quote">“</span>
    <div class="nantan-author">${escapeHtml(desk.title)}${desk.leader ? ` — ${escapeHtml(desk.leader)}` : ''}</div>
    <div class="nantan-body">
      ${rewriteHtmlImages(desk.description)}
    </div>
    ${desk.video_url ? buildVideoEmbed(desk.video_url) : ''}
  </div>`;
}

function buildRosterSection(weeklyFngs, weeklyVqs) {
  if (weeklyFngs.length === 0 && weeklyVqs.length === 0) return '';

  const fngItems = weeklyFngs.map(f => {
    const detail = f.ehed_by ? ` <span class="roster-detail">EH: ${escapeHtml(f.ehed_by)}</span>` : '';
    return `        <li>${escapeHtml(f.f3_name)}${detail}</li>`;
  }).join('\n');

  const vqItems = weeklyVqs.map(v =>
    `        <li>🥳 ${escapeHtml(v.name)} <span class="roster-detail">@ ${escapeHtml(v.ao)}</span></li>`
  ).join('\n');

  const vqBlock = weeklyVqs.length > 0 ? `
    <div class="roster-card vq">
      <div class="roster-type">VQs</div>
      <ul class="roster-names">
${vqItems}
      </ul>
    </div>` : '';

  return `
  <!-- ===== FNG / VQ ROSTER ===== -->
  <div class="roster-grid">
    <div class="roster-card fng">
      <div class="roster-type">FNGs</div>
      <ul class="roster-names">
${weeklyFngs.length > 0 ? fngItems : '        <li style="color:#888;font-style:italic;">None this week</li>'}
      </ul>
    </div>${vqBlock}
  </div>`;
}

function getCardType(sectionId) {
  if (sectionId === 'helpful-links') return 'links';
  if (sectionId === 'individual-init') return 'initiative';
  if (sectionId === 'still-fresh') return 'fresh';
  return 'event';
}

function buildDynamicSections(submissions, dbSections) {
  const dynamicSections = dbSections.filter(s => s.id !== 'desk');

  let html = '';
  let sectionNumber = 0;

  for (const sec of dynamicSections) {
    const entries = submissions.filter(s => s.section === sec.id);
    if (!entries || entries.length === 0) continue;

    sectionNumber++;
    const config = { id: sec.id, label: sec.label, number: String(sectionNumber).padStart(2, '0'), cardType: getCardType(sec.id) };

    html += `
  <!-- ===== ${config.label} ===== -->
  <div class="section section--${config.id}">
    <div class="section-header">
      <span class="section-number">${config.number}</span>
      <span class="section-name">${escapeHtml(config.label)}</span>
      <span class="section-accent"></span>
    </div>`;

    if (config.cardType === 'links') {
      html += `\n    <ul class="links-list">`;
    } else if (config.id === 'individual-init') {
      html += `\n    <div class="initiative-list">`;
    }

    let initIndex = 0;
    for (const sub of entries) {
      if (config.cardType === 'event') {
        html += buildEventCard(sub);
      } else if (config.cardType === 'initiative') {
        html += buildInitiativeCard(sub, ++initIndex);
      } else if (config.cardType === 'fresh') {
        html += buildFreshCard(sub);
      } else if (config.cardType === 'links') {
        html += buildLinkItem(sub);
      }
    }

    if (config.cardType === 'links') {
      html += `\n    </ul>`;
    } else if (config.id === 'individual-init') {
      html += `\n    </div>`;
    }

    html += `\n  </div>`;
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

  if (sub.video_url) {
    html += buildVideoEmbed(sub.video_url);
  }

  const ctaUrl = sub.preblast_url || sub.link;
  const ctaLabel = sub.preblast_url ? 'Read full pre-blast ↗' : 'Details ↗';
  if (ctaUrl) {
    html += `
        <a class="event-link" href="${escapeHtml(ctaUrl)}" target="_blank" rel="noopener">${ctaLabel}</a>`;
  }

  html += `
      </div>
    </article>`;

  return html;
}

function buildInitiativeCard(sub, index) {
  const numStr = String(index).padStart(2, '0');
  let html = `
    <article class="initiative-entry">
      <div class="initiative-num">${numStr}</div>
      <div class="initiative-content">
        <div class="initiative-title">${escapeHtml(sub.title)}</div>`;

  if (sub.leader) {
    html += `
        <div class="event-q">Q: ${escapeHtml(sub.leader)}</div>`;
  }

  const hasMeta = sub.start_date || sub.location;
  if (hasMeta) {
    html += `
        <div class="initiative-meta">`;
    if (sub.start_date) {
      html += `
          <div class="initiative-meta-item"><span class="icon">📅</span> ${escapeHtml(formatDate(sub.start_date, sub.end_time))}</div>`;
    }
    if (sub.location) {
      html += `
          <div class="initiative-meta-item"><span class="icon">📌</span> ${escapeHtml(sub.location)}</div>`;
    }
    html += `
        </div>`;
  }

  html += `
        <div class="initiative-desc">${rewriteHtmlImages(sub.description || '')}</div>`;

  if (sub.video_url) {
    html += buildVideoEmbed(sub.video_url);
  }

  const ctaUrl = sub.preblast_url || sub.link;
  const ctaLabel = sub.preblast_url ? 'Read full pre-blast ↗' : 'Details ↗';
  if (ctaUrl) {
    html += `
        <a class="event-link" href="${escapeHtml(ctaUrl)}" target="_blank" rel="noopener">${ctaLabel}</a>`;
  }

  html += `
      </div>
    </article>`;

  return html;
}

function buildFreshCard(sub) {
  let html = `
    <article class="fresh-card">
      <div class="fresh-header">
        <div class="fresh-title">${escapeHtml(sub.title)}</div>
        <span class="fresh-badge">FRESH</span>
      </div>
      <div class="fresh-body">`;

  if (sub.leader) {
    html += `
        <div class="event-q">Q: ${escapeHtml(sub.leader)}</div>`;
  }

  const hasMeta = sub.start_date || sub.location;
  if (hasMeta) {
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
  }

  html += `
        <div class="event-desc">${rewriteHtmlImages(sub.description || '')}</div>
        ${sub.video_url ? buildVideoEmbed(sub.video_url) : ''}
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

function parseVideoUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return { type: 'youtube', id: v, original: url };
      const shorts = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (shorts) return { type: 'youtube', id: shorts[1], original: url };
      const embed = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]+)/);
      if (embed) return { type: 'youtube', id: embed[1], original: url };
    }
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      if (id) return { type: 'youtube', id, original: url };
    }
    if (u.hostname.includes('vimeo.com')) {
      const id = u.pathname.match(/\/(\d+)/)?.[1];
      if (id) return { type: 'vimeo', id, original: url };
    }
    return { type: 'generic', original: url };
  } catch {
    return null;
  }
}

function buildVideoEmbed(videoUrl) {
  if (!videoUrl) return '';
  const parsed = parseVideoUrl(videoUrl);
  if (!parsed) return '';

  if (parsed.type === 'youtube') {
    const embedUrl = `https://www.youtube.com/embed/${escapeHtml(parsed.id)}?rel=0`;
    const thumbUrl = `https://img.youtube.com/vi/${escapeHtml(parsed.id)}/hqdefault.jpg`;
    return `
<div class="video-embed" data-embed-url="${embedUrl}">
  <a class="video-embed__link" href="${escapeHtml(parsed.original)}" target="_blank" rel="noopener">
    <div class="video-embed__thumb">
      <img class="video-embed__img" src="${thumbUrl}" alt="Watch video">
      <div class="video-embed__play">&#9654;</div>
    </div>
    <div class="video-embed__caption">Watch on YouTube &#8599;</div>
  </a>
</div>`;
  }

  if (parsed.type === 'vimeo') {
    const embedUrl = `https://player.vimeo.com/video/${escapeHtml(parsed.id)}`;
    return `
<div class="video-embed" data-embed-url="${embedUrl}">
  <a class="video-embed__link" href="${escapeHtml(parsed.original)}" target="_blank" rel="noopener">
    <div class="video-embed__thumb video-embed__thumb--noimg">
      <div class="video-embed__play">&#9654;</div>
    </div>
    <div class="video-embed__caption">Watch on Vimeo &#8599;</div>
  </a>
</div>`;
  }

  return `<div class="video-embed__generic"><a href="${escapeHtml(parsed.original)}" target="_blank" rel="noopener">Watch Video &#8599;</a></div>`;
}

// ─── Main ────────────────────────────────────────────────────────────
export function generateNewsletter({ dbPath, outputPath, baseUrl: _baseUrl }) {
  baseUrl = _baseUrl || process.env.BASE_URL;
  if (!baseUrl) throw new Error('BASE_URL is required');

  const template = readFileSync(templatePath, 'utf-8');
  const submissions = getSubmissions(dbPath);
  const dbSections = getSections(dbPath);
  const fngStats = getFngStats(dbPath);
  const issueDate = getIssueDate();
  const headerDate = getHeaderDate();
  const { threeFsItems, sltEntries, helpfulLinks, shovelFlags, weeklyVqs } = getStaticSections(dbPath);

  const nantanSection = buildNantanSection(submissions);
  const shovelFlagSection = buildShovelFlagSection(shovelFlags);
  const weeklyFngs = getWeeklyFngs(dbPath);
  const rosterSection = buildRosterSection(weeklyFngs, weeklyVqs);
  const dynamicSections = buildDynamicSections(submissions, dbSections);

  let html = template
    .replace('{{TITLE}}', 'The Fort Weekly — ' + issueDate)
    .replace('{{HEADER_DATE}}', headerDate)
    .replace('{{FNG_COUNT}}', fngStats.total2026.toString())
    .replace('{{FNG_PROGRESS_PCT}}', fngStats.progressPercent.toString())
    .replace('{{ISSUE_YEAR}}', fngStats.currentYear.toString())
    .replace('{{FNG_DAYS}}', fngStats.daysElapsed.toString())
    .replace('{{DAYS_PCT}}', fngStats.daysPct.toString())
    .replace('{{NANTAN_SECTION}}', nantanSection)
    .replace('{{SHOVEL_FLAG_SECTION}}', shovelFlagSection)
    .replace('{{ROSTER_SECTION}}', rosterSection)
    .replace('{{DYNAMIC_SECTIONS}}', dynamicSections)
    .replace('{{THREE_FS_SECTION}}', buildThreeFsSection(threeFsItems))
    .replace('{{SLT_SECTION}}', buildSltSection(sltEntries))
    .replace('{{HELPFUL_LINKS_SECTION}}', buildHelpfulLinksSection(helpfulLinks));

  writeFileSync(outputPath, html, 'utf-8');
  console.log(`Newsletter generated → ${outputPath}`);
}

// ─── CLI entry point ─────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  function getArg(name) {
    const eqForm = args.find(a => a.startsWith(`--${name}=`));
    if (eqForm) return eqForm.slice(`--${name}=`.length);
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
    return null;
  }

  const cliOutputPath = getArg('output') || resolve(__dirname, 'newsletter-dark.html');
  const cliDbPath = getArg('db') || process.env.TEST_DB || process.env.DB_PATH || resolve(__dirname, 'dev.db');

  if (!process.env.BASE_URL) {
    console.error('Error: BASE_URL environment variable is required');
    process.exit(1);
  }

  generateNewsletter({ dbPath: cliDbPath, outputPath: cliOutputPath });
}
