import { MSG, type AnyMsg, type TranslateBatchReply } from '../shared/messages.js';
import { isAttrTranslated, isTextTranslated, remember, restoreAll, touchedTextCount } from './store.js';
import { collectTargets, type Target } from './walker.js';

declare global {
  interface Window {
    __translatorInjected?: boolean;
  }
}

const BATCH_SIZE = 128;
const OBSERVER_FLUSH_MS = 200;

let active = false;
let observer: MutationObserver | null = null;
let pendingRoots = new Set<Node>();
let flushHandle: ReturnType<typeof setTimeout> | null = null;
let inFlightBatches = 0;

function alreadyTranslated(t: Target): boolean {
  return t.kind === 'text' ? isTextTranslated(t.node) : isAttrTranslated(t.el, t.attr);
}

async function translateTargets(targets: Target[]): Promise<void> {
  const fresh = targets.filter(t => !alreadyTranslated(t));
  if (fresh.length === 0) return;

  for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
    const slice = fresh.slice(i, i + BATCH_SIZE);
    const strings = slice.map(t => t.body);
    let reply: TranslateBatchReply | undefined;
    try {
      reply = (await browser.runtime.sendMessage({
        type: MSG.TRANSLATE_BATCH,
        strings,
      })) as TranslateBatchReply | undefined;
    } catch (err) {
      console.error('[translator/cs] batch failed:', err);
      continue;
    }
    if (!reply?.results || reply.results.length !== slice.length) {
      console.warn('[translator/cs] batch reply mismatch', { sent: slice.length, got: reply?.results?.length });
      continue;
    }

    inFlightBatches++;
    try {
      for (let j = 0; j < slice.length; j++) {
        const target = slice[j]!;
        const translated = reply.results[j] ?? '';
        if (translated === target.body) continue;
        remember(target);
        if (target.kind === 'text') {
          if (!target.node.isConnected) continue;
          target.node.data = target.leading + translated + target.trailing;
        } else {
          if (!target.el.isConnected) continue;
          target.el.setAttribute(target.attr, translated);
        }
      }
    } finally {
      inFlightBatches--;
      // Drain our own mutations so the observer doesn't re-translate them.
      observer?.takeRecords();
    }
  }
}

function scheduleFlush(): void {
  if (flushHandle !== null) return;
  flushHandle = setTimeout(() => {
    flushHandle = null;
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();
    if (roots.length === 0) return;
    const targets: Target[] = [];
    for (const root of roots) {
      if (!(root instanceof Element) && !(root instanceof ShadowRoot) && !(root instanceof Document)) continue;
      const r = root as Element | ShadowRoot | Document;
      if (r instanceof Element && !r.isConnected) continue;
      for (const t of collectTargets(r as ParentNode)) targets.push(t);
    }
    if (targets.length > 0) {
      console.log(`[translator/cs] observer: +${targets.length} targets`);
      translateTargets(targets).catch(err => console.error('[translator/cs] observer translate failed:', err));
    }
  }, OBSERVER_FLUSH_MS);
}

function installObserver(): void {
  if (observer) return;
  observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'childList') {
        r.addedNodes.forEach(n => {
          if (n.nodeType === Node.ELEMENT_NODE) pendingRoots.add(n);
          else if (n.nodeType === Node.TEXT_NODE && n.parentElement) pendingRoots.add(n.parentElement);
        });
      } else if (r.type === 'characterData') {
        if (r.target.parentElement) pendingRoots.add(r.target.parentElement);
      } else if (r.type === 'attributes' && r.target.nodeType === Node.ELEMENT_NODE) {
        pendingRoots.add(r.target);
      }
    }
    scheduleFlush();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['placeholder', 'value'],
  });
}

function uninstallObserver(): void {
  if (!observer) return;
  observer.disconnect();
  observer = null;
  if (flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }
  pendingRoots.clear();
}

async function translatePage(): Promise<void> {
  if (active) return;
  active = true;
  installObserver();
  const targets = collectTargets(document.body);
  console.log(`[translator/cs] initial walk: ${targets.length} targets`);
  await translateTargets(targets);
  // Anything Angular/React rendered during apply got queued by the observer.
  // Trigger an immediate flush so the user doesn't wait for the timer.
  if (pendingRoots.size > 0 && flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
    scheduleFlush();
  }
  console.log(`[translator/cs] in-flight batches: ${inFlightBatches}; translated ${touchedTextCount()} text nodes`);
}

function restorePage(): void {
  uninstallObserver();
  restoreAll();
  active = false;
  console.log('[translator/cs] restored');
}

if (window.__translatorInjected) {
  console.log('[translator/cs] already injected, skipping');
} else {
  window.__translatorInjected = true;

  browser.runtime.onMessage.addListener((msg: AnyMsg): Promise<unknown> | undefined => {
    if (msg.type === MSG.PING) {
      return Promise.resolve({ ok: true });
    }
    if (msg.type === MSG.TRANSLATE_PAGE) {
      return translatePage()
        .then(() => ({ ok: true, count: touchedTextCount() }))
        .catch(err => ({ ok: false, error: String(err) }));
    }
    if (msg.type === MSG.RESTORE_PAGE) {
      restorePage();
      return Promise.resolve({ ok: true });
    }
    return undefined;
  });

  console.log('[translator/cs] loaded on', location.href);
}
