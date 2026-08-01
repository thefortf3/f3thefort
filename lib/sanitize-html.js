import { JSDOM } from 'jsdom';

// Allowlist-based HTML sanitizer for user-submitted rich text (event descriptions,
// pre-blast content). Submissions arrive from a public, unauthenticated endpoint and
// are later rendered with innerHTML in the admin editor and inlined into the generated
// newsletter, so untrusted markup must be stripped to prevent stored XSS.
//
// Parsing happens through jsdom (a real DOM) rather than regex: tags not on the
// allowlist are unwrapped (their text is kept), known script-bearing tags are removed
// outright, and every surviving attribute is checked against a per-tag allowlist with
// URL scheme validation.
//
// ALLOWED_TAGS intentionally matches what initRichEditor() (public/js/app.js) can actually
// produce — its toolbar (bold/italic/underline/link/image/H3/lists/align) plus what Chromium's
// contenteditable generates on its own (<div> as the default paragraph separator on Enter,
// <br> on Shift+Enter, <b>/<i>/<u> from execCommand). Tags with no path through the editor
// (blockquote, pre, code, s/strike, small, sub, sup, h1/h2/h4/h5/h6, hr) are stripped rather
// than allowed-through, since the only way they'd appear is pasted-in markup the editor itself
// can't create or clean back up.
const ALLOWED_TAGS = new Set([
  'p', 'div', 'br',
  'strong', 'b', 'em', 'i', 'u',
  'ul', 'ol', 'li',
  'h3',
  'a', 'img', 'span',
]);

// Tags that carry executable content or load external resources — removed with their
// contents so no script text leaks back into the document as visible text.
const DANGEROUS_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
  'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select',
]);

const ALLOWED_ATTRS = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height'],
  // execCommand falls back to a style="" override — instead of adding/removing a semantic
  // tag — whenever the formatting it's toggling doesn't come from a tag it recognizes as
  // that format. Two toolbar buttons hit this: Bold/Italic/Underline on text whose current
  // look comes from something other than <b>/<i>/<u> (e.g. a heading's default bold weight)
  // wraps the selection in <span style="font-weight: normal">; justify-left/center/right
  // sets style="text-align: …" directly on the enclosing block. Without 'style' surviving
  // sanitization on these tags, toggling the formatting off appears to work in the editor
  // but silently reverts the next time the entry is opened, because the override that was
  // suppressing the inherited look gets stripped on save.
  span: ['style'],
  p: ['style'],
  div: ['style'],
  li: ['style'],
  h3: ['style'],
};

const URL_ATTRS = new Set(['href', 'src']);

// h3/span/strong/b/em/i/u are phrasing-only per the HTML content model — a real browser
// parser still lets them nest a block element (it's a validity rule, not a parsing rule),
// which is exactly how a stray <h3><p>…</p></h3> ends up stored: the H3 toolbar button
// applied a heading around text that was already a <p>, wrapping instead of replacing it.
// The result renders with the heading's own font-size/margins baked into the newsletter
// template's default h3 styling — a bold-weight override alone (see STYLE_PROPS below)
// only fixes the color, not the size/spacing mismatch against ordinary body text.
// Since the toolbar has no "convert heading back to a paragraph" affordance, once one of
// these ends up wrapping block content it can never be produced there intentionally — so
// on sanitize we unwrap the phrasing tag itself rather than the block content it's holding.
const BLOCK_TAGS = new Set(['p', 'div', 'ul', 'ol', 'li']);
const PHRASING_ONLY_TAGS = new Set(['h3', 'span', 'strong', 'b', 'em', 'i', 'u']);

function hasBlockChild(el) {
  return [...el.children].some(c => BLOCK_TAGS.has(c.tagName.toLowerCase()));
}

// Inline style is otherwise a stored-XSS vector (url(), expression(), etc.), so instead of
// allowing the raw attribute, only the specific properties the toolbar can produce survive,
// and only with safe keyword values — never arbitrary strings.
const STYLE_PROPS = {
  'font-weight': /^(normal|bold|bolder|lighter|[1-9]00)$/,
  'font-style': /^(normal|italic|oblique)$/,
  'text-decoration': /^(none|underline|line-through|overline)$/,
  'text-decoration-line': /^(none|underline|line-through|overline)$/,
  'text-align': /^(left|center|right|justify)$/,
};

function scrubStyle(value) {
  const kept = [];
  for (const decl of (value || '').split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim().toLowerCase();
    const pattern = STYLE_PROPS[prop];
    if (pattern && pattern.test(val)) kept.push(`${prop}: ${val}`);
  }
  return kept.join('; ');
}

function isSafeUrl(value) {
  const v = (value || '').trim();
  if (!v) return false;
  if (v.startsWith('/') || v.startsWith('#')) return true; // relative / fragment
  return /^(https?:|mailto:|tel:)/i.test(v); // blocks javascript:, data:, vbscript:, etc.
}

function scrubElement(el) {
  const tag = el.tagName.toLowerCase();
  const allowed = ALLOWED_ATTRS[tag] || [];
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (!allowed.includes(name)) {
      el.removeAttribute(attr.name);
    } else if (URL_ATTRS.has(name) && !isSafeUrl(attr.value)) {
      el.removeAttribute(attr.name);
    } else if (name === 'style') {
      const scrubbed = scrubStyle(attr.value);
      if (scrubbed) el.setAttribute('style', scrubbed);
      else el.removeAttribute('style');
    }
  }
  if (tag === 'a') el.setAttribute('rel', 'noopener'); // harden external links
}

function walk(node, document) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8) { // comment node — could hide conditional-comment scripts
      child.remove();
      continue;
    }
    if (child.nodeType !== 1) continue; // keep text nodes as-is

    const tag = child.tagName.toLowerCase();
    if (DANGEROUS_TAGS.has(tag)) {
      child.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown but not inherently dangerous: unwrap, preserving its (sanitized) children.
      walk(child, document);
      while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
      child.remove();
      continue;
    }
    scrubElement(child);
    walk(child, document); // normalize descendants first — bottom-up, so nested cases collapse cleanly

    // A heading with block content, or with no text of its own (just an image, just a
    // line break), was never produced by intentionally clicking the H3 button on a title —
    // that always heading-ifies an existing text selection. Both patterns mean the H3
    // button was clicked on the wrong thing and wrapped body content it shouldn't have.
    const isEmptyHeading = tag === 'h3' && child.textContent.trim() === '';
    if ((PHRASING_ONLY_TAGS.has(tag) && hasBlockChild(child)) || isEmptyHeading) {
      // child's own children are already normalized; unwrap child itself, same as an
      // unrecognized tag, so its content survives as a direct sibling instead of carrying
      // the heading's font-size/margin styling it was never meant to have.
      while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
      child.remove();
    }
  }
}

export function sanitizeHtml(html) {
  if (!html) return '';
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
  const { document } = dom.window;
  walk(document.body, document);
  return document.body.innerHTML;
}
