#!/usr/bin/env bash
# Packages wordpress-theme/fort as dist/fort-theme.zip for Appearance → Themes → Add New →
# Upload in wp-admin. This only builds the file; uploading it is a manual, supervised step.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/fort-theme.zip
# Only the files git tracks (a new file must be added to git first), so no leftovers ship.
(cd wordpress-theme && git ls-files -- fort | zip -q ../dist/fort-theme.zip -@)
echo "Built dist/fort-theme.zip ($(du -h dist/fort-theme.zip | cut -f1))"
