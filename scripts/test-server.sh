#!/bin/bash
# A test server on a copy of the vault — never test writes against the real one. Its own data dir, no notifier.
#   scripts/test-server.sh start [port]   copy the vault (no attachments, no archive) to a temp dir, start the server there
#   scripts/test-server.sh stop [port]    stop the server on that port (by its PID)
# Default port 8799. Prints the URL and where the copy is (read it to check what a change wrote).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${2:-8799}"
case "${1:-}" in
  start)
    if lsof -ti ":$PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "port $PORT is busy — stop it first or pick another" >&2; exit 1; fi
    VAULT="$(node -e "import('./lib/config.js').then((m) => console.log(m.VAULT))")"
    DIR="$(mktemp -d "${TMPDIR:-/tmp}/gubernos-test.XXXXXX")"
    rsync -a --exclude 40_reference/attachments --exclude 80_archive "$VAULT/" "$DIR/vault/"
    mkdir -p "$DIR/vault/80_archive" "$DIR/data"
    GUBERNOS_VAULT="$DIR/vault" GUBERNOS_DATA_DIR="$DIR/data" GUBERNOS_NO_NOTIFY=1 GUBERNOS_TRIAGE=0 GUBERNOS_MAC_FOCUS=0 GUBERNOS_PAIR_FILE="$DIR/data/pair.json" GUBERNOS_FEEDBACK_RELAY= GUBERNOS_FEEDBACK_INBOX= PORT="$PORT" HOST=127.0.0.1 \
      nohup node server.js > "$DIR/server.log" 2>&1 &
    for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$PORT/api/settings" && break; sleep 0.3; done
    echo "http://127.0.0.1:$PORT · vault copy: $DIR/vault · log: $DIR/server.log"
    ;;
  stop)
    PID="$(lsof -ti ":$PORT" -sTCP:LISTEN || true)"
    [[ -n "$PID" ]] && kill $PID && echo "stopped $PORT" || echo "nothing on $PORT"
    ;;
  *) echo "usage: scripts/test-server.sh start|stop [port]" >&2; exit 2 ;;
esac
