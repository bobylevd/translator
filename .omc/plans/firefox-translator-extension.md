# Firefox Extension: DE→EN In-Place Translator

**Status**: Draft (interview mode, direct plan)
**Created**: 2026-05-11
**Owner**: dimas.od@gmail.com

---

## 1. Requirements Summary

Build a Firefox WebExtension that translates the current webpage from **German to English** in place — **without reloading the page** — preserving form state, scroll position, focus, and dynamically-loaded content.

### Why this exists
Firefox's built-in translator (Bergamot-based, since Firefox 118) reloads the page, which:
- Wipes unsaved form input
- Loses scroll position and focus
- Breaks SPAs that hold ephemeral state in JS memory
- Re-triggers analytics, login redirects, captchas

Additionally, the built-in translator skips content the user cares about: form `placeholder`s, `<option>` labels, shadow-DOM content (web components), and content injected after page load.

### Non-goals (explicit)
- Multi-language pairs (only DE→EN; can extend later)
- Cloud APIs / API keys (local Bergamot only)
- Auto-translation on page load (manual toolbar trigger only)
- Cross-origin iframe translation (same-origin only — cross-origin is technically blocked)
- Translating `alt`/`title` attributes (deferred; out of scope for v1)

---

## 2. Acceptance Criteria

Each criterion is testable manually or via automated test.

| # | Criterion | How to verify |
|---|-----------|---------------|
| AC1 | Clicking the toolbar button on a DE-language page replaces visible body text with EN translation **without a page reload** (`performance.navigation.type === 0` and `window.history.length` unchanged). | Open `https://de.wikipedia.org/wiki/Berlin`, type into the search box, click toolbar button — search-box value must persist. |
| AC2 | Clicking the toolbar button a second time **restores the original DE text** exactly (byte-for-byte for `textContent`). | After AC1, click again; assert restored text matches the snapshot taken before translation. |
| AC3 | `<input placeholder="...">` and `<button>` text content are translated. | Open a DE form page; verify placeholder text changes to EN after click. |
| AC4 | `<select><option>` text is translated. | Use any DE form with `<select>`; verify options translated. |
| AC5 | Content added to the DOM **after** translation toggle is automatically translated. | Click translate, then trigger a modal/lazy-load on the page (e.g. infinite scroll); new content must be EN. |
| AC6 | Shadow-DOM content (open shadow roots) is translated. | Test page with `<custom-element>` rendering DE text in open shadow root. |
| AC7 | Same-origin iframe content is translated. | Test page embedding same-origin iframe with DE text. |
| AC8 | Toolbar icon shows distinct state: idle / translating / translated. | Visual check + assertion on `browser.action.getBadgeText`. |
| AC9 | Translation of a 5000-word page completes in **< 8s** on M-series Mac (p95). Memory stable (no leaks across 10 toggle cycles). | Bench against `https://de.wikipedia.org/wiki/Quantenmechanik`; record timings. |
| AC10 | Extension survives navigation: navigating to a new page after translation does not crash background or content scripts. | Click translate, navigate, click translate again on new page. |
| AC11 | Code blocks, `<script>`, `<style>`, `<noscript>`, `contenteditable` regions, and elements with `translate="no"` or `notranslate` class are **skipped**. | Test page with each variant; verify untouched. |
| AC12 | Extension loads in Firefox 128+ (current ESR) under MV3 with no manifest warnings. | `about:debugging` → load temporary add-on → 0 warnings. |

---

## 3. Architecture

```
┌────────────────────────────────────────────────────────────┐
│ Toolbar button (browser.action)                            │
│   click → background.toggleTab(tabId)                       │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│ Background service worker (background/service-worker.js)   │
│ - Owns Bergamot engine (singleton, lazy-loaded)            │
│ - Holds DE→EN model in memory after first use              │
│ - Per-tab state: { idle | translating | translated }       │
│ - Message router: TRANSLATE_BATCH, RESTORE, GET_STATE      │
│ - Sets badge text on browser.action                         │
└────────────────────────────────────────────────────────────┘
        ▲                                          │
        │ runtime.sendMessage                      │
        │ (batches of source strings)              │ scripting.executeScript
        │                                          │ injects content script
        │                                          ▼
┌────────────────────────────────────────────────────────────┐
│ Content script (content/main.js)                           │
│ - DOM walker: TreeWalker over body, skip blocked tags      │
│ - Recurse into open shadow roots and same-origin iframes   │
│ - Stash original text in WeakMap<Node, string>             │
│ - Chunk text nodes into ~200-string batches → background   │
│ - Replace nodeValue on receipt                             │
│ - MutationObserver for SPA / dynamic content               │
│ - Idempotent: re-toggle restores from WeakMap              │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│ Bergamot WASM (vendor/bergamot-translator-worker.{js,wasm})│
│ - Loaded inside an offscreen-style Worker (background)     │
│ - bergamot-translator API: BlockingService + TranslationModel│
│ - Model files bundled in extension at models/deen/         │
└────────────────────────────────────────────────────────────┘
```

### Key design decisions

- **Background owns the engine**, not the content script. WASM init is expensive (~500ms cold); doing it once per page would be wasteful. Background keeps it warm across tabs.
- **Worker inside background**: Bergamot blocks on translate(); running inside a dedicated Worker keeps the service worker responsive to incoming messages.
- **WeakMap for originals**: stashing original text on the Node itself via `dataset.*` mutates the DOM observably and breaks sites that rely on textContent for hashing/diffing (some SPAs do). WeakMap is invisible and GC-friendly.
- **Skip rules** (don't translate): `<script>`, `<style>`, `<noscript>`, `<code>`, `<pre>`, `<kbd>`, `<samp>`, elements with `translate="no"`, `.notranslate`, or `contenteditable=""`/`"true"`. Numbers-only and URL-only text nodes are also skipped.
- **Batching**: group 100–200 text nodes per message to amortize structured-clone cost; Bergamot internally batches per-sentence.
- **No model download UI in v1**: bundle the DE→EN model (~17MB compressed) directly in the extension. Keeps the extension self-contained and avoids permission/CSP complexity for remote downloads.

---

## 4. Repo Structure (target)

```
translator/
├── manifest.json
├── package.json                 # dev tooling only (esbuild, web-ext, eslint)
├── README.md
├── icons/
│   ├── 16.png 32.png 48.png 96.png 128.png
├── src/
│   ├── background/
│   │   ├── service-worker.ts    # entry, message router, action handler
│   │   ├── engine.ts            # Bergamot wrapper, lazy init, translate()
│   │   ├── engine.worker.ts     # Worker that hosts WASM
│   │   └── tab-state.ts         # per-tab idle/translating/translated map
│   ├── content/
│   │   ├── main.ts              # entry
│   │   ├── walker.ts            # TreeWalker, shadow-DOM/iframe recursion
│   │   ├── skip-rules.ts        # element/text filtering
│   │   ├── store.ts             # WeakMap<Node, string> originals
│   │   ├── observer.ts          # MutationObserver, debounced flush
│   │   └── replace.ts           # batch send → background, apply results
│   └── shared/
│       ├── messages.ts          # typed message constants + types
│       └── log.ts               # gated console logging
├── vendor/
│   ├── bergamot-translator-worker.js
│   └── bergamot-translator-worker.wasm
├── models/
│   └── deen/
│       ├── model.deen.intgemm.alphas.bin
│       ├── lex.50.50.deen.s2t.bin
│       └── vocab.deen.spm
├── tests/
│   ├── fixtures/                # test HTML pages with DE text, shadow DOM, etc.
│   └── e2e/                     # web-ext + playwright smoke tests
└── web-ext-config.js
```

TypeScript chosen for: typed messages between content/background (critical for catching protocol drift) and Bergamot binding types.

---

## 5. Implementation Steps

### Phase 1 — Scaffolding & manifest (~1 hr)
1. `npm init -y`; install dev deps: `web-ext`, `esbuild`, `typescript`, `@types/firefox-webext-browser`, `eslint`.
2. Create `manifest.json` (MV3) with:
   - `manifest_version: 3`
   - `browser_specific_settings.gecko.id` (required for Firefox MV3)
   - `permissions: ["activeTab", "scripting", "storage"]`
   - `host_permissions: ["<all_urls>"]` (required to inject into pages we want to translate)
   - `background.scripts` (Firefox MV3 still supports background scripts; service workers also OK from FF 121)
   - `action.default_icon` + `default_title`
   - `web_accessible_resources` for the WASM/model files so the Worker can fetch them via `browser.runtime.getURL`
3. Add esbuild script that bundles `src/background/*` and `src/content/*` to `dist/`.
4. Wire `web-ext run` for hot-reload during dev.

**Files**: `manifest.json`, `package.json`, `tsconfig.json`, `web-ext-config.js`, `esbuild.config.mjs`.

### Phase 2 — Vendor Bergamot + DE→EN model (~2 hr)
1. Download prebuilt Bergamot WASM artifacts from `https://github.com/mozilla/firefox-translations-models` (or `browsermt/bergamot-translator` releases).
2. Place `bergamot-translator-worker.js` + `.wasm` under `vendor/`.
3. Place DE→EN model files (`model.deen.intgemm.alphas.bin`, `lex.50.50.deen.s2t.bin`, `vocab.deen.spm`) under `models/deen/`.
4. Add these paths to `web_accessible_resources` in manifest so the Worker can fetch them.
5. Document in `README.md` exactly which release/version was vendored and how to refresh.

**Risk**: Bergamot WASM model format and worker API can change between releases. Pin a specific tag and check it in (do not depend on a CDN).

### Phase 3 — Background engine (~3 hr)
1. `src/background/engine.worker.ts`: dedicated Worker that:
   - Loads Bergamot WASM via `importScripts(browser.runtime.getURL('vendor/bergamot-translator-worker.js'))` or ES module import.
   - Initializes `BlockingService` and loads the DE→EN `TranslationModel` (fetch model files via `browser.runtime.getURL` → ArrayBuffer).
   - Exposes `postMessage({ type: 'TRANSLATE', payload: string[] })` → replies with `string[]` aligned to input.
2. `src/background/engine.ts`: thin wrapper that owns the Worker, queues requests, and resolves Promises.
   - Lazy init: only spin up the Worker on the first `translate()` call.
   - Concurrency: cap to 1 in-flight batch per tab; Bergamot is CPU-bound, queuing helps.
3. `src/background/tab-state.ts`: `Map<tabId, 'idle' | 'translating' | 'translated'>` with `chrome.action.setBadgeText` reflecting state.
4. `src/background/service-worker.ts`:
   - Listen for `action.onClicked` → look up state → send `TRANSLATE_PAGE` or `RESTORE_PAGE` to the content script via `tabs.sendMessage`.
   - Inject content script via `scripting.executeScript` if not already present (idempotency check via a global flag).
   - Message handler for `TRANSLATE_BATCH` from content script → call `engine.translate()` → reply.

**Files**: `src/background/{service-worker,engine,engine.worker,tab-state}.ts`, `src/shared/messages.ts`.

### Phase 4 — Content script: walker, skip rules, store (~3 hr)
1. `src/content/skip-rules.ts`: predicates `shouldSkipElement(el)` and `shouldSkipText(node)`.
   - Element skip: tag in `{SCRIPT, STYLE, NOSCRIPT, CODE, PRE, KBD, SAMP, TEXTAREA}`, `translate="no"`, `classList.contains('notranslate')`, `isContentEditable`.
   - Text skip: empty/whitespace-only, pure-number, pure-URL.
2. `src/content/walker.ts`: TreeWalker over `document.body` filtering with skip rules. Also:
   - For each element, if `placeholder` attribute exists and element is `<input>` or `<textarea>`, emit a synthetic "attribute target".
   - For each `<button>` and `<option>`, the TreeWalker already picks up text children — no special handling needed.
   - If element has open `shadowRoot`, recurse into it.
   - For each same-origin iframe (try/catch on `iframe.contentDocument`), recurse into its body.
3. `src/content/store.ts`: `WeakMap<Text | Element, string>` storing originals. For attributes (placeholder), use `WeakMap<Element, Map<string, string>>`.

**Files**: `src/content/{walker,skip-rules,store}.ts`.

### Phase 5 — Translate flow + apply (~2 hr)
1. `src/content/replace.ts`:
   - Collect all targets from walker into `Array<{ kind: 'text', node: Text } | { kind: 'attr', el: Element, name: string }>`.
   - Extract source strings; chunk into batches of ~150.
   - For each batch, `browser.runtime.sendMessage({ type: 'TRANSLATE_BATCH', strings })` → await.
   - Apply: `node.nodeValue = translated[i]` or `el.setAttribute(name, translated[i])`.
   - Store original in WeakMap **before** mutating.
2. Restore flow: walk WeakMap entries (need a Set of touched nodes since WeakMap is not iterable — keep a parallel `Set<Node>` for the lifetime of the translation).
3. Wire into content-script entry `main.ts`:
   - Listen for `TRANSLATE_PAGE` and `RESTORE_PAGE` messages from background.
   - On `TRANSLATE_PAGE`: run walker → batch send → apply → install MutationObserver.
   - On `RESTORE_PAGE`: stop observer → walk touched set → restore from WeakMap.

**Files**: `src/content/{replace,main}.ts`.

### Phase 6 — MutationObserver for dynamic content (~2 hr)
1. `src/content/observer.ts`:
   - Watch `document.body` with `{ childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder'] }`.
   - Debounce mutations into 100ms windows.
   - For each added node: run walker → translate → apply.
   - For each `characterData` mutation: if node was previously translated, ignore (avoid loops); otherwise translate.
   - **Loop prevention**: when applying a translation, set a flag (`translating = true`) before mutating to suppress observer reentrance; or compare against expected post-translation value.
2. Recurse observers into shadow roots and same-origin iframes added later.

**Files**: `src/content/observer.ts`.

### Phase 7 — Toolbar UX & state ($&approx; 1 hr)
1. Icon states (use badge color/text):
   - idle: no badge
   - translating: spinner-like "…" badge, orange background
   - translated: "EN" badge, green background
2. Tooltip via `browser.action.setTitle` reflecting state.
3. (Optional v1.1) popup with progress / error.

**Files**: `src/background/service-worker.ts` (badge logic).

### Phase 8 — Tests (~2 hr)
1. Unit tests (vitest) for:
   - `skip-rules` — table-driven cases
   - `walker` — fixture HTML strings → expected target lists
   - `store` — original/restore round-trip
2. E2E smoke tests (playwright + web-ext):
   - Load extension into a Firefox instance
   - Open `tests/fixtures/de-page.html`
   - Click action → assert text translated and form input preserved
   - Click action again → assert restored
   - Trigger dynamic insertion → assert auto-translated
3. Hand-test matrix: Wikipedia DE, Spiegel, ImmoScout24 (forms!), a custom-element demo.

### Phase 9 — Docs & release ($&approx; 1 hr)
1. `README.md`: install, dev, build, vendor refresh instructions, known limits.
2. `npm run build` → `web-ext build` → unsigned XPI for self-install via `about:debugging` or signed for AMO.
3. (Out of v1) AMO submission requires Mozilla review of WASM blobs; budget extra time when ready.

---

## 6. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Bergamot WASM API drifts between vendored release and our binding code | Med | High (build break) | Pin exact release tag; document in README; smoke test on every dependency bump. |
| Bundling ~17MB model bloats extension size; AMO may flag | High | Med | Acceptable for self-install. For AMO, switch to on-demand download via `fetch()` against a Mozilla CDN (Phase post-v1). |
| Service worker timeout (Firefox kills idle SWs) drops the warm engine, causing slow re-init | Med | Low | Already handled: re-init is automatic on next call. Add lightweight cache of fetched ArrayBuffers if init is too slow. |
| MutationObserver causes infinite translate loops (we translate → observer fires → we translate again) | High | High (browser freeze) | Set `isApplying` flag during DOM writes; observer ignores mutations from translated nodes via WeakSet check. |
| Translating inside shadow DOM of closed shadow roots impossible | Low | Low | Document limitation; closed shadow roots are rare and intentionally opaque. |
| Cross-origin iframes (e.g. embedded YouTube DE description) cannot be reached | Cert | Med | Document limitation. v1.1: inject content script into iframe origins via `all_frames: true` content script declaration. |
| Pages relying on exact `textContent` (e.g. hash check, search-index) misbehave after translation | Low | Low | Same risk as Firefox built-in; documented limitation. |
| Bergamot mistranslates technical jargon → user expects better than Firefox's built-in | Med | Low | Quality is bounded by the model. v1 ships with the same model; "better than Firefox" comes from *coverage* (placeholders, dynamic content), not model quality. Set expectations in README. |
| Large pages (>5000 text nodes) block UI during batch send | Med | Med | Chunk to ~150 nodes; await each batch sequentially; show "…" badge as progress signal. |
| Firefox MV3 differences from Chrome MV3 (e.g. background.scripts vs service_worker) | Cert | Low | Target Firefox only; use `browser.*` namespace; test on Firefox ESR 128+. |

---

## 7. Verification Steps

To be run before declaring v1 done:

1. **Smoke**: install via `about:debugging` → navigate to `https://de.wikipedia.org/wiki/Berlin` → type "hello" into search → click toolbar → search input retains "hello" AND page body is EN.
2. **Restore**: click again → page body is byte-identical to pre-translation snapshot (capture via `document.body.innerHTML` before/after; assert equality).
3. **Form coverage**: visit `https://www.immobilienscout24.de/` (forms-heavy DE site) → click translate → verify placeholders and button labels are EN.
4. **Dynamic content**: visit any DE infinite-scroll page (e.g. `https://www.spiegel.de/`), click translate, scroll → newly loaded headlines appear in EN.
5. **Shadow DOM**: create fixture `tests/fixtures/shadow.html` with `<x-card>DE text</x-card>` using open shadow root → translate → EN.
6. **Iframe (same-origin)**: fixture with `<iframe src="./inner.html">` where inner has DE text → translate → iframe content EN.
7. **Skip rules**: fixture with `<pre>DE</pre>`, `<code>DE</code>`, `<span translate="no">DE</span>`, `<span class="notranslate">DE</span>`, `<input disabled value="DE">` → all must be untouched.
8. **Performance**: `https://de.wikipedia.org/wiki/Quantenmechanik` (~6000 words). Time from click to last paint < 8s on M-series Mac. Memory delta < 50MB after 10 toggle cycles (DevTools memory profile).
9. **No-reload assertion**: in DevTools console before click: `let n = performance.now(); window.__t = n;` then after click: `performance.getEntriesByType('navigation').length` unchanged from 1, and `window.__t` still defined.
10. **Lint/build**: `npm run lint && npm run build && npm run test` all green. `web-ext lint` reports 0 errors.

---

## 8. Open Questions / Deferred

These are not blockers for v1 but should be tracked:

- **Multi-language support**: extend settings UI + on-demand model download. Phase v1.1.
- **Cross-origin iframes**: requires content script with `all_frames: true` + per-origin permissions UX.
- **Selection-only translation**: right-click → translate selection. Phase v1.2.
- **`alt` and `title` attributes**: user deferred these in scoping; revisit if requested.
- **AMO signing & distribution**: requires Mozilla review of bundled WASM; v1 distributes as self-install XPI.

---

## 9. Time Estimate (rough)

| Phase | Hours |
|-------|-------|
| 1 — Scaffold | 1 |
| 2 — Vendor Bergamot | 2 |
| 3 — Background engine | 3 |
| 4 — Content walker/store | 3 |
| 5 — Translate/apply flow | 2 |
| 6 — MutationObserver | 2 |
| 7 — Toolbar UX | 1 |
| 8 — Tests | 2 |
| 9 — Docs & build | 1 |
| **Total** | **~17 hr** |

Realistic calendar time over an evenings-and-weekends pace: ~1 week.

---

## 10. First Concrete Action

If you approve the plan, the immediate next step is **Phase 1 — Scaffold**:
- Create `package.json`, `tsconfig.json`, `manifest.json`, esbuild config, and `web-ext` config.
- Stub `src/background/service-worker.ts` and `src/content/main.ts` with a no-op `console.log` so the toolbar button is clickable end-to-end before any real translation logic lands.

This gives a runnable "extension that does nothing yet" you can load via `about:debugging` and iterate against.
