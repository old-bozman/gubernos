#!/bin/bash
# Release: what people get. `main` is what install.sh, update.sh and the SETUP.md link fetch, so work happens on `dev` and
# reaches `main` only through here: the tests pass, then main moves forward to this commit (fast-forward only).
# The developer's own install runs from a separate checkout of main (~/gubernos-live, a git worktree), so edits on dev
# don't reach it until they're released: this brings it up to date and restarts it.
#   scripts/release.sh          from a clean `dev` that is pushed
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(git rev-parse --abbrev-ref HEAD)" == dev ]] || { echo "error: release from the dev branch" >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "error: uncommitted changes — commit them to dev first" >&2; exit 1; }
git fetch -q origin
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/dev)" ]] || { echo "error: push dev first (git push)" >&2; exit 1; }
git merge-base --is-ancestor origin/main HEAD || { echo "error: main has commits dev doesn't: merge origin/main into dev first" >&2; exit 1; }
echo "tests…"; npm test --silent >/dev/null 2>&1 || { npm test; echo "✗ not released: the tests failed" >&2; exit 1; }
echo "✓ tests"
before=$(git rev-parse --short origin/main)
git push -q origin HEAD:main
git fetch -q origin
echo "✓ released $before → $(git rev-parse --short origin/main):"
git log --oneline "$before..origin/main" | sed 's/^/  /'
LIVE="${GUBERNOS_LIVE:-$HOME/gubernos-live}"
if [[ -e "$LIVE/.git" ]]; then
  git -C "$LIVE" merge -q --ff-only origin/main
  ( cd "$LIVE" && npm ci --silent --no-audit --no-fund && scripts/setup.sh restart )
  echo "✓ $LIVE at $(git -C "$LIVE" rev-parse --short HEAD)"
fi
