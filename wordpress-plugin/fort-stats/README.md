# Fort Stats (WordPress plugin)

The Fort's stats site inside WordPress. It covers:

- the dashboard (leaderboards, AOs, trends, streaks, FNGs) at **/stats/**;
- the FNG challenge board at **/stats/fng-challenge/**;
- the backblast feed, archive, single backblasts and Q schedule that the Fort theme shows.

It is a new version of stats.f3thefort.com (the Flask app in the stats repo), built so no separate server is needed. The pages and data are the same.

## How it gets the data

f3thefort.com's host refuses outbound Postgres connections (ports 5432 and 6543). So the plugin reads the stats Supabase project over **HTTPS**, through Supabase's REST API:

- **Supabase functions:** each query is a read-only function, `stats_api_*`, defined in the stats repo's `analytics-sync/stats-api.sql`. They are called with the **anon key**, which can only run these functions and read what it could already read. The plugin never holds the service_role key or a database password.
- **The page logic:** `includes/pure/` is a line-for-line port of the stats repo's `web/payload.py` and `web/fng_sheet.py`. For the same data it gives the same JSON as the Flask API.
- **GloomSchedule** (the Q schedule) and the **FNG sign-up sheet** are fetched over HTTPS, as before.

**Caching:** results are cached in WordPress for an hour (the data changes once a day). The backblast feed, archive and single backblasts are cached for 15 minutes, and the schedule for 10. Text searches and archive pages past 20 aren't cached. When Supabase can't be reached, the last good copy is served.

## Setting it up

1. **In Supabase** (SQL Editor): run `analytics-sync/stats-api.sql` from the stats repo.
   - It only adds functions; no table or data changes, and the Flask app and sync are unaffected.
   - It's safe to re-run. The file's header explains how to remove the functions.
2. **In `wp-config.php`:**
   ```php
   define( 'FORT_STATS_REST_URL', 'https://<project>.supabase.co/rest/v1' );
   define( 'FORT_STATS_ANON_KEY', '<the anon / publishable key>' );   // Supabase → Settings → API
   define( 'FORT_GS_API_ENDPOINT', '<GloomSchedule API URL>' );       // as GS_API_ENDPOINT in the stats .env
   define( 'FORT_GS_API_KEY', '<GloomSchedule API key>' );            // as GS_API_KEY
   // Optional: define( 'FORT_STATS_CACHE_TTL', 3600 );                // seconds
   ```
3. **Install the plugin:** upload `dist/fort-stats.zip` (`scripts/build-plugin-zip.sh`) under Plugins → Add New → Upload, then activate it.
4. **Settings → Fort Stats:**
   - enter the FNG sheet's published CSV link and the FNG challenge's dates;
   - check that the three "set up" lines show ✓.

   "Refresh now" clears the cache.

With the plugin active, the theme reads stats from it directly, and the nav's Stats link goes to /stats/. Deactivating the plugin switches the theme back to the remote stats API (`FORT_STATS_API`).

## JSON

`/wp-json/fort-stats/v1/…` mirrors stats.f3thefort.com's `/api/…`, with the same paths, arguments and answers:

- `core`, `month/<YYYY-MM>`, `streaks`;
- `backblasts?days=&limit=`, `backblasts/summary`, `backblasts/archive?page=&per_page=&ao=&month=&type=&q=`, `backblasts/<id>`;
- `schedule?days=`, `fng`, `fng-challenge`.

These routes are public and read-only.

## Developing and checking

- **Unit tests:**
  `docker run --rm -v "$PWD/wordpress-plugin/fort-stats":/p -w /p php:8.3.36-cli php tests/run.php`
- **Local stand-in for Supabase** (`docker-compose.local.yml`, profile `stats`): Postgres with Supabase's API roles and limits, PostgREST, and the Flask app on the same data.
  ```bash
  docker compose -f docker-compose.local.yml --profile stats up -d
  bash scripts/local/seed-stats-db.sh     # read-only copy of the live data + stats-api.sql
  ```
- **Parity with the Flask app**, every endpoint, same data:
  ```bash
  node scripts/local/stats-parity.mjs
  ```
  The last run (2026-10-22) gave 52 of 56 identical and 4 differing only in the order of equal-ranked rows. The SQL has no tie-breaker, so Postgres may return ties in any order, even in the Flask app itself. None were really different.

## Not part of this plugin

The monthly Slack reports and the backblast reminders still run from the stats repo on the VPS (host cron). Before the VPS can be retired, they need a new home: a scheduled GitHub Action, the sync's Apps Script, or a PHP port.

## Switching over (each step with the site owner's go-ahead)

1. Run `stats-api.sql` in Supabase. Then check parity against the live site:
   `node scripts/local/stats-parity.mjs https://stats.f3thefort.com/api https://f3thefort.com/wp-json/fort-stats/v1`
   (after step 2).
2. Add the constants on HostGator, upload and activate Fort Stats, and check /stats/ and the theme's pages.
3. Redirect stats.f3thefort.com to https://f3thefort.com/stats/ (and `/fng-challenge` to `/stats/fng-challenge/`).
4. Move the Slack jobs (see above), then retire the VPS.
