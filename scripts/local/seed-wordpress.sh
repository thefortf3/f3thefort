#!/usr/bin/env bash
# Installs the local throwaway WordPress from docker-compose.local.yml, activates the Fort theme
# and the Fort Weekly plugin, and fills it with realistic content:
#   - a few recent public posts (backblasts / pre-blasts) from f3thefort.com's public REST API;
#   - the events and region info from a COPY of the old app's database (.local/data/dev.db),
#     exported with scripts/export-for-wordpress.mjs and imported with `wp fort-weekly import`;
#   - real flyers from past issues (scripts/local/sample-flyers.sh);
#   - a Fort editor test account.
# Read-only against the live site.
set -euo pipefail
cd "$(dirname "$0")/../.."

DEV_HOST="${DEV_HOST:-develop.lan}"
COMPOSE=(docker compose -f docker-compose.local.yml)
WP=("${COMPOSE[@]}" run --rm wpcli wp)
mkdir -p .local/seed

echo "[1/7] Waiting for WordPress…"
# Files first, then the database (MariaDB takes a while on a fresh volume).
for _ in $(seq 1 30); do "${WP[@]}" core version >/dev/null 2>&1 && break; sleep 2; done
for _ in $(seq 1 45); do "${WP[@]}" db query 'SELECT 1' >/dev/null 2>&1 && break; sleep 2; done

if ! "${WP[@]}" core is-installed >/dev/null 2>&1; then
  echo "[2/7] Installing WordPress…"
  # A random admin password, kept only in .local/ (gitignored, owner-readable): this site can end
  # up reachable from outside (e.g. through a reverse proxy), so never a guessable default.
  PW_FILE=.local/wp-admin-password
  [ -s "$PW_FILE" ] || (umask 077 && python3 -c "import secrets; print(secrets.token_urlsafe(24))" > "$PW_FILE")
  "${COMPOSE[@]}" run --rm -e WP_ADMIN_PW="$(cat "$PW_FILE")" wpcli sh -c \
    'wp core install --url="http://${DEV_HOST}:8088" --title="F3 The Fort" --admin_user=admin \
       --admin_password="$WP_ADMIN_PW" --admin_email=admin@example.com --skip-email'
  echo "      WordPress admin: user 'admin', password in $PW_FILE"
fi
"${WP[@]}" rewrite structure '/%year%/%monthnum%/%day%/%postname%/' --hard >/dev/null
"${WP[@]}" theme activate fort
"${WP[@]}" plugin activate fort-weekly
"${WP[@]}" rewrite flush --hard >/dev/null

echo "[3/7] Fetching sample posts from the public site…"
curl -s "https://f3thefort.com/wp-json/wp/v2/posts?per_page=16&_embed=wp:term&_fields=title,content,date,_links,_embedded" > .local/seed/posts.json

echo "[4/7] Importing sample posts…"
python3 - <<'PY'
import json, subprocess, html
posts = json.load(open('.local/seed/posts.json'))
for i, p in enumerate(posts):
    cats = [t['name'] for group in p.get('_embedded', {}).get('wp:term', []) for t in group if t.get('taxonomy') == 'category']
    content_path = f'.local/seed/post-{i}.html'
    open(content_path, 'w').write(p['content']['rendered'])
    cmd = ['docker', 'compose', '-f', 'docker-compose.local.yml', 'run', '--rm', 'wpcli', 'wp', 'post', 'create',
           f'/seed/post-{i}.html', '--post_status=publish', f"--post_title={html.unescape(p['title']['rendered'])}",
           f"--post_date={p['date']}", '--porcelain']
    pid = subprocess.run(cmd, capture_output=True, text=True).stdout.strip()
    wp = lambda *a: subprocess.run(['docker', 'compose', '-f', 'docker-compose.local.yml', 'run', '--rm', 'wpcli', 'wp', *a], capture_output=True, text=True).stdout.strip()
    ids = []
    for c in cats:
        name = html.unescape(c)
        wp('term', 'create', 'category', name)
        ids.append(wp('term', 'list', 'category', f'--name={name}', '--field=term_id').splitlines()[-1])
    if ids:
        wp('post', 'term', 'set', pid, 'category', *ids, '--by=id')
    print('  ', pid, html.unescape(p['title']['rendered']), cats)
PY
echo "[5/7] Importing events from a copy of the old app's database…"
if [ -s .local/data/dev.db ]; then
  # The export holds submitters' contact details: owner-only, deleted after the import.
  # The repo's current scripts/ and lib/ (the image may predate the export script).
  "${COMPOSE[@]}" --profile legacy run --rm --no-deps --user "$(id -u):$(id -g)" \
    -v "$PWD/scripts:/app/scripts:ro" -v "$PWD/lib:/app/lib:ro" newsletter \
    node scripts/export-for-wordpress.mjs --db /data/dev.db --out /data/fort-weekly-export.json
  chmod 600 .local/data/fort-weekly-export.json
  # The old app serves the images it hosts while the import copies them into the media library.
  "${COMPOSE[@]}" --profile legacy up -d newsletter >/dev/null 2>&1
  for _ in $(seq 1 20); do curl -fs -o /dev/null http://localhost:3002/ && break; sleep 1; done
  "${COMPOSE[@]}" run -T --rm wpcli wp fort-weekly import - --uploads-base=http://newsletter:3002 < .local/data/fort-weekly-export.json
  "${COMPOSE[@]}" --profile legacy stop newsletter >/dev/null 2>&1
  rm -f .local/data/fort-weekly-export.json
else
  echo "      (skipped: copy dev.db to .local/data/dev.db first)"
fi

echo "[6/7] Flyers from past issues…"
bash scripts/local/sample-flyers.sh

echo "[7/7] Fort editor test account…"
ED_FILE=.local/wp-editor-password
[ -s "$ED_FILE" ] || (umask 077 && python3 -c "import secrets; print(secrets.token_urlsafe(18))" > "$ED_FILE")
"${COMPOSE[@]}" run -T --rm -e PW="$(cat "$ED_FILE")" wpcli sh -c \
  'wp user get fortedit >/dev/null 2>&1 || wp user create fortedit fortedit@example.com --role=fort_editor --user_pass="$PW" --display_name="Test Editor" >/dev/null'

echo "Done → http://${DEV_HOST}:8088"
echo "      wp-admin: admin (password in .local/wp-admin-password), Fort editor: fortedit (.local/wp-editor-password)"
