import { attrTargetsFor, shouldSkipElement, shouldSkipText } from './skip-rules.js';

export interface TextTarget {
  kind: 'text';
  node: Text;
  original: string;
  leading: string;
  body: string;
  trailing: string;
}

export interface AttrTarget {
  kind: 'attr';
  el: Element;
  attr: string;
  original: string;
  body: string;
}

export type Target = TextTarget | AttrTarget;

const WHITESPACE_RE = /^(\s*)(.*?)(\s*)$/s;

function splitWhitespace(text: string): { leading: string; body: string; trailing: string } {
  const m = WHITESPACE_RE.exec(text);
  if (!m) return { leading: '', body: text, trailing: '' };
  return { leading: m[1] ?? '', body: m[2] ?? '', trailing: m[3] ?? '' };
}

export function collectTargets(root: ParentNode): Target[] {
  const targets: Target[] = [];
  walk(root, targets);
  return targets;
}

function walk(root: ParentNode, out: Target[]): void {
  if (root instanceof Element && shouldSkipElement(root)) return;

  const doc = (root as Node).ownerDocument ?? document;

  function addElementTargets(el: Element): void {
    for (const attr of attrTargetsFor(el)) {
      const val = el.getAttribute(attr);
      if (val === null) continue;
      if (shouldSkipText(val)) continue;
      const { body } = splitWhitespace(val);
      if (body.length === 0) continue;
      out.push({ kind: 'attr', el, attr, original: val, body });
    }
    const shadow = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (shadow && shadow.mode === 'open') {
      walk(shadow, out);
    }
    if (el.tagName === 'IFRAME') {
      try {
        const idoc = (el as HTMLIFrameElement).contentDocument;
        if (idoc?.body) walk(idoc.body, out);
      } catch {
        // cross-origin — skip
      }
    }
  }

  // Pass 1: text nodes (reject subtree of skip elements).
  const textWalker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        return shouldSkipElement(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
      const text = (node as Text).data;
      return shouldSkipText(text) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let n: Node | null;
  while ((n = textWalker.nextNode())) {
    const t = n as Text;
    const { leading, body, trailing } = splitWhitespace(t.data);
    if (body.length === 0) continue;
    out.push({ kind: 'text', node: t, original: t.data, leading, body, trailing });
  }

  // Pass 2: elements (attributes + shadow/iframe recursion, rejecting skipped subtrees).
  if (root instanceof Element) addElementTargets(root);
  const elWalker = doc.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      return shouldSkipElement(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let e: Node | null;
  while ((e = elWalker.nextNode())) {
    addElementTargets(e as Element);
  }
}
