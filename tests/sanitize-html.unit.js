#!/usr/bin/env node
/**
 * Unit tests for the HTML sanitizer (lib/sanitize-html.js).
 *
 * Run:  node --test tests/sanitize-html.unit.js
 */

import { describe, it } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import { sanitizeHtml } from '../lib/sanitize-html.js';

describe('sanitizeHtml — safe content', () => {
  it('preserves allowed formatting tags', () => {
    const out = sanitizeHtml('<p>Hello <strong>world</strong> and <em>friends</em></p>');
    equal(out, '<p>Hello <strong>world</strong> and <em>friends</em></p>');
  });

  it('preserves lists and the editor-supported h3 heading', () => {
    const out = sanitizeHtml('<h3>Title</h3><ul><li>one</li><li>two</li></ul>');
    equal(out, '<h3>Title</h3><ul><li>one</li><li>two</li></ul>');
  });

  it('keeps relative upload image sources', () => {
    const out = sanitizeHtml('<img src="/uploads/pic.png" alt="pic">');
    ok(out.includes('src="/uploads/pic.png"'), 'relative src retained');
    ok(out.includes('alt="pic"'), 'alt retained');
  });

  it('returns empty string for falsy input', () => {
    equal(sanitizeHtml(''), '');
    equal(sanitizeHtml(null), '');
    equal(sanitizeHtml(undefined), '');
  });

  it('keeps safe formatting-toggle style overrides on span/p', () => {
    // These are what document.execCommand actually produces when the rich editor toggles
    // bold/italic/underline on text whose current look comes from something other than
    // <b>/<i>/<u> (e.g. a heading), or when justify-left/center/right is applied.
    const bold = sanitizeHtml('<h3><span style="font-weight: normal;">text</span></h3>');
    equal(bold, '<h3><span style="font-weight: normal">text</span></h3>');

    const align = sanitizeHtml('<p style="text-align: center;">centered</p>');
    equal(align, '<p style="text-align: center">centered</p>');
  });

  it('strips unsafe style properties/values but keeps safe ones in the same attribute', () => {
    const out = sanitizeHtml('<span style="font-weight: normal; background: url(javascript:alert(1)); position: fixed">x</span>');
    equal(out, '<span style="font-weight: normal">x</span>');
  });
});

describe('sanitizeHtml — tags the editor cannot produce', () => {
  it('unwraps tags with no path through the rich editor toolbar, keeping their text', () => {
    // Only h3 is reachable via the toolbar's heading button; h1/h2/h4-h6 (and
    // blockquote/pre/code/s/strike/small/sub/sup) can only arrive via pasted-in markup.
    const out = sanitizeHtml('<h2>Title</h2><blockquote>quote</blockquote><code>x</code>');
    equal(out, 'Titlequotex');
  });

  it('drops style attributes entirely on tags the editor never applies them to', () => {
    const out = sanitizeHtml('<img src="/uploads/x.png" style="position: fixed">');
    ok(!out.includes('style'), 'style dropped on img, which has no style-carrying command');
  });

  it('drops style properties the toolbar has no command for, even on style-carrying tags', () => {
    const out = sanitizeHtml('<span style="color: red; position: fixed">x</span>');
    equal(out, '<span>x</span>');
  });
});

describe('sanitizeHtml — dangerous content', () => {
  it('removes script elements entirely', () => {
    const out = sanitizeHtml('<p>safe</p><script>alert(1)</script>');
    equal(out, '<p>safe</p>');
  });

  it('strips inline event-handler attributes', () => {
    const out = sanitizeHtml('<img src="/uploads/x.png" onerror="alert(1)">');
    ok(!out.includes('onerror'), 'onerror removed');
    ok(out.includes('src="/uploads/x.png"'), 'safe src kept');
  });

  it('drops javascript: URLs but keeps https links', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a><a href="https://ok.com">y</a>');
    ok(!out.includes('javascript:'), 'javascript: scheme removed');
    ok(out.includes('href="https://ok.com"'), 'https link kept');
    ok(out.includes('rel="noopener"'), 'links hardened with rel=noopener');
  });

  it('removes iframes and other embedding tags', () => {
    const out = sanitizeHtml('<div>text<iframe src="//evil"></iframe><object data="x"></object></div>');
    ok(!out.includes('<iframe'), 'iframe removed');
    ok(!out.includes('<object'), 'object removed');
    ok(out.includes('text'), 'surrounding text kept');
  });

  it('unwraps unknown tags but keeps their text', () => {
    const out = sanitizeHtml('<table><tr><td>cell</td></tr></table>');
    ok(!out.includes('<table'), 'table tag removed');
    ok(out.includes('cell'), 'cell text preserved');
  });

  it('strips HTML comments', () => {
    const out = sanitizeHtml('<p>visible</p><!-- secret -->');
    ok(!out.includes('secret'), 'comment removed');
    ok(out.includes('<p>visible</p>'), 'visible content kept');
  });

  it('removes data: URIs from image sources', () => {
    const out = sanitizeHtml('<img src="data:text/html,<script>alert(1)</script>">');
    ok(!out.includes('data:'), 'data URI removed');
  });
});
