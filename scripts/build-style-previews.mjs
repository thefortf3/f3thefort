#!/usr/bin/env node
/**
 * build-style-previews.mjs — builds the theme's style-preview stylesheet.
 *
 * The six homepage style options (palette incl. accent colour · corner shape · heading and label type · section styling
 * · flyer treatment · header) are assembled here from interchangeable ingredients, then every rule
 * is scoped to html[data-fort-style="N"] so the site can switch between them live. Output:
 *   wordpress-theme/fort/assets/style-previews.css    (loaded only when FORT_STYLE_PREVIEW is on)
 *   wordpress-theme/fort/assets/style-previews.json   (names and summaries for the preview frame)
 *   wordpress-theme/fort/assets/newsletter-previews.json (the newsletter in each style: email CSS)
 *
 *   node scripts/build-style-previews.mjs
 *
 * To try a new mix: add or edit an entry in VARIANTS below and re-run. Nothing here affects the
 * live theme styles: the CSS only applies while a style is switched on.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Palettes ───────────────────────────────────────────────────────────────
// In every palette: amber = the accent fill (buttons, badges), amberB = the accent for text and
// hover, accent2 = the second accent. (The names date from the first, amber-only palettes.)
const P = {
  // The gloom: pre-dawn indigo with a faint sunrise at the top; periwinkle accent, dawn-peach second.
  gloom: { bg: '#10172b', bgDeep: '#0c1222', panel: 'rgba(255,255,255,0.045)', panel2: 'rgba(255,255,255,0.075)', line: 'rgba(255,255,255,0.08)', line2: 'rgba(255,255,255,0.15)', text: '#d0d6e8', dim: '#aeb7cf', mute: '#939db8', bright: '#f5f2ee', amber: '#9488ff', amberB: '#b3aaff', accent2: '#ffb48a', btnText: '#0f0b2e', ink: '#b3aaff', inkText: '#0f0b2e', card: 'rgba(255,255,255,0.05)', mat: '#ece8e4', dark: true,
    html: 'background-image: radial-gradient(1100px 480px at 50% -140px, rgba(255,170,130,0.20), transparent 70%), linear-gradient(#19213b 0, #10172b 720px); background-repeat: no-repeat;' },
  // Carolina: clean daylight, Carolina blue with navy ink and a brick-red second colour.
  carolina: { bg: '#f7fafd', bgDeep: '#e8f0f8', panel: '#edf3fa', panel2: '#dfe9f5', line: '#dbe5f0', line2: '#bccde0', text: '#1f2c40', dim: '#43566f', mute: '#56697f', bright: '#0b1a33', amber: '#4b9cd3', amberB: '#1d6aa3', accent2: '#a8352a', btnText: '#06203a', ink: '#13294b', inkText: '#ffffff', card: '#ffffff', mat: '#ffffff', dark: false },
  // Brick & stone: limestone paper, brick-red accent, charcoal ink, slate-blue second.
  brick: { bg: '#f4efe8', bgDeep: '#e9e2d7', panel: '#ebe4d9', panel2: '#e0d8ca', line: '#dcd3c4', line2: '#c6bba8', text: '#34302b', dim: '#5a534a', mute: '#6b6359', bright: '#1d1a17', amber: '#a63a2b', amberB: '#8f2e21', accent2: '#3f5873', btnText: '#ffffff', ink: '#26231f', inkText: '#f4efe8', card: '#faf6ef', mat: '#fbf8f2', dark: false },
  // Trailhead: dark olive with terracotta and a pale olive second.
  trail: { bg: '#1a1d14', bgDeep: '#14160f', panel: '#22261b', panel2: '#2a2f21', line: '#2b3022', line2: '#3d442f', text: '#dcdfcf', dim: '#b4b9a1', mute: '#979d82', bright: '#f4f3e4', amber: '#d8764a', amberB: '#eb9168', accent2: '#bccb84', btnText: '#1d0d05', ink: '#eb9168', inkText: '#1d0d05', card: 'rgba(255,255,255,0.035)', mat: '#ebe6d6', dark: true },
  // Volt: graphite with an electric lime accent and an ice-blue second.
  volt: { bg: '#14171a', bgDeep: '#0f1214', panel: '#1c2024', panel2: '#242a2f', line: '#262c31', line2: '#38414a', text: '#d3d9de', dim: '#aab3bb', mute: '#8f99a2', bright: '#f6f9fb', amber: '#c6f432', amberB: '#d8ff55', accent2: '#9fe8ff', btnText: '#12160a', ink: '#c6f432', inkText: '#12160a', card: 'rgba(255,255,255,0.035)', mat: '#eef1ea', dark: true },
  // Fellowship: bright white and pale aqua, deep teal accent, coral second.
  daylight: { bg: '#fbfcfc', bgDeep: '#eef3f3', panel: '#eef4f4', panel2: '#e1ecec', line: '#dde6e6', line2: '#c3d3d3', text: '#29383a', dim: '#4c5f63', mute: '#5c6f72', bright: '#0e1c1e', amber: '#0b7a7a', amberB: '#0b6a6a', accent2: '#c2412e', btnText: '#ffffff', ink: '#0b6a6a', inkText: '#ffffff', card: '#ffffff', mat: '#ffffff', dark: false },
};

const HEADS = '.fort-h2,.fort-h3,.fort-about__title,.fort-featured__title,.fort-entry-title,.fort-coming__title,.fort-bb__title,.fort-fs__name,.fort-card__title,.fort-stat__line,.fort-lineup__ao,.fort-lineup__ao a,.fort-lineup__day';
const LABELS = '.fort-kicker,.fort-label,.fort-meta,.fort-when,.fort-mono-dim,.fort-day__dow';
const CARDS = '.fort-featured,.fort-panel,.fort-card,.fort-bb,.fort-fs__tile,.fort-about__fng,.fort-notice,.fort-band';

function build(o) {
  const p = P[o.palette];
  const R = { square: { c: 0, b: 0, t: 0 }, soft: { c: 6, b: 4, t: 3 }, round: { c: 18, b: 999, t: 999 } }[o.shape];
  const out = [];
  out.push(`:root{--bg:${p.bg};--bg-deep:${p.bgDeep};--panel:${p.panel};--panel-2:${p.panel2};--line:${p.line};--line-2:${p.line2};--text:${p.text};--text-dim:${p.dim};--text-mute:${p.mute};--text-bright:${p.bright};--amber:${p.amber};--amber-bright:${p.amberB};--accent2:${p.accent2};${p.dark ? '' : '--map-tiles:none;'}${o.headings === 'serif' ? "--display:'Source Serif 4',Georgia,serif;" : ''}}
html{background-color:${p.bg};${p.html || ''}} body{background:transparent;}
.fort-header{border-bottom:1px solid ${p.line2};} .fort-footer{background:${p.dark ? 'rgba(0,0,0,0.2)' : p.bgDeep};border-top-color:${p.line2};}
.fort-trend rect{fill:${p.dark ? 'rgba(255,255,255,0.14)' : p.line2};}`);

  // Headings
  if (o.headings === 'serif') out.push(`${HEADS}{text-transform:none;letter-spacing:0;font-weight:600;color:${p.bright};}
.fort-brand{font-family:var(--display);text-transform:none;font-weight:600;letter-spacing:0;font-size:26px;} .fort-h2{font-size:30px;} .fort-featured__title{font-size:42px;line-height:1.1;} .fort-about__title{font-size:38px;line-height:1.12;}
.fort-day__num,.fort-coming__num,.fort-stat__num{font-weight:600;} .fort-quote__text{font-family:var(--display);}`);
  if (o.headings === 'sentence') out.push(`${HEADS}{text-transform:none;letter-spacing:0.01em;font-weight:500;color:${p.bright};} .fort-about__title{font-size:40px;line-height:1.1;} .fort-h2{font-size:30px;}`);
  if (o.headings === 'calm') out.push(`${HEADS}{font-weight:400;letter-spacing:0.06em;color:${p.bright};} .fort-featured__title{font-weight:400;letter-spacing:0.04em;} .fort-brand{font-weight:500;} .fort-day__num,.fort-coming__num,.fort-stat__num{font-weight:400;}`);

  // Readable sizes for every style: members are mostly men in their 30s to 50s, reading on phones, so
  // the base theme's 10-12px mono labels go up (body 18px, labels 13px, buttons and nav 14px).
  out.push(`body{font-size:18px;} .fort-label,.fort-meta,.fort-mono-dim,.fort-when,.fort-day__dow,.fort-kicker{font-size:13px;}
.fort-more,.fort-nav__list a,.fort-btn{font-size:14px;} .fort-tag,.fort-badge,.fort-js .fort-about__hide{font-size:12px;}`);

  // Labels, nav, buttons' type
  if (o.labels === 'italic') out.push(`${LABELS}{font-family:var(--body);font-style:italic;text-transform:none;letter-spacing:0;font-size:14px;color:${p.mute};} .fort-kicker{color:${p.amberB};font-size:15px;}
.fort-nav__list a{font-family:var(--body);text-transform:none;letter-spacing:0;font-size:16px;} .fort-btn{font-family:var(--body);text-transform:none;letter-spacing:0.01em;font-size:15px;font-weight:600;padding:12px 22px;} .fort-more{font-family:var(--body);font-style:italic;letter-spacing:0;font-size:15px;}
.fort-tag,.fort-badge{font-family:var(--body);text-transform:none;letter-spacing:0;font-size:12px;} .fort-js .fort-about__hide{font-family:var(--body);text-transform:none;letter-spacing:0;font-size:13px;} .fort-about-bar__show{font-family:var(--body);letter-spacing:0;font-size:15px;}`);
  if (o.labels === 'plain') out.push(`${LABELS}{font-family:var(--body);text-transform:none;letter-spacing:0.01em;font-size:14px;color:${p.mute};} .fort-kicker{color:${p.amberB};font-size:15px;}
.fort-nav__list a{font-family:var(--body);text-transform:none;letter-spacing:0.02em;font-size:14px;} .fort-btn{font-family:var(--body);text-transform:none;letter-spacing:0.02em;font-size:15px;font-weight:600;padding:12px 22px;} .fort-more{font-family:var(--body);letter-spacing:0.01em;font-size:14px;}
.fort-tag,.fort-badge{font-family:var(--body);text-transform:none;letter-spacing:0.02em;font-size:12px;} .fort-js .fort-about__hide{font-family:var(--body);text-transform:none;letter-spacing:0.01em;font-size:13px;} .fort-about-bar__show{font-family:var(--body);letter-spacing:0.01em;font-size:15px;}`);
  if (o.labels === 'monoLower') out.push(`${LABELS}{text-transform:lowercase;letter-spacing:0.04em;color:${p.mute};} .fort-kicker{color:${p.accent2};}
.fort-nav__list a,.fort-btn,.fort-tag,.fort-badge,.fort-more,.fort-js .fort-about__hide{text-transform:lowercase;letter-spacing:0.04em;} .fort-nav__list a{font-size:14px;} .fort-btn{font-size:14px;padding:13px 20px;}`);
  if (o.labels === 'tracked') out.push(`${LABELS}{color:${p.mute};} .fort-kicker{color:${p.amber};} .fort-nav__list a{letter-spacing:0.08em;} .fort-btn{letter-spacing:0.12em;font-weight:500;}`);

  // Buttons, tags, badges
  const bBg = o.buttons === 'ink' ? p.ink : p.amber, bText = o.buttons === 'ink' ? p.inkText : p.btnText;
  out.push(`.fort-btn{background:${bBg};border-color:${bBg};color:${bText};} .fort-btn:hover{background:${o.buttons === 'ink' ? p.amberB : p.amberB};border-color:${p.amberB};color:${p.dark ? bText : '#fff'};}
.fort-btn--outline,.fort-nav .fort-btn{background:transparent;color:${o.buttons === 'ink' && !p.dark ? p.ink : p.amberB};border-color:${o.buttons === 'ink' && !p.dark ? p.ink : p.amber};}
.fort-btn--outline:hover,.fort-nav .fort-btn:hover{background:${p.dark ? 'rgba(255,255,255,0.08)' : p.ink};color:${p.dark ? p.amberB : p.inkText};}
.fort-tag{color:${p.dim} !important;border-color:${p.line2} !important;} .fort-badge{background:${p.dark ? p.amber : p.amberB};color:${p.dark ? p.btnText : '#fff'};}
.fort-brand .fort-amber{color:${p.amberB};} .fort-more,a.fort-more{color:${p.amberB};} .fort-day__num{color:${p.amberB};} .fort-coming__num{color:${p.dark ? p.accent2 : p.amberB};}
.fort-chip.is-current{color:${onFill(p.accent2)};} .fort-pagination .current,.fort-skip{color:${onFill(p.amber)};}
.fort-principles__head{color:${p.accent2};} .fort-principles__list li::before{color:${p.dark ? p.accent2 : p.amberB};}`);

  // Shape
  out.push(`${CARDS}{border-radius:${R.c}px;overflow:hidden;} .fort-about,.fort-js .fort-about{border-radius:${R.c ? R.c + 6 : 0}px;} .fort-btn,.fort-btn--outline,.fort-nav .fort-btn,.fort-js .fort-about__hide{border-radius:${R.b}px;}
.fort-tag,.fort-badge{border-radius:${R.t}px;} .fort-about-bar{border-radius:${R.c}px;} .fort-thumb img,.fort-entry__hero img,.fort-featured__media img{border-radius:${Math.min(R.c, 12)}px;}`);

  // Sections
  const S = o.sections;
  if (S === 'rules') out.push(`.fort-section__head,.fort-side-section__head{border-bottom:0;border-top:1px solid ${p.bright};padding-top:12px;} .fort-day,.fort-coming{border-bottom-color:${p.line};}
.fort-featured{background:${p.dark ? p.card : p.panel};border:0;} .fort-fs__tile{background:${p.dark ? p.card : p.panel};border:0;} .fort-about__fng{background:${p.dark ? p.card : p.panel};border-left:3px solid ${p.amber};} .fort-about{background:transparent;}
.fort-js .fort-about{background:${p.dark ? 'transparent' : p.card};border:1px solid color-mix(in srgb, ${p.amber} 55%, transparent);} .fort-about-bar{background:${p.card};border:1px solid ${p.line2};}`);
  if (S === 'dashed') out.push(`.fort-section__head,.fort-section__head--amber,.fort-section__head--accent2,.fort-side-section__head{border-bottom:1px dashed ${p.line2};} .fort-day,.fort-coming{border-bottom:1px dashed ${p.line2};}
.fort-featured{background:${p.dark ? p.card : p.panel};border:0;} .fort-fs__tile{background:transparent;border:1px dashed ${p.line2};} .fort-about__fng{background:${p.dark ? p.card : p.panel};border-left:3px solid ${p.amber};}
.fort-js .fort-about{border:1px solid color-mix(in srgb, ${p.amber} 55%, transparent);} .fort-about-bar{background:${p.card};border:1px dashed ${p.line2};}`);
  if (S === 'cards') out.push(`.fort-section__head,.fort-section__head--amber,.fort-section__head--accent2{border-bottom:0;padding-bottom:6px;} .fort-side-section__head{border-bottom:1px solid ${p.line2};}
.fort-featured{background:${p.dark ? 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))' : p.card};border:1px solid ${p.line2};box-shadow:0 14px 40px rgba(${p.dark ? '0,0,0,0.35' : '70,55,30,0.12'});}
.fort-fs__tile{background:${p.card};border:1px solid ${p.line};} .fort-about__fng{background:color-mix(in srgb, ${p.amber} 10%, transparent);border:1px solid color-mix(in srgb, ${p.amber} 28%, transparent);}
.fort-about{background:${p.dark ? 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.025))' : p.card};border:1px solid ${p.line2};box-shadow:0 14px 40px rgba(${p.dark ? '0,0,0,0.3' : '70,55,30,0.1'});}
.fort-js .fort-about{border:1px solid color-mix(in srgb, ${p.amber} 50%, transparent);} .fort-about-bar{background:${p.card};border:1px solid ${p.line2};}
.fort-day{background:${p.card};border:1px solid ${p.line};border-radius:${R.c}px;padding:22px 24px;margin-top:12px;} .fort-day__date{border-radius:${Math.min(R.c, 14)}px;background:color-mix(in srgb, ${p.amber} 12%, transparent);padding:8px 0;}
.fort-coming{background:${p.card};border:1px solid ${p.line};border-radius:${Math.max(R.c - 4, 0)}px;padding:16px 18px;margin:6px 0;}`);

  // Flyers
  if (o.flyers === 'mat') out.push(`.fort-featured__media{background:transparent;padding:24px;} .fort-featured__media img,.fort-thumb img{border:7px solid ${p.mat};box-shadow:0 3px 12px rgba(0,0,0,${p.dark ? '0.4' : '0.2'});} .fort-thumb img{border-width:4px;}`);
  if (o.flyers === 'matte') out.push(`.fort-featured__media{background:rgba(0,0,0,0.12);} .fort-featured__media img,.fort-thumb img{filter:saturate(0.88) brightness(0.97);outline:1px solid rgba(255,255,255,0.12);outline-offset:-1px;}`);

  // Header
  if (o.header === 'pill') out.push(`.fort-header{border-bottom:0;background:transparent;padding:14px 0 0;} .fort-header__inner{background:${p.dark ? 'rgba(255,255,255,0.045)' : p.card};border:1px solid ${p.line2};border-radius:${R.c ? 999 : 0}px;padding:12px 14px 12px 26px;max-width:calc(1200px - 64px);}
.fort-nav__list a{padding:8px 12px;border-radius:999px;} @media (max-width:720px){.fort-header{padding:10px 12px 0;}.fort-header__inner{border-radius:22px;padding:14px 16px;}.fort-js .fort-about{padding:28px 20px 70px;}.fort-day{padding:16px;}}`);
  return out.join('\n');
}

const NAMES = {
  palette: { gloom: 'Gloom indigo', carolina: 'Carolina blue', brick: 'Brick & stone', trail: 'Olive & terracotta', volt: 'Graphite & lime', daylight: 'White & teal' },
  shape: { square: 'Square corners', soft: 'Slightly softened corners', round: 'Round corners' },
  headings: { bold: 'Original bold capitals', calm: 'Light, spaced capitals', serif: 'Serif headings', sentence: 'Sentence-case headings' },
  labels: { tracked: 'Tracked mono labels', italic: 'Italic labels', monoLower: 'Lower-case mono labels', plain: 'Plain labels' },
  sections: { rules: 'Hairline rules', dashed: 'Dashed notebook rules', cards: 'Floating cards' },
  flyers: { mat: 'Matted flyers', matte: 'Matte flyers' },
  buttons: { accent: 'Accent buttons', ink: 'Solid ink buttons' },
  header: { bar: 'Plain header', pill: 'Floating pill header' },
};

// What the six are built from (shown in the preview frame under "Why these six").
const BASIS = [
  'Who reads it: F3 members are mostly men in their 30s to 50s (local reports put the typical man in his early 40s, with a range from late 20s to 70), professionals with families. So every style uses bigger type (18px body, 13px+ labels instead of 10-12px) and the build checks contrast (WCAG AA, 4.5:1) for every text colour.',
  'How they read it: mostly on phones, and early (workouts start before dawn, in "the gloom"). So there are dark options for 5am scrolling and light options for daytime, and the phone layout is checked for each.',
  'Where: The Fort is Fort Mill / the Carolinas. Two styles lean on that: Carolina blue, and brick and stone for "The Fort".',
  'What is popular in 2026: earth tones (olive and terracotta especially), one saturated accent on a calm neutral base, large expressive headings, and accessibility-first colour. The six cover each of those.',
  'What you have liked so far: dark, condensed capitals, quieter rather than rounded-everything, and no fixed accent colour. So only two of the six are rounded, and the six use six different accent hues.',
  'Limits: there is no official F3 Nation colour palette to follow, and no survey of members; the audience notes come from local news coverage of F3 groups.',
];

const VARIANTS = [
  { key: '1', name: 'Gloom', summary: 'Pre-dawn indigo with a faint sunrise glow, a periwinkle accent and dawn-peach highlights; soft floating cards.',
    why: 'Named for F3’s own word for the pre-dawn workout. A calm dark for reading at 5am that is softer than the current near-black, with an accent nobody else in local fitness uses.',
    o: { palette: 'gloom', shape: 'soft', headings: 'sentence', labels: 'plain', sections: 'cards', flyers: 'matte', buttons: 'accent', header: 'bar' } },
  { key: '2', name: 'Carolina', summary: 'Clean daylight white with Carolina blue, navy ink and brick-red highlights; big plain type and hairline rules.',
    why: 'Local pride, and the most readable of the six: dark text on white at large sizes, the safest choice for men in their 40s and 50s reading in daylight.',
    o: { palette: 'carolina', shape: 'soft', headings: 'sentence', labels: 'plain', sections: 'rules', flyers: 'mat', buttons: 'accent', header: 'bar' } },
  { key: '3', name: 'Brick & stone', summary: 'Limestone paper, brick-red accent and charcoal ink; serif headings, italic labels, matted flyers, square corners.',
    why: 'Takes "The Fort" literally, with a heritage men’s-club feel like the editorial run-club brands. Grown-up and warm, and it reads like a newsletter.',
    o: { palette: 'brick', shape: 'square', headings: 'serif', labels: 'italic', sections: 'rules', flyers: 'mat', buttons: 'ink', header: 'bar' } },
  { key: '4', name: 'Trailhead', summary: 'Dark olive with a terracotta accent and pale-olive highlights; dashed notebook rules and lower-case labels.',
    why: 'The 2026 earth-tone trend (olive and terracotta) applied to an outdoor group that works out in parking lots and parks in all weather. Earthy without being beige.',
    o: { palette: 'trail', shape: 'soft', headings: 'sentence', labels: 'monoLower', sections: 'dashed', flyers: 'matte', buttons: 'accent', header: 'bar' } },
  { key: '5', name: 'Volt', summary: 'Graphite with an electric lime accent; keeps the bold condensed capitals and square corners.',
    why: 'The closest to what you have now, re-coloured: the sporty, high-energy look of current training brands, one saturated accent on a dark neutral. Best for pulling in younger guys.',
    o: { palette: 'volt', shape: 'square', headings: 'bold', labels: 'tracked', sections: 'rules', flyers: 'matte', buttons: 'accent', header: 'bar' } },
  { key: '6', name: 'Fellowship', summary: 'Bright white and pale aqua with a deep teal accent and coral highlights; round cards and a floating pill header.',
    why: 'The friendliest first impression, for the FNG who finds the site before his first post: open, modern, welcoming, and calm rather than hardcore.',
    o: { palette: 'daylight', shape: 'round', headings: 'sentence', labels: 'plain', sections: 'cards', flyers: 'mat', buttons: 'accent', header: 'pill' } },
];

// Scope every rule to html[data-fort-style="N"]. (.fort-js is a class on <html> itself, and :root
// and html are the same element, so those join without a space.)
function splitTop(s, sep) {
  let depth = 0, cur = '';
  const out = [];
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
function scopeSelector(sel, scope) {
  if (sel === ':root' || sel === 'html') return scope;
  if (sel.startsWith('.fort-js')) return scope + sel;
  return `${scope} ${sel}`;
}
function scopeCss(css, key) {
  const scope = `html[data-fort-style="${key}"]`;
  let i = 0;
  let out = '';
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    out += prelude.startsWith('@media')
      ? `${prelude}{\n${scopeCss(body, key)}}\n`
      : `${splitTop(prelude, ',').map(s => scopeSelector(s.trim(), scope)).join(',\n')}{${body}}\n`;
    i = j;
  }
  return out;
}

// Contrast check (WCAG AA, 4.5:1) for each palette's text colours. Translucent panels are judged
// against the page background. Fails the build, so a style can't ship hard-to-read text.
function lum(hex) {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }
// Near-black or white, whichever reads better on a filled accent.
function onFill(c) { return ratio('#0d0e10', c) >= ratio('#ffffff', c) ? '#0d0e10' : '#ffffff'; }
const problems = [];
for (const v of VARIANTS) {
  const p = P[v.o.palette];
  const grounds = [p.bg, ...[p.panel, p.card].filter(c => c.startsWith('#'))];
  const pairs = [['text', p.text], ['dim', p.dim], ['mute', p.mute], ['accent text', p.amberB], ['accent2', p.accent2]].flatMap(([n, c]) => grounds.map(g => [n, c, g]));
  pairs.push(['selected chip', onFill(p.accent2), p.accent2], ['selected page', onFill(p.amber), p.amber]);
  pairs.push(['button', v.o.buttons === 'ink' ? p.inkText : p.btnText, v.o.buttons === 'ink' ? p.ink : p.amber]);
  for (const [n, c, g] of pairs) { const r = ratio(c, g); if (r < 4.5) problems.push(`${v.key} ${v.name}: ${n} ${c} on ${g} is ${r.toFixed(2)}:1`); }
}
if (problems.length) { console.error('Contrast below 4.5:1:\n  ' + problems.join('\n  ')); process.exit(1); }

// ── The newsletter in each style ───────────────────────────────────────────
// The same ingredients as email CSS, added after the Fort Weekly template's own (templates/
// newsletter-agenda.html) and inlined with it, so the preview is what Mailchimp gets. Email can't
// do what the site does: no var(), rgba, gradients, shadows, filters or pseudo-elements, px only
// (the rules are in the template's header comment). Translucent site colours are flattened onto
// the background here, and emailProblems() below fails the build on anything that slips through.

// A colour as solid hex: rgba(...) mixed onto the background.
function solid(c, bg) {
  const m = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(c);
  if (!m) return c;
  const n = parseInt(bg.slice(1), 16), b = [n >> 16, (n >> 8) & 255, n & 255], a = Number(m[4]);
  return '#' + [1, 2, 3].map(i => Math.round(Number(m[i]) * a + b[i - 1] * (1 - a)).toString(16).padStart(2, '0')).join('');
}

// $hex at $a opacity over $ground, as solid hex (color-mix() for email).
function tint(hex, ground, a) {
  const n = parseInt(hex.slice(1), 16);
  return solid(`rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`, ground);
}

const EF = {
  display: "'Oswald', 'Arial Narrow', Arial, sans-serif",
  serif: "'Source Serif 4', Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', 'Courier New', monospace",
};
// The template's label-like text (mono, small, capitals), and its headings.
const E_LABELS = '.issue,.qby,.fmeta,.sec-aside,.dow,.when,.meta,.meta-inline,.also,.label,.small,.lnk,.pill,.lg-label,.lg-value';
const E_CAPS = '.brand,.issue,.qby,.badge,.fmeta,.btn,.sec-title,.sec-aside,.dow,.tag,.new,.label,.lg-label,.links .lnk,.small .lnk,.copy';
const E_HEADS = '.brand,.ftitle,.sec-title,.title';

function buildEmail(o) {
  const p = P[o.palette], s = c => solid(c, p.bg);
  const panel = s(p.panel), panel2 = s(p.panel2), card = s(p.card), line = s(p.line), line2 = s(p.line2);
  const R = { square: { c: 0, b: 0, t: 0 }, soft: { c: 6, b: 4, t: 3 }, round: { c: 16, b: 999, t: 999 } }[o.shape];
  const bBg = o.buttons === 'ink' ? p.ink : p.amber, bText = o.buttons === 'ink' ? p.inkText : p.btnText;
  const out = [];

  // Colours
  out.push(`body,.canvas,.canvas-cell{background-color:${p.bg};} body{color:${p.text};} a,.amber{color:${p.amberB};}
.brand{color:${p.bright};} .issue,.qby,.fmeta,.sec-aside,.dow,.when,.meta-inline,.also,.label,.dim{color:${p.mute};} .meta,.sum--sm,.dim2{color:${p.dim};} .sum{color:${p.text};}
.ledger{border-top-color:${line2};} .lg-label{color:${p.mute};border-bottom-color:${line};} .lg-value{color:${p.text};border-bottom-color:${line};} .lg-value b{color:${p.bright};} .lg-value b.amber{color:${p.amberB};} .lg-last{border-bottom-color:${line2};}
.bar-fill{background-color:${p.amber};} .bar-rest{background-color:${line2};}
.qmark{color:${p.amber};} .qtext,.ftitle,.sec-title,.title{color:${p.bright};}
.badge{background-color:${p.amber};color:${p.btnText};} .btn{background-color:${bBg};color:${bText};} .new{background-color:${p.amberB};color:${onFill(p.amberB)};}
.tag{color:${p.dim} !important;border-color:${line2} !important;} .lnk{color:${p.amberB};} .pill{background-color:${panel2};color:${p.amberB};}
.sec-head{border-bottom-color:${line2};} .sec-head--accent{border-bottom-color:${p.amber};} .dnum{color:${p.amberB};} .dnum--sm{color:${p.text};} .thumb{background-color:${line};}
.day,.row,.ongoing{border-bottom-color:${line};} .every,.footer{border-top-color:${line};}
.featured{background-color:${p.dark ? card : panel};border-color:${line2};}`);

  // Readable sizes, as on the site: body text 16px and labels 12px+ (the template's are 10-11px).
  out.push(`.sum{font-size:16px;} .sum--sm{font-size:15px;} .qtext{font-size:19px;} .title{font-size:19px;} .title--sm{font-size:17px;}
${E_LABELS}{font-size:12px;} .lg-value{font-size:13px;} .badge,.new,.tag{font-size:11px;} .btn{font-size:13px;}`);

  // Headings
  if (o.headings === 'sentence') out.push(`${E_HEADS}{text-transform:none;font-weight:500;letter-spacing:0.2px;} .brand{font-size:25px;font-weight:600;} .sec-title{font-size:24px;} .ftitle{font-size:26px;}`);
  if (o.headings === 'serif') out.push(`${E_HEADS},.dnum,.qmark{font-family:${EF.serif};text-transform:none;letter-spacing:0;font-weight:600;} .brand{font-size:26px;} .sec-title{font-size:24px;} .ftitle{font-size:28px;line-height:1.15;}`);
  if (o.headings === 'calm') out.push(`${E_HEADS},.dnum{font-weight:400;letter-spacing:1.5px;}`);

  // Labels
  if (o.labels === 'plain' || o.labels === 'italic') {
    out.push(`${E_LABELS},.badge,.new,.tag,.btn{font-family:${EF.serif};letter-spacing:0;} ${E_CAPS}{text-transform:none;}
${E_LABELS}{font-size:14px;} .lg-value{font-size:15px;} .btn{font-size:15px;font-weight:600;padding:11px 18px;} .badge,.new,.tag{font-size:12px;}`);
    // The brand and headings keep their own heading treatment.
    if (o.headings === 'bold' || o.headings === 'calm') out.push(`.brand,.sec-title{text-transform:uppercase;}`);
  }
  if (o.labels === 'italic') out.push(`.issue,.qby,.fmeta,.sec-aside,.when,.meta,.meta-inline,.also,.label,.dow,.lnk,.lg-label{font-style:italic;}`);
  // Lower-case labels, but not where people's and AOs' names appear (the week's names, bylines, the Q).
  if (o.labels === 'monoLower') out.push(`.issue,.badge,.btn,.sec-aside,.dow,.tag,.new,.label,.lg-label,.links .lnk,.small .lnk,.copy,.lnk{text-transform:lowercase;letter-spacing:0.4px;} .qby,.fmeta{text-transform:none;letter-spacing:0.4px;}`);

  // Shape
  out.push(`.pill,.badge,.tag,.new{border-radius:${R.t}px;} .bar-fill,.bar-rest{border-radius:${Math.min(R.t, 3)}px;} .btn{border-radius:${R.b}px;} .thumb{border-radius:${Math.min(R.c, 8)}px;}`);

  // Sections
  if (o.sections === 'rules') out.push(`.sec-head,.sec-head--accent{border-bottom-width:0;border-top:1px solid ${p.bright};} .sec-title,.sec-aside{padding-top:10px;padding-bottom:6px;} .featured{border-width:0;} .ledger{border-top-color:${p.bright};}`);
  if (o.sections === 'dashed') out.push(`.sec-head{border-bottom:1px dashed ${line2};} .sec-head--accent{border-bottom:1px dashed ${p.amber};} .day,.row,.ongoing{border-bottom:1px dashed ${line2};} .every,.footer{border-top:1px dashed ${line2};} .featured{border:1px dashed ${line2};} .lg-label,.lg-value{border-bottom:1px dashed ${line2};} .ledger{border-top:1px dashed ${line2};}`);
  // In the card styles each day's date sits on a tinted column that runs the height of the day, as
  // on the homepage: a <td> background does that by itself, and the cell spacing (a cellspacing
  // attribute) insets it.
  if (o.sections === 'cards') out.push(`.sec-head,.sec-head--accent{border-bottom-width:0;} .sec-title,.sec-aside{padding-bottom:4px;}
.featured{background-color:${card};border:1px solid ${line2};border-radius:${R.c}px;}
.day{background-color:${card};border:1px solid ${line};border-radius:${R.c}px;border-collapse:separate;border-spacing:8px;margin-top:10px;}
.day-label{background-color:${tint(p.amber, card, 0.14)};border-radius:${Math.min(R.c, 10)}px;padding:12px 0;} .day-label .dow{color:${p.dim};} .day-items{padding:6px 8px 6px 6px;}
.row{background-color:${card};border:1px solid ${line};border-radius:${R.c}px;border-collapse:separate;border-spacing:0;margin-top:10px;}
.ledger{background-color:${card};border:1px solid ${line};border-radius:${R.c}px;border-collapse:separate;border-spacing:0;} .lg-label{padding-left:14px;} .lg-value{padding-right:14px;} .lg-last{border-bottom-width:0;} .row-date{padding-left:12px;} .row td{padding-right:14px;}
.ongoing{background-color:${card};border:1px solid ${line};border-radius:${R.c}px;padding:12px 14px;margin-top:10px;}`);
  else out.push(`.featured{border-radius:${R.c}px;}`);
  // The flyer sits inside the featured card, so it rounds on its own rather than at the card's corners.
  out.push(`.hero{border-radius:${Math.min(R.c, 8)}px;}`);

  // Flyers: a mat on the thumbnails (email has no image filters, so "matte" stays as is).
  if (o.flyers === 'mat') out.push(`.thumb{border:3px solid ${p.mat};}`);

  // Header
  if (o.header === 'pill') out.push(`.mast{background-color:${card};border:1px solid ${line2};border-radius:999px;border-collapse:separate;border-spacing:0;} .brand{padding:12px 0 12px 20px;} .issue{padding:12px 20px 12px 0;}`);
  return out.join('\n');
}

// What email can't carry over from each style's site version, shown under the preview.
function emailNotes(o) {
  const notes = [];
  if (P[o.palette].html) notes.push('The sunrise glow behind the page is site-only (email has no gradients); the email gets the plain indigo.');
  if (o.flyers === 'matte') notes.push('Flyers are shown as they are: email has no image filters to tone them down.');
  if (o.sections === 'cards') notes.push('Cards have no drop shadows in email, just a border.');
  if (o.shape !== 'square') notes.push('Outlook for Windows shows square corners.');
  if (!P[o.palette].dark) notes.push('Gmail and Outlook phone apps in dark mode may darken a light email themselves; this can’t be prevented.');
  return notes;
}

// The email rules in plain words, for the preview frame (the same list as the template's header).
const EMAIL_RULES = [
  'What you see here is the email exactly as it goes to Mailchimp: the style is added to the newsletter’s own CSS and inlined with it, the same way the Save as Mailchimp draft button does.',
  'Email keeps the old newsletter’s compromises: solid colours only (no CSS variables, see-through colours, gradients or shadows), real tables for layout, no decorative pseudo-elements, pixel sizes, 600px wide with the phone layout at 480px.',
  'Gmail drops the web fonts, so each style falls back to Arial Narrow, Georgia and Courier New there. Tick “Gmail fonts” to see that. Apple Mail and the iPhone Mail app show the web fonts.',
  'Gmail cuts off emails over 102 KB (“Message clipped”). The size of this issue is shown above the preview.',
];

// Fails the build on CSS email clients don't support (the rules in the template's header).
const EMAIL_BANNED = [
  [/var\(/, 'var()'], [/color-mix/, 'color-mix()'], [/rgba?\(|hsla?\(/, 'rgba()/hsl()'], [/gradient/, 'gradients'],
  [/box-shadow/, 'box-shadow'], [/filter\s*:/, 'filters'], [/(^|[^-])transform\s*:/, 'transform'], [/position\s*:/, 'position'],
  [/::?(before|after)/, 'pseudo-elements'], [/display\s*:\s*(flex|grid|inline-flex)/, 'flex/grid'], [/clamp\(|calc\(/, 'clamp()/calc()'],
  [/\d(rem|em|vw|vh)\b/, 'rem/em/vw units'], [/margin[\w-]*\s*:[^;}]*-\d/, 'negative margins'], [/@import/, '@import'], [/Impact/i, 'Impact'], [/\/\//, 'a // comment (not CSS: it breaks the next rule)'],
];
function emailProblems(name, css) {
  const found = EMAIL_BANNED.filter(([re]) => re.test(css)).map(([, what]) => `${name}: ${what}`);
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
    if (!/(serif|sans-serif|monospace)\s*$/.test(m[1].trim())) found.push(`${name}: font stack without a system fallback: ${m[1]}`);
  }
  for (const m of css.matchAll(/@media[^{]*\{([\s\S]*?\})\s*\}/g)) {
    for (const d of m[1].matchAll(/[\w-]+\s*:\s*([^;}]+)/g)) if (!/!important/.test(d[1])) found.push(`${name}: @media rule without !important: ${d[0]}`);
  }
  return found;
}

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '..', 'wordpress-theme', 'fort', 'assets');
const template = readFileSync(resolve(here, '..', 'wordpress-plugin', 'fort-weekly', 'templates', 'newsletter-agenda.html'), 'utf8');
const emailIssues = emailProblems('newsletter-agenda.html', (/<style>([\s\S]*?)<\/style>/.exec(template) || [])[1] || '');
const email = {};
for (const v of VARIANTS) {
  const p = P[v.o.palette], css = buildEmail(v.o);
  emailIssues.push(...emailProblems(`${v.key} ${v.name}`, css));
  // The email's own pairs (link pills sit on panel2; NEW is a filled accent).
  const panel2 = solid(p.panel2, p.bg);
  for (const [n, c, g] of [['pill', p.amberB, panel2], ['new', onFill(p.amberB), p.amberB], ['badge', p.btnText, p.amber]]) {
    const r = ratio(c, g); if (r < 4.5) emailIssues.push(`${v.key} ${v.name}: ${n} ${c} on ${g} is ${r.toFixed(2)}:1`);
  }
  // The day's date on its tinted column (the card styles).
  if (v.o.sections === 'cards') {
    const col = tint(p.amber, solid(p.card, p.bg), 0.14);
    for (const [n, c] of [['date', p.amberB], ['weekday', p.dim]]) {
      const r = ratio(c, col); if (r < 4.5) emailIssues.push(`${v.key} ${v.name}: ${n} ${c} on the date column ${col} is ${r.toFixed(2)}:1`);
    }
  }
  email[v.key] = { scheme: p.dark ? 'dark' : 'light', css, notes: emailNotes(v.o) };
}
if (emailIssues.length) { console.error('Newsletter styles break the email rules:\n  ' + emailIssues.join('\n  ')); process.exit(1); }
let css = `/* Style previews: generated by scripts/build-style-previews.mjs. Applies only while a style is
   switched on (html[data-fort-style]); loaded only when FORT_STYLE_PREVIEW is enabled. */\n`;
const meta = [];
for (const v of VARIANTS) {
  css += `\n/* ${v.key} · ${v.name} */\n${scopeCss(build(v.o), v.key)}`;
  meta.push({
    key: v.key,
    name: v.name,
    summary: v.summary,
    why: v.why,
    ingredients: [NAMES.palette[v.o.palette] + ' palette', NAMES.shape[v.o.shape], NAMES.headings[v.o.headings], NAMES.labels[v.o.labels], NAMES.sections[v.o.sections], NAMES.flyers[v.o.flyers], NAMES.buttons[v.o.buttons], NAMES.header[v.o.header]],
  });
}
writeFileSync(resolve(assets, 'style-previews.css'), css);
writeFileSync(resolve(assets, 'style-previews.json'), JSON.stringify({ basis: BASIS, styles: meta }, null, 2) + '\n');
writeFileSync(resolve(assets, 'newsletter-previews.json'), JSON.stringify({ rules: EMAIL_RULES, styles: email }, null, 2) + '\n');
console.log(`Wrote ${VARIANTS.length} styles → wordpress-theme/fort/assets/style-previews.css (${(css.length / 1024).toFixed(1)} KB) and newsletter-previews.json`);
