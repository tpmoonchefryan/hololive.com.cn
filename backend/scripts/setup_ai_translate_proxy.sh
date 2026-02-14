#!/usr/bin/env bash
set -euo pipefail

APP_DOMAIN="${APP_DOMAIN:-hololive.com.cn}"
AI_TRANSLATE_PROXY_PORT="${AI_TRANSLATE_PROXY_PORT:-18093}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/${APP_DOMAIN}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_SRC="${SCRIPT_DIR}/ai-translate-proxy.service"
SERVICE_DST="/etc/systemd/system/ai-translate-proxy.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "[setup_ai_translate_proxy] Please run as root."
  exit 1
fi

if [[ ! -f "${SERVICE_SRC}" ]]; then
  echo "[setup_ai_translate_proxy] Missing service file: ${SERVICE_SRC}"
  exit 1
fi

if [[ ! -f "${NGINX_SITE}" ]]; then
  echo "[setup_ai_translate_proxy] Missing nginx site config: ${NGINX_SITE}"
  exit 1
fi

install -m 644 "${SERVICE_SRC}" "${SERVICE_DST}"
systemctl daemon-reload
systemctl enable ai-translate-proxy
systemctl restart ai-translate-proxy

AI_TRANSLATE_BLOCK="$(cat <<EOF
    location /ai-api/ {
        proxy_pass http://127.0.0.1:${AI_TRANSLATE_PROXY_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
EOF
)"

tmp_file="$(mktemp)"

if grep -q "location /ai-api/" "${NGINX_SITE}"; then
  awk -v block="${AI_TRANSLATE_BLOCK}" '
    function brace_delta(line, open_count, close_count, tmp) {
      tmp = line;
      open_count = gsub(/\{/, "{", tmp);
      close_count = gsub(/\}/, "}", tmp);
      return open_count - close_count;
    }
    {
      if (!in_block && $0 ~ /^[[:space:]]*location \/ai-api\/[[:space:]]*\{[[:space:]]*$/) {
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
  awk -v block="${AI_TRANSLATE_BLOCK}" '
    { lines[NR] = $0 }
    END {
      inserted = 0
      target = 0

      for (i = 1; i <= NR; i++) {
        if (lines[i] ~ /location \/mcsm-api\//) {
          target = i
          break
        }
      }

      if (target == 0) {
        for (i = 1; i <= NR; i++) {
          if (lines[i] ~ /location \/_\//) {
            target = i
            break
          }
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

echo "[setup_ai_translate_proxy] ai-translate-proxy service and nginx route are ready."
