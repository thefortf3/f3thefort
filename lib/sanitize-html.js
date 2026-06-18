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

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'div', 'span',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'small', 'sub', 'sup',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code',
  'a', 'img',
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
};

const URL_ATTRS = new Set(['href', 'src']);

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
    walk(child, document);
  }
}

export function sanitizeHtml(html) {
  if (!html) return '';
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
  const { document } = dom.window;
  walk(document.body, document);
  return document.body.innerHTML;
}
