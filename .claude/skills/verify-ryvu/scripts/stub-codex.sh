#!/bin/sh
echo "$$" > "$VERIFY_STUB_DIR/codex.pid"
trap 'echo "SIGTERM $(date +%s)" >> "$VERIFY_STUB_DIR/codex.log"' TERM
sleep 600 &
echo "$!" > "$VERIFY_STUB_DIR/grandchild.tmp" && mv "$VERIFY_STUB_DIR/grandchild.tmp" "$VERIFY_STUB_DIR/grandchild.pid"
while :; do sleep 0.2; done
