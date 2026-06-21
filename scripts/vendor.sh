#!/usr/bin/env bash
# Vendor Bergamot WASM runtime files from official Firefox sources.
#
# Sources:
#   - WASM binary: Firefox Remote Settings CDN (translations-wasm collection)
#   - JS glue:     mozilla-firefox/firefox GitHub mirror
#
# Pinned content:
#   - bergamot-translator: v0.6.0+eea6e5a8, verified by SHA-256 below

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor"
ATTACH_CDN="https://firefox-settings-attachments.cdn.mozilla.net"
FIREFOX_RAW="https://raw.githubusercontent.com/mozilla-firefox/firefox/main"

mkdir -p "$VENDOR"

# Each entry: "dest_path | url | sha256"
declare -a items=(
  "$VENDOR/bergamot-translator.wasm | $ATTACH_CDN/main-workspace/translations-wasm/05082c31-aee8-4249-9e01-c1865afd7520.wasm | a3a89d9ad0a4ed8f27bf3e403701b23f5709816f6376438503f2fa5b0182c2dc"
  "$VENDOR/bergamot-translator.js | $FIREFOX_RAW/toolkit/components/translations/bergamot-translator/bergamot-translator.js | faff1ef6285b0d26f01787776fd49299dfb756ecb9688aa990c250e66797b47d"
)

sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

for item in "${items[@]}"; do
  IFS='|' read -r dest url expected <<< "$item"
  dest="$(echo "$dest" | xargs)"
  url="$(echo "$url" | xargs)"
  expected="$(echo "$expected" | xargs)"

  if [[ -f "$dest" && -n "$expected" ]]; then
    actual="$(sha256 "$dest")"
    if [[ "$actual" == "$expected" ]]; then
      echo "OK    $(basename "$dest") (cached)"
      continue
    fi
    echo "STALE $(basename "$dest") — re-downloading"
  fi

  echo "GET   $url"
  curl -fL --retry 3 --retry-delay 2 -o "$dest" "$url"

  if [[ -n "$expected" ]]; then
    actual="$(sha256 "$dest")"
    if [[ "$actual" != "$expected" ]]; then
      echo "FAIL  sha256 mismatch for $(basename "$dest")" >&2
      echo "      expected: $expected" >&2
      echo "      actual:   $actual" >&2
      exit 1
    fi
    echo "OK    $(basename "$dest") (sha256 verified)"
  fi
done

echo
echo "Vendored to:"
echo "  $VENDOR/"
