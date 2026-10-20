#!/usr/bin/env bash
# Installs the local throwaway WordPress from docker-compose.local.yml, activates the Fort
# theme, and imports a few recent public posts (backblasts / pre-blasts) from f3thefort.com's
# public REST API so the theme has real-looking content. Read-only against the live site.
set -euo pipefail
cd "$(dirname "$0")/../.."

DEV_HOST="${DEV_HOST:-develop.lan}"
COMPOSE=(docker compose -f docker-compose.local.yml)
WP=("${COMPOSE[@]}" run --rm wpcli wp)
mkdir -p .local/seed

echo "[1/4] Waiting for WordPress…"
for _ in $(seq 1 30); do "${WP[@]}" core version >/dev/null 2>&1 && break; sleep 2; done

if ! "${WP[@]}" core is-installed >/dev/null 2>&1; then
  echo "[2/4] Installing WordPress…"
  "${WP[@]}" core install --url="http://${DEV_HOST}:8088" --title="F3 The Fort" \
    --admin_user=admin --admin_password=admin --admin_email=admin@example.com --skip-email
fi
"${WP[@]}" rewrite structure '/%year%/%monthnum%/%day%/%postname%/' --hard >/dev/null
"${WP[@]}" theme activate fort
"${WP[@]}" rewrite flush --hard >/dev/null

echo "[3/4] Fetching sample posts from the public site…"
curl -s "https://f3thefort.com/wp-json/wp/v2/posts?per_page=16&_embed=wp:term&_fields=title,content,date,_links,_embedded" > .local/seed/posts.json

echo "[4/4] Importing…"
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
echo "Done → http://${DEV_HOST}:8088  (wp-admin: admin / admin)"
