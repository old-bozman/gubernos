#!/bin/bash
# Installs Gubernos on this Mac. An agent (Claude Code, Codex or Gemini CLI) runs it step by step from SETUP.md; each step
# is safe to repeat.
#
#   scripts/setup.sh check                       what's installed, what's missing
#   scripts/setup.sh install --vault PATH --name NAME [--language LANG]     (PATH in iCloud; --local only for tests)
#                            [--obsidian-vault NAME --obsidian-path SUB] [--port 4747] [--no-launchd] [--awake]
#                            [--model claude|codex|gemini]
#   scripts/setup.sh model claude|codex|gemini   the model behind the app (lib/llm.js; Settings → Agents → Model)
#   scripts/setup.sh phone                       HTTPS for the phone via Tailscale (tailscale serve)
#   scripts/setup.sh voice                       local speech-to-text (MLX Whisper, Apple Silicon)
#   scripts/setup.sh obsidian                    Dataview + Templater plugins in a vault that is its own Obsidian vault
#   scripts/setup.sh calendar                    Plan the day reads this Mac's calendars (asks macOS for access: a dialog)
#   scripts/setup.sh awake on|off|status         keep the Mac awake on power (caffeinate -s as a login item) so the phone app works
#   scripts/setup.sh restart | status
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
# Node from install.sh (~/.gubernos/node), also when this shell started before it was put on PATH (an agent session)
[[ -x "$HOME/.gubernos/node/bin/node" ]] && export PATH="$HOME/.gubernos/node/bin:$PATH"
LABEL="com.${USER}.gubernos"
AWAKE_LABEL="com.${USER}.gubernos-awake"
AGENTS_DIR="${GUBERNOS_LAUNCH_AGENTS:-$HOME/Library/LaunchAgents}"
KIT="node $APP/scripts/kit.mjs"
ok() { printf '  ✓ %s\n' "$1"; }
no() { printf '  ✗ %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }
port() { local p; p=$($KIT get port 2>/dev/null || true); echo "${p:-4747}"; }

check() {
  echo "Required"
  [[ "$(uname)" == Darwin ]] && ok "macOS $(sw_vers -productVersion)" || no "macOS (this is $(uname))"
  if command -v node >/dev/null; then
    v=$(node -p 'process.versions.node.split(".")[0]'); [[ $v -ge 20 ]] && ok "node $(node -v)" || no "node $(node -v) — need 20+ (run the installer again, or brew install node)"
  else no "node — run the installer again: curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/main/install.sh | bash"; fi
  echo "Model (one is enough — on your own subscription or account)"
  models
  echo "Optional"
  gh auth status >/dev/null 2>&1 && ok "gh (GitHub) logged in" || no "gh (GitHub) — only for sending bug reports from the app: brew install gh && gh auth login"
  [[ -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ]] && ok "iCloud Drive" || no "iCloud Drive (System Settings → Apple Account → iCloud → iCloud Drive)"
  [[ -d /Applications/Obsidian.app ]] && ok "Obsidian app" || no "Obsidian (optional, to read the files: https://obsidian.md)"
  [[ -d "$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents" ]] && ok "Obsidian iCloud folder" || no "Obsidian iCloud folder (appears once Obsidian on iPhone/Mac stores a vault in iCloud)"
  (command -v tailscale >/dev/null || [[ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]]) && ok "Tailscale" || no "Tailscale (optional, for the phone: https://tailscale.com/download)"
  [[ "$(uname -m)" == arm64 ]] && ok "Apple Silicon (voice works)" || no "Apple Silicon (voice capture needs it)"
  command -v ffmpeg >/dev/null && ok "ffmpeg (voice)" || no "ffmpeg — voice transcription needs it: brew install ffmpeg"
  if [[ -f "$HOME/.config/gubernos/config.json" ]]; then ok "configured: $(tr -d '\n' < "$HOME/.config/gubernos/config.json" | cut -c1-160)"; fi
}

# the model CLIs here, and whether each is signed in (as far as it can be told without calling the model)
models() {
  if command -v claude >/dev/null; then ok "Claude Code $(claude --version 2>/dev/null | head -1) — a Claude Pro or Max plan"
  else no "Claude Code — curl -fsSL https://claude.ai/install.sh | bash, then: claude (sign in)"; fi
  if command -v codex >/dev/null; then
    codex login status >/dev/null 2>&1 && ok "Codex (ChatGPT) — signed in" || no "Codex is installed, not signed in: codex login"
  else no "Codex (ChatGPT Plus or Pro) — npm install -g @openai/codex, then: codex login"; fi
  if command -v gemini >/dev/null; then
    # Login with Google no longer works for Gemini CLI ("no longer supported for Gemini Code Assist for individuals"): an API key
    if [[ -n "${GEMINI_API_KEY:-}" ]] || grep -qs '^GEMINI_API_KEY=.' "$HOME/.gemini/.env"; then ok "Gemini CLI — API key set"
    else no "Gemini CLI is installed, no API key: get one at https://aistudio.google.com/apikey, put GEMINI_API_KEY=… in ~/.gemini/.env"; fi
  else no "Gemini CLI (a Gemini API key, free tier) — npm install -g @google/gemini-cli, then GEMINI_API_KEY=… in ~/.gemini/.env (key: https://aistudio.google.com/apikey)"; fi
  local cur; cur=$(cd "$APP" && node -e "import('./lib/llm.js').then((m) => console.log(m.providers().chosen || ''))" 2>/dev/null || true)
  [[ -n "$cur" ]] && ok "the app uses: $cur" || true
}
model() {
  [[ "${1:-}" =~ ^(claude|codex|gemini)$ ]] || die "model claude|codex|gemini"
  (cd "$APP" && node -e "import('./lib/settings.js').then((m) => m.update({ provider: process.argv[1] }))" "$1") && ok "the app's model: $1 (Settings → Agents → Model)"
}

render() { # template → plist
  sed -e "s#{{LABEL}}#$2#g" -e "s#{{NODE}}#$(command -v node)#g" -e "s#{{APP}}#$APP#g" -e "s#{{HOME}}#$HOME#g" \
      -e "s#{{PATH}}#$HOME/.local/bin:$(dirname "$(command -v node)"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin#g" "$1"
}

load() { # label plist
  local uid; uid=$(id -u)
  launchctl bootout "gui/$uid/$1" 2>/dev/null || true
  for _ in $(seq 1 20); do launchctl print "gui/$uid/$1" >/dev/null 2>&1 || break; sleep 0.5; done # bootout finishes asynchronously
  launchctl bootstrap "gui/$uid" "$2"
}

wait_up() {
  for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$(port)/api/state" >/dev/null && return 0; sleep 1; done
  return 1
}

install() {
  local vault="" name="" language="" ovault="" opath="" p="" launchd=1 awake=0 local=0 llm=""
  while [[ $# -gt 0 ]]; do case "$1" in
    --vault) vault="$2"; shift 2;; --name) name="$2"; shift 2;; --language) language="$2"; shift 2;;
    --obsidian-vault) ovault="$2"; shift 2;; --obsidian-path) opath="$2"; shift 2;; --port) p="$2"; shift 2;;
    --no-launchd) launchd=0; shift;; --awake) awake=1; shift;; --local) local=1; shift;; --model) llm="$2"; shift 2;; *) die "unknown option $1";; esac; done
  [[ -n "$vault" ]] || die "--vault PATH is required"
  # The vault lives in iCloud (backup, the phone, agents on other Macs): iCloud Drive or Obsidian's iCloud folder.
  # --local only for development and tests.
  vault="${vault/#\~/$HOME}"
  if [[ $local == 0 ]]; then
    [[ -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ]] || die "iCloud Drive is off: System Settings → Apple Account → iCloud → iCloud Drive"
    [[ "$vault" == "$HOME/Library/Mobile Documents/"* ]] || die "the vault must be in iCloud: ~/Library/Mobile Documents/com~apple~CloudDocs/… (iCloud Drive) or ~/Library/Mobile Documents/iCloud~md~obsidian/Documents/… (Obsidian)"
  fi
  command -v node >/dev/null || die "node is missing — run install.sh (see SETUP.md)"
  echo "1/4 dependencies"; (cd "$APP" && npm ci --silent --no-audit --no-fund)
  echo "2/4 vault"; $KIT vault --vault "$vault" ${name:+--name "$name"} ${language:+--language "$language"} ${opath:+--obsidian-path "$opath"}
  echo "3/4 config"; $KIT config --vault "$vault" ${p:+--port "$p"} ${ovault:+--obsidian-vault "$ovault"} ${opath:+--obsidian-path "$opath"} >/dev/null && ok "$HOME/.config/gubernos/config.json"
  [[ -n "$llm" ]] && model "$llm" # after the config: the model is saved next to it
  # Bug reports also go to the app's GitHub repo as issues, unless this is the repo owner's own install.
  local repo me
  if [[ -d "$APP/.git" ]]; then repo=$(git -C "$APP" remote get-url origin 2>/dev/null | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##' || true)
  else repo=$(cut -d' ' -f1 "$APP/.gubernos-version" 2>/dev/null || true); fi
  me=$(gh api user -q .login 2>/dev/null || true)
  if [[ "$repo" == */* && "${repo%%/*}" != "$me" ]]; then
    $KIT config --feedback-repo "$repo" >/dev/null
    if [[ -n "$me" ]]; then ok "bug reports also go to github.com/$repo (as $me)"; else no "bug reports stay local until gh is logged in (gh auth login)"; fi
  fi
  if [[ $launchd == 0 ]]; then echo "4/4 background service skipped (--no-launchd): start with  npm start"; return; fi
  echo "4/4 background service"
  mkdir -p "$AGENTS_DIR"
  render "$APP/deploy/gubernos.plist.template" "$LABEL" > "$AGENTS_DIR/$LABEL.plist"
  load "$LABEL" "$AGENTS_DIR/$LABEL.plist"
  if [[ $awake == 1 ]]; then render "$APP/deploy/gubernos-awake.plist.template" "$AWAKE_LABEL" > "$AGENTS_DIR/$AWAKE_LABEL.plist"; load "$AWAKE_LABEL" "$AGENTS_DIR/$AWAKE_LABEL.plist"; ok "Mac stays awake on power"; fi
  wait_up && ok "running: http://127.0.0.1:$(port)" || { no "the app didn't start — see $APP/server.log"; tail -5 "$APP/server.log"; exit 1; }
}

ts() { command -v tailscale >/dev/null && tailscale "$@" || /Applications/Tailscale.app/Contents/MacOS/Tailscale "$@"; }

phone() {
  ts status >/dev/null 2>&1 || die "Tailscale isn't running or you're not logged in: open the Tailscale app on this Mac and the iPhone, log in with the same account"
  # The first time Tailscale may print a link to enable HTTPS / Serve for the tailnet: open it, approve, and the command continues.
  echo "  If a login.tailscale.com link appears below, open it and approve HTTPS for your tailnet."
  ts serve --bg "$(port)"
  local host; host=$(ts status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')
  $KIT config --public-url "https://$host" >/dev/null
  # pairing (lib/pair.js): a new install lets in only devices that scanned the Mac's code; an existing pair.json is kept
  local pf="${GUBERNOS_CONFIG_DIR:-$HOME/.config/gubernos}/pair.json"
  [[ -f "$pf" ]] || node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({token:require("crypto").randomBytes(24).toString("base64url"),required:true},null,1)+"\n",{mode:0o600})' "$pf"
  restart >/dev/null
  ok "phone URL: https://$host  (only your Tailscale devices can reach it, and only paired ones get in)"
  echo "  Pair the iPhone: open http://127.0.0.1:$(port) on this Mac → Settings → Connections → Pair a device → Show code,"
  echo "  and point the iPhone's Camera at it (the app opens and connects)."
}

voice() {
  [[ "$(uname -m)" == arm64 ]] || die "voice needs Apple Silicon"
  command -v python3 >/dev/null || die "python3 is missing (xcode-select --install)"
  command -v ffmpeg >/dev/null || die "ffmpeg is missing — Whisper decodes audio with it: brew install ffmpeg (then run this again)"
  (cd "$APP" && python3 -m venv .venv && .venv/bin/pip install -q --upgrade pip && .venv/bin/pip install -q mlx-whisper)
  ok "voice ready (models download on first use, ~1.6 GB)"
}

obsidian() {
  local vault; vault=$($KIT get vault) || true
  [[ -n "$vault" ]] || die "run install first"
  local cfg="$vault/.obsidian"
  if [[ -f "$cfg/community-plugins.json" ]]; then ok "plugins already set up in $cfg — leaving them"; return; fi
  mkdir -p "$cfg/plugins"
  for repo in blacksmithgu/obsidian-dataview SilentVoid13/Templater; do
    local id; id=$(curl -sfL "https://github.com/$repo/releases/latest/download/manifest.json" | node -p 'JSON.parse(require("fs").readFileSync(0)).id')
    mkdir -p "$cfg/plugins/$id"
    for f in main.js manifest.json styles.css; do curl -sfL "https://github.com/$repo/releases/latest/download/$f" -o "$cfg/plugins/$id/$f" || true; done
    ok "$id"
  done
  echo '["dataview","templater-obsidian"]' > "$cfg/community-plugins.json"
  echo '{"templates_folder":"91_templates","trigger_on_file_creation":false}' > "$cfg/plugins/templater-obsidian/data.json"
  echo '{"enableDataviewJs":true}' > "$cfg/plugins/dataview/data.json"
  ok "open the folder as a vault in Obsidian and allow community plugins when asked"
}

# caffeinate -s: no system sleep while on power (battery behaves as usual; closing a laptop's lid still sleeps)
awake() {
  local plist="$AGENTS_DIR/$AWAKE_LABEL.plist"
  case "${1:-status}" in
    on) mkdir -p "$AGENTS_DIR"; render "$APP/deploy/gubernos-awake.plist.template" "$AWAKE_LABEL" > "$plist"; load "$AWAKE_LABEL" "$plist"; ok "the Mac stays awake on power (caffeinate -s)";;
    off) launchctl bootout "gui/$(id -u)/$AWAKE_LABEL" 2>/dev/null || true; rm -f "$plist"; ok "normal sleep again";;
    status) if launchctl print "gui/$(id -u)/$AWAKE_LABEL" >/dev/null 2>&1; then ok "staying awake on power"; else no "sleeps as usual (scripts/setup.sh awake on)"; fi; pmset -g assertions | grep -i "PreventSystemSleep " | head -1;;
    *) die "awake on|off|status";;
  esac
}

# The Mac's calendars for Plan the day (Calendar.app, any account added there): build the helper and ask macOS for access
calendar() {
  local out
  out=$(curl -sf -X POST "http://127.0.0.1:$(port)/api/calendar/mac/access" 2>/dev/null) || die "the app isn't answering on $(port) — install first"
  if [[ "$out" == *'"full"'* ]]; then ok "Plan the day reads this Mac's calendars (Settings → Calendar picks which; time blocks go to the default one)"
  else no "no calendar access ($out): System Settings → Privacy & Security → Calendars → Gubernos Calendar → Full Access"; fi
}

restart() { launchctl kickstart -k "gui/$(id -u)/$LABEL" && wait_up && ok "restarted"; }
status() { launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state|pid" | head -2; curl -sf "http://127.0.0.1:$(port)/api/state" >/dev/null && ok "answering on $(port)" || no "not answering on $(port)"; }

cmd="${1:-check}"; shift || true
case "$cmd" in check|install|model|phone|voice|obsidian|awake|calendar|restart|status) "$cmd" "$@";; *) die "unknown command $cmd";; esac
