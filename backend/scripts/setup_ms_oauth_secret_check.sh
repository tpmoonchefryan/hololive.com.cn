#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_SRC="${SCRIPT_DIR}/ms-oauth-secret-check.service"
TIMER_SRC="${SCRIPT_DIR}/ms-oauth-secret-check.timer"
SERVICE_DST="/etc/systemd/system/ms-oauth-secret-check.service"
TIMER_DST="/etc/systemd/system/ms-oauth-secret-check.timer"

if [[ "${EUID}" -ne 0 ]]; then
  echo "[setup_ms_oauth_secret_check] Please run as root."
  exit 1
fi

for f in "${SERVICE_SRC}" "${TIMER_SRC}"; do
  if [[ ! -f "${f}" ]]; then
    echo "[setup_ms_oauth_secret_check] Missing unit file: ${f}"
    exit 1
  fi
done

install -m 644 "${SERVICE_SRC}" "${SERVICE_DST}"
install -m 644 "${TIMER_SRC}" "${TIMER_DST}"
chmod +x "${SCRIPT_DIR}/check_ms_oauth_secret.py"

systemctl daemon-reload
# 只启用 timer。service 是 oneshot，由 timer 拉起，不需要 enable。
systemctl enable ms-oauth-secret-check.timer
systemctl restart ms-oauth-secret-check.timer

echo "[setup_ms_oauth_secret_check] Timer installed. Next run:"
systemctl list-timers ms-oauth-secret-check.timer --no-pager || true
