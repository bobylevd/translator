# In-Place Translator (DE → EN)

Firefox extension that translates German webpages to English **in place**, without reloading the page.

Unlike Firefox's built-in translator, this:

- Does **not** reload the page — form input, scroll position, focus, and SPA state are preserved.
- Translates **placeholders**, **button labels**, and **`<option>` text** that the built-in misses.
- Picks up **dynamically-added content** (modals, infinite scroll, lazy-loaded sections) via `MutationObserver`.
- Walks into **open shadow DOM** and **same-origin iframes**.

Uses the same local Bergamot translation engine as Firefox's built-in translator (no cloud, no API key, fully offline after install).

## Status

**Phase 2 — Bergamot vendored.** Toolbar button does a ping/pong round-trip with the content script. Bergamot WASM + DE→EN model files are vendored under `vendor/` and `models/deen/`. Engine wiring (Phase 3) is next.

## Develop

```sh
npm install
npm run vendor          # one-time: download Bergamot WASM + DE→EN model (~40 MB)
npm run build           # bundles src/ → dist/ and copies vendor/ + models/ in
npm run dev             # build + launch Firefox with the extension loaded
```

`vendor/` and `models/` are gitignored — rerun `npm run vendor` after a fresh clone. The script verifies SHA-256 on every file and is idempotent (skips files already verified).

The `dev` script runs `web-ext run` against `dist/`. Edit any file under `src/`, run `npm run build` again, and use Firefox's "Reload" button at `about:debugging`.

## Load manually

1. `npm run build`
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on…** and pick `dist/manifest.json`
4. Click the toolbar icon to ping/pong; check the background console (in `about:debugging`).

## Layout

```
src/
  background/service-worker.ts   Background entry; handles toolbar click
  content/main.ts                Content script entry; injected on demand
  shared/messages.ts             Typed message constants
icons/icon.svg                   Toolbar + extension icon
manifest.json                    MV3 manifest (Firefox)
esbuild.config.mjs               Bundler (writes to dist/)
```

## Roadmap

See `.omc/plans/firefox-translator-extension.md` for the full plan.
