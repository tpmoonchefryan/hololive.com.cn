#!/usr/bin/env bash
# Maintenance entry point for an inventoried existing host.
set -euo pipefail
cd "$(dirname "$0")"
exec node scripts/deployment.mjs "$@"
