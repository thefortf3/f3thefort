# VPS Deployment Guide — Newsletter2

Deploy from a private GitHub repo to any Linux VPS in ~10 minutes.

## Prerequisites

- VPS with Ubuntu 22.04 or 24.04 LTS
- Root or sudo access
- Your app in a private GitHub repo

---

## Step 1 — Server Setup

SSH into your VPS:

```bash
ssh root@your-vps-ip
```

### Install essentials

```bash
# System packages
apt update && apt upgrade -y
apt install -y curl git build-essential

# Node.js 20 LTS (using NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify
node --version   # v20.x
npm --version    # 10.x
```

> `better-sqlite3` compiles native code — `build-essential` covers that. No separate SQLite install needed.

### Install nginx (reverse proxy + HTTPS)

```bash
apt install -y nginx certbot python3-certbot-nginx
```

---

## Step 2 — Clone & Install

```bash
# Create app directory
mkdir -p /opt/newsletter2
cd /opt/newsletter2

# Clone your private repo
git clone https://github.com/YOUR/NEWSLETTER2.git .
# OR if you have an SSH deploy key:
# git clone git@github.com:YOUR/NEWSLETTER2.git .

# Install dependencies
npm install --production
```

### Create uploads directory

```bash
mkdir -p public/uploads
```

---

## Step 3 — Environment Variables

Create a `.env` file (never commit this to git):

```bash
cat > /opt/newsletter2/.env << 'EOF'
ADMIN_PASSWORD=your-strong-password-here
PORT=3000
DB_PATH=/opt/newsletter2/dev.db
NODE_ENV=production
EOF
```

Add to `.gitignore` (if not already):

```
.env
*.db
node_modules/
```

---

## Step 4 — systemd Service

Create a service file so the app auto-starts and auto-restarts:

```bash
cat > /etc/systemd/system/newsletter2.service << 'EOF'
[Unit]
Description=Newsletter2 App
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/newsletter2
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/newsletter2/.env

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable newsletter2
systemctl start newsletter2

# Check it's running
systemctl status newsletter2
journalctl -u newsletter2 --no-pager -n 20
```

---

## Step 5 — Nginx Reverse Proxy

```bash
cat > /etc/nginx/sites-available/newsletter2 << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Enable the site
ln -s /etc/nginx/sites-available/newsletter2 /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test config
nginx -t

# Reload
systemctl reload nginx
```

---

## Step 6 — HTTPS (Let's Encrypt)

```bash
certbot --nginx -d your-domain.com

# Auto-renewal is configured by default. Verify:
certbot renew --dry-run
```

---

## Step 7 — Firewall

```bash
# Allow HTTP, HTTPS, and SSH only
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# Verify
ufw status
```

Expected output:
```
Status: active

To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
Nginx Full                 ALLOW       Anywhere
```

---

## Deployment Workflow (After Initial Setup)

Every time you push changes to GitHub:

```bash
# SSH into VPS
ssh root@your-vps-ip

# Pull latest, reinstall deps if needed, restart
cd /opt/newsletter2
git pull
npm install --production
systemctl restart newsletter2

# Verify
systemctl status newsletter2
```

### Optional: post-receive hook for auto-deploy

If you want zero-touch deploys from GitHub, set up a [GitHub webhook](https://docs.github.com/en/webhooks) that hits a simple endpoint on your VPS, or use a cron job:

```bash
# Add to crontab (crontab -e)
# Check and deploy every 5 minutes
*/5 * * * * cd /opt/newsletter2 && git pull && npm install --production && systemctl restart newsletter2 2>&1 | logger
```

---

## Security Checklist

| Item | Status |
|------|--------|
| `ADMIN_PASSWORD` set via env var (not hardcoded) | |
| `.env` not in git | |
| `*.db` not in git | |
| HTTPS enabled (certbot) | |
| Firewall: only SSH + HTTP/HTTPS open | |
| `NODE_ENV=production` | |
| systemd `Restart=on-failure` | |
| Node.js updated regularly: `apt upgrade nodejs` | |

---

## Cost Summary

| Item | Cost |
|------|------|
| VPS (RackNerd/CloudCone) | ~$10/yr |
| Domain name | ~$10/yr |
| HTTPS (Let's Encrypt) | $0 |
| **Total** | **~$20/yr** |

For ~$20/year you get a real private VPS with HTTPS, a custom domain, and full control. Compare to Azure F1: same cost, but you own the infrastructure, no compute limits, and it actually works.
