#!/usr/bin/env bash
# Local only: gives the local stack's entries real flyers from past issues of The Fort Weekly.
#
# The images are downloaded (read-only) from the production app's public uploads, copied into
# .local/uploads under their original names, and set as each entry's hero_image through the local
# admin API (which also flushes the local site cache). Nothing is sent anywhere else.
#
# Ruck and Roll, Beers for Beetus and Turkey Day Convergence get their own flyers; the rest get a
# fitting flyer from another issue as a stand-in. Coffeteria and Yoga are left without one (weekly
# items rarely have flyers, and it keeps the no-image layout covered).
#
# Usage: scripts/local/sample-flyers.sh        (NL_URL defaults to http://localhost:3002)
set -euo pipefail

NL_URL="${NL_URL:-http://localhost:3002}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-test123}"
SRC="https://submit.f3thefort.com/uploads"
OUT="$(cd "$(dirname "$0")/../.." && pwd)/.local/uploads"

# slug  image  (empty image = no flyer)
MAP="
q-school-its-back                      1786229833804-whrwf2.png
ruck-and-roll                          1789843534361-4gzf3f.jpeg
beers-for-beetus                       1790974948612-76ol0z.PNG
turkey-day-convergence                 1789089913124-3ggrfm.jpeg
warrior-heart-mens-spiritual-bootcamp  1785625735830-cwigpz.png
la-grama                               1791808636925-8zut9w.jpeg
bethel-mens-shelter-2                  1785625858371-p6pfyr.png
the-4-bs-its-back                      1791555409941-19ubat.png
coffeteria-east-and-west               -
yoga-in-the-park                       -
"

mkdir -p "$OUT"
cookie=$(curl -fsS -i -X POST -H 'Content-Type: application/json' \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}" "$NL_URL/api/admin/login" \
  | grep -i '^set-cookie:' | sed 's/^[^:]*: //; s/;.*//' | tr -d '\r')
entries=$(curl -fsS "$NL_URL/api/public/entries")

echo "$MAP" | while read -r slug img; do
  [ -z "$slug" ] && continue
  id=$(printf '%s' "$entries" | python3 -c "import json,sys; print(next((e['id'] for e in json.load(sys.stdin)['items'] if e['slug']==sys.argv[1]), ''))" "$slug")
  if [ -z "$id" ]; then echo "skip   $slug (not in the local data)"; continue; fi
  if [ "$img" = "-" ]; then
    hero=null label="(no flyer)"
  else
    [ -s "$OUT/$img" ] || curl -fsS -o "$OUT/$img" "$SRC/$img"
    hero="\"/uploads/$img\"" label="$img"
  fi
  curl -fsS -o /dev/null -X PATCH -H 'Content-Type: application/json' -H "Cookie: $cookie" \
    -d "{\"hero_image\":$hero}" "$NL_URL/api/entries/$id"
  echo "set    $slug -> $label"
done
