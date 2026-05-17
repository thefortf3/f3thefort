#!/usr/bin/env bash
# ============================================================
# newsletter2 — Remote VPS Deploy Script
# Deploys local code to HostGator VPS via SSH + rsync
# Domain: submit.f3thefort.com
# ============================================================
set -euo pipefail

# --- Config ---
SSH_USER="root"
SSH_HOST="198.46.194.165"
SSH_PORT="22"
REMOTE_DIR="/home/user/newsletter2"
DOMAIN="submit.f3thefort.com"

# --- Prompt for secrets ---
read -rsp "Enter ADMIN_PASSWORD: " ADMIN_PASSWORD
echo
read -rsp "Enter Let's Encrypt email: " LETS_EMAIL
echo
echo "Deploying to ${SSH_USER}@${SSH_HOST} ..."

# --- 0. Remote setup: install system deps, Node.js, PM2 ---
echo "[1/6] Installing system dependencies on remote server..."
ssh -p "${SSH_PORT}" "${SSH_USER}@${SSH_HOST}" << 'REMOTE_SETUP'
set -euo pipefail
apt-get update -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx sqlite3 > /dev/null 2>&1

# Install Node.js 18
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y -qq nodejs > /dev/null 2>&1
  echo "Node.js $(node --version) installed"
else
  echo "Node.js $(node --version) already installed"
fi

# Install PM2
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2 > /dev/null 2>&1
  echo "PM2 installed"
else
  echo "PM2 already installed"
fi
REMOTE_SETUP

# --- 1. Create remote directory ---
echo "[2/6] Preparing remote directory..."
ssh -p "${SSH_PORT}" "${SSH_USER}@${SSH_HOST}" "mkdir -p ${REMOTE_DIR}"

# --- 2. Sync local code to remote (rsync, git-ignore aware) ---
echo "[3/6] Syncing local code to remote server..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'dev.db' \
  --exclude 'test.db' \
  --exclude 'test-results' \
  --exclude '.git' \
  -e "ssh -p ${SSH_PORT}" \
  ./ \
  "${SSH_USER}@${SSH_HOST}:${REMOTE_DIR}/"

# --- 3. Install npm dependencies on remote ---
echo "[4/6] Installing npm dependencies on remote server..."
ssh -p "${SSH_PORT}" "${SSH_USER}@${SSH_HOST}" << REMOTE_NPM
set -euo pipefail
cd ${REMOTE_DIR}
npm install --production > /dev/null 2>&1
npx drizzle-kit push
echo "npm dependencies installed"
REMOTE_NPM

# --- 4. Configure & start with PM2 ---
echo "[5/6] Starting app with PM2..."
ssh -p "${SSH_PORT}" "${SSH_USER}@${SSH_HOST}" << REMOTE_PM2
set -euo pipefail
cd ${REMOTE_DIR}

# Stop existing instance if running
pm2 delete newsletter 2>/dev/null || true

# Start with env vars
ADMIN_PASSWORD='${ADMIN_PASSWORD}' PORT=3000 pm2 start server.js --name newsletter
pm2 save
pm2 startup 2>&1 | grep -o 'sudo.*' | sh || true

# Verify it started
sleep 2
pm2 status
curl -s http://localhost:3000/api/admin/check-auth || echo "Warning: app may not be responding yet"
REMOTE_PM2

# --- 5. Configure Nginx ---
echo "[6/6] Configuring Nginx and SSL..."
ssh -p "${SSH_PORT}" "${SSH_USER}@${SSH_HOST}" << REMOTE_NGINX
set -euo pipefail

# Write Nginx config
cat > /etc/nginx/sites-available/${DOMAIN} << 'NGINX_EOF'
server {
    listen 80;
    server_name ${DOMAIN};
    root /home/user/newsletter2/public;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        try_files \$uri \$uri/index.html =404;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX_EOF

# Enable site
ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
echo "Nginx configured and restarted"

# SSL with Let's Encrypt
certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --m '${LETS_EMAIL}'
echo "SSL certificate obtained"
REMOTE_NGINX

# --- Done ---
echo ""
echo "=============================================="
echo " Deploy complete!"
echo " Domain: https://${DOMAIN}"
echo "=============================================="
echo ""
echo "Next steps:"
echo "  - Visit https://${DOMAIN} to verify"
echo "  - Admin dashboard: https://${DOMAIN}/admin"
echo "  - PM2 logs: ssh root@198.46.194.165 'pm2 logs newsletter'"
echo "  - Change root password: ssh root@198.46.194.165 'passwd'"
echo ""
