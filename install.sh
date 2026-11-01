#!/bin/bash
# Gubernos for Mac in one line:
#   curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/main/install.sh | bash
# Gets what the app needs without sudo or Homebrew — git (Apple's Command Line Tools), Node (into ~/.gubernos/node when
# there is none), the app (~/gubernos) — then hands over to your AI agent for the rest (SETUP.md: the folder, the
# background service, the interview). Safe to run again: it updates what's there.
set -euo pipefail

REPO="${GUBERNOS_REPO:-https://github.com/old-bozman/gubernos.git}"
DIR="${GUBERNOS_DIR:-$HOME/gubernos}"
NODE_DIR="$HOME/.gubernos/node"
NODE_MAJOR=22

say() { printf '\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }
die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

[[ "$(uname)" == Darwin ]] || die "Gubernos for Mac needs macOS."
say "Gubernos for Mac"

# 1. git: Apple's Command Line Tools (a system dialog; run this again when it's done)
if ! xcode-select -p >/dev/null 2>&1 || ! /usr/bin/git --version >/dev/null 2>&1; then
  xcode-select --install >/dev/null 2>&1 || true
  die "macOS is installing the Command Line Tools (a dialog opened: Install). When it finishes, run the same command again."
fi
ok "git"

# 2. Node 20+: the one on this Mac, else our own copy in ~/.gubernos/node (official build, checksum verified)
node_ok() { command -v node >/dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]]; }
[[ -x "$NODE_DIR/bin/node" ]] && export PATH="$NODE_DIR/bin:$PATH"
if ! node_ok; then
  arch="$(uname -m)"; [[ "$arch" == x86_64 ]] && arch=x64
  base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
  tmp="$(mktemp -d)"
  sums="$(curl -fsSL "$base/SHASUMS256.txt")" || die "couldn't reach nodejs.org"
  file="$(printf '%s\n' "$sums" | awk -v a="darwin-$arch.tar.gz" '$2 ~ a"$" {print $2; exit}')"
  [[ -n "$file" ]] || die "no Node build for darwin-$arch"
  say "Getting Node ($file)…"
  curl -fsSL "$base/$file" -o "$tmp/$file"
  want="$(printf '%s\n' "$sums" | awk -v f="$file" '$2 == f {print $1}')"
  [[ "$(shasum -a 256 "$tmp/$file" | cut -d' ' -f1)" == "$want" ]] || die "Node download failed its checksum"
  rm -rf "$NODE_DIR"; mkdir -p "$NODE_DIR"
  tar -xzf "$tmp/$file" -C "$NODE_DIR" --strip-components 1
  rm -rf "$tmp"
  export PATH="$NODE_DIR/bin:$PATH"
  # new terminals find it too
  line='export PATH="$HOME/.gubernos/node/bin:$PATH" # Gubernos: Node'
  grep -qsF "$line" "$HOME/.zprofile" || printf '\n%s\n' "$line" >> "$HOME/.zprofile"
  ok "Node $(node -v) in ~/.gubernos/node (added to ~/.zprofile)"
else
  ok "Node $(node -v)"
fi

# 3. the app
if [[ -d "$DIR/.git" ]]; then
  git -C "$DIR" pull --ff-only --quiet || die "couldn't update $DIR (changed files there? git -C $DIR status)"
  ok "updated $DIR"
else
  [[ -e "$DIR" ]] && die "$DIR exists and isn't Gubernos — move it away, or set GUBERNOS_DIR=another/folder"
  git clone --quiet "$REPO" "$DIR" || die "couldn't download $REPO"
  ok "downloaded to $DIR"
fi
(cd "$DIR" && npm ci --silent --no-audit --no-fund) || die "npm couldn't install the dependencies"
ok "dependencies"

# 4. the rest is a conversation with your AI agent
echo
"$DIR/scripts/setup.sh" check | sed -n '/^Model/,/^Optional/p' | sed '$d'
agent=""
for a in claude codex gemini; do command -v "$a" >/dev/null && { agent="$a"; break; }; done
echo
if [[ -n "$agent" ]]; then
  say "Next: open your agent in the app's folder and say \"run SETUP.md\":"
  echo "  cd $DIR && $agent"
else
  say "Next: install one AI agent (any one), then open it in the app's folder and say \"run SETUP.md\":"
  echo "  Claude (Pro or Max):  curl -fsSL https://claude.ai/install.sh | bash   then: cd $DIR && claude"
  echo "  ChatGPT (Plus/Pro):   npm install -g @openai/codex && codex login     then: cd $DIR && codex"
  echo "  Gemini (API key):     npm install -g @google/gemini-cli               then: cd $DIR && gemini"
fi
echo "It asks a few questions, connects the folder you made on your iPhone and starts Gubernos in the background."
