# Firefox Extension: In-Place Translator

**Status**: Dynamic language-pair implementation
**Reviewed**: 2026-06-21
**Owner**: dimas.od@gmail.com

## Current State

- Toolbar popup lets users choose a direct source/target language pair discovered from Mozilla Remote Settings.
- Selecting a not-yet-installed pair starts a model download immediately.
- Downloads use Mozilla attachment URLs, SHA-256 verification, and IndexedDB caching.
- Translation runs locally through bundled Bergamot JS/WASM plus the selected cached model files.
- Cached pairs persist until the user removes them from the popup.
- Pivot translation is intentionally out of scope; only complete direct pairs are shown.

## Architecture

```
Toolbar popup
  -> background registry/download/cache
  -> IndexedDB model cache
  -> pair-aware Bergamot worker
  -> content script in-place translate/restore
```

- `src/background/model-registry.ts` fetches and normalizes Remote Settings records into complete direct pairs.
- `src/background/model-downloads.ts` downloads required files and verifies hashes before storing.
- `src/background/model-store.ts` stores heavy model binaries in IndexedDB and metadata in `browser.storage.local`.
- `src/background/engine.ts` and `engine.worker.ts` load one selected pair at a time.
- `src/popup/main.ts` owns pair selection, download/remove controls, and translate/restore buttons.

## Behavior

- Pair completeness requires `model` and either `vocab` or both `srcvocab` and `trgvocab`; `lex` is optional and used when present.
- Latest complete version per direct pair is used.
- Popup state shows available, downloading, downloaded, failed, and translated/restorable states.
- Badge text after translation shows the target language code.
- Content script behavior remains unchanged: body text, placeholders, input button values, open shadow DOM, same-origin iframes, dynamic content, and restore.

## Verification

- `npm run vendor`
- `npm run typecheck`
- `npm test`
- `npm run package`
- `npm run lint`
- Headless `web-ext run` against `dist/`

## Notes

- Extension package no longer bundles `models/`; only Bergamot runtime files are copied under `vendor/`.
- AMO notes should mention Mozilla Remote Settings/CDN as the model source, SHA-256 verification, IndexedDB model cache, and local-only translation after download.
