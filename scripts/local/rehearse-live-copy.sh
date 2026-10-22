#!/usr/bin/env bash
# Switch-over rehearsal: a second local WordPress (compose project "fortcopy", port 8089) loaded
# with f3thefort.com's own content from a WordPress export (Tools → Export → All content), then
# switched to the Fort theme and Fort Weekly plugin the same way the live site will be.
#
#   bash scripts/local/rehearse-live-copy.sh path/to/f3thefort.WordPress.YYYY-MM-DD.xml
#
#   site      → http://$DEV_HOST:8089
#   wp-admin  → /wp-admin  (admin: password in .local/fortcopy-admin-password)
#
# The export holds members' names and email addresses: it is copied into .local/ (gitignored,
# owner-only) and stays on this machine. Attachments are not downloaded (images in old posts load
# from f3thefort.com, as for any visitor). Nothing is sent anywhere.
#
# Tear down (keeps nothing):  docker compose -p fortcopy -f docker-compose.local.yml down -v
set -euo pipefail
cd "$(dirname "$0")/../.."

XML="${1:?usage: $0 path/to/f3thefort.WordPress.YYYY-MM-DD.xml}"
export DEV_HOST="${DEV_HOST:-develop.lan}" WP_PORT=8089
COMPOSE=(docker compose -p fortcopy -f docker-compose.local.yml)
WP=("${COMPOSE[@]}" run -T --rm wpcli wp)

mkdir -p .local/seed
(umask 077 && cp "$XML" .local/seed/live-export.xml)

echo "[1/6] Starting the rehearsal WordPress on :$WP_PORT…"
"${COMPOSE[@]}" up -d db wordpress >/dev/null
for _ in $(seq 1 30); do "${WP[@]}" core version >/dev/null 2>&1 && break; sleep 2; done
for _ in $(seq 1 45); do "${WP[@]}" db query 'SELECT 1' >/dev/null 2>&1 && break; sleep 2; done

if ! "${WP[@]}" core is-installed >/dev/null 2>&1; then
  echo "[2/6] Installing WordPress…"
  PW_FILE=.local/fortcopy-admin-password
  [ -s "$PW_FILE" ] || (umask 077 && python3 -c "import secrets; print(secrets.token_urlsafe(24))" > "$PW_FILE")
  "${COMPOSE[@]}" run -T --rm -e WP_ADMIN_PW="$(cat "$PW_FILE")" wpcli sh -c \
    'wp core install --url="http://${DEV_HOST}:8089" --title="F3 The Fort" --admin_user=admin \
       --admin_password="$WP_ADMIN_PW" --admin_email=admin@example.com --skip-email'
fi
# The live site's permalinks (e.g. /2026/10/19/50-caliber-workout/).
"${WP[@]}" rewrite structure '/%year%/%monthnum%/%day%/%postname%/' --hard >/dev/null

if [ "$("${WP[@]}" post list --post_type=post --format=count)" -lt 1000 ]; then
  echo "[3/6] Importing the live site's content (several minutes)…"
  "${WP[@]}" plugin install wordpress-importer --activate >/dev/null
  # 'create' keeps each post's author; attachments are skipped (no downloads from the live site).
  # Run as root: the copy is owner-only, and wp-cli's usual user can't read it.
  "${COMPOSE[@]}" run -T --rm --user 0 wpcli wp --allow-root import /seed/live-export.xml \
    --authors=create --skip=attachment --quiet
fi

echo "[4/6] Front page and menu as on the live site…"
HOME_ID="$("${WP[@]}" post list --post_type=page --name=home --field=ID | head -1)"
[ -n "$HOME_ID" ] && "${WP[@]}" option update show_on_front page >/dev/null && "${WP[@]}" option update page_on_front "$HOME_ID" >/dev/null

echo "[5/6] Switching to the Fort theme and Fort Weekly…"
"${WP[@]}" theme activate fort
"${WP[@]}" plugin activate fort-weekly
"${WP[@]}" rewrite flush --hard >/dev/null

echo "[6/6] Events and region info from a copy of the old app's database…"
if [ -s .local/data/dev.db ]; then
  "${COMPOSE[@]}" --profile legacy run --rm --no-deps --user "$(id -u):$(id -g)" \
    -v "$PWD/scripts:/app/scripts:ro" -v "$PWD/lib:/app/lib:ro" newsletter \
    node scripts/export-for-wordpress.mjs --db /data/dev.db --out /data/fort-weekly-export.json
  chmod 600 .local/data/fort-weekly-export.json
  "${COMPOSE[@]}" --profile legacy up -d newsletter >/dev/null 2>&1
  for _ in $(seq 1 20); do curl -fs -o /dev/null http://localhost:3002/ && break; sleep 1; done
  "${WP[@]}" fort-weekly import - --uploads-base=http://newsletter:3002 < .local/data/fort-weekly-export.json
  "${COMPOSE[@]}" --profile legacy stop newsletter >/dev/null 2>&1
  rm -f .local/data/fort-weekly-export.json
else
  echo "      (skipped: copy dev.db to .local/data/dev.db first)"
fi

echo "Done → http://${DEV_HOST}:8089   (wp-admin: admin, password in .local/fortcopy-admin-password)"
