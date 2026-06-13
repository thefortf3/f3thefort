#!/bin/bash
BACKUP_DIR="/home/user/newsletter2/data/backups"
mkdir -p "$BACKUP_DIR"
cp /home/user/newsletter2/data/news.db "$BACKUP_DIR/news-$(date +%Y%m%d-%H%M%S).db"
ls -t "$BACKUP_DIR"/news-*.db | tail -n +9 | xargs -r rm --
echo "Backup complete. Current backups:"
ls -lh "$BACKUP_DIR"
