#!/bin/bash
# Gubernos.app and its DMG (deploy/mac-app): the launcher, the bundled install.sh. dist/Gubernos.dmg.
#   scripts/build-mac-app.sh            signed with the Developer ID Application certificate and notarized when it's in the keychain
#                                       (App Store Connect key: ~/.config/gubernos/asc.json); otherwise ad-hoc, for this Mac only
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=dist APP="$PWD/dist/Gubernos.app"
rm -rf "$OUT"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
for a in arm64 x86_64; do swiftc -O -target "$a-apple-macos13" -o "$OUT/g-$a" deploy/mac-app/main.swift; done
lipo -create "$OUT/g-arm64" "$OUT/g-x86_64" -output "$APP/Contents/MacOS/Gubernos"; rm "$OUT"/g-*
cp deploy/mac-app/Info.plist "$APP/Contents/Info.plist"
cp install.sh "$APP/Contents/Resources/install.sh"
if [[ -f public/icons/icon-512.png ]]; then
  S="$OUT/AppIcon.iconset"; mkdir -p "$S"
  for z in 16 32 128 256 512; do sips -z $z $z public/icons/icon-512.png --out "$S/icon_${z}x${z}.png" >/dev/null; done
  iconutil -c icns "$S" -o "$APP/Contents/Resources/AppIcon.icns"; rm -rf "$S"
fi
ID=$(security find-identity -v -p codesigning | grep -m1 'Developer ID Application' | sed -E 's/.*"(.*)"/\1/' || true)
if [[ -n "$ID" ]]; then codesign --force --options runtime --timestamp --sign "$ID" "$APP"; else echo "note: no Developer ID Application certificate: ad-hoc, it runs only on this Mac"; codesign --force --sign - "$APP"; fi
codesign --verify --strict "$APP"
hdiutil create -quiet -volname Gubernos -srcfolder "$APP" -ov -format UDZO "$OUT/Gubernos.dmg"
if [[ -n "$ID" ]]; then
  codesign --force --timestamp --sign "$ID" "$OUT/Gubernos.dmg"
  read -r KID ISS KEY < <(node -e 'const c=require(process.env.HOME+"/.config/gubernos/asc.json");console.log(c.keyId,c.issuerId,c.keyPath.replace(/^~/,process.env.HOME))')
  xcrun notarytool submit "$OUT/Gubernos.dmg" --key "$KEY" --key-id "$KID" --issuer "$ISS" --wait
  xcrun stapler staple "$OUT/Gubernos.dmg"
  spctl -a -t open --context context:primary-signature -v "$OUT/Gubernos.dmg"
fi
echo "✓ $OUT/Gubernos.dmg ($(du -h "$OUT/Gubernos.dmg" | cut -f1))"
