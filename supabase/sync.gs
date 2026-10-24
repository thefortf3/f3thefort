// ============================================================
// F3 The Fort — Analytics Sync (Google Apps Script)
// ============================================================
// Forked from F3-Nation/Website-Widgets/Analytics/sync.gs and reshaped for the
// stats.f3thefort.com site: it loads BigQuery into FACT tables, not
// pre-aggregates. The site does its own slicing in SQL.
//
//   BigQuery (f3data.analytics.*)  ->  this script  ->  Supabase  ->  stats site
//
// SETUP
//   1. Create / open a Google Apps Script project (script.google.com) on an
//      account that can query the `f3data` BigQuery project.
//   2. Editor -> Services (+) -> add "BigQuery API".
//   3. Run analytics-sync/supabase-setup.sql in the Supabase SQL editor.
//   4. Paste this file in, fill CONFIG below.
//   5. Run fullResync() once (Authorize when prompted). ~1-2 min.
//   6. Run analytics-sync/ao_east_west_seed.sql in Supabase.
//   7. Triggers (clock icon) -> add: function syncDaily, time-driven, day timer,
//      2-3am. Turn OFF any trigger from the old sync.
// ============================================================

// ── CONFIG ──────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://rckremjyedzcqwutcnle.supabase.co'; // Project URL
const SUPABASE_KEY = 'YOUR_SERVICE_ROLE_KEY';                    // Settings -> API -> service_role (secret)
const BQ_PROJECT   = 'f3data';                                   // BigQuery project to run jobs in
const REGION_ID    = 25263;                                      // F3 The Fort region orgId
const ACTIVE_AO_MONTHS = 18;                                     // AO counts as active if it ran within this many months
const DAILY_WINDOW_DAYS = 120;                                   // daily sync re-pulls this trailing window (catches late backblasts)
// ── END CONFIG ──────────────────────────────────────────────────────────


// ============================================================
// ENTRY POINTS
// ============================================================

/** Daily trigger target. Fast — only re-pulls a trailing window. */
function syncDaily() {
  Logger.log('=== F3 sync (daily) starting ===');
  const t0 = Date.now();
  const since = isoDaysAgo(DAILY_WINDOW_DAYS);
  const ev = syncEventFact(since);
  const at = syncAttendanceFact(since);
  syncAoDim();
  setSyncState('last_daily_sync', new Date().toISOString());
  setSyncState('daily_window_start', since);
  Logger.log(`=== daily sync done in ${secs(t0)}s (events +${ev}, attendance +${at}) ===`);
}

/** Full rebuild. Run after schema changes or every few weeks to clear drift. */
function fullResync() {
  Logger.log('=== F3 sync (FULL) starting ===');
  const t0 = Date.now();
  supabaseDeleteAll('attendance_fact', 'event_instance_id');
  supabaseDeleteAll('event_fact', 'event_instance_id');
  const ev = syncEventFact(null);
  const at = syncAttendanceFact(null);
  syncAoDim();
  setSyncState('last_full_sync', new Date().toISOString());
  setSyncState('event_fact_rows', String(ev));
  setSyncState('attendance_fact_rows', String(at));
  Logger.log(`=== full sync done in ${secs(t0)}s (events ${ev}, attendance ${at}) ===`);
}


// ============================================================
// SYNC FUNCTIONS
// ============================================================

/**
 * event_fact — one row per workout in the region.
 * @param {?string} sinceIso  'YYYY-MM-DD' to limit to recent workouts, or null for all.
 * @return {number} rows upserted
 */
function syncEventFact(sinceIso) {
  Logger.log('syncEventFact' + (sinceIso ? ` (since ${sinceIso})` : ' (full)'));
  const where = [`region_org_id = ${REGION_ID}`, 'start_date IS NOT NULL'];
  if (sinceIso) where.push(`start_date >= '${sinceIso}'`);

  // GROUP BY id collapses any duplicate event_info rows for the same event
  // (BigQuery can carry more than one) down to a single fact row.
  const rows = bqQuery(`
    SELECT
      id                          AS event_instance_id,
      ANY_VALUE(ao_org_id)        AS ao_org_id,
      ANY_VALUE(ao_name)          AS ao_name,
      ANY_VALUE(start_date)       AS start_date,
      ANY_VALUE(pax_count)        AS pax_count,
      ANY_VALUE(fng_count)        AS fng_count,
      ANY_VALUE(region_org_id)    AS region_org_id,
      ANY_VALUE(location_name)    AS location_name,
      ANY_VALUE(location_latitude)  AS location_latitude,
      ANY_VALUE(location_longitude) AS location_longitude,
      ANY_VALUE(region_name)      AS region_name,
      ANY_VALUE(name)             AS title,          -- the backblast's title once posted
      ANY_VALUE(backblast)        AS backblast,      -- its full text
      ANY_VALUE(start_time)       AS start_time,
      ANY_VALUE(ARRAY_TO_STRING(all_types, '|')) AS workout_types
    FROM \`f3data.analytics.event_info\`
    WHERE ${where.join(' AND ')}
    GROUP BY id
  `);

  const now = new Date().toISOString();
  let payload = dedupeBy(rows.map(r => ({
    event_instance_id:  toInt(r.event_instance_id),
    ao_org_id:          toInt(r.ao_org_id),
    ao_name:            r.ao_name || null,
    start_date:         r.start_date || null,
    pax_count:          toInt(r.pax_count),
    fng_count:          toInt(r.fng_count),
    region_org_id:      toInt(r.region_org_id),
    location_name:      r.location_name || null,
    location_latitude:  toFloat(r.location_latitude),
    location_longitude: toFloat(r.location_longitude),
    region_name:        r.region_name || null,
    title:              r.title ? String(r.title).trim() : null,
    backblast:          r.backblast || null,
    start_time:         r.start_time || null,
    workout_types:      r.workout_types ? String(r.workout_types).split('|').filter(String) : [],
    synced_at:          now,
  })), r => r.event_instance_id);
  payload = remapAoOrgId(payload, getAoAliases());

  supabaseUpsert('event_fact', payload);
  Logger.log(`  event_fact: ${payload.length} rows`);
  return payload.length;
}

/**
 * attendance_fact — one row per PAX per workout. Backs every leaderboard/report.
 * @param {?string} sinceIso  'YYYY-MM-DD' or null for all history.
 * @return {number} rows upserted
 */
function syncAttendanceFact(sinceIso) {
  Logger.log('syncAttendanceFact' + (sinceIso ? ` (since ${sinceIso})` : ' (full)'));
  const evWhere = [`region_org_id = ${REGION_ID}`, 'start_date IS NOT NULL'];
  if (sinceIso) evWhere.push(`start_date >= '${sinceIso}'`);

  // Dedupe event_info to one row per id first (ev), then GROUP BY
  // (event_instance_id, pax_id) so the fact table gets exactly one row per
  // PAX per workout — otherwise a fan-out on the join, or a duplicate
  // attendance_info row, breaks the ON CONFLICT upsert.
  const rows = bqQuery(`
    WITH ev AS (
      SELECT
        id,
        ANY_VALUE(ao_org_id)  AS ao_org_id,
        ANY_VALUE(ao_name)    AS ao_name,
        ANY_VALUE(start_date) AS start_date
      FROM \`f3data.analytics.event_info\`
      WHERE ${evWhere.join(' AND ')}
      GROUP BY id
    )
    SELECT
      a.event_instance_id,
      a.user_id                 AS pax_id,
      ANY_VALUE(a.f3_name)      AS handle,
      ANY_VALUE(a.avatar_url)   AS avatar_url,
      ANY_VALUE(ev.ao_org_id)   AS ao_org_id,
      ANY_VALUE(ev.ao_name)     AS ao_name,
      ANY_VALUE(ev.start_date)  AS start_date,
      MAX(a.q_ind)              AS q_ind,
      MAX(a.coq_ind)            AS coq_ind,
      ANY_VALUE(a.user_statusa) AS user_status
    FROM \`f3data.analytics.attendance_info\` a
    JOIN ev ON ev.id = a.event_instance_id
    GROUP BY a.event_instance_id, a.user_id
  `);

  const now = new Date().toISOString();
  const mapped = rows.map(r => ({
    event_instance_id: toInt(r.event_instance_id),
    pax_id:            toInt(r.pax_id),
    handle:            cleanHandle(r.handle),
    avatar_url:        r.avatar_url || null,
    ao_org_id:         toInt(r.ao_org_id),
    ao_name:           r.ao_name || null,
    start_date:        r.start_date || null,
    q_ind:             toInt(r.q_ind)   || 0,
    coq_ind:           toInt(r.coq_ind) || 0,
    user_status:       r.user_status || null,
    synced_at:         now,
  }));
  let payload = applyPaxAliases(mapped, getPaxAliases());
  payload = remapAoOrgId(payload, getAoAliases());

  supabaseUpsert('attendance_fact', payload);
  Logger.log(`  attendance_fact: ${payload.length} rows`);
  return payload.length;
}

/**
 * ao_dim — one row per AO, with is_active derived from recency.
 * Does NOT write east_west (hand-maintained; see ao_east_west_seed.sql).
 */
function syncAoDim() {
  Logger.log('syncAoDim');
  const rows = bqQuery(`
    SELECT
      e.ao_org_id,
      ANY_VALUE(e.ao_name)  AS ao_name,
      MAX(e.start_date)      AS last_workout
    FROM \`f3data.analytics.event_info\` e
    WHERE e.region_org_id = ${REGION_ID} AND e.ao_org_id IS NOT NULL
    GROUP BY e.ao_org_id
  `);

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - ACTIVE_AO_MONTHS);
  const now = new Date().toISOString();

  // Merge alias AOs into their canonical row (e.g. a duplicate org_id for the
  // same physical AO), keeping the latest last_workout of the two so
  // is_active stays accurate.
  const merged = applyAoAliases(rows, getAoAliases());

  // Omit east_west from the payload: PostgREST merge-duplicates only updates
  // the columns present, so the hand-set division survives every sync.
  supabaseUpsert('ao_dim', merged.map(r => ({
    ao_org_id:  toInt(r.ao_org_id),
    ao_name:    r.ao_name || null,
    is_active:  r.last_workout ? (new Date(r.last_workout) >= cutoff) : false,
    in_region:  true,
    synced_at:  now,
  })));
  Logger.log(`  ao_dim: ${merged.length} AOs`);
}


// ============================================================
// BIGQUERY
// ============================================================

/**
 * Run a Standard-SQL BigQuery query and return every row as a plain object.
 *
 * Waits for the job to finish and pages through large result sets. Every
 * follow-up call passes the job's own projectId + location from the returned
 * jobReference — without the location, getQueryResults 404s ("Not found: Job")
 * whenever f3data's jobs land outside the US multi-region.
 */
function bqQuery(sql) {
  const first = BigQuery.Jobs.query(
    { query: sql, useLegacySql: false, timeoutMs: 55000, maxResults: 20000 },
    BQ_PROJECT
  );
  const ref       = first.jobReference || {};
  const projectId = ref.projectId || BQ_PROJECT;
  const jobId     = ref.jobId;
  const location  = ref.location;   // undefined for US multi-region — fine

  const args = (pageToken) => {
    const a = { timeoutMs: 55000, maxResults: 20000 };
    if (location)  a.location  = location;
    if (pageToken) a.pageToken = pageToken;
    return a;
  };

  const fields = [];
  const out    = [];
  const collect = (r) => {
    if (!fields.length && r.schema && r.schema.fields) {
      r.schema.fields.forEach(f => fields.push(f.name));
    }
    (r.rows || []).forEach(row => {
      const o = {};
      fields.forEach((f, j) => { o[f] = (row.f[j] && row.f[j].v !== undefined) ? row.f[j].v : null; });
      out.push(o);
    });
  };

  // Jobs.query may return before the job completes — poll getQueryResults.
  let res = first, waited = 0;
  while (!res.jobComplete) {
    if (waited > 240000) throw new Error(`BigQuery job ${jobId} did not finish within 4 min`);
    Utilities.sleep(3000); waited += 3000;
    res = BigQuery.Jobs.getQueryResults(projectId, jobId, args());
  }

  collect(res);
  let pageToken = res.pageToken;
  while (pageToken) {
    res = BigQuery.Jobs.getQueryResults(projectId, jobId, args(pageToken));
    collect(res);
    pageToken = res.pageToken;
  }
  return out;
}


// ============================================================
// SUPABASE (PostgREST)
// ============================================================

/** Upsert rows into a table in batches. Relies on the table's PK for conflict. */
function supabaseUpsert(table, rows, batchSize) {
  batchSize = batchSize || 1000;
  if (!rows.length) { Logger.log(`  ${table}: nothing to upsert`); return; }
  for (let i = 0; i < rows.length; i += batchSize) {
    const resp = UrlFetchApp.fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'post',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      payload: JSON.stringify(rows.slice(i, i + batchSize)),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(`${table} upsert batch ${Math.floor(i / batchSize) + 1} -> HTTP ${code}: ${resp.getContentText().slice(0, 300)}`);
    }
    Utilities.sleep(200);
  }
  Logger.log(`  ${table}: upserted ${rows.length} rows`);
}

/** Delete every row (full-resync helper). idCol must be a numeric PK column. */
function supabaseDeleteAll(table, idCol) {
  const resp = UrlFetchApp.fetch(`${SUPABASE_URL}/rest/v1/${table}?${idCol}=gte.0`, {
    method: 'delete',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer':        'return=minimal',
    },
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`${table} delete-all -> HTTP ${code}: ${resp.getContentText().slice(0, 300)}`);
  }
  Logger.log(`  ${table}: cleared`);
}

/** Upsert a single key/value into sync_state. */
function setSyncState(key, value) {
  UrlFetchApp.fetch(`${SUPABASE_URL}/rest/v1/sync_state`, {
    method: 'post',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates,return=minimal',
    },
    payload: JSON.stringify([{ key: key, value: value, updated_at: new Date().toISOString() }]),
    muteHttpExceptions: true,
  });
}


// ============================================================
// UTILITIES
// ============================================================

/** "Deflated (Site Q)" -> "Deflated" */
function cleanHandle(handle) {
  if (!handle) return null;
  return handle.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*-\s*\S+$/, '').trim() || null;
}

function toInt(v)   { const n = parseInt(v, 10);  return isNaN(n) ? null : n; }
function toFloat(v) { const n = parseFloat(v);    return isNaN(n) ? null : n; }

/**
 * Last-write-wins dedupe by a key function. Belt-and-suspenders on top of the
 * GROUP BY in the queries — a single batch must never carry a PK twice or the
 * Postgres upsert fails with "cannot affect row a second time".
 */
function dedupeBy(rows, keyFn) {
  const seen = {};
  rows.forEach(r => { seen[keyFn(r)] = r; });
  return Object.keys(seen).map(k => seen[k]);
}

/**
 * pax_aliases maps a duplicate F3 Nation registration (same real person, two
 * accounts) to one canonical pax_id — e.g. someone who re-registered and got
 * a new user_id. Hand-maintained in Supabase (see analytics-sync/README.md);
 * this sync never writes it, only reads it.
 */
function getPaxAliases() {
  const resp = UrlFetchApp.fetch(
    `${SUPABASE_URL}/rest/v1/pax_aliases?select=alias_pax_id,canonical_pax_id`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, muteHttpExceptions: true }
  );
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log(`  pax_aliases: fetch failed (HTTP ${code}), continuing with no aliases`);
    return {};
  }
  const map = {};
  JSON.parse(resp.getContentText()).forEach(r => {
    map[toInt(r.alias_pax_id)] = toInt(r.canonical_pax_id);
  });
  return map;
}

/**
 * Remap alias pax_ids to their canonical id, then merge any rows that now
 * collide on (event_instance_id, pax_id) — e.g. both accounts checked into
 * the same workout — taking the max of q_ind/coq_ind so Q credit from either
 * account survives. A no-op pass-through dedupe when aliasMap is empty.
 */
function applyPaxAliases(rows, aliasMap) {
  const merged = {};
  rows.forEach(r => {
    const canon = aliasMap[r.pax_id];
    if (canon) r.pax_id = canon;
    const key = `${r.event_instance_id}|${r.pax_id}`;
    const existing = merged[key];
    if (!existing) {
      merged[key] = r;
    } else {
      existing.q_ind   = Math.max(existing.q_ind, r.q_ind);
      existing.coq_ind = Math.max(existing.coq_ind, r.coq_ind);
    }
  });
  return Object.keys(merged).map(k => merged[k]);
}

/**
 * ao_aliases maps a duplicate AO org_id (same physical AO, e.g. a re-created
 * F3 Nation org record) to one canonical ao_org_id. Hand-maintained in
 * Supabase; this sync never writes it, only reads it.
 */
function getAoAliases() {
  const resp = UrlFetchApp.fetch(
    `${SUPABASE_URL}/rest/v1/ao_aliases?select=alias_ao_org_id,canonical_ao_org_id`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, muteHttpExceptions: true }
  );
  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log(`  ao_aliases: fetch failed (HTTP ${code}), continuing with no aliases`);
    return {};
  }
  const map = {};
  JSON.parse(resp.getContentText()).forEach(r => {
    map[toInt(r.alias_ao_org_id)] = toInt(r.canonical_ao_org_id);
  });
  return map;
}

/** Remap ao_org_id in place for tables where it isn't part of the PK (event_fact, attendance_fact). */
function remapAoOrgId(rows, aliasMap) {
  rows.forEach(r => {
    const canon = aliasMap[r.ao_org_id];
    if (canon) r.ao_org_id = canon;
  });
  return rows;
}

/**
 * Like remapAoOrgId, but for ao_dim where ao_org_id IS the PK — an alias row
 * must be merged into its canonical row, not just relabeled, or the upsert
 * would try to write the same PK twice. Keeps the more recent last_workout.
 */
function applyAoAliases(rows, aliasMap) {
  const merged = {};
  rows.forEach(r => {
    const canon = aliasMap[toInt(r.ao_org_id)];
    const id = canon || toInt(r.ao_org_id);
    const key = String(id);
    const existing = merged[key];
    if (!existing) {
      merged[key] = { ao_org_id: id, ao_name: r.ao_name, last_workout: r.last_workout };
    } else if (r.last_workout && (!existing.last_workout || r.last_workout > existing.last_workout)) {
      existing.last_workout = r.last_workout;
    }
  });
  return Object.keys(merged).map(k => merged[k]);
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function secs(t0) { return Math.round((Date.now() - t0) / 1000); }
