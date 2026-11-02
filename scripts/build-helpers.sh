#!/bin/bash
# Build the Swift helpers that ship in the repo, so a Mac without Apple's Command Line Tools gets them too:
#   tools/calendar → gubernos-calendar (Plan the day's calendars; lib/maccal.js copies it into ~/.gubernos/bin)
#   tools/voice    → gubernos-voice    (speech to text with the Mac's own models; lib/voice.js runs it in place)
# Run it after changing a helper's main.swift or Info.plist, and commit the binaries (and the calendar's .src stamp).
# Universal (Apple Silicon + Intel), macOS 14+ (the voice helper answers "needs macOS 26" below that).
# Usage: scripts/build-helpers.sh [calendar|voice]   (both by default)
set -euo pipefail
cd "$(dirname "$0")/../tools"
build() { # dir binary
  local tmp; tmp="$(mktemp -d)"
  for arch in arm64 x86_64; do
    swiftc -O -target "$arch-apple-macos14" "$1/main.swift" -o "$tmp/$arch" \
      -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$1/Info.plist"
  done
  lipo -create "$tmp/arm64" "$tmp/x86_64" -output "$1/$2"
  codesign -s - -f --identifier "app.gubernos.${1}" "$1/$2"
  rm -rf "$tmp"
  lipo -info "$1/$2"
}
for h in ${@:-calendar voice}; do
  case "$h" in
    calendar) build calendar gubernos-calendar
      # the same hash lib/maccal.js computes (srcHash): which source this binary was built from
      cat calendar/main.swift calendar/Info.plist | shasum -a 256 | cut -c1-16 > calendar/gubernos-calendar.src
      echo "stamp $(cat calendar/gubernos-calendar.src)" ;;
    voice) build voice gubernos-voice ;;
    *) echo "unknown helper $h" >&2; exit 1 ;;
  esac
done
