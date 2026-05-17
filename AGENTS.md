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
server.js          — Express server, all API routes, admin auth, static file serving
schema.js          — Drizzle table definition for `submissions` (12 columns)
drizzle.config.js  — Drizzle Kit config (sqlite dialect, schema → ./drizzle)
dev.db             — SQLite database file (auto-created by better-sqlite3)
package.json       — Scripts: `dev`, `test`, `test:ui`

public/
  index.html       — Public submission form page
  admin.html       — Admin dashboard + login pages
  css/style.css    — Full stylesheet (editorial/magazine aesthetic)
  js/app.js        — All client-side JS (rich editor, form submit, admin auth, pagination, modals)

tests/
  global-setup.js  — Spawns server before test suite
  newsletter.spec.js — All E2E tests (R001–R010 + UI quality)

playwright.config.js — Test config (auto-starts server via globalSetup)
REQUIREMENTS.md    — All requirement traceability docs (R001–R010)
session-ses_1ce6.md — Session notes (historical)

populate-db.mjs    — Script to populate dev.db with newsletter entries (create → PATCH sections)
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

## Testing Workflow
- Tests run on a separate server (port 3001, `test.db`) to avoid polluting `dev.db`.
- **After running E2E tests, respawn the dev server** — the test server may leave port 3001 occupied or interfere with the dev server on port 3000.
- Run: `fuser -k 3000/tcp 3001/tcp 2>/dev/null; npm run dev` to clean up and restart.
