/*
 * "Submit an event": a Preview step before sending. It shows the event as its page will look
 * once approved, built here in the browser from what was typed (nothing is sent until "Looks
 * good"). Text is cleaned the way the site will store it: tags removed, single-line fields
 * tidied, blank lines → paragraphs, single line breaks kept. Without JavaScript the form keeps
 * its plain "Send for approval" button.
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
    var date = longDate(val('f-date'));
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
      when.textContent = 'Ongoing — no date given';
    }

    var where = oneLine(val('f-location'));
    part('where').textContent = where;
    showRow('where', !!where);
    var q = oneLine(val('f-leader'));
    part('q').textContent = q;
    showRow('q', !!q);
    part('link-row').hidden = !/^https?:\/\/\S+/i.test(val('f-link').trim());

    // Description: blank lines start a new paragraph; single line breaks stay.
    var body = part('description');
    body.textContent = '';
    stripTags(val('f-description')).replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/).forEach(function (para) {
      if (!para.trim()) return;
      var p = document.createElement('p');
      para.trim().split('\n').forEach(function (bit, i) {
        if (i) p.appendChild(document.createElement('br'));
        p.appendChild(document.createTextNode(bit));
      });
      body.appendChild(p);
    });

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
    if (file) {
      if (FLYER_TYPES.indexOf(file.type) === -1 || file.size > FLYER_MAX) {
        problem.hidden = false;
      } else {
        flyerUrl = URL.createObjectURL(file);
        fig.querySelector('img').src = flyerUrl;
        fig.querySelector('img').alt = 'Flyer for ' + part('title').textContent;
        fig.hidden = false;
      }
    }
    return problem.hidden; // True when it can be sent (no flyer problem).
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

  open.addEventListener('click', function () {
    if (!form.reportValidity()) return; // Required fields, link format: the browser points at the problem.
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
