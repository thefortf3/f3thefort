/*
 * "Submit an event": a Preview step before sending. It shows the event as its page will look
 * once approved, built here in the browser from what was typed (nothing is sent until "Looks
 * good"). Text is cleaned the way the site will store it: single-line fields tidied, and the
 * description keeps only the editor's bold, italic, lists and http(s)/mailto links (as the Fort
 * Weekly plugin's fortw_submission_html does). Without JavaScript the form keeps its plain
 * "Send for approval" button and plain text box.
 */
(function () {
  'use strict';
  var form = document.querySelector('.fort-form');
  var preview = document.getElementById('fort-preview');
  var open = document.getElementById('fort-preview-open');
  var send = document.getElementById('fort-send');
  if (!form || !preview || !open || !send) return;

  open.hidden = false;
  send.hidden = true;

  var FLYER_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  var FLYER_MAX = 5 * 1024 * 1024;
  var flyerUrl = null;

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }
  function stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, '');
  }
  function oneLine(s) {
    return stripTags(s).replace(/\s+/g, ' ').trim();
  }
  function part(name) {
    return preview.querySelector('[data-preview="' + name + '"]');
  }
  function showRow(name, on) {
    preview.querySelectorAll('[data-preview-row="' + name + '"]').forEach(function (el) { el.hidden = !on; });
  }

  // "2026-11-21" → "Saturday, November 21" (as the event page writes it).
  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }

  function render() {
    part('title').textContent = oneLine(val('f-title'));

    var when = part('when');
    when.textContent = '';
    var fixed = form.getAttribute('data-fixed-when'); // Edit mode, several dates: not editable here.
    var date = fixed ? '' : longDate(val('f-date'));
    if (date) {
      var line = document.createElement('span');
      line.className = 'fort-facts__date';
      line.textContent = date;
      var start = oneLine(val('f-start'));
      var end = oneLine(val('f-end')).replace(':', '');
      if (start) {
        var t = document.createElement('span');
        t.className = 'fort-mono-dim';
        t.textContent = end ? start + '–' + end : start;
        line.appendChild(document.createTextNode(' '));
        line.appendChild(t);
      }
      when.appendChild(line);
    } else {
      when.textContent = fixed || 'Ongoing — no date given';
    }

    var where = oneLine(val('f-location'));
    part('where').textContent = where;
    showRow('where', !!where);
    var q = oneLine(val('f-leader'));
    part('q').textContent = q;
    showRow('q', !!q);
    part('link-row').hidden = !/^https?:\/\/\S+/i.test(val('f-link').trim());

    var body = part('description');
    body.textContent = '';
    var ed = editor();
    if (ed) {
      cleanInto(body, new DOMParser().parseFromString(ed.getContent(), 'text/html').body);
    } else {
      plainInto(body, val('fort_description'));
    }

    // Flyer: shown from the file itself; flagged if the site would refuse it.
    var file = (document.getElementById('f-flyer') || {}).files;
    file = file && file[0];
    var fig = part('flyer');
    var problem = part('flyer-problem');
    if (flyerUrl) {
      URL.revokeObjectURL(flyerUrl);
      flyerUrl = null;
    }
    fig.hidden = true;
    problem.hidden = true;
    var current = form.getAttribute('data-current-flyer');
    var remove = document.getElementById('f-remove-flyer');
    if (file) {
      if (FLYER_TYPES.indexOf(file.type) === -1 || file.size > FLYER_MAX) {
        problem.hidden = false;
      } else {
        flyerUrl = URL.createObjectURL(file);
        fig.querySelector('img').src = flyerUrl;
        fig.querySelector('img').alt = 'Flyer for ' + part('title').textContent;
        fig.hidden = false;
      }
    } else if (current && !(remove && remove.checked)) {
      fig.querySelector('img').src = current; // Edit mode: the flyer it already has.
      fig.querySelector('img').alt = 'Flyer for ' + part('title').textContent;
      fig.hidden = false;
    }
    return problem.hidden; // True when it can be sent (no flyer problem).
  }

  // The description editor (WordPress's TinyMCE), once it has started.
  function editor() {
    return window.tinymce && window.tinymce.get('fort_description') && !window.tinymce.get('fort_description').isHidden()
      ? window.tinymce.get('fort_description') : null;
  }
  function descriptionText() {
    var ed = editor();
    var text = ed ? ed.getContent({ format: 'text' }) : val('fort_description');
    return text.replace(/\u00a0/g, ' ').trim();
  }

  // Copies only what the site keeps: p, br, strong/b, em/i, ul/ol/li, and http(s)/mailto links.
  var KEEP = { P: 'p', BR: 'br', STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', UL: 'ul', OL: 'ol', LI: 'li', A: 'a' };
  function cleanInto(target, source) {
    source.childNodes.forEach(function (n) {
      if (n.nodeType === 3) {
        target.appendChild(document.createTextNode(n.nodeValue));
        return;
      }
      if (n.nodeType !== 1 || /^(SCRIPT|STYLE|IFRAME|OBJECT|NOSCRIPT)$/.test(n.tagName)) return;
      var tag = KEEP[n.tagName];
      if (tag === 'a' && !/^(https?:\/\/|mailto:)/i.test(n.getAttribute('href') || '')) tag = null;
      if (!tag) {
        cleanInto(target, n); // Not kept: its text still is.
        return;
      }
      var el = document.createElement(tag);
      if (tag === 'a') {
        el.href = n.getAttribute('href');
        el.rel = 'nofollow';
      }
      target.appendChild(el);
      cleanInto(el, n);
    });
  }

  // Plain text (no editor): blank lines start a new paragraph; single line breaks stay.
  function plainInto(target, text) {
    stripTags(text).replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/).forEach(function (para) {
      if (!para.trim()) return;
      var p = document.createElement('p');
      para.trim().split('\n').forEach(function (bit, i) {
        if (i) p.appendChild(document.createElement('br'));
        p.appendChild(document.createTextNode(bit));
      });
      target.appendChild(p);
    });
  }

  function show(which) {
    var previewing = which === 'preview';
    form.hidden = previewing;
    preview.hidden = !previewing;
    document.getElementById('fort-preview-send').disabled = previewing && !render.ok;
    var target = previewing ? document.getElementById('fort-preview-label') : open;
    target.scrollIntoView({ block: 'start' });
    target.focus({ preventScroll: true });
  }

  // The editor hides the real text box, so the browser can't check "required" on it; this does.
  var descField = document.getElementById('fort_description');
  if (descField) descField.removeAttribute('required');
  var descWrap = descField && descField.closest('.fort-field');

  open.addEventListener('click', function () {
    if (!form.reportValidity()) return; // Required fields, link format: the browser points at the problem.
    if (!descriptionText()) {
      if (descWrap) descWrap.classList.add('is-invalid');
      var ed = editor();
      if (ed) ed.focus(); else if (descField) descField.focus();
      return;
    }
    if (descWrap) descWrap.classList.remove('is-invalid');
    render.ok = render();
    show('preview');
  });
  document.getElementById('fort-preview-edit').addEventListener('click', function () {
    show('form');
  });
  document.getElementById('fort-preview-send').addEventListener('click', function () {
    this.disabled = true; // No double submissions.
    if (form.requestSubmit) {
      form.requestSubmit(send);
    } else {
      form.submit();
    }
  });
})();
