# F3 The Fort: The Fort Weekly newsletter app

This branch is the **newsletter app that's live today** at submit.f3thefort.com: the event
submission form, the editors' admin board, and the generator for **The Fort Weekly** email.

> **Moving to WordPress.** The app is being replaced by WordPress plugins and a theme for
> f3thefort.com: the Fort Weekly and Fort Stats plugins, the Fort theme, and the Supabase stats
> pipeline. That work, and the main README, are on
> [`feature/wordpress-native`](https://github.com/thefortf3/f3thefort/tree/feature/wordpress-native).
> This branch stays as production until the switch.

## The app

- **Node 20, Express 5, SQLite** (`better-sqlite3` and Drizzle ORM), vanilla HTML/CSS/JS front
  end.
- **Code:** `server.js` holds the routes, admin auth and the newsletter generator; `lib/` holds
  Mailchimp, WordPress pre-blasts, rate limiting and HTML sanitizing. The pages are in `public/`.
- **Mailchimp:** an editor's button creates the coming Sunday's campaign and schedules it (default
  8pm, `MAILCHIMP_SEND_HOUR`). The WordPress replacement only makes drafts.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000, admin at /admin (password test123)
```

Settings come from environment variables: `ADMIN_PASSWORD` (required, so the app won't start
without one), `MAILCHIMP_*`, `WORDPRESS_*`, `GROQ_API_KEY`, `FNG_SHEET_URL`. See
`docker-compose.yml` for the full list.

## Tests

```bash
npm test             # unit tests
npm run test:e2e     # Playwright end-to-end
```

## Deploy

A Docker image shipped to the VPS by `scripts/deploy.sh`; see [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Secrets and personal data

This repository is public. Keys and passwords come only from environment variables, never from
files in the repo. The database (`*.db`) and the FNG CSV hold members' details and are
git-ignored. To report a security problem, contact the site admins through
[f3thefort.com](https://f3thefort.com) rather than opening a public issue.
