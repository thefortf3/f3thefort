# F3 The Fort: website, events and The Fort Weekly

The code behind [f3thefort.com](https://f3thefort.com), the site of F3 The Fort (Fort Mill, SC):
event submissions and approvals, the weekly email newsletter (**The Fort Weekly**), workout
schedules, backblasts and the stats pages.

It is moving from a standalone Node app into WordPress:

| Part | Where | Status |
|---|---|---|
| **Fort Weekly** plugin: events, approvals, region info, the newsletter, Mailchimp drafts | [`wordpress-plugin/fort-weekly/`](wordpress-plugin/fort-weekly/README.md) | Built, not yet live |
| **Fort Stats** plugin: the stats site, backblasts, Q schedule, AO map | [`wordpress-plugin/fort-stats/`](wordpress-plugin/fort-stats/README.md) | Built, not yet live |
| **Fort** theme: every public page | [`wordpress-theme/fort/`](wordpress-theme/fort/) | Built, not yet live |
| **Newsletter app** (Node, Express, SQLite): the old submit form, admin board and generator | repo root: `server.js`, `lib/`, `public/` | **Live** at submit.f3thefort.com until the switch |

The plugins own the data and the theme only presents it, so the theme can change without losing
anything. Each plugin's README is the detailed reference: screens, settings, data flow and the
steps for switching over.

## Branches

- `master`: what's in production (the Node app).
- `feature/wordpress-native`: the WordPress plugins and theme. Most current work is here.
- `feature/site-and-newsletter`: an earlier step towards the WordPress site; kept for history.

## Where the data comes from

```
PAX ──/submit/──▶ Fort Weekly (WordPress posts, type fort_event) ──▶ site pages + newsletter
                                                                        │
                                              Mailchimp draft ◀─────────┘  (never sent from here)

Slack backblasts ─▶ Apps Script sync ─▶ Supabase (Postgres) ─HTTPS─▶ Fort Stats ─▶ stats, backblasts
GloomSchedule (AOs, Qs) ───────────────────────────────HTTPS─▶ Fort Stats ─▶ schedule, AO map, Every week
FNG sign-up Google Sheet ──────────────────────────────HTTPS─▶ Fort Stats ─▶ FNG counts
```

- **Pages never fetch live.** A background job (WP-Cron, run by a real cron) refreshes stored
  copies of the stats and the schedule. Only searches and filtered views query Supabase on
  request.
- **FNG numbers come only from the sign-up sheet**, never from backblast counts.
- **The Supabase side is in [`supabase/`](supabase/README.md):** the tables, the read-only
  `stats_api_*` functions the plugin calls, and the Apps Script that loads the data each night.
  The plugin only uses the anon key.
- **No Python.** The old Flask stats site (stats.f3thefort.com) and its Slack jobs live in a
  separate, private repo and retire with the VPS. Nothing in WordPress calls them.

## Requirements

- **Docker**, for the local site, the PHP tests and the build tools. Nothing else needs to be
  installed on the host.
- **PHP 8.3.36 or newer** in production (earlier 8.3 releases have a known security hole).
  Production runs WordPress 7.1 on HostGator, where outbound Postgres ports are blocked; that's
  why Fort Stats talks to Supabase over HTTPS.
- **Node 20+**, only for the legacy app and a few build scripts.

## Run it locally

A throwaway WordPress with the theme, both plugins and realistic content:

```bash
cp dev.db .local/data/dev.db                      # a copy of the old app's database, for the event import
docker compose -f docker-compose.local.yml up -d
bash scripts/local/seed-wordpress.sh              # first run only
```

- **Addresses:** the site is at `http://$DEV_HOST:8088` (`DEV_HOST` defaults to `develop.lan`;
  set `DEV_HOST=localhost` if that's how you reach it). It takes its address from each request,
  so it also works behind an https reverse proxy.
- **Logins:** `/wp-admin`. The admin's password is in `.local/wp-admin-password`; there's also a
  Fort editor account, `fortedit`, with its password in `.local/wp-editor-password`.
- **Nothing reaches production.** Slack runs in dry-run, Mailchimp only ever makes drafts, and no
  keys are set unless you add your own to `.local/wp-secrets.env` (git-ignored).
- **wp-cli:** `docker compose -f docker-compose.local.yml run --rm -T wpcli wp <command>`
- **Optional profiles:**
  - `--profile stats` adds a local Postgres and PostgREST that stand in for Supabase.
    `bash scripts/local/seed-stats-db.sh` fills them with a read-only copy of the live data; it
    needs a read-only database login in `STATS_ENV_FILE`.
  - `--profile legacy` runs the old Node app on port 3002 (admin password `test123`).
- **Tear down** (keeps nothing): `docker compose -f docker-compose.local.yml down -v`

`.local/` holds the local databases, passwords and keys. It's git-ignored; keep it that way.

## Tests

```bash
# The plugins' pure PHP (dates, newsletter rendering, calendar files, stats payloads). No WordPress needed.
docker run --rm -v "$PWD/wordpress-plugin/fort-weekly":/p -w /p php:8.3.36-cli php tests/run.php
docker run --rm -v "$PWD/wordpress-plugin/fort-stats":/p -w /p php:8.3.36-cli php tests/run.php

# The style previews: rebuilds them, lints the email CSS and checks text contrast (4.5:1)
docker run --rm -v "$PWD":/p -w /p node:22-bookworm-slim node scripts/build-style-previews.mjs

# The legacy Node app
npm test             # unit tests
npm run test:e2e     # Playwright end-to-end
```

The code that touches WordPress is checked on the local site. Fort Stats also has a parity script,
`scripts/local/stats-parity.mjs`, which compares its JSON with the Flask stats API's.

## Build and deploy

```bash
scripts/build-plugin-zip.sh    # → dist/fort-weekly.zip (with the email CSS inliner vendored) and dist/fort-stats.zip
scripts/build-theme-zip.sh     # → dist/fort-theme.zip
```

Upload them in wp-admin (Plugins → Add New → Upload, Appearance → Themes → Add New → Upload). The
zips leave out tests and dev files. Each plugin's README lists the `wp-config.php` constants it
reads and its switch-over steps.

The legacy app deploys with `scripts/deploy.sh` (a Docker image shipped to the VPS); see
[`docs/DEPLOY.md`](docs/DEPLOY.md).

## Secrets and personal data

This repository is public.

- **Secrets never go in the repo.** Production keys (Slack, Mailchimp, Groq, Supabase anon,
  GloomSchedule) live in `wp-config.php` constants. The legacy app reads environment variables.
  Locally they go in `.local/` (git-ignored).
- **Member data never goes in the repo.** That covers WordPress exports, database files, the FNG
  CSV and the old app's export: they hold members' emails and phone numbers. `.gitignore` covers
  the usual names; check `git status` before committing anyway.
- **Scan before every push:**

  ```bash
  docker run --rm -v "$PWD":/repo:ro zricethezav/gitleaks:v8.21.2 git /repo --log-opts="--all" --redact
  ```

  The one known hit, the local test stack's anon key in `docker-compose.local.yml`, is listed in
  `.gitleaksignore`.
- **Mailchimp:** nothing in this code sends a campaign. The plugin creates or updates a draft and
  refuses Mailchimp's send, schedule and test endpoints. People send from Mailchimp.
- **Found a security problem?** Please don't open a public issue. Contact the site admins
  through [f3thefort.com](https://f3thefort.com).

## Conventions

- **Plugin layout:** pure functions (no WordPress calls) go in each plugin's `includes/pure/` and
  get unit tests. WordPress glue goes in `includes/`.
- **Escaping:** escape on output (`esc_html`, `esc_attr`, `esc_url`). The newsletter renderer
  uses `fortw_h()`.
- **Admin actions:** every one checks a nonce and a capability.
- **Times** are stored in F3's 24-hour form (`0530`, `1730`) in the region's timezone
  (`FORT_WEEKLY_TZ`, default America/New_York).
- **Newsletter CSS** lives in `wordpress-plugin/fort-weekly/templates/newsletter-agenda.html` and
  is inlined for email. Gmail drops web fonts and some CSS, so check it there.
