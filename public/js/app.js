/**
 * Newsletter UI — JavaScript
 * Handles: rich text editor, form submission, admin auth, entry listing, modals
 */

/* ============================================================
   Section Definitions
   ============================================================ */
const SECTIONS = [
  { id: 'fng-tracker',   label: '2026 FNG Tracker',        accent: '#2C3E50' },
  { id: 'desk',          label: "Desk of the Nan'tan",     accent: '#6C3483' },
  { id: 'whats-hot',     label: "What's Hot in The Fort",  accent: '#8B2E2E' },
  { id: 'individual-init', label: 'Individual Initiative', accent: '#3A7D5C' },
  { id: 'still-fresh',   label: 'Still Fresh',            accent: '#D4A017' },
  { id: 'helpful-links', label: 'Helpful Links',          accent: '#5B7DB1' },
];

function getSectionById(id) {
  return SECTIONS.find(s => s.id === id) || null;
}

function getSectionLabel(sectionId) {
  const section = getSectionById(sectionId);
  return section ? section.label : 'Unclassified';
}

function getSectionAccent(sectionId) {
  const section = getSectionById(sectionId);
  return section ? section.accent : '#A89B8F';
}

/* ============================================================
   Rich Text Editor
   ============================================================ */
function initRichEditor() {
  const editor = document.getElementById('rich-editor');
  if (!editor) return;

  const content = document.getElementById('editor-content');
  const hiddenInput = document.getElementById('description');
  const toolbarButtons = editor.querySelectorAll('.rich-editor__toolbar button');

  function syncContent() {
    if (hiddenInput) {
      hiddenInput.value = content.innerHTML.trim();
    }
  }

  toolbarButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();

      const command = btn.dataset.command;
      const value = btn.dataset.value || null;

      if (!command) return;

      if (command === 'createLink') {
        const url = prompt('Enter URL:', 'https://');
        if (url) {
          document.execCommand(command, false, url);
          syncContent();
        }
      } else if (command === 'insertImage') {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            const formData = new FormData();
            formData.append('image', file);
            const response = await fetch('/api/upload/image', {
              method: 'POST',
              body: formData,
            });
            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              alert(data.error || 'Failed to upload image.');
              return;
            }
            const data = await response.json();
            document.execCommand(command, false, data.url);
            syncContent();
          } catch {
            alert('Network error. Could not upload image.');
          }
        });
        fileInput.click();
      } else {
        document.execCommand(command, false, value);
        syncContent();
      }

      updateToolbarState();
    });
  });

  function updateToolbarState() {
    toolbarButtons.forEach(btn => {
      const command = btn.dataset.command;
      if (command && command !== 'formatBlock') {
        btn.classList.toggle('active', document.queryCommandState(command));
      }
    });
  }

  content.addEventListener('keyup', updateToolbarState);
  content.addEventListener('mouseup', updateToolbarState);
  content.addEventListener('click', updateToolbarState);
  content.addEventListener('input', syncContent);
  syncContent();
}

/* ============================================================
   Submission Form
   ============================================================ */
function initSubmissionForm() {
  const form = document.getElementById('submission-form');
  if (!form) return;

  const submitBtn = document.getElementById('submit-btn');
  const submitText = document.getElementById('submit-text');
  const submitSpinner = document.getElementById('submit-spinner');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = form.querySelector('#title').value.trim();
    const startDate = form.querySelector('#start_date').value;
    const endTime = form.querySelector('#end_time').value;
    const description = form.querySelector('#description').value;

    if (!title || !startDate || !description) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showAlert('alert-container', 'Please fill in all required fields (marked with *).', 'error');
      return;
    }

    if (endTime && startDate) {
      if (endTime <= startDate) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showAlert('alert-container', 'End time must be after start time.', 'error');
        return;
      }
    }

    submitBtn.disabled = true;
    submitText.style.display = 'none';
    submitSpinner.style.display = 'inline-block';

    try {
       const body = {
        title,
        start_date: startDate,
        description,
      };

      if (form.querySelector('#leader').value.trim()) {
        body.leader = form.querySelector('#leader').value.trim();
      }
      if (endTime) {
        body.end_time = endTime;
      }
      if (form.querySelector('#where').value.trim()) {
        body.location = form.querySelector('#where').value.trim();
      }
      if (form.querySelector('#link').value.trim()) {
        body.link = form.querySelector('#link').value.trim();
      }

      const name = form.querySelector('#submitter_name').value.trim();
      const email = form.querySelector('#submitter_email').value.trim();
      const phone = form.querySelector('#submitter_phone').value.trim();
      if (name) body.submitter_name = name;
      if (email) body.submitter_email = email;
      if (phone) body.submitter_phone = phone;

      const response = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        form.reset();
        document.getElementById('editor-content').innerHTML = '';
        document.getElementById('description').value = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showAlert('alert-container', 'Your entry has been submitted successfully! Thank you.', 'success');
      } else {
        const data = await response.json().catch(() => ({}));
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showAlert('alert-container', data.error || 'Failed to submit entry. Please try again.', 'error');
      }
    } catch (err) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showAlert('alert-container', 'Network error. Please check your connection and try again.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitText.style.display = 'inline';
      submitSpinner.style.display = 'none';
    }
  });
}

/* ============================================================
   Alerts
   ============================================================ */
function showAlert(containerId, message, type) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const iconSvg = type === 'success'
    ? '<svg class="alert__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    : '<svg class="alert__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

  container.innerHTML = `<div class="alert alert--${type}">${iconSvg}<span>${message}</span></div>`;

  if (type === 'success') {
    setTimeout(() => {
      const alert = container.querySelector('.alert');
      if (alert) {
        alert.style.opacity = '0';
        alert.style.transform = 'translateY(-10px)';
        alert.style.transition = 'all 0.3s ease';
        setTimeout(() => container.innerHTML = '', 300);
      }
    }, 5000);
  }
}

/* ============================================================
   Admin Page
   ============================================================ */
let currentEntryId = null;

function initAdmin() {
  checkAuth();
  setupLogin();
  setupLogout();
  setupGenerateNewsletter();
  setupModals();
  setupSectionDropdowns();
  setupNavTabs();
}

async function checkAuth() {
  try {
    const response = await fetch('/api/admin/check-auth');
    const data = await response.json();
    if (data.authenticated) {
      showDashboard();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-view').style.display = 'block';
  document.getElementById('dashboard-view').style.display = 'none';
}

function showDashboard() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('dashboard-view').style.display = 'block';
  loadEntries();
}

function setupLogin() {
  const form = document.getElementById('login-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const password = document.getElementById('admin-password').value;
    const loginBtn = document.getElementById('login-btn');
    const loginText = document.getElementById('login-text');
    const loginSpinner = document.getElementById('login-spinner');

    loginBtn.disabled = true;
    loginText.style.display = 'none';
    loginSpinner.style.display = 'inline-block';

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        document.getElementById('admin-password').value = '';
        showDashboard();
      } else {
        const data = await response.json().catch(() => ({}));
        showAlert('login-alert', data.error || 'Incorrect password. Please try again.', 'error');
      }
    } catch {
      showAlert('login-alert', 'Network error. Please try again.', 'error');
    } finally {
      loginBtn.disabled = false;
      loginText.style.display = 'inline';
      loginSpinner.style.display = 'none';
    }
  });
}

function setupLogout() {
  const btn = document.getElementById('logout-btn');
  if (!btn) return;

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch {}
    showLogin();
  });
}

function setupGenerateNewsletter() {
  const btn = document.getElementById('generate-newsletter-btn');
  if (!btn) return;

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Generating...';
    try {
      const res = await fetch('/api/newsletter/generate', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showAlert('dashboard-alert', 'Newsletter generated! View it <a href="' + data.url + '" target="_blank">here</a>.', 'success');
      } else {
        showAlert('dashboard-alert', 'Failed to generate newsletter: ' + (data.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      showAlert('dashboard-alert', 'Failed to generate newsletter: ' + err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Generate Newsletter';
  });
}

function buildSectionSubtitle(items) {
  const counts = {};
  let unclassified = 0;

  items.forEach(item => {
    const section = item.section;
    if (section && getSectionById(section)) {
      counts[section] = (counts[section] || 0) + 1;
    } else {
      unclassified++;
    }
  });

  const parts = [];
  for (const sectionId of SECTIONS.map(s => s.id)) {
    if (counts[sectionId]) {
      const label = getSectionLabel(sectionId);
      const word = counts[sectionId] === 1 ? 'entry' : 'entries';
      parts.push(`${counts[sectionId]} in ${label}`);
    }
  }
  if (unclassified > 0) {
    parts.push(`${unclassified} unclassified`);
  }

  if (parts.length === 0) {
    return 'No entries yet';
  }

  return parts.join(' &middot; ');
}

async function loadEntries() {
  const listEl = document.getElementById('entry-list');
  const emptyEl = document.getElementById('empty-state');
  const countEl = document.getElementById('entry-count');

  listEl.style.display = 'none';
  emptyEl.style.display = 'none';
  countEl.textContent = 'Loading entries...';

  try {
    const response = await fetch('/api/submissions?limit=1000');
    if (!response.ok) throw new Error('Failed to load entries');

    const data = await response.json();
    const { items } = data;

    countEl.textContent = buildSectionSubtitle(items);

    if (items.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }

    listEl.style.display = 'flex';
    listEl.innerHTML = buildSectionedList(items);
  } catch (err) {
    listEl.innerHTML = `<div class="alert alert--error"><span>Error loading entries. Please refresh the page.</span></div>`;
  }
}

function buildSectionedList(items) {
  const grouped = {};
  const unclassified = [];

  // Initialize all sections
  SECTIONS.forEach(s => { grouped[s.id] = []; });

  items.forEach(entry => {
    const section = entry.section;
    if (section && grouped[section]) {
      grouped[section].push(entry);
    } else {
      unclassified.push(entry);
    }
  });

  let html = '';

  // Static FNG Tracker template
  html += `
    <div class="section-group" data-section="fng-tracker" style="border-left: 4px solid #2C3E50;">
      <div class="section-header" style="color: #2C3E50;">
        <span class="section-header__title">2026 FNG Tracker</span>
      </div>
      <div class="section-entries">
        <div style="display: flex; gap: var(--space-lg); flex-wrap: wrap; font-family: var(--font-display);">
          <div style="text-align: center;">
            <div style="font-size: 2rem; font-weight: 700; line-height: 1;">27 / 226</div>
            <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--color-text-muted); margin-top: var(--space-xs);">FNGs</div>
          </div>
          <div style="text-align: center;">
            <div style="font-size: 2rem; font-weight: 700; line-height: 1;">136 / 365</div>
            <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--color-text-muted); margin-top: var(--space-xs);">Days</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Static Desk of the Nan'tan template
  html += `
    <div class="section-group" data-section="desk" style="border-left: 4px solid #6C3483;">
      <div class="section-header" style="color: #6C3483;">
        <span class="section-header__title">Desk of the Nan'tan</span>
      </div>
      <div class="section-entries">
        <div style="font-size: 1.1rem; line-height: 1.7;">
          <p style="font-style: italic; font-weight: 600; margin-bottom: var(--space-md);">Why should we EH?</p>
          <p style="margin-bottom: var(--space-md);">New PAX bring energy, accountability, and breathe life into AOs. A region full of veterans gets stale; stale feels like deceleration. FNGs remind us why F3 matters.</p>
          <p style="font-weight: 700; margin-bottom: var(--space-xs);">FNGs</p>
          <ul style="margin-bottom: var(--space-md); padding-left: var(--space-lg);">
            <li>Pillsbury</li>
            <li>Fosbury</li>
            <li>Dr. Suluki</li>
            <li>Resort Wear</li>
            <li>Small Pint</li>
          </ul>
          <p style="font-weight: 700; margin-bottom: var(--space-xs);">VQs</p>
          <ul style="margin-bottom: 0; padding-left: var(--space-lg);">
            <li>🥳 Wheaties</li>
          </ul>
        </div>
      </div>
    </div>
  `;

  // Render sections in order
  SECTIONS.forEach(section => {
    const entries = grouped[section.id];
    if (entries.length === 0) return; // Skip empty sections

    html += `
      <div class="section-group" data-section="${section.id}">
        <div class="section-header" data-section-toggle="${section.id}">
          <span class="section-header__chevron" aria-hidden="true">&#9660;</span>
          <span class="section-header__title" style="color: ${section.accent};">${escapeHtml(section.label)}</span>
          <span class="section-header__count">${entries.length}</span>
        </div>
        <div class="section-entries stagger-children">
          ${entries.map(entry => buildEntryCard(entry)).join('')}
        </div>
      </div>
    `;
  });

  // Unclassified section
  if (unclassified.length > 0) {
    html += `
      <div class="section-group" data-section="unclassified">
        <div class="section-header" data-section-toggle="unclassified">
          <span class="section-header__chevron" aria-hidden="true">&#9660;</span>
          <span class="section-header__title" style="color: #A89B8F;">Unclassified</span>
          <span class="section-header__count">${unclassified.length}</span>
        </div>
        <div class="section-entries stagger-children">
          ${unclassified.map(entry => buildEntryCard(entry)).join('')}
        </div>
      </div>
    `;
  }

  // Static footer template
  html += `
    <div class="section-group" data-section="footer" style="border-top: 2px solid #DDD5C8; padding-top: var(--space-lg); margin-top: var(--space-lg);">
      <div style="display: flex; gap: var(--space-md); justify-content: center; flex-wrap: wrap; margin-bottom: var(--space-lg);">
        <a href="mailto:thefort@f3nation.com" style="color: var(--color-text); text-decoration: none; display: flex; align-items: center; gap: var(--space-xs);">
          <span style="font-size: 1.2rem;">&#9993;</span> thefort@f3nation.com
        </a>
        <a href="https://f3thefort.com/" target="_blank" rel="noopener" style="color: var(--color-text); text-decoration: none; display: flex; align-items: center; gap: var(--space-xs);">
          <span style="font-size: 1.2rem;">&#127760;</span> f3thefort.com
        </a>
        <a href="https://www.instagram.com/f3_the_fort/" target="_blank" rel="noopener" style="color: var(--color-text); text-decoration: none; display: flex; align-items: center; gap: var(--space-xs);">
          <span style="font-size: 1.2rem;">&#128247;</span> @f3_the_fort
        </a>
      </div>
      <div style="background: #F7F3E9; padding: var(--space-lg); border-radius: var(--radius-md); margin-bottom: var(--space-md);">
        <h4 style="font-family: var(--font-display); margin-bottom: var(--space-md); color: var(--color-heading);">Shared Leadership Team (SLT)</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-sm) var(--space-lg); font-size: 0.95rem; line-height: 1.6;">
          <div><strong>Nan'tan:</strong> Band Camp</div>
          <div><strong>1st F (East):</strong> Time Machine</div>
          <div><strong>1st F (West):</strong> Bonsai</div>
          <div><strong>2nd F:</strong> Liberty Bibberty</div>
          <div><strong>3rd F:</strong> Cornerstone</div>
          <div><strong>Weasel Shaker:</strong> Poppins</div>
          <div><strong>LDP:</strong> Cyclops</div>
          <div><strong>Comz:</strong> 38 Special, Console</div>
          <div><strong>Newsletter:</strong> Bitcoin, Console, Ruby Slippers</div>
        </div>
      </div>
      <div style="text-align: center; font-size: 0.8rem; color: var(--color-text-muted); line-height: 1.6;">
        <p>Copyright (C) 2026 The Fort F3. All rights reserved.</p>
        <p>Our mailing address is: The Fort F3</p>
      </div>
    </div>
  `;

  return html;
}

function buildEntryCard(entry) {
  const dateStr = formatDate(entry.start_date);
  const timeStr = formatTimeRange(entry.start_date, entry.end_time);
  const excerpt = stripHtml(entry.description || '');
  const id = entry.id || entry._id;
  const sectionAccent = getSectionAccent(entry.section);

  const sectionOptions = SECTIONS.map(s => {
    const selected = entry.section === s.id ? ' selected' : '';
    return `<option value="${s.id}"${selected}>${escapeHtml(s.label)}</option>`;
  }).join('');

  return `
    <div class="entry-card entry-card--sectioned" data-entry-id="${id}" style="--section-accent: ${sectionAccent};">
      <div class="entry-card__header">
        <div>
          <h4 class="entry-card__title"><a href="#" class="entry-link">${escapeHtml(entry.title)}</a></h4>
          <div class="entry-card__meta">
            ${dateStr ? `<span class="entry-card__meta-item">${dateStr}</span>` : ''}
            ${timeStr ? `<span class="entry-card__meta-item">${timeStr}</span>` : ''}
            ${entry.leader ? `<span class="entry-card__meta-item">Led by ${escapeHtml(entry.leader)}</span>` : ''}
          </div>
          ${excerpt ? `<p class="entry-card__excerpt">${excerpt}</p>` : ''}
        </div>
        <div class="entry-card__actions">
          <select class="section-dropdown" data-entry-id="${id}" aria-label="Section">
            <option value="">(none)</option>
            ${sectionOptions}
          </select>
          <button class="btn btn--ghost btn--sm view-btn" data-entry-id="${id}">View</button>
          <button class="btn btn--ghost btn--sm delete-btn" data-entry-id="${id}" style="color: var(--color-error);">Delete</button>
        </div>
      </div>
    </div>
  `;
}

function setupSectionDropdowns() {
  document.addEventListener('change', (e) => {
    const dropdown = e.target.closest('.section-dropdown');
    if (!dropdown) return;

    const id = dropdown.dataset.entryId;
    const newSection = dropdown.value || null;

    if (!id) return;

    // Find the entry card to update its accent border
    const card = dropdown.closest('.entry-card');
    const newAccent = getSectionAccent(newSection);
    card.style.setProperty('--section-accent', newAccent);

    // Update dropdown value to match
    dropdown.value = newSection;

    // Update section group if entry moved sections
    const currentSectionGroup = card.closest('.section-group');
    const currentSectionId = currentSectionGroup?.dataset?.section;

    // Move card to correct section group if needed
    if (newSection && getSectionById(newSection)) {
      let targetGroup = document.querySelector(`.section-group[data-section="${newSection}"]`);
      if (!targetGroup) {
        // Create the section group
        const section = getSectionById(newSection);
        const sectionHtml = `
          <div class="section-group" data-section="${newSection}">
            <div class="section-header" data-section-toggle="${newSection}">
              <span class="section-header__chevron" aria-hidden="true">&#9660;</span>
              <span class="section-header__title" style="color: ${section.accent};">${escapeHtml(section.label)}</span>
              <span class="section-header__count">1</span>
            </div>
            <div class="section-entries stagger-children"></div>
          </div>
        `;
        const listEl = document.getElementById('entry-list');
        const unclassifiedGroup = document.querySelector('.section-group[data-section="unclassified"]');
        if (unclassifiedGroup) {
          // Insert before unclassified
          const temp = document.createElement('div');
          temp.innerHTML = sectionHtml.trim();
          const newGroup = temp.firstElementChild;
          unclassifiedGroup.parentNode.insertBefore(newGroup, unclassifiedGroup);
        } else {
          listEl.insertAdjacentHTML('beforeend', sectionHtml);
        }
        targetGroup = document.querySelector(`.section-group[data-section="${newSection}"]`);
      }
      targetGroup.querySelector('.section-entries').appendChild(card);
    } else {
      // Move to unclassified
      let unclassifiedGroup = document.querySelector('.section-group[data-section="unclassified"]');
      if (!unclassifiedGroup) {
        const listEl = document.getElementById('entry-list');
        const unclassifiedHtml = `
          <div class="section-group" data-section="unclassified">
            <div class="section-header" data-section-toggle="unclassified">
              <span class="section-header__chevron" aria-hidden="true">&#9660;</span>
              <span class="section-header__title" style="color: #A89B8F;">Unclassified</span>
              <span class="section-header__count">1</span>
            </div>
            <div class="section-entries stagger-children"></div>
          </div>
        `;
        listEl.insertAdjacentHTML('beforeend', unclassifiedHtml);
        unclassifiedGroup = document.querySelector('.section-group[data-section="unclassified"]');
      }
      unclassifiedGroup.querySelector('.section-entries').appendChild(card);
    }

    // Remove empty section groups
    if (currentSectionId && currentSectionGroup) {
      const entriesInGroup = currentSectionGroup.querySelectorAll('.entry-card');
      if (entriesInGroup.length === 0) {
        currentSectionGroup.remove();
      } else {
        // Update count
        const countEl = currentSectionGroup.querySelector('.section-header__count');
        if (countEl) countEl.textContent = entriesInGroup.length;
      }
    }

    // Update section subtitle
    updateSectionSubtitle();

    // Send PATCH to server
    fetch(`/api/submissions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: newSection }),
    }).catch(() => {
      showAlert('dashboard-alert', 'Failed to update section.', 'error');
    });
  });
}

function updateSectionSubtitle() {
  const listEl = document.getElementById('entry-list');
  const cards = listEl.querySelectorAll('.entry-card');
  const entries = [];
  cards.forEach(card => {
    const id = card.dataset.entryId;
    // We need to fetch entries to build the subtitle properly
    // But we can approximate from the DOM
    const countEl = document.getElementById('entry-count');
    countEl.textContent = buildSectionSubtitleFromDOM();
  });
}

function buildSectionSubtitleFromDOM() {
  const counts = {};
  let unclassified = 0;

  SECTIONS.forEach(s => { counts[s.id] = 0; });

  const listEl = document.getElementById('entry-list');
  if (!listEl) return 'Loading...';

  // Count cards per section group
  listEl.querySelectorAll('.section-group').forEach(group => {
    const sectionId = group.dataset.section;
    const count = group.querySelectorAll('.entry-card').length;
    if (sectionId === 'unclassified') {
      unclassified = count;
    } else if (counts[sectionId] !== undefined) {
      counts[sectionId] = count;
    }
  });

  const parts = [];
  for (const sectionId of SECTIONS.map(s => s.id)) {
    if (counts[sectionId] > 0) {
      const label = getSectionLabel(sectionId);
      const word = counts[sectionId] === 1 ? 'entry' : 'entries';
      parts.push(`${counts[sectionId]} in ${label}`);
    }
  }
  if (unclassified > 0) {
    parts.push(`${unclassified} unclassified`);
  }

  if (parts.length === 0) {
    return 'No entries yet';
  }

  return parts.join(' &middot; ');
}

/* ============================================================
   Section Header Collapse/Expand
   ============================================================ */
function setupSectionToggles() {
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-section-toggle]');
    if (!toggle) return;

    const sectionId = toggle.dataset.sectionToggle;
    const group = toggle.closest('.section-group');
    const entries = group.querySelector('.section-entries');
    const chevron = toggle.querySelector('.section-header__chevron');

    if (!entries) return;

    const isCollapsed = group.classList.contains('section-group--collapsed');

    if (isCollapsed) {
      group.classList.remove('section-group--collapsed');
      chevron.textContent = '\u25BE'; // down
      entries.style.display = 'flex';
      entries.style.flexDirection = 'column';
      entries.style.gap = 'var(--space-md)';
    } else {
      group.classList.add('section-group--collapsed');
      chevron.textContent = '\u25B6'; // right
      entries.style.display = 'none';
    }
  });
}

/* ============================================================
   Modals
   ============================================================ */
function setupModals() {
  const detailModal = document.getElementById('detail-modal');
  const deleteModal = document.getElementById('delete-modal');

  // Open detail modal
  document.addEventListener('click', (e) => {
    const viewBtn = e.target.closest('.view-btn');
    const entryLink = e.target.closest('.entry-link');
    if (viewBtn || entryLink) {
      e.preventDefault();
      const id = (viewBtn || entryLink).dataset.entryId;
      if (id) openDetailModal(id);
    }

    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
      e.preventDefault();
      const id = deleteBtn.dataset.entryId;
      if (id) openDeleteModal(id, deleteBtn.closest('.entry-card').querySelector('.entry-card__title a').textContent);
    }
  });

  // Close detail modal
  document.getElementById('modal-close').addEventListener('click', () => closeDetailModal());
  document.getElementById('modal-close-btn').addEventListener('click', () => closeDetailModal());
  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) closeDetailModal();
  });

  // Delete from detail modal
  document.getElementById('modal-delete-btn').addEventListener('click', async () => {
    if (currentEntryId) {
      closeDetailModal();
      openDeleteModal(currentEntryId, document.getElementById('detail-title').textContent);
    }
  });

  // Close delete modal
  document.getElementById('delete-modal-close').addEventListener('click', () => closeDeleteModal());
  document.getElementById('delete-cancel-btn').addEventListener('click', () => closeDeleteModal());
  deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) closeDeleteModal();
  });

  // Confirm delete
  document.getElementById('delete-confirm-btn').addEventListener('click', async () => {
    if (currentEntryId) {
      await deleteEntry(currentEntryId);
      closeDeleteModal();
    }
  });

  // Close modals on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDetailModal();
      closeDeleteModal();
    }
  });

  // Section dropdown in detail modal
  document.getElementById('modal-section-dropdown')?.addEventListener('change', async (e) => {
    if (!currentEntryId) return;
    const newSection = e.target.value || null;

    try {
      const response = await fetch(`/api/submissions/${currentEntryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: newSection }),
      });

      if (response.ok) {
        // Update the section badge in the modal
        const badge = document.getElementById('modal-section-badge');
        if (badge) {
          const section = getSectionById(newSection);
          if (section) {
            badge.textContent = section.label;
            badge.style.background = section.accent + '22';
            badge.style.color = section.accent;
            badge.style.borderColor = section.accent + '44';
          } else {
            badge.textContent = 'Unclassified';
            badge.style.background = '#F0EBE0';
            badge.style.color = '#A89B8F';
            badge.style.borderColor = '#DDD5C8';
          }
        }

        // Update the card in the list
        const card = document.querySelector(`.entry-card[data-entry-id="${currentEntryId}"]`);
        if (card) {
          const newAccent = getSectionAccent(newSection);
          card.style.setProperty('--section-accent', newAccent);

          // Move card to correct section group
          const currentGroup = card.closest('.section-group');
          if (newSection && getSectionById(newSection)) {
            const targetGroup = document.querySelector(`.section-group[data-section="${newSection}"]`);
            if (targetGroup) {
              targetGroup.querySelector('.section-entries').appendChild(card);
            }
          } else {
            const unclassifiedGroup = document.querySelector('.section-group[data-section="unclassified"]');
            if (unclassifiedGroup) {
              unclassifiedGroup.querySelector('.section-entries').appendChild(card);
            }
          }

          // Clean up empty groups
          if (currentGroup) {
            const remaining = currentGroup.querySelectorAll('.entry-card');
            if (remaining.length === 0) {
              currentGroup.remove();
            } else {
              const countEl = currentGroup.querySelector('.section-header__count');
              if (countEl) countEl.textContent = remaining.length;
            }
          }
        }

        updateSectionSubtitle();
      } else {
        const data = await response.json().catch(() => ({}));
        showAlert('dashboard-alert', data.error || 'Failed to update section.', 'error');
      }
    } catch {
      showAlert('dashboard-alert', 'Network error. Could not update section.', 'error');
    }
  });
}

async function openDetailModal(id) {
  const modal = document.getElementById('detail-modal');
  const titleEl = document.getElementById('detail-title');
  const metaEl = document.getElementById('detail-meta');
  const contentEl = document.getElementById('detail-content');
  const submitterEl = document.getElementById('detail-submitter');

  try {
    const response = await fetch(`/api/submissions/${id}`);
    if (!response.ok) throw new Error('Not found');

    const entry = await response.json();

    titleEl.textContent = entry.title;
    let metaHtml = '';
    if (entry.start_date) {
      const suffix = (d) => {
        if (d >= 11 && d <= 13) return 'th';
        switch (d % 10) {
          case 1: return 'st';
          case 2: return 'nd';
          case 3: return 'rd';
          default: return 'th';
        }
      };
      const formatTime = (t) => {
        if (!t) return '';
        const timePart = t.includes('T') ? t.split('T')[1] : t;
        if (!timePart) return '';
        const [h, m] = timePart.split(':');
        return `${h}${m}`;
      };
      const formatD = (dt) => {
        if (!dt) return '';
        const [datePart] = dt.split('T');
        const [y, m, d] = datePart.split('-');
        const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${days[date.getDay()]} ${months[date.getMonth()]} ${parseInt(d)}${suffix(parseInt(d))}`;
      };
      const startDate = formatD(entry.start_date);
      const startTime = formatTime(entry.start_date);
      const endDate = formatD(entry.end_time);
      const endTime = formatTime(entry.end_time);
      if (startDate && startTime) {
        metaHtml += `<div>Start: ${startDate} - ${startTime}</div>`;
      } else if (startDate) {
        metaHtml += `<div>Start: ${startDate}</div>`;
      }
      if (endDate && endTime) {
        metaHtml += `<div>End: ${endDate} - ${endTime}</div>`;
      } else if (endDate) {
        metaHtml += `<div>End: ${endDate}</div>`;
      } else if (endTime) {
        metaHtml += `<div>End: ${endTime}</div>`;
      }
    }
    if (entry.leader) metaHtml += `<span>Led by ${escapeHtml(entry.leader)}</span>`;
    metaEl.innerHTML = metaHtml;

    let whereHtml = '';
    if (entry.location) {
      whereHtml = `<div class="detail-view__where"><strong>Where:</strong> ${escapeHtml(entry.location)}</div>`;
    }

    contentEl.innerHTML = entry.description || '<p style="color: var(--color-text-faint); font-style: italic;">No description provided.</p>';

    let submitterHtml = '';
    if (entry.submitter_name || entry.submitter_email || entry.submitter_phone) {
      const parts = [];
      if (entry.submitter_name) parts.push(escapeHtml(entry.submitter_name));
      if (entry.submitter_email) parts.push(`<a href="mailto:${escapeHtml(entry.submitter_email)}">${escapeHtml(entry.submitter_email)}</a>`);
      if (entry.submitter_phone) parts.push(escapeHtml(entry.submitter_phone));
      submitterHtml = `<p>Submitted by ${parts.join(' &middot; ')}</p>`;
    }
    submitterEl.innerHTML = submitterHtml;

    const linkEl = document.getElementById('detail-link');
    if (linkEl) {
      if (entry.link) {
        linkEl.innerHTML = `<a href="${escapeHtml(entry.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.link)}</a>`;
        linkEl.style.display = 'block';
      } else {
        linkEl.style.display = 'none';
      }
    }

    // Section badge
    const sectionBadge = document.getElementById('modal-section-badge');
    if (sectionBadge) {
      const section = getSectionById(entry.section);
      if (section) {
        sectionBadge.textContent = section.label;
        sectionBadge.style.background = section.accent + '22';
        sectionBadge.style.color = section.accent;
        sectionBadge.style.borderColor = section.accent + '44';
      } else {
        sectionBadge.textContent = 'Unclassified';
        sectionBadge.style.background = '#F0EBE0';
        sectionBadge.style.color = '#A89B8F';
        sectionBadge.style.borderColor = '#DDD5C8';
      }
    }

    // Section dropdown in modal
    const sectionDropdown = document.getElementById('modal-section-dropdown');
    if (sectionDropdown) {
      sectionDropdown.value = entry.section || '';
    }

    currentEntryId = id;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  } catch (err) {
    showAlert('dashboard-alert', 'Could not load entry details.', 'error');
  }
}

function closeDetailModal() {
  const modal = document.getElementById('detail-modal');
  modal.classList.remove('active');
  document.body.style.overflow = '';
  currentEntryId = null;
}

function openDeleteModal(id, title) {
  const modal = document.getElementById('delete-modal');
  document.getElementById('delete-entry-title').textContent = `"${title}"`;
  currentEntryId = id;
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeDeleteModal() {
  const modal = document.getElementById('delete-modal');
  modal.classList.remove('active');
  document.body.style.overflow = '';
}

async function deleteEntry(id) {
  const alertEl = document.getElementById('dashboard-alert');

  try {
    const response = await fetch(`/api/submissions/${id}`, { method: 'DELETE' });
    if (response.ok) {
      showAlert('dashboard-alert', 'Entry deleted successfully.', 'success');
      loadEntries();
    } else {
      const data = await response.json().catch(() => ({}));
      showAlert('dashboard-alert', data.error || 'Failed to delete entry.', 'error');
    }
  } catch {
    showAlert('dashboard-alert', 'Network error. Could not delete entry.', 'error');
  }
}

/* ============================================================
   Utilities
   ============================================================ */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const datePart = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  const [y, m, d] = datePart.split('-');
  const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = parseInt(d);
  const suffix = (dd) => {
    if (dd >= 11 && dd <= 13) return 'th';
    switch (dd % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  };
  return `${days[date.getDay()]} ${months[date.getMonth()]} ${day}${suffix(day)}`;
}

function formatTimeRange(start, end) {
  if (!start) return '';
  const formatTime = (t) => {
    if (!t) return '';
    const timePart = t.includes('T') ? t.split('T')[1] : t;
    if (!timePart) return '';
    const [h, m] = timePart.split(':');
    return `${h}${m}`;
  };

  const formatDateTime = (dt) => {
    if (!dt) return '';
    const [datePart, timePart] = dt.split('T');
    const dateStr = formatDate(datePart);
    const timeStr = formatTime(timePart);
    return `${dateStr} ${timeStr}`;
  };

  const formatDateTimeOnly = (dt) => {
    if (!dt) return '';
    const [datePart, timePart] = dt.split('T');
    const timeStr = formatTime(timePart);
    return timeStr;
  };

  const startTimeStr = formatTime(start);
  if (!end) return startTimeStr;

  const startDateDate = start.split('T')[0];
  const endDateDate = end.split('T')[0];

  if (startDateDate === endDateDate) {
    return `${startTimeStr} \u2013 ${formatTime(end)}`;
  }

  return `${startTimeStr} \u2013 ${formatDateTime(end)}`;
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ============================================================
   Initialize section toggles after DOM is ready
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  setupSectionToggles();
});

/* ============================================================
   FNG Tracker View
   ============================================================ */
function setupNavTabs() {
  const entriesBtn = document.getElementById('nav-entries-btn');
  const fngsBtn = document.getElementById('nav-fngs-btn');
  if (!entriesBtn || !fngsBtn) return;

  entriesBtn.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('dashboard-view').style.display = 'block';
    document.getElementById('fng-view').style.display = 'none';
    entriesBtn.style.fontWeight = '700';
    fngsBtn.style.fontWeight = '';
    loadEntries();
  });

  fngsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('dashboard-view').style.display = 'none';
    document.getElementById('fng-view').style.display = 'block';
    fngsBtn.style.fontWeight = '700';
    entriesBtn.style.fontWeight = '';
    loadFngs();
  });
}

let fngPage = 1;
const FNG_PAGE_SIZE = 20;

async function loadFngs() {
  try {
    await loadFngStats();
    const res = await fetch(`/api/fngs?page=${fngPage}&limit=${FNG_PAGE_SIZE}&year=2026`);
    const data = await res.json();
    renderFngList(data);
    renderFngPagination(data.pagination);
  } catch (err) {
    console.error('Failed to load FNGs:', err);
  }
}

async function loadFngStats() {
  try {
    const res = await fetch('/api/fngs/stats');
    const stats = await res.json();
    
    const progressBar = document.getElementById('fng-progress-bar');
    const progressText = document.getElementById('fng-progress-text');
    const daysEl = document.getElementById('fng-days');
    const targetEl = document.getElementById('fng-target');
    const statusEl = document.getElementById('fng-status');
    const statsEl = document.getElementById('fng-stats');

    if (progressBar) progressBar.style.width = `${stats.progressPercent}%`;
    if (progressBar) progressBar.style.background = stats.onTrack ? 'var(--color-success)' : 'var(--color-accent)';
    if (progressText) progressText.textContent = `${stats.total2026} / ${stats.goal} (${stats.progressPercent}%)`;
    if (daysEl) daysEl.textContent = `Day ${stats.daysElapsed} of 365`;
    if (targetEl) targetEl.textContent = `Target: ${stats.expectedFngs} FNGs by now`;
    if (statusEl) statusEl.textContent = stats.onTrack ? '✅ On track' : '⚠️ Behind pace';
    if (statsEl) statsEl.textContent = `${stats.total2026} FNGs in 2026 · ${stats.totalAll} total · Goal: ${stats.goal}`;
  } catch (err) {
    console.error('Failed to load FNG stats:', err);
  }
}

function renderFngList(data) {
  const listEl = document.getElementById('fng-list');
  const emptyState = document.getElementById('fng-empty-state');
  
  if (!data.items || data.items.length === 0) {
    listEl.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  
  emptyState.style.display = 'none';
  listEl.innerHTML = data.items.map(fng => `
    <div class="entry-card" style="margin-bottom: var(--space-md);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-md);">
        <div>
          <h3 style="font-family: var(--font-display); font-size: 1.1rem; font-weight: 700; margin-bottom: var(--space-xs);">
            ${escapeHtml(fng.f3_name)}
          </h3>
          <p style="font-family: var(--font-ui); font-size: 0.82rem; color: var(--color-text-muted); margin-bottom: var(--space-xs);">
            ${escapeHtml(fng.first_name)} ${escapeHtml(fng.last_name)}
            ${fng.email ? ` · <a href="mailto:${escapeHtml(fng.email)}" style="color: var(--color-accent);">${escapeHtml(fng.email)}</a>` : ''}
          </p>
          <p style="font-family: var(--font-ui); font-size: 0.82rem; color: var(--color-text-muted);">
            ${fng.ehed_by ? `EH'ed by: <strong>${escapeHtml(fng.ehed_by)}</strong>` : ''}
            ${fng.ao ? ` · AO: ${escapeHtml(fng.ao)}` : ''}
          </p>
          ${fng.workout_q_f3_name ? `<p style="font-family: var(--font-ui); font-size: 0.78rem; color: var(--color-text-faint); margin-top: var(--space-xs);">Workout Q: ${escapeHtml(fng.workout_q_f3_name)}</p>` : ''}
        </div>
        <button class="btn btn--danger btn--sm fng-delete-btn" data-fng-id="${fng.id}" style="flex-shrink: 0;">Delete</button>
      </div>
    </div>
  `).join('');

  // Setup delete buttons
  listEl.querySelectorAll('.fng-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.fngId;
      if (!confirm('Delete this FNG entry?')) return;
      try {
        const res = await fetch(`/api/fngs/${id}`, { method: 'DELETE' });
        if (res.ok) {
          loadFngs();
        }
      } catch (err) {
        console.error('Failed to delete FNG:', err);
      }
    });
  });
}

function renderFngPagination(pagination) {
  const pagEl = document.getElementById('fng-pagination');
  if (!pagination || pagination.totalPages <= 1) {
    pagEl.style.display = 'none';
    return;
  }
  
  pagEl.style.display = 'flex';
  pagEl.innerHTML = '';
  
  for (let i = 1; i <= pagination.totalPages; i++) {
    const btn = document.createElement('button');
    btn.className = `pagination__btn ${i === pagination.page ? 'active' : ''}`;
    btn.textContent = i;
    btn.addEventListener('click', () => {
      fngPage = i;
      loadFngs();
    });
    pagEl.appendChild(btn);
  }
}
