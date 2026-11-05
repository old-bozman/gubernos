#!/bin/bash
# Gubernos for Mac in one line:
#   curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/main/install.sh | bash
# Gets what the app needs without sudo, Homebrew or Apple's Command Line Tools — Node (into ~/.gubernos/node when there is
# none) and the app (~/.gubernos/app, a download of the GitHub repo; no git) — then hands over to your AI agent for the rest
# (SETUP.md: the folder, the background service, the interview). Safe to run again: it updates what's there.
# --update: only the app and its dependencies, quietly (scripts/update.sh runs it).
# --wizard: then the setup page in the browser instead of the agent (Gubernos.app runs this).
set -euo pipefail

# The app's folder. Not ~/gubernos for a new install: macOS ignores case in folder names, so that's the same folder as the
# default vault (~/Gubernos). An install that's already in ~/gubernos stays there.
DIR="${GUBERNOS_DIR:-}"
if [[ -z "$DIR" ]]; then
  if [[ -f "$HOME/gubernos/.gubernos-version" || -d "$HOME/gubernos/.git" ]]; then DIR="$HOME/gubernos"; else DIR="$HOME/.gubernos/app"; fi
fi
VERSION_FILE="$DIR/.gubernos-version"   # "owner/repo sha" of the download (an install without git)
# the GitHub repo: GUBERNOS_REPO (owner/repo or its URL), else the one this install came from, else ours
REPO="${GUBERNOS_REPO:-$( [[ -f "$VERSION_FILE" ]] && cut -d' ' -f1 "$VERSION_FILE" || true)}"
REPO="${REPO:-old-bozman/gubernos}"; REPO="${REPO#https://github.com/}"; REPO="${REPO%.git}"
BRANCH="${GUBERNOS_BRANCH:-main}"
UPDATE=0; [[ "${1:-}" == --update ]] && UPDATE=1
WIZARD=0; [[ "${1:-}" == --wizard ]] && WIZARD=1 # Gubernos.app: the rest in the browser
NODE_DIR="$HOME/.gubernos/node"
NODE_MAJOR=22

say() { printf '\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }
die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

[[ "$(uname)" == Darwin ]] || die "Gubernos for Mac needs macOS."
[[ $UPDATE == 1 ]] || say "Gubernos for Mac"

# 1. Node 20+: the one on this Mac, else our own copy in ~/.gubernos/node (official build, checksum verified)
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

# Claude Code's installer puts it in ~/.local/bin, which a new Mac doesn't have on PATH ("claude: command not found"):
# add it for new terminals, and here so the agent is found below
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *)
  export PATH="$HOME/.local/bin:$PATH"
  line='export PATH="$HOME/.local/bin:$PATH" # Gubernos: Claude Code'
  grep -qsF "$line" "$HOME/.zprofile" || printf '\n%s\n' "$line" >> "$HOME/.zprofile"
  ok "~/.local/bin on PATH (added to ~/.zprofile)" ;;
esac

# 2. the app: a git checkout (a developer's clone) updates with git; otherwise the repo's files as a download.
# AICODE-NOTE: never call git unless the Command Line Tools are there: on a clean Mac /usr/bin/git is a stub that opens
# Apple's install dialog (which wants ~19 GB free). The download needs only curl, tar and rsync, which macOS has.
download() {
  local sha tmp
  sha="$(curl -fsSL -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$REPO/commits/$BRANCH")" || die "couldn't reach GitHub ($REPO)"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "GitHub didn't say which version of $REPO is current"
  if [[ -f "$VERSION_FILE" && "$(cut -d' ' -f2 "$VERSION_FILE")" == "$sha" ]]; then ok "up to date (${sha:0:7})"; return; fi
  tmp="$(mktemp -d)"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$sha" | tar -xz -C "$tmp" --strip-components 1 || die "couldn't download $REPO"
  mkdir -p "$DIR"
  # the kit as it was, so an update can tell what changed in it (SETUP.md → Updating)
  if [[ -d "$DIR/kit/vault" ]]; then rm -rf "$DIR/.kit-previous"; cp -R "$DIR/kit/vault" "$DIR/.kit-previous"; fi
  # replace the app's files; keep what it made here (data, dependencies, logs: the repo's .gitignore)
  rsync -a --delete --exclude-from="$tmp/.gitignore" --exclude=/.kit-previous/ --exclude=/.gubernos-version "$tmp/" "$DIR/" || die "couldn't copy the app into $DIR"
  printf '%s %s\n' "$REPO" "$sha" > "$VERSION_FILE"
  rm -rf "$tmp"
  ok "Gubernos ${sha:0:7} in $DIR"
}
# AICODE-NOTE: the download replaces everything in $DIR that isn't in the repo. A vault in the same folder (an install from
# when both were ~/gubernos and ~/Gubernos) would be deleted, so stop before touching anything.
if [[ -f "$DIR/profile.md" ]]; then
  die "$DIR holds your own files as well as the app, so updating it would delete them. Nothing was changed. How to move the app out: https://github.com/old-bozman/gubernos/blob/main/SETUP.md#when-the-update-says-the-folder-also-holds-the-persons-files"
fi
if [[ -d "$DIR/.git" ]]; then
  xcode-select -p >/dev/null 2>&1 || die "$DIR is a git checkout but git isn't installed (xcode-select --install)"
  git -C "$DIR" pull --ff-only --quiet || die "couldn't update $DIR (changed files there? git -C $DIR status)"
  ok "updated $DIR"
elif [[ -e "$DIR" && ! -f "$VERSION_FILE" ]]; then
  die "$DIR exists and isn't Gubernos — move it away, or set GUBERNOS_DIR=another/folder"
else
  download
fi
(cd "$DIR" && npm ci --silent --no-audit --no-fund) || die "npm couldn't install the dependencies"
ok "dependencies"
[[ $UPDATE == 1 ]] && exit 0
# --wizard (Gubernos.app): the rest in the browser instead of a conversation with an agent; it exits when the app takes over
if [[ $WIZARD == 1 ]]; then exec node "$DIR/scripts/first-run.mjs"; fi

# 3. the rest is a conversation with your AI agent
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
  echo "  Claude (Pro or Max):  curl -fsSL https://claude.ai/install.sh | bash   then: cd $DIR && ~/.local/bin/claude"
  echo "  ChatGPT (Plus/Pro):   npm install -g @openai/codex && codex login     then: cd $DIR && codex"
  echo "  Gemini (API key):     npm install -g @google/gemini-cli               then: cd $DIR && gemini"
fi
echo "It asks a few questions, connects the folder you made on your iPhone and starts Gubernos in the background."
