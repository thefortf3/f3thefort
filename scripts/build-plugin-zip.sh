#!/usr/bin/env bash
# Packages the plugins for Plugins → Add New → Upload in wp-admin:
#   dist/fort-weekly.zip  (with its Composer dependency, the email CSS inliner, vendored in)
#   dist/fort-stats.zip
# Tests and dev files are left out. This only builds the files; uploading them is a manual,
# supervised step.
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
mkdir -p dist "$BUILD/fort-weekly" "$BUILD/fort-stats"
# Copy the plugin without its local vendor/ (rebuilt clean below), tests or dev files.
tar -C wordpress-plugin/fort-weekly --exclude=./vendor --exclude=./tests --exclude='*.DS_Store' -cf - . | tar -C "$BUILD/fort-weekly" -xf -
docker run --rm -u "$(id -u):$(id -g)" -v "$BUILD/fort-weekly":/app -w /app -e COMPOSER_HOME=/tmp/composer \
  composer:2 install --no-dev --no-interaction --no-progress --optimize-autoloader --quiet
rm -f "$BUILD/fort-weekly/composer.json" "$BUILD/fort-weekly/composer.lock"

rm -f dist/fort-weekly.zip
(cd "$BUILD" && zip -qr "$OLDPWD/dist/fort-weekly.zip" fort-weekly)
echo "Built dist/fort-weekly.zip ($(du -h dist/fort-weekly.zip | cut -f1))"

# Fort Stats has no dependencies.
tar -C wordpress-plugin/fort-stats --exclude=./tests --exclude='*.DS_Store' -cf - . | tar -C "$BUILD/fort-stats" -xf -
rm -f dist/fort-stats.zip
(cd "$BUILD" && zip -qr "$OLDPWD/dist/fort-stats.zip" fort-stats)
echo "Built dist/fort-stats.zip ($(du -h dist/fort-stats.zip | cut -f1))"
