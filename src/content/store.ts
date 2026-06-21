import type { AttrTarget, Target, TextTarget } from './walker.js';

const textOriginals = new WeakMap<Text, string>();
const attrOriginals = new WeakMap<Element, Map<string, string>>();

const touchedTexts = new Set<Text>();
const touchedAttrs = new Set<{ el: Element; attr: string }>();

export function rememberTextOriginal(t: TextTarget): void {
  if (!textOriginals.has(t.node)) {
    textOriginals.set(t.node, t.original);
  }
  touchedTexts.add(t.node);
}

export function rememberAttrOriginal(t: AttrTarget): void {
  let m = attrOriginals.get(t.el);
  if (!m) {
    m = new Map();
    attrOriginals.set(t.el, m);
  }
  if (!m.has(t.attr)) {
    m.set(t.attr, t.original);
  }
  touchedAttrs.add({ el: t.el, attr: t.attr });
}

export function remember(target: Target): void {
  if (target.kind === 'text') rememberTextOriginal(target);
  else rememberAttrOriginal(target);
}

export function restoreAll(): void {
  for (const node of touchedTexts) {
    const orig = textOriginals.get(node);
    if (orig !== undefined) node.data = orig;
  }
  touchedTexts.clear();

  for (const { el, attr } of touchedAttrs) {
    const m = attrOriginals.get(el);
    if (!m) continue;
    const orig = m.get(attr);
    if (orig !== undefined) el.setAttribute(attr, orig);
  }
  touchedAttrs.clear();
}

export function touchedTextCount(): number {
  return touchedTexts.size;
}

export function isTextTranslated(node: Text): boolean {
  return textOriginals.has(node);
}

export function isAttrTranslated(el: Element, attr: string): boolean {
  return attrOriginals.get(el)?.has(attr) ?? false;
}
