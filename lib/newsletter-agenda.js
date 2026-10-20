// "Agenda" newsletter (design canvas E3): masthead + stat chips, the Nan'tan's quote, one
// featured entry, then every upcoming approved entry as a dated agenda (This week / Coming up /
// Ongoing), the weekly Three F's line and the footer. Pure functions — the generator script
// loads the data and writes the file; this module only selects and renders.

import { addDaysIso } from './dates.js';
import { sanitizeHtml } from './sanitize-html.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const THIS_WEEK_DAYS = 7;

export function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parts(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return { dow: DOW[d.getUTCDay()], mon: MONTHS[d.getUTCMonth()], day: d.getUTCDate() };
}

function textOf(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

/** The entry's summary, or a trimmed excerpt of its description (cut on a word boundary). */
export function summaryOf(entry, max = 260) {
  const s = (entry.summary || '').trim() || textOf(entry.description);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[\s,.;:—-]+$/, '') + '…';
}

/** A thumbnail: the hero image, else the first image in the description. */
export function imageOf(entry) {
  if (entry.hero_image) return entry.hero_image;
  const m = /<img[^>]+src="([^"]+)"/i.exec(entry.description || '');
  return m ? m[1] : null;
}

/**
 * Which approved entries go in the issue, and where.
 * - Excluded: not approved, archived, held from the newsletter, or every date already passed.
 * - featured: the (single) featured entry, shown in the Featured card and not repeated below.
 * - thisWeek: next date within the next 7 days, grouped by that date.
 * - comingUp: every later next date ("everything upcoming"), in date order.
 * - ongoing: entries with no dates at all.
 * Each entry appears once, at its next date; `also` lists its later dates.
 * `isNew`: approved within the last week (i.e. since the previous weekly issue).
 */
export function selectAgenda(entries, today) {
  const weekEnd = addDaysIso(today, THIS_WEEK_DAYS - 1);
  const newSince = addDaysIso(today, -6);
  const eligible = entries.filter(e => e.status === 'approved' && !e.archived_at && !e.hold_from_newsletter
    && (e.next_occurrence || e.occurrences.length === 0));
  const decorate = (e) => ({
    ...e,
    also: e.next_occurrence ? e.occurrences.filter(o => o.date > e.next_occurrence.date).map(o => o.date) : [],
    isNew: !!e.approved_at && e.approved_at.slice(0, 10) >= newSince,
  });

  const featured = eligible.find(e => e.featured) || null;
  const rest = eligible.filter(e => e !== featured).map(decorate);
  const dated = rest.filter(e => e.next_occurrence)
    .sort((a, b) => a.next_occurrence.date.localeCompare(b.next_occurrence.date)
      || (a.next_occurrence.start_time || '').localeCompare(b.next_occurrence.start_time || '')
      || a.title.localeCompare(b.title));

  const thisWeek = [];
  for (const e of dated.filter(x => x.next_occurrence.date <= weekEnd)) {
    const date = e.next_occurrence.date;
    let day = thisWeek.find(d => d.date === date);
    if (!day) thisWeek.push(day = { date, entries: [] });
    day.entries.push(e);
  }
  return {
    featured: featured ? decorate(featured) : null,
    thisWeek,
    comingUp: dated.filter(x => x.next_occurrence.date > weekEnd),
    ongoing: rest.filter(e => !e.next_occurrence).sort((a, b) => a.title.localeCompare(b.title)),
    range: { from: today, to: weekEnd },
  };
}

// ─── Rendering ───────────────────────────────────────────────────────

function tagChip(entry) {
  const t = entry.tags?.[0];
  if (!t) return '';
  return `<span class="tag" style="color:${escapeHtml(t.color || '#9a9da5')};border-color:${escapeHtml(t.color || '#9a9da5')}">${escapeHtml(t.label.toUpperCase())}</span>`;
}

function timeLabel(occ) {
  if (!occ?.start_time) return '';
  return occ.end_time ? `${occ.start_time}–${occ.end_time.replace(':', '')}` : occ.start_time;
}

function alsoLine(dates) {
  if (!dates.length) return '';
  const shown = dates.slice(0, 3).map(d => { const p = parts(d); return `${p.mon.charAt(0)}${p.mon.slice(1).toLowerCase()} ${p.day}`; });
  return `<div class="also">Also ${escapeHtml(shown.join(', '))}${dates.length > 3 ? ` +${dates.length - 3} more` : ''}</div>`;
}

function links(entry, ctx) {
  const out = [`<a class="lnk" href="${escapeHtml(ctx.entryUrl(entry))}">DETAILS ↗</a>`];
  if (entry.preblast_url) out.push(`<a class="lnk" href="${escapeHtml(entry.preblast_url)}">PRE-BLAST ↗</a>`);
  if (entry.link && /^https?:\/\//i.test(entry.link)) out.push(`<a class="lnk" href="${escapeHtml(entry.link)}">LINK ↗</a>`);
  return `<div class="links">${out.join('<span class="sp"> </span>')}</div>`;
}

function weekEntry(e, ctx) {
  const img = imageOf(e);
  const meta = [e.location, e.leader ? `Q: ${e.leader}` : ''].filter(Boolean).join(' · ');
  const body = `
        <div class="when">${escapeHtml(timeLabel(e.next_occurrence))}${tagChip(e)}${e.isNew ? '<span class="new">NEW</span>' : ''}</div>
        <a class="title" href="${escapeHtml(ctx.entryUrl(e))}">${escapeHtml(e.title)}</a>
        ${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ''}
        <p class="sum">${escapeHtml(summaryOf(e))}</p>
        ${alsoLine(e.also)}
        ${links(e, ctx)}`;
  if (!img) return `<div class="item">${body}</div>`;
  return `<div class="item"><table role="presentation" class="split" width="100%"><tr>
        <td class="split-main" valign="top">${body}</td>
        <td class="split-thumb" valign="top" width="72"><a href="${escapeHtml(ctx.entryUrl(e))}"><img class="thumb" src="${escapeHtml(ctx.asset(img))}" width="64" alt="${escapeHtml(e.title)} flyer"></a></td>
      </tr></table></div>`;
}

function dayBlock(day, ctx) {
  const p = parts(day.date);
  return `
    <table role="presentation" class="day" width="100%"><tr>
      <td class="day-label" valign="top" width="52"><div class="dow">${p.dow}</div><div class="dnum">${p.day}</div></td>
      <td class="day-items" valign="top">${day.entries.map(e => weekEntry(e, ctx)).join('')}</td>
    </tr></table>`;
}

function comingRow(e, ctx) {
  const p = parts(e.next_occurrence.date);
  const meta = [timeLabel(e.next_occurrence), e.location, e.leader ? `Q: ${e.leader}` : ''].filter(Boolean).join(' · ');
  return `
    <table role="presentation" class="row" width="100%"><tr>
      <td class="row-date" valign="top" width="52"><div class="dow">${p.mon}</div><div class="dnum dnum--sm">${p.day}</div></td>
      <td valign="top">
        <div class="row-head"><a class="title title--sm" href="${escapeHtml(ctx.entryUrl(e))}">${escapeHtml(e.title)}</a>${tagChip(e)}${e.isNew ? '<span class="new">NEW</span>' : ''}</div>
        <p class="sum sum--sm">${escapeHtml(summaryOf(e, 170))}${meta ? ` <span class="meta-inline">${escapeHtml(meta)}</span>` : ''} <a class="lnk" href="${escapeHtml(ctx.entryUrl(e))}">Details ↗</a></p>
        ${alsoLine(e.also)}
      </td>
    </tr></table>`;
}

function featuredCard(e, ctx) {
  const img = imageOf(e);
  const qs = e.leader ? ` · Q: ${e.leader.toUpperCase()}` : '';
  const when = e.next_occurrence ? (() => { const p = parts(e.next_occurrence.date); return `${p.dow} ${p.mon} ${p.day}`; })() : 'ONGOING';
  return `
  <div class="featured">
    ${img ? `<a href="${escapeHtml(ctx.entryUrl(e))}"><img class="hero" src="${escapeHtml(ctx.asset(img))}" width="568" alt="${escapeHtml(e.title)}"></a>` : ''}
    <div class="featured-body">
      <div class="when"><span class="badge">FEATURED</span><span class="fmeta">${escapeHtml(when + qs)}</span></div>
      <a class="ftitle" href="${escapeHtml(ctx.entryUrl(e))}">${escapeHtml(e.title)}</a>
      <p class="sum">${escapeHtml(summaryOf(e, 420))}</p>
      <div class="links"><a class="btn" href="${escapeHtml(ctx.entryUrl(e))}">DETAILS ↗</a>${e.link && /^https?:\/\//i.test(e.link) ? `<span class="sp"> </span><a class="lnk" href="${escapeHtml(e.link)}">LINK ↗</a>` : ''}</div>
    </div>
  </div>`;
}

function section(title, aside, body, accent) {
  return `
  <div class="section">
    <table role="presentation" class="sec-head${accent ? ' sec-head--accent' : ''}" width="100%"><tr>
      <td class="sec-title">${escapeHtml(title)}</td>
      <td class="sec-aside" align="right">${escapeHtml(aside || '')}</td>
    </tr></table>
    ${body}
  </div>`;
}

function chips(region, ctx) {
  const out = [];
  const f = region.fngStats;
  if (f) {
    out.push(`<span class="chip"><b class="amber">${f.total2026}</b>/${f.goal} FNGs</span>`);
    out.push(`<span class="chip">Day <b>${f.daysElapsed}</b>/365</span>`);
  }
  for (const s of region.shovelFlags || []) {
    out.push(`<span class="chip">Shovel flag: ${escapeHtml(s.from_name)} → ${escapeHtml(s.to_name)}${s.ao ? ` @ ${escapeHtml(s.ao)}` : ''}</span>`);
  }
  for (const v of region.vqs || []) out.push(`<span class="chip">VQ: ${escapeHtml(v.name)}${v.ao ? ` @ ${escapeHtml(v.ao)}` : ''}</span>`);
  if (region.weeklyFngs?.length) out.push(`<span class="chip">FNGs this week: ${escapeHtml(region.weeklyFngs.map(x => x.f3_name).filter(Boolean).join(', '))}</span>`);
  return out.length ? `<div class="chips">${out.join(' ')}</div>` : '';
}

function nantanBlock(n, ctx) {
  if (!n || !textOf(n.text)) return '';
  const html = ctx.rewrite(sanitizeHtml(n.text));
  return `
  <div class="quote">
    <div class="qmark">“</div>
    <div class="qtext">${html}</div>
    <div class="qby">— ${escapeHtml((n.author ? `${n.author}, ` : '') + "THE NAN'TAN").toUpperCase()}</div>
  </div>`;
}

function everyWeek(region) {
  const items = (region.threeFsItems || []).filter(i => i.item_type !== 'link' && i.name);
  const linksHtml = (region.helpfulLinks || []).map(l => `<a class="pill" href="${escapeHtml(l.url)}">${escapeHtml(l.label)} ↗</a>`).join(' ');
  const line = items.map(i => `${escapeHtml(i.name)}${i.detail ? ` <span class="dim">${escapeHtml(i.detail)}</span>` : ''}`).join(' · ');
  return `
  <div class="every">
    ${line ? `<div class="label">EVERY WEEK</div><p class="sum sum--sm">${line}</p>` : ''}
    ${linksHtml ? `<div class="pills">${linksHtml}</div>` : ''}
  </div>`;
}

function footer(region, ctx) {
  const slt = (region.sltEntries || []).map(s => `${escapeHtml(s.name)} <span class="dim">(${escapeHtml(s.role)})</span>`).join(' · ');
  return `
  <div class="footer">
    ${slt ? `<p class="sum sum--sm dim2">Your SLT: ${slt}</p>` : ''}
    <p class="small"><a class="lnk" href="${escapeHtml(ctx.submitUrl)}">SUBMIT AN ENTRY ↗</a><span class="sp"> </span><a class="lnk" href="${escapeHtml(ctx.siteBaseUrl)}">F3THEFORT.COM ↗</a></p>
    <p class="small dim">© ${new Date().getFullYear()} THE FORT F3 · <a class="dim" href="mailto:thefort@f3nation.com">thefort@f3nation.com</a></p>
  </div>`;
}

/**
 * Renders the whole issue into `template` (which carries the CSS and {{TITLE}} / {{BODY}}).
 * ctx: { siteBaseUrl, submitUrl, asset(url) → absolute url, rewrite(html) → html with absolute image urls }
 */
export function renderAgenda(template, { entries, region, today }, ctx) {
  const sel = selectAgenda(entries, today);
  const c = {
    ...ctx,
    entryUrl: (e) => `${ctx.siteBaseUrl.replace(/\/$/, '')}/events/${encodeURIComponent(e.slug || e.id)}`,
  };
  const rp = parts(sel.range.from), rq = parts(sel.range.to);
  const range = rp.mon === rq.mon ? `${rp.mon} ${rp.day} – ${rq.day}` : `${rp.mon} ${rp.day} – ${rq.mon} ${rq.day}`;

  const body = [
    `<table role="presentation" class="mast" width="100%"><tr>
      <td class="brand">THE FORT <span class="amber">WEEKLY</span></td>
      <td class="issue" align="right">WEEK OF ${rp.mon} ${rp.day}</td>
    </tr></table>`,
    chips(region, c),
    nantanBlock(region.nantan, c),
    sel.featured ? featuredCard(sel.featured, c) : '',
    sel.thisWeek.length ? section('THIS WEEK', range, sel.thisWeek.map(d => dayBlock(d, c)).join(''), true) : '',
    sel.comingUp.length ? section('COMING UP', `${sel.comingUp.length} ${sel.comingUp.length === 1 ? 'EVENT' : 'EVENTS'}`, sel.comingUp.map(e => comingRow(e, c)).join('')) : '',
    sel.ongoing.length ? section('ONGOING', '', sel.ongoing.map(e => `
      <div class="ongoing"><a class="title title--sm" href="${escapeHtml(c.entryUrl(e))}">${escapeHtml(e.title)}</a>
        <p class="sum sum--sm">${escapeHtml(summaryOf(e, 200))} <a class="lnk" href="${escapeHtml(c.entryUrl(e))}">Details ↗</a></p></div>`).join('')) : '',
    everyWeek(region),
    footer(region, c),
  ].filter(Boolean).join('\n');

  const title = `The Fort Weekly — week of ${rp.mon.charAt(0)}${rp.mon.slice(1).toLowerCase()} ${rp.day}`;
  return template.replace('{{TITLE}}', escapeHtml(title)).replace('{{BODY}}', body);
}
