#!/usr/bin/env node
/**
 * build-style-previews.mjs — builds the theme's style-preview stylesheet.
 *
 * The homepage style options (palette incl. accent colour · corner shape · heading and label type · section styling
 * · flyer treatment · header) are assembled here from interchangeable ingredients, then every rule
 * is scoped to html[data-fort-style="N"] so the site can switch between them live. Output:
 *   wordpress-theme/fort/assets/style-previews.css    (loaded only when FORT_STYLE_PREVIEW is on)
 *   wordpress-theme/fort/assets/style-previews.json   (names and summaries for the preview frame)
 *
 *   node scripts/build-style-previews.mjs
 *
 * To try a new mix: add or edit an entry in VARIANTS below and re-run. Nothing here affects the
 * live theme styles: the CSS only applies while a style is switched on.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Palettes ───────────────────────────────────────────────────────────────
const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .18  0 0 0 0 .22  0 0 0 0 .12  0 0 0 .09 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`;
const P = {
  dusk: { bg: '#17130f', bgDeep: '#120f0c', panel: '#211b15', panel2: '#2a231b', line: '#2b241c', line2: '#3a3126', text: '#e1d9cb', dim: '#b8ae9d', mute: '#968c7b', bright: '#f6eee0', amber: '#d8a259', amberB: '#e8b972', accent2: '#9fbac8', btnText: '#2a1f12', ink: '#e8b972', inkText: '#2a1f12', card: 'rgba(255,255,255,0.035)', mat: '#eadfc9', dark: true },
  mist: { bg: '#1a1f2d', bgDeep: '#151925', panel: 'rgba(255,255,255,0.04)', panel2: 'rgba(255,255,255,0.07)', line: 'rgba(255,255,255,0.07)', line2: 'rgba(255,255,255,0.13)', text: '#c7cddb', dim: '#a0a8ba', mute: '#858ea3', bright: '#e8e5df', amber: '#e3b595', amberB: '#efc7aa', accent2: '#a9b4d6', btnText: '#2b2433', ink: '#e3b595', inkText: '#2b2433', card: 'rgba(255,255,255,0.045)', mat: '#e6e1d6', dark: true,
    html: 'background-image: radial-gradient(1200px 560px at 50% -120px, rgba(238,176,140,0.22), transparent 70%), linear-gradient(#232b40 0, #1a1f2d 700px); background-repeat: no-repeat;' },
  forest: { bg: '#1b221d', bgDeep: '#151b17', panel: '#232c25', panel2: '#2b362d', line: '#2a342c', line2: '#38453b', text: '#d5dccd', dim: '#aab4a0', mute: '#8a9580', bright: '#eef1e4', amber: '#d6b46a', amberB: '#e3c585', accent2: '#9bc2a4', btnText: '#1b221d', ink: '#9bc2a4', inkText: '#14201a', card: 'rgba(255,255,255,0.035)', mat: '#e9e8d8', dark: true },
  paper: { bg: '#f5f1e8', bgDeep: '#ece6d9', panel: '#ebe5d8', panel2: '#e2dac9', line: '#ddd6c6', line2: '#cbc2ae', text: '#3b3935', dim: '#66615a', mute: '#857f73', bright: '#211f1c', amber: '#b4684a', amberB: '#a04a2e', accent2: '#4d6c85', btnText: '#ffffff', ink: '#211f1c', inkText: '#f5f1e8', card: '#faf7f0', mat: '#fbf9f3', dark: false },
  sage: { bg: '#e6e9dd', bgDeep: '#dce0d0', panel: '#dde2d1', panel2: '#d2d8c4', line: '#cdd3bd', line2: '#b3bc9f', text: '#333a2f', dim: '#5b6453', mute: '#7b8570', bright: '#1f271c', amber: '#a97a2f', amberB: '#86601f', accent2: '#3f7258', btnText: '#ffffff', ink: '#34503f', inkText: '#eef1e4', card: '#eef0e6', mat: '#f8f8f1', dark: false, html: `background-image: ${GRAIN};` },
  // Accent-led palettes. In every palette: amber = the accent fill, amberB = the accent used for text
  // and hover (the field names date from the first, amber-only palettes), accent2 = the second accent.
  cobalt: { bg: '#0d1426', bgDeep: '#0a101e', panel: '#141d36', panel2: '#1b2745', line: '#1c2644', line2: '#2b3a64', text: '#c9d3ea', dim: '#9aa8c8', mute: '#7d8bad', bright: '#f0f4ff', amber: '#4f86f7', amberB: '#7fa8ff', accent2: '#5ee0d0', btnText: '#06112b', ink: '#7fa8ff', inkText: '#06112b', card: 'rgba(255,255,255,0.04)', mat: '#e8edf8', dark: true },
  ember: { bg: '#141212', bgDeep: '#0f0d0d', panel: '#1e1a19', panel2: '#272120', line: '#2a2423', line2: '#3d3432', text: '#ddd5d1', dim: '#b0a6a1', mute: '#8f8480', bright: '#fbf3ee', amber: '#f0583a', amberB: '#ff7a5c', accent2: '#f2d29b', btnText: '#1a0a06', ink: '#f0583a', inkText: '#1a0a06', card: 'rgba(255,255,255,0.035)', mat: '#efe6e0', dark: true },
  daylight: { bg: '#fbfcfc', bgDeep: '#eef3f3', panel: '#eef4f4', panel2: '#e1ecec', line: '#dde6e6', line2: '#c3d3d3', text: '#29383a', dim: '#52666a', mute: '#718487', bright: '#0e1c1e', amber: '#0b7a7a', amberB: '#0b6a6a', accent2: '#e0523d', btnText: '#ffffff', ink: '#0b6a6a', inkText: '#ffffff', card: '#ffffff', mat: '#ffffff', dark: false },
  plum: { bg: '#1c1124', bgDeep: '#150c1c', panel: '#271734', panel2: '#301d40', line: '#33203f', line2: '#4a2f5d', text: '#dccfe5', dim: '#b3a2c1', mute: '#9482a4', bright: '#fbf1ff', amber: '#ee6fa8', amberB: '#ff93c4', accent2: '#b9a2ff', btnText: '#2a0c1c', ink: '#ff93c4', inkText: '#2a0c1c', card: 'rgba(255,255,255,0.04)', mat: '#efe3ee', dark: true },
  volt: { bg: '#14171a', bgDeep: '#0f1214', panel: '#1c2024', panel2: '#242a2f', line: '#262c31', line2: '#38414a', text: '#d3d9de', dim: '#a4adb5', mute: '#838d96', bright: '#f6f9fb', amber: '#c6f432', amberB: '#d8ff55', accent2: '#9fe8ff', btnText: '#12160a', ink: '#c6f432', inkText: '#12160a', card: 'rgba(255,255,255,0.035)', mat: '#eef1ea', dark: true },
  blueprint: { bg: '#f2f6fc', bgDeep: '#e6edf8', panel: '#e9f0fa', panel2: '#dce6f5', line: '#d5e0f0', line2: '#b8c9e3', text: '#25324a', dim: '#4d5d7a', mute: '#6d7c98', bright: '#0f1a33', amber: '#2458d8', amberB: '#1a47b8', accent2: '#e8590c', btnText: '#ffffff', ink: '#1a3a8f', inkText: '#ffffff', card: '#ffffff', mat: '#ffffff', dark: false,
    html: 'background-image: linear-gradient(rgba(36,88,216,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(36,88,216,0.06) 1px, transparent 1px); background-size: 32px 32px;' },
  deepsea: { bg: '#0b1f22', bgDeep: '#081719', panel: '#10292d', panel2: '#153338', line: '#16343a', line2: '#22494f', text: '#cbe0e0', dim: '#9bb8b9', mute: '#7a9a9c', bright: '#effcfb', amber: '#3fd0c0', amberB: '#6ae6d8', accent2: '#f2d8a7', btnText: '#062320', ink: '#6ae6d8', inkText: '#062320', card: 'rgba(255,255,255,0.04)', mat: '#e6efe9', dark: true },
  sunrise: { bg: '#fff6ee', bgDeep: '#fbeadb', panel: '#fbebdd', panel2: '#f6dcc8', line: '#f0dccb', line2: '#e3c6ae', text: '#45332f', dim: '#6e5a54', mute: '#8f7a72', bright: '#2a1814', amber: '#7a3fd1', amberB: '#6228b8', accent2: '#e56a0c', btnText: '#ffffff', ink: '#4a2491', inkText: '#ffffff', card: '#fffaf5', mat: '#fffdfa', dark: false,
    html: 'background-image: linear-gradient(180deg, #ffe6d0 0, #fff6ee 560px); background-repeat: no-repeat;' },
};

const HEADS = '.fort-h2,.fort-h3,.fort-about__title,.fort-featured__title,.fort-entry-title,.fort-coming__title,.fort-bb__title,.fort-fs__name,.fort-card__title,.fort-stat__line,.fort-lineup__ao,.fort-lineup__ao a,.fort-lineup__day';
const LABELS = '.fort-kicker,.fort-label,.fort-meta,.fort-when,.fort-mono-dim,.fort-day__dow';
const CARDS = '.fort-featured,.fort-panel,.fort-card,.fort-bb,.fort-fs__tile,.fort-about__fng,.fort-notice,.fort-band';

function build(o) {
  const p = P[o.palette];
  const R = { square: { c: 0, b: 0, t: 0 }, soft: { c: 6, b: 4, t: 3 }, round: { c: 18, b: 999, t: 999 } }[o.shape];
  const out = [];
  out.push(`:root{--bg:${p.bg};--bg-deep:${p.bgDeep};--panel:${p.panel};--panel-2:${p.panel2};--line:${p.line};--line-2:${p.line2};--text:${p.text};--text-dim:${p.dim};--text-mute:${p.mute};--text-bright:${p.bright};--amber:${p.amber};--amber-bright:${p.amberB};--accent2:${p.accent2};${o.headings === 'serif' ? "--display:'Source Serif 4',Georgia,serif;" : ''}}
html{background-color:${p.bg};${p.html || ''}} body{background:transparent;}
.fort-header{border-bottom:1px solid ${p.line2};} .fort-footer{background:${p.dark ? 'rgba(0,0,0,0.2)' : p.bgDeep};border-top-color:${p.line2};}
.fort-trend rect{fill:${p.dark ? 'rgba(255,255,255,0.14)' : p.line2};}`);

  // Headings
  if (o.headings === 'serif') out.push(`${HEADS}{text-transform:none;letter-spacing:0;font-weight:600;color:${p.bright};}
.fort-brand{font-family:var(--display);text-transform:none;font-weight:600;letter-spacing:0;font-size:26px;} .fort-h2{font-size:30px;} .fort-featured__title{font-size:42px;line-height:1.1;} .fort-about__title{font-size:38px;line-height:1.12;}
.fort-day__num,.fort-coming__num,.fort-stat__num{font-weight:600;} .fort-quote__text{font-family:var(--display);}`);
  if (o.headings === 'sentence') out.push(`${HEADS}{text-transform:none;letter-spacing:0.01em;font-weight:500;color:${p.bright};} .fort-about__title{font-size:40px;line-height:1.1;} .fort-h2{font-size:30px;}`);
  if (o.headings === 'calm') out.push(`${HEADS}{font-weight:400;letter-spacing:0.06em;color:${p.bright};} .fort-featured__title{font-weight:400;letter-spacing:0.04em;} .fort-brand{font-weight:500;} .fort-day__num,.fort-coming__num,.fort-stat__num{font-weight:400;}`);

  // Labels, nav, buttons' type
  if (o.labels === 'italic') out.push(`${LABELS}{font-family:var(--body);font-style:italic;text-transform:none;letter-spacing:0;font-size:14px;color:${p.mute};} .fort-kicker{color:${p.amberB};font-size:15px;}
.fort-nav__list a{font-family:var(--body);text-transform:none;letter-spacing:0;font-size:16px;} .fort-btn{font-family:var(--body);text-transform:none;letter-spacing:0.01em;font-size:15px;font-weight:600;padding:12px 22px;} .fort-more{font-family:var(--body);font-style:italic;letter-spacing:0;font-size:15px;}
.fort-tag,.fort-badge{font-family:var(--body);text-transform:none;letter-spacing:0;font-size:12px;} .fort-js .fort-about__hide{font-family:var(--body);text-transform:none;letter-spacing:0;font-size:13px;} .fort-about-bar__show{font-family:var(--body);letter-spacing:0;font-size:15px;}`);
  if (o.labels === 'plain') out.push(`${LABELS}{font-family:var(--body);text-transform:none;letter-spacing:0.01em;font-size:14px;color:${p.mute};} .fort-kicker{color:${p.amberB};font-size:15px;}
.fort-nav__list a{font-family:var(--body);text-transform:none;letter-spacing:0.02em;font-size:14px;} .fort-btn{font-family:var(--body);text-transform:none;letter-spacing:0.02em;font-size:15px;font-weight:600;padding:12px 22px;} .fort-more{font-family:var(--body);letter-spacing:0.01em;font-size:14px;}
.fort-tag,.fort-badge{font-family:var(--body);text-transform:none;letter-spacing:0.02em;font-size:12px;} .fort-js .fort-about__hide{font-family:var(--body);text-transform:none;letter-spacing:0.01em;font-size:13px;} .fort-about-bar__show{font-family:var(--body);letter-spacing:0.01em;font-size:15px;}`);
  if (o.labels === 'monoLower') out.push(`${LABELS}{text-transform:lowercase;letter-spacing:0.04em;color:${p.mute};} .fort-kicker{color:${p.accent2};}
.fort-nav__list a,.fort-btn,.fort-tag,.fort-badge,.fort-more,.fort-js .fort-about__hide{text-transform:lowercase;letter-spacing:0.04em;} .fort-nav__list a{font-size:13px;} .fort-btn{font-size:13px;padding:13px 20px;}`);
  if (o.labels === 'tracked') out.push(`${LABELS}{color:${p.mute};} .fort-kicker{color:${p.amber};} .fort-nav__list a{letter-spacing:0.08em;} .fort-btn{letter-spacing:0.12em;font-weight:500;}`);

  // Buttons, tags, badges
  const bBg = o.buttons === 'ink' ? p.ink : p.amber, bText = o.buttons === 'ink' ? p.inkText : p.btnText;
  out.push(`.fort-btn{background:${bBg};border-color:${bBg};color:${bText};} .fort-btn:hover{background:${o.buttons === 'ink' ? p.amberB : p.amberB};border-color:${p.amberB};color:${p.dark ? bText : '#fff'};}
.fort-btn--outline,.fort-nav .fort-btn{background:transparent;color:${o.buttons === 'ink' && !p.dark ? p.ink : p.amberB};border-color:${o.buttons === 'ink' && !p.dark ? p.ink : p.amber};}
.fort-btn--outline:hover,.fort-nav .fort-btn:hover{background:${p.dark ? 'rgba(255,255,255,0.08)' : p.ink};color:${p.dark ? p.amberB : p.inkText};}
.fort-tag{color:${p.dim} !important;border-color:${p.line2} !important;} .fort-badge{background:${p.dark ? p.amber : p.amberB};color:${p.dark ? p.btnText : '#fff'};}
.fort-brand .fort-amber{color:${p.amberB};} .fort-more,a.fort-more{color:${p.amberB};} .fort-day__num{color:${p.amberB};} .fort-coming__num{color:${p.dark ? p.accent2 : p.amberB};}
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
  palette: { mist: 'Dawn mist', dusk: 'Warm dusk', forest: 'Forest', paper: 'Paper', sage: 'Sage', cobalt: 'Cobalt night', ember: 'Ember', daylight: 'Daylight teal', plum: 'Plum & rose', volt: 'Volt', blueprint: 'Blueprint', deepsea: 'Deep sea', sunrise: 'Sunrise' },
  shape: { square: 'Square corners', soft: 'Slightly softened corners', round: 'Round corners' },
  headings: { bold: 'Original bold capitals', calm: 'Light, spaced capitals', serif: 'Serif headings', sentence: 'Sentence-case headings' },
  labels: { tracked: 'Tracked mono labels', italic: 'Italic labels', monoLower: 'Lower-case mono labels', plain: 'Plain labels' },
  sections: { rules: 'Hairline rules', dashed: 'Dashed notebook rules', cards: 'Floating cards' },
  flyers: { mat: 'Matted flyers', matte: 'Matte flyers' },
  buttons: { accent: 'Accent buttons', ink: 'Solid ink buttons' },
  header: { bar: 'Plain header', pill: 'Floating pill header' },
};

const VARIANTS = [
  { key: '1', name: 'Mist & prints', summary: 'A low-contrast twilight dark that warms to a peach glow at the top; calm capitals, hairline rules, flyers framed like prints.',
    o: { palette: 'mist', shape: 'soft', headings: 'calm', labels: 'tracked', sections: 'rules', flyers: 'mat', buttons: 'accent', header: 'bar' } },
  { key: '2', name: 'Dusk editorial', summary: 'Warm brown-charcoal with amber, square corners, serif headings and italic labels; a quiet, magazine-like dark.',
    o: { palette: 'dusk', shape: 'square', headings: 'serif', labels: 'italic', sections: 'rules', flyers: 'mat', buttons: 'accent', header: 'bar' } },
  { key: '3', name: 'Forest notes', summary: 'Deep green-grey with sand and sage, dashed notebook rules and lower-case labels; outdoorsy and calm.',
    o: { palette: 'forest', shape: 'soft', headings: 'sentence', labels: 'monoLower', sections: 'dashed', flyers: 'matte', buttons: 'ink', header: 'bar' } },
  { key: '4', name: 'Paper cards', summary: 'Cream paper with a muted rust accent, serif type, floating light cards and a pill-shaped header.',
    o: { palette: 'paper', shape: 'round', headings: 'serif', labels: 'italic', sections: 'cards', flyers: 'mat', buttons: 'ink', header: 'pill' } },
  { key: '5', name: 'Mist float', summary: 'The dawn-mist dark with big rounded floating cards, friendly sentence-case type and a pill header.',
    o: { palette: 'mist', shape: 'round', headings: 'sentence', labels: 'plain', sections: 'cards', flyers: 'matte', buttons: 'accent', header: 'pill' } },
  { key: '6', name: 'Sage soft', summary: 'Pale sage with a faint paper grain, serif headings, dashed rules and matted flyers; a light, earthy look.',
    o: { palette: 'sage', shape: 'soft', headings: 'serif', labels: 'monoLower', sections: 'dashed', flyers: 'mat', buttons: 'ink', header: 'bar' } },
  { key: '7', name: 'Cobalt night', summary: 'Deep navy with a clear cobalt-blue accent and an aqua second colour; soft corners, floating cards, matte flyers.',
    o: { palette: 'cobalt', shape: 'soft', headings: 'sentence', labels: 'plain', sections: 'cards', flyers: 'matte', buttons: 'accent', header: 'bar' } },
  { key: '8', name: 'Ember', summary: 'Near-black warm charcoal with a hot vermilion accent; keeps the bold capitals and square corners, so it still feels like a workout group.',
    o: { palette: 'ember', shape: 'square', headings: 'bold', labels: 'tracked', sections: 'rules', flyers: 'mat', buttons: 'accent', header: 'bar' } },
  { key: '9', name: 'Daylight teal', summary: 'Bright white and pale aqua with a deep teal accent and coral highlights; round cards and a floating pill header. Clean and modern.',
    o: { palette: 'daylight', shape: 'round', headings: 'sentence', labels: 'plain', sections: 'cards', flyers: 'mat', buttons: 'accent', header: 'pill' } },
  { key: '10', name: 'Plum & rose', summary: 'Dark aubergine with a rose-pink accent and lavender second colour; serif headings, italic labels, hairline rules.',
    o: { palette: 'plum', shape: 'soft', headings: 'serif', labels: 'italic', sections: 'rules', flyers: 'mat', buttons: 'accent', header: 'bar' } },
  { key: '11', name: 'Volt', summary: 'Graphite with an electric lime accent: sporty and high-energy. Bold capitals, square corners, dashed rules.',
    o: { palette: 'volt', shape: 'square', headings: 'bold', labels: 'tracked', sections: 'dashed', flyers: 'matte', buttons: 'accent', header: 'bar' } },
  { key: '12', name: 'Blueprint', summary: 'Pale drafting-paper blue with a faint grid, royal-blue accent and safety-orange highlights; lower-case mono labels, dashed rules.',
    o: { palette: 'blueprint', shape: 'square', headings: 'sentence', labels: 'monoLower', sections: 'dashed', flyers: 'mat', buttons: 'ink', header: 'bar' } },
  { key: '13', name: 'Deep sea', summary: 'Dark teal with an aqua accent and sand highlights; serif headings, floating cards, pill header. Calm and a bit nautical.',
    o: { palette: 'deepsea', shape: 'soft', headings: 'serif', labels: 'plain', sections: 'cards', flyers: 'matte', buttons: 'accent', header: 'pill' } },
  { key: '14', name: 'Sunrise', summary: 'Warm cream fading from peach, with a violet accent and tangerine highlights; rounded cards, serif headings, italic labels.',
    o: { palette: 'sunrise', shape: 'round', headings: 'serif', labels: 'italic', sections: 'cards', flyers: 'mat', buttons: 'ink', header: 'bar' } },
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

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '..', 'wordpress-theme', 'fort', 'assets');
let css = `/* Style previews: generated by scripts/build-style-previews.mjs. Applies only while a style is
   switched on (html[data-fort-style]); loaded only when FORT_STYLE_PREVIEW is enabled. */\n`;
const meta = [];
for (const v of VARIANTS) {
  css += `\n/* ${v.key} · ${v.name} */\n${scopeCss(build(v.o), v.key)}`;
  meta.push({
    key: v.key,
    name: v.name,
    summary: v.summary,
    ingredients: [NAMES.palette[v.o.palette] + ' palette', NAMES.shape[v.o.shape], NAMES.headings[v.o.headings], NAMES.labels[v.o.labels], NAMES.sections[v.o.sections], NAMES.flyers[v.o.flyers], NAMES.buttons[v.o.buttons], NAMES.header[v.o.header]],
  });
}
writeFileSync(resolve(assets, 'style-previews.css'), css);
writeFileSync(resolve(assets, 'style-previews.json'), JSON.stringify({ styles: meta }, null, 2) + '\n');
console.log(`Wrote ${VARIANTS.length} styles → wordpress-theme/fort/assets/style-previews.css (${(css.length / 1024).toFixed(1)} KB)`);
