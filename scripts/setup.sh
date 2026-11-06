#!/bin/bash
# Installs Gubernos on this Mac. An agent (Claude Code or Codex) runs it step by step from SETUP.md; each step
# is safe to repeat.
#
#   scripts/setup.sh check                       what's installed, what's missing
#   scripts/setup.sh install --vault PATH --name NAME [--language LANG]     (PATH: ~/Gubernos, or a folder in iCloud / Dropbox)
#                            [--obsidian-vault NAME --obsidian-path SUB] [--port 4747] [--no-launchd] [--awake]
#                            [--model claude|codex] [--voice-language en-US|ru-RU|…|mixed]
#   scripts/setup.sh model claude|codex   the model behind the app (lib/llm.js; Settings → Your Mac → Model)
#   scripts/setup.sh voice-language LOCALE|mixed the language spoken to the app (Settings → Voice; lib/voice.js)
#   scripts/setup.sh phone                       HTTPS for the phone: an https://m-….gubernos.dev address through Cloudflare Tunnel
#                                                (the relay makes it; cloudflared runs here as a background service). Nothing to sign in to
#   scripts/setup.sh phone --tailscale           …through Tailscale Funnel instead (TLS ends on this Mac; a Tailscale account)
#   scripts/setup.sh phone --private             …Tailscale Serve: only your tailnet, so the phone needs Tailscale too
#   scripts/setup.sh get-cloudflared             only that: Cloudflare's signed cloudflared into ~/.gubernos/bin
#   scripts/setup.sh stop-tunnel                 stop the Cloudflare address and delete it (--tailscale / --private do this too)
#   scripts/setup.sh get-tailscale               only that: download Tailscale's installer, check its signature, open it, wait for the login
#   scripts/setup.sh voice                       Whisper (MLX, Apple Silicon): Russian, mixed languages, accents. Without it the
#                                                Mac's own speech models hear one language each (macOS 26+, nothing to install)
#   scripts/setup.sh obsidian                    Dataview + Templater plugins in a vault that is its own Obsidian vault
#   scripts/setup.sh calendar                    Plan the day reads this Mac's calendars (asks macOS for access: a dialog)
#   scripts/setup.sh awake on|off|status         keep the Mac awake on power (caffeinate -s as a login item) so the phone app works
#   scripts/setup.sh restart | status
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
# Node from install.sh (~/.gubernos/node), also when this shell started before it was put on PATH (an agent session)
[[ -x "$HOME/.gubernos/node/bin/node" ]] && export PATH="$HOME/.gubernos/node/bin:$PATH"
# Claude Code's installer puts it in ~/.local/bin, which a new Mac doesn't have on PATH
export PATH="$HOME/.local/bin:$PATH"
LABEL="com.${USER}.gubernos"
AWAKE_LABEL="com.${USER}.gubernos-awake"
TUNNEL_LABEL="com.${USER}.gubernos-tunnel"
CFG_DIR="${GUBERNOS_CONFIG_DIR:-$HOME/.config/gubernos}"
CFD="$HOME/.gubernos/bin/cloudflared"
TUNNEL_RELAY="${GUBERNOS_TUNNEL_RELAY:-https://relay.gubernos.app}"
AGENTS_DIR="${GUBERNOS_LAUNCH_AGENTS:-$HOME/Library/LaunchAgents}"
KIT="node $APP/scripts/kit.mjs"
ok() { printf '  ✓ %s\n' "$1"; }
no() { printf '  ✗ %s\n' "$1"; }
die() { printf 'error: %s\n' "$1" >&2; exit 1; }
port() { local p; p=$($KIT get port 2>/dev/null || true); echo "${p:-4747}"; }
# where Tailscale delivers (lib/config.js PROXY_PORT): never counted as the Mac itself, whatever the request claims
proxy_port() { local p; p=$($KIT get proxyPort 2>/dev/null || true); echo "${p:-$(( $(port) + 1 ))}"; }

check() {
  echo "Required"
  [[ "$(uname)" == Darwin ]] && ok "macOS $(sw_vers -productVersion)" || no "macOS (this is $(uname))"
  if command -v node >/dev/null; then
    v=$(node -p 'process.versions.node.split(".")[0]'); [[ $v -ge 20 ]] && ok "node $(node -v)" || no "node $(node -v) — need 20+ (run the installer again, or brew install node)"
  else no "node — run the installer again: curl -fsSL https://raw.githubusercontent.com/old-bozman/gubernos/main/install.sh | bash"; fi
  echo "Model (one is enough — on your own subscription or account)"
  models
  echo "Optional"
  [[ -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ]] && ok "iCloud Drive (only if you want the files in iCloud)" || no "iCloud Drive (optional: only to keep the files in iCloud)"
  [[ -d /Applications/Obsidian.app ]] && ok "Obsidian app" || no "Obsidian (optional, to read the files: https://obsidian.md)"
  [[ -d "$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents" ]] && ok "Obsidian iCloud folder" || no "Obsidian iCloud folder (appears once Obsidian on iPhone/Mac stores a vault in iCloud)"
  (command -v tailscale >/dev/null || [[ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]]) && ok "Tailscale" || no "Tailscale (optional, for the phone: https://tailscale.com/download)"
  [[ "$(uname -m)" == arm64 ]] && ok "Apple Silicon (Whisper can run here)" || no "Apple Silicon (only for Whisper; this Mac's own speech models work without it)"
  [[ -x "$APP/.venv/bin/python" ]] && ok "Whisper (voice: any language, mixed, accents)" || no "Whisper (optional: Russian, mixed languages, accents — scripts/setup.sh voice; one language works without it on macOS 26)"
  if [[ -f "$HOME/.config/gubernos/config.json" ]]; then ok "configured: $(tr -d '\n' < "$HOME/.config/gubernos/config.json" | cut -c1-160)"; fi
}

# the model CLIs here, and whether each is signed in (as far as it can be told without calling the model)
models() {
  if command -v claude >/dev/null; then ok "Claude Code $(claude --version 2>/dev/null | head -1) — a Claude plan, Pro or higher"
  else no "Claude Code — curl -fsSL https://claude.ai/install.sh | bash, then: ~/.local/bin/claude (sign in)"; fi
  if command -v codex >/dev/null; then
    codex login status >/dev/null 2>&1 && ok "Codex (ChatGPT) — signed in" || no "Codex is installed, not signed in: codex login"
  else no "Codex (ChatGPT Plus or higher) — npm install -g @openai/codex, then: codex login"; fi
  local cur; cur=$(cd "$APP" && node -e "import('./lib/llm.js').then((m) => console.log(m.providers().chosen || ''))" 2>/dev/null || true)
  [[ -n "$cur" ]] && ok "the app uses: $cur" || true
}
voice-language() {
  [[ "${1:-}" =~ ^([a-z]{2,3}([-_][A-Za-z]{2,4})?|mixed)$ ]] || die "voice-language en-US|ru-RU|…|mixed"
  (cd "$APP" && node -e "import('./lib/settings.js').then((m) => m.update({ voiceLanguage: process.argv[1] }))" "$1") || die "couldn't save the voice language"
  local how
  how=$("$APP/tools/voice/gubernos-voice" locales 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const lang = process.argv[1], l = lang.replace("-", "_"), b = l.split("_")[0];
      let r = {}; try { r = JSON.parse(s.trim().split("\n").pop()); } catch {}
      const has = (k) => (r[k] || []).some((x) => x === l || x.split("_")[0] === b);
      console.log(lang === "mixed" ? "whisper" : r.error ? "none" : has("speech") ? "speech" : has("dictation") ? "dictation" : "none");
    });' "$1")
  if [[ -x "$APP/.venv/bin/python" ]]; then ok "voice: $1, heard by Whisper"
  elif [[ "$how" == speech ]]; then ok "voice: $1, heard by this Mac's own speech model (nothing to install)"
  elif [[ "$how" == dictation ]]; then ok "voice: $1, heard by this Mac's dictation model; Whisper hears it better: scripts/setup.sh voice"
  else no "voice: $1 needs Whisper on this Mac: scripts/setup.sh voice"; fi
}

model() {
  [[ "${1:-}" =~ ^(claude|codex)$ ]] || die "model claude|codex"
  (cd "$APP" && node -e "import('./lib/settings.js').then((m) => m.update({ provider: process.argv[1] }))" "$1") && ok "the app's model: $1 (Settings → Your Mac → Model)"
}

render() { # template → plist
  sed -e "s#{{LABEL}}#$2#g" -e "s#{{NODE}}#$(command -v node)#g" -e "s#{{APP}}#$APP#g" -e "s#{{HOME}}#$HOME#g" \
      -e "s#{{PATH}}#$HOME/.local/bin:$(dirname "$(command -v node)"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin#g" "$1"
}

# GUBERNOS_NO_LAUNCHD=1 (tests): write the plists, start and restart nothing
load() { # label plist
  [[ -n "${GUBERNOS_NO_LAUNCHD:-}" ]] && return 0
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
  local vault="" name="" language="" ovault="" opath="" p="" launchd=1 awake=0 local=0 llm="" vlang=""
  while [[ $# -gt 0 ]]; do case "$1" in
    --vault) vault="$2"; shift 2;; --name) name="$2"; shift 2;; --language) language="$2"; shift 2;;
    --obsidian-vault) ovault="$2"; shift 2;; --obsidian-path) opath="$2"; shift 2;; --port) p="$2"; shift 2;;
    --no-launchd) launchd=0; shift;; --awake) awake=1; shift;; --local) local=1; shift;; --model) llm="$2"; shift 2;; --voice-language) vlang="$2"; shift 2;; *) die "unknown option $1";; esac; done
  [[ -n "$vault" ]] || die "--vault PATH is required"
  # The vault is any folder: ~/Gubernos by default, or one in iCloud Drive / Obsidian's iCloud / Dropbox when the person
  # wants the files on other devices too. The phone doesn't need iCloud (it gets a copy from the server: lib/mirror.js),
  # and the server keeps daily copies itself (lib/backup.js). --local: accepted, no longer needed (older instructions).
  vault="${vault/#\~/$HOME}"
  # Never in the app's folder: an update replaces what's there. -ef, because ~/Gubernos and ~/gubernos are one folder on a Mac.
  local up="$vault"
  while [[ "$up" != / && "$up" != . ]]; do
    [[ "$up" -ef "$APP" ]] && die "$vault is inside the app's folder ($APP): an update would delete your files there. Choose another folder."
    up="$(dirname "$up")"
  done
  mkdir -p "$vault" || die "can't create $vault"
  command -v node >/dev/null || die "node is missing — run install.sh (see SETUP.md)"
  echo "1/4 dependencies"; (cd "$APP" && npm ci --silent --no-audit --no-fund)
  echo "2/4 vault"; $KIT vault --vault "$vault" ${name:+--name "$name"} ${language:+--language "$language"} ${opath:+--obsidian-path "$opath"}
  echo "3/4 config"; $KIT config --vault "$vault" ${p:+--port "$p"} ${ovault:+--obsidian-vault "$ovault"} ${opath:+--obsidian-path "$opath"} >/dev/null && ok "$HOME/.config/gubernos/config.json"
  # a new install: each screen explains itself the first time (an install that's already in use stays as it is)
  [[ -f "${GUBERNOS_DATA_DIR:-$APP/data}/settings.json" ]] || (cd "$APP" && node -e "import('./lib/settings.js').then((m) => m.update({ screenIntros: true }))")
  [[ -n "$llm" ]] && model "$llm" # after the config: the model is saved next to it
  [[ -n "$vlang" ]] && voice-language "$vlang"
  # Bug reports also go to the app's developer (privately, through relay.gubernos.app), unless this is the developer's
  # own install ("devAgent": true in config.json): there they go to the dev session.
  if [[ "$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).devAgent===true)}catch{console.log(false)}' "$HOME/.config/gubernos/config.json")" != true ]]; then
    $KIT config --feedback-relay https://relay.gubernos.app >/dev/null && ok "bug reports from the app also go to the developer (privately, no account needed)"
    ok "pushes to the iPhone app go through relay.gubernos.app (it signs them for Apple; the alert text passes through, nothing is stored) — off: Settings → Your Mac → Pushes through the relay"
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

# Tailscale for this Mac, from Tailscale's own download (no App Store, no Homebrew): the official installer, its signature
# checked, opened in macOS Installer. The person clicks Install, types the Mac's password (it adds a network extension),
# allows the VPN configuration and logs in in the browser; this waits for each and says what to do.
TS_PKG="https://pkgs.tailscale.com/stable/Tailscale-latest-macos.pkg"
TS_SIGNER="Developer ID Installer: Tailscale Inc. (W5364U7YZB)"
get-tailscale() {
  if [[ ! -d /Applications/Tailscale.app ]]; then
    local tmp; tmp="$(mktemp -d)"
    echo "  downloading Tailscale (its official installer, ~25 MB)…"
    curl -fsSL "$TS_PKG" -o "$tmp/Tailscale.pkg" || die "couldn't download Tailscale ($TS_PKG)"
    pkgutil --check-signature "$tmp/Tailscale.pkg" 2>/dev/null | grep -qF "$TS_SIGNER" \
      || die "the Tailscale installer isn't signed by Tailscale Inc. — not opening it"
    ok "downloaded and checked: signed by Tailscale Inc."
    echo "  macOS Installer opens now: Continue → Install, then your Mac's password (Tailscale adds a network extension)."
    # done = a new package receipt (Installer itself stays open on "successful" until Close: close it for them)
    local rcpt=com.tailscale.ipn.macsys was; was=$(pkgutil --pkg-info "$rcpt" 2>/dev/null | grep install-time)
    open "$tmp/Tailscale.pkg"; sleep 3
    while pgrep -xq Installer; do
      [[ "$(pkgutil --pkg-info "$rcpt" 2>/dev/null | grep install-time)" != "$was" ]] && { sleep 2; osascript -e 'quit app "Installer"' >/dev/null 2>&1; break; }
      sleep 2
    done
    rm -rf "$tmp"
    [[ -d /Applications/Tailscale.app ]] || die "Tailscale wasn't installed (the Installer was closed?) — run this again"
    ok "Tailscale installed"
  fi
  if ! ts status >/dev/null 2>&1; then
    open -a Tailscale
    echo "  Tailscale opens: if macOS asks, allow its system extension (System Settings → Privacy & Security, or Login Items &"
    echo "  Extensions) and its VPN configuration (Allow). Then click Log in (the Tailscale icon in the menu bar) and sign in"
    echo "  in the browser with any Google, Apple, Microsoft or GitHub account. Waiting for that (up to 10 minutes)…"
    local i; for i in $(seq 1 200); do ts status >/dev/null 2>&1 && break; sleep 3; done
    ts status >/dev/null 2>&1 || die "Tailscale isn't logged in yet — run this again when it is"
  fi
  ok "Tailscale is running and logged in"
}

# pairing first: from now on only paired devices get in (an existing token stays, so paired devices stay paired)
pairing_on() {
  node -e 'const fs=require("fs"),f=process.argv[1];let s={};try{s=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}
    s.token||=require("crypto").randomBytes(24).toString("base64url");s.required=true;
    fs.mkdirSync(require("path").dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(s,null,1)+"\n",{mode:0o600})' "$CFG_DIR/pair.json"
}

# Cloudflare's own build (signed by Cloudflare Inc., team 68WVV388M8), checked before it's kept. No Homebrew, no password.
get-cloudflared() {
  if [[ -x "$CFD" ]]; then ok "cloudflared $("$CFD" --version | awk '{print $3}')"; return; fi
  local arch tmp; arch=$([[ "$(uname -m)" == arm64 ]] && echo arm64 || echo amd64); tmp=$(mktemp -d)
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$arch.tgz" | tar -xz -C "$tmp" || die "couldn't download cloudflared"
  { codesign --verify --strict "$tmp/cloudflared" && codesign -dv "$tmp/cloudflared" 2>&1 | grep -q 'TeamIdentifier=68WVV388M8'; } \
    || { rm -rf "$tmp"; die "the downloaded cloudflared isn't signed by Cloudflare — not installed"; }
  mkdir -p "$(dirname "$CFD")"; mv "$tmp/cloudflared" "$CFD"; rm -rf "$tmp"
  ok "cloudflared $("$CFD" --version | awk '{print $3}') (Cloudflare's signed build) in ~/.gubernos/bin"
}

# This Mac's tunnel: made once by the relay (relay/worker.js POST /tunnel) for the proxy port, kept in tunnel.json
# (+ the token in tunnel.token, both 0600); made again only when the proxy port changed.
cloudflare-tunnel() {
  local tf="$CFG_DIR/tunnel.json" tok="$CFG_DIR/tunnel.token" pp; pp=$(proxy_port)
  if [[ ! -s "$tok" ]] || [[ "$(node -p 'try{require(process.argv[1]).port}catch{0}' "$tf")" != "$pp" ]]; then
    stop-tunnel >&2 # the port changed: the old one goes
    local out; out=$(curl -fsS -X POST "$TUNNEL_RELAY/tunnel" -H 'content-type: application/json' -d "{\"port\":$pp}") || die "the relay couldn't make an address for this Mac (try again in a minute)"
    mkdir -p "$CFG_DIR"; ( umask 077
      node -e 'const j=JSON.parse(process.argv[1]);require("fs").writeFileSync(process.argv[2],JSON.stringify({id:j.id,hostname:j.hostname,key:j.key,port:+process.argv[4]},null,1)+"\n");require("fs").writeFileSync(process.argv[3],j.token)' "$out" "$tf" "$tok" "$pp" )
  fi
  mkdir -p "$AGENTS_DIR"
  render "$APP/deploy/gubernos-tunnel.plist.template" "$TUNNEL_LABEL" | sed "s#{{TOKEN_FILE}}#$tok#g" > "$AGENTS_DIR/$TUNNEL_LABEL.plist"
  load "$TUNNEL_LABEL" "$AGENTS_DIR/$TUNNEL_LABEL.plist"
  node -p 'require(process.argv[1]).hostname' "$tf"
}

# Leaving the Cloudflare address: the service stopped and the tunnel with its DNS name deleted at the relay, so the old
# address stops working (someone who chose Tailscale to end HTTPS on this Mac shouldn't keep a way in through Cloudflare).
stop-tunnel() {
  local tf="$CFG_DIR/tunnel.json" plist="$AGENTS_DIR/$TUNNEL_LABEL.plist"
  if [[ -f "$plist" ]]; then
    [[ -n "${GUBERNOS_NO_LAUNCHD:-}" ]] || launchctl bootout "gui/$(id -u)/$TUNNEL_LABEL" 2>/dev/null || true
    rm -f "$plist"
  fi
  [[ -f "$tf" ]] || return 0
  local q; q=$(node -p 'const t=require(process.argv[1]);`${t.id}?key=${encodeURIComponent(t.key)}`' "$tf")
  if curl -fsS -m 30 -X DELETE "$TUNNEL_RELAY/tunnel/$q" >/dev/null; then ok "the Cloudflare address is gone"
  else no "couldn't delete the old address at the relay; it answers nothing now that this Mac's tunnel is stopped"; fi
  rm -f "$tf" "$CFG_DIR/tunnel.token"
}

phone() {
  # The iPhone app reaches this Mac over HTTPS; the phone needs nothing but the app and the pairing code (lib/pair.js:
  # unpaired requests get nothing, repeated wrong codes are turned away). Three ways:
  #   (default)   Cloudflare Tunnel: https://m-<random>.gubernos.dev, made by the relay; cloudflared runs here. TLS ends at
  #               Cloudflare, on the developer's account (it could see the traffic; we don't store it, Cloudflare keeps its own
  #               request data). Nothing for the person to sign in to.
  #   --tailscale Tailscale Funnel: https://<mac>.<tailnet>.ts.net; TLS ends on this Mac. A Tailscale account and its installer.
  #   --private   Tailscale Serve: only the tailnet, so the phone needs Tailscale too (logged in, VPN On Demand)
  local mode=cloudflare host
  case "${1:-}" in --tailscale) mode=funnel;; --private) mode=serve;; "") ;; *) die "unknown option $1";; esac
  pairing_on
  if [[ $mode == cloudflare ]]; then
    get-cloudflared
    host=$(cloudflare-tunnel)
  else
    get-tailscale
    # The first time Tailscale prints login.tailscale.com links (turn on HTTPS, and for Funnel allow it): open, approve, it goes on.
    echo "  If a login.tailscale.com link appears below, open it and approve (HTTPS certificates, Funnel); the command then continues."
    if [[ $mode == funnel ]]; then ts funnel --bg "$(proxy_port)"; else ts serve --bg "$(proxy_port)"; fi
    stop-tunnel
    host=$(ts status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')
  fi
  $KIT config --public-url "https://$host" >/dev/null
  restart >/dev/null
  case $mode in
    cloudflare) ok "phone URL: https://$host — reachable from anywhere through Cloudflare, only paired devices get in"
      if command -v tailscale >/dev/null && tailscale serve status 2>/dev/null | grep -q "127.0.0.1:"; then echo "  Tailscale still serves this Mac too; to close that way in: tailscale serve reset"; fi;;
    funnel) ok "phone URL: https://$host — reachable from anywhere, only paired devices get in (no Tailscale needed on the phone)";;
    serve) ok "phone URL: https://$host — only your Tailscale devices reach it (the phone needs Tailscale, logged in, VPN On Demand on)";;
  esac
  echo "  Connect the iPhone: open http://127.0.0.1:$(port)/#/phone on this Mac and follow the two codes there."
}

voice() {
  # Whisper without Homebrew or Apple's Command Line Tools: uv (one program) fetches its own Python; the app sends WAV, so
  # no ffmpeg. Its models (~1.6 GB) download here too.
  # AICODE-NOTE: only-managed — looking for a Python on the Mac runs /usr/bin/python3, a stub that opens Apple's dialog.
  [[ "$(uname -m)" == arm64 ]] || die "Whisper needs Apple Silicon (this Mac's own speech models work without it: Settings → Voice)"
  local uv; uv="$(command -v uv || echo "$HOME/.local/bin/uv")"
  if [[ ! -x "$uv" ]]; then
    curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh >/dev/null 2>&1 || die "couldn't install uv (https://docs.astral.sh/uv)"
    uv="$HOME/.local/bin/uv"
  fi
  (cd "$APP" && "$uv" venv --quiet --allow-existing --python 3.12 --python-preference only-managed .venv && "$uv" pip install --quiet --python .venv/bin/python mlx-whisper) \
    || die "couldn't install Whisper"
  # the models now, not on the first voice command (which would time out while ~1.6 GB downloads); names: lib/stt.py
  echo "  downloading Whisper's models (~1.6 GB, a few minutes)…"
  (cd "$APP" && .venv/bin/python -c 'import re, huggingface_hub as h; [h.snapshot_download(m) for m in re.findall(r"\"(mlx-community/[^\"]+)\"", open("lib/stt.py").read())]' >/dev/null 2>&1) \
    || no "couldn't download the models now; they download on first use"
  ok "Whisper ready: voice uses it from now on"
  restart >/dev/null 2>&1 || true
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
  if [[ "$out" == *'"full"'* ]]; then ok "Plan the day reads this Mac's calendars (Settings → Your Mac → Calendar picks which; time blocks go to the default one)"
  else no "no calendar access ($out): System Settings → Privacy & Security → Calendars → Gubernos Calendar → Full Access"; fi
}

restart() { [[ -n "${GUBERNOS_NO_LAUNCHD:-}" ]] && return 0; launchctl kickstart -k "gui/$(id -u)/$LABEL" && wait_up && ok "restarted"; }
status() { launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state|pid" | head -2; curl -sf "http://127.0.0.1:$(port)/api/state" >/dev/null && ok "answering on $(port)" || no "not answering on $(port)"; }

cmd="${1:-check}"; shift || true
case "$cmd" in check|install|model|voice-language|get-tailscale|get-cloudflared|stop-tunnel|phone|voice|obsidian|awake|calendar|restart|status) "$cmd" "$@";; *) die "unknown command $cmd";; esac
