// Local only: makes placeholder flyers for the entries in the local stack and attaches them.
//
// - Every approved entry gets a portrait "flyer" (1200×1600, the 3:4 shape the site's thumbnails use).
// - The featured entry gets a landscape hero instead (1600×1000, for the Featured card and email).
// - Images are written to .local/uploads/placeholder-<slug>.png and set as the entry's hero_image
//   through the admin API, which also flushes the site cache.
// - Entries that already have an image are left alone unless you pass --all.
// - Every image is marked "PLACEHOLDER" so it can't be mistaken for a real flyer.
//
// Runs in the Playwright image (the sandbox's Node is too old):
//   docker run --rm --network host -v "$PWD":/app -w /app \
//     -v "$HOME/.cache/ms-playwright":/ms-playwright -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
//     mcr.microsoft.com/playwright:v1.60.0-noble node scripts/local/placeholder-images.mjs [--all] [--dry-run]
//
// Env: NL_URL (default http://localhost:3002), ADMIN_PASSWORD (default test123),
//      OUT_DIR (default .local/uploads).

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const NL_URL = (process.env.NL_URL || 'http://localhost:3002').replace(/\/$/, '');
const PASSWORD = process.env.ADMIN_PASSWORD || 'test123';
const OUT_DIR = process.env.OUT_DIR || '.local/uploads';
const ALL = process.argv.includes('--all');
const DRY = process.argv.includes('--dry-run');

const TAG_COLORS = { 'whats-hot': '#d4a03c', i2: '#8fb4d8', 'still-fresh': '#a3c290', weekly: '#9a9da5' };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function parts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return { day: DAYS[dt.getUTCDay()], mon: MONTHS[m - 1], date: d };
}

function time(t) {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(String(t || '').trim());
  if (!m) return t || '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "SAT OCT 24 · 7:30 AM", or "EVERY SAT · FROM OCT 24" for a weekly run. */
function whenLine(e) {
  const dates = e.upcoming_dates || [];
  if (!dates.length) return 'ONGOING';
  const first = parts(dates[0].date);
  const t = dates[0].start_time ? ` · ${time(dates[0].start_time)}` : '';
  if (dates.length > 2 && dates.every(o => parts(o.date).day === first.day)) {
    return `EVERY ${first.day} · FROM ${first.mon} ${first.date}${t}`;
  }
  const more = dates.length > 1 ? ` · +${dates.length - 1} MORE` : '';
  return `${first.day} ${first.mon} ${first.date}${t}${more}`;
}

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Oswald:wght@500;600;700&display=block" rel="stylesheet">`;

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: var(--w); height: var(--h); }
  body { background: #0f1114; color: #f0ece4; font-family: 'Oswald', 'Arial Narrow', sans-serif; overflow: hidden; }
  .mono { font-family: 'JetBrains Mono', monospace; letter-spacing: 0.12em; }
  .poster { position: relative; width: 100%; height: 100%; overflow: hidden; }
  .stamp { position: absolute; right: 48px; bottom: 40px; font-family: 'JetBrains Mono', monospace; font-size: 20px;
           letter-spacing: 0.24em; color: rgba(240,236,228,.45); border: 2px solid rgba(240,236,228,.3); padding: 8px 14px; }
  .brand { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px; letter-spacing: 0.3em; }
  .tag { display: inline-block; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 26px; letter-spacing: 0.2em;
         padding: 10px 18px; background: var(--c); color: #0f1114; }
  h1 { font-weight: 700; text-transform: uppercase; line-height: 0.95; letter-spacing: 0.01em; }
`;

/** Three portrait layouts, chosen by entry id so neighbouring cards look different. */
const FLYERS = [
  // Stacked: colour band, huge title, date block at the bottom.
  e => `
  <div class="poster" style="background:
      radial-gradient(1200px 900px at 110% -10%, color-mix(in srgb, var(--c) 35%, transparent), transparent 60%),
      repeating-linear-gradient(135deg, rgba(255,255,255,.025) 0 2px, transparent 2px 28px), #111317;">
    <div style="height: 22px; background: var(--c);"></div>
    <div style="padding: 80px 84px 0; display: flex; flex-direction: column; gap: 56px; height: calc(100% - 22px);">
      <div style="display:flex; justify-content: space-between; align-items: center;">
        <span class="brand">F3 <span style="color: var(--c)">THE FORT</span></span>
        ${e.tag ? `<span class="tag">${esc(e.tag.toUpperCase())}</span>` : ''}
      </div>
      <h1 style="font-size: ${e.titleSize}px; margin-top: auto;">${esc(e.title)}</h1>
      <div style="width: 160px; height: 10px; background: var(--c);"></div>
      ${e.sub ? `<p style="font-size: 42px; font-weight: 500; line-height: 1.25; color: #cfcac0; max-width: 18em;">${esc(e.sub)}</p>` : ''}
      <div style="margin-top: auto; margin-bottom: 120px; display: flex; flex-direction: column; gap: 18px; padding-top: 40px;">
        <div class="mono" style="font-size: 38px; font-weight: 700; color: var(--c);">${esc(e.when)}</div>
        ${e.where ? `<div style="font-size: 44px; font-weight: 600; text-transform: uppercase;">${esc(e.where)}</div>` : ''}
        ${e.q ? `<div class="mono" style="font-size: 28px; color: #9a9da5;">Q · ${esc(e.q.toUpperCase())}</div>` : ''}
      </div>
    </div>
    <div class="stamp">PLACEHOLDER</div>
  </div>`,

  // Calendar: giant date numeral on a coloured field, title in the dark lower half.
  e => `
  <div class="poster" style="display: flex; flex-direction: column; background: #111317;">
    <div style="flex: 0 0 46%; background: var(--c); color: #0f1114; padding: 72px 84px; position: relative; overflow: hidden;">
      <div style="position:absolute; inset:0; background: repeating-radial-gradient(circle at 100% 100%, rgba(0,0,0,.06) 0 3px, transparent 3px 40px);"></div>
      <div style="position: relative; display: flex; justify-content: space-between;">
        <span class="brand">F3 THE FORT</span>
        <span class="brand">${esc(e.big ? e.big.day : '')}</span>
      </div>
      ${e.big
        ? `<div style="position: relative; display:flex; align-items: flex-end; gap: 28px; margin-top: 40px;">
             <span style="font-size: 420px; font-weight: 700; line-height: .8;">${e.big.date}</span>
             <span style="font-size: 120px; font-weight: 700; line-height: .9; padding-bottom: 6px;">${e.big.mon}</span>
           </div>`
        : `<div style="position: relative; font-size: 200px; font-weight: 700; line-height: .9; margin-top: 80px;">ANY<br>DAY</div>`}
    </div>
    <div style="flex: 1; padding: 72px 84px 0; display: flex; flex-direction: column; gap: 36px;">
      ${e.tag ? `<span class="mono" style="font-size: 28px; font-weight: 700; color: var(--c); margin-top: 24px;">// ${esc(e.tag.toUpperCase())}</span>` : ''}
      <h1 style="font-size: ${Math.round(e.titleSize * 0.82)}px; margin-top: 12px;">${esc(e.title)}</h1>
      ${e.sub ? `<p style="font-size: 38px; font-weight: 500; line-height: 1.3; color: #cfcac0;">${esc(e.sub)}</p>` : ''}
      <div style="margin-top: auto; margin-bottom: 120px; display: flex; flex-direction: column; gap: 14px;">
        <div class="mono" style="font-size: 32px; font-weight: 700;">${esc(e.when)}</div>
        ${e.where ? `<div class="mono" style="font-size: 30px; color: #9a9da5;">${esc(e.where.toUpperCase())}${e.q ? ` · Q ${esc(e.q.toUpperCase())}` : ''}</div>` : ''}
      </div>
    </div>
    <div class="stamp">PLACEHOLDER</div>
  </div>`,

  // Framed: concentric "gloom" rings, title boxed in the centre.
  e => `
  <div class="poster" style="background:
      repeating-radial-gradient(circle at 50% 42%, rgba(255,255,255,.035) 0 2px, transparent 2px 46px),
      radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--c) 28%, #111317), #0f1114 70%);">
    <div style="position:absolute; inset: 48px; border: 6px solid var(--c);"></div>
    <div style="position: absolute; inset: 48px; padding: 72px 64px; display: flex; flex-direction: column; align-items: center; text-align: center;">
      <span class="brand">F3 <span style="color: var(--c)">THE FORT</span></span>
      ${e.tag ? `<span class="tag" style="margin-top: 28px;">${esc(e.tag.toUpperCase())}</span>` : ''}
      <div style="margin: auto 0; display: flex; flex-direction: column; align-items: center; gap: 40px;">
        <h1 style="font-size: ${e.titleSize}px; background: #0f1114; padding: 36px 44px; border: 2px solid rgba(240,236,228,.15);">${esc(e.title)}</h1>
        ${e.sub ? `<p style="font-size: 38px; font-weight: 500; line-height: 1.3; color: #cfcac0; max-width: 20em;">${esc(e.sub)}</p>` : ''}
      </div>
      <div class="mono" style="font-size: 34px; font-weight: 700; color: var(--c);">${esc(e.when)}</div>
      ${e.where ? `<div style="font-size: 40px; font-weight: 600; text-transform: uppercase; margin-top: 12px;">${esc(e.where)}</div>` : ''}
      ${e.q ? `<div class="mono" style="font-size: 26px; color: #9a9da5; margin-top: 10px; margin-bottom: 40px;">Q · ${esc(e.q.toUpperCase())}</div>` : ''}
    </div>
    <div class="stamp" style="right: 50%; transform: translateX(50%); bottom: 14px; border: 0; background: #0f1114;">PLACEHOLDER</div>
  </div>`,
];

/** Landscape hero for the featured entry. */
const HERO = e => `
  <div class="poster" style="display: flex; background: #111317;">
    <div style="flex: 1; padding: 80px 88px; display: flex; flex-direction: column; gap: 36px;
         background: repeating-linear-gradient(135deg, rgba(255,255,255,.025) 0 2px, transparent 2px 28px);">
      <div style="display:flex; gap: 24px; align-items:center;">
        <span class="brand">F3 <span style="color: var(--c)">THE FORT</span></span>
        ${e.tag ? `<span class="tag" style="font-size: 22px;">${esc(e.tag.toUpperCase())}</span>` : ''}
      </div>
      <h1 style="font-size: ${Math.min(150, e.titleSize + 10)}px; margin-top: auto;">${esc(e.title)}</h1>
      <div style="width: 160px; height: 10px; background: var(--c);"></div>
      ${e.sub ? `<p style="font-size: 36px; font-weight: 500; line-height: 1.3; color: #cfcac0; max-width: 20em;">${esc(e.sub)}</p>` : ''}
      <div class="mono" style="font-size: 30px; font-weight: 700; color: var(--c); margin-bottom: 40px;">${esc(e.when)}${e.where ? ` · ${esc(e.where.toUpperCase())}` : ''}</div>
    </div>
    <div style="flex: 0 0 520px; background: var(--c); color: #0f1114; position: relative; overflow: hidden;
         display: flex; flex-direction: column; justify-content: center; align-items: center;">
      <div style="position:absolute; inset:0; background: repeating-radial-gradient(circle at 0% 50%, rgba(0,0,0,.07) 0 3px, transparent 3px 44px);"></div>
      ${e.big
        ? `<span class="brand" style="position: relative;">${e.big.day}</span>
           <span style="position: relative; font-size: 320px; font-weight: 700; line-height: 1;">${e.big.date}</span>
           <span style="position: relative; font-size: 110px; font-weight: 700; line-height: 1; margin-top: -10px;">${e.big.mon}</span>`
        : `<span style="position: relative; font-size: 200px; font-weight: 700;">F3</span>`}
    </div>
    <div class="stamp">PLACEHOLDER</div>
  </div>`;

function model(entry) {
  const tag = entry.tags?.[0];
  const title = entry.title.replace(/\s*[-–—]\s*it'?s back!*$/i, '').trim() || entry.title;
  const sub = entry.summary && entry.summary.length <= 90 ? entry.summary : (entry.summary || '').slice(0, 87).replace(/\s+\S*$/, '') + (entry.summary ? '…' : '');
  const len = title.length;
  const next = entry.next_occurrence?.date || entry.upcoming_dates?.[0]?.date;
  return {
    title,
    sub,
    tag: tag?.label || '',
    color: tag?.color || TAG_COLORS[tag?.slug] || '#d4a03c',
    when: whenLine(entry),
    where: entry.location || '',
    q: entry.leader || '',
    big: next ? parts(next) : null,
    titleSize: len <= 10 ? 170 : len <= 18 ? 140 : len <= 28 ? 112 : 92,
  };
}

function page(inner, color, w, h) {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}
    <style>:root { --c: ${color}; --w: ${w}px; --h: ${h}px; } ${BASE_CSS}</style></head><body>${inner}</body></html>`;
}

async function login() {
  const r = await fetch(`${NL_URL}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`Admin login failed: ${r.status}`);
  const cookie = (r.headers.getSetCookie?.() || [r.headers.get('set-cookie')]).map(c => c.split(';')[0]).join('; ');
  return cookie;
}

async function main() {
  const res = await fetch(`${NL_URL}/api/public/entries`);
  if (!res.ok) throw new Error(`Could not list entries from ${NL_URL}: ${res.status}`);
  const { items } = await res.json();
  const todo = items.filter(e => ALL || !e.hero_image);
  if (!todo.length) { console.log('Every entry already has an image (use --all to replace them).'); return; }

  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const cookie = DRY ? '' : await login();
  try {
    for (const entry of todo) {
      const m = model(entry);
      const hero = entry.featured;
      const [w, h] = hero ? [1600, 1000] : [1200, 1600];
      const html = hero ? HERO(m) : FLYERS[entry.id % FLYERS.length](m);
      const p = await browser.newPage({ viewport: { width: w, height: h } });
      await p.setContent(page(html, m.color, w, h), { waitUntil: 'networkidle' });
      await p.evaluate(() => document.fonts.ready);
      const file = `placeholder-${entry.slug}.png`;
      await p.screenshot({ path: join(OUT_DIR, file) });
      await p.close();

      if (!DRY) {
        const r = await fetch(`${NL_URL}/api/entries/${entry.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ hero_image: `/uploads/${file}` }),
        });
        if (!r.ok) throw new Error(`PATCH entry ${entry.id} failed: ${r.status} ${await r.text()}`);
      }
      console.log(`${hero ? 'hero  ' : 'flyer '} ${file}${DRY ? ' (not attached)' : ''}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
