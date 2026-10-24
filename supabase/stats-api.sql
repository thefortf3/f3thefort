-- ============================================================
-- Stats API over HTTPS — read-only functions for Supabase's REST API (PostgREST)
-- ============================================================
-- For the "Fort Stats" WordPress plugin on f3thefort.com. Its host blocks outbound Postgres
-- ports, so the plugin calls these over HTTPS (POST /rest/v1/rpc/<name>) with the anon key.
--
-- One function per AttendanceDB method (db/queries.py) that web/payload.py uses, with the same
-- SQL and the same result shape: rows come back as one JSON value (an array of objects in the
-- query's order, or an object), so PostgREST's row cap doesn't apply. Optional arguments
-- default to NULL, which means "no filter", like the Python's None.
--
-- Additive and safe to re-run (CREATE OR REPLACE). Changes no table, data or existing function;
-- the Flask app and the sync don't use these. Read-only (STABLE). SECURITY DEFINER only so
-- sync_state (no public policy) can be read; each function returns just what the payloads use.
--
-- Run in the Supabase SQL editor. To remove everything:
--   SELECT 'DROP FUNCTION ' || p.oid::regprocedure || ';' FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname LIKE 'stats\_api\_%';
-- ============================================================


-- ── Overview ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION stats_api_region_name() RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT to_json(COALESCE(
    (SELECT region_name FROM event_fact WHERE region_name IS NOT NULL LIMIT 1), 'F3'));
$$;

CREATE OR REPLACE FUNCTION stats_api_sync_status() RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_object_agg(key, json_build_object('value', value, 'updated_at', updated_at)), '{}'::json)
  FROM sync_state;
$$;

-- core_payload's "available months" (the newest 24 months with any attendance).
CREATE OR REPLACE FUNCTION stats_api_available_months(p_limit int DEFAULT 24) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_agg(m ORDER BY m DESC), '[]'::json) FROM (
    SELECT DISTINCT to_char(start_date, 'YYYY-MM') AS m FROM attendance_fact
    ORDER BY m DESC LIMIT p_limit
  ) t;
$$;

CREATE OR REPLACE FUNCTION stats_api_summary(p_start date DEFAULT NULL, p_end date DEFAULT NULL) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT json_build_object(
    'workouts',   (SELECT COUNT(*) FROM event_fact
                   WHERE (p_start IS NULL OR start_date >= p_start) AND (p_end IS NULL OR start_date <= p_end)),
    'pax_posts',  (SELECT COUNT(*) FROM attendance_fact af
                   WHERE (p_start IS NULL OR af.start_date >= p_start) AND (p_end IS NULL OR af.start_date <= p_end)),
    'unique_pax', (SELECT COUNT(DISTINCT af.pax_id) FROM attendance_fact af
                   WHERE (p_start IS NULL OR af.start_date >= p_start) AND (p_end IS NULL OR af.start_date <= p_end)),
    'unique_qs',  (SELECT COUNT(DISTINCT af.pax_id) FROM attendance_fact af
                   WHERE (p_start IS NULL OR af.start_date >= p_start) AND (p_end IS NULL OR af.start_date <= p_end)
                     AND af.q_ind = 1)
  );
$$;

CREATE OR REPLACE FUNCTION stats_api_active_ao_names() RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_agg(ao_name ORDER BY ao_name), '[]'::json) FROM (
    SELECT DISTINCT ao_name FROM ao_dim
    WHERE is_active AND in_region AND ao_name IS NOT NULL
  ) t;
$$;


-- ── Leaderboards and AOs ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION stats_api_attendance_leaderboard(
  p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_top_n int DEFAULT 25) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_agg(t ORDER BY t.total_posts DESC, t.qs DESC), '[]'::json) FROM (
    SELECT
      af.pax_id                    AS user_id,
      MAX(af.handle)               AS f3_name,
      COUNT(*)                     AS total_posts,
      COALESCE(SUM(af.q_ind), 0)   AS qs,
      COALESCE(SUM(af.coq_ind), 0) AS coqs
    FROM attendance_fact af
    WHERE af.handle IS NOT NULL
      AND (p_start IS NULL OR af.start_date >= p_start) AND (p_end IS NULL OR af.start_date <= p_end)
    GROUP BY af.pax_id
    ORDER BY total_posts DESC, qs DESC
    LIMIT p_top_n
  ) t;
$$;

CREATE OR REPLACE FUNCTION stats_api_ao_breakdown(p_start date DEFAULT NULL, p_end date DEFAULT NULL) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_agg(t ORDER BY t.pax_posts DESC), '[]'::json) FROM (
    SELECT
      MIN(af.ao_org_id)                    AS ao_id,
      af.ao_name                           AS ao_name,
      COUNT(DISTINCT af.event_instance_id) AS workouts,
      COUNT(*)                             AS pax_posts,
      COUNT(DISTINCT af.pax_id)            AS unique_pax,
      ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT af.event_instance_id), 0), 1) AS avg_pax
    FROM attendance_fact af
    WHERE af.ao_name IS NOT NULL
      AND (p_start IS NULL OR af.start_date >= p_start) AND (p_end IS NULL OR af.start_date <= p_end)
    GROUP BY af.ao_name
  ) t;
$$;

CREATE OR REPLACE FUNCTION stats_api_ao_top_attendees(
  p_top_n_per_ao int DEFAULT 15, p_start date DEFAULT NULL, p_end date DEFAULT NULL) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_agg(t ORDER BY t.ao_name, t.posts DESC), '[]'::json) FROM (
    SELECT ao_id, ao_name, user_id, f3_name, posts, qs, rn FROM (
      SELECT
        MIN(af.ao_org_id)          AS ao_id,
        af.ao_name                 AS ao_name,
        af.pax_id                  AS user_id,
        MAX(af.handle)             AS f3_name,
        COUNT(*)                   AS posts,
        COALESCE(SUM(af.q_ind), 0) AS qs,
        ROW_NUMBER() OVER (PARTITION BY af.ao_name ORDER BY COUNT(*) DESC) AS rn
      FROM attendance_fact af
      WHERE af.ao_name IS NOT NULL AND af.handle IS NOT NULL
        AND (p_start IS NULL OR af.start_date >= p_start) AND (p_end IS NULL OR af.start_date <= p_end)
      GROUP BY af.ao_name, af.pax_id
    ) x
    WHERE rn <= p_top_n_per_ao
  ) t;
$$;

CREATE OR REPLACE FUNCTION stats_api_ao_most_posts_no_q(p_start date) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_agg(t), '[]'::json) FROM (
    SELECT ao_id, user_id, f3_name, posts FROM (
      SELECT
        af.ao_org_id   AS ao_id,
        af.pax_id      AS user_id,
        MAX(af.handle) AS f3_name,
        COUNT(*)       AS posts,
        ROW_NUMBER() OVER (PARTITION BY af.ao_org_id ORDER BY COUNT(*) DESC) AS rn
      FROM attendance_fact af
      WHERE af.start_date >= p_start AND af.ao_org_id IS NOT NULL AND af.handle IS NOT NULL
      GROUP BY af.ao_org_id, af.pax_id
      HAVING COALESCE(SUM(af.q_ind), 0) = 0 AND COALESCE(SUM(af.coq_ind), 0) = 0
    ) x
    WHERE rn = 1
  ) t;
$$;


-- ── Trends ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION stats_api_monthly_trend(p_start date DEFAULT NULL, p_end date DEFAULT NULL) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- FNGs are summed per workout (event_fact), not per attendance row: joining attendance first would
  -- count a workout's FNGs once for every man who posted (db/queries.py monthly_trend does that).
  SELECT COALESCE(json_agg(t ORDER BY t.month), '[]'::json) FROM (
    SELECT a.month, a.workouts, a.pax_posts, a.unique_pax, COALESCE(f.fngs, 0) AS fngs
    FROM (
      SELECT
        to_char(af.start_date, 'YYYY-MM')    AS month,
        COUNT(DISTINCT af.event_instance_id) AS workouts,
        COUNT(*)                             AS pax_posts,
        COUNT(DISTINCT af.pax_id)            AS unique_pax
      FROM attendance_fact af
      WHERE (p_start IS NULL OR af.start_date >= p_start) AND (p_end IS NULL OR af.start_date <= p_end)
      GROUP BY 1
    ) a
    LEFT JOIN (
      SELECT to_char(ef.start_date, 'YYYY-MM') AS month, SUM(COALESCE(ef.fng_count, 0)) AS fngs
      FROM event_fact ef
      WHERE (p_start IS NULL OR ef.start_date >= p_start) AND (p_end IS NULL OR ef.start_date <= p_end)
      GROUP BY 1
    ) f USING (month)
  ) t;
$$;

CREATE OR REPLACE FUNCTION stats_api_weekly_posts(p_start date DEFAULT NULL, p_end date DEFAULT NULL) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_agg(t ORDER BY t.week), '[]'::json) FROM (
    SELECT
      to_char(af.start_date, 'IYYY"-W"IW') AS week,
      COUNT(DISTINCT af.event_instance_id) AS workouts,
      COUNT(*)                             AS pax_posts
    FROM attendance_fact af
    WHERE (p_start IS NULL OR af.start_date >= p_start) AND (p_end IS NULL OR af.start_date <= p_end)
    GROUP BY 1
  ) t;
$$;

CREATE OR REPLACE FUNCTION stats_api_ao_monthly_trend(p_start date DEFAULT NULL, p_end date DEFAULT NULL) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_agg(t ORDER BY t.ao_name, t.month), '[]'::json) FROM (
    SELECT
      MIN(af.ao_org_id)                    AS ao_id,
      af.ao_name                           AS ao_name,
      to_char(af.start_date, 'YYYY-MM')    AS month,
      COUNT(DISTINCT af.event_instance_id) AS workouts,
      COUNT(*)                             AS pax_posts,
      COUNT(DISTINCT af.pax_id)            AS unique_pax
    FROM attendance_fact af
    WHERE af.ao_name IS NOT NULL
      AND (p_start IS NULL OR af.start_date >= p_start) AND (p_end IS NULL OR af.start_date <= p_end)
    GROUP BY af.ao_name, to_char(af.start_date, 'YYYY-MM')
  ) t;
$$;


-- ── Backblasts ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION stats_api_recent_workouts(
  p_start date, p_end date DEFAULT NULL, p_limit int DEFAULT 12) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_agg(t ORDER BY t.start_date DESC, t.pax_count DESC NULLS LAST), '[]'::json) FROM (
    SELECT
      ef.event_instance_id, ef.start_date, ef.ao_name, ef.location_name, ef.pax_count, ef.fng_count, ef.title,
      LEFT(ef.backblast, 1500) AS backblast,
      COALESCE(json_agg(af.handle ORDER BY af.handle) FILTER (WHERE af.q_ind = 1 AND af.handle IS NOT NULL),
               '[]'::json) AS qs
    FROM event_fact ef
    LEFT JOIN attendance_fact af ON af.event_instance_id = ef.event_instance_id
    WHERE ef.start_date >= p_start AND (p_end IS NULL OR ef.start_date <= p_end)
    GROUP BY ef.event_instance_id, ef.start_date, ef.ao_name, ef.location_name,
             ef.pax_count, ef.fng_count, ef.title, ef.backblast
    ORDER BY ef.start_date DESC, ef.pax_count DESC NULLS LAST
    LIMIT p_limit
  ) t;
$$;

-- {total, rows}: a page of backblasts filtered by AO, month (YYYY-MM), workout type and text.
CREATE OR REPLACE FUNCTION stats_api_search_backblasts(
  p_ao text DEFAULT NULL, p_month text DEFAULT NULL, p_q text DEFAULT NULL, p_type text DEFAULT NULL,
  p_limit int DEFAULT 24, p_offset int DEFAULT 0) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH f AS (
    SELECT ef.* FROM event_fact ef
    WHERE (p_ao IS NULL OR ef.ao_name = p_ao)
      AND (p_month IS NULL OR to_char(ef.start_date, 'YYYY-MM') = p_month)
      AND (p_type IS NULL OR p_type = ANY(ef.workout_types))
      AND (p_q IS NULL OR ef.title ILIKE '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
                      OR ef.backblast ILIKE '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ), page AS (
    SELECT f.event_instance_id, f.start_date, f.start_time, f.ao_name, f.location_name,
           f.pax_count, f.fng_count, f.title, LEFT(f.backblast, 1500) AS backblast, f.workout_types,
           COALESCE((SELECT json_agg(af.handle ORDER BY af.handle) FROM attendance_fact af
                     WHERE af.event_instance_id = f.event_instance_id AND af.q_ind = 1 AND af.handle IS NOT NULL),
                    '[]'::json) AS qs
    FROM f
    ORDER BY f.start_date DESC, f.start_time DESC NULLS LAST, f.event_instance_id DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM f),
    'rows',  COALESCE((SELECT json_agg(p ORDER BY p.start_date DESC, p.start_time DESC NULLS LAST, p.event_instance_id DESC)
                       FROM page p), '[]'::json)
  );
$$;

-- One workout with its full backblast, its Qs, co-Qs and everyone who posted; null if unknown.
CREATE OR REPLACE FUNCTION stats_api_backblast(p_event_instance_id bigint) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT json_build_object(
    'event_instance_id', ef.event_instance_id, 'start_date', ef.start_date, 'start_time', ef.start_time,
    'ao_name', ef.ao_name, 'location_name', ef.location_name, 'pax_count', ef.pax_count,
    'fng_count', ef.fng_count, 'title', ef.title, 'backblast', ef.backblast, 'workout_types', ef.workout_types,
    'qs',   COALESCE((SELECT json_agg(handle ORDER BY q_ind DESC, coq_ind DESC, handle) FROM attendance_fact
                      WHERE event_instance_id = ef.event_instance_id AND handle IS NOT NULL AND q_ind = 1), '[]'::json),
    'coqs', COALESCE((SELECT json_agg(handle ORDER BY q_ind DESC, coq_ind DESC, handle) FROM attendance_fact
                      WHERE event_instance_id = ef.event_instance_id AND handle IS NOT NULL
                        AND coq_ind = 1 AND q_ind IS DISTINCT FROM 1), '[]'::json),
    'pax',  COALESCE((SELECT json_agg(handle ORDER BY q_ind DESC, coq_ind DESC, handle) FROM attendance_fact
                      WHERE event_instance_id = ef.event_instance_id AND handle IS NOT NULL), '[]'::json)
  )
  FROM event_fact ef WHERE ef.event_instance_id = p_event_instance_id;
$$;

-- Choices for the Backblasts page: AOs and months with posts, and workout types.
CREATE OR REPLACE FUNCTION stats_api_backblast_filters() RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT json_build_object(
    'aos', COALESCE((SELECT json_agg(t ORDER BY t.name) FROM (
             SELECT ao_name AS name, COUNT(*) AS n FROM event_fact WHERE ao_name IS NOT NULL GROUP BY ao_name) t),
           '[]'::json),
    'months', COALESCE((SELECT json_agg(t ORDER BY t.month DESC) FROM (
             SELECT to_char(start_date, 'YYYY-MM') AS month, COUNT(*) AS n FROM event_fact GROUP BY 1) t),
           '[]'::json),
    'types', COALESCE((SELECT json_agg(t ORDER BY t.n DESC) FROM (
             SELECT u AS name, COUNT(*) AS n FROM event_fact, unnest(workout_types) AS u GROUP BY u) t),
           '[]'::json)
  );
$$;


-- ── PAX aggregates ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION stats_api_all_pax_stats() RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_agg(t ORDER BY t.total_posts DESC), '[]'::json) FROM (
    SELECT
      af.pax_id                    AS user_id,
      MAX(af.handle)               AS f3_name,
      COUNT(*)                     AS total_posts,
      COALESCE(SUM(af.q_ind), 0)   AS qs,
      COALESCE(SUM(af.coq_ind), 0) AS coqs,
      COUNT(DISTINCT af.ao_name)   AS aos_visited,
      MIN(af.start_date)           AS first_post,
      MAX(af.start_date)           AS last_post,
      COUNT(DISTINCT to_char(af.start_date, 'YYYY-MM')) AS active_months
    FROM attendance_fact af
    WHERE af.handle IS NOT NULL
    GROUP BY af.pax_id
  ) t;
$$;

CREATE OR REPLACE FUNCTION stats_api_pax_top_aos(p_top_n_per_pax int DEFAULT 5) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_agg(t ORDER BY t.user_id, t.posts DESC), '[]'::json) FROM (
    SELECT user_id, ao_name, posts, qs, rn FROM (
      SELECT
        af.pax_id  AS user_id,
        af.ao_name AS ao_name,
        COUNT(*)   AS posts,
        COALESCE(SUM(af.q_ind), 0) AS qs,
        ROW_NUMBER() OVER (PARTITION BY af.pax_id ORDER BY COUNT(*) DESC) AS rn
      FROM attendance_fact af
      WHERE af.handle IS NOT NULL AND af.ao_name IS NOT NULL
      GROUP BY af.pax_id, af.ao_name
    ) x
    WHERE rn <= p_top_n_per_pax
  ) t;
$$;


-- ── Streak activity ({user_id: [period, …]}, users and periods ascending) ─

CREATE OR REPLACE FUNCTION stats_api_pax_weekly_activity() RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_object_agg(user_id, periods ORDER BY user_id), '{}'::json) FROM (
    SELECT user_id, json_agg(period ORDER BY period) AS periods FROM (
      SELECT DISTINCT af.pax_id AS user_id, to_char(af.start_date, 'IYYY"-W"IW') AS period
      FROM attendance_fact af
    ) x GROUP BY user_id
  ) t;
$$;

CREATE OR REPLACE FUNCTION stats_api_pax_monthly_activity() RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_object_agg(user_id, periods ORDER BY user_id), '{}'::json) FROM (
    SELECT user_id, json_agg(period ORDER BY period) AS periods FROM (
      SELECT DISTINCT af.pax_id AS user_id, to_char(af.start_date, 'YYYY-MM') AS period
      FROM attendance_fact af
    ) x GROUP BY user_id
  ) t;
$$;

CREATE OR REPLACE FUNCTION stats_api_pax_q_weekly_activity() RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_object_agg(user_id, periods ORDER BY user_id), '{}'::json) FROM (
    SELECT user_id, json_agg(period ORDER BY period) AS periods FROM (
      SELECT DISTINCT af.pax_id AS user_id, to_char(af.start_date, 'IYYY"-W"IW') AS period
      FROM attendance_fact af WHERE af.q_ind = 1
    ) x GROUP BY user_id
  ) t;
$$;

CREATE OR REPLACE FUNCTION stats_api_pax_double_weekly_activity() RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_object_agg(user_id, periods ORDER BY user_id), '{}'::json) FROM (
    SELECT user_id, json_agg(period ORDER BY period) AS periods FROM (
      SELECT af.pax_id AS user_id, to_char(af.start_date, 'IYYY"-W"IW') AS period
      FROM attendance_fact af
      GROUP BY af.pax_id, to_char(af.start_date, 'IYYY"-W"IW')
      HAVING COUNT(*) >= 2
    ) x GROUP BY user_id
  ) t;
$$;

CREATE OR REPLACE FUNCTION stats_api_pax_dow_weekly_activity(p_dow int) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(json_object_agg(user_id, periods ORDER BY user_id), '{}'::json) FROM (
    SELECT user_id, json_agg(period ORDER BY period) AS periods FROM (
      SELECT DISTINCT af.pax_id AS user_id, to_char(af.start_date, 'IYYY"-W"IW') AS period
      FROM attendance_fact af WHERE EXTRACT(DOW FROM af.start_date)::int = p_dow
    ) x GROUP BY user_id
  ) t;
$$;

-- Weeks each PAX posted at their home AO (the AO they've posted at most).
CREATE OR REPLACE FUNCTION stats_api_pax_home_ao_weekly_activity() RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH home AS (
    SELECT user_id, ao_name FROM (
      SELECT af.pax_id AS user_id, af.ao_name,
             ROW_NUMBER() OVER (PARTITION BY af.pax_id ORDER BY COUNT(*) DESC) AS rn
      FROM attendance_fact af WHERE af.ao_name IS NOT NULL
      GROUP BY af.pax_id, af.ao_name
    ) t WHERE rn = 1
  )
  SELECT COALESCE(json_object_agg(user_id, periods ORDER BY user_id), '{}'::json) FROM (
    SELECT user_id, json_agg(period ORDER BY period) AS periods FROM (
      SELECT DISTINCT af.pax_id AS user_id, to_char(af.start_date, 'IYYY"-W"IW') AS period
      FROM attendance_fact af
      JOIN home h ON h.user_id = af.pax_id AND h.ao_name = af.ao_name
    ) x GROUP BY user_id
  ) t;
$$;


-- ── Who may call them: the anon key (and service_role), nobody else ─

DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname LIKE 'stats\_api\_%'
  LOOP
    -- Supabase's default privileges also grant new functions to authenticated directly.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, service_role', f);
  END LOOP;
END $$;
