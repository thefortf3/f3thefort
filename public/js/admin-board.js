/**
 * admin-board.js — Kanban board for newsletter admin
 * Depends on app.js being loaded first (formatDate, formatTimeRange, escapeHtml, stripHtml, initRichEditor)
 */

/* ============================================================
   State
   ============================================================ */
let boardSections = [];
let allEntries = [];
let dragState = null;
let currentEditId = null;
let pendingDeleteId = null;
let pendingDeleteMode = null; // 'archive' | 'permanent'

// Static section state
let staticSections = { threeFsItems: [], sltEntries: [], helpfulLinks: [], shovelFlags: [], vqs: [] };
let activeThreeFsTab = 'fitness';

/* ============================================================
   Entry point
   ============================================================ */
async function initAdminBoard() {
  const loginView = document.getElementById('login-view');
  const dashView = document.getElementById('dashboard-view');

  // Check auth
  try {
    const r = await fetch('/api/admin/check-auth');
    const data = await r.json();
    if (data.authenticated) {
      loginView.style.display = 'none';
      dashView.style.display = 'flex';
      await loadData();
    } else {
      loginView.style.display = 'block';
      dashView.style.display = 'none';
    }
  } catch {
    loginView.style.display = 'block';
  }

  wireLogin();
  wireLogout();
  wireTabs();
  wireModals();
  wireNewsletterButtons();
  wireArchiveSearch();
  wireSectionsManager();
  wireStaticEditors();
}

/* ============================================================
   Data loading
   ============================================================ */
async function loadData() {
  const [sectionsRes, entriesRes, threeFsRes, sltRes, linksRes, shovelFlagsRes, vqsRes] = await Promise.all([
    fetch('/api/sections'),
    fetch('/api/submissions?limit=500'),
    fetch('/api/static/three-fs'),
    fetch('/api/static/slt'),
    fetch('/api/static/links'),
    fetch('/api/static/shovel-flags'),
    fetch('/api/static/vqs'),
  ]);
  boardSections = await sectionsRes.json();
  const entriesData = await entriesRes.json();
  allEntries = entriesData.items || [];
  staticSections.threeFsItems = await threeFsRes.json();
  staticSections.sltEntries = await sltRes.json();
  staticSections.helpfulLinks = await linksRes.json();
  staticSections.shovelFlags = await shovelFlagsRes.json();
  staticSections.vqs = await vqsRes.json();
  renderBoard();
}

/* ============================================================
   Board rendering
   ============================================================ */
function renderBoard() {
  const board = document.getElementById('kanban-board');
  board.innerHTML = '';

  // Unsorted lane first
  const unsorted = allEntries.filter(e => !e.section);
  board.appendChild(buildLane(null, unsorted));

  // Locked Header (desk) lane — always first among sections
  const deskSec = boardSections.find(s => s.id === 'desk');
  if (deskSec) {
    board.appendChild(buildLane(deskSec, allEntries.filter(e => e.section === 'desk'), true));
  }

  // Shovel Flag Hand-off — locked, always after header
  board.appendChild(buildProtectedLane('shovel-flags', 'Shovel Flag Hand-off', '#8B3A2A'));

  // VQs — locked, always after shovel flags
  board.appendChild(buildProtectedLane('vqs', 'VQs This Week', '#2A5F8B'));

  // Other section lanes in order
  for (const sec of boardSections.filter(s => s.id !== 'desk')) {
    const items = allEntries.filter(e => e.section === sec.id);
    board.appendChild(buildLane(sec, items));
  }

  // Protected static lanes (always last, cannot be moved/deleted)
  board.appendChild(buildProtectedLane('three-fs', "The Three F's", '#5B7DB1'));
  board.appendChild(buildProtectedLane('slt', 'Shared Leadership Team', '#3A7D5C'));
  board.appendChild(buildProtectedLane('helpful-links', 'Helpful Links', '#8a6a2a'));

  setupDragDrop();
  updateEntryCount();
}

function buildLane(section, items, locked = false) {
  const lane = document.createElement('div');
  lane.className = 'kanban-lane' + (section === null ? ' kanban-lane--unsorted' : '') + (locked ? ' kanban-lane--header-locked' : '');
  lane.dataset.section = section ? section.id : '';

  const accentColor = section ? section.accent : '#6e6860';
  const lockBadge = locked ? `<span class="protected-lock" title="Locked section">&#128274;</span>` : '';

  lane.innerHTML = `
    <div class="kanban-lane__header" style="--lane-accent: ${accentColor};">
      <span class="kanban-lane__label">${section ? escapeHtml(section.label) : 'INCOMING'}</span>
      ${lockBadge}
      <span class="kanban-lane__count" id="lane-count-${section ? section.id : 'unsorted'}">${items.length}</span>
    </div>
    <div class="kanban-lane__body" data-section="${section ? section.id : ''}">
      ${items.length === 0 ? '<div class="kanban-lane__empty">Drop here</div>' : ''}
      ${items.map(e => buildKanbanCard(e, section)).join('')}
    </div>
  `;

  return lane;
}

function buildKanbanCard(entry, section) {
  const accentColor = section ? section.accent : '#6e6860';
  const dateStr = typeof formatDate === 'function' ? formatDate(entry.start_date) : '';
  const excerpt = typeof stripHtml === 'function' ? stripHtml(entry.description || '').slice(0, 80) : '';

  return `
    <div class="kanban-card"
         draggable="true"
         data-entry-id="${entry.id}"
         data-section="${section ? section.id : ''}"
         style="--card-accent: ${accentColor};">
      <div class="kanban-card__header">
        <div class="kanban-card__drag-handle">⠿</div>
        <div class="kanban-card__title entry-open-btn" data-entry-id="${entry.id}">${escapeHtml(entry.title)}</div>
      </div>
      <div class="kanban-card__meta">
        ${dateStr ? `<span>${dateStr}</span>` : ''}
        ${entry.leader ? `<span>Q: ${escapeHtml(entry.leader)}</span>` : ''}
        ${entry.location ? `<span>${escapeHtml(entry.location)}</span>` : ''}
      </div>
      ${excerpt ? `<p class="kanban-card__excerpt">${escapeHtml(excerpt)}${entry.description && entry.description.length > 80 ? '…' : ''}</p>` : ''}
      <div class="kanban-card__footer">
        <button class="kanban-card__btn entry-open-btn" data-entry-id="${entry.id}">Edit</button>
        <button class="kanban-card__btn kanban-card__btn--danger entry-archive-btn" data-entry-id="${entry.id}">Archive</button>
      </div>
    </div>
  `;
}

function updateEntryCount() {
  const el = document.getElementById('entry-count');
  if (el) {
    const active = allEntries.filter(e => !e.archived_at).length;
    el.textContent = `${active} active ${active === 1 ? 'entry' : 'entries'}`;
  }
}

/* ============================================================
   Drag and Drop
   ============================================================ */
function setupDragDrop() {
  const board = document.getElementById('kanban-board');

  board.addEventListener('dragstart', onDragStart);
  board.addEventListener('dragend', onDragEnd);
  board.addEventListener('dragover', onDragOver);
  board.addEventListener('dragleave', onDragLeave);
  board.addEventListener('drop', onDrop);

  // Card clicks (edit + archive) via delegation
  board.addEventListener('click', (e) => {
    const openBtn = e.target.closest('.entry-open-btn');
    if (openBtn) {
      openEditModal(parseInt(openBtn.dataset.entryId));
      return;
    }
    const archiveBtn = e.target.closest('.entry-archive-btn');
    if (archiveBtn) {
      confirmArchive(parseInt(archiveBtn.dataset.entryId));
    }
  });
}

function onDragStart(e) {
  const card = e.target.closest('.kanban-card');
  if (!card) return;
  dragState = {
    entryId: parseInt(card.dataset.entryId),
    fromSection: card.dataset.section || null,
  };
  card.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(card.dataset.entryId));
}

function onDragEnd() {
  document.querySelectorAll('.kanban-card.is-dragging').forEach(c => c.classList.remove('is-dragging'));
  document.querySelectorAll('.kanban-lane--drag-over').forEach(l => l.classList.remove('kanban-lane--drag-over'));
  document.querySelectorAll('.drop-indicator').forEach(d => d.remove());
  dragState = null;
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const laneBody = e.target.closest('.kanban-lane__body');
  if (!laneBody) return;

  const lane = laneBody.closest('.kanban-lane');

  // Highlight the target lane
  document.querySelectorAll('.kanban-lane--drag-over').forEach(l => {
    if (l !== lane) l.classList.remove('kanban-lane--drag-over');
  });
  lane.classList.add('kanban-lane--drag-over');

  // Compute drop position and show indicator
  const cards = [...laneBody.querySelectorAll('.kanban-card:not(.is-dragging)')];
  let insertBefore = null;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      insertBefore = card;
      break;
    }
  }

  // Remove old indicator, place new one
  laneBody.querySelectorAll('.drop-indicator').forEach(d => d.remove());
  const indicator = document.createElement('div');
  indicator.className = 'drop-indicator';
  if (insertBefore) {
    laneBody.insertBefore(indicator, insertBefore);
  } else {
    laneBody.appendChild(indicator);
  }
}

function onDragLeave(e) {
  const laneBody = e.target.closest('.kanban-lane__body');
  if (!laneBody) return;
  if (!laneBody.contains(e.relatedTarget)) {
    laneBody.closest('.kanban-lane')?.classList.remove('kanban-lane--drag-over');
    laneBody.querySelectorAll('.drop-indicator').forEach(d => d.remove());
  }
}

async function onDrop(e) {
  e.preventDefault();

  const laneBody = e.target.closest('.kanban-lane__body');
  if (!laneBody || !dragState) return;

  const lane = laneBody.closest('.kanban-lane');
  const toSection = lane.dataset.section || null;
  const fromSection = dragState.fromSection || null;
  const entryId = dragState.entryId;

  // Clean up drag styles
  document.querySelectorAll('.kanban-lane--drag-over').forEach(l => l.classList.remove('kanban-lane--drag-over'));

  // Find drop insert position (before removing indicator)
  const cards = [...laneBody.querySelectorAll('.kanban-card:not(.is-dragging)')];
  const indicator = laneBody.querySelector('.drop-indicator');
  let insertBeforeCard = null;
  if (indicator) {
    // Find the card after the indicator
    let next = indicator.nextElementSibling;
    while (next && !next.classList.contains('kanban-card')) {
      next = next.nextElementSibling;
    }
    insertBeforeCard = next;
    indicator.remove();
  }

  // Remove kanban-lane__empty if present
  laneBody.querySelectorAll('.kanban-lane__empty').forEach(el => el.remove());

  // Move card DOM optimistically
  const draggingCard = document.querySelector(`.kanban-card[data-entry-id="${entryId}"]`);
  if (!draggingCard) return;

  const fromLaneBody = draggingCard.closest('.kanban-lane__body');
  if (insertBeforeCard && insertBeforeCard.parentNode === laneBody) {
    laneBody.insertBefore(draggingCard, insertBeforeCard);
  } else {
    laneBody.appendChild(draggingCard);
  }

  // Update card accent color for new section
  const secData = toSection ? boardSections.find(s => s.id === toSection) : null;
  const newAccent = secData ? secData.accent : '#6e6860';
  draggingCard.style.setProperty('--card-accent', newAccent);
  draggingCard.dataset.section = toSection || '';

  // Add empty state if from-lane is now empty
  if (fromLaneBody && fromLaneBody !== laneBody) {
    const remaining = fromLaneBody.querySelectorAll('.kanban-card').length;
    if (remaining === 0) {
      fromLaneBody.innerHTML = '<div class="kanban-lane__empty">Drop here</div>';
    }
    // Update from-lane count
    updateLaneCount(fromSection);
  }
  updateLaneCount(toSection);

  // Update local state
  const entry = allEntries.find(en => en.id === entryId);
  if (entry) entry.section = toSection || null;

  // Persist changes to API
  try {
    // Section change
    if (fromSection !== toSection) {
      const r = await fetch(`/api/submissions/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: toSection }),
      });
      if (!r.ok) throw new Error('section update failed');
    }

    // Position reorder for target lane
    const targetCards = [...laneBody.querySelectorAll('.kanban-card')];
    const order = targetCards.map(c => parseInt(c.dataset.entryId));
    await fetch('/api/submissions/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: toSection, order }),
    });

    // Reorder source lane too if different
    if (fromSection !== toSection && fromLaneBody) {
      const sourceCards = [...fromLaneBody.querySelectorAll('.kanban-card')];
      if (sourceCards.length > 0) {
        const sourceOrder = sourceCards.map(c => parseInt(c.dataset.entryId));
        await fetch('/api/submissions/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section: fromSection, order: sourceOrder }),
        });
      }
    }
  } catch (err) {
    showToast('Failed to save position — reloading', 'error');
    await loadData();
  }
}

function updateLaneCount(sectionId) {
  const key = sectionId || 'unsorted';
  const countEl = document.getElementById(`lane-count-${key}`);
  if (!countEl) return;
  const lane = countEl.closest('.kanban-lane');
  if (!lane) return;
  const count = lane.querySelectorAll('.kanban-card').length;
  countEl.textContent = count;
}

/* ============================================================
   Archive Tab
   ============================================================ */
let archiveDebounce = null;

function wireArchiveSearch() {
  const input = document.getElementById('archive-search');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(archiveDebounce);
    archiveDebounce = setTimeout(() => loadArchive(input.value.trim()), 280);
  });
}

async function loadArchive(q = '') {
  const listEl = document.getElementById('archive-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="kanban-lane__empty" style="opacity:1;padding:20px 0;">Loading…</div>';
  try {
    const url = `/api/submissions?archived=true&limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    const r = await fetch(url);
    const data = await r.json();
    const items = data.items || [];

    if (items.length === 0) {
      listEl.innerHTML = `<div class="empty-state" style="padding: 2rem 0;">
        <div class="empty-state__icon">🗄️</div>
        <h3 class="empty-state__title">${q ? 'No results' : 'Archive is empty'}</h3>
        <p class="empty-state__text">${q ? `No archived entries match "${escapeHtml(q)}"` : 'Archived entries appear here.'}</p>
      </div>`;
      return;
    }

    listEl.innerHTML = items.map(entry => buildArchiveCard(entry)).join('');

    // Wire restore/delete buttons
    listEl.querySelectorAll('.restore-btn').forEach(btn => {
      btn.addEventListener('click', () => restoreEntry(parseInt(btn.dataset.entryId)));
    });
    listEl.querySelectorAll('.delete-forever-btn').forEach(btn => {
      btn.addEventListener('click', () => confirmPermanentDelete(parseInt(btn.dataset.entryId)));
    });
  } catch {
    listEl.innerHTML = '<div class="alert alert--error">Failed to load archive.</div>';
  }
}

function buildArchiveCard(entry) {
  const dateStr = typeof formatDate === 'function' ? formatDate(entry.start_date) : '';
  const archivedDate = entry.archived_at
    ? new Date(entry.archived_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  const excerpt = typeof stripHtml === 'function' ? stripHtml(entry.description || '').slice(0, 120) : '';

  return `
    <div class="entry-card entry-card--archived" data-entry-id="${entry.id}">
      ${entry.hero_image ? `<img class="entry-card__hero" src="${escapeHtml(entry.hero_image)}" alt="${escapeHtml(entry.title)}">` : ''}
      <div class="entry-card__header">
        <div>
          <h4 class="entry-card__title"><a href="#">${escapeHtml(entry.title)}</a></h4>
          <div class="entry-card__meta">
            ${dateStr ? `<span class="entry-card__meta-item">${dateStr}</span>` : ''}
            ${archivedDate ? `<span class="entry-card__meta-item entry-card__meta-item--archived">Archived ${archivedDate}</span>` : ''}
          </div>
          ${excerpt ? `<p class="entry-card__excerpt">${escapeHtml(excerpt)}${entry.description && entry.description.length > 120 ? '…' : ''}</p>` : ''}
        </div>
        <div class="entry-card__actions">
          <button class="btn btn--secondary btn--sm restore-btn" data-entry-id="${entry.id}">Restore</button>
          <button class="btn btn--ghost btn--sm delete-forever-btn" data-entry-id="${entry.id}" style="color: var(--rust);">Delete Forever</button>
        </div>
      </div>
    </div>
  `;
}

async function restoreEntry(id) {
  try {
    const r = await fetch(`/api/submissions/${id}/restore`, { method: 'POST' });
    if (!r.ok) throw new Error();
    showToast('Entry restored', 'success');
    const input = document.getElementById('archive-search');
    loadArchive(input?.value?.trim() || '');
    // Reload board entry list
    await loadData();
  } catch {
    showToast('Failed to restore entry', 'error');
  }
}

function confirmPermanentDelete(id) {
  const entry = allEntries.find(e => e.id === id) || { title: 'this entry' };
  pendingDeleteId = id;
  pendingDeleteMode = 'permanent';

  const modal = document.getElementById('delete-modal');
  document.getElementById('delete-modal-title').textContent = 'Delete Forever';
  document.getElementById('delete-modal-body').textContent = 'This will permanently delete the entry. This cannot be undone.';
  document.getElementById('delete-entry-title').textContent = entry.title;
  document.getElementById('delete-confirm-btn').textContent = 'Delete Forever';
  openModal(modal);
}

/* ============================================================
   Login / Logout
   ============================================================ */
function wireLogin() {
  const form = document.getElementById('login-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pwd = document.getElementById('admin-password').value;
    const alertEl = document.getElementById('login-alert');
    const btn = document.getElementById('login-btn');
    const spinner = document.getElementById('login-spinner');
    const text = document.getElementById('login-text');

    btn.disabled = true;
    spinner.style.display = 'inline-block';
    text.style.display = 'none';
    alertEl.innerHTML = '';

    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      });
      if (r.ok) {
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('dashboard-view').style.display = 'block';
        await loadData();
      } else {
        alertEl.innerHTML = '<div class="alert alert--error">Incorrect password.</div>';
      }
    } catch {
      alertEl.innerHTML = '<div class="alert alert--error">Network error. Try again.</div>';
    } finally {
      btn.disabled = false;
      spinner.style.display = 'none';
      text.style.display = 'inline';
    }
  });
}

function wireLogout() {
  const btn = document.getElementById('logout-btn');
  if (!btn) return;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/admin/logout', { method: 'POST' });
    document.getElementById('dashboard-view').style.display = 'none';
    document.getElementById('login-view').style.display = 'block';
    document.getElementById('admin-password').value = '';
  });
}

/* ============================================================
   Tabs
   ============================================================ */
function wireTabs() {
  document.querySelectorAll('.board-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.board-tab').forEach(t => t.classList.remove('board-tab--active'));
      tab.classList.add('board-tab--active');

      const target = tab.dataset.tab;
      document.getElementById('board-view').style.display = target === 'board' ? 'block' : 'none';
      document.getElementById('archive-view').style.display = target === 'archive' ? 'block' : 'none';

      if (target === 'archive') {
        const input = document.getElementById('archive-search');
        loadArchive(input?.value?.trim() || '');
      }
    });
  });
}

/* ============================================================
   Newsletter buttons
   ============================================================ */
function wireNewsletterButtons() {
  // Changelog
  document.getElementById('changelog-btn')?.addEventListener('click', openChangelog);

  // Generate newsletter
  document.getElementById('generate-newsletter-btn')?.addEventListener('click', openVqModal);

  // VQ modal
  document.getElementById('vq-modal-cancel')?.addEventListener('click', () => closeModal(document.getElementById('vq-modal')));
  document.getElementById('vq-modal-close')?.addEventListener('click', () => closeModal(document.getElementById('vq-modal')));
  document.getElementById('vq-modal-confirm')?.addEventListener('click', generateNewsletter);

  // Campaign button
  document.getElementById('campaign-btn')?.addEventListener('click', createCampaign);

  // Preview dismiss
  document.getElementById('preview-dismiss-btn')?.addEventListener('click', closePreviewPane);

  // Viewport toggle
  document.getElementById('preview-desktop-btn')?.addEventListener('click', () => setPreviewViewport('desktop'));
  document.getElementById('preview-mobile-btn')?.addEventListener('click', () => setPreviewViewport('mobile'));
}

async function openVqModal() {
  const modal = document.getElementById('vq-modal');
  const fngsEl = document.getElementById('vq-modal-fngs');

  try {
    const r = await fetch('/api/newsletter/preview-data');
    const data = await r.json();
    fngsEl.innerHTML = data.weeklyFngs?.length > 0
      ? data.weeklyFngs.map(f => `<div>${escapeHtml(f.f3_name)}${f.ehed_by ? ` <span style="color:var(--text-dim)">EH: ${escapeHtml(f.ehed_by)}</span>` : ''}</div>`).join('')
      : 'None this week';
  } catch {
    fngsEl.textContent = '—';
  }

  openModal(modal);
}

const PREVIEW_DESKTOP_WIDTH = 860; // newsletter max-width is 820px, render at this width

function openPreviewPane() {
  document.getElementById('board-split').classList.add('board-split--has-preview');
  // Scaling needs to run after the pane is visible (so offsetWidth is real)
  requestAnimationFrame(applyDesktopScale);
}

function closePreviewPane() {
  document.getElementById('board-split').classList.remove('board-split--has-preview');
}

function applyDesktopScale() {
  const pane = document.getElementById('preview-pane');
  const viewport = document.getElementById('preview-viewport');
  const iframe = document.getElementById('newsletter-iframe');
  if (!viewport || !iframe || pane.classList.contains('preview-pane--mobile')) return;

  const paneW = viewport.offsetWidth;
  const paneH = viewport.offsetHeight;
  if (!paneW || !paneH) return;

  const scale = paneW / PREVIEW_DESKTOP_WIDTH;
  iframe.style.position = 'absolute';
  iframe.style.top = '0';
  iframe.style.left = '0';
  iframe.style.width = PREVIEW_DESKTOP_WIDTH + 'px';
  iframe.style.height = Math.ceil(paneH / scale) + 'px';
  iframe.style.transform = `scale(${scale})`;
  iframe.style.transformOrigin = 'top left';
}

function applyMobileHeight() {
  const iframe = document.getElementById('newsletter-iframe');
  if (!iframe) return;
  try {
    const h = iframe.contentDocument.documentElement.scrollHeight;
    if (h > 200) iframe.style.height = h + 'px';
  } catch (e) { /* cross-origin guard */ }
}

function setPreviewViewport(mode) {
  const pane = document.getElementById('preview-pane');
  const desktopBtn = document.getElementById('preview-desktop-btn');
  const mobileBtn = document.getElementById('preview-mobile-btn');
  const iframe = document.getElementById('newsletter-iframe');

  // Reset all inline iframe styles before switching
  iframe.style.position = '';
  iframe.style.top = '';
  iframe.style.left = '';
  iframe.style.width = '';
  iframe.style.height = '';
  iframe.style.transform = '';
  iframe.style.transformOrigin = '';

  if (mode === 'mobile') {
    pane.classList.add('preview-pane--mobile');
    desktopBtn.classList.remove('preview-viewport-btn--active');
    mobileBtn.classList.add('preview-viewport-btn--active');
    // Defer so the browser reflows the iframe at 375px before we measure scrollHeight
    requestAnimationFrame(applyMobileHeight);
  } else {
    pane.classList.remove('preview-pane--mobile');
    desktopBtn.classList.add('preview-viewport-btn--active');
    mobileBtn.classList.remove('preview-viewport-btn--active');
    requestAnimationFrame(applyDesktopScale);
  }
}

// Re-scale on window resize
window.addEventListener('resize', () => {
  const pane = document.getElementById('preview-pane');
  if (pane && !pane.classList.contains('preview-pane--mobile')) {
    applyDesktopScale();
  }
});

// Re-apply sizing after iframe content loads
document.addEventListener('DOMContentLoaded', () => {
  const iframe = document.getElementById('newsletter-iframe');
  if (!iframe) return;
  iframe.addEventListener('load', () => {
    const pane = document.getElementById('preview-pane');
    if (!pane) return;
    if (pane.classList.contains('preview-pane--mobile')) {
      applyMobileHeight();
    } else {
      applyDesktopScale();
    }
  });
});

async function generateNewsletter() {
  const btn = document.getElementById('vq-modal-confirm');
  btn.disabled = true;
  btn.textContent = 'Generating…';

  try {
    const r = await fetch('/api/newsletter/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');

    closeModal(document.getElementById('vq-modal'));
    document.getElementById('newsletter-iframe').src = data.url + '?t=' + Date.now();
    openPreviewPane();

    // Check campaign status
    checkCampaignStatus();
  } catch (err) {
    showToast(err.message || 'Generation failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate & Preview';
  }
}

async function checkCampaignStatus() {
  try {
    const r = await fetch('/api/newsletter/campaign-status');
    const data = await r.json();
    const btn = document.getElementById('campaign-btn');
    if (!btn) return;
    if (data.configured) {
      btn.style.display = 'inline-flex';
      btn.textContent = data.exists ? 'Update Campaign' : 'Create Campaign';
    }
  } catch {}
}

async function createCampaign() {
  const btn = document.getElementById('campaign-btn');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const r = await fetch('/api/newsletter/campaign', { method: 'POST' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    showToast('Campaign created/updated', 'success');
    btn.textContent = 'Update Campaign';
  } catch (err) {
    showToast(err.message || 'Campaign failed', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function openChangelog() {
  const modal = document.getElementById('changelog-modal');
  const output = document.getElementById('changelog-output');
  output.textContent = 'Loading…';
  openModal(modal);

  try {
    const r = await fetch('/api/changelog');
    const data = await r.json();
    const { groups } = data;
    const lines = [];
    const labels = { created: 'NEW', moved: 'MOVED', updated: 'EDITED', archived: 'ARCHIVED', restored: 'RESTORED', deleted: 'DELETED' };
    for (const [action, items] of Object.entries(groups)) {
      if (!items.length) continue;
      lines.push(`\n── ${labels[action] || action.toUpperCase()} (${items.length})`);
      for (const item of items) {
        let line = `  • ${item.title}`;
        if (action === 'moved' && item.detail) {
          line += ` [${item.detail.from || 'unsorted'} → ${item.detail.to || 'unsorted'}]`;
        }
        lines.push(line);
      }
    }
    output.textContent = lines.join('\n') || 'No changes this week.';
  } catch {
    output.textContent = 'Failed to load changelog.';
  }
}

/* ============================================================
   Edit Modal
   ============================================================ */
function wireModals() {
  // Edit modal close buttons
  document.getElementById('modal-close')?.addEventListener('click', () => closeModal(document.getElementById('detail-modal')));
  document.getElementById('modal-close-btn')?.addEventListener('click', () => closeModal(document.getElementById('detail-modal')));

  // Edit modal save
  document.getElementById('modal-save-btn')?.addEventListener('click', saveEntry);

  // Edit modal archive button
  document.getElementById('modal-delete-btn')?.addEventListener('click', () => {
    closeModal(document.getElementById('detail-modal'));
    confirmArchive(currentEditId);
  });

  // Delete modal
  document.getElementById('delete-modal-close')?.addEventListener('click', () => closeModal(document.getElementById('delete-modal')));
  document.getElementById('delete-cancel-btn')?.addEventListener('click', () => closeModal(document.getElementById('delete-modal')));
  document.getElementById('delete-confirm-btn')?.addEventListener('click', executeDelete);

  // Changelog modal
  document.getElementById('changelog-modal-close')?.addEventListener('click', () => closeModal(document.getElementById('changelog-modal')));
  document.getElementById('changelog-close-btn')?.addEventListener('click', () => closeModal(document.getElementById('changelog-modal')));
  document.getElementById('changelog-copy-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('changelog-output').textContent).then(() => showToast('Copied', 'success'));
  });

  // Hero image upload
  const heroUpload = document.getElementById('modal-hero-upload');
  const heroInput = document.getElementById('modal-hero-input');
  const heroPlaceholder = document.getElementById('modal-hero-placeholder');
  const heroPreview = document.getElementById('modal-hero-preview');
  const heroImg = document.getElementById('modal-hero-img');
  const heroRemove = document.getElementById('modal-hero-remove');
  const heroValue = document.getElementById('modal-hero-value');

  heroUpload?.addEventListener('click', () => heroInput?.click());
  heroInput?.addEventListener('change', async () => {
    const file = heroInput.files[0];
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('image', file);
      const r = await fetch('/api/upload/image', { method: 'POST', body: fd });
      if (!r.ok) throw new Error();
      const data = await r.json();
      heroImg.src = data.url;
      heroValue.value = data.url;
      heroPlaceholder.style.display = 'none';
      heroPreview.style.display = 'block';
    } catch {
      showToast('Image upload failed', 'error');
    }
  });
  heroRemove?.addEventListener('click', (e) => {
    e.stopPropagation();
    heroImg.src = '';
    heroValue.value = '';
    heroPlaceholder.style.display = 'flex';
    heroPreview.style.display = 'none';
  });

  // Click-outside to close modals
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay);
    });
  });

  // Init rich editor
  if (typeof initRichEditor === 'function') {
    initRichEditor('modal-rich-editor', 'modal-editor-content', 'modal-description');
  }
}

async function openEditModal(id) {
  currentEditId = id;
  const entry = allEntries.find(e => e.id === id);
  if (!entry) {
    // Fetch from server if not in local state (e.g., from archive)
    try {
      const r = await fetch(`/api/submissions/${id}`);
      if (!r.ok) return;
      const data = await r.json();
      populateEditModal(data);
    } catch { return; }
  } else {
    populateEditModal(entry);
  }
  openModal(document.getElementById('detail-modal'));
}

function populateEditModal(entry) {
  document.getElementById('edit-title').value = entry.title || '';
  document.getElementById('edit-leader').value = entry.leader || '';
  document.getElementById('edit-start-date').value = entry.start_date ? entry.start_date.slice(0, 16) : '';
  document.getElementById('edit-end-time').value = entry.end_time ? entry.end_time.slice(0, 16) : '';
  document.getElementById('edit-location').value = entry.location || '';
  document.getElementById('edit-link').value = entry.link || '';
  document.getElementById('edit-video-url').value = entry.video_url || '';

  // Rich editor
  const editorContent = document.getElementById('modal-editor-content');
  if (editorContent) editorContent.innerHTML = entry.description || '';
  const hiddenDesc = document.getElementById('modal-description');
  if (hiddenDesc) hiddenDesc.value = entry.description || '';

  // Section dropdown
  const dropdown = document.getElementById('modal-section-dropdown');
  if (dropdown) {
    // Rebuild options dynamically from boardSections
    dropdown.innerHTML = '<option value="">(none)</option>' +
      boardSections.map(s => `<option value="${s.id}"${entry.section === s.id ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('');
    dropdown.value = entry.section || '';
  }

  // Hero image
  const heroImg = document.getElementById('modal-hero-img');
  const heroValue = document.getElementById('modal-hero-value');
  const heroPlaceholder = document.getElementById('modal-hero-placeholder');
  const heroPreview = document.getElementById('modal-hero-preview');
  if (entry.hero_image) {
    heroImg.src = entry.hero_image;
    heroValue.value = entry.hero_image;
    heroPlaceholder.style.display = 'none';
    heroPreview.style.display = 'block';
  } else {
    heroImg.src = '';
    heroValue.value = '';
    heroPlaceholder.style.display = 'flex';
    heroPreview.style.display = 'none';
  }

  // Submitter info
  const submitterEl = document.getElementById('edit-submitter-info');
  if (submitterEl) {
    const parts = [entry.submitter_name, entry.submitter_email, entry.submitter_phone].filter(Boolean);
    submitterEl.textContent = parts.length ? `Submitted by: ${parts.join(' · ')}` : '';
  }
}

async function saveEntry() {
  if (!currentEditId) return;
  const btn = document.getElementById('modal-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  // Sync rich editor
  const editorContent = document.getElementById('modal-editor-content');
  const hiddenDesc = document.getElementById('modal-description');
  if (editorContent && hiddenDesc) hiddenDesc.value = editorContent.innerHTML.trim();

  const body = {
    title: document.getElementById('edit-title').value,
    leader: document.getElementById('edit-leader').value || null,
    start_date: document.getElementById('edit-start-date').value,
    end_time: document.getElementById('edit-end-time').value || null,
    location: document.getElementById('edit-location').value || null,
    description: hiddenDesc?.value || '',
    link: document.getElementById('edit-link').value || null,
    video_url: document.getElementById('edit-video-url').value || null,
    hero_image: document.getElementById('modal-hero-value').value || null,
    section: document.getElementById('modal-section-dropdown').value || null,
  };

  try {
    const r = await fetch(`/api/submissions/${currentEditId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error();
    const updated = await r.json();

    // Update local state
    const idx = allEntries.findIndex(e => e.id === currentEditId);
    if (idx !== -1) allEntries[idx] = updated;
    else allEntries.push(updated);

    closeModal(document.getElementById('detail-modal'));
    renderBoard();
    showToast('Saved', 'success');
  } catch {
    showToast('Save failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}

function confirmArchive(id) {
  pendingDeleteId = id;
  pendingDeleteMode = 'archive';

  const entry = allEntries.find(e => e.id === id);
  const modal = document.getElementById('delete-modal');
  document.getElementById('delete-modal-title').textContent = 'Confirm Archive';
  document.getElementById('delete-modal-body').textContent = 'This entry will be moved to the archive. You can restore it at any time.';
  document.getElementById('delete-entry-title').textContent = entry?.title || '';
  document.getElementById('delete-confirm-btn').textContent = 'Archive';
  openModal(modal);
}

async function executeDelete() {
  if (!pendingDeleteId) return;
  const btn = document.getElementById('delete-confirm-btn');
  btn.disabled = true;

  try {
    let r;
    if (pendingDeleteMode === 'permanent') {
      r = await fetch(`/api/submissions/${pendingDeleteId}/permanent`, { method: 'DELETE' });
    } else {
      r = await fetch(`/api/submissions/${pendingDeleteId}`, { method: 'DELETE' });
    }
    if (!r.ok) throw new Error();

    closeModal(document.getElementById('delete-modal'));

    if (pendingDeleteMode === 'archive') {
      // Remove from allEntries and re-render
      allEntries = allEntries.filter(e => e.id !== pendingDeleteId);
      renderBoard();
      showToast('Entry archived', 'success');
    } else {
      showToast('Entry deleted', 'success');
      // Refresh archive view if open
      const input = document.getElementById('archive-search');
      loadArchive(input?.value?.trim() || '');
    }
  } catch {
    showToast('Action failed', 'error');
  } finally {
    btn.disabled = false;
    pendingDeleteId = null;
    pendingDeleteMode = null;
  }
}

/* ============================================================
   Sections Manager
   ============================================================ */
function wireSectionsManager() {
  document.getElementById('manage-sections-btn')?.addEventListener('click', openSectionsManager);
  document.getElementById('sections-modal-close')?.addEventListener('click', () => closeModal(document.getElementById('sections-modal')));
  document.getElementById('sections-modal-close-btn')?.addEventListener('click', () => closeModal(document.getElementById('sections-modal')));
  document.getElementById('add-section-btn')?.addEventListener('click', addSection);
}

function openSectionsManager() {
  renderSectionsList();
  openModal(document.getElementById('sections-modal'));
}

function renderSectionsList() {
  const list = document.getElementById('sections-manager-list');
  if (!list) return;

  const deskSec = boardSections.find(s => s.id === 'desk');
  const otherSecs = boardSections.filter(s => s.id !== 'desk');

  const lockedHtml = deskSec ? `
    <div class="section-manager-item section-manager-item--locked" data-section-id="desk">
      <span class="section-manager-item__handle" style="opacity:0.2">⠿</span>
      <span class="section-manager-item__swatch" style="background: ${deskSec.accent};"></span>
      <span class="section-manager-item__label">${escapeHtml(deskSec.label)}</span>
      <span class="section-manager-item__id">${escapeHtml(deskSec.id)}</span>
      <span class="protected-lock" title="Locked section">&#128274;</span>
    </div>` : '';

  list.innerHTML = lockedHtml + otherSecs.map(sec => `
    <div class="section-manager-item" data-section-id="${sec.id}" draggable="true">
      <span class="section-manager-item__handle">⠿</span>
      <span class="section-manager-item__swatch" style="background: ${sec.accent};"></span>
      <span class="section-manager-item__label">${escapeHtml(sec.label)}</span>
      <span class="section-manager-item__id">${escapeHtml(sec.id)}</span>
      <div class="section-manager-item__actions">
        <button class="kanban-card__btn sec-edit-btn" data-sec-id="${sec.id}">Edit</button>
        <button class="kanban-card__btn kanban-card__btn--danger sec-delete-btn" data-sec-id="${sec.id}">Delete</button>
      </div>
    </div>
  `).join('');

  // Wire edit/delete
  list.querySelectorAll('.sec-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => editSectionInline(btn.dataset.secId));
  });
  list.querySelectorAll('.sec-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteSection(btn.dataset.secId));
  });

  // Drag to reorder
  setupSectionsListDragDrop(list);
}

function setupSectionsListDragDrop(list) {
  let draggingItem = null;

  list.addEventListener('dragstart', (e) => {
    draggingItem = e.target.closest('.section-manager-item');
    if (draggingItem) draggingItem.classList.add('is-dragging');
  });

  list.addEventListener('dragend', () => {
    draggingItem?.classList.remove('is-dragging');
    list.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
      el.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    draggingItem = null;
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target.closest('.section-manager-item');
    if (!target || target === draggingItem) return;

    list.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
      el.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      target.classList.add('drag-over-top');
    } else {
      target.classList.add('drag-over-bottom');
    }
  });

  list.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!draggingItem) return;

    const target = e.target.closest('.section-manager-item');
    if (!target || target === draggingItem) return;

    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      list.insertBefore(draggingItem, target);
    } else {
      list.insertBefore(draggingItem, target.nextElementSibling);
    }

    // Save new order
    const items = [...list.querySelectorAll('.section-manager-item')];
    const newOrder = items.map(el => el.dataset.sectionId);

    try {
      await Promise.all(newOrder.map((id, idx) =>
        fetch(`/api/sections/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position: idx }),
        })
      ));

      // Update local boardSections order
      boardSections.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
      boardSections.forEach((s, i) => { s.position = i; });
      renderBoard();
      showToast('Section order saved', 'success');
    } catch {
      showToast('Failed to save order', 'error');
    }
  });
}

function editSectionInline(secId) {
  const sec = boardSections.find(s => s.id === secId);
  if (!sec) return;

  const item = document.querySelector(`.section-manager-item[data-section-id="${secId}"]`);
  if (!item) return;

  const origHTML = item.innerHTML;

  item.innerHTML = `
    <span class="section-manager-item__handle" style="opacity:0.3">⠿</span>
    <input type="color" class="color-picker-input" value="${sec.accent}" id="sec-color-${secId}">
    <input type="text" id="sec-label-${secId}" value="${escapeHtml(sec.label)}"
      style="flex:1;font-family:var(--mono);font-size:0.78rem;padding:0.3rem 0.5rem;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);">
    <div class="section-manager-item__actions">
      <button class="kanban-card__btn" id="sec-save-${secId}">Save</button>
      <button class="kanban-card__btn" id="sec-cancel-${secId}">Cancel</button>
    </div>
  `;

  document.getElementById(`sec-cancel-${secId}`)?.addEventListener('click', () => {
    item.innerHTML = origHTML;
    wireSectionItemButtons(item);
  });

  document.getElementById(`sec-save-${secId}`)?.addEventListener('click', async () => {
    const label = document.getElementById(`sec-label-${secId}`)?.value.trim();
    const accent = document.getElementById(`sec-color-${secId}`)?.value;
    if (!label) return;

    try {
      const r = await fetch(`/api/sections/${secId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, accent }),
      });
      if (!r.ok) throw new Error();
      const updated = await r.json();

      // Update local state
      const idx = boardSections.findIndex(s => s.id === secId);
      if (idx !== -1) boardSections[idx] = updated;

      renderSectionsList();
      renderBoard();
      showToast('Section updated', 'success');
    } catch {
      showToast('Failed to update section', 'error');
    }
  });
}

function wireSectionItemButtons(item) {
  const secId = item.dataset.sectionId;
  item.querySelector('.sec-edit-btn')?.addEventListener('click', () => editSectionInline(secId));
  item.querySelector('.sec-delete-btn')?.addEventListener('click', () => deleteSection(secId));
}

async function deleteSection(secId) {
  const sec = boardSections.find(s => s.id === secId);
  const hasEntries = allEntries.some(e => e.section === secId);
  const msg = hasEntries
    ? `Delete "${sec?.label}"? All ${allEntries.filter(e => e.section === secId).length} entries in this section will move to Unsorted.`
    : `Delete section "${sec?.label}"?`;

  if (!confirm(msg)) return;

  try {
    const r = await fetch(`/api/sections/${secId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error();

    // Update local state
    boardSections = boardSections.filter(s => s.id !== secId);
    allEntries.forEach(e => { if (e.section === secId) e.section = null; });

    renderSectionsList();
    renderBoard();
    showToast('Section deleted', 'success');
  } catch {
    showToast('Failed to delete section', 'error');
  }
}

async function addSection() {
  const nameInput = document.getElementById('new-section-name');
  const colorInput = document.getElementById('new-section-color');
  if (!nameInput || !colorInput) return;

  const label = nameInput.value.trim();
  const accent = colorInput.value || '#888888';
  if (!label) {
    nameInput.focus();
    return;
  }

  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);

  try {
    const r = await fetch('/api/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, label, accent }),
    });
    if (!r.ok) {
      const data = await r.json();
      throw new Error(data.error || 'Failed');
    }
    const created = await r.json();
    boardSections.push(created);

    nameInput.value = '';
    colorInput.value = '#888888';

    renderSectionsList();
    renderBoard();
    showToast(`Section "${label}" created`, 'success');
  } catch (err) {
    showToast(err.message || 'Failed to create section', 'error');
  }
}

/* ============================================================
   Modal helpers
   ============================================================ */
function openModal(overlay) {
  overlay?.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(overlay) {
  overlay?.classList.remove('active');
  document.body.style.overflow = '';
}

/* ============================================================
   Toast notifications
   ============================================================ */
function showToast(msg, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `board-toast board-toast--${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 350);
  }, 2200);
}

/* ============================================================
   Protected Lanes
   ============================================================ */
function buildProtectedLane(sectionId, label, accentColor) {
  const lane = document.createElement('div');
  lane.className = 'kanban-lane kanban-lane--protected';
  lane.dataset.section = sectionId;

  let previewHtml = '';
  let itemCount = 0;

  if (sectionId === 'three-fs') {
    const items = staticSections.threeFsItems;
    itemCount = items.length;
    const cols = ['fitness', 'fellowship', 'faith'];
    previewHtml = `<div class="protected-preview-cols">` + cols.map(col => {
      const colItems = items.filter(i => i.f_column === col);
      return `<div class="protected-preview-col">
        <div class="protected-preview-col__head">${col}</div>
        ${colItems.map(i => `<div class="protected-preview-col__item">${escapeHtml(i.item_type === 'link' ? (i.link_label || 'Link') : (i.name || ''))}</div>`).join('')}
      </div>`;
    }).join('') + `</div>`;
  } else if (sectionId === 'slt') {
    const entries = staticSections.sltEntries;
    itemCount = entries.length;
    previewHtml = entries.slice(0, 6).map(e =>
      `<div class="protected-preview-row"><span class="protected-preview-row__role">${escapeHtml(e.role)}</span><span class="protected-preview-row__name">${escapeHtml(e.name)}</span></div>`
    ).join('');
    if (entries.length > 6) previewHtml += `<div class="protected-preview-more">+${entries.length - 6} more</div>`;
  } else if (sectionId === 'helpful-links') {
    const links = staticSections.helpfulLinks;
    itemCount = links.length;
    previewHtml = links.slice(0, 5).map(l =>
      `<div class="protected-preview-row"><span class="protected-preview-row__role">${escapeHtml(l.label)}</span><span class="protected-preview-row__name">${escapeHtml(l.name)}</span></div>`
    ).join('');
    if (links.length > 5) previewHtml += `<div class="protected-preview-more">+${links.length - 5} more</div>`;
  } else if (sectionId === 'shovel-flags') {
    const flags = staticSections.shovelFlags;
    itemCount = flags.length;
    previewHtml = flags.slice(0, 4).map(f =>
      `<div class="protected-preview-row"><span class="protected-preview-row__role">${escapeHtml(f.from_name)}</span><span class="protected-preview-row__name">→ ${escapeHtml(f.to_name)}</span><span class="protected-preview-row__detail">${escapeHtml(f.ao)}</span></div>`
    ).join('');
    if (flags.length > 4) previewHtml += `<div class="protected-preview-more">+${flags.length - 4} more</div>`;
  } else if (sectionId === 'vqs') {
    const vqList = staticSections.vqs;
    itemCount = vqList.length;
    previewHtml = vqList.slice(0, 5).map(v =>
      `<div class="protected-preview-row"><span class="protected-preview-row__role">${escapeHtml(v.name)}</span><span class="protected-preview-row__name">${escapeHtml(v.ao)}</span></div>`
    ).join('');
    if (vqList.length > 5) previewHtml += `<div class="protected-preview-more">+${vqList.length - 5} more</div>`;
  }

  lane.innerHTML = `
    <div class="kanban-lane__header" style="--lane-accent: ${accentColor};">
      <span class="kanban-lane__label">${escapeHtml(label)}</span>
      <span class="protected-lock" title="Protected section">&#128274;</span>
      <span class="kanban-lane__count">${itemCount}</span>
    </div>
    <div class="kanban-lane__body kanban-lane__body--protected">
      ${previewHtml || '<div class="kanban-lane__empty">No items</div>'}
    </div>
    <div class="protected-lane-footer">
      <button class="btn btn--secondary btn--sm protected-edit-btn" data-section="${sectionId}">Edit Content</button>
    </div>
  `;

  lane.querySelector('.protected-edit-btn').addEventListener('click', () => openStaticEditor(sectionId));
  return lane;
}

function refreshProtectedLane(sectionId) {
  const existing = document.querySelector(`.kanban-lane--protected[data-section="${sectionId}"]`);
  if (!existing) return;
  let label, color;
  if (sectionId === 'three-fs') { label = "The Three F's"; color = '#5B7DB1'; }
  else if (sectionId === 'slt') { label = 'Shared Leadership Team'; color = '#3A7D5C'; }
  else if (sectionId === 'shovel-flags') { label = 'Shovel Flag Hand-off'; color = '#8B3A2A'; }
  else if (sectionId === 'vqs') { label = 'VQs This Week'; color = '#2A5F8B'; }
  else { label = 'Helpful Links'; color = '#8a6a2a'; }
  existing.replaceWith(buildProtectedLane(sectionId, label, color));
}

function openStaticEditor(sectionId) {
  if (sectionId === 'three-fs') openThreeFsModal();
  else if (sectionId === 'slt') openSltModal();
  else if (sectionId === 'helpful-links') openLinksModal();
  else if (sectionId === 'shovel-flags') openShovelFlagsModal();
  else if (sectionId === 'vqs') openVqsModal();
}

/* ============================================================
   Three F's Editor
   ============================================================ */
function openThreeFsModal() {
  activeThreeFsTab = 'fitness';
  renderThreeFsList();
  openModal(document.getElementById('three-fs-modal'));
}

function renderThreeFsList() {
  const items = staticSections.threeFsItems.filter(i => i.f_column === activeThreeFsTab);
  const list = document.getElementById('three-fs-list');
  if (!list) return;

  // Update tab active state
  document.querySelectorAll('#three-fs-tabs .static-editor-tab').forEach(t => {
    t.classList.toggle('static-editor-tab--active', t.dataset.col === activeThreeFsTab);
  });

  if (items.length === 0) {
    list.innerHTML = '<div class="static-editor-empty">No items yet</div>';
    return;
  }

  list.innerHTML = items.map((item, idx) => {
    const contentText = item.item_type === 'link'
      ? `<span class="se-type se-type--link">Link</span> <span class="se-val">${escapeHtml(item.link_label || '')}</span> <span class="se-detail">${escapeHtml(item.link_url || '')}</span>`
      : `<span class="se-type">Event</span> <span class="se-val">${escapeHtml(item.name || '')}</span> ${item.detail ? `<span class="se-detail">${escapeHtml(item.detail)}</span>` : ''}`;
    return `<div class="se-row" data-id="${item.id}">
      <div class="se-row__order">
        <button class="se-order-btn" data-action="up" data-id="${item.id}" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="se-order-btn" data-action="down" data-id="${item.id}" ${idx === items.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
      <div class="se-row__content">${contentText}</div>
      <div class="se-row__actions">
        <button class="kanban-card__btn se-edit-btn" data-id="${item.id}">Edit</button>
        <button class="kanban-card__btn kanban-card__btn--danger se-del-btn" data-id="${item.id}">Del</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.se-order-btn').forEach(btn =>
    btn.addEventListener('click', () => moveThreeFsItem(parseInt(btn.dataset.id), btn.dataset.action))
  );
  list.querySelectorAll('.se-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => editThreeFsItemInline(parseInt(btn.dataset.id)))
  );
  list.querySelectorAll('.se-del-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteThreeFsItem(parseInt(btn.dataset.id)))
  );
}

function editThreeFsItemInline(id) {
  const item = staticSections.threeFsItems.find(i => i.id === id);
  if (!item) return;
  const rowEl = document.querySelector(`#three-fs-list .se-row[data-id="${id}"]`);
  if (!rowEl) return;

  const isLink = item.item_type === 'link';
  rowEl.innerHTML = `
    <div class="se-inline-form">
      <select class="se-type-select" id="sef-type-${id}">
        <option value="event" ${!isLink ? 'selected' : ''}>Event</option>
        <option value="link" ${isLink ? 'selected' : ''}>Link</option>
      </select>
      <div class="se-event-fields" ${isLink ? 'style="display:none"' : ''}>
        <input type="text" id="sef-name-${id}" value="${escapeHtml(item.name || '')}" placeholder="Event name">
        <input type="text" id="sef-detail-${id}" value="${escapeHtml(item.detail || '')}" placeholder="Detail">
      </div>
      <div class="se-link-fields" ${!isLink ? 'style="display:none"' : ''}>
        <input type="text" id="sef-llabel-${id}" value="${escapeHtml(item.link_label || '')}" placeholder="Link label">
        <input type="url" id="sef-lurl-${id}" value="${escapeHtml(item.link_url || '')}" placeholder="URL">
      </div>
      <div class="se-inline-form__btns">
        <button class="kanban-card__btn" id="sef-save-${id}">Save</button>
        <button class="kanban-card__btn" id="sef-cancel-${id}">Cancel</button>
      </div>
    </div>`;

  document.getElementById(`sef-type-${id}`).addEventListener('change', e => {
    const toLink = e.target.value === 'link';
    rowEl.querySelector('.se-event-fields').style.display = toLink ? 'none' : 'flex';
    rowEl.querySelector('.se-link-fields').style.display = toLink ? 'flex' : 'none';
  });

  document.getElementById(`sef-cancel-${id}`).addEventListener('click', () => renderThreeFsList());

  document.getElementById(`sef-save-${id}`).addEventListener('click', async () => {
    const item_type = document.getElementById(`sef-type-${id}`).value;
    const body = { item_type,
      name: document.getElementById(`sef-name-${id}`)?.value || null,
      detail: document.getElementById(`sef-detail-${id}`)?.value || null,
      link_label: document.getElementById(`sef-llabel-${id}`)?.value || null,
      link_url: document.getElementById(`sef-lurl-${id}`)?.value || null,
    };
    try {
      const r = await fetch(`/api/static/three-fs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      const updated = await r.json();
      const idx = staticSections.threeFsItems.findIndex(i => i.id === id);
      if (idx !== -1) staticSections.threeFsItems[idx] = updated;
      renderThreeFsList();
      refreshProtectedLane('three-fs');
      showToast('Saved', 'success');
    } catch { showToast('Save failed', 'error'); }
  });
}

async function deleteThreeFsItem(id) {
  if (!confirm('Delete this item?')) return;
  try {
    const r = await fetch(`/api/static/three-fs/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error();
    staticSections.threeFsItems = staticSections.threeFsItems.filter(i => i.id !== id);
    renderThreeFsList();
    refreshProtectedLane('three-fs');
    showToast('Deleted', 'success');
  } catch { showToast('Delete failed', 'error'); }
}

async function moveThreeFsItem(id, direction) {
  const col = activeThreeFsTab;
  const items = staticSections.threeFsItems.filter(i => i.f_column === col);
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= items.length) return;
  [items[idx], items[swapIdx]] = [items[swapIdx], items[idx]];
  const order = items.map(i => i.id);
  try {
    const r = await fetch('/api/static/three-fs/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ f_column: col, order }) });
    if (!r.ok) throw new Error();
    order.forEach((itemId, pos) => {
      const it = staticSections.threeFsItems.find(i => i.id === itemId);
      if (it) it.position = pos;
    });
    staticSections.threeFsItems.sort((a, b) => {
      if (a.f_column !== b.f_column) return a.f_column.localeCompare(b.f_column);
      return a.position - b.position;
    });
    renderThreeFsList();
  } catch { showToast('Reorder failed', 'error'); }
}

async function addThreeFsItem() {
  const item_type = document.getElementById('three-fs-add-type').value;
  const body = { f_column: activeThreeFsTab, item_type };
  if (item_type === 'event') {
    body.name = document.getElementById('three-fs-add-name').value.trim();
    body.detail = document.getElementById('three-fs-add-detail').value.trim();
    if (!body.name) { document.getElementById('three-fs-add-name').focus(); return; }
  } else {
    body.link_label = document.getElementById('three-fs-add-link-label').value.trim();
    body.link_url = document.getElementById('three-fs-add-link-url').value.trim();
    if (!body.link_url) { document.getElementById('three-fs-add-link-url').focus(); return; }
  }
  try {
    const r = await fetch('/api/static/three-fs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error();
    const created = await r.json();
    staticSections.threeFsItems.push(created);
    // clear form
    document.getElementById('three-fs-add-name').value = '';
    document.getElementById('three-fs-add-detail').value = '';
    document.getElementById('three-fs-add-link-label').value = '';
    document.getElementById('three-fs-add-link-url').value = '';
    renderThreeFsList();
    refreshProtectedLane('three-fs');
    showToast('Added', 'success');
  } catch { showToast('Add failed', 'error'); }
}

/* ============================================================
   SLT Editor
   ============================================================ */
function openSltModal() {
  renderSltList();
  openModal(document.getElementById('slt-modal'));
}

function renderSltList() {
  const entries = staticSections.sltEntries;
  const list = document.getElementById('slt-list');
  if (!list) return;

  if (entries.length === 0) {
    list.innerHTML = '<div class="static-editor-empty">No entries yet</div>';
    return;
  }

  list.innerHTML = entries.map((entry, idx) => `
    <div class="se-row" data-id="${entry.id}">
      <div class="se-row__order">
        <button class="se-order-btn" data-action="up" data-id="${entry.id}" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="se-order-btn" data-action="down" data-id="${entry.id}" ${idx === entries.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
      <div class="se-row__content">
        <span class="se-val">${escapeHtml(entry.role)}</span>
        <span class="se-sep">—</span>
        <span class="se-detail">${escapeHtml(entry.name)}</span>
      </div>
      <div class="se-row__actions">
        <button class="kanban-card__btn se-edit-btn" data-id="${entry.id}">Edit</button>
        <button class="kanban-card__btn kanban-card__btn--danger se-del-btn" data-id="${entry.id}">Del</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.se-order-btn').forEach(btn =>
    btn.addEventListener('click', () => moveSltEntry(parseInt(btn.dataset.id), btn.dataset.action))
  );
  list.querySelectorAll('.se-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => editSltEntryInline(parseInt(btn.dataset.id)))
  );
  list.querySelectorAll('.se-del-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteSltEntry(parseInt(btn.dataset.id)))
  );
}

function editSltEntryInline(id) {
  const entry = staticSections.sltEntries.find(e => e.id === id);
  if (!entry) return;
  const rowEl = document.querySelector(`#slt-list .se-row[data-id="${id}"]`);
  if (!rowEl) return;

  rowEl.innerHTML = `
    <div class="se-inline-form">
      <input type="text" id="sef-slt-role-${id}" value="${escapeHtml(entry.role)}" placeholder="Role">
      <input type="text" id="sef-slt-name-${id}" value="${escapeHtml(entry.name)}" placeholder="Name">
      <div class="se-inline-form__btns">
        <button class="kanban-card__btn" id="sef-slt-save-${id}">Save</button>
        <button class="kanban-card__btn" id="sef-slt-cancel-${id}">Cancel</button>
      </div>
    </div>`;

  document.getElementById(`sef-slt-cancel-${id}`).addEventListener('click', () => renderSltList());
  document.getElementById(`sef-slt-save-${id}`).addEventListener('click', async () => {
    const role = document.getElementById(`sef-slt-role-${id}`).value.trim();
    const name = document.getElementById(`sef-slt-name-${id}`).value.trim();
    if (!role || !name) return;
    try {
      const r = await fetch(`/api/static/slt/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, name }) });
      if (!r.ok) throw new Error();
      const updated = await r.json();
      const idx = staticSections.sltEntries.findIndex(e => e.id === id);
      if (idx !== -1) staticSections.sltEntries[idx] = updated;
      renderSltList();
      refreshProtectedLane('slt');
      showToast('Saved', 'success');
    } catch { showToast('Save failed', 'error'); }
  });
}

async function deleteSltEntry(id) {
  if (!confirm('Delete this entry?')) return;
  try {
    const r = await fetch(`/api/static/slt/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error();
    staticSections.sltEntries = staticSections.sltEntries.filter(e => e.id !== id);
    renderSltList();
    refreshProtectedLane('slt');
    showToast('Deleted', 'success');
  } catch { showToast('Delete failed', 'error'); }
}

async function moveSltEntry(id, direction) {
  const entries = staticSections.sltEntries;
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= entries.length) return;
  [entries[idx], entries[swapIdx]] = [entries[swapIdx], entries[idx]];
  const order = entries.map(e => e.id);
  try {
    const r = await fetch('/api/static/slt/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) });
    if (!r.ok) throw new Error();
    order.forEach((eid, pos) => { const e = staticSections.sltEntries.find(x => x.id === eid); if (e) e.position = pos; });
    renderSltList();
  } catch { showToast('Reorder failed', 'error'); }
}

async function addSltEntry() {
  const role = document.getElementById('slt-add-role').value.trim();
  const name = document.getElementById('slt-add-name').value.trim();
  if (!role) { document.getElementById('slt-add-role').focus(); return; }
  if (!name) { document.getElementById('slt-add-name').focus(); return; }
  try {
    const r = await fetch('/api/static/slt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, name }) });
    if (!r.ok) throw new Error();
    const created = await r.json();
    staticSections.sltEntries.push(created);
    document.getElementById('slt-add-role').value = '';
    document.getElementById('slt-add-name').value = '';
    renderSltList();
    refreshProtectedLane('slt');
    showToast('Added', 'success');
  } catch { showToast('Add failed', 'error'); }
}

/* ============================================================
   Helpful Links Editor
   ============================================================ */
function openLinksModal() {
  renderLinksList();
  openModal(document.getElementById('links-modal'));
}

function renderLinksList() {
  const links = staticSections.helpfulLinks;
  const list = document.getElementById('links-list');
  if (!list) return;

  if (links.length === 0) {
    list.innerHTML = '<div class="static-editor-empty">No links yet</div>';
    return;
  }

  list.innerHTML = links.map((link, idx) => `
    <div class="se-row" data-id="${link.id}">
      <div class="se-row__order">
        <button class="se-order-btn" data-action="up" data-id="${link.id}" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="se-order-btn" data-action="down" data-id="${link.id}" ${idx === links.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
      <div class="se-row__content">
        <span class="se-val">${escapeHtml(link.label)}</span>
        <span class="se-sep">→</span>
        <span class="se-detail">${escapeHtml(link.name)}</span>
        <span class="se-url">${escapeHtml(link.url)}</span>
      </div>
      <div class="se-row__actions">
        <button class="kanban-card__btn se-edit-btn" data-id="${link.id}">Edit</button>
        <button class="kanban-card__btn kanban-card__btn--danger se-del-btn" data-id="${link.id}">Del</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.se-order-btn').forEach(btn =>
    btn.addEventListener('click', () => moveHelpfulLink(parseInt(btn.dataset.id), btn.dataset.action))
  );
  list.querySelectorAll('.se-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => editLinkInline(parseInt(btn.dataset.id)))
  );
  list.querySelectorAll('.se-del-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteHelpfulLink(parseInt(btn.dataset.id)))
  );
}

function editLinkInline(id) {
  const link = staticSections.helpfulLinks.find(l => l.id === id);
  if (!link) return;
  const rowEl = document.querySelector(`#links-list .se-row[data-id="${id}"]`);
  if (!rowEl) return;

  rowEl.innerHTML = `
    <div class="se-inline-form">
      <input type="text" id="sef-lnk-label-${id}" value="${escapeHtml(link.label)}" placeholder="Label">
      <input type="text" id="sef-lnk-name-${id}" value="${escapeHtml(link.name)}" placeholder="Name">
      <input type="url" id="sef-lnk-url-${id}" value="${escapeHtml(link.url)}" placeholder="URL">
      <div class="se-inline-form__btns">
        <button class="kanban-card__btn" id="sef-lnk-save-${id}">Save</button>
        <button class="kanban-card__btn" id="sef-lnk-cancel-${id}">Cancel</button>
      </div>
    </div>`;

  document.getElementById(`sef-lnk-cancel-${id}`).addEventListener('click', () => renderLinksList());
  document.getElementById(`sef-lnk-save-${id}`).addEventListener('click', async () => {
    const label = document.getElementById(`sef-lnk-label-${id}`).value.trim();
    const name = document.getElementById(`sef-lnk-name-${id}`).value.trim();
    const url = document.getElementById(`sef-lnk-url-${id}`).value.trim();
    if (!label || !name || !url) return;
    try {
      const r = await fetch(`/api/static/links/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, name, url }) });
      if (!r.ok) throw new Error();
      const updated = await r.json();
      const idx = staticSections.helpfulLinks.findIndex(l => l.id === id);
      if (idx !== -1) staticSections.helpfulLinks[idx] = updated;
      renderLinksList();
      refreshProtectedLane('helpful-links');
      showToast('Saved', 'success');
    } catch { showToast('Save failed', 'error'); }
  });
}

async function deleteHelpfulLink(id) {
  if (!confirm('Delete this link?')) return;
  try {
    const r = await fetch(`/api/static/links/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error();
    staticSections.helpfulLinks = staticSections.helpfulLinks.filter(l => l.id !== id);
    renderLinksList();
    refreshProtectedLane('helpful-links');
    showToast('Deleted', 'success');
  } catch { showToast('Delete failed', 'error'); }
}

async function moveHelpfulLink(id, direction) {
  const links = staticSections.helpfulLinks;
  const idx = links.findIndex(l => l.id === id);
  if (idx === -1) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= links.length) return;
  [links[idx], links[swapIdx]] = [links[swapIdx], links[idx]];
  const order = links.map(l => l.id);
  try {
    const r = await fetch('/api/static/links/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) });
    if (!r.ok) throw new Error();
    order.forEach((lid, pos) => { const l = staticSections.helpfulLinks.find(x => x.id === lid); if (l) l.position = pos; });
    renderLinksList();
  } catch { showToast('Reorder failed', 'error'); }
}

async function addHelpfulLink() {
  const label = document.getElementById('links-add-label').value.trim();
  const name = document.getElementById('links-add-name').value.trim();
  const url = document.getElementById('links-add-url').value.trim();
  if (!label) { document.getElementById('links-add-label').focus(); return; }
  if (!name) { document.getElementById('links-add-name').focus(); return; }
  if (!url) { document.getElementById('links-add-url').focus(); return; }
  try {
    const r = await fetch('/api/static/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, name, url }) });
    if (!r.ok) throw new Error();
    const created = await r.json();
    staticSections.helpfulLinks.push(created);
    document.getElementById('links-add-label').value = '';
    document.getElementById('links-add-name').value = '';
    document.getElementById('links-add-url').value = '';
    renderLinksList();
    refreshProtectedLane('helpful-links');
    showToast('Added', 'success');
  } catch { showToast('Add failed', 'error'); }
}

/* ============================================================
   VQ Editor
   ============================================================ */
function openVqsModal() {
  renderVqsList();
  openModal(document.getElementById('vqs-modal'));
}

function renderVqsList() {
  const list = document.getElementById('vqs-list');
  if (!list) return;
  const vqList = staticSections.vqs;
  if (vqList.length === 0) { list.innerHTML = '<div class="static-editor-empty">No VQs recorded.</div>'; return; }
  list.innerHTML = vqList.map((v, idx) => `
    <div class="se-row" data-id="${v.id}">
      <div class="se-row__order">
        <button class="se-order-btn" data-action="up" data-id="${v.id}" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="se-order-btn" data-action="down" data-id="${v.id}" ${idx === vqList.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
      <div class="se-row__content">
        <span class="se-val">${escapeHtml(v.name)}</span>
        <span class="se-sep">@</span>
        <span class="se-detail">${escapeHtml(v.ao)}</span>
      </div>
      <div class="se-row__actions">
        <button class="kanban-card__btn se-edit-btn" data-id="${v.id}">Edit</button>
        <button class="kanban-card__btn kanban-card__btn--danger se-del-btn" data-id="${v.id}">Del</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.se-order-btn').forEach(btn =>
    btn.addEventListener('click', () => moveVq(parseInt(btn.dataset.id), btn.dataset.action))
  );
  list.querySelectorAll('.se-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => editVqInline(parseInt(btn.dataset.id)))
  );
  list.querySelectorAll('.se-del-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteVq(parseInt(btn.dataset.id)))
  );
}

function editVqInline(id) {
  const vq = staticSections.vqs.find(v => v.id === id);
  if (!vq) return;
  const rowEl = document.querySelector(`#vqs-list .se-row[data-id="${id}"]`);
  if (!rowEl) return;

  rowEl.innerHTML = `
    <div class="se-inline-form">
      <input type="text" id="vq-edit-name-${id}" value="${escapeHtml(vq.name)}" placeholder="Name">
      <input type="text" id="vq-edit-ao-${id}" value="${escapeHtml(vq.ao)}" placeholder="AO">
      <div class="se-inline-form__btns">
        <button class="kanban-card__btn" id="vq-edit-save-${id}">Save</button>
        <button class="kanban-card__btn" id="vq-edit-cancel-${id}">Cancel</button>
      </div>
    </div>`;

  document.getElementById(`vq-edit-cancel-${id}`).addEventListener('click', () => renderVqsList());
  document.getElementById(`vq-edit-save-${id}`).addEventListener('click', async () => {
    const name = document.getElementById(`vq-edit-name-${id}`).value.trim();
    const ao = document.getElementById(`vq-edit-ao-${id}`).value.trim();
    if (!name || !ao) return;
    try {
      const r = await fetch(`/api/static/vqs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ao }) });
      if (!r.ok) throw new Error();
      const updated = await r.json();
      const idx = staticSections.vqs.findIndex(v => v.id === id);
      if (idx !== -1) staticSections.vqs[idx] = updated;
      renderVqsList();
      refreshProtectedLane('vqs');
      showToast('Saved', 'success');
    } catch { showToast('Save failed', 'error'); }
  });
}

async function deleteVq(id) {
  if (!confirm('Delete this VQ?')) return;
  try {
    const r = await fetch(`/api/static/vqs/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error();
    staticSections.vqs = staticSections.vqs.filter(v => v.id !== id);
    renderVqsList();
    refreshProtectedLane('vqs');
    showToast('Deleted', 'success');
  } catch { showToast('Delete failed', 'error'); }
}

async function moveVq(id, direction) {
  const vqList = staticSections.vqs;
  const idx = vqList.findIndex(v => v.id === id);
  if (idx === -1) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= vqList.length) return;
  [vqList[idx], vqList[swapIdx]] = [vqList[swapIdx], vqList[idx]];
  const order = vqList.map(v => v.id);
  try {
    const r = await fetch('/api/static/vqs/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) });
    if (!r.ok) throw new Error();
    order.forEach((vid, pos) => { const v = staticSections.vqs.find(x => x.id === vid); if (v) v.position = pos; });
    renderVqsList();
  } catch { showToast('Reorder failed', 'error'); }
}

async function addVq() {
  const name = document.getElementById('vq-add-name').value.trim();
  const ao = document.getElementById('vq-add-ao').value.trim();
  if (!name) { document.getElementById('vq-add-name').focus(); return; }
  if (!ao) { document.getElementById('vq-add-ao').focus(); return; }
  try {
    const r = await fetch('/api/static/vqs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ao }) });
    if (!r.ok) throw new Error();
    const created = await r.json();
    staticSections.vqs.push(created);
    document.getElementById('vq-add-name').value = '';
    document.getElementById('vq-add-ao').value = '';
    renderVqsList();
    refreshProtectedLane('vqs');
    showToast('Added', 'success');
  } catch { showToast('Add failed', 'error'); }
}

/* ============================================================
   Shovel Flag Editor
   ============================================================ */
function openShovelFlagsModal() {
  renderShovelFlagsList();
  openModal(document.getElementById('shovel-flags-modal'));
}

function renderShovelFlagsList() {
  const list = document.getElementById('shovel-flags-list');
  if (!list) return;
  const flags = staticSections.shovelFlags;
  if (flags.length === 0) { list.innerHTML = '<div class="static-editor-empty">No hand-offs recorded.</div>'; return; }
  list.innerHTML = flags.map((f, idx) => `
    <div class="se-row" data-id="${f.id}">
      <div class="se-row__order">
        <button class="se-order-btn" data-action="up" data-id="${f.id}" ${idx === 0 ? 'disabled' : ''}>↑</button>
        <button class="se-order-btn" data-action="down" data-id="${f.id}" ${idx === flags.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
      <div class="se-row__content">
        <span class="se-val">${escapeHtml(f.from_name)}</span>
        <span class="se-sep">→</span>
        <span class="se-detail">${escapeHtml(f.to_name)}</span>
        <span class="se-url">${escapeHtml(f.ao)}</span>
      </div>
      <div class="se-row__actions">
        <button class="kanban-card__btn se-edit-btn" data-id="${f.id}">Edit</button>
        <button class="kanban-card__btn kanban-card__btn--danger se-del-btn" data-id="${f.id}">Del</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.se-order-btn').forEach(btn =>
    btn.addEventListener('click', () => moveShovelFlag(parseInt(btn.dataset.id), btn.dataset.action))
  );
  list.querySelectorAll('.se-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => editShovelFlagInline(parseInt(btn.dataset.id)))
  );
  list.querySelectorAll('.se-del-btn').forEach(btn =>
    btn.addEventListener('click', () => deleteShovelFlag(parseInt(btn.dataset.id)))
  );
}

function editShovelFlagInline(id) {
  const flag = staticSections.shovelFlags.find(f => f.id === id);
  if (!flag) return;
  const rowEl = document.querySelector(`#shovel-flags-list .se-row[data-id="${id}"]`);
  if (!rowEl) return;

  rowEl.innerHTML = `
    <div class="se-inline-form">
      <input type="text" id="sf-edit-from-${id}" value="${escapeHtml(flag.from_name)}" placeholder="From">
      <input type="text" id="sf-edit-to-${id}" value="${escapeHtml(flag.to_name)}" placeholder="To">
      <input type="text" id="sf-edit-ao-${id}" value="${escapeHtml(flag.ao)}" placeholder="AO">
      <div class="se-inline-form__btns">
        <button class="kanban-card__btn" id="sf-edit-save-${id}">Save</button>
        <button class="kanban-card__btn" id="sf-edit-cancel-${id}">Cancel</button>
      </div>
    </div>`;

  document.getElementById(`sf-edit-cancel-${id}`).addEventListener('click', () => renderShovelFlagsList());
  document.getElementById(`sf-edit-save-${id}`).addEventListener('click', async () => {
    const from_name = document.getElementById(`sf-edit-from-${id}`).value.trim();
    const to_name = document.getElementById(`sf-edit-to-${id}`).value.trim();
    const ao = document.getElementById(`sf-edit-ao-${id}`).value.trim();
    if (!from_name || !to_name || !ao) return;
    try {
      const r = await fetch(`/api/static/shovel-flags/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from_name, to_name, ao }) });
      if (!r.ok) throw new Error();
      const updated = await r.json();
      const idx = staticSections.shovelFlags.findIndex(f => f.id === id);
      if (idx !== -1) staticSections.shovelFlags[idx] = updated;
      renderShovelFlagsList();
      refreshProtectedLane('shovel-flags');
      showToast('Saved', 'success');
    } catch { showToast('Save failed', 'error'); }
  });
}

async function deleteShovelFlag(id) {
  if (!confirm('Delete this hand-off?')) return;
  try {
    const r = await fetch(`/api/static/shovel-flags/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error();
    staticSections.shovelFlags = staticSections.shovelFlags.filter(f => f.id !== id);
    renderShovelFlagsList();
    refreshProtectedLane('shovel-flags');
    showToast('Deleted', 'success');
  } catch { showToast('Delete failed', 'error'); }
}

async function moveShovelFlag(id, direction) {
  const flags = staticSections.shovelFlags;
  const idx = flags.findIndex(f => f.id === id);
  if (idx === -1) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= flags.length) return;
  [flags[idx], flags[swapIdx]] = [flags[swapIdx], flags[idx]];
  const order = flags.map(f => f.id);
  try {
    const r = await fetch('/api/static/shovel-flags/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) });
    if (!r.ok) throw new Error();
    order.forEach((fid, pos) => { const f = staticSections.shovelFlags.find(x => x.id === fid); if (f) f.position = pos; });
    renderShovelFlagsList();
  } catch { showToast('Reorder failed', 'error'); }
}

async function addShovelFlag() {
  const from_name = document.getElementById('sf-add-from').value.trim();
  const to_name = document.getElementById('sf-add-to').value.trim();
  const ao = document.getElementById('sf-add-ao').value.trim();
  if (!from_name) { document.getElementById('sf-add-from').focus(); return; }
  if (!to_name) { document.getElementById('sf-add-to').focus(); return; }
  if (!ao) { document.getElementById('sf-add-ao').focus(); return; }
  try {
    const r = await fetch('/api/static/shovel-flags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from_name, to_name, ao }) });
    if (!r.ok) throw new Error();
    const created = await r.json();
    staticSections.shovelFlags.push(created);
    document.getElementById('sf-add-from').value = '';
    document.getElementById('sf-add-to').value = '';
    document.getElementById('sf-add-ao').value = '';
    renderShovelFlagsList();
    refreshProtectedLane('shovel-flags');
    showToast('Added', 'success');
  } catch { showToast('Add failed', 'error'); }
}

/* ============================================================
   Wire Static Editors
   ============================================================ */
function wireStaticEditors() {
  // Three F's modal
  document.getElementById('three-fs-modal-close')?.addEventListener('click', () => closeModal(document.getElementById('three-fs-modal')));
  document.getElementById('three-fs-modal-close-btn')?.addEventListener('click', () => closeModal(document.getElementById('three-fs-modal')));
  document.getElementById('three-fs-add-btn')?.addEventListener('click', addThreeFsItem);

  // Tab switching
  document.querySelectorAll('#three-fs-tabs .static-editor-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeThreeFsTab = tab.dataset.col;
      renderThreeFsList();
    });
  });

  // Toggle event/link fields in add form
  document.getElementById('three-fs-add-type')?.addEventListener('change', (e) => {
    const isLink = e.target.value === 'link';
    document.getElementById('three-fs-event-fields').style.display = isLink ? 'none' : 'flex';
    document.getElementById('three-fs-link-fields').style.display = isLink ? 'flex' : 'none';
  });

  // SLT modal
  document.getElementById('slt-modal-close')?.addEventListener('click', () => closeModal(document.getElementById('slt-modal')));
  document.getElementById('slt-modal-close-btn')?.addEventListener('click', () => closeModal(document.getElementById('slt-modal')));
  document.getElementById('slt-add-btn')?.addEventListener('click', addSltEntry);

  // Links modal
  document.getElementById('links-modal-close')?.addEventListener('click', () => closeModal(document.getElementById('links-modal')));
  document.getElementById('links-modal-close-btn')?.addEventListener('click', () => closeModal(document.getElementById('links-modal')));
  document.getElementById('links-add-btn')?.addEventListener('click', addHelpfulLink);

  // VQs modal
  document.getElementById('vqs-modal-close')?.addEventListener('click', () => closeModal(document.getElementById('vqs-modal')));
  document.getElementById('vqs-modal-close-btn')?.addEventListener('click', () => closeModal(document.getElementById('vqs-modal')));
  document.getElementById('vq-add-btn')?.addEventListener('click', addVq);

  // Shovel Flags modal
  document.getElementById('shovel-flags-modal-close')?.addEventListener('click', () => closeModal(document.getElementById('shovel-flags-modal')));
  document.getElementById('shovel-flags-modal-close-btn')?.addEventListener('click', () => closeModal(document.getElementById('shovel-flags-modal')));
  document.getElementById('sf-add-btn')?.addEventListener('click', addShovelFlag);

  // Click-outside to close static editor modals
  ['three-fs-modal', 'slt-modal', 'links-modal', 'vqs-modal', 'shovel-flags-modal'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      if (e.target === document.getElementById(id)) closeModal(document.getElementById(id));
    });
  });
}
