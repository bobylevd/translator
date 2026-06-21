# In-Place Translator

Firefox extension that translates webpages **in place**, without reloading the page.

Unlike Firefox's built-in translator, this:

- Does **not** reload the page — form input, scroll position, focus, and SPA state are preserved.
- Translates **placeholders**, **button labels**, and **`<option>` text** that the built-in misses.
- Picks up **dynamically-added content** (modals, infinite scroll, lazy-loaded sections) via `MutationObserver`.
- Walks into **open shadow DOM** and **same-origin iframes**.

Uses the same local Bergamot translation engine as Firefox's built-in translator. Language models are downloaded from Mozilla when selected, verified with SHA-256, cached locally, and then used offline.

## Status

**Dynamic language-pair build.** The toolbar popup discovers available direct language pairs from Mozilla Remote Settings, downloads the selected pair, caches it in IndexedDB, and translates/restores the current page with that pair. The content flow covers body text, placeholders, input button values, open shadow DOM, same-origin iframes, and dynamically-added content.

AMO signing is not included; this builds an unsigned package for local install/testing.

## Develop

```sh
npm install
npm run vendor          # one-time: download Bergamot JS/WASM runtime
npm run build           # bundles src/ → dist/ and copies static assets
npm test                # unit tests + Bergamot smoke/perf smoke
npm run lint            # validates dist/ with web-ext
npm run package         # creates web-ext-artifacts/*.zip
npm run dev             # build + launch Firefox with the extension loaded
```

`vendor/` is gitignored — rerun `npm run vendor` after a fresh clone. The script verifies SHA-256 for the WASM and JS glue. Translation models are not bundled; they are downloaded by the extension at runtime from Mozilla Remote Settings.

The `dev` script runs `web-ext run` against `dist/`. Edit any file under `src/`, run `npm run build` again, and use Firefox's "Reload" button at `about:debugging`.

## Load manually

1. `npm run vendor`
2. `npm run build`
3. Open `about:debugging#/runtime/this-firefox`
4. Click **Load Temporary Add-on…** and pick `dist/manifest.json`
5. Open a page, choose a source/target language in the toolbar popup, wait for the model download, then click **Translate**.

## Verify

```sh
npm run vendor
npm run typecheck
npm test
npm run package
npm run lint
```

Manual fixture:

1. Run `npm run build`
2. Load `dist/manifest.json` at `about:debugging#/runtime/this-firefox`
3. Open `tests/fixtures/de-page.html`
4. Choose `German → English` in the popup, wait for the model download, type in the search input, click **Translate**, and confirm text, placeholders, the shadow-root text, and the same-origin iframe translate without losing the input value
5. Run `addDynamicGermanText()` in the page console and confirm the added paragraph translates
6. Click the toolbar icon again and confirm original German text is restored

## Layout

```
src/
  background/service-worker.ts   Background entry; handles toolbar click + message routing
  background/engine.ts           Lazy Bergamot worker wrapper
  background/engine.worker.ts    Dedicated worker that hosts WASM + model
  background/tab-state.ts        Per-tab action badge state
  content/main.ts                Content script entry; translate/restore/observer flow
  content/walker.ts              DOM target collection
  content/store.ts               Original text/attribute storage
  content/skip-rules.ts          Element/text exclusion rules
  shared/messages.ts             Typed message constants
  shared/language-pairs.ts       Language-pair and download state types
  shared/worker-protocol.ts      Background worker protocol
popup/
  index.html                     Toolbar popup shell
  styles.css                     Toolbar popup styling
icons/icon.svg                   Toolbar + extension icon
manifest.json                    MV3 manifest (Firefox)
esbuild.config.mjs               Bundler (writes to dist/)
```

## Roadmap

See `.omc/plans/firefox-translator-extension.md` for the full plan.
