#!/usr/bin/env bash
# Stops the instance launch.sh started and removes its scratch data. Evidence in .verify/evidence/ is kept.
set -uo pipefail
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
INSTANCE="$ROOT/.verify/instance.json"
[ -f "$INSTANCE" ] || { echo "nothing to clean up"; exit 0; }
read -r PID PORT DATA ENTRY < <(node -e "const i=require(process.argv[1]);console.log(i.pid,i.port,i.dataDir,i.entry)" "$INSTANCE")
if kill -0 "$PID" 2>/dev/null && ps -o command= -p "$PID" | grep -qF "$ENTRY" && [ "$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" = "$ROOT" ]; then
  kill "$PID"; for _ in $(seq 1 40); do kill -0 "$PID" 2>/dev/null || break; sleep 0.25; done
  kill -0 "$PID" 2>/dev/null && kill -9 "$PID"
  echo "stopped server $PID (port $PORT)"
else
  echo "pid $PID is gone or is not our server; not killing anything"
fi
case "$DATA" in
  "$ROOT/.verify/data-"*)
    for STUB in $(pgrep -f "$DATA/stubs/bin/codex"); do kill -KILL -- "-$STUB" 2>/dev/null && echo "stopped stand-in codex group $STUB"; done
    rm -rf "$DATA"; echo "removed $DATA";;
  *) echo "refusing to remove unexpected data dir $DATA";;
esac
rm -f "$INSTANCE"
echo "evidence kept in $ROOT/.verify/evidence/"
