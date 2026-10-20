#!/usr/bin/env bash
# Packages wordpress-theme/fort as dist/fort-theme.zip for Appearance → Themes → Add New →
# Upload in wp-admin. This only builds the file; uploading it is a manual, supervised step.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/fort-theme.zip
(cd wordpress-theme && zip -qr ../dist/fort-theme.zip fort -x '*.DS_Store')
echo "Built dist/fort-theme.zip ($(du -h dist/fort-theme.zip | cut -f1))"
