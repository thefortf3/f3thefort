/*
 * "Submit an event": times in F3's 24-hour form. When the Start or End box is left, what was
 * typed ("6:30am", "6-7pm", "17:30") is rewritten as the site will store it ("0630", "1800" and
 * "1900") and a note under the boxes says so; a time that can't be read gets a warning instead.
 * The same reading as the Fort Weekly plugin's fortw_parse_time() / fortw_parse_time_range(),
 * which converts again on the server (so nothing depends on this script).
 */
(function () {
  'use strict';
  var start = document.getElementById('f-start');
  var end = document.getElementById('f-end');
  var note = document.getElementById('f-time-note');
  if (!start || !end || !note) return;
  var hint = note.textContent;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // "5:30am" → "0530"; null if it can't be read. Without am/pm it's already 24-hour.
  function parseTime(text) {
    var s = String(text || '').trim().toLowerCase();
    if (/^noon\b/.test(s)) return '1200';
    if (/^midnight\b/.test(s)) return '0000';
    var m = /^(\d{1,2})(?::?(\d{2}))?\s*(?:([ap])\.?\s*m?\.?(?![a-z]))?(?![\d:])/.exec(s);
    if (!m) return null;
    var h = +m[1], min = m[2] ? +m[2] : 0, mer = m[3] || '';
    if (min > 59 || (mer && (h < 1 || h > 12)) || (!mer && h > 24) || (h === 24 && min > 0)) return null;
    if (mer === 'p' && h < 12) h += 12;
    else if ((mer === 'a' && h === 12) || h === 24) h = 0;
    return pad(h) + pad(min);
  }

  // A start (which may hold the whole range) and an end → [start, end]; an am/pm typed once
  // applies to both ("6-7pm" → 1800, 1900; "11-1pm" → 1100, 1300) when the start is written the
  // 12-hour way ("5:30", "11"; never "0530").
  function parseRange(a, b) {
    a = String(a || '').trim();
    b = String(b || '').trim();
    var bits = a.split(/\s*(?:–|—|-|\bto\b|\buntil\b)\s*/);
    if (!b && bits.length > 1) { b = bits.slice(1).join('-'); a = bits[0]; }
    var x = parseTime(a), y = b ? parseTime(b) : null;
    var em = /([ap])\.?\s*m?\.?\s*$/i.exec(b);
    if (x && y && em && /^(?:(?:1[0-2]|[1-9])(?::[0-5]\d)?|[1-9][0-5]\d)$/.test(a)) {
      var w = parseTime(a + ' ' + em[1] + 'm');
      x = w && w <= y ? w : parseTime(a + ' ' + (em[1].toLowerCase() === 'p' ? 'a' : 'p') + 'm');
    }
    return [x, y];
  }

  function say(text, warn) {
    note.textContent = text;
    note.classList.toggle('fort-hint--warn', !!warn);
  }

  // What the submitter typed in each box (read from that, not from an earlier conversion: "5:30"
  // then "7:30pm" is 1730–1930).
  var converting = false;
  [start, end].forEach(function (el) {
    el.setAttribute('data-typed', el.value);
    el.addEventListener('input', function () { if (!converting) el.setAttribute('data-typed', el.value); });
  });

  function convert() {
    var typedStart = start.getAttribute('data-typed').trim(), typedEnd = end.getAttribute('data-typed').trim();
    if (!typedStart && !typedEnd) { say(hint); return; }
    var t = parseRange(typedStart, typedEnd);
    var bad = [];
    if (typedStart && !t[0]) bad.push('“' + typedStart + '”');
    if (typedEnd && !t[1]) bad.push('“' + typedEnd + '”');
    if (bad.length) {
      say('We couldn’t read ' + bad.join(' or ') + ' as a time. Use 24-hour time like 0530 or 1730, or leave it blank.', true);
      return;
    }
    var was = [typedStart, typedEnd].filter(Boolean).join(' – ');
    if (t[0]) start.value = t[0];
    end.value = t[1] || '';
    var now = [t[0], t[1]].filter(Boolean).join('–');
    var same = was.replace(/\s|–|-/g, '') === now.replace(/–/g, '');
    say(same ? hint : 'F3 uses 24-hour time, so “' + was + '” is saved as ' + now + '. Change it if that’s not right.');
    converting = true;
    start.dispatchEvent(new Event('input', { bubbles: true })); // The preview step reads the boxes.
    converting = false;
  }

  start.addEventListener('change', convert);
  end.addEventListener('change', convert);
  var form = start.form;
  if (form) form.addEventListener('submit', convert);
  document.addEventListener('click', function (e) { // "Preview" reads the boxes too.
    if (e.target && e.target.id === 'fort-preview-open') convert();
  }, true);
})();
