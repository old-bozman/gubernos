#!/bin/bash
# Build the calendar helper (tools/calendar/main.swift) that ships in the repo, so a Mac without Apple's Command Line Tools
# gets Plan the day's calendars too (lib/maccal.js copies it into ~/.gubernos/bin). Run this after changing main.swift or
# Info.plist, and commit tools/calendar/gubernos-calendar and its .src stamp. Universal (Apple Silicon + Intel), macOS 14+.
set -euo pipefail
cd "$(dirname "$0")/../tools/calendar"
tmp="$(mktemp -d)"
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos14" main.swift -o "$tmp/$arch" \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist
done
lipo -create "$tmp/arm64" "$tmp/x86_64" -output gubernos-calendar
codesign -s - -f --identifier app.gubernos.calendar gubernos-calendar
# the same hash lib/maccal.js computes (srcHash): which source this binary was built from
cat main.swift Info.plist | shasum -a 256 | cut -c1-16 > gubernos-calendar.src
rm -rf "$tmp"
lipo -info gubernos-calendar; echo "stamp $(cat gubernos-calendar.src)"
