#!/usr/bin/env bash
# Fills the local stand-in for the stats Supabase project (docker-compose.local.yml, profile
# "stats") with a copy of the live data, for building and checking the Fort Stats plugin:
#   1. the stats schema (supabase/supabase-setup.sql);
#   2. the data of event_fact, attendance_fact, ao_dim and sync_state, copied from Supabase with a
#      read-only pg_dump (nothing on Supabase changes);
#   3. the HTTPS API functions (supabase/stats-api.sql), as they'd be run in Supabase.
# Safe to re-run: the four tables are emptied and reloaded.
#
# STATS_ENV_FILE holds the read-only database login used for the copy (DB_HOST, DB_USER, …):
#
#   STATS_ENV_FILE=~/stats/.env bash scripts/local/seed-stats-db.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

STATS_ENV_FILE="${STATS_ENV_FILE:-$HOME/stats/.env}"
COMPOSE=(docker compose -f docker-compose.local.yml --profile stats)
PSQL=("${COMPOSE[@]}" exec -T stats-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

for f in supabase/supabase-setup.sql supabase/stats-api.sql "$STATS_ENV_FILE"; do
  [ -r "$f" ] || { echo "Missing $f (set STATS_ENV_FILE)" >&2; exit 1; }
done

echo "[1/4] Starting the local stats database and REST API…"
"${COMPOSE[@]}" up -d stats-db postgrest >/dev/null
for _ in $(seq 1 30); do "${COMPOSE[@]}" exec -T stats-db pg_isready -U postgres -q && break; sleep 1; done

echo "[2/4] Schema…"
"${PSQL[@]}" < supabase/supabase-setup.sql >/dev/null

echo "[3/4] Copying the live data (read-only)…"
"${PSQL[@]}" -c 'TRUNCATE event_fact, attendance_fact, ao_dim, sync_state'
(
  set -a; . "$STATS_ENV_FILE"; set +a
  docker run --rm -e PGPASSWORD="$DB_PASSWORD" -e PGSSLMODE="${DB_SSLMODE:-require}" postgres:17 \
    pg_dump -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "${DB_NAME:-postgres}" \
      --data-only --no-owner --no-privileges \
      -t public.event_fact -t public.attendance_fact -t public.ao_dim -t public.sync_state
) | "${PSQL[@]}" >/dev/null
"${PSQL[@]}" -At -c "SELECT 'event_fact ' || count(*) FROM event_fact UNION ALL SELECT 'attendance_fact ' || count(*) FROM attendance_fact UNION ALL SELECT 'ao_dim ' || count(*) FROM ao_dim" | sed 's/^/      /'

echo "[4/4] HTTPS API functions…"
"${PSQL[@]}" < supabase/stats-api.sql >/dev/null
"${PSQL[@]}" -c "NOTIFY pgrst, 'reload schema'"

# GloomSchedule / FNG settings for the local WordPress's Fort Stats (no database credentials).
(umask 077 && grep -E '^(GS_API_ENDPOINT|GS_API_KEY|FNG_SHEET_URL|FNG_START|FNG_END)=' "$STATS_ENV_FILE" > .local/stats-wp.env || true)

echo "Done → REST API at http://127.0.0.1:3010 (from WordPress: http://postgrest:3000)"
