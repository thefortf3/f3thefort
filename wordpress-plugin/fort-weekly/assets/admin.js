/* Fort Weekly admin: repeatable rows (dates, region lists), the image picker and "Write one for me". */
(function () {
  'use strict';
  let counter = Date.now();

  function rowsTable(key) {
    return document.querySelector('table[data-fortw-rows="' + key + '"]');
  }

  // Add a row: from the list's <template>, or (dates) by copying the last row with empty values.
  document.addEventListener('click', function (ev) {
    const add = ev.target.closest('.fortw-add-row');
    if (add) {
      const key = add.dataset.fortwTarget;
      const body = rowsTable(key).tBodies[0];
      const tpl = document.querySelector('template[data-fortw-template="' + key + '"]');
      let row;
      if (tpl) {
        row = tpl.content.firstElementChild.cloneNode(true);
      } else {
        row = body.rows[body.rows.length - 1].cloneNode(true);
        row.querySelectorAll('input').forEach(function (i) { i.value = ''; });
      }
      const n = String(counter++);
      row.querySelectorAll('[name]').forEach(function (el) {
        el.name = el.name.replace(/\[(?:__i__|\d+)\]/, '[' + n + ']');
      });
      body.appendChild(row);
      const first = row.querySelector('input, select');
      if (first) first.focus();
      return;
    }
    const remove = ev.target.closest('.fortw-remove-row');
    if (remove) {
      const row = remove.closest('tr');
      const body = row.parentNode;
      if (body.rows.length === 1 && !document.querySelector('template[data-fortw-template="' + body.parentNode.dataset.fortwRows + '"]')) {
        row.querySelectorAll('input').forEach(function (i) { i.value = ''; }); // Keep one (blank) date row.
      } else {
        row.remove();
      }
      return;
    }
    const up = ev.target.closest('.fortw-up');
    const down = ev.target.closest('.fortw-down');
    if (up || down) {
      const row = (up || down).closest('tr');
      if (up && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
      if (down && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
      (up || down).focus();
    }
  });

  // Region: the Nan'tan note's image, from the media library.
  document.addEventListener('click', function (ev) {
    const choose = ev.target.closest('.fortw-image-choose');
    const clear = ev.target.closest('.fortw-image-clear');
    const cell = (choose || clear) && (choose || clear).closest('.fortw-image-pick');
    if (!cell) return;
    const input = cell.querySelector('input[type=hidden]');
    const img = cell.querySelector('img');
    const clearBtn = cell.querySelector('.fortw-image-clear');
    if (clear) {
      input.value = '0'; img.hidden = true; clearBtn.hidden = true;
      return;
    }
    if (!window.wp || !wp.media) return;
    const frame = wp.media({ title: choose.textContent, library: { type: 'image' }, multiple: false });
    frame.on('select', function () {
      const a = frame.state().get('selection').first().toJSON();
      input.value = a.id;
      img.src = (a.sizes && a.sizes.medium ? a.sizes.medium.url : a.url);
      img.hidden = false; clearBtn.hidden = false;
    });
    frame.open();
  });

  // Edit screen: "Write one for me" fills the summary from the title and description.
  const gen = document.getElementById('fortw-generate');
  if (gen) {
    gen.addEventListener('click', function () {
      const status = document.getElementById('fortw-generate-status');
      const editor = window.tinymce && tinymce.get('content');
      const body = new URLSearchParams({
        action: 'fortw_summary',
        post: gen.dataset.post,
        nonce: gen.dataset.nonce,
        title: (document.getElementById('title') || {}).value || '',
        content: editor && !editor.isHidden() ? editor.getContent() : ((document.getElementById('content') || {}).value || ''),
      });
      gen.disabled = true;
      status.textContent = '…';
      fetch(window.ajaxurl, { method: 'POST', credentials: 'same-origin', body: body })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.success) {
            document.getElementById('fortw-summary').value = res.data.summary;
            status.textContent = '';
          } else {
            status.textContent = (res.data && res.data.message) || 'Failed.';
          }
        })
        .catch(function () { status.textContent = 'Failed.'; })
        .finally(function () { gen.disabled = false; });
    });
  }
})();
