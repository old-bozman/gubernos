#!/bin/bash
# Publishes site/ (gubernos.app: privacy policy, support) to the gh-pages branch, which GitHub Pages serves
# (Settings → Pages → Deploy from a branch → gh-pages, / (root); a public repository on a free plan). Run after changing site/.
set -euo pipefail
cd "$(dirname "$0")/.."
git push origin "$(git subtree split --prefix site HEAD)":refs/heads/gh-pages --force
echo "✓ site/ → gh-pages"
