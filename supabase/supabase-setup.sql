-- ============================================================
-- F3 The Fort — stats site Supabase schema
-- ============================================================
--   BigQuery (f3data.analytics.*)  ->  Apps Script (sync.gs)  ->  Supabase  ->  stats.f3thefort.com
--
-- Run this once in the Supabase SQL editor (SQL Editor -> New Query -> paste -> Run).
-- Safe to re-run: everything is IF NOT EXISTS / idempotent.
--
-- Design: fact tables, not pre-aggregates. The site computes every slice
-- (YTD / last-30 / per-month / per-AO / Q rosters) in SQL at query time.
-- ~70k attendance rows is nothing for Postgres.
-- ============================================================


-- ── event_fact : one row per workout ────────────────────────────────
-- Source: f3data.analytics.event_info  (filtered to region_org_id)
-- Synced by: syncEventFact()

CREATE TABLE IF NOT EXISTS event_fact (
  event_instance_id   BIGINT PRIMARY KEY,
  ao_org_id           BIGINT,
  ao_name             TEXT,
  start_date          DATE NOT NULL,
  pax_count           INTEGER,
  fng_count           INTEGER,
  region_org_id       BIGINT,
  location_name       TEXT,
  location_latitude   NUMERIC(9,6),
  location_longitude  NUMERIC(9,6),
  region_name         TEXT,
  synced_at           TIMESTAMPTZ DEFAULT now()
);

-- Backblast title and text, start time and workout types (added for the f3thefort.com
-- Backblasts page; additive, safe to re-run). Filled by syncEventFact() on the next sync.
ALTER TABLE event_fact ADD COLUMN IF NOT EXISTS title         TEXT;
ALTER TABLE event_fact ADD COLUMN IF NOT EXISTS backblast     TEXT;
ALTER TABLE event_fact ADD COLUMN IF NOT EXISTS start_time    TEXT;
ALTER TABLE event_fact ADD COLUMN IF NOT EXISTS workout_types TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS event_fact_date_idx ON event_fact (start_date);
CREATE INDEX IF NOT EXISTS event_fact_ao_idx   ON event_fact (ao_org_id);


-- ── attendance_fact : one row per PAX per workout ───────────────────
-- Source: f3data.analytics.attendance_info JOIN event_info
-- Synced by: syncAttendanceFact()
-- This table backs every leaderboard, streak, and monthly report.

CREATE TABLE IF NOT EXISTS attendance_fact (
  event_instance_id   BIGINT NOT NULL,
  pax_id              BIGINT NOT NULL,
  handle              TEXT,
  avatar_url          TEXT,
  ao_org_id           BIGINT,
  ao_name             TEXT,
  start_date          DATE NOT NULL,
  q_ind               SMALLINT DEFAULT 0,
  coq_ind             SMALLINT DEFAULT 0,
  user_status         TEXT,
  synced_at           TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (event_instance_id, pax_id)
);

CREATE INDEX IF NOT EXISTS attendance_fact_pax_idx  ON attendance_fact (pax_id);
CREATE INDEX IF NOT EXISTS attendance_fact_ao_idx   ON attendance_fact (ao_org_id);
CREATE INDEX IF NOT EXISTS attendance_fact_date_idx ON attendance_fact (start_date);
CREATE INDEX IF NOT EXISTS attendance_fact_q_idx    ON attendance_fact (start_date) WHERE q_ind = 1;


-- ── ao_dim : AO metadata + region-specific east/west division ───────
-- Source: derived from event_fact by syncAoDim().
-- east_west is MANUALLY maintained (F3 Nation data has no such concept) —
-- syncAoDim() never writes that column. Seed it with ao_east_west_seed.sql.

CREATE TABLE IF NOT EXISTS ao_dim (
  ao_org_id   BIGINT PRIMARY KEY,
  ao_name     TEXT,
  is_active   BOOLEAN DEFAULT true,   -- had a workout in the last 18 months
  in_region   BOOLEAN DEFAULT true,
  east_west   TEXT,                   -- 'east' | 'west' | NULL
  synced_at   TIMESTAMPTZ DEFAULT now()
);


-- ── sync_state : bookkeeping (last sync timestamps, row counts) ─────

CREATE TABLE IF NOT EXISTS sync_state (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);


-- ── pax_overrides : admin-editable PAX bio/photo (kept from original) ─
-- Not synced. Manage via the Supabase table editor.

CREATE TABLE IF NOT EXISTS pax_overrides (
  pax_id     BIGINT PRIMARY KEY,
  bio        TEXT,
  photo_url  TEXT,
  title      TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ── pax_aliases : merge duplicate F3 Nation registrations ───────────
-- Same real person, two user_ids (e.g. re-registered, lost access). Not
-- synced; maintained by hand. sync.gs reads this on every syncAttendanceFact()
-- and remaps alias_pax_id -> canonical_pax_id before upserting, so the merge
-- survives fullResync()/syncDaily() instead of re-splitting.

CREATE TABLE IF NOT EXISTS pax_aliases (
  alias_pax_id     BIGINT PRIMARY KEY,
  canonical_pax_id BIGINT NOT NULL,
  note             TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);


-- ── ao_aliases : merge duplicate AO org_ids ─────────────────────────
-- Same physical AO, two org_ids (F3 Nation re-created the org record, or an
-- AO briefly had two parallel registrations). Not synced; maintained by hand.
-- sync.gs reads this and remaps alias_ao_org_id -> canonical_ao_org_id for
-- event_fact/attendance_fact, and merges the two ao_dim rows into one.

CREATE TABLE IF NOT EXISTS ao_aliases (
  alias_ao_org_id     BIGINT PRIMARY KEY,
  canonical_ao_org_id BIGINT NOT NULL,
  note                TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);


-- ── Slack mappings (admin-managed — used by the monthly reports) ──────
-- Not synced from BigQuery. Populated once from the old SQLite cache and
-- maintained with `python -m slack.channels` / `python -m slack.users`.

CREATE TABLE IF NOT EXISTS ao_channels (
  ao_org_id     BIGINT PRIMARY KEY,
  channel_id    TEXT NOT NULL,
  channel_name  TEXT
);

CREATE TABLE IF NOT EXISTS named_channels (
  key           TEXT PRIMARY KEY,      -- e.g. 'first_f'
  channel_id    TEXT NOT NULL,
  channel_name  TEXT
);

CREATE TABLE IF NOT EXISTS user_slack (
  user_id       BIGINT PRIMARY KEY,    -- F3 Nation user id == attendance_fact.pax_id
  slack_id      TEXT NOT NULL,
  slack_name    TEXT,
  match_method  TEXT
);


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- The stats server connects with the pooler 'postgres' role and bypasses RLS;
-- the Apps Script sync uses the service_role key, which also bypasses RLS.
-- Supabase's linter flags ANY public table with RLS off as "publicly
-- accessible" (anon key gets full read/write), so every table here gets RLS
-- turned on — the 3 fact/dim tables get an explicit public-read policy since
-- that data is already shown on stats.f3thefort.com; the admin tables
-- (Slack mappings, overrides, aliases, sync bookkeeping) get RLS with NO
-- policy, which is default-deny for the anon/authenticated roles.

ALTER TABLE event_fact      ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE ao_dim          ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='event_fact'      AND policyname='Public read') THEN
    CREATE POLICY "Public read" ON event_fact      FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='attendance_fact' AND policyname='Public read') THEN
    CREATE POLICY "Public read" ON attendance_fact FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ao_dim'          AND policyname='Public read') THEN
    CREATE POLICY "Public read" ON ao_dim          FOR SELECT USING (true);
  END IF;
END $$;

-- Admin tables: RLS on, no policy (default-deny via the public API; the
-- pooler/service_role connections above still bypass RLS entirely).
ALTER TABLE pax_overrides  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pax_aliases    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ao_aliases     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ao_channels    ENABLE ROW LEVEL SECURITY;
ALTER TABLE named_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_slack     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_state     ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- OPTIONAL: drop the old pre-aggregate tables once nothing reads them
-- ============================================================
-- The forked sync no longer populates these. Uncomment to remove them.
-- Keep pax_overrides / upcoming_events / pending_backblasts / dismissed_cases
-- if the Cold Cases / Upcoming Events WordPress plugins are still live.
--
-- DROP TABLE IF EXISTS pax_stats CASCADE;
-- DROP TABLE IF EXISTS ao_stats CASCADE;
-- DROP TABLE IF EXISTS bq_region_stats CASCADE;
-- DROP TABLE IF EXISTS pax_ao_breakdown CASCADE;
-- DROP TABLE IF EXISTS pax_activity CASCADE;
-- DROP TABLE IF EXISTS stats_leaders CASCADE;
-- DROP TABLE IF EXISTS kotter_list CASCADE;
-- DROP TABLE IF EXISTS scheduled_qs CASCADE;
-- DROP TABLE IF EXISTS travel_locations CASCADE;
