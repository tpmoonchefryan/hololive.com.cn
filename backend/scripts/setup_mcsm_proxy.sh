#!/usr/bin/env bash
set -euo pipefail

APP_DOMAIN="${APP_DOMAIN:-hololive.com.cn}"
MCSM_PROXY_PORT="${MCSM_PROXY_PORT:-18091}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/${APP_DOMAIN}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_SRC="${SCRIPT_DIR}/mcsm-proxy.service"
SERVICE_DST="/etc/systemd/system/mcsm-proxy.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "[setup_mcsm_proxy] Please run as root."
  exit 1
fi

if [[ ! -f "${SERVICE_SRC}" ]]; then
  echo "[setup_mcsm_proxy] Missing service file: ${SERVICE_SRC}"
  exit 1
fi

if [[ ! -f "${NGINX_SITE}" ]]; then
  echo "[setup_mcsm_proxy] Missing nginx site config: ${NGINX_SITE}"
  exit 1
fi

install -m 644 "${SERVICE_SRC}" "${SERVICE_DST}"
systemctl daemon-reload
systemctl enable mcsm-proxy
systemctl restart mcsm-proxy

if ! grep -q "location /mcsm-api/" "${NGINX_SITE}"; then
  MCSM_PROXY_BLOCK="$(cat <<EOF
    location /mcsm-api/ {
        proxy_pass http://127.0.0.1:${MCSM_PROXY_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
EOF
)"

  tmp_file="$(mktemp)"
  awk -v block="${MCSM_PROXY_BLOCK}" '
    { lines[NR] = $0 }
    END {
      inserted = 0
      target = 0
      for (i = 1; i <= NR; i++) {
        if (lines[i] ~ /location \/_\//) {
          target = i
          break
        }
      }
      if (target == 0) {
        for (i = NR; i >= 1; i--) {
          if (lines[i] ~ /^}/) {
            target = i
            break
          }
        }
      }
      for (i = 1; i <= NR; i++) {
        if (!inserted && i == target) {
          print block
          inserted = 1
        }
        print lines[i]
      }
    }
  ' "${NGINX_SITE}" > "${tmp_file}"

  install -m 644 "${tmp_file}" "${NGINX_SITE}"
  rm -f "${tmp_file}"
fi

nginx -t
systemctl reload nginx

echo "[setup_mcsm_proxy] mcsm-proxy service and nginx route are ready."
