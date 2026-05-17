# Azure F1 Deployment Guide — Newsletter2

## Prerequisites
- Azure account (free tier includes 12 months of B1S; F1 is permanently free)
- Azure CLI installed: `az login`

## Step 1 — Create Resource Group & App Service Plan

```bash
# Pick a region close to you
REGION=eastus

# Resource group
az group create --name newsletter2-rg --location "$REGION"

# Free App Service Plan (F1 tier — permanently free)
az appservice plan create \
  --name newsletter2-plan \
  --resource-group newsletter2-rg \
  --sku FREE \
  --is-linux
```

## Step 2 — Create Web App

```bash
APP_NAME=newsletter2-$(openssl rand -hex 4)

az webapp create \
  --resource-group newsletter2-rg \
  --plan newsletter2-plan \
  --name "$APP_NAME" \
  --runtime "NODE|20" \
  --deployment-local-git
```

> Note the git URL in the output (e.g., `https://<user>@newsletter2-xxxx.scm.azurewebsites.net/newsletter2-xxxx.git`)

## Step 3 — Configure App Settings

```bash
# Admin password (CHANGE THIS)
az webapp config appsettings set \
  --resource-group newsletter2-rg \
  --name "$APP_NAME" \
  --settings ADMIN_PASSWORD='your-strong-password-here' \
  DB_PATH='/home/site/wwwroot/dev.db' \
  PORT='443' \
  WEBSITES_ENABLE_APP_SERVICE_STORAGE='true' \
  SCM_DO_BUILD_DISABLE='true'
```

**Key settings explained:**
| Setting | Why |
|---------|-----|
| `ADMIN_PASSWORD` | Your admin password (never hardcode) |
| `DB_PATH` | SQLite file on persistent Azure storage (`/home` = `D:\home` on Windows) |
| `WEBSITES_ENABLE_APP_SERVICE_STORAGE` | Enables persistent filesystem for SQLite + uploads |
| `SCM_DO_BUILD_DISABLE` | Skip npm build (we don't have one) |

## Step 4 — Deploy

### Option A: Git Deploy (recommended)

```bash
# Add Azure as a git remote
git remote add azure "$APP_NAME"

# Create uploads directory (git will track it)
mkdir -p public/uploads
touch public/uploads/.gitkeep

# Push to deploy
git add .
git commit -m "Deploy to Azure F1"
git push azure master
```

### Option B: Zip Deploy (no git remote)

```bash
# From the project root
zip -r newsletter2.zip . -x "*.git*" "node_modules/*" "*.db" "*.test*" "*spec*"

az webapp deploy \
  --resource-group newsletter2-rg \
  --name "$APP_NAME" \
  --src-path newsletter2.zip \
  --type zip
```

## Step 5 — Verify

```bash
# Get the URL
az webapp show \
  --resource-group newsletter2-rg \
  --name "$APP_NAME" \
  --query defaultHostName -o tsv

# Visit: http://<defaultHostName>
# Admin: http://<defaultHostName>/admin
```

## Quick Deploy (One-Liner)

If you want to skip the guide and just deploy:

```bash
# Create everything in one shot (replace values)
APP=nl-$(openssl rand -hex 4) && \
az group create --name nl-rg --location eastus && \
az appservice plan create --name nl-plan --resource-group nl-rg --sku FREE --is-linux && \
az webapp create --resource-group nl-rg --plan nl-plan --name "$APP" --runtime "NODE|20" --deployment-local-git && \
az webapp config appsettings set --resource-group nl-rg --name "$APP" --settings ADMIN_PASSWORD='your-password' DB_PATH='/home/site/wwwroot/dev.db' WEBSITES_ENABLE_APP_SERVICE_STORAGE='true' SCM_DO_BUILD_DISABLE='true' && \
git remote add azure "$APP" && \
git push azure master
```

```bash
# Get the URL
az webapp show \
  --resource-group newsletter2-rg \
  --name "$APP_NAME" \
  --query defaultHostName -o tsv

# Visit: http://<defaultHostName>
# Admin: http://<defaultHostName>/admin
```

## Ongoing Management

```bash
# View logs
az webapp log tail --name "$APP_NAME" --resource-group newsletter2-rg

# Restart app
az webapp restart --name "$APP_NAME" --resource-group newsletter2-rg

# Update after code changes (zip deploy)
zip -r newsletter2.zip . -x "*.git*" "node_modules/*" "*.db" -f
az webapp deploy --resource-group newsletter2-rg --name "$APP_NAME" --src-path newsletter2.zip --type zip
```

## Important F1 Limitations

| Limitation | Impact |
|------------|--------|
| **HTTP only** | No HTTPS on free tier. Use HTTP URLs. If you bring a custom domain, HTTPS still won't auto-provision on F1. |
| **60 min/day CPU** | Fine for 3-5 uses/week. Won't be hit. |
| **No scaling** | Single shared instance. |
| **No SSH** | Can't SSH into the box. Debug via logs. |
| **No slot swapping** | Only one deployment slot. |

## Cost

**$0/year** — Azure App Service Free (F1) tier is permanently free.

## Database & File Storage

Both live on Azure's persistent filesystem at `/home/site/wwwroot/` (mapped to `D:\home` on the VM):

| Item | Location | Cost |
|------|----------|------|
| SQLite DB | `/home/site/wwwroot/dev.db` | Included |
| Image uploads | `/home/site/wwwroot/public/uploads/` | Included |
| Static files | `/home/site/wwwroot/public/` | Included |

No Azure Storage Account needed. Everything runs on the included persistent disk (~5GB per App Service plan).

## Migration After Year 1 (Optional)

If you want to move off Azure after the 12-month trial expires (or keep using F1 indefinitely — it's free):

- **F1 works forever** — no migration needed. It's permanently free.
- If you outgrow F1 later, the same code runs on **Oracle Cloud Always-Free** (full VM, $0/yr) or **Fly.io** ($0/yr) with zero changes.
