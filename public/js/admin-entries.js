/* Entries admin (/admin): approval queue, a single row list sorted by next occurrence, tags,
   and a side-panel editor. Talks to /api/entries, /api/tags and /api/region/* (lib/entries-routes.js). */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const state = {
    entries: [],
    tags: [],
    today: null,
    tab: 'pending',
    editing: null, // entry being edited (null = closed)
    dirty: false,
  };

  // ── Utilities ─────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body !== undefined && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { showLogin(); throw new Error('Please log in again'); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  let toastTimer;
  function toast(msg, kind = 'ok') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `ea-toast${kind === 'error' ? ' ea-toast--error' : ''}`;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'error' ? 6000 : 3000);
  }

  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function dateParts(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    return {
      dow: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase(),
      day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase(),
    };
  }

  /** Which tab an entry belongs to (held entries also show under Upcoming, flagged as held). */
  function tabOf(e) {
    if (e.lifecycle === 'archived') return 'archived';
    if (e.lifecycle === 'pending') return 'pending';
    if (e.lifecycle === 'rejected') return 'rejected';
    if (e.lifecycle === 'past') return 'past';
    return 'upcoming'; // upcoming or ongoing
  }
  function inTab(e, tab) {
    if (tab === 'held') return e.hold_from_newsletter && (e.lifecycle === 'upcoming' || e.lifecycle === 'ongoing');
    return tabOf(e) === tab;
  }

  // ── Auth ──────────────────────────────────────────────────────────
  function showLogin() {
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    $('#admin-password').focus();
  }
  async function showApp() {
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    await Promise.all([loadTags(), loadEntries()]);
    openFromHash();
  }

  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#login-error');
    err.hidden = true;
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('#admin-password').value }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Login failed');
      $('#admin-password').value = '';
      await showApp();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  });

  $('#logout-btn').addEventListener('click', async (ev) => {
    ev.preventDefault();
    await fetch('/api/admin/logout', { method: 'POST' });
    showLogin();
  });

  // ── Views ─────────────────────────────────────────────────────────
  $$('.ea-nav__view').forEach(btn => btn.addEventListener('click', () => {
    $$('.ea-nav__view').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
    $('#view-entries').hidden = btn.dataset.view !== 'entries';
    $('#view-region').hidden = btn.dataset.view !== 'region';
    if (btn.dataset.view === 'region') loadNantan();
  }));

  // ── Data ──────────────────────────────────────────────────────────
  async function loadEntries() {
    const data = await api('/api/entries?archived=true');
    state.entries = data.items;
    state.today = data.today;
    if (state.tab === 'pending' && !state.entries.some(e => tabOf(e) === 'pending')) state.tab = 'upcoming';
    renderTabs();
    renderList();
  }

  async function loadTags() {
    state.tags = await api('/api/tags');
    const sel = $('#filter-tag');
    const current = sel.value;
    sel.innerHTML = '<option value="">All tags</option>' + state.tags.map(t => `<option value="${t.id}">${esc(t.label)}</option>`).join('');
    sel.value = state.tags.some(t => String(t.id) === current) ? current : '';
  }

  function replaceEntry(updated) {
    const i = state.entries.findIndex(e => e.id === updated.id);
    if (i >= 0) state.entries[i] = updated; else state.entries.push(updated);
    if (updated.featured) state.entries.forEach(e => { if (e.id !== updated.id) e.featured = false; });
  }

  // ── Tabs + list ───────────────────────────────────────────────────
  function renderTabs() {
    for (const tab of ['pending', 'upcoming', 'held', 'past', 'rejected', 'archived']) {
      const n = state.entries.filter(e => inTab(e, tab)).length;
      const el = $(`.ea-count[data-count="${tab}"]`);
      el.textContent = n;
      el.classList.toggle('ea-count--hot', tab === 'pending' && n > 0);
    }
    $$('.ea-tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === state.tab)));
  }

  $('#entry-tabs').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.ea-tab');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    renderTabs();
    renderList();
  });
  ['input', 'change'].forEach(evt => {
    $('#filter-search').addEventListener(evt, renderList);
    $('#filter-tag').addEventListener(evt, renderList);
    $('#filter-image').addEventListener(evt, renderList);
  });

  function matchesFilters(e) {
    const q = $('#filter-search').value.trim().toLowerCase();
    if (q) {
      const hay = [e.title, e.leader, e.location, e.summary, (e.description || '').replace(/<[^>]*>/g, ' '), e.submitter_name]
        .join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    const tag = $('#filter-tag').value;
    if (tag && !e.tags.some(t => String(t.id) === tag)) return false;
    if ($('#filter-image').checked && !(e.hero_image || /<img\b/i.test(e.description || ''))) return false;
    return true;
  }

  function renderList() {
    const list = $('#entry-list');
    const items = state.entries.filter(e => inTab(e, state.tab) && matchesFilters(e));
    if (items.length === 0) {
      const empty = {
        pending: 'Nothing waiting for approval. 🎉',
        upcoming: 'No upcoming entries.',
        held: 'Nothing is held from the newsletter.',
        past: 'No past entries.',
        rejected: 'No rejected entries.',
        archived: 'The archive is empty.',
      }[state.tab];
      list.innerHTML = `<p class="ea-empty">${esc(empty)}</p>`;
      return;
    }
    let html = '';
    if (state.tab === 'upcoming' || state.tab === 'held') {
      const weekEnd = addDays(state.today, 6);
      const groups = [
        ['This week', items.filter(e => e.next_occurrence && e.next_occurrence.date <= weekEnd)],
        ['Later', items.filter(e => e.next_occurrence && e.next_occurrence.date > weekEnd)],
        ['Ongoing (no date)', items.filter(e => !e.next_occurrence)],
      ];
      for (const [label, group] of groups) {
        if (group.length) html += `<h3 class="ea-group">${esc(label)} · ${group.length}</h3>` + group.map(rowHtml).join('');
      }
    } else {
      html = items.map(rowHtml).join('');
    }
    list.innerHTML = html;
  }

  function dateChip(e) {
    const occ = e.next_occurrence || e.occurrences.at(-1);
    if (!occ) return '<div class="ea-date ea-date--none"><span class="ea-date__day">ONGOING</span></div>';
    const p = dateParts(occ.date);
    const later = e.next_occurrence ? e.occurrences.filter(o => o.date > occ.date).length : 0;
    return `<div class="ea-date"><span class="ea-date__dow">${p.dow}</span><span class="ea-date__day">${esc(p.day)}</span>`
      + (occ.start_time ? `<span class="ea-date__more">${esc(occ.start_time)}</span>` : '')
      + (later ? `<span class="ea-date__more">+${later} more</span>` : '') + '</div>';
  }

  function tagChips(e) {
    return e.tags.map(t => `<span class="ea-chip" style="color:${esc(t.color || '#9a9da5')}">${esc(t.label)}</span>`).join('');
  }

  function rowHtml(e) {
    const meta = [
      e.leader ? `Q: ${esc(e.leader)}` : '',
      e.location ? esc(e.location) : '',
      e.lifecycle === 'pending' && e.submitter_name ? `from ${esc(e.submitter_name)}` : '',
      e.lifecycle === 'rejected' && e.reject_reason ? `reason: ${esc(e.reject_reason)}` : '',
    ].filter(Boolean).join(' · ');
    const flags = (e.featured ? '<span class="ea-flag ea-flag--featured">★ Featured</span>' : '')
      + (e.hold_from_newsletter ? '<span class="ea-flag">Held from newsletter</span>' : '')
      + (e.preblast_requested && !e.preblast_url ? '<span class="ea-flag">Pre-blast requested</span>' : '');
    let actions;
    if (e.lifecycle === 'pending') {
      actions = `<button type="button" class="btn btn--primary btn--sm" data-act="approve">Approve</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="reject">Reject</button>`;
    } else if (e.lifecycle === 'archived') {
      actions = '<button type="button" class="btn btn--ghost btn--sm" data-act="restore">Restore</button>';
    } else if (e.lifecycle === 'rejected') {
      actions = '<button type="button" class="btn btn--ghost btn--sm" data-act="unapprove">Back to queue</button>';
    } else {
      actions = `<button type="button" class="ea-icon-btn" data-act="feature" aria-pressed="${e.featured}" title="Featured" aria-label="Featured">★</button>
        <button type="button" class="ea-icon-btn" data-act="hold" aria-pressed="${e.hold_from_newsletter}" title="Hold from newsletter" aria-label="Hold from newsletter"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="2.6" height="9" fill="currentColor"/><rect x="7.4" y="1.5" width="2.6" height="9" fill="currentColor"/></svg></button>`;
    }
    return `<div class="ea-row${e.lifecycle === 'pending' ? ' is-pending' : ''}" data-id="${e.id}">
      ${dateChip(e)}
      <div class="ea-row__main">
        <button type="button" class="ea-row__title" data-act="edit">${esc(e.title)}</button>
        <div class="ea-row__meta">${tagChips(e)}${flags}${meta ? `<span>${meta}</span>` : ''}</div>
      </div>
      <div class="ea-row__actions">${actions}</div>
    </div>`;
  }

  $('#entry-list').addEventListener('click', async (ev) => {
    const row = ev.target.closest('.ea-row');
    if (!row) return;
    const id = Number(row.dataset.id);
    const entry = state.entries.find(e => e.id === id);
    const act = ev.target.closest('[data-act]')?.dataset.act || 'edit';
    try {
      if (act === 'edit') return openPanel(entry);
      if (act === 'approve') return approve(entry);
      if (act === 'reject') return reject(entry);
      if (act === 'restore') {
        await api(`/api/submissions/${id}/restore`, { method: 'POST' });
        await loadEntries();
        return toast('Restored');
      }
      if (act === 'unapprove') {
        replaceEntry(await api(`/api/entries/${id}/unapprove`, { method: 'POST' }));
      } else if (act === 'feature') {
        replaceEntry(await api(`/api/entries/${id}`, { method: 'PATCH', body: { featured: !entry.featured } }));
      } else if (act === 'hold') {
        replaceEntry(await api(`/api/entries/${id}`, { method: 'PATCH', body: { hold_from_newsletter: !entry.hold_from_newsletter } }));
      }
      renderTabs();
      renderList();
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  async function approve(entry) {
    try {
      const updated = await api(`/api/entries/${entry.id}/approve`, { method: 'POST' });
      replaceEntry(updated);
      renderTabs();
      renderList();
      if (state.editing?.id === entry.id) fillPanel(updated);
      toast(updated.warning || `Approved “${entry.title}” — it's live on the site.`);
    } catch (e) { toast(e.message, 'error'); }
  }

  function reject(entry) {
    const dlg = $('#reject-dialog');
    $('#reject-entry').textContent = entry.title;
    $('#reject-reason').value = '';
    dlg.showModal();
    dlg.addEventListener('close', async function onClose() {
      dlg.removeEventListener('close', onClose);
      if (dlg.returnValue !== 'confirm') return;
      try {
        const updated = await api(`/api/entries/${entry.id}/reject`, { method: 'POST', body: { reason: $('#reject-reason').value } });
        replaceEntry(updated);
        renderTabs();
        renderList();
        if (state.editing?.id === entry.id) closePanel(true);
        toast('Rejected');
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // ── Side panel editor ─────────────────────────────────────────────
  initRichEditor('entry-editor', 'entry-content', 'f-description');
  initRichEditor('nantan-editor', 'nantan-content', 'nantan-text');

  function occRow(o = {}) {
    const div = document.createElement('div');
    div.className = 'ea-occ' + (o.date && state.today && o.date < state.today ? ' is-past' : '');
    div.innerHTML = `
      <label class="ea-sr">Date</label><input type="date" class="ea-input" data-k="date" value="${esc(o.date || '')}" required>
      <label class="ea-sr">Start time</label><input class="ea-input" data-k="start_time" placeholder="Start e.g. 0530" value="${esc(o.start_time || '')}">
      <label class="ea-sr">End time</label><input class="ea-input ea-occ__end" data-k="end_time" placeholder="End e.g. 0615" value="${esc(o.end_time || '')}">
      <button type="button" class="ea-icon-btn" data-remove aria-label="Remove this date">✕</button>`;
    div.querySelector('[data-remove]').addEventListener('click', () => { div.remove(); state.dirty = true; });
    return div;
  }

  function renderTagPicker(selected) {
    const box = $('#f-tags');
    const ids = new Set(selected.map(t => t.id));
    box.innerHTML = state.tags.length
      ? state.tags.map(t => `<button type="button" class="ea-tag-toggle" data-tag="${t.id}" aria-pressed="${ids.has(t.id)}"
          style="${ids.has(t.id) ? `background:${esc(t.color)};border-color:${esc(t.color)}` : `color:${esc(t.color)}`}">${esc(t.label)}</button>`).join('')
      : '<p class="ea-hint">No tags yet — add some under “Manage tags”.</p>';
  }
  $('#f-tags').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.ea-tag-toggle');
    if (!btn) return;
    const on = btn.getAttribute('aria-pressed') !== 'true';
    const tag = state.tags.find(t => String(t.id) === btn.dataset.tag);
    btn.setAttribute('aria-pressed', String(on));
    btn.style.cssText = on ? `background:${tag.color};border-color:${tag.color}` : `color:${tag.color}`;
    state.dirty = true;
  });

  function setHero(url) {
    $('#f-hero').value = url || '';
    const img = $('#f-hero-img');
    img.hidden = !url;
    if (url) img.src = url; else img.removeAttribute('src');
    $('#f-hero-remove').hidden = !url;
  }

  function renderDecision(e) {
    const bar = $('#panel-decision');
    const status = $('#panel-status');
    status.textContent = e.lifecycle === 'archived' ? 'archived' : e.status;
    status.className = `ea-status ea-status--${e.status}`;
    if (e.lifecycle === 'archived') {
      bar.innerHTML = '<span class="ea-hint">This entry is archived.</span>';
    } else if (e.status === 'pending') {
      bar.innerHTML = `<span class="ea-hint">Waiting for approval${e.submitter_name ? ` · submitted by ${esc(e.submitter_name)}` : ''}.</span>
        <span class="ea-spacer"></span>
        <button type="button" class="btn btn--ghost btn--sm" data-decide="reject">Reject</button>
        <button type="button" class="btn btn--primary btn--sm" data-decide="approve">Save &amp; approve</button>`;
    } else if (e.status === 'rejected') {
      bar.innerHTML = `<span class="ea-hint">Rejected${e.reject_reason ? `: ${esc(e.reject_reason)}` : ''}.</span>
        <span class="ea-spacer"></span><button type="button" class="btn btn--ghost btn--sm" data-decide="unapprove">Back to the queue</button>`;
    } else {
      bar.innerHTML = `<span class="ea-hint">Live on the site${e.hold_from_newsletter ? ', held from the newsletter' : ''}.</span>
        <span class="ea-spacer"></span><button type="button" class="btn btn--ghost btn--sm" data-decide="unapprove">Unpublish (back to queue)</button>`;
    }
  }

  function fillPanel(e) {
    state.editing = e;
    $('#panel-title').textContent = e.title || 'New entry';
    renderDecision(e);
    $('#f-title').value = e.title || '';
    $('#f-leader').value = e.leader || '';
    $('#f-location').value = e.location || '';
    const occBox = $('#f-occurrences');
    occBox.innerHTML = '';
    e.occurrences.forEach(o => occBox.appendChild(occRow(o)));
    renderTagPicker(e.tags);
    $('#f-summary').value = e.summary || '';
    $('#entry-content').innerHTML = e.description || '';
    $('#f-description').value = e.description || '';
    setHero(e.hero_image);
    $('#f-link').value = e.link || '';
    $('#f-video').value = e.video_url || '';
    $('#f-featured').checked = e.featured;
    $('#f-hold').checked = e.hold_from_newsletter;
    $('#f-slug').value = e.slug || '';
    $('#f-submitter').textContent = [e.submitter_name, e.submitter_email, e.submitter_phone].filter(Boolean).length
      ? `Submitted by ${[e.submitter_name, e.submitter_email, e.submitter_phone].filter(Boolean).join(' · ')}` : '';
    $('#f-preblast').textContent = e.preblast_url ? `Pre-blast: ${e.preblast_url}`
      : e.preblast_requested ? 'A pre-blast was requested; it is posted when the entry is approved.' : '';
    $('#panel-archive').textContent = e.lifecycle === 'archived' ? 'Restore' : 'Archive';
    state.dirty = false;
  }

  function openPanel(entry) {
    fillPanel(entry);
    $('#edit-panel').hidden = false;
    $('#panel-scrim').hidden = false;
    history.replaceState(null, '', `#entry-${entry.id}`);
    $('#f-title').focus();
  }

  function closePanel(force = false) {
    if (!force && state.dirty && !confirm('Discard your unsaved changes?')) return;
    state.editing = null;
    state.dirty = false;
    $('#edit-panel').hidden = true;
    $('#panel-scrim').hidden = true;
    history.replaceState(null, '', location.pathname);
  }

  function openFromHash() {
    const m = location.hash.match(/^#entry-(\d+)$/);
    if (!m) return;
    const e = state.entries.find(x => x.id === Number(m[1]));
    if (!e) return toast('That entry no longer exists', 'error');
    state.tab = e.lifecycle === 'ongoing' ? 'upcoming' : tabOf(e);
    renderTabs();
    renderList();
    openPanel(e);
  }

  $('#entry-form').addEventListener('input', () => { state.dirty = true; });
  $('#entry-content').addEventListener('input', () => { state.dirty = true; });
  $('#add-occurrence').addEventListener('click', () => {
    const rows = $$('#f-occurrences .ea-occ');
    const last = rows.at(-1);
    const prev = last ? Object.fromEntries($$('[data-k]', last).map(i => [i.dataset.k, i.value])) : {};
    // Suggest a week after the previous date, keeping its times — handy for weekly events.
    const next = prev.date ? { ...prev, date: addDays(prev.date, 7) } : { date: state.today };
    $('#f-occurrences').appendChild(occRow(next));
    state.dirty = true;
  });

  $('#f-hero-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    try {
      const res = await fetch('/api/upload/image', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setHero(data.url);
      state.dirty = true;
    } catch (e) { toast(e.message, 'error'); }
    ev.target.value = '';
  });
  $('#f-hero-remove').addEventListener('click', () => { setHero(''); state.dirty = true; });

  $('#gen-summary').addEventListener('click', async () => {
    const btn = $('#gen-summary');
    const html = $('#entry-content').innerHTML.trim();
    if (!html) return toast('Write a description first', 'error');
    btn.disabled = true;
    btn.textContent = 'Generating…';
    try {
      const res = await fetch('/api/generate-snippet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not generate a summary');
      const tmp = document.createElement('div');
      tmp.innerHTML = data.snippet || '';
      $('#f-summary').value = tmp.textContent.replace(/\s+/g, ' ').trim();
      state.dirty = true;
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false;
    btn.textContent = 'Generate from description';
  });

  function collectForm() {
    const occurrences = $$('#f-occurrences .ea-occ').map(row => Object.fromEntries($$('[data-k]', row).map(i => [i.dataset.k, i.value.trim()])))
      .filter(o => o.date || o.start_time || o.end_time);
    const missing = occurrences.find(o => !o.date);
    if (missing) throw new Error('Every date row needs a date (or remove the row).');
    return {
      title: $('#f-title').value.trim(),
      leader: $('#f-leader').value.trim(),
      location: $('#f-location').value.trim(),
      occurrences,
      tags: $$('#f-tags .ea-tag-toggle[aria-pressed="true"]').map(b => Number(b.dataset.tag)),
      summary: $('#f-summary').value.trim(),
      description: $('#entry-content').innerHTML.trim(),
      hero_image: $('#f-hero').value || null,
      link: $('#f-link').value.trim(),
      video_url: $('#f-video').value.trim(),
      featured: $('#f-featured').checked,
      hold_from_newsletter: $('#f-hold').checked,
      slug: $('#f-slug').value.trim() || undefined,
    };
  }

  async function save() {
    const e = state.editing;
    if (!e) return null;
    const body = collectForm();
    if (!body.title) throw new Error('Title is required');
    const updated = await api(`/api/entries/${e.id}`, { method: 'PATCH', body });
    replaceEntry(updated);
    state.dirty = false;
    return updated;
  }

  $('#panel-save').addEventListener('click', async () => {
    try {
      const updated = await save();
      renderTabs();
      renderList();
      fillPanel(updated);
      toast('Saved');
    } catch (e) { toast(e.message, 'error'); }
  });

  $('#panel-decision').addEventListener('click', async (ev) => {
    const act = ev.target.closest('[data-decide]')?.dataset.decide;
    if (!act || !state.editing) return;
    try {
      if (act === 'approve') {
        await save();
        await approve(state.editing);
      } else if (act === 'reject') {
        reject(state.editing);
      } else if (act === 'unapprove') {
        const updated = await api(`/api/entries/${state.editing.id}/unapprove`, { method: 'POST' });
        replaceEntry(updated);
        fillPanel(updated);
        renderTabs();
        renderList();
        toast('Moved back to Needs approval');
      }
    } catch (e) { toast(e.message, 'error'); }
  });

  $('#panel-archive').addEventListener('click', async () => {
    const e = state.editing;
    if (!e) return;
    try {
      if (e.lifecycle === 'archived') {
        await api(`/api/submissions/${e.id}/restore`, { method: 'POST' });
        toast('Restored');
      } else {
        if (!confirm(`Archive “${e.title}”? It disappears from the site and the newsletter (you can restore it from Archive).`)) return;
        await api(`/api/submissions/${e.id}`, { method: 'DELETE' });
        toast('Archived');
      }
      closePanel(true);
      await loadEntries();
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#panel-close').addEventListener('click', () => closePanel());
  $('#panel-cancel').addEventListener('click', () => closePanel());
  $('#panel-scrim').addEventListener('click', () => { closePanel(); $('#preview-panel').hidden = true; });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (!$('#edit-panel').hidden) closePanel();
    else if (!$('#preview-panel').hidden) { $('#preview-panel').hidden = true; $('#panel-scrim').hidden = true; }
  });

  $('#new-entry-btn').addEventListener('click', async () => {
    try {
      const created = await api('/api/entries', { method: 'POST', body: { title: 'Untitled entry' } });
      replaceEntry(created);
      state.tab = 'upcoming';
      renderTabs();
      renderList();
      openPanel(created);
      $('#f-title').select();
    } catch (e) { toast(e.message, 'error'); }
  });

  // ── Tags manager ──────────────────────────────────────────────────
  function renderTagsList() {
    $('#tags-list').innerHTML = state.tags.map((t, i) => `
      <li data-id="${t.id}">
        <input type="color" class="ea-color" value="${esc(t.color || '#9a9da5')}" aria-label="Color for ${esc(t.label)}" data-tag-color>
        <input class="ea-input" value="${esc(t.label)}" aria-label="Tag name" data-tag-label maxlength="40">
        <span class="ea-tag-count" title="Entries with this tag">${t.entry_count}</span>
        <button type="button" class="ea-icon-btn" data-tag-move="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="ea-icon-btn" data-tag-move="1" aria-label="Move down" ${i === state.tags.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="ea-icon-btn" data-tag-delete aria-label="Delete ${esc(t.label)}">✕</button>
      </li>`).join('');
  }

  async function afterTagChange() {
    await loadTags();
    renderTagsList();
    await loadEntries();
  }

  $('#tags-btn').addEventListener('click', () => { renderTagsList(); $('#tags-dialog').showModal(); });
  $('#tags-close').addEventListener('click', () => $('#tags-dialog').close());
  $('#tags-list').addEventListener('change', async (ev) => {
    const li = ev.target.closest('li');
    if (!li) return;
    const body = ev.target.matches('[data-tag-color]') ? { color: ev.target.value } : ev.target.matches('[data-tag-label]') ? { label: ev.target.value } : null;
    if (!body) return;
    try { await api(`/api/tags/${li.dataset.id}`, { method: 'PATCH', body }); await afterTagChange(); }
    catch (e) { toast(e.message, 'error'); renderTagsList(); }
  });
  $('#tags-list').addEventListener('click', async (ev) => {
    const li = ev.target.closest('li');
    if (!li) return;
    const id = Number(li.dataset.id);
    try {
      if (ev.target.closest('[data-tag-delete]')) {
        const tag = state.tags.find(t => t.id === id);
        if (!confirm(`Delete the “${tag.label}” tag? It will be removed from ${tag.entry_count} entr${tag.entry_count === 1 ? 'y' : 'ies'}.`)) return;
        await api(`/api/tags/${id}`, { method: 'DELETE' });
        await afterTagChange();
      } else if (ev.target.closest('[data-tag-move]')) {
        const dir = Number(ev.target.closest('[data-tag-move]').dataset.tagMove);
        const order = state.tags.map(t => t.id);
        const i = order.indexOf(id);
        [order[i], order[i + dir]] = [order[i + dir], order[i]];
        await api('/api/tags/reorder', { method: 'POST', body: { order } });
        await afterTagChange();
      }
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#tag-add-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('/api/tags', { method: 'POST', body: { label: $('#tag-add-label').value, color: $('#tag-add-color').value } });
      $('#tag-add-label').value = '';
      await afterTagChange();
    } catch (e) { toast(e.message, 'error'); }
  });

  // ── Region: Nan'tan ───────────────────────────────────────────────
  async function loadNantan() {
    try {
      const n = await api('/api/region/nantan');
      $('#nantan-author').value = n.author || '';
      $('#nantan-heading').value = n.heading || '';
      $('#nantan-content').innerHTML = n.text || '';
    } catch (e) { toast(e.message, 'error'); }
  }
  $('#nantan-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('/api/region/nantan', { method: 'PUT', body: {
        author: $('#nantan-author').value, heading: $('#nantan-heading').value, text: $('#nantan-content').innerHTML.trim(),
      } });
      toast('Saved the Nan’tan’s message');
    } catch (e) { toast(e.message, 'error'); }
  });

  // ── Newsletter preview ────────────────────────────────────────────
  async function renderPreview() {
    const layout = $('#preview-layout').value;
    const data = await api('/api/newsletter/generate', { method: 'POST', body: { layout } });
    const sep = data.url.includes('?') ? '&' : '?';
    $('#preview-frame').src = `${data.url}${sep}t=${Date.now()}`;
    $('#preview-open').href = data.url;
  }
  $('#preview-btn').addEventListener('click', async () => {
    const btn = $('#preview-btn');
    btn.disabled = true;
    btn.textContent = 'Generating…';
    try {
      await renderPreview();
      $('#preview-panel').hidden = false;
      $('#panel-scrim').hidden = false;
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false;
    btn.textContent = 'Preview newsletter';
  });
  $('#preview-layout').addEventListener('change', () => renderPreview().catch(e => toast(e.message, 'error')));
  $('#preview-width').addEventListener('click', () => {
    const btn = $('#preview-width');
    const phone = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(phone));
    $('#preview-frame').style.width = phone ? '390px' : '100%';
    $('#preview-frame').style.margin = phone ? '0 auto' : '';
  });
  $('#preview-close').addEventListener('click', () => { $('#preview-panel').hidden = true; $('#panel-scrim').hidden = true; });
  // Campaign creation/scheduling intentionally isn't wired here yet: Mailchimp stays on the
  // classic board until it's set up in a supervised session.

  // Slack "Review in admin" links may land in an already-open admin tab.
  window.addEventListener('hashchange', () => { if (state.entries.length) openFromHash(); });

  window.addEventListener('beforeunload', (ev) => { if (state.dirty) { ev.preventDefault(); ev.returnValue = ''; } });

  // ── Boot ──────────────────────────────────────────────────────────
  fetch('/api/admin/check-auth').then(r => r.json()).then(d => (d.authenticated ? showApp() : showLogin())).catch(showLogin);
})();
