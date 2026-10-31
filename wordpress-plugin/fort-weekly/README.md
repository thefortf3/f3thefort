# Fort Weekly (WordPress plugin)

The Fort's events, approvals, region info and **The Fort Weekly** newsletter, inside the
f3thefort.com WordPress. It replaces the separate newsletter app (`server.js` in this repo):

- **PAX submit** an event on the site's `/submit/` page.
- **Editors approve** it in wp-admin.
- It appears **on the site right away**, then **in each newsletter** until its dates have passed.

It works with the **Fort** theme (`wordpress-theme/fort/`), which handles the presentation. The
plugin owns the data, so switching themes never loses events. Workouts, backblasts and FNG numbers
come from the **Fort Stats** plugin (`wordpress-plugin/fort-stats/`).

## What's in wp-admin

All of it is under **Fort Weekly**:

| Screen | What it's for |
|---|---|
| **Events** | One row per event, sorted by next date. Views: **Needs approval** (with a count on the menu), Upcoming, Held from newsletter, Past, Rejected, Archived, Everything. Filter by tag or by whether it has a flyer; search also matches the Q and location. Row actions: Approve, Reject (with a reason), Feature, Hold, Archive / Restore. |
| **Edit event** | Title and description; flyer (the featured image); tags; **Dates** (any number); **Details** (Q, where, sign-up link, video); **Newsletter** (summary, "write one for me", featured, hold); pre-blast; who submitted it. **Publish = approve.** |
| **Tags** | What's Hot, I2, Weekly… each with a colour and an order. An event shows its first tag. |
| **Desk of the Nan'tan** | The note at the top of the newsletter (heading, from, text, optional image). |
| **Shovel flags & VQs** | This week's shovel flags and VQs, for the newsletter's region table. |
| **Region** | Every week (Three F's), SLT, helpful links and the FNG goal. |
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
| `FORT_MAILCHIMP_FROM_NAME`, `FORT_MAILCHIMP_FROM_EMAIL` | Draft's sender | "The Fort Weekly", newsletter@f3thefort.com |
| `FORT_GROQ_API_KEY` | "Write one for me" summaries | Button disabled |
| `FORT_SUBMITTER_EMAILS` (`true`) | Emailing submitters when their event (or their change) is approved | Logs what it would have sent |
| `FORT_EMAIL_FROM` | Those emails' sender, e.g. `'The Fort Weekly <newsletter@f3thefort.com>'` | WordPress's default sender |
| `FORT_CLIENT_IP_HEADER` | Per-visitor submit limit behind a proxy/CDN (e.g. `'HTTP_CF_CONNECTING_IP'`) | Uses the connecting address |
| `FORT_WEEKLY_TZ` | What "today" is | `America/New_York` |

**Mailchimp is draft-only.** The plugin creates or updates the coming Sunday's campaign as a draft,
named like the old app named them ("October 25, 2026"). It never sends, schedules or test-sends,
and its request helper refuses every Mailchimp `/actions/` endpoint. A campaign that is already
scheduled or sent in Mailchimp is left alone. Review, schedule and send in Mailchimp.

## Times and "Add to calendar"

- **Times are stored in F3's 24-hour form** (`0530`, `1730`), whatever was typed: "6:30am",
  "6-7pm" (1800–1900), "17:30", "0900 Hours (Race Begins)". The submit form converts them as
  they're typed and says so under the boxes; the server converts again on every save
  (`fortw_normalize_occurrences()`), and events saved before this were converted once. A time
  that can't be read ("TBD") is kept as typed, and the form warns about it.
- **Add to calendar:** each event page has *iPhone · Outlook* (`/events/<slug>/?calendar=ics`,
  every upcoming date) and *Google · Android* (its next date). The newsletter's "Add to calendar"
  links go to those buttons. No time: an all-day event; no end: an hour.

## Submitters editing their events

Every event sent through the form gets a **private edit link** (`/submit/?edit=…`). It shows on
the thank-you page, and it's in the "your event is live" email if they gave an address. The link
opens the form filled in with the event's current details.

- **Not approved yet:** an edit simply updates the submission.
- **Already live:** the edit becomes a **proposed change** in Needs approval, labelled "Change to
  live event". The site and newsletter keep the current version until an editor approves it.
  - The change's screen shows what's live now next to what's proposed.
  - **Approve change** (or Publish) copies it onto the live event. Reject leaves the live event
    as it is.
  - A second edit replaces a change that's still waiting.
- **Limits:** links stop working a month after the event's last date. Edits are limited to 10 an
  hour per event.
- **Resetting:** editors can see, copy or reset a link in the event's "Submitted by" box. Resetting
  stops the old link working.

**Emails:** the submitter gets one when the event is approved, and again when a change is. Nothing
is sent unless `FORT_SUBMITTER_EMAILS` is `true`. On HostGator, set up an SMTP plugin (e.g.
WP Mail SMTP with a real mailbox) first, or WordPress's mail may land in spam.

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
   - **It works in steps.** Copying flyers is slow on shared hosting, so the screen works for about
     20 seconds per page load and then moves on by itself; leave it open until it says the import
     is finished. If a page dies anyway (a host time limit), open Fort Weekly → Import again and
     press **Continue**: nothing is done twice, and an image cut off part-way gets its missing sizes
     made rather than being copied again.
   - **Running it again** only adds events that aren't here yet, so edits made in WordPress
     survive. Tick "Overwrite events…" (`--update-existing`) to replace them from the file.

## The site's old posts (backblasts and pre-blasts)

The ~11,800 posts from 2013 on are shown in one tidy format, the same as the backblasts from the
stats API: when, AO, Q, PAX (with FNGs), then the write-up with Slackblast's sections
(Warm-up, The Thang, Mary, COT…) as headings, without the old inline colours.

- The plugin reads each post's `qic` / `workout_date` / `the_pax` fields, tags (PAX) and
  categories (AOs in any spelling, topics, region-wide posts) and stores the result beside the
  post (`_fort_bb`). **The posts themselves are never changed.** Records are made on first view
  and rebuilt when a post is edited; to make them all at once, with a report:
  `wp fort-weekly convert-posts` (add `--dry-run` to only count).
- Slackblast keeps working: the `qic` and `workout_date` REST fields it posts with (registered
  by the previous theme) are registered by the plugin.
- Rehearse the switch on a local copy of the live site with
  `bash scripts/local/rehearse-live-copy.sh f3thefort.WordPress.<date>.xml` (an export from
  Tools → Export; it holds members' emails, so it stays out of git).

## Building

```
scripts/build-plugin-zip.sh    # → dist/fort-weekly.zip (with the email CSS inliner vendored)
scripts/build-theme-zip.sh     # → dist/fort-theme.zip
```

Upload both under Plugins → Add New → Upload, and Appearance → Themes → Add New → Upload. The
plugin and theme need PHP 8.3, and should only run on **PHP 8.3.36 or newer** (earlier 8.3
releases have a known security hole). f3thefort.com runs WordPress 7.1.3; the local test sites use
the same (`wordpress:7-php8.3-apache`, PHP 8.3.36).

## Tests

- **Unit tests,** for the pure date, agenda, public-shape, Slack and newsletter functions. They
  run without WordPress:

  ```
  docker run --rm -v "$PWD/wordpress-plugin/fort-weekly":/p -w /p php:8.3.36-cli php tests/run.php
  ```

- **Local site:** `docker-compose.local.yml` and `scripts/local/seed-wordpress.sh` build a
  throwaway WordPress with the theme, the plugin, sample posts, and the events imported from a
  copy of `dev.db`.
- **Ported code matches the old app:**
  - the PHP data functions return the same arrays as the old app's `/api/public/*`;
  - the PHP newsletter renderer produces byte-identical HTML to the app's `renderAgenda` from the
    same export.

## Decided

- **Old backblast URLs** (2026-10-22): no special handling. The Backblasts page and
  `/backblasts/<id>/` pages (stats data) are the backblasts; the stats database's missing
  write-ups and titles were filled from the site's posts (stats repo,
  `analytics-sync/backfill_wordpress.py`). The old posts stay on the site and still display.

## Switching over (each step with the site owner's go-ahead)

1. Set f3thefort.com to PHP 8.3 in HostGator's cPanel and check Tools → Site Health shows
   **8.3.36 or newer** (it was 8.2 on 2026-10-20). Check that backups cover the database
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
