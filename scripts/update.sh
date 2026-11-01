#!/bin/bash
# Update the app: pull, install dependencies, restart. Prints what changed in the vault kit so Claude Code can
# bring the owner's vault up to date (the kit is never copied over files that exist — see SETUP.md → "Updating").
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP"
before=$(git rev-parse HEAD)
git pull --ff-only --quiet
after=$(git rev-parse HEAD)
npm ci --silent --no-audit --no-fund
launchctl kickstart -k "gui/$(id -u)/com.${USER}.gubernos" 2>/dev/null || echo "(no background service — start with npm start)"
if [[ "$before" == "$after" ]]; then echo "Already up to date."; exit 0; fi
echo "Updated ${before:0:7} → ${after:0:7}"
git log --oneline "$before..$after" | sed 's/^/  /'
if ! git diff --quiet "$before" "$after" -- kit/vault; then
  echo; echo "Vault kit changed — apply these to the vault (ask Claude Code: \"update my vault from the kit\"):"
  git diff --stat "$before" "$after" -- kit/vault | sed 's/^/  /'
fi
