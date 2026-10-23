#!/usr/bin/env bash
# Read-only: is the recorded verification instance worth driving? Exits non-zero if not.
set -uo pipefail
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
INSTANCE="$ROOT/.verify/instance.json"; HARNESS="$ROOT/.claude/skills/verify-ryvu/.harness"; fail=0
ok() { echo "ok    $*"; }; bad() { echo "FAIL  $*"; fail=1; }; warn() { echo "warn  $*"; }
[ -f "$INSTANCE" ] || { bad "no instance recorded ($INSTANCE); run launch.sh"; exit 1; }
read -r PID PORT DATA MODE ENTRY < <(node -e "const i=require(process.argv[1]);console.log(i.pid,i.port,i.dataDir,i.mode,i.entry)" "$INSTANCE")
if kill -0 "$PID" 2>/dev/null && ps -o command= -p "$PID" | grep -qF "$ENTRY"; then ok "$MODE server process $PID is running $ENTRY"; else bad "process $PID is not our server"; fi
[ "$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" = "$ROOT" ] && ok "it runs in $ROOT" || bad "process $PID does not run in $ROOT"
LISTENER=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
[ "$LISTENER" = "$PID" ] && ok "port $PORT is owned by pid $PID" || bad "port $PORT is owned by '${LISTENER:-nobody}', not $PID"
CMD_ENV=$(ps -E -o command= -p "$PID" 2>/dev/null || true)
echo "$CMD_ENV" | grep -q "PR_GUIDE_DATA_DIR=$DATA" && ok "isolated data dir $DATA" || warn "could not confirm PR_GUIDE_DATA_DIR from the process environment"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Host: evil.example:$PORT" "http://127.0.0.1:$PORT/")" = 403 ] && ok "a foreign Host header is refused" || bad "a foreign Host header was not refused"
if [ -f "$HARNESS/node_modules/playwright/package.json" ]; then
  ok "browser harness installed"
  REPOS=$(node -e "
    const { chromium } = require(process.argv[1]);
    (async () => {
      const browser = await chromium.launch(), page = await browser.newPage();
      try { await page.goto(process.argv[2] + '/settings'); await page.waitForSelector('.repo-list, .add-repo', { timeout: 60000 }); console.log((await page.locator('.repo-text > a').allInnerTexts()).join(',') || '-'); }
      catch (error) { console.log('?'); } finally { await browser.close(); }
    })();" "$HARNESS/node_modules/playwright" "http://127.0.0.1:$PORT")
  case "$REPOS" in '?') bad "the Settings page did not load in a browser";; -) warn "no repositories configured; inbox journeys will find nothing";; *) ok "the app connects in a browser; seeded repositories: $REPOS";; esac
else
  bad "browser harness missing; run setup.sh"
fi
gh auth status >/dev/null 2>&1 && ok "gh is signed in ($(gh api user --jq .login 2>/dev/null))" || bad "gh is not signed in; GitHub-backed pages will fail"
if [ "$MODE" = prod ]; then
  STALE=$(cd "$ROOT" && find src scripts vite.config.ts package.json -newer dist/client/_shell.html -type f -print -quit 2>/dev/null)
  [ -z "$STALE" ] && ok "build is newer than the sources" || warn "sources changed since the build ($STALE); cleanup.sh then launch.sh to rebuild"
fi
exit $fail
