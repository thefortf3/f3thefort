# Requirements

This file is the explicit capability and coverage contract for the project.

## Active

### R001 — Members can submit newsletter entries via a public web form without logging in
- Class: core-capability
- Status: active
- Description: Members can submit newsletter entries via a public web form without logging in
- Why it matters: This is the primary user loop — without it, the system has no purpose
- Source: user
- Validation: unmapped
- Notes: Fields: Title, Q (leader), Date, Time (start + optional end), Description (rich text), Specific link (optional), Submitter contact: name/email/phone (all optional)

### R002 — The description field supports rich text formatting including bold, italic, links, images, and video embeds
- Class: core-capability
- Status: active
- Description: The description field supports rich text formatting including bold, italic, links, images, and video embeds
- Why it matters: Newsletter entries need formatted content, not plain text
- Source: user
- Validation: unmapped

### R004 — Admins can view all submissions in a paginated list, click through to full details, and delete entries
- Class: admin/support
- Status: active
- Description: Admins can view all submissions in a paginated list, click through to full details, and delete entries
- Why it matters: Newsletter editors need to review and manage submissions before publishing
- Source: user
- Validation: unmapped

### R005 — The admin page is protected by a password set via environment variable
- Class: compliance/security
- Status: active
- Description: The admin page is protected by a password set via environment variable
- Why it matters: Admin functionality should not be publicly accessible
- Source: user
- Validation: unmapped

### R007 — The application is fully responsive and works well on mobile devices
- Class: quality-attribute
- Status: active
- Description: The application is fully responsive and works well on mobile devices
- Why it matters: Many members will fill out the form on their phones
- Source: user
- Validation: unmapped

## Validated

### R003 — All submissions are stored in a SQLite database with full data persistence
- Class: integration
- Status: validated
- Description: All submissions are stored in a SQLite database with full data persistence
- Why it matters: Submissions must survive server restarts and be queryable
- Source: user
- Primary owning slice: S01
- Validation: SQLite database (dev.db) created with submissions table containing 13 columns. Drizzle ORM connection singleton verified. npx drizzle-kit push succeeded. API routes use db for all CRUD operations.
- Notes: Validated by S01: DB exists, schema has 13 columns, API routes persist data via Drizzle ORM

### R006 — A JSON API endpoint exposes all submissions for programmatic querying
- Class: integration
- Status: validated
- Description: A JSON API endpoint exposes all submissions for programmatic querying
- Why it matters: External systems need to access submission data programmatically
- Source: user
- Primary owning slice: S01
- Validation: GET /api/submissions returns JSON with {items: [], pagination: {page, limit, total, totalPages}}. POST returns 201 with full submission object. DELETE returns {success: true} or 404. All responses are structured JSON with proper HTTP status codes.
- Notes: Validated by S01: GET /api/submissions returns structured JSON with pagination metadata

### R008 — The end date/time must be after the start date/time when an end time is provided
- Class: core-capability
- Status: validated
- Description: The end date/time must be after the start date/time when an end time is provided
- Why it matters: Invalid time ranges would create confusing newsletter entries
- Source: user
- Primary owning slice: S01
- Validation: POST /api/submissions validates that end_time is after start_time when provided. Uses Date construction with dummy date prefix to compare HH:MM time strings. Returns 400 with {error: 'end_time must be after start_time'} on violation.
- Notes: Validated by S01: POST route validates end_time > start_time, returns 400 on violation

## Deferred

## Out of Scope

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
|---|---|---|---|---|---|
| R001 | core-capability | active | none | none | unmapped |
| R002 | core-capability | active | none | none | unmapped |
| R003 | integration | validated | S01 | none | SQLite database (dev.db) created with submissions table containing 13 columns. Drizzle ORM connection singleton verified. npx drizzle-kit push succeeded. API routes use db for all CRUD operations. |
| R004 | admin/support | active | none | none | unmapped |
| R005 | compliance/security | active | none | none | unmapped |
| R006 | integration | validated | S01 | none | GET /api/submissions returns JSON with {items: [], pagination: {page, limit, total, totalPages}}. POST returns 201 with full submission object. DELETE returns {success: true} or 404. All responses are structured JSON with proper HTTP status codes. |
| R007 | quality-attribute | active | none | none | unmapped |
| R008 | core-capability | validated | S01 | none | POST /api/submissions validates that end_time is after start_time when provided. Uses Date construction with dummy date prefix to compare HH:MM time strings. Returns 400 with {error: 'end_time must be after start_time'} on violation. |

