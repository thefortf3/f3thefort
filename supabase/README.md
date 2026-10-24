# Supabase: where the stats come from

The database behind the **Fort Stats** plugin (`wordpress-plugin/fort-stats/`). F3 Nation's
workout data is copied into a Supabase Postgres every night, and the plugin reads it over HTTPS.

```
F3 Nation ──▶ BigQuery (f3data.analytics.*) ──▶ sync.gs (Apps Script, nightly) ──▶ Supabase ──HTTPS──▶ Fort Stats (PHP)
                event_info, attendance_info       service_role key                  event_fact          anon key, stats_api_* only
                                                                                    attendance_fact
                                                                                    ao_dim, sync_state
```

No Python is involved. These files came from the private stats repo (`analytics-sync/`, branch
`feature/backblast-api`, 2026-10-24); this folder is their home now. The Flask stats site and its
Slack jobs stay in that repo and retire with the VPS.

## Files

| File | What it is | Run |
|---|---|---|
| `supabase-setup.sql` | The tables and their row-level security. Idempotent. | Once, then after schema changes |
| `stats-api.sql` | The read-only `stats_api_*` functions the plugin calls, and who may call them. Safe to re-run. | Once, then whenever it changes |
| `ao_east_west_seed.sql` | Each AO's East/West division. F3 Nation's data doesn't have it, and the sync never overwrites it. | Once, then when an AO is added |
| `sync.gs` | The Google Apps Script that loads BigQuery into Supabase. Its header and the setup below explain it. | Nightly trigger |

Run the SQL files in the Supabase SQL editor. They change only what they say they do. The sync's
header comments still mention stats.f3thefort.com: that was the site it was first written for.

## Who can read what

- **The plugin** calls only the `stats_api_*` functions, with the **anon key** (in `wp-config.php`
  as `FORT_STATS_ANON_KEY`). They're read-only, and `stats-api.sql` revokes them from everyone
  else.
- **Reads are public by design.** RLS lets anon read `event_fact`, `attendance_fact` and
  `ao_dim`: the same workouts, PAX names and counts the stats pages show. Everything else is
  denied by default.
- **The sync** writes with the **service_role** key, which bypasses RLS. That key lives only in
  the Apps Script's `CONFIG` in Google. It is never committed (the file has a placeholder) and
  never goes to WordPress.

## Setting up the sync

1. **BigQuery access:** use a Google account that can query the `f3data` project (the F3 Nation
   tech team grants this). In the Apps Script editor: **Services (+) → BigQuery API → Add**.
2. **Schema:** run `supabase-setup.sql`, then `stats-api.sql`.
3. **Script:** make a new project at [script.google.com](https://script.google.com), paste
   `sync.gs` in and fill in its `CONFIG` block: `SUPABASE_URL`, `SUPABASE_KEY` (the service_role
   key, from Settings → API) and `REGION_ID` (`25263`, F3 The Fort).
4. **First load:** run `fullResync()` and authorize when prompted. It takes 1–2 minutes and loads
   about 9k workouts and 70k attendance rows.
5. **Divisions:** run `ao_east_west_seed.sql`.
6. **Nightly trigger:** Triggers (the clock icon) → Add Trigger → `syncDaily`, time-driven, day
   timer, 2–3am.

`syncDaily()` re-pulls the last 120 days, so it picks up late backblasts and edits.
`fullResync()` reloads everything. Run it after a schema change, or every few weeks to drop
workouts that were deleted upstream.

## Trying it locally

`docker-compose.local.yml`'s `stats` profile runs Postgres and PostgREST as a stand-in for
Supabase. `scripts/local/seed-stats-db.sh` loads these files into it, with a read-only copy of
the live data.
