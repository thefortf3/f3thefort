# Newsletter2 — Project Context for Agents

## What This Is
A community newsletter submission & management app. Members submit event entries via a public form; admins review/manage entries behind a password-protected dashboard.

## Tech Stack
- **Runtime**: Node.js (ESM modules)
- **Framework**: Express 5
- **Database**: SQLite via `better-sqlite3`
- **ORM**: Drizzle ORM (`drizzle-orm`)
- **Schema migrations**: Drizzle Kit (`drizzle-kit`)
- **File upload**: Multer (image uploads for rich text editor)
- **Testing**: Playwright (`@playwright/test`)
- **Frontend**: Vanilla HTML/CSS/JS (no framework)

## File Map
```
server.js              — Express server, all API routes, admin auth, static file serving
schema.js              — Drizzle table definition for `submissions` (12 columns)
drizzle.config.js      — Drizzle Kit config (sqlite dialect, schema → ./drizzle)
dev.db                 — SQLite database file (auto-created by better-sqlite3)
package.json           — Scripts: `dev`, `test`, `test:ui`
generate-newsletter.mjs — Newsletter generation script (reads template + DB → writes HTML)

public/
  index.html              — Public submission form page
  admin.html              — Admin dashboard + login pages
  newsletter-template.html — Template for generated newsletter (inline CSS + placeholder slots)
  newsletter-dark.html    — Generated newsletter output (overwritten each generation)
  css/admin.css           — Admin dashboard stylesheet
  css/newsletter-dark.css — Static dark theme stylesheet (NOT used by generated newsletter)
  css/style.css           — Orphaned stylesheet (never loaded by any HTML page)
  css/submit.css          — Public submission form stylesheet
  js/app.js               — All client-side JS (rich editor, form submit, admin auth, pagination, modals)

tests/
  global-setup.js        — Spawns server before test suite
  newsletter.spec.js     — All E2E tests (R001–R010 + UI quality)

playwright.config.js   — Test config (auto-starts server via globalSetup)
REQUIREMENTS.md        — All requirement traceability docs (R001–R010)
session-ses_1ce6.md    — Session notes (historical)

populate-db.mjs        — Script to populate dev.db with newsletter entries (create → PATCH sections)
```

## Key Architecture Decisions

### Database
- Single SQLite file (`dev.db`) with a `submissions` table (12 columns: id, title, leader, start_date, end_time, location, description, link, submitter_name, submitter_email, submitter_phone, created_at).
- Drizzle ORM wraps better-sqlite3. Schema is in `schema.js`.
- Run migrations: `npx drizzle-kit push`

### API Routes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/submissions` | none | Paginated list `{items, pagination}` |
| GET | `/api/submissions/:id` | none | Single submission |
| POST | `/api/submissions` | none | Create entry (required: title, start_date, description) |
| PATCH | `/api/submissions/:id` | password cookie | Update entry section (admin only) |
| DELETE | `/api/submissions/:id` | password cookie | Delete entry |
| POST | `/api/admin/login` | none | Login → sets `adminAuth` httpOnly cookie |
| POST | `/api/admin/logout` | none | Clears cookie |
| GET | `/api/admin/check-auth` | none | Returns `{authenticated: bool}` |

### Admin Auth
- Password from `ADMIN_PASSWORD` env var (default: `'admin123'`, dev script sets `'test123'`).
- Cookie: `adminAuth=<password>`, httpOnly, sameSite: strict.
- Middleware `requireAuth` checks cookie or body password field.

### Frontend
- Single JS file (`public/js/app.js`) handles everything: rich text editor (contenteditable + `document.execCommand`), form submission, admin login/logout, entry listing with pagination, detail/delete modals.
- CSS: Editorial/magazine aesthetic with Playfair Display + Source Serif 4 + DM Sans fonts. Warm parchment palette. Fully responsive (mobile-first).
- Rich text editor: `contenteditable` div with toolbar. HTML synced to hidden `<input id="description">` on every input event.

### Newsletter Generation
- `generate-newsletter.mjs` reads `public/newsletter-template.html` + submissions from DB, fills placeholders (`{{NANTAN_SECTION}}`, `{{DYNAMIC_SECTIONS}}`, etc.), writes `newsletter-dark.html`.
- Generated newsletter has **all CSS embedded inline** in the HTML — it does NOT load `newsletter-dark.css` or any external stylesheet.
- The template (`newsletter-template.html`) contains the CSS that styles the generated output. This is where all newsletter CSS changes must be made.
- `newsletter-dark.css` is only used by the static HTML file before regeneration; it is NOT used by the generated newsletter.
- `style.css` is orphaned — never loaded by any HTML page.
- Admin page (`admin.html`) loads `admin.css` separately. These are different CSS files for different views.
- To regenerate: `node generate-newsletter.mjs`

### Testing
- Playwright E2E tests cover all active requirements (R001–R010).
- `tests/global-setup.js` spawns the server with `ADMIN_PASSWORD=test123` before tests.
- Tests clean/seed data via API helpers (`cleanSubmissions`, `seedEntries`).
- Run: `npm test` (auto-starts server). UI mode: `npm run test:ui`.

### Populating Dev DB
- `node populate-db.mjs` creates entries via `POST /api/submissions` (no section), then assigns sections via `PATCH /api/submissions/:id` with admin auth.
- This mirrors the intended workflow: public form creates entries unclassified, admin assigns them to sections.
- Allowed sections: `whats-hot`, `individual-init`, `still-fresh`, `helpful-links`, `null`.

## Environment Variables
| Variable | Default | Purpose |
|----------|---------|---------|
| `ADMIN_PASSWORD` | `'admin123'` | Admin login password |
| `PORT` | `3000` | Server listen port |

## Common Commands
```bash
npm run dev          # Start dev server (ADMIN_PASSWORD=test123)
npm test             # Run Playwright E2E tests
npm run test:ui      # Playwright UI mode
npx drizzle-kit push # Push schema to dev.db
npx drizzle-kit studio # Open Drizzle Studio (DB viewer)
node populate-db.mjs # Populate dev.db with newsletter entries (creates → PATCH sections)
```

## Development Workflow
- **Always keep the dev server running** after making changes. Frontend files are served statically, so the server must be up to see updates in the browser.
- When asked to start the dev server, run it in the background using `nohup npm run dev &` so it doesn't block the terminal.
- If it's already running, check for port conflicts (`fuser -k 3000/tcp 2>/dev/null`) before starting.

## Requirement Status (from REQUIREMENTS.md)
| ID | Status | Description |
|----|--------|-------------|
| R001 | active | Public submission form (no login) |
| R002 | active | Rich text editor (bold, italic, links, images, video, headings, lists) |
| R003 | validated | SQLite persistence |
| R004 | active | Admin paginated list + detail view + delete |
| R005 | active | Admin password from env var |
| R006 | validated | JSON API with pagination |
| R007 | active | Fully responsive (mobile) |
| R008 | validated | end_time > start_date validation |
| R009 | active | Date formatting on admin page |
| R010 | active | Section classification (admin-only PATCH) |

## Key Implementation Details / Gotchas
- **Rich text**: Uses `contenteditable` + `document.execCommand` (deprecated but functional). HTML stored in DB as raw HTML string.
- **Form submission**: Client-side validation mirrors server-side required fields check. `end_time` client-side comparison uses string comparison (`endTime <= startDate`) which works for `datetime-local` format but may not handle all edge cases — server is the source of truth.
- **Admin auth**: Cookie is httpOnly + sameSite: strict. No CSRF token — the strict sameSite + cookie-only auth is the protection.
- **Pagination**: Default 8 items/page, max 100. Admin page uses `pageSize = 8` (hardcoded in JS).
- **Static file catch-all**: `app.get('{*path}', ...)` serves `index.html` for all non-API routes (SPA-style). This means any path other than `/admin` serves the submission form.
- **Exported modules**: `server.js` exports `{ app, server }` for test teardown purposes.
- **Tests use `page.request`** for API calls (bypasses browser auth state), making tests deterministic.
- **Newsletter CSS is in the template**: The generated newsletter (`newsletter-dark.html`) has all CSS embedded inline from `newsletter-template.html`. It does NOT load `newsletter-dark.css` or `admin.css`. When fixing newsletter styling (e.g., list indentation), edit `newsletter-template.html`, NOT `newsletter-dark.css` or `admin.css`. After changes, run `node generate-newsletter.mjs` to regenerate.
- **CSS reset strips list padding**: The newsletter template has a CSS reset (`*, *::before, *::after { padding: 0; }`) that zeros out list padding. The template also has explicit `padding-left: 0 !important` rules on `.event-desc ul/ol`, `.nantan-body ul/ol`, etc. When adding/modifying list styles in the newsletter, override these rules in `newsletter-template.html` with `padding-left: 1.5rem` (without `!important`).

## File Handling
- **Never delete hosted images.** The DELETE endpoint for submissions must NOT remove uploaded files from disk. Images are persistent assets that may be referenced by other entries or the generated newsletter.

## Email Policy
- **You must never send out an email campaign without explicit user permission.** Do not trigger email sends, mail merge jobs, or any outbound email — not even to yourself or a test address — unless the user directly instructs you to do so.
- **You must ONLY create campaigns, never send them.** All scheduling and sending is done by the user logging in manually. Never auto-send, never trigger a "Test Send", never blast to a mailing list.

## Testing Workflow
- Tests run on a separate server (port 3001, `test.db`) to avoid polluting `dev.db`.
- **After running E2E tests, respawn the dev server** — the test server may leave port 3001 occupied or interfere with the dev server on port 3000.
- Run: `fuser -k 3000/tcp 3001/tcp 2>/dev/null; npm run dev` to clean up and restart.
