#!/bin/bash
# Usage: backup-db.sh <label> <keep-count>
# e.g.   backup-db.sh daily 3     backup-db.sh weekly 4
#
# <label> namespaces the backup filename so daily and weekly runs prune their own set
# independently instead of competing over a single retention count.
set -euo pipefail
LABEL="${1:?Usage: backup-db.sh <label> <keep-count>}"
KEEP="${2:?Usage: backup-db.sh <label> <keep-count>}"

BACKUP_DIR="/home/user/newsletter2/data/backups"
mkdir -p "$BACKUP_DIR"
cp /home/user/newsletter2/data/news.db "$BACKUP_DIR/news-${LABEL}-$(date +%Y%m%d-%H%M%S).db"
ls -t "$BACKUP_DIR"/news-"${LABEL}"-*.db | tail -n +"$((KEEP + 1))" | xargs -r rm --
echo "Backup complete ($LABEL, keep=$KEEP). Current $LABEL backups:"
ls -lh "$BACKUP_DIR"/news-"${LABEL}"-*.db
