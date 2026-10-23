#!/usr/bin/env bash
# Starts an isolated PR Guide instance for verification and waits until it is usable.
#   VERIFY_PORT=4390        port to use (default: a free port)
#   VERIFY_MODE=dev         run the Vite dev server instead of the production build
#   VERIFY_REPOS=a/b,c/d    repositories to seed (default: copy the repo list from the seed directory's settings.json)
#   VERIFY_SEED_DIR=path    where to copy settings and saved guides from (default: this checkout's .data/)
#   VERIFY_COPY_DB=0        start with an empty database instead of a snapshot of the seed ryvu.db
#   VERIFY_REBUILD=1        force `pnpm build` even if dist/ looks current
#   VERIFY_STUB_CODEX=1     put a stand-in `codex` first on the server's PATH (see stub-codex.sh); real Codex never runs
set -euo pipefail
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
SCRIPTS="$ROOT/.claude/skills/verify-ryvu/scripts"
STATE="$ROOT/.verify"; mkdir -p "$STATE/evidence" "$STATE/logs"
if [ -f "$STATE/instance.json" ]; then
  echo "An instance is already recorded in $STATE/instance.json. Run doctor.sh to check it, or cleanup.sh to stop it." >&2; exit 1
fi
cd "$ROOT"
[ -d node_modules ] || pnpm install --frozen-lockfile
MODE=${VERIFY_MODE:-prod}; SEED=${VERIFY_SEED_DIR:-$ROOT/.data}

if [ "$MODE" = prod ] && { [ "${VERIFY_REBUILD:-0}" = 1 ] || [ ! -f dist/client/_shell.html ] || [ ! -f dist/server/server.js ] || [ -n "$(find src scripts vite.config.ts package.json -newer dist/client/_shell.html -type f -print -quit)" ]; }; then
  echo "building…"; pnpm -s build
fi

PORT=${VERIFY_PORT:-$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")}
DATA="$STATE/data-$PORT"; LOG="$STATE/logs/server-$PORT.log"
rm -rf "$DATA"; mkdir -p "$DATA"; chmod 700 "$DATA"

if [ -n "${VERIFY_REPOS:-}" ]; then
  node -e "const r=process.argv[1].split(',').map(s=>s.trim()).filter(Boolean);require('fs').writeFileSync(process.argv[2],JSON.stringify({repos:r,pageSize:25,showDrafts:true,showBots:true},null,2))" "$VERIFY_REPOS" "$DATA/settings.json"
elif [ -f "$SEED/settings.json" ]; then
  cp "$SEED/settings.json" "$DATA/settings.json"
else
  echo "warning: no repositories to seed (set VERIFY_REPOS=owner/repo). The inbox will be empty." >&2
fi
if [ "${VERIFY_COPY_DB:-1}" = 1 ] && [ -f "$SEED/ryvu.db" ]; then
  # A consistent snapshot of saved guides and drafts, taken without writing to the source database.
  node --disable-warning=ExperimentalWarning -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync(process.argv[1],{readOnly:true}).exec(\"VACUUM INTO '\"+process.argv[2].replace(/'/g,\"''\")+\"'\")" "$SEED/ryvu.db" "$DATA/ryvu.db"
fi

SERVER_PATH=$PATH; STUBS=""
if [ "${VERIFY_STUB_CODEX:-0}" = 1 ]; then
  STUBS="$DATA/stubs"; mkdir -p "$STUBS/bin"; cp "$SCRIPTS/stub-codex.sh" "$STUBS/bin/codex"; chmod 755 "$STUBS/bin/codex"; SERVER_PATH="$STUBS/bin:$PATH"
fi

# Node is started directly, without a package-manager wrapper, so the recorded pid is the server itself.
if [ "$MODE" = dev ]; then ENTRY="node_modules/vite/bin/vite.js"; ARGS=(dev); PORT_VAR=WEB_PORT; else ENTRY="scripts/start.mjs"; ARGS=(); PORT_VAR=PORT; fi
env "$PORT_VAR=$PORT" PR_GUIDE_DATA_DIR="$DATA" PATH="$SERVER_PATH" VERIFY_STUB_DIR="$STUBS" nohup node --disable-warning=ExperimentalWarning "$ENTRY" ${ARGS[@]+"${ARGS[@]}"} > "$LOG" 2>&1 &
PID=$!
ready() { [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")" = 200 ]; }
for _ in $(seq 1 120); do
  if ! kill -0 "$PID" 2>/dev/null; then echo "server exited during startup:" >&2; cat "$LOG" >&2; rm -rf "$DATA"; exit 1; fi
  ready && break; sleep 0.5
done
if ! ready; then echo "server did not become ready; see $LOG" >&2; kill "$PID"; rm -rf "$DATA"; exit 1; fi
node -e "const [file,pid,port,mode,entry,data,log,stubs]=process.argv.slice(1);require('fs').writeFileSync(file,JSON.stringify({pid:+pid,port:+port,url:'http://127.0.0.1:'+port,mode,entry,dataDir:data,log,stubDir:stubs||null,startedAt:new Date().toISOString()},null,2))" "$STATE/instance.json" "$PID" "$PORT" "$MODE" "$ENTRY" "$DATA" "$LOG" "$STUBS"
echo "ready: http://127.0.0.1:$PORT ($MODE, pid $PID, data $DATA)"
