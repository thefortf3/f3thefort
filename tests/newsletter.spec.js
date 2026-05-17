import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3001';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test123';

// Helper: clean all submissions via API
async function cleanSubmissions(page) {
  const response = await page.request.get(`${BASE}/api/submissions?limit=1000`);
  const data = await response.json();
  if (data.items && Array.isArray(data.items)) {
    for (const entry of data.items) {
      await page.request.delete(`${BASE}/api/submissions/${entry.id}`, {
        headers: { 'Cookie': `adminAuth=${ADMIN_PASSWORD}` },
      });
    }
  }
}

// Helper: seed entries for admin tests
async function seedEntries(page) {
  for (let i = 1; i <= 3; i++) {
    await page.request.post(`${BASE}/api/submissions`, {
      data: {
        title: `Admin Test Entry ${i}`,
        start_date: `2026-09-${String(i).padStart(2, '0')}T10:00`,
        description: `<p>This is admin test entry ${i}.</p>`,
        leader: 'Test Leader',
      },
    });
  }
}

// Helper: set contenteditable innerHTML and sync to hidden input
async function fillEditor(page, html) {
  await page.evaluate((h) => {
    const content = document.getElementById('editor-content');
    const hiddenInput = document.getElementById('description');
    content.innerHTML = h;
    if (hiddenInput) {
      hiddenInput.value = h;
    }
  }, html);
}

// ============================================================
// R001 — Members can submit newsletter entries via a public web form without logging in
// ============================================================
test.describe('R001 — Public Submission Form', () => {
  test.beforeEach(async ({ page }) => {
    await cleanSubmissions(page);
  });

  test('should display the submission form with all required fields', async ({ page }) => {
    await page.goto(BASE);

    // Page should have the correct title
    await expect(page).toHaveTitle(/Submit/);

    // Eyebrow text should be visible
    await expect(page.locator('.page-header__eyebrow')).toBeVisible();
    await expect(page.locator('.page-header__eyebrow')).toHaveText('F3 - The Fort');

    // Title should be visible
    await expect(page.locator('.page-header__title')).toBeVisible();

    // Form should have required fields
    await expect(page.locator('#title')).toBeVisible();
    await expect(page.locator('#start_date')).toBeVisible();
    await expect(page.locator('#editor-content')).toBeVisible();

    // Optional fields should exist
    await expect(page.locator('#leader')).toBeVisible();
    await expect(page.locator('#end_time')).toBeVisible();
    await expect(page.locator('#link')).toBeVisible();
    await expect(page.locator('#submitter_name')).toBeVisible();
     await expect(page.locator('#submitter_email')).toBeVisible();
     await expect(page.locator('#submitter_phone')).toBeVisible();
     await expect(page.locator('#where')).toBeVisible();

    // Submit button should be visible
    await expect(page.locator('#submit-btn')).toBeVisible();
    await expect(page.locator('#submit-btn')).toHaveText(/Submit/);
  });

  test('should submit a valid entry without logging in', async ({ page }) => {
    await page.goto(BASE);

    // Fill in all required fields
    await page.locator('#title').fill('Saturday Morning Yoga');
    await page.locator('#leader').fill('Jane Smith');
    await page.locator('#start_date').fill('2026-06-20T09:00');
    await page.locator('#end_time').fill('2026-06-20T10:30');

    // Fill rich text editor
    await fillEditor(page, '<p>Join us for morning yoga in the park. Bring your own mat!</p>');

  await page.locator('#link').fill('https://example.com/yoga');
     await page.locator('#where').fill('Centennial Park');

     // Optional contact info
    await page.locator('#submitter_name').fill('John Doe');
    await page.locator('#submitter_email').fill('john@example.com');
    await page.locator('#submitter_phone').fill('(555) 123-4567');

    // Submit
    await page.locator('#submit-btn').click();

    // Should see success message
    await expect(page.locator('.alert--success')).toBeVisible();
    await expect(page.locator('.alert--success')).toContainText(/submitted successfully/i);

    // Form should be reset
    await expect(page.locator('#title')).toHaveValue('');
    await expect(page.locator('#leader')).toHaveValue('');
    await expect(page.locator('#submitter_name')).toHaveValue('');

    // Verify entry exists via API
    const response = await page.request.get('/api/submissions');
    const data = await response.json();
    expect(data.pagination.total).toBe(1);
    expect(data.items[0].title).toBe('Saturday Morning Yoga');
    expect(data.items[0].leader).toBe('Jane Smith');
    expect(data.items[0].start_date).toBe('2026-06-20T09:00');
    expect(data.items[0].end_time).toBe('2026-06-20T10:30');
    expect(data.items[0].link).toBe('https://example.com/yoga');
    expect(data.items[0].submitter_name).toBe('John Doe');
    expect(data.items[0].submitter_email).toBe('john@example.com');
    expect(data.items[0].submitter_phone).toBe('(555) 123-4567');
  });

  test('should reject submission with missing required fields', async ({ page }) => {
    await page.goto(BASE);

    // Only fill title, leave date and time empty
    await page.locator('#title').fill('Incomplete Entry');
    await page.locator('#submit-btn').click();

    // Should see error message
    await expect(page.locator('.alert--error')).toBeVisible();
    await expect(page.locator('.alert--error')).toContainText(/required/i);
  });

  test('should reject submission with end_time before start_time', async ({ page }) => {
    await page.goto(BASE);

    await page.locator('#title').fill('Bad Time Entry');
    await page.locator('#start_date').fill('2026-06-20T10:00');
    await page.locator('#end_time').fill('2026-06-20T09:00');
    await fillEditor(page, '<p>Some description</p>');

    await page.locator('#submit-btn').click();

    // Should see validation error
    await expect(page.locator('.alert--error')).toBeVisible();
    await expect(page.locator('.alert--error')).toContainText(/end time must be after/i);
  });
});

// ============================================================
// R002 — Description supports rich text formatting
// ============================================================
test.describe('R002 — Rich Text Editor', () => {
  test.beforeEach(async ({ page }) => {
    await cleanSubmissions(page);
  });

  test('should have a rich text editor with formatting toolbar', async ({ page }) => {
    await page.goto(BASE);

    // Editor should be visible
    await expect(page.locator('#editor-content')).toBeVisible();
    await expect(page.locator('#editor-content')).toHaveAttribute('contenteditable', 'true');

    // Toolbar buttons should exist
    await expect(page.locator('[data-command="bold"]')).toBeVisible();
    await expect(page.locator('[data-command="italic"]')).toBeVisible();
    await expect(page.locator('[data-command="underline"]')).toBeVisible();
    await expect(page.locator('[data-command="createLink"]')).toBeVisible();
    await expect(page.locator('[data-command="insertImage"]')).toBeVisible();
    await expect(page.locator('[data-command="formatBlock"]')).toBeVisible();
    await expect(page.locator('[data-command="insertUnorderedList"]')).toBeVisible();
    await expect(page.locator('[data-command="insertOrderedList"]')).toBeVisible();
  });

  test('should preserve rich text HTML in submission', async ({ page }) => {
    await page.goto(BASE);

    await page.locator('#title').fill('Rich Text Test');
    await page.locator('#start_date').fill('2026-07-01T14:00');

    // Write HTML content with formatting
    const richContent = '<p><strong>Bold text</strong> and <em>italic text</em> with a <a href="https://example.com">link</a></p><h3>Heading</h3><p>Normal paragraph</p>';
    await fillEditor(page, richContent);

    await page.locator('#submit-btn').click();
    await expect(page.locator('.alert--success')).toBeVisible();

    // Verify HTML is preserved
    const response = await page.request.get('/api/submissions');
    const data = await response.json();
    const desc = data.items[0].description;

    expect(desc).toContain('<strong>Bold text</strong>');
    expect(desc).toContain('<em>italic text</em>');
    expect(desc).toContain('<a href="https://example.com">link</a>');
    expect(desc).toContain('<h3>Heading</h3>');
  });
});

// ============================================================
// R003 — Submissions stored in SQLite with full persistence
// ============================================================
test.describe('R003 — SQLite Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await cleanSubmissions(page);
  });

  test('should persist submissions to database and retrieve them', async ({ page }) => {
    await page.goto(BASE);

    await page.locator('#title').fill('Persistence Test');
    await page.locator('#start_date').fill('2026-08-15T18:00');
    await fillEditor(page, '<p>This tests database persistence.</p>');
    await page.locator('#submit-btn').click();
    await expect(page.locator('.alert--success')).toBeVisible();

    // Verify via API
    const response = await page.request.get('/api/submissions');
    const data = await response.json();
    expect(data.pagination.total).toBe(1);
    expect(data.items[0].title).toBe('Persistence Test');

    // Verify via individual endpoint
    const entryRes = await page.request.get(`/api/submissions/${data.items[0].id}`);
    const entry = await entryRes.json();
    expect(entry.title).toBe('Persistence Test');
    expect(entry.description).toContain('database persistence');
  });
});

// ============================================================
// R004 — Admin can view all submissions in paginated list, click through, and delete
// ============================================================
test.describe('R004 — Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await cleanSubmissions(page);
    await seedEntries(page);
  });

  test.afterEach(async ({ page }) => {
    // Cleanup
    await cleanSubmissions(page);
  });

  test('should require admin login to access admin page', async ({ page }) => {
    // Clear any existing cookies
    await page.context().clearCookies();
    await page.goto(`${BASE}/admin`);

    // Should show login form, not dashboard
    await expect(page.locator('#login-view')).toBeVisible();
    await expect(page.locator('#login-form')).toBeVisible();
    await expect(page.locator('#admin-password')).toBeVisible();
    await expect(page.locator('#dashboard-view')).not.toBeVisible();
  });

  test('should reject wrong admin password', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`${BASE}/admin`);

    await page.locator('#admin-password').fill('wrongpassword');
    await page.locator('#login-btn').click();

    await expect(page.locator('.alert--error')).toBeVisible();
    await expect(page.locator('.alert--error')).toContainText(/Invalid password/i);
    await expect(page.locator('#dashboard-view')).not.toBeVisible();
  });

  test('should show dashboard after successful login', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`${BASE}/admin`);

    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-btn').click();

    await expect(page.locator('#dashboard-view')).toBeVisible();
    await expect(page.locator('#entry-count')).toBeVisible();
    await expect(page.locator('.entry-card')).toHaveCount(3);
  });

  test('should display entries in a paginated list', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`${BASE}/admin`);

    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-btn').click();

    // All 3 entries should be visible
    await expect(page.locator('.entry-card')).toHaveCount(3);

    // Each card should have title, meta, and excerpt
    const titles = await page.locator('.entry-card__title').allTextContents();
    expect(titles).toContain('Admin Test Entry 1');
    expect(titles).toContain('Admin Test Entry 2');
    expect(titles).toContain('Admin Test Entry 3');

    // Meta information should be present
    await expect(page.locator('.entry-card__meta').first()).toBeVisible();
  });

  test('should show entry details when clicking View', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`${BASE}/admin`);

    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-btn').click();

    // Click first entry's View button
    await page.locator('.view-btn').first().click();

    // Modal should appear
    await expect(page.locator('#detail-modal')).toBeVisible();
    await expect(page.locator('#detail-title')).toBeVisible();
    await expect(page.locator('#detail-content')).toBeVisible();

    // Close modal
    await page.locator('#modal-close').click();
    await expect(page.locator('#detail-modal')).not.toBeVisible();
  });

  test('should delete an entry', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`${BASE}/admin`);

    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-btn').click();

    // Should have 3 entries
    await expect(page.locator('.entry-card')).toHaveCount(3);

    // Click delete on first entry
    await page.locator('.delete-btn').first().click();

    // Confirm delete in modal
    await expect(page.locator('#delete-modal')).toBeVisible();
    await expect(page.locator('#delete-confirm-btn')).toBeVisible();
    await page.locator('#delete-confirm-btn').click();

    // Success message should appear
    await expect(page.locator('.alert--success')).toBeVisible();
    await expect(page.locator('.alert--success')).toContainText(/deleted/i);

    // Should now have 2 entries
    await expect(page.locator('.entry-card')).toHaveCount(2);
  });

  test('should allow logout', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`${BASE}/admin`);

    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-btn').click();

    await expect(page.locator('#dashboard-view')).toBeVisible();

    // Click logout
    await page.locator('#logout-btn').click();

    // Should be back at login
    await expect(page.locator('#login-view')).toBeVisible();
    await expect(page.locator('#dashboard-view')).not.toBeVisible();
  });
});

// ============================================================
// R005 — Admin page protected by password from env variable
// ============================================================
test.describe('R005 — Admin Password Protection', () => {
  test('should only accept the correct password from environment variable', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`${BASE}/admin`);

    // Wrong password should fail
    await page.locator('#admin-password').fill('wrong-password');
    await page.locator('#login-btn').click();
    await expect(page.locator('.alert--error')).toBeVisible();

    // Correct password should work
    await page.locator('#admin-password').fill('');
    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-btn').click();
    await expect(page.locator('#dashboard-view')).toBeVisible();
  });
});

// ============================================================
// R006 — JSON API exposes all submissions
// ============================================================
test.describe('R006 — JSON API', () => {
  test.beforeEach(async ({ page }) => {
    await cleanSubmissions(page);
  });

  test('GET /api/submissions returns JSON with pagination', async ({ page }) => {
    // Create test entries
    for (let i = 1; i <= 5; i++) {
      await page.request.post(`${BASE}/api/submissions`, {
        data: {
          title: `API Test ${i}`,
          start_date: `2026-10-${String(i).padStart(2, '0')}T12:00`,
          description: `<p>Test ${i}</p>`,
        },
      });
    }

    const response = await page.request.get('/api/submissions');
    const data = await response.json();

    // Check structure
    expect(data).toHaveProperty('items');
    expect(data).toHaveProperty('pagination');
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.pagination).toHaveProperty('page');
    expect(data.pagination).toHaveProperty('limit');
    expect(data.pagination).toHaveProperty('total');
    expect(data.pagination).toHaveProperty('totalPages');
    expect(data.pagination.total).toBe(5);
  });

  test('GET /api/submissions/:id returns single submission', async ({ page }) => {
    const postRes = await page.request.post(`${BASE}/api/submissions`, {
      data: {
        title: 'Single Entry API',
        start_date: '2026-11-01T15:00',
        description: '<p>Single entry test</p>',
      },
    });
    const created = await postRes.json();

    const getRes = await page.request.get(`/api/submissions/${created.id}`);
    const entry = await getRes.json();

    expect(entry.id).toBe(created.id);
    expect(entry.title).toBe('Single Entry API');
    expect(entry.description).toBe('<p>Single entry test</p>');
  });

  test('GET /api/submissions/:id returns 404 for non-existent entry', async ({ page }) => {
    const res = await page.request.get('/api/submissions/99999');
    expect(res.status()).toBe(404);
    const data = await res.json();
    expect(data).toHaveProperty('error');
  });

  test('POST /api/submissions returns 201 with full object', async ({ page }) => {
    const res = await page.request.post(`${BASE}/api/submissions`, {
      data: {
        title: 'API Post Test',
        start_date: '2026-12-25T08:00',
        description: '<p>Christmas special</p>',
        leader: 'Santa',
        end_time: '2026-12-25T12:00',
        link: 'https://santa.example.com',
        submitter_name: 'Rudolph',
        submitter_email: 'rudolph@northpole.com',
        submitter_phone: '555-REINDEER',
      },
    });

    expect(res.status()).toBe(201);
    const entry = await res.json();
    expect(entry.title).toBe('API Post Test');
    expect(entry.leader).toBe('Santa');
    expect(entry.submitter_email).toBe('rudolph@northpole.com');
  });

  test('DELETE /api/submissions/:id returns { success: true }', async ({ page }) => {
    const postRes = await page.request.post(`${BASE}/api/submissions`, {
      data: {
        title: 'Delete Me',
        start_date: '2026-01-01T00:00',
        description: '<p>Bye bye</p>',
      },
    });
    const created = await postRes.json();

    const delRes = await page.request.delete(`/api/submissions/${created.id}`, {
      headers: { 'Cookie': `adminAuth=${ADMIN_PASSWORD}` },
    });

    expect(delRes.status()).toBe(200);
    const data = await delRes.json();
    expect(data).toHaveProperty('success', true);
  });

  test('DELETE returns 404 for non-existent entry', async ({ page }) => {
    const res = await page.request.delete('/api/submissions/99999', {
      headers: { 'Cookie': `adminAuth=${ADMIN_PASSWORD}` },
    });
    expect(res.status()).toBe(404);
  });
});

// ============================================================
// R007 — Fully responsive on mobile
// ============================================================
test.describe('R007 — Responsive Design', () => {
  test('submission form should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 }); // iPhone SE size
    await page.goto(BASE);

    // All form fields should be visible and accessible
    await expect(page.locator('#title')).toBeVisible();
    await expect(page.locator('#start_date')).toBeVisible();
    await expect(page.locator('#editor-content')).toBeVisible();
    await expect(page.locator('#submit-btn')).toBeVisible();

    // Should be able to fill and submit
    await page.locator('#title').fill('Mobile Test');
    await page.locator('#start_date').fill('2026-06-15T11:00');
    await fillEditor(page, '<p>Mobile friendly!</p>');
    await page.locator('#submit-btn').click();

    await expect(page.locator('.alert--success')).toBeVisible();
  });

  test('admin page should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    // Create an entry first
    await page.goto(BASE);
    await page.locator('#title').fill('Mobile Admin Test');
    await page.locator('#start_date').fill('2026-07-04T18:00');
    await fillEditor(page, '<p>Independence day!</p>');
    await page.locator('#submit-btn').click();
    await expect(page.locator('.alert--success')).toBeVisible();

    // Login to admin
    await page.context().clearCookies();
    await page.goto(`${BASE}/admin`);
    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-btn').click();

    // Dashboard should be visible
    await expect(page.locator('#dashboard-view')).toBeVisible();
    await expect(page.locator('.entry-card').first()).toBeVisible();

    // View modal should work
    await page.locator('.view-btn').first().click();
    await expect(page.locator('#detail-modal')).toBeVisible();

    // Close modal
    await page.locator('#modal-close').click();
    await expect(page.locator('#detail-modal')).not.toBeVisible();
  });
});

// ============================================================
// R008 — Image Upload
// ============================================================
test.describe('R008 — Image Upload', () => {
  test.beforeEach(async ({ page }) => {
    await cleanSubmissions(page);
  });

  test('should upload an image and return a URL', async ({ page }) => {
    await page.goto(BASE);
    // Create a small PNG file in memory
    const buffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    // Use page.evaluate to create FormData in browser context (proper multipart encoding)
    const result = await page.evaluate(async (fileData) => {
      const blob = new Blob([fileData.buffer], { type: fileData.mimeType });
      const formData = new FormData();
      formData.append('image', blob, fileData.name);
      const response = await fetch(fileData.url, {
        method: 'POST',
        body: formData,
      });
      return { status: response.status, body: await response.json() };
    }, {
      buffer: Array.from(new Uint8Array(buffer)),
      mimeType: 'image/png',
      name: 'test.png',
      url: `${BASE}/api/upload/image`,
    });

    expect(result.status).toBe(200);
    expect(result.body).toHaveProperty('url');
    expect(result.body.url).toMatch(/^\/uploads\//);
  });

  test('should reject non-image files', async ({ page }) => {
    await page.goto(BASE);
    const buffer = Buffer.from('not an image');

    const result = await page.evaluate(async (fileData) => {
      const blob = new Blob([fileData.buffer], { type: fileData.mimeType });
      const formData = new FormData();
      formData.append('image', blob, fileData.name);
      const response = await fetch(fileData.url, {
        method: 'POST',
        body: formData,
      });
      return { status: response.status };
    }, {
      buffer: Array.from(new Uint8Array(buffer)),
      mimeType: 'text/plain',
      name: 'test.txt',
      url: `${BASE}/api/upload/image`,
    });

    expect(result.status).toBe(400);
  });

  test('should insert uploaded image into editor and preserve in submission', async ({ page }) => {
    await page.goto(BASE);

    // Create a small PNG file
    const buffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    // Fill form
    await page.locator('#title').fill('Image Test');
    await page.locator('#start_date').fill('2026-08-01T10:00');

    // Upload image and insert into editor via page.evaluate (simulates the toolbar action)
    const result = await page.evaluate(async (fileData) => {
      const blob = new Blob([fileData.buffer], { type: fileData.mimeType });
      const formData = new FormData();
      formData.append('image', blob, fileData.name);
      const response = await fetch(fileData.url, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) return { success: false, error: data.error };

      // Focus the editor before inserting image (execCommand requires focus)
      const editor = document.getElementById('editor-content');
      editor.focus();

      // Insert image using execCommand (same as the editor does)
      document.execCommand('insertImage', false, data.url);

      // Sync to hidden input
      const hiddenInput = document.getElementById('description');
      if (hiddenInput) {
        hiddenInput.value = document.getElementById('editor-content').innerHTML.trim();
      }

      return { success: true, url: data.url, editorContent: document.getElementById('editor-content').innerHTML };
    }, {
      buffer: Array.from(new Uint8Array(buffer)),
      mimeType: 'image/png',
      name: 'test.png',
      url: `${BASE}/api/upload/image`,
    });

    expect(result.success).toBe(true);
    expect(result.editorContent).toContain('<img');
    expect(result.editorContent).toContain('/uploads/');

    // Submit
    await page.locator('#submit-btn').click();
    await expect(page.locator('.alert--success')).toBeVisible();

    // Verify image URL is preserved in the submitted description
    const response = await page.request.get('/api/submissions');
    const data = await response.json();
    expect(data.items[0].description).toContain('<img');
    expect(data.items[0].description).toContain('/uploads/');
  });
});

// ============================================================
// R009 — Date formatting on admin page
// ============================================================
test.describe('R009 — Date Formatting', () => {
  test.beforeEach(async ({ page }) => {
    await cleanSubmissions(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanSubmissions(page);
  });

  test('should display dates correctly on admin page (not "Invalid Date")', async ({ page }) => {
    await page.goto(BASE);

    // Submit an entry with a datetime-local value (includes time)
    await page.locator('#title').fill('Date Format Test');
    await page.locator('#start_date').fill('2026-09-15T14:00');
    await page.locator('#end_time').fill('2026-09-15T16:00');
    await fillEditor(page, '<p>Testing date display.</p>');
    await page.locator('#submit-btn').click();
    await expect(page.locator('.alert--success')).toBeVisible();

    // Login to admin
    await page.context().clearCookies();
    await page.goto(`${BASE}/admin`);
    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-btn').click();

    // The entry should be visible with a properly formatted date
    await expect(page.locator('.entry-card')).toHaveCount(1);
    const titleText = await page.locator('.entry-card__title a').textContent();
    expect(titleText).toBe('Date Format Test');

    // Meta date should NOT contain "Invalid"
    const metaText = await page.locator('.entry-card__meta').textContent();
    expect(metaText).not.toContain('Invalid');
    expect(metaText).not.toContain('NaN');

    // Click view to see full details
    await page.locator('.view-btn').first().click();
    await expect(page.locator('#detail-modal')).toBeVisible();

    // Detail meta should also not show "Invalid Date"
    const detailMeta = await page.locator('#detail-meta').textContent();
    expect(detailMeta).not.toContain('Invalid');
    expect(detailMeta).not.toContain('NaN');
  });
});

// ============================================================
// R010 — Section Classification
// ============================================================
test.describe('R010 — Section Classification', () => {
  test.beforeEach(async ({ page }) => {
    await cleanSubmissions(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanSubmissions(page);
  });

  test('entries default to unclassified (no section field)', async ({ page }) => {
    await page.goto(BASE);

    // Submit an entry
    await page.locator('#title').fill('Section Test Entry');
    await page.locator('#start_date').fill('2026-09-15T14:00');
    await fillEditor(page, '<p>Testing section classification.</p>');
    await page.locator('#submit-btn').click();
    await expect(page.locator('.alert--success')).toBeVisible();

    // Verify API returns no section
    const response = await page.request.get('/api/submissions');
    const data = await response.json();
    expect(data.items[0].section).toBeNull();
  });

  test('admin can assign section via dropdown on entry card', async ({ page }) => {
    await page.goto(BASE);

    // Create 2 entries
    await page.locator('#title').fill('Hot Event 1');
    await page.locator('#start_date').fill('2026-09-15T14:00');
    await fillEditor(page, '<p>First hot event.</p>');
    await page.locator('#submit-btn').click();
    await expect(page.locator('.alert--success')).toBeVisible();

    await page.locator('#title').fill('Hot Event 2');
    await page.locator('#start_date').fill('2026-09-20T10:00');
    await fillEditor(page, '<p>Second hot event.</p>');
    await page.locator('#submit-btn').click();
    await expect(page.locator('.alert--success')).toBeVisible();

    // Login to admin
    await page.context().clearCookies();
    await page.goto(`${BASE}/admin`);
    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-btn').click();

    // Wait for entries to load
    await expect(page.locator('.entry-card')).toHaveCount(2);

    // Both entries should be under Unclassified
    await expect(page.locator('.section-group[data-section="unclassified"]')).toBeVisible();
    await expect(page.locator('.section-group[data-section="unclassified"] .entry-card')).toHaveCount(2);

    // Assign Hot Event 1 (second entry, since entries sorted by date desc) to "What's Hot in The Fort"
    const dropdowns = page.locator('.section-dropdown');
    await dropdowns.nth(1).selectOption('whats-hot');
    await dropdowns.nth(1).dispatchEvent('change');

    // Wait for the PATCH to complete
    await page.waitForTimeout(1000);

    // Entry should now be under "What's Hot in The Fort" section
    await expect(page.locator('.section-group[data-section="whats-hot"]')).toBeVisible();
    await expect(page.locator('.section-group[data-section="whats-hot"] .entry-card')).toHaveCount(1);

    // Hot Event 2 should still be under Unclassified
    await expect(page.locator('.section-group[data-section="unclassified"] .entry-card')).toHaveCount(1);

    // Verify API reflects the change
    const response = await page.request.get('/api/submissions');
    const data = await response.json();
    const hotEntry = data.items.find(i => i.title === 'Hot Event 1');
    expect(hotEntry.section).toBe('whats-hot');
  });

  test('section dropdown in detail modal works', async ({ page }) => {
    await page.goto(BASE);

    await page.locator('#title').fill('Modal Section Test');
    await page.locator('#start_date').fill('2026-10-01T12:00');
    await fillEditor(page, '<p>Testing modal section change.</p>');
    await page.locator('#submit-btn').click();
    await expect(page.locator('.alert--success')).toBeVisible();

    // Login to admin
    await page.context().clearCookies();
    await page.goto(`${BASE}/admin`);
    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-btn').click();

    // Open detail modal
    await page.locator('.view-btn').first().click();
    await expect(page.locator('#detail-modal')).toBeVisible();

    // Section badge should show "Unclassified"
    await expect(page.locator('#modal-section-badge')).toBeVisible();
    await expect(page.locator('#modal-section-badge')).toContainText('Unclassified');

    // Change section via modal dropdown
    await page.locator('#modal-section-dropdown').selectOption('still-fresh');

    // Wait for PATCH
    await page.waitForTimeout(500);

    // Badge should update
    await expect(page.locator('#modal-section-badge')).toContainText('Still Fresh');

    // Close modal
    await page.locator('#modal-close-btn').click();
    await expect(page.locator('#detail-modal')).not.toBeVisible();

    // Verify API
    const response = await page.request.get('/api/submissions');
    const data = await response.json();
    expect(data.items[0].section).toBe('still-fresh');
  });

  test('section subtitle shows correct breakdown', async ({ page }) => {
    await page.goto(BASE);

    // Create entries for different sections
    await page.locator('#title').fill('Hot Entry');
    await page.locator('#start_date').fill('2026-09-15T14:00');
    await fillEditor(page, '<p>Hot.</p>');
    await page.locator('#submit-btn').click();
    await expect(page.locator('.alert--success')).toBeVisible();

    await page.locator('#title').fill('Fresh Entry');
    await page.locator('#start_date').fill('2026-10-01T12:00');
    await fillEditor(page, '<p>Fresh.</p>');
    await page.locator('#submit-btn').click();
    await expect(page.locator('.alert--success')).toBeVisible();

    await page.locator('#title').fill('Link Entry');
    await page.locator('#start_date').fill('2026-11-01T12:00');
    await fillEditor(page, '<p>Link.</p>');
    await page.locator('#submit-btn').click();
    await expect(page.locator('.alert--success')).toBeVisible();

    // Login to admin
    await page.context().clearCookies();
    await page.goto(`${BASE}/admin`);
    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-btn').click();

    // Wait for entries to load
    await expect(page.locator('.entry-card')).toHaveCount(3);

    // All should be unclassified initially
    const countText = await page.locator('#entry-count').textContent();
    expect(countText).toContain('unclassified');
    expect(countText).toContain('3');

    // Assign sections
    const dropdowns = page.locator('.section-dropdown');
    await dropdowns.nth(0).selectOption('whats-hot');
    await dropdowns.nth(1).selectOption('still-fresh');
    await dropdowns.nth(2).selectOption('helpful-links');
    await page.waitForTimeout(500);

    // Subtitle should show all sections
    const updatedCount = await page.locator('#entry-count').textContent();
    expect(updatedCount).toContain("What's Hot");
    expect(updatedCount).toContain('Still Fresh');
    expect(updatedCount).toContain('Helpful Links');
    expect(updatedCount).not.toContain('unclassified');
  });

  test('PATCH /api/submissions/:id validates section values', async ({ page }) => {
    // Create an entry
    await page.goto(BASE);
    await page.locator('#title').fill('Validation Test');
    await page.locator('#start_date').fill('2026-12-01T12:00');
    await fillEditor(page, '<p>Validation.</p>');
    await page.locator('#submit-btn').click();
    await expect(page.locator('.alert--success')).toBeVisible();

    // Get the entry ID via API
    const getRes = await page.request.get('/api/submissions');
    const getData = await getRes.json();
    const entryId = getData.items[0].id;

    // Invalid section should return 400
    const invalidRes = await page.request.patch(`/api/submissions/${entryId}`, {
      headers: { 'Cookie': `adminAuth=${ADMIN_PASSWORD}` },
      data: { section: 'invalid-section' },
    });
    expect(invalidRes.status()).toBe(400);

    // Valid section should return 200
    const validRes = await page.request.patch(`/api/submissions/${entryId}`, {
      headers: { 'Cookie': `adminAuth=${ADMIN_PASSWORD}` },
      data: { section: 'whats-hot' },
    });
    expect(validRes.status()).toBe(200);
    const validData = await validRes.json();
    expect(validData.section).toBe('whats-hot');

    // null section should also work
    const nullRes = await page.request.patch(`/api/submissions/${entryId}`, {
      headers: { 'Cookie': `adminAuth=${ADMIN_PASSWORD}` },
      data: { section: null },
    });
    expect(nullRes.status()).toBe(200);
    const nullData = await nullRes.json();
    expect(nullData.section).toBeNull();
  });

  test('section field is included in GET API responses', async ({ page }) => {
    await page.goto(BASE);

    await page.locator('#title').fill('API Section Test');
    await page.locator('#start_date').fill('2026-08-01T10:00');
    await fillEditor(page, '<p>Section in API.</p>');
    await page.locator('#submit-btn').click();
    await expect(page.locator('.alert--success')).toBeVisible();

    // Set section via API
    const getRes = await page.request.get('/api/submissions');
    const getData = await getRes.json();
    const entryId = getData.items[0].id;

    await page.request.patch(`/api/submissions/${entryId}`, {
      headers: { 'Cookie': `adminAuth=${ADMIN_PASSWORD}` },
      data: { section: 'individual-init' },
    });

    // Verify GET returns section
    const response = await page.request.get('/api/submissions');
    const data = await response.json();
    expect(data.items[0]).toHaveProperty('section');
    expect(data.items[0].section).toBe('individual-init');
  });
});

// ============================================================
// Additional: UI Design Quality
// ============================================================
test.describe('UI Design Quality', () => {
  test('submission page should have proper typography and styling', async ({ page }) => {
    await page.goto(BASE);

    // Page should have a title
    await expect(page.locator('.page-header__title')).toBeVisible();
    await expect(page.locator('.page-header__title')).toHaveText('Submit an Entry');

    // Card should be styled
    await expect(page.locator('.card')).toBeVisible();

    // Form should have labels
    await expect(page.locator('label')).toHaveCount(10);

    // Submit button should be styled (primary class)
    await expect(page.locator('.btn--primary')).toBeVisible();
  });

  test('admin page should have proper structure and styling', async ({ page }) => {
    await cleanSubmissions(page);
    await seedEntries(page);
    await page.context().clearCookies();
    await page.goto(`${BASE}/admin`);

    // Login page should have proper structure
    await expect(page.locator('.login-container')).toBeVisible();
    await expect(page.locator('#login-form')).toBeVisible();
    await expect(page.locator('#login-view .page-header__title')).toContainText('Admin Login');

    // After login
    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-btn').click();

    await expect(page.locator('.admin-nav')).toBeVisible();
    await expect(page.locator('.entry-list')).toBeVisible();
  });
});
