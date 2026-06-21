#!/usr/bin/env bash
# Vendor Bergamot WASM + DE→EN model files from official Firefox sources.
#
# Sources:
#   - WASM binary: Firefox Remote Settings CDN (translations-wasm collection)
#   - JS glue:     mozilla-central / toolkit/components/translations/bergamot-translator
#   - Model files: Firefox Remote Settings CDN (translations-models collection)
#
# Pinned versions:
#   - bergamot-translator: v0.6.0 (rev eea6e5a80aa4ddd86d9cc35ce9a65b79aa3ab96d)
#   - DE→EN model:         v2.0

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor"
MODELS="$ROOT/models/deen"
ATTACH_CDN="https://firefox-settings-attachments.cdn.mozilla.net"
BERGAMOT_REV="eea6e5a80aa4ddd86d9cc35ce9a65b79aa3ab96d"
HG_RAW="https://hg.mozilla.org/mozilla-central/raw-file/$BERGAMOT_REV"

mkdir -p "$VENDOR" "$MODELS"

# Each entry: "dest_path | url | sha256"
declare -a items=(
  "$VENDOR/bergamot-translator.wasm | $ATTACH_CDN/main-workspace/translations-wasm/05082c31-aee8-4249-9e01-c1865afd7520.wasm | a3a89d9ad0a4ed8f27bf3e403701b23f5709816f6376438503f2fa5b0182c2dc"
  "$VENDOR/bergamot-translator.js | $HG_RAW/toolkit/components/translations/bergamot-translator/bergamot-translator.js | faff1ef6285b0d26f01787776fd49299dfb756ecb9688aa990c250e66797b47d"
  "$MODELS/model.deen.intgemm.alphas.bin | $ATTACH_CDN/main-workspace/translations-models/f44b1b1b-9df6-4ece-971e-0e5ce96fae54.bin | 3e6f7c2c2425d10824797270b382bee718ff34af2cab9308841c82ca46dc6f20"
  "$MODELS/lex.50.50.deen.s2t.bin | $ATTACH_CDN/main-workspace/translations-models/d0e4efcb-6145-43db-a69e-568904cc2925.bin | 113b98460468360cca68c042e1cddf49c4e1931cbb975ed04349c9a3bd607010"
  "$MODELS/vocab.deen.spm | $ATTACH_CDN/main-workspace/translations-models/8ad4d93e-21e6-4862-81d5-c1c3a7d0767b.spm | 69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c"
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
echo "  $MODELS/"
