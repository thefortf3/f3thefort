<?php
/**
 * /style-preview/ — a frame around the site for trying the alternative styles live (see
 * inc/style-preview.php). A standalone page: its own small stylesheet and script, no theme chrome.
 * Choices live in the address (?style=3&w=phone&page=schedule&b=5) so a view can be shared; nothing
 * is saved. The "Newsletter (email)" page loads /style-preview/newsletter/?style=N instead: email
 * can't switch styles live, so each style is a fresh load (&fonts=gmail drops the web fonts).
 *
 * @package Fort
 */

defined( 'ABSPATH' ) || exit;

// The pages that can be previewed: only addresses built here, never anything from the request.
$pages = array( 'home' => array( 'Home', home_url( '/' ) ) );
$home  = function_exists( 'fort_home' ) ? fort_home() : null;
$event = $home['featured'] ?? ( $home['this_week'][0]['entries'][0] ?? null );
if ( $event ) {
	$pages['event'] = array( 'An event page', fort_event_url( $event ) );
}
$pages['schedule']   = array( 'Schedule', fort_page_url( 'schedule', home_url( '/schedule/' ) ) );
$pages['backblasts'] = array( 'Backblasts', fort_backblasts_url() );
$bbs                 = function_exists( 'fort_backblasts' ) ? fort_backblasts( 1 ) : array();
if ( ! empty( $bbs[0]['event_id'] ) ) {
	$pages['backblast'] = array( 'A backblast', fort_backblast_url( $bbs[0] ) );
}
$pages['submit'] = array( 'Submit an event', fort_submit_url() );
// This week's newsletter, as the email (each style is built on the server, see inc/style-preview.php).
if ( fort_style_preview_has_newsletter() ) {
	$pages['newsletter'] = array( 'Newsletter (email)', home_url( '/style-preview/newsletter/' ) );
}

$preview = fort_style_preview_data();
$config  = array(
	'styles' => $preview['styles'],
	'pages'  => array_map( function ( $p ) { return array( 'label' => $p[0], 'url' => $p[1] ); }, $pages ),
);
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Style preview — <?php bloginfo( 'name' ); ?></title>
<style>
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { display: flex; flex-direction: column; background: #0d0e11; color: #e9e7e1; font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; }
button, select { font: inherit; color: inherit; }
.bar { flex: none; background: #171a1f; border-bottom: 1px solid #2c3037; padding: 10px 14px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.row { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
.title { font-weight: 700; letter-spacing: 0.01em; }
.hint { color: #9aa0ab; }
.bar a { color: #9fc3e6; text-decoration: none; margin-left: auto; }
.seg { display: inline-flex; border: 1px solid #3a3f48; border-radius: 8px; overflow: hidden; max-width: 100%; overflow-x: auto; }
.seg button { background: transparent; border: 0; border-right: 1px solid #3a3f48; padding: 7px 12px; cursor: pointer; white-space: nowrap; color: #c8ccd4; }
.seg button:last-child { border-right: 0; }
.seg button:hover { background: #22262d; }
.seg button[aria-pressed="true"] { background: #e4b866; color: #1b1608; font-weight: 600; }
label { display: inline-flex; align-items: center; gap: 6px; color: #b4b9c2; }
select { background: #1f2329; border: 1px solid #3a3f48; border-radius: 6px; padding: 6px 8px; }
.recipe { color: #aab0bb; font-size: 13px; }
.recipe b { color: #f1efe8; }
.cap .size { color: #9fc3e6; }
.cap .size.is-big { color: #ff9c8a; }
.chips { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 4px; }
.chips span { border: 1px solid #343941; border-radius: 999px; padding: 1px 9px; font-size: 12px; color: #b4b9c2; }
main { flex: 1; min-height: 0; display: flex; gap: 10px; padding: 10px; }
.pane { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.pane[hidden] { display: none; }
.cap { color: #9aa0ab; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cap b { color: #f1efe8; }
.view { flex: 1; min-height: 0; overflow: auto; display: flex; justify-content: center; align-items: flex-start; background: repeating-linear-gradient(45deg, #101216 0 10px, #0d0e11 10px 20px); border: 1px solid #23262c; border-radius: 10px; }
.shell { flex: none; transform-origin: top left; }
.shell iframe { display: block; border: 0; background: #fff; }
.phone .shell iframe { border-radius: 0; }
@media (max-width: 900px) { main { flex-direction: column; } .hint { display: none; } }
@media (max-width: 600px) {
	.bar { padding: 8px 10px; gap: 6px; }
	.row > .seg { flex: 1 1 100%; }
	.row > .seg button { flex: 1 0 auto; }
	.chips { display: none; }
	.recipe { font-size: 12px; }
	main { padding: 8px; }
}
</style>
</head>
<body>
<header class="bar">
	<div class="row">
		<span class="title">Style preview</span>
		<span class="hint">Try the styles on the real site. Nothing here is saved or published.</span>
		<a href="<?php echo esc_url( home_url( '/' ) ); ?>">Open the site ↗</a>
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
		<label><input type="checkbox" id="compare"> Compare with</label>
		<select id="styleB" aria-label="Compare with style"></select>
	</div>
	<div class="recipe" id="recipe"></div>
</header>
<main id="stage">
	<section class="pane" id="paneA"><div class="cap" id="capA"></div><div class="view"><div class="shell"><iframe id="frameA" title="Site preview" loading="eager"></iframe></div></div></section>
	<section class="pane" id="paneB" hidden><div class="cap" id="capB"></div><div class="view"><div class="shell"><iframe id="frameB" title="Site preview, compared" loading="eager"></iframe></div></div></section>
</main>
<script>
(function () {
  'use strict';
  var CFG = <?php echo wp_json_encode( $config, JSON_HEX_TAG | JSON_HEX_AMP ); ?>;
  var WIDTHS = { desktop: 1280, tablet: 820, phone: 390 };
  var $ = function (id) { return document.getElementById(id); };
  var q = new URLSearchParams(location.search);
  function isStyle(k) { return k === '0' || CFG.styles.some(function (x) { return x.key === k; }); }
  var state = {
    style: isStyle(q.get('style')) ? q.get('style') : '0',
    styleB: isStyle(q.get('b')) ? q.get('b') : '0',
    page: CFG.pages[q.get('page')] ? q.get('page') : 'home',
    w: WIDTHS[q.get('w')] ? q.get('w') : (window.innerWidth <= 600 ? 'phone' : 'desktop'),
    compare: q.get('compare') === '1',
    gmail: q.get('gm') === '1'
  };
  function isEmail() { return state.page === 'newsletter'; }
  if (state.compare && state.styleB === state.style) state.styleB = state.style === '0' ? '1' : '0';

  function styleName(k) { if (k === '0') return 'Current'; var s = CFG.styles.filter(function (x) { return x.key === k; })[0]; return s ? k + ' · ' + s.name : k; }
  function el(tag, attrs, text) { var e = document.createElement(tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); if (text) e.textContent = text; return e; }

  // Controls
  var stylesBar = $('styles');
  ['0'].concat(CFG.styles.map(function (s) { return s.key; })).forEach(function (k) {
    var b = el('button', { type: 'button', 'data-s': k, 'aria-pressed': 'false', title: k === '0' ? 'The site as it is now (key 0)' : (k.length === 1 ? 'Key ' + k : 'Use [ and ] to step through styles') }, styleName(k));
    stylesBar.appendChild(b);
  });
  Object.keys(CFG.pages).forEach(function (k) { $('page').appendChild(el('option', { value: k }, CFG.pages[k].label)); });
  ['0'].concat(CFG.styles.map(function (s) { return s.key; })).forEach(function (k) { $('styleB').appendChild(el('option', { value: k }, styleName(k))); });

  // Frames
  var frames = { A: $('frameA'), B: $('frameB') };
  function applyStyle(f, s) {
    f.name = 'fortstyle:' + s;
    try {
      var w = f.contentWindow;
      w.name = 'fortstyle:' + s;
      var de = w.document.documentElement;
      if (s === '0') de.removeAttribute('data-fort-style'); else de.setAttribute('data-fort-style', s);
    } catch (e) { /* not loaded yet: the site reads the frame's name when it does */ }
  }
  var syncing = false;
  function hook(which) {
    var f = frames[which];
    f.addEventListener('load', function () {
      applyStyle(f, which === 'A' ? state.style : state.styleB);
      try {
        var w = f.contentWindow, d = w.document;
        $(which === 'A' ? 'capA' : 'capB').innerHTML = '';
        caption(which);
        d.addEventListener('click', function (ev) { // Links off this site open in a new tab, not in the frame.
          var a = ev.target.closest && ev.target.closest('a[href]');
          if (a && a.origin && a.origin !== location.origin) { ev.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
        });
        w.addEventListener('scroll', function () {
          if (!state.compare || syncing) return;
          var o = frames[which === 'A' ? 'B' : 'A'].contentWindow;
          var max = function (x) { return Math.max(1, x.document.documentElement.scrollHeight - x.innerHeight); };
          syncing = true;
          o.scrollTo(0, (w.scrollY / max(w)) * max(o));
          setTimeout(function () { syncing = false; }, 30);
        }, { passive: true });
      } catch (e) { /* cross-origin: leave the caption */ }
    });
  }
  hook('A'); hook('B');

  function caption(which) {
    var f = frames[which], cap = $(which === 'A' ? 'capA' : 'capB'), path = '';
    try { path = f.contentWindow.location.pathname; } catch (e) { path = ''; }
    cap.innerHTML = '';
    var b = el('b', {}, styleName(which === 'A' ? state.style : state.styleB));
    cap.appendChild(b);
    if (isEmail()) {
      // The email's size, against the point where Gmail cuts it off ("Message clipped").
      var bytes = 0;
      try { bytes = new Blob([f.contentWindow.document.documentElement.outerHTML]).size; } catch (e) { bytes = 0; }
      cap.appendChild(document.createTextNode('   email' + (state.gmail ? ', Gmail fonts' : ', web fonts') + ' · '));
      if (bytes) cap.appendChild(el('span', { 'class': 'size' + (bytes > 92 * 1024 ? ' is-big' : '') }, Math.round(bytes / 1024) + ' KB of Gmail’s 102 KB'));
      return;
    }
    cap.appendChild(document.createTextNode(path ? '   ' + path : ''));
  }

  // The newsletter can't switch styles in place (its styles are inlined), so its address carries
  // the style and a change reloads it.
  function url(which) {
    var base = CFG.pages[state.page].url;
    if (!isEmail()) return base;
    return base + '?style=' + encodeURIComponent(which === 'A' ? state.style : state.styleB) + (state.gmail ? '&fonts=gmail' : '');
  }
  var loadedPage = { A: null, B: null };
  function loadPage(which) {
    var u = url(which);
    if (loadedPage[which] === u) return;
    loadedPage[which] = u;
    frames[which].src = u;
  }

  // Layout: scale the chosen width to fit the pane, then fill the pane's height
  function layout() {
    var W = WIDTHS[state.w];
    ['A', 'B'].forEach(function (which) {
      var pane = $(which === 'A' ? 'paneA' : 'paneB');
      if (pane.hidden) return;
      var view = pane.querySelector('.view'), shell = pane.querySelector('.shell'), f = frames[which];
      var availW = view.clientWidth - 2, availH = view.clientHeight - 2;
      var scale = Math.min(1, availW / W);
      f.style.width = W + 'px';
      f.style.height = Math.max(200, availH / scale) + 'px';
      shell.style.transform = 'scale(' + scale + ')';
      shell.style.width = W + 'px';
      shell.style.height = Math.max(200, availH / scale) + 'px';
      shell.style.marginRight = (W * scale - W) + 'px'; // The scaled box's layout size
      shell.style.marginBottom = (availH - availH / scale * scale) + 'px';
      pane.classList.toggle('phone', state.w === 'phone');
    });
  }

  function render() {
    stylesBar.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-s') === state.style)); });
    $('widths').querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-w') === state.w)); });
    $('page').value = state.page;
    $('compare').checked = state.compare;
    $('styleB').value = state.styleB;
    $('styleB').hidden = !state.compare;
    $('paneB').hidden = !state.compare;
    $('gmailWrap').hidden = !isEmail();
    $('gmail').checked = state.gmail;
    var s = CFG.styles.filter(function (x) { return x.key === state.style; })[0];
    var r = $('recipe');
    r.innerHTML = '';
    if (s) {
      var b = el('b', {}, s.key + ' · ' + s.name);
      r.appendChild(b);
      r.appendChild(document.createTextNode(' — ' + s.summary));
      var chips = el('div', { 'class': 'chips' });
      s.ingredients.forEach(function (i) { chips.appendChild(el('span', {}, i)); });
      r.appendChild(chips);
    } else {
      r.appendChild(el('b', {}, 'Current'));
      r.appendChild(document.createTextNode(isEmail() ? ' — the newsletter as it goes out now. Pick a style above, or press 1–' + CFG.styles.length + ' (0 for current, C to compare).' : ' — the site as it looks now. Pick a style above, or press 1–' + CFG.styles.length + ' (0 for current, C to compare).'));
    }
    applyStyle(frames.A, state.style);
    if (state.compare) applyStyle(frames.B, state.styleB);
    loadPage('A');
    if (state.compare) loadPage('B');
    caption('A'); if (state.compare) caption('B');
    layout();
    var p = new URLSearchParams();
    if (state.style !== '0') p.set('style', state.style);
    if (state.compare) { p.set('compare', '1'); p.set('b', state.styleB); }
    if (state.page !== 'home') p.set('page', state.page);
    if (state.w !== 'desktop') p.set('w', state.w);
    if (isEmail() && state.gmail) p.set('gm', '1');
    history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
  }

  stylesBar.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { state.style = b.getAttribute('data-s'); if (state.compare && state.styleB === state.style) state.styleB = state.style === '0' ? '1' : '0'; render(); } });
  $('widths').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { state.w = b.getAttribute('data-w'); render(); } });
  $('page').addEventListener('change', function () { state.page = this.value; this.blur(); render(); });
  $('compare').addEventListener('change', function () { this.blur(); state.compare = this.checked; if (state.compare && state.styleB === state.style) state.styleB = state.style === '0' ? '1' : '0'; if (state.compare) loadedPage.B = null; render(); });
  $('gmail').addEventListener('change', function () { this.blur(); state.gmail = this.checked; render(); });
  $('styleB').addEventListener('change', function () { state.styleB = this.value; this.blur(); render(); });
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || /^(SELECT|INPUT|TEXTAREA)$/.test((e.target.tagName || ''))) return;
    var order = ['0'].concat(CFG.styles.map(function (x) { return x.key; }));
    if (/^[0-9]$/.test(e.key) && isStyle(e.key)) { state.style = e.key; if (state.compare && state.styleB === state.style) state.styleB = state.style === '0' ? '1' : '0'; render(); }
    else if (e.key === '[' || e.key === ']') { var i = order.indexOf(state.style) + (e.key === ']' ? 1 : -1); state.style = order[(i + order.length) % order.length]; if (state.compare && state.styleB === state.style) state.styleB = state.style === '0' ? '1' : '0'; render(); }
    else if (e.key === 'c' || e.key === 'C') { state.compare = !state.compare; if (state.compare) { loadedPage.B = null; if (state.styleB === state.style) state.styleB = state.style === '0' ? '1' : '0'; } render(); }
  });
  window.addEventListener('resize', layout);
  render();
})();
</script>
</body>
</html>
