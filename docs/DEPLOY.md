# Deployment Guide

**Production:** `submit.f3thefort.com` — VPS at `198.46.194.165`  
**Stack:** Docker Compose (app + nginx + certbot)  
**App directory on host:** `/home/user/newsletter2`

---

## How it works

The server runs a pre-built Docker image — no source code lives there. Deployments build the image locally, ship it to the server, and restart the container.

**Files on the server (all that's needed):**

```
/home/user/newsletter2/
├── docker-compose.yml      # stack definition
├── nginx.conf              # nginx config (volume-mounted into nginx container)
├── .env                    # secrets — never in git
├── data/
│   ├── news.db             # production database (persists across deploys)
│   └── backups/            # weekly DB snapshots
├── public/uploads/         # user-uploaded images (persists across deploys)
└── scripts/
    └── backup-db.sh        # weekly backup cron script
```

---

## Deploying a code update

```bash
./scripts/deploy.sh
```

That script does three things:
1. `docker build` — builds `newsletter:latest` from your local working tree
2. `docker save | gzip | ssh | docker load` — pipes the image to the server
3. `docker compose up -d --no-deps newsletter` — restarts only the app container

nginx and certbot are not touched.

---

## Deploying a config change

If only `docker-compose.yml` or `nginx.conf` changed (no code):

```bash
# Push the config file(s)
scp docker-compose.yml nginx.conf root@198.46.194.165:/home/user/newsletter2/

# Restart the affected container
ssh root@198.46.194.165 'docker compose --project-directory /home/user/newsletter2 up -d --no-deps nginx'
```

---

## Useful commands

```bash
# Tail live logs
ssh root@198.46.194.165 'docker logs -f newsletter'

# Shell into the app container
ssh root@198.46.194.165 'docker exec -it newsletter sh'

# Restart app only (image already loaded)
ssh root@198.46.194.165 'docker compose --project-directory /home/user/newsletter2 restart newsletter'

# Full stack restart
ssh root@198.46.194.165 'docker compose --project-directory /home/user/newsletter2 up -d'
```

---

## Database backups

- **Script:** `scripts/backup-db.sh` on the host (not inside the container)
- **Backups:** `/home/user/newsletter2/data/backups/news-YYYYMMDD-HHMMSS.db`
- **Retention:** 8 most recent copies, older pruned automatically
- **Cron:** every Sunday at 2 AM

To verify the cron on the server:
```bash
ssh root@198.46.194.165 'crontab -l'
# Expected line:
# 0 2 * * 0 /home/user/newsletter2/scripts/backup-db.sh >> /home/user/newsletter2/data/backups/backup.log 2>&1
```

---

## First-time server setup

```bash
# 1. Install Docker
apt update && apt install -y docker.io docker-compose-plugin
systemctl enable --now docker

# 2. Create directory structure and drop in config files
mkdir -p /home/user/newsletter2/{data/backups,public/uploads,scripts}
scp docker-compose.yml nginx.conf root@198.46.194.165:/home/user/newsletter2/
scp scripts/backup-db.sh root@198.46.194.165:/home/user/newsletter2/scripts/
chmod +x /home/user/newsletter2/scripts/backup-db.sh

# 3. Create .env on the server with real secrets
ssh root@198.46.194.165 'cat > /home/user/newsletter2/.env' << 'EOF'
ADMIN_PASSWORD=...
MAILCHIMP_API_KEY=...
MAILCHIMP_LIST_ID=...
MAILCHIMP_SERVER=us10
MAILCHIMP_FROM_NAME=The Fort Weekly
MAILCHIMP_FROM_EMAIL=...
FNG_SHEET_URL=...
WORDPRESS_BASE_URL=...
WORDPRESS_USERNAME=...
WORDPRESS_APP_PASSWORD=...
WORDPRESS_PREBLAST_CATEGORY=Pre-Blast
GROQ_API_KEY=...
EOF

# 4. Build and deploy the image (starts the full stack)
./scripts/deploy.sh
ssh root@198.46.194.165 'docker compose --project-directory /home/user/newsletter2 up -d'

# 5. Set up backup cron
ssh root@198.46.194.165 \
  '(crontab -l 2>/dev/null; echo "0 2 * * 0 /home/user/newsletter2/scripts/backup-db.sh >> /home/user/newsletter2/data/backups/backup.log 2>&1") | crontab -'
```
