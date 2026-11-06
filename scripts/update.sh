#!/bin/bash
# Update the app: get the latest version, install dependencies, restart. Prints what changed in the vault kit so the
# agent can bring the owner's vault up to date (the kit is never copied over files that exist — see SETUP.md → "Updating").
# A git checkout pulls; an install without git (install.sh) downloads the repo again (install.sh --update).
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP"
restart() {
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
GUBERNOS_DIR="$APP" bash "$APP/install.sh" --update
read -r repo after < .gubernos-version
restart
if [[ "$before" == "$after" ]]; then echo "Already up to date."; exit 0; fi
echo "Updated ${before:0:7} → ${after:0:7}: https://github.com/$repo/compare/${before:0:12}...${after:0:12}"
if [[ -d .kit-previous ]] && ! diff -rq .kit-previous kit/vault >/dev/null; then
  echo; echo "Vault kit changed — apply these to the vault (ask your agent: \"update my vault from the kit\"; the old kit is in .kit-previous/):"
  diff -rq .kit-previous kit/vault | sed "s/^/  /"
fi
