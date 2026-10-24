<?php
/**
 * /style-preview/colors/ — one of the preview styles in other colours (see inc/style-preview.php).
 * Pick a style, then a page background, an accent and a second accent (or a ready-made set): the
 * style is rebuilt in the browser by assets/style-builder.js, the same code that builds the real
 * styles, and added to the framed site. The rest of the palette (greys, text, lines, cards) is
 * worked out from the three colours and nudged to pass 4.5:1; anything that still doesn't pass is
 * listed. The newsletter is loaded without inlining (?raw=1) so the recoloured CSS can go after the
 * template's; the real email is inlined when it's saved. Choices live in the address
 * (?style=7&bg=…&a=…&a2=…) so a combination can be shared; nothing is saved.
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

$pages   = fort_style_preview_pages();
$preview = fort_style_preview_data();
$builder = get_template_directory() . '/assets/style-builder.js';
$config  = array(
	'styles'    => $preview['styles'],
	'pages'     => array_map( function ( $p ) { return array( 'label' => $p[0], 'url' => $p[1] ); }, $pages ),
	'builder'   => get_template_directory_uri() . '/assets/style-builder.js?ver=' . ( is_readable( $builder ) ? filemtime( $builder ) : '0' ),
	'stylesUrl' => home_url( '/style-preview/' ),
);
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Style colors — <?php bloginfo( 'name' ); ?></title>
<style>
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { display: flex; flex-direction: column; background: #0d0e11; color: #e9e7e1; font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; }
button, select, input { font: inherit; color: inherit; }
.bar { flex: none; background: #171a1f; border-bottom: 1px solid #2c3037; padding: 10px 14px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 9px; }
.row { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
.title { font-weight: 700; letter-spacing: 0.01em; }
.hint { color: #9aa0ab; }
.links { margin-left: auto; display: flex; gap: 16px; }
.bar a { color: #9fc3e6; text-decoration: none; }
.bar a:hover { text-decoration: underline; }
.seg { display: inline-flex; border: 1px solid #3a3f48; border-radius: 8px; overflow: hidden; max-width: 100%; overflow-x: auto; }
.seg button { background: transparent; border: 0; border-right: 1px solid #3a3f48; padding: 7px 12px; cursor: pointer; white-space: nowrap; color: #c8ccd4; }
.seg button:last-child { border-right: 0; }
.seg button:hover { background: #22262d; }
.seg button[aria-pressed="true"] { background: #e4b866; color: #1b1608; font-weight: 600; }
label { display: inline-flex; align-items: center; gap: 6px; color: #b4b9c2; }
select { background: #1f2329; border: 1px solid #3a3f48; border-radius: 6px; padding: 6px 8px; }
:focus-visible { outline: 2px solid #9fc3e6; outline-offset: 2px; }

/* The three colours */
.picks { display: flex; flex-wrap: wrap; gap: 8px; }
.pick { display: inline-flex; align-items: center; gap: 8px; padding: 4px 8px 4px 4px; background: #1f2329; border: 1px solid #3a3f48; border-radius: 8px; }
.pick input[type="color"] { width: 34px; height: 30px; padding: 0; border: 1px solid #4a505a; border-radius: 6px; background: none; cursor: pointer; }
.pick input[type="color"]::-webkit-color-swatch-wrapper { padding: 2px; }
.pick input[type="color"]::-webkit-color-swatch { border: 0; border-radius: 4px; }
.pick span { color: #c8ccd4; font-size: 13px; }
.pick input[type="text"] { width: 78px; padding: 4px 6px; background: #14171b; border: 1px solid #3a3f48; border-radius: 5px; font: 12px/1.2 ui-monospace, 'SF Mono', Menlo, monospace; color: #e9e7e1; }
.pick input[type="text"][aria-invalid="true"] { border-color: #ff9c8a; }
.btn { background: #1f2329; border: 1px solid #3a3f48; border-radius: 6px; padding: 6px 10px; cursor: pointer; color: #c8ccd4; white-space: nowrap; }
.btn:hover { background: #2a2f37; }
.btn[aria-pressed="true"] { border-color: #e4b866; color: #f1efe8; }

/* Ready-made sets: three dots each */
.sets { display: flex; flex-wrap: wrap; gap: 6px; }
.set { display: inline-flex; align-items: center; gap: 7px; background: transparent; border: 1px solid #343941; border-radius: 999px; padding: 3px 10px 3px 4px; cursor: pointer; color: #b4b9c2; font-size: 12px; }
.set:hover { border-color: #5a606b; color: #e9e7e1; }
.set[aria-pressed="true"] { border-color: #e4b866; color: #f1efe8; }
.dots { display: inline-flex; }
.dots i { width: 16px; height: 16px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.25); margin-right: -5px; }
.dots i:last-child { margin-right: 0; }

/* The palette worked out from the three, and the contrast result */
.result { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; font-size: 13px; color: #aab0bb; }
.swatches { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.sw { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px 2px 2px; border: 1px solid #2c3037; border-radius: 999px; font-size: 11px; color: #9aa0ab; }
.sw i { width: 14px; height: 14px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2); }
.ok { color: #9be39b; }
.warn { color: #ffb38a; }
details.issues { color: #ffb38a; }
details.issues summary { cursor: pointer; }
details.issues ul { margin: 6px 0 0; padding-left: 18px; color: #d8c2b6; max-height: 120px; overflow: auto; }
.status { color: #9be39b; font-size: 12px; min-width: 6ch; }

main { flex: 1; min-height: 0; display: flex; gap: 10px; padding: 10px; }
.pane { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.pane[hidden] { display: none; }
.cap { color: #9aa0ab; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cap b { color: #f1efe8; }
.view { flex: 1; min-height: 0; overflow: hidden; display: flex; justify-content: center; align-items: flex-start; background: repeating-linear-gradient(45deg, #101216 0 10px, #0d0e11 10px 20px); border: 1px solid #23262c; border-radius: 10px; }
.shell { flex: none; transform-origin: top left; }
.shell iframe { display: block; border: 0; background: #fff; }
@media (max-width: 900px) { main { flex-direction: column; } .hint { display: none; } }
@media (max-width: 600px) {
	.bar { padding: 8px 10px; gap: 7px; }
	.row > .seg { flex: 1 1 100%; }
	.row > .seg button { flex: 1 0 auto; }
	.sets { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 2px; }
	.set { flex: none; white-space: nowrap; }
	.picks { flex-wrap: nowrap; gap: 6px; }
	.pick { flex: 1 1 0; min-width: 0; padding: 3px 6px 3px 3px; gap: 6px; }
	.pick input[type="text"] { display: none; } /* The picker shows the hex; the box is for desktop. */
	.pick span { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.btn { padding: 5px 9px; font-size: 13px; }
	.swatches { display: none; }
	main { padding: 8px; }
}
</style>
</head>
<body>
<header class="bar">
	<div class="row">
		<span class="title">Style colors</span>
		<span class="hint">Any style in other colors: same layout and type. Nothing here is saved or published.</span>
		<span class="links"><a id="toStyles" href="<?php echo esc_url( home_url( '/style-preview/' ) ); ?>">← All styles</a><a href="<?php echo esc_url( home_url( '/' ) ); ?>">Open the site ↗</a></span>
	</div>
	<div class="row">
		<div class="seg" id="styles" role="group" aria-label="Style"></div>
		<div class="seg" id="widths" role="group" aria-label="Width">
			<button type="button" data-w="desktop" aria-pressed="true">Desktop</button>
			<button type="button" data-w="tablet" aria-pressed="false">Tablet</button>
			<button type="button" data-w="phone" aria-pressed="false">Phone</button>
		</div>
		<label>Page <select id="page"></select></label>
		<label id="gmailWrap" hidden title="Gmail drops the web fonts: see the fallbacks it uses"><input type="checkbox" id="gmail"> Gmail fonts</label>
		<label title="Show the style in its own colors next to yours"><input type="checkbox" id="side"> Side by side with its own colors</label>
	</div>
	<div class="row">
		<div class="picks">
			<label class="pick" title="Page background"><input type="color" id="c-bg" aria-label="Page background"><span>Page</span><input type="text" id="t-bg" spellcheck="false" maxlength="7" aria-label="Page background (hex)"></label>
			<label class="pick"><input type="color" id="c-a" aria-label="Accent"><span>Accent</span><input type="text" id="t-a" spellcheck="false" maxlength="7" aria-label="Accent (hex)"></label>
			<label class="pick"><input type="color" id="c-a2" aria-label="Second accent"><span>Second</span><input type="text" id="t-a2" spellcheck="false" maxlength="7" aria-label="Second accent (hex)"></label>
		</div>
		<button type="button" class="btn" id="own">Its own colors</button>
		<button type="button" class="btn" id="swap" title="Swap the accent and the second accent">Swap accents</button>
		<button type="button" class="btn" id="copyLink">Copy link</button>
		<button type="button" class="btn" id="copyPalette" title="The whole palette as JSON, for building it in">Copy palette</button>
		<span class="status" id="status" role="status"></span>
	</div>
	<div class="row"><div class="sets" id="sets" role="group" aria-label="Ready-made colors"></div></div>
	<div class="result" id="result"></div>
</header>
<main id="stage">
	<section class="pane" id="paneA"><div class="cap" id="capA"></div><div class="view"><div class="shell"><iframe id="frameA" title="Site preview in your colors" loading="eager"></iframe></div></div></section>
	<section class="pane" id="paneB" hidden><div class="cap" id="capB"></div><div class="view"><div class="shell"><iframe id="frameB" title="Site preview in the style's own colors" loading="eager"></iframe></div></div></section>
</main>
<script>
(function () {
  'use strict';
  var CFG = <?php echo wp_json_encode( $config, JSON_HEX_TAG | JSON_HEX_AMP ); ?>;
  import(CFG.builder).then(start, function () {
    document.getElementById('result').textContent = 'The style builder (assets/style-builder.js) did not load, so colors can’t be changed here.';
  });

  function start(SB) {
    var WIDTHS = { desktop: 1280, tablet: 820, phone: 390 };
    var HEX = /^#?([0-9a-f]{6})$/i;
    var $ = function (id) { return document.getElementById(id); };
    var q = new URLSearchParams(location.search);
    var variant = function (k) { return SB.VARIANTS.filter(function (v) { return v.key === k; })[0]; };
    var hex = function (v) { var m = HEX.exec(v || ''); return m ? '#' + m[1].toLowerCase() : null; };
    var first = CFG.styles.length ? CFG.styles[CFG.styles.length - 1].key : '1';
    var state = {
      style: variant(q.get('style')) ? q.get('style') : first,
      page: CFG.pages[q.get('page')] ? q.get('page') : 'home',
      w: WIDTHS[q.get('w')] ? q.get('w') : (window.innerWidth <= 600 ? 'phone' : 'desktop'),
      gmail: q.get('gm') === '1',
      side: q.get('side') === '1',
      // null = the style's own palette; otherwise the three colours the rest is worked out from.
      colors: hex(q.get('bg')) && hex(q.get('a')) && hex(q.get('a2')) ? { bg: hex(q.get('bg')), a: hex(q.get('a')), a2: hex(q.get('a2')) } : null
    };
    function isEmail() { return state.page === 'newsletter'; }
    function el(tag, attrs, text) { var e = document.createElement(tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); if (text) e.textContent = text; return e; }

    // Ready-made sets: each style's own three, then some others worth a look.
    var SETS = [];
    var seen = {};
    SB.VARIANTS.forEach(function (v) {
      var p = SB.P[v.o.palette], id = p.bg + p.amber + p.accent2;
      if (seen[id]) return;
      seen[id] = true;
      SETS.push({ name: v.name, bg: p.bg, a: p.amber, a2: p.accent2 });
    });
    [
      { name: 'Fort amber (now)', bg: '#0d0e10', a: '#d4a03c', a2: '#8fb4d8' },
      { name: 'Navy & gold', bg: '#0f1a2e', a: '#e0b23c', a2: '#7fc8f8' },
      { name: 'Forest & orange', bg: '#142019', a: '#f08a24', a2: '#a7d3a6' },
      { name: 'Charcoal & red', bg: '#161616', a: '#e5484d', a2: '#f5c26b' },
      { name: 'Slate & cyan', bg: '#1b2430', a: '#22d3ee', a2: '#fbbf24' },
      { name: 'Black & safety orange', bg: '#101010', a: '#ff6b1a', a2: '#c9d1d9' },
      { name: 'Paper & navy', bg: '#f5f1e8', a: '#1f3a5f', a2: '#b5562b' },
      { name: 'White & orange', bg: '#ffffff', a: '#ff6b1a', a2: '#2563eb' },
      { name: 'Sky & charcoal', bg: '#eef4f8', a: '#1e6fb8', a2: '#d1495b' }
    ].forEach(function (s) { SETS.push(s); });

    // The palette and CSS for the current choice.
    function own() { return SB.P[variant(state.style).o.palette]; }
    function palette() { return state.colors ? SB.derivePalette(state.colors.bg, state.colors.a, state.colors.a2) : own(); }
    function three() { var p = own(); return state.colors || { bg: p.bg, a: p.amber, a2: p.accent2 }; }

    // Controls
    var stylesBar = $('styles');
    CFG.styles.forEach(function (s) { stylesBar.appendChild(el('button', { type: 'button', 'data-s': s.key, 'aria-pressed': 'false', title: s.summary }, s.key + ' · ' + s.name)); });
    Object.keys(CFG.pages).forEach(function (k) { $('page').appendChild(el('option', { value: k }, CFG.pages[k].label)); });
    SETS.forEach(function (s, i) {
      var b = el('button', { type: 'button', 'class': 'set', 'data-i': String(i), 'aria-pressed': 'false', title: s.bg + ' · ' + s.a + ' · ' + s.a2 });
      var d = el('span', { 'class': 'dots' });
      [s.bg, s.a, s.a2].forEach(function (c) { var dot = el('i'); dot.style.background = c; d.appendChild(dot); });
      b.appendChild(d);
      b.appendChild(document.createTextNode(s.name));
      $('sets').appendChild(b);
    });

    // Frames. A: your colours (the style rebuilt and added to the page). B: the style as it is.
    var frames = { A: $('frameA'), B: $('frameB') };
    function inject(which) {
      var f = frames[which], d;
      try { d = f.contentDocument; } catch (e) { return; }
      if (!d || !d.documentElement || !d.head) return;
      if (which === 'B') return; // The style's own CSS is already on the page (site) or inlined (email).
      var p = palette(), v = variant(state.style);
      var css = isEmail() ? SB.buildEmail(v.o, p) : SB.scopeCss(SB.build(v.o, p), 'x');
      var tag = d.getElementById('fort-colors');
      if (!tag) { tag = d.createElement('style'); tag.id = 'fort-colors'; d.head.appendChild(tag); }
      tag.textContent = css;
      if (isEmail()) {
        d.querySelectorAll('meta[name="color-scheme"], meta[name="supported-color-scheme"]').forEach(function (m) { m.setAttribute('content', p.dark ? 'dark' : 'light'); });
      } else {
        d.documentElement.setAttribute('data-fort-style', 'x');
      }
    }
    var syncing = false;
    function hook(which) {
      var f = frames[which];
      f.addEventListener('load', function () {
        inject(which);
        caption(which);
        try {
          var w = f.contentWindow, d = w.document;
          d.addEventListener('click', function (ev) { // Links off this site open in a new tab, not in the frame.
            var a = ev.target.closest && ev.target.closest('a[href]');
            if (a && a.origin && a.origin !== location.origin) { ev.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
          });
          w.addEventListener('scroll', function () {
            if (!state.side || syncing) return;
            var o = frames[which === 'A' ? 'B' : 'A'].contentWindow;
            var max = function (x) { return Math.max(1, x.document.documentElement.scrollHeight - x.innerHeight); };
            syncing = true;
            o.scrollTo(0, (w.scrollY / max(w)) * max(o));
            setTimeout(function () { syncing = false; }, 30);
          }, { passive: true });
        } catch (e) { /* not this site's page */ }
      });
    }
    hook('A'); hook('B');

    function caption(which) {
      var f = frames[which], cap = $(which === 'A' ? 'capA' : 'capB'), path = '';
      try { path = f.contentWindow.location.pathname; } catch (e) { path = ''; }
      var v = variant(state.style);
      cap.innerHTML = '';
      cap.appendChild(el('b', {}, v.key + ' · ' + v.name));
      var mine = which === 'A' && state.colors;
      cap.appendChild(document.createTextNode(mine ? ' in your colors' : ' in its own colors'));
      if (isEmail()) cap.appendChild(document.createTextNode(which === 'A' ? ' · email as a browser shows it (inlined when it’s saved)' : ' · email, inlined'));
      else if (path) cap.appendChild(document.createTextNode('   ' + path));
    }

    // The site page is the same address for both frames; each frame's name picks the style it
    // starts in (so A paints in the style's own colours, then switches). The newsletter: A loads it
    // without inlining so the rebuilt CSS can follow the template's; B loads the style inlined.
    function url(which) {
      var base = CFG.pages[state.page].url;
      if (!isEmail()) return base;
      var gm = state.gmail ? '&fonts=gmail' : '';
      return which === 'A' ? base + '?raw=1' + gm : base + '?style=' + encodeURIComponent(state.style) + gm;
    }
    var loaded = { A: null, B: null };
    function load(which) {
      var f = frames[which], u = url(which), name = 'fortstyle:' + state.style;
      f.name = name;
      try { f.contentWindow.name = name; } catch (e) { /* not loaded yet */ }
      if (loaded[which] === u) return;
      loaded[which] = u;
      f.src = u;
    }

    function layout() {
      var W = WIDTHS[state.w];
      ['A', 'B'].forEach(function (which) {
        var pane = $(which === 'A' ? 'paneA' : 'paneB');
        if (pane.hidden) return;
        var view = pane.querySelector('.view'), shell = pane.querySelector('.shell'), f = frames[which];
        var availW = view.clientWidth - 2, availH = view.clientHeight - 2;
        var scale = Math.min(1, availW / W), H = Math.floor(Math.max(200, availH / scale));
        f.style.width = W + 'px';
        f.style.height = H + 'px';
        shell.style.transform = 'scale(' + scale + ')';
        shell.style.width = W + 'px';
        shell.style.height = H + 'px';
        // A transform doesn't change the layout size: pull the box in to its scaled size.
        shell.style.marginRight = (W * scale - W) + 'px';
        shell.style.marginBottom = (H * scale - H) + 'px';
      });
    }

    // The palette worked out from the three colours, and what (if anything) fails 4.5:1.
    function result() {
      var p = palette(), v = variant(state.style), r = $('result');
      r.innerHTML = '';
      var sw = el('span', { 'class': 'swatches' });
      [['Page', p.bg], ['Panel', SB.solid(p.panel, p.bg)], ['Card', SB.solid(p.card, p.bg)], ['Text', p.text], ['Dim', p.dim], ['Accent', p.amber], ['Accent text', p.amberB], ['Second', p.accent2], ['Hover', SB.linkHover(p)]].forEach(function (x) {
        var s = el('span', { 'class': 'sw', title: x[0] + ' ' + x[1] });
        var dot = el('i'); dot.style.background = x[1];
        s.appendChild(dot); s.appendChild(document.createTextNode(x[0]));
        sw.appendChild(s);
      });
      r.appendChild(sw);
      var problems = SB.contrastProblems(v.o, p), seen = {}, list = [];
      problems.forEach(function (x) { var k = x.what + x.ground; if (!seen[k]) { seen[k] = true; list.push(x); } });
      if (!list.length) {
        r.appendChild(el('span', { 'class': 'ok' }, '✓ Every text color passes 4.5:1, on the site and in the email'));
        return;
      }
      var d = el('details', { 'class': 'issues' });
      d.appendChild(el('summary', {}, '⚠ ' + list.length + ' text color' + (list.length === 1 ? '' : 's') + ' below 4.5:1, so hard to read: try a darker or lighter background'));
      var ul = el('ul');
      list.forEach(function (x) { ul.appendChild(el('li', {}, x.what + ': ' + x.color + ' on ' + x.ground + ' is ' + x.ratio.toFixed(2) + ':1')); });
      d.appendChild(ul);
      r.appendChild(d);
    }

    function shareUrl() {
      var p = new URLSearchParams();
      p.set('style', state.style);
      if (state.colors) { p.set('bg', state.colors.bg.slice(1)); p.set('a', state.colors.a.slice(1)); p.set('a2', state.colors.a2.slice(1)); }
      if (state.page !== 'home') p.set('page', state.page);
      if (state.w !== 'desktop') p.set('w', state.w);
      if (isEmail() && state.gmail) p.set('gm', '1');
      if (state.side) p.set('side', '1');
      return location.pathname + '?' + p;
    }

    // Recolouring only re-adds the CSS (no reload), at most once a frame while a picker is dragged.
    var pending = false;
    function recolor() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; inject('A'); result(); controls(); caption('A'); history.replaceState(null, '', shareUrl()); });
    }
    function controls() {
      var t = three();
      [['bg', t.bg], ['a', t.a], ['a2', t.a2]].forEach(function (x) {
        $('c-' + x[0]).value = x[1];
        var txt = $('t-' + x[0]);
        if (document.activeElement !== txt) { txt.value = x[1]; txt.removeAttribute('aria-invalid'); }
      });
      $('own').setAttribute('aria-pressed', String(!state.colors));
      $('sets').querySelectorAll('.set').forEach(function (b) {
        var s = SETS[+b.getAttribute('data-i')];
        b.setAttribute('aria-pressed', String(s.bg === t.bg && s.a === t.a && s.a2 === t.a2));
      });
    }

    function render() {
      stylesBar.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-s') === state.style)); });
      $('widths').querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-w') === state.w)); });
      $('page').value = state.page;
      $('gmailWrap').hidden = !isEmail();
      $('gmail').checked = state.gmail;
      $('side').checked = state.side;
      $('paneB').hidden = !state.side;
      $('toStyles').href = CFG.stylesUrl + '?style=' + encodeURIComponent(state.style) + (state.page !== 'home' ? '&page=' + encodeURIComponent(state.page) : '') + (state.w !== 'desktop' ? '&w=' + state.w : '');
      controls();
      result();
      load('A');
      if (state.side) load('B');
      inject('A');
      caption('A'); if (state.side) caption('B');
      layout();
      history.replaceState(null, '', shareUrl());
    }

    function setColor(key, value) {
      var c = hex(value);
      if (!c) return false;
      state.colors = Object.assign({}, three());
      state.colors[key] = c;
      recolor();
      return true;
    }
    ['bg', 'a', 'a2'].forEach(function (k) {
      $('c-' + k).addEventListener('input', function () { setColor(k, this.value); });
      $('t-' + k).addEventListener('input', function () {
        var ok = setColor(k, this.value.trim());
        if (ok) this.removeAttribute('aria-invalid'); else this.setAttribute('aria-invalid', 'true');
      });
      $('t-' + k).addEventListener('blur', function () { controls(); });
    });
    $('sets').addEventListener('click', function (e) {
      var b = e.target.closest('.set');
      if (!b) return;
      var s = SETS[+b.getAttribute('data-i')];
      state.colors = { bg: s.bg, a: s.a, a2: s.a2 };
      recolor();
    });
    $('own').addEventListener('click', function () { state.colors = null; recolor(); });
    $('swap').addEventListener('click', function () { var t = three(); state.colors = { bg: t.bg, a: t.a2, a2: t.a }; recolor(); });
    function flash(msg) { $('status').textContent = msg; setTimeout(function () { $('status').textContent = ''; }, 1800); }
    function copy(text, msg) {
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { flash(msg); }, function () { window.prompt('Copy this:', text); });
    }
    $('copyLink').addEventListener('click', function () { copy(location.origin + shareUrl(), 'Link copied'); });
    $('copyPalette').addEventListener('click', function () {
      var t = three(), v = variant(state.style);
      copy(JSON.stringify({ style: v.key + ' · ' + v.name, from: { background: t.bg, accent: t.a, second: t.a2 }, palette: palette() }, null, 2), 'Palette copied');
    });
    stylesBar.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { state.style = b.getAttribute('data-s'); loaded.B = null; render(); } });
    $('widths').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { state.w = b.getAttribute('data-w'); render(); } });
    $('page').addEventListener('change', function () { state.page = this.value; this.blur(); render(); });
    $('gmail').addEventListener('change', function () { this.blur(); state.gmail = this.checked; render(); });
    $('side').addEventListener('change', function () { this.blur(); state.side = this.checked; loaded.B = null; render(); });
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey || /^(SELECT|INPUT|TEXTAREA)$/.test((e.target.tagName || ''))) return;
      if (/^[1-9]$/.test(e.key) && variant(e.key)) { state.style = e.key; loaded.B = null; render(); }
    });
    window.addEventListener('resize', layout);
    render();
  }
})();
</script>
</body>
</html>
