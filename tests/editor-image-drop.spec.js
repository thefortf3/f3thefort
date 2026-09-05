import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3001';

// Regression coverage for the 2026-09-04 outage: dragging an image file into the description
// editor had no drop handler, so the browser inlined it as a base64 data: URI. The resulting
// submission body (~1.18MB for an 882KB PNG) blew past body-parser's default 100kb limit and
// every submit died with a 413 — surfaced to the user only as a generic "please try again".
//
// The editor must route dropped images through /api/upload/image and insert them as URLs.

// A 1x1 transparent PNG, dropped as a real File the way a desktop drag does.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function dropOnEditor(page, payload) {
  const box = await page.locator('#editor-content').boundingBox();
  return page.evaluate(({ payload, x, y }) => {
    const dt = new DataTransfer();
    if (payload.b64) {
      const bin = atob(payload.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
    }
    if (payload.html) dt.setData('text/html', payload.html);
    if (payload.text) dt.setData('text/plain', payload.text);

    const el = document.getElementById('editor-content');
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y };
    el.dispatchEvent(new DragEvent('dragover', opts));
    el.dispatchEvent(new DragEvent('drop', opts));
  }, { payload, x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

test.describe('description editor — dropped images', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForSelector('#editor-content');
  });

  test('uploads a dropped image file and inserts it as a URL, not a data: URI', async ({ page }) => {
    const uploads = [];
    page.on('request', r => { if (r.url().includes('/api/upload/image')) uploads.push(r.method()); });

    await dropOnEditor(page, { b64: PNG_B64 });
    await expect(page.locator('#editor-content img')).toHaveAttribute('src', /^\/uploads\//);

    expect(uploads).toEqual(['POST']);

    const html = await page.locator('#editor-content').innerHTML();
    expect(html).not.toContain('data:');

    // The hidden field is what actually gets submitted — it must stay small enough that the
    // request never approaches the body limit.
    const description = await page.locator('#description').inputValue();
    expect(description).toContain('/uploads/');
    expect(description).not.toContain('data:');
    expect(description.length).toBeLessThan(500);
  });

  test('a dropped image does not displace text already in the editor', async ({ page }) => {
    await page.locator('#editor-content').fill('existing copy');
    await dropOnEditor(page, { b64: PNG_B64 });
    await expect(page.locator('#editor-content img')).toHaveAttribute('src', /^\/uploads\//);
    await expect(page.locator('#editor-content')).toContainText('existing copy');
  });

  test('keeps multiple dropped images in the order they were dropped', async ({ page }) => {
    await page.evaluate(() => {
      // Tag each upload response so the assertion can tell the two images apart.
      let n = 0;
      const real = window.fetch;
      window.fetch = async (...args) => {
        if (String(args[0]).includes('/api/upload/image')) {
          n += 1;
          return new Response(JSON.stringify({ url: `/uploads/ordered-${n}.png` }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          });
        }
        return real(...args);
      };
    });

    const box = await page.locator('#editor-content').boundingBox();
    await page.evaluate(({ b64, x, y }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'a.png', { type: 'image/png' }));
      dt.items.add(new File([bytes], 'b.png', { type: 'image/png' }));
      const el = document.getElementById('editor-content');
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y };
      el.dispatchEvent(new DragEvent('dragover', opts));
      el.dispatchEvent(new DragEvent('drop', opts));
    }, { b64: PNG_B64, x: box.x + box.width / 2, y: box.y + box.height / 2 });

    await expect(page.locator('#editor-content img')).toHaveCount(2);
    const srcs = await page.locator('#editor-content img').evaluateAll(els => els.map(e => e.getAttribute('src')));
    expect(srcs).toEqual(['/uploads/ordered-1.png', '/uploads/ordered-2.png']);
  });

  test('strips an inlined data: URI from dropped HTML', async ({ page }) => {
    // Dragging an image out of another browser tab hands over markup rather than a file.
    await dropOnEditor(page, {
      html: `<p>caption</p><img src="data:image/png;base64,${PNG_B64}">`,
    });
    const html = await page.locator('#editor-content').innerHTML();
    expect(html).not.toContain('data:');
    expect(html).toContain('caption');
  });

  test('a submission carrying a dropped image is accepted', async ({ page }) => {
    await page.locator('#title').fill('Drop regression entry');
    await page.locator('#editor-content').fill('body copy');
    await dropOnEditor(page, { b64: PNG_B64 });
    await expect(page.locator('#editor-content img')).toHaveAttribute('src', /^\/uploads\//);

    const description = await page.locator('#description').inputValue();
    const res = await page.request.post(`${BASE}/api/submissions`, {
      data: { title: 'Drop regression entry', description },
    });
    expect(res.status()).toBe(201);
  });
});

test.describe('oversized submissions', () => {
  test('answers a too-large body with JSON the form can actually display', async ({ page }) => {
    // Before the fix this returned Express's default HTML error page, so the client's
    // response.json() rejected and the user saw only "Failed to submit entry."
    const res = await page.request.post(`${BASE}/api/submissions`, {
      data: {
        title: 'Too big',
        description: `<img src="data:image/png;base64,${'A'.repeat(1_200_000)}">`,
      },
      failOnStatusCode: false,
    });

    expect(res.status()).toBe(413);
    expect(res.headers()['content-type']).toContain('application/json');
    const body = await res.json();
    expect(body.error).toMatch(/too large/i);
    expect(body.error).toMatch(/image/i);
  });
});
