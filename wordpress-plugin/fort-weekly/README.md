# Fort Weekly (WordPress plugin)

The Fort's events, approvals, region info and **The Fort Weekly** newsletter, inside the
f3thefort.com WordPress. It replaces the separate newsletter app (`server.js` in this repo):

- **PAX submit** an event on the site's `/submit/` page.
- **Editors approve** it in wp-admin.
- It appears **on the site right away**, then **in each newsletter** until its dates have passed.

It works with the **Fort** theme (`wordpress-theme/fort/`), which handles the presentation. The
plugin owns the data, so switching themes never loses events. Workouts, backblasts and FNG numbers
still come from the stats site (stats.f3thefort.com).

## What's in wp-admin

All of it is under **Fort Weekly**:

| Screen | What it's for |
|---|---|
| **Events** | One row per event, sorted by next date. Views: **Needs approval** (with a count on the menu), Upcoming, Held from newsletter, Past, Rejected, Archived, Everything. Filter by tag or by whether it has a flyer; search also matches the Q and location. Row actions: Approve, Reject (with a reason), Feature, Hold, Archive / Restore. |
| **Edit event** | Title and description; flyer (the featured image); tags; **Dates** (any number); **Details** (Q, where, sign-up link, video); **Newsletter** (summary, "write one for me", featured, hold); pre-blast; who submitted it. **Publish = approve.** |
| **Tags** | What's Hot, I2, Weekly… each with a colour and an order. An event shows its first tag. |
| **Region** | The Nan'tan's note, FNG goal, Every week (Three F's), SLT, helpful links, shovel flags, VQs. |
| **Newsletter** | This week's issue: preview at phone and email widths, download the email-ready HTML, **save it as a Mailchimp draft**. |
| **Import** | (administrators) Bring data in from the old app. See below. |

Some rules the screens follow:

- **Featured:** only one event at a time.
- **Hold:** the event stays on the site but leaves the newsletter.
- **Archive:** replaces deleting. WordPress's trash empties itself after 30 days.

**Roles:** the plugin adds a **Fort editor** role. It can run events, tags, region info and the
newsletter, and it lands on the approval queue when it logs in. It can't touch plugins, themes,
settings or users, and it archives rather than deletes. Administrators get the same abilities, and
only administrators can import or delete. Give each approver their own account.

## Settings (`wp-config.php` only, never stored in the database)

| Constant | Needed for | Without it |
|---|---|---|
| `FORT_SLACK_BOT_TOKEN`, `FORT_SLACK_CHANNEL` | "New event needs approval" in Slack | Logs what it would have sent |
| `FORT_MAILCHIMP_API_KEY` (`…-us10`), `FORT_MAILCHIMP_LIST_ID` | Save as Mailchimp draft | Button disabled |
| `FORT_MAILCHIMP_FROM_NAME`, `FORT_MAILCHIMP_FROM_EMAIL` | Draft's sender | "The Fort Weekly", newsletter@thefort.org |
| `FORT_GROQ_API_KEY` | "Write one for me" summaries | Button disabled |
| `FORT_STATS_API` | FNG numbers | `https://stats.f3thefort.com` |
| `FORT_CLIENT_IP_HEADER` | Per-visitor submit limit behind a proxy/CDN (e.g. `'HTTP_CF_CONNECTING_IP'`) | Uses the connecting address |
| `FORT_WEEKLY_TZ` | What "today" is | `America/New_York` |

**Mailchimp is draft-only.** The plugin creates or updates the coming Sunday's campaign as a draft,
named like the old app named them ("October 25, 2026"). It never sends, schedules or test-sends,
and its request helper refuses every Mailchimp `/actions/` endpoint. A campaign that is already
scheduled or sent in Mailchimp is left alone. Review, schedule and send in Mailchimp.

## Moving the data from the old app

1. **Export,** on the server running the old app. This reads the database read-only; an older
   database is migrated in memory only.

   ```
   node scripts/export-for-wordpress.mjs --db data/news.db --out fort-weekly-export.json
   ```

   The file contains submitters' emails and phone numbers. Keep it private, and delete it once the
   import is done.
2. **Import:** Fort Weekly → Import. Upload the file, leave **Dry run** ticked, and check the
   counts. Then run it again without the dry run. The command-line equivalent is
   `wp fort-weekly import <file> [--dry-run]`.
   - **Flyers** the app hosts are copied into the media library from `https://submit.f3thefort.com`
     (or the address you enter), and description images are pointed at the copies.
   - **Running it again** only adds events that aren't here yet, so edits made in WordPress
     survive. Tick "Overwrite events…" (`--update-existing`) to replace them from the file.

## Building

```
scripts/build-plugin-zip.sh    # → dist/fort-weekly.zip (with the email CSS inliner vendored)
scripts/build-theme-zip.sh     # → dist/fort-theme.zip
```

Upload both under Plugins → Add New → Upload, and Appearance → Themes → Add New → Upload. The
plugin needs PHP 7.4 or newer; f3thefort.com runs PHP 8.2 (confirmed 2026-10-20), the same as the
local test site (`wordpress:6-php8.2-apache`).

## Tests

- **Unit tests,** for the pure date, agenda, public-shape, Slack and newsletter functions. They
  run without WordPress, on both PHP versions:

  ```
  docker run --rm -v "$PWD/wordpress-plugin/fort-weekly":/p -w /p php:7.4-cli php tests/run.php
  docker run --rm -v "$PWD/wordpress-plugin/fort-weekly":/p -w /p php:8.2-cli php tests/run.php
  ```

- **Local site:** `docker-compose.local.yml` and `scripts/local/seed-wordpress.sh` build a
  throwaway WordPress with the theme, the plugin, sample posts, and the events imported from a
  copy of `dev.db`.
- **Ported code matches the old app:**
  - the PHP data functions return the same arrays as the old app's `/api/public/*`;
  - the PHP newsletter renderer produces byte-identical HTML to the app's `renderAgenda` from the
    same export.

## Switching over (each step with the site owner's go-ahead)

1. ~~Check f3thefort.com's PHP version~~ (8.2, confirmed). Check that backups cover the database
   and `wp-content/uploads`.
2. Back up the old app's database and the WordPress site.
3. Upload the theme and the plugin; activate the plugin.
4. Add the `wp-config.php` constants you want (Slack, Mailchimp, Groq).
5. Create a Fort editor account for each approver.
6. Export from the old app; import with a dry run first.
7. Preview the Fort theme with Live Preview, then activate it.
8. Point the old app's form at `https://f3thefort.com/submit/`, or retire it.
9. Save the first Mailchimp draft and check it in Mailchimp.
10. Keep the old app running read-only as a fallback until you're happy, then retire it.
