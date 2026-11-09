#!/bin/bash
# Update the app: get the latest version, install dependencies, restart. Prints what changed in the vault kit so the
# agent can bring the owner's vault up to date (the kit is never copied over files that exist — see SETUP.md → "Updating").
# A git checkout pulls; an install without git (install.sh) downloads the repo again (install.sh --update).
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP"
# run by the app itself at night (lib/update.js): its output goes to data/update.log
[[ -n "${GUBERNOS_UPDATE_LOG:-}" ]] && exec >>"$GUBERNOS_UPDATE_LOG" 2>&1
# one at a time
lock="$APP/data/.updating"; mkdir -p "$APP/data"
if ! mkdir "$lock" 2>/dev/null; then echo "An update is already running."; exit 0; fi
trap 'rmdir "$lock" 2>/dev/null || true' EXIT
answers() { # the app answers on its port within a minute
  local port; port=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).port||4747)}catch{console.log(4747)}' "${GUBERNOS_CONFIG_DIR:-$HOME/.config/gubernos}/config.json")
  for _ in $(seq 1 "${GUBERNOS_UPDATE_WAIT:-30}"); do curl -sf "http://127.0.0.1:$port/api/state" >/dev/null && return 0; sleep 2; done
  return 1
}
restart() {
  if [[ -n "${GUBERNOS_RESTART_CMD:-}" ]]; then bash -c "$GUBERNOS_RESTART_CMD"; return; fi # tests: never the real service
  if [[ "$(uname)" == Linux ]]; then "$APP/scripts/setup.sh" restart >/dev/null 2>&1 || echo "(no background service — start with npm start)"
  else launchctl kickstart -k "gui/$(id -u)/com.${USER}.gubernos" 2>/dev/null || echo "(no background service — start with npm start)"; fi
}

if [[ -d .git ]]; then
  before=$(git rev-parse HEAD)
  git pull --ff-only --quiet
  after=$(git rev-parse HEAD)
  npm ci --silent --no-audit --no-fund
  restart
  if [[ "$before" == "$after" ]]; then echo "Already up to date."; exit 0; fi
  echo "Updated ${before:0:7} → ${after:0:7}"
  git log --oneline "$before..$after" | sed 's/^/  /'
  if ! git diff --quiet "$before" "$after" -- kit/vault; then
    echo; echo "Vault kit changed — apply these to the vault (ask your agent: \"update my vault from the kit\"):"
    git diff --stat "$before" "$after" -- kit/vault | sed 's/^/  /'
  fi
  exit 0
fi

[[ -f .gubernos-version ]] || { echo "error: $APP is neither a git checkout nor an install by install.sh" >&2; exit 1; }
read -r repo before < .gubernos-version
# the version before, kept: a new one that doesn't start goes back to it, so a bad release can't leave anyone without the app
prev="$HOME/.gubernos/app-previous"
keep=(--checksum --exclude=/node_modules/ --exclude=/data/ --exclude=/.venv/ --exclude=/server.log) # by content: a version file of the same size and second would be skipped
mkdir -p "$prev" && rsync -a --delete "${keep[@]}" "$APP/" "$prev/"
GUBERNOS_DIR="$APP" bash "$APP/install.sh" --update
read -r repo after < .gubernos-version
restart
if [[ "$before" == "$after" ]]; then echo "Already up to date."; exit 0; fi
if [[ -z "${GUBERNOS_NO_LAUNCHD:-}" ]] && ! answers; then
  echo "The new version ${after:0:7} didn't start: going back to ${before:0:7}"
  rsync -a --delete "${keep[@]}" "$prev/" "$APP/"
  npm ci --silent --no-audit --no-fund || true
  restart
  answers && echo "Back on ${before:0:7}." || echo "Still not answering: see $APP/server.log"
  exit 1
fi
echo "Updated ${before:0:7} → ${after:0:7}: https://github.com/$repo/compare/${before:0:12}...${after:0:12}"
if [[ -d .kit-previous ]] && ! diff -rq .kit-previous kit/vault >/dev/null; then
  echo; echo "Vault kit changed — apply these to the vault (ask your agent: \"update my vault from the kit\"; the old kit is in .kit-previous/):"
  diff -rq .kit-previous kit/vault | sed "s/^/  /"
fi
