#!/bin/bash

# hololive.com.cn Ubuntu 24.04 Deployment Script
# 
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh

set -e

# ==========================================
# Configuration
# ==========================================
DOMAIN="hololive.com.cn"
EMAIL="ryan.lan_home@outlook.com"
PB_VERSION="0.26.5"
INSTALL_DIR="/var/www/$DOMAIN"
PB_PORT="8090"
PB_ADMIN_GATE_PORT="18092"
AI_TRANSLATE_PROXY_PORT="18093"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[DEPLOY] $1${NC}"
}

success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
    exit 1
}

# Check for root
if [ "$EUID" -ne 0 ]; then 
    error "Please run as root"
fi

# ==========================================
# 1. System Update & Dependencies
# ==========================================
log "Updating system..."
apt update && apt upgrade -y
apt install -y curl unzip nginx certbot python3-certbot-nginx

# ==========================================
# 2. Install Node.js 20.x
# ==========================================
log "Installing Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
else
    log "Node.js already installed, skipping."
fi

# ==========================================
# 3. Setup Directory Structure
# ==========================================
log "Setting up directories at $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
# Assuming script is run from project root, copy everything to install dir if not already there
# But typically this script is either run FROM the repo or curls the repo
# Here we assume the user has uploaded the project to the server or cloned it.
# If running in-place, we just use current dir.
# Ideally, we move to /var/www/hololive.com.cn

if [ "$PWD" != "$INSTALL_DIR" ]; then
    log "Copying files to $INSTALL_DIR..."
    cp -r . "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ==========================================
# 4. Setup PocketBase
# ==========================================
log "Setting up PocketBase..."
mkdir -p backend
cd backend

# Download PocketBase if not present
if [ ! -f "pocketbase" ]; then
    log "Downloading PocketBase v$PB_VERSION..."
    curl -L -o pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip"
    unzip -o pb.zip
    rm pb.zip
    chmod +x pocketbase
fi

# Create Systemd Service
log "Creating systemd service..."
cat > /etc/systemd/system/pocketbase.service <<EOF
[Unit]
Description=PocketBase - $DOMAIN
After=network.target

[Service]
User=root
Group=root
WorkingDirectory=$INSTALL_DIR/backend
ExecStart=$INSTALL_DIR/backend/pocketbase serve --http="127.0.0.1:$PB_PORT"
Restart=always
RestartSec=5
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable pocketbase
systemctl restart pocketbase

# Setup map-proxy service if script exists
if [ -f "$INSTALL_DIR/backend/scripts/map-proxy.service" ]; then
    log "Installing map-proxy service..."
    cp "$INSTALL_DIR/backend/scripts/map-proxy.service" /etc/systemd/system/map-proxy.service
    systemctl daemon-reload
    systemctl enable map-proxy
    systemctl restart map-proxy
fi

# Setup mcsm-proxy service if script exists
if [ -f "$INSTALL_DIR/backend/scripts/mcsm-proxy.service" ]; then
    log "Installing mcsm-proxy service..."
    cp "$INSTALL_DIR/backend/scripts/mcsm-proxy.service" /etc/systemd/system/mcsm-proxy.service
    systemctl daemon-reload
    systemctl enable mcsm-proxy
    systemctl restart mcsm-proxy
fi

# Setup pb-admin-gate service if script exists
if [ -f "$INSTALL_DIR/backend/scripts/pb-admin-gate.service" ]; then
    log "Installing pb-admin-gate service..."
    cp "$INSTALL_DIR/backend/scripts/pb-admin-gate.service" /etc/systemd/system/pb-admin-gate.service
    systemctl daemon-reload
    systemctl enable pb-admin-gate
    systemctl restart pb-admin-gate
fi

# Setup ai-translate-proxy service if script exists
if [ -f "$INSTALL_DIR/backend/scripts/ai-translate-proxy.service" ]; then
    log "Installing ai-translate-proxy service..."
    cp "$INSTALL_DIR/backend/scripts/ai-translate-proxy.service" /etc/systemd/system/ai-translate-proxy.service
    systemctl daemon-reload
    systemctl enable ai-translate-proxy
    systemctl restart ai-translate-proxy
fi

# Wait for PB to start
sleep 5

# Create Superuser
log "Creating PocketBase Superuser..."
SUPERUSER_PASS=$(openssl rand -base64 12)
./pocketbase superuser create "$EMAIL" "$SUPERUSER_PASS" || log "Superuser might already exist."

cd ..

# ==========================================
# 5. Frontend Build
# ==========================================
log "Building Frontend..."
npm install
# Set API URL to https://hololive.com.cn for production build
export VITE_POCKETBASE_URL="https://$DOMAIN"
npm run build

# ==========================================
# 6. Configure Nginx
# ==========================================
log "Configuring Nginx..."
cat > /etc/nginx/sites-available/$DOMAIN <<EOF
server {
    server_name $DOMAIN;
    root $INSTALL_DIR/dist;
    index index.html;

    # Gzip Compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # Maximum upload size for PocketBase
    client_max_body_size 20M;

    # Frontend (SPA)
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # API Proxy to PocketBase
    location /api/ {
        proxy_pass http://127.0.0.1:$PB_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Map Proxy for embedding http maps under https page
    location /map-proxy/ {
        proxy_pass http://127.0.0.1:18090/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Admin UI Proxy to PocketBase
    location /_/ {
        proxy_pass http://127.0.0.1:$PB_ADMIN_GATE_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # AI Translation Proxy
    location /ai-api/ {
        proxy_pass http://127.0.0.1:$AI_TRANSLATE_PROXY_PORT/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Enable Site
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ==========================================
# 7. Setup SSL (Certbot)
# ==========================================
log "Setting up SSL..."
certbot --nginx --non-interactive --agree-tos --email "$EMAIL" -d "$DOMAIN" --redirect

# ==========================================
# 8. Setup CI/CD SSH Key (GitHub Actions)
# ==========================================
log "Setting up SSH Key for GitHub Actions..."
SSH_KEY_PATH="$HOME/.ssh/gh_deploy_id_rsa"
if [ ! -f "$SSH_KEY_PATH" ]; then
    log "Generating new SSH key pair..."
    mkdir -p "$HOME/.ssh"
    ssh-keygen -t rsa -b 4096 -f "$SSH_KEY_PATH" -N "" -C "github-actions-deploy"
else
    log "SSH key already exists, skipping generation."
fi

# Add to authorized_keys if not present
PUB_KEY=$(cat "${SSH_KEY_PATH}.pub")
if ! grep -q "$PUB_KEY" "$HOME/.ssh/authorized_keys"; then
    log "Adding public key to authorized_keys..."
    echo "$PUB_KEY" >> "$HOME/.ssh/authorized_keys"
    chmod 600 "$HOME/.ssh/authorized_keys"
    chmod 700 "$HOME/.ssh"
fi

# ==========================================
# 9. Completion
# ==========================================
success "Deployment Complete!"
echo ""
echo "=========================================================="
echo -e "Frontend:   https://$DOMAIN"
echo -e "Admin Panel: https://$DOMAIN/_/"
echo -e "Web Admin:   https://$DOMAIN/<your-admin-key>/webadmin"
echo "=========================================================="
echo -e "PocketBase Superuser: ${GREEN}$EMAIL${NC}"
echo -e "Superuser Password:   ${GREEN}$SUPERUSER_PASS${NC}"
echo "=========================================================="
echo -e "${RED}IMPORTANT: Set a strong custom admin entrance key immediately after first login.${NC}"
echo "=========================================================="
echo -e "${BLUE}=== GitHub Actions Secret: SSH_KEY ===${NC}"
echo -e "${RED}COPY THE CONTENT BELOW AND PASTE INTO GITHUB SECRET 'SSH_KEY'${NC}"
echo ""
cat "$SSH_KEY_PATH"
echo ""
echo "=========================================================="
echo "PLEASE SAVE THESE CREDENTIALS!"
