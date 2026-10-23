#!/usr/bin/env bash
# Installs the browser harness (Playwright + Chromium) into this skill's .harness/ directory. Safe to rerun.
set -euo pipefail
SKILL=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$SKILL/.harness"
cd "$SKILL/.harness"
[ -f package.json ] || echo '{ "name": "verify-ryvu-harness", "private": true }' > package.json
npm install --silent --no-audit --no-fund playwright@1.57 >/dev/null
npx --yes playwright install chromium >/dev/null
node -e "require('playwright'); console.log('harness ready: ' + require('playwright/package.json').version)"
