#!/usr/bin/env bash
set -euo pipefail

APP_DOMAIN="${APP_DOMAIN:-hololive.com.cn}"
PB_ADMIN_GATE_PORT="${PB_ADMIN_GATE_PORT:-18092}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/${APP_DOMAIN}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_SRC="${SCRIPT_DIR}/pb-admin-gate.service"
SERVICE_DST="/etc/systemd/system/pb-admin-gate.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "[setup_pb_admin_gate] Please run as root."
  exit 1
fi

if [[ ! -f "${SERVICE_SRC}" ]]; then
  echo "[setup_pb_admin_gate] Missing service file: ${SERVICE_SRC}"
  exit 1
fi

if [[ ! -f "${NGINX_SITE}" ]]; then
  echo "[setup_pb_admin_gate] Missing nginx site config: ${NGINX_SITE}"
  exit 1
fi

install -m 644 "${SERVICE_SRC}" "${SERVICE_DST}"
systemctl daemon-reload
systemctl enable pb-admin-gate
systemctl restart pb-admin-gate

PB_ADMIN_GATE_BLOCK="$(cat <<EOF
    location /_/ {
        proxy_pass http://127.0.0.1:${PB_ADMIN_GATE_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
EOF
)"

tmp_file="$(mktemp)"

if grep -q "location /_/" "${NGINX_SITE}"; then
  awk -v block="${PB_ADMIN_GATE_BLOCK}" '
    function brace_delta(line, open_count, close_count, tmp) {
      tmp = line;
      open_count = gsub(/\{/, "{", tmp);
      close_count = gsub(/\}/, "}", tmp);
      return open_count - close_count;
    }
    {
      if (!in_block && $0 ~ /^[[:space:]]*location \/_\/[[:space:]]*\{[[:space:]]*$/) {
        print block;
        in_block = 1;
        depth = brace_delta($0);
        next;
      }

      if (in_block) {
        depth += brace_delta($0);
        if (depth <= 0) {
          in_block = 0;
        }
        next;
      }

      print $0;
    }
  ' "${NGINX_SITE}" > "${tmp_file}"
else
  awk -v block="${PB_ADMIN_GATE_BLOCK}" '
    { lines[NR] = $0 }
    END {
      inserted = 0
      target = 0

      for (i = 1; i <= NR; i++) {
        if (lines[i] ~ /location \/api\//) {
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

      if (target == 0) {
        target = NR + 1
      }

      for (i = 1; i <= NR; i++) {
        if (!inserted && i == target) {
          print block
          inserted = 1
        }
        print lines[i]
      }

      if (!inserted) {
        print block
      }
    }
  ' "${NGINX_SITE}" > "${tmp_file}"
fi

install -m 644 "${tmp_file}" "${NGINX_SITE}"
rm -f "${tmp_file}"

nginx -t
systemctl reload nginx

echo "[setup_pb_admin_gate] pb-admin-gate service and nginx route are ready."
