import { MSG, type AnyMsg, type TranslateBatchReply } from '../shared/messages.js';
import { isAttrTranslated, isTextTranslated, remember, restoreAll, touchedTextCount } from './store.js';
import { shouldSkipElement } from './skip-rules.js';
import { collectTargets, type Target } from './walker.js';

declare global {
  interface Window {
    __translatorInjected?: boolean;
  }
}

const BATCH_SIZE = 128;
const OBSERVER_FLUSH_MS = 200;

let active = false;
let isApplying = false;
const observers = new Map<ParentNode, MutationObserver>();
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
    isApplying = true;
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
      isApplying = false;
      inFlightBatches--;
      // Drain our own mutations so the observer doesn't re-translate them.
      drainObserverRecords();
    }
  }
}

function rootIsConnected(root: ParentNode): boolean {
  if (root instanceof Document) return true;
  if (root instanceof ShadowRoot) return root.host.isConnected;
  if (root instanceof Element) return root.isConnected;
  return true;
}

function isCollectableRoot(root: Node): root is ParentNode {
  return root instanceof Element || root instanceof ShadowRoot || root instanceof Document;
}

function queueRoot(root: Node): void {
  if (!active) return;
  if (!isCollectableRoot(root)) return;
  if (!rootIsConnected(root)) return;
  pendingRoots.add(root);
}

function drainObserverRecords(): void {
  for (const observer of observers.values()) observer.takeRecords();
}

function observeRoot(root: ParentNode): void {
  if (observers.has(root)) return;
  const observer = new MutationObserver(records => {
    if (!active) return;
    if (isApplying) return;
    for (const r of records) {
      if (r.type === 'childList') {
        r.addedNodes.forEach(n => {
          if (n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            queueRoot(n);
          } else if (n.nodeType === Node.TEXT_NODE && n.parentElement) {
            queueRoot(n.parentElement);
          }
        });
      } else if (r.type === 'characterData') {
        if (r.target.parentElement) queueRoot(r.target.parentElement);
      } else if (r.type === 'attributes' && r.target.nodeType === Node.ELEMENT_NODE) {
        queueRoot(r.target);
      }
    }
    scheduleFlush();
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['placeholder', 'value'],
  });
  observers.set(root, observer);
}

function discoverNestedRoots(root: ParentNode): void {
  if (root instanceof Element && shouldSkipElement(root)) return;

  const visit = (el: Element): void => {
    if (shouldSkipElement(el)) return;

    const shadow = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (shadow && shadow.mode === 'open') {
      observeRoot(shadow);
      discoverNestedRoots(shadow);
    }

    if (el.tagName === 'IFRAME') {
      const iframe = el as HTMLIFrameElement;
      const observeFrame = () => {
        if (!active) return;
        try {
          const body = iframe.contentDocument?.body;
          if (body) {
            observeRoot(body);
            discoverNestedRoots(body);
            queueRoot(body);
            scheduleFlush();
          }
        } catch {
          // cross-origin — skip
        }
      };
      observeFrame();
      iframe.addEventListener('load', observeFrame, { once: true });
    }
  };

  if (root instanceof Element) visit(root);

  const doc = (root as Node).ownerDocument ?? document;
  const walker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      return shouldSkipElement(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let n: Node | null;
  while ((n = walker.nextNode())) visit(n as Element);
}

async function flushPending(): Promise<void> {
  if (!active) return;
  if (flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }
  const roots = Array.from(pendingRoots);
  pendingRoots.clear();
  if (roots.length === 0) return;
  const targets: Target[] = [];
  for (const root of roots) {
    if (!isCollectableRoot(root) || !rootIsConnected(root)) continue;
    discoverNestedRoots(root);
    for (const t of collectTargets(root)) targets.push(t);
  }
  if (targets.length > 0) {
    console.log(`[translator/cs] observer: +${targets.length} targets`);
    await translateTargets(targets);
  }
}

function scheduleFlush(): void {
  if (!active) return;
  if (flushHandle !== null) return;
  flushHandle = setTimeout(() => {
    flushHandle = null;
    flushPending().catch(err => console.error('[translator/cs] observer translate failed:', err));
  }, OBSERVER_FLUSH_MS);
}

function installObservers(root: ParentNode): void {
  observeRoot(root);
  discoverNestedRoots(root);
}

function uninstallObservers(): void {
  for (const observer of observers.values()) observer.disconnect();
  observers.clear();
  if (flushHandle !== null) {
    clearTimeout(flushHandle);
    flushHandle = null;
  }
  pendingRoots.clear();
}

async function translatePage(): Promise<void> {
  if (active) return;
  active = true;
  installObservers(document.body);
  const targets = collectTargets(document.body);
  console.log(`[translator/cs] initial walk: ${targets.length} targets`);
  await translateTargets(targets);
  await flushPending();
  console.log(`[translator/cs] in-flight batches: ${inFlightBatches}; translated ${touchedTextCount()} text nodes`);
}

function restorePage(): void {
  uninstallObservers();
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
