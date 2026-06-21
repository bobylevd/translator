export const SHOW_ELEMENT = 1;
export const SHOW_TEXT = 4;
export const FILTER_ACCEPT = 1;
export const FILTER_REJECT = 2;
export const FILTER_SKIP = 3;

export class FakeNode {
  static ELEMENT_NODE = 1;
  static TEXT_NODE = 3;
  static DOCUMENT_NODE = 9;
  static DOCUMENT_FRAGMENT_NODE = 11;

  constructor(nodeType, ownerDocument = null) {
    this.nodeType = nodeType;
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
    this.parentElement = null;
    this.isConnected = true;
  }

  append(...children) {
    for (const child of children) {
      child.ownerDocument = this.ownerDocument ?? (this instanceof FakeDocument ? this : null);
      child.parentElement = this instanceof FakeElement ? this : null;
      child.isConnected = this.isConnected;
      this.childNodes.push(child);
    }
  }
}

export class FakeText extends FakeNode {
  constructor(data, ownerDocument = null) {
    super(FakeNode.TEXT_NODE, ownerDocument);
    this.data = data;
  }
}

export class FakeClassList {
  constructor(values = []) {
    this.values = new Set(values);
  }

  contains(value) {
    return this.values.has(value);
  }
}

export class FakeElement extends FakeNode {
  constructor(tagName, attrs = {}, ownerDocument = null) {
    super(FakeNode.ELEMENT_NODE, ownerDocument);
    this.tagName = tagName.toUpperCase();
    this.attrs = new Map();
    this.classList = new FakeClassList();
    this.isContentEditable = false;
    this.shadowRoot = null;
    this.contentDocument = null;
    for (const [key, value] of Object.entries(attrs)) {
      this.setAttribute(key, value);
    }
  }

  getAttribute(name) {
    return this.attrs.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attrs.has(name);
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attrs.set(name, stringValue);
    if (name === 'class') {
      this.classList = new FakeClassList(stringValue.split(/\s+/).filter(Boolean));
    }
    if (name === 'contenteditable' && stringValue !== 'false') {
      this.isContentEditable = true;
    }
  }

  attachShadow() {
    this.shadowRoot = new FakeShadowRoot(this, this.ownerDocument);
    return this.shadowRoot;
  }
}

export class FakeShadowRoot extends FakeNode {
  constructor(host, ownerDocument = null) {
    super(FakeNode.DOCUMENT_FRAGMENT_NODE, ownerDocument);
    this.host = host;
    this.mode = 'open';
  }
}

export class FakeDocument extends FakeNode {
  constructor() {
    super(FakeNode.DOCUMENT_NODE, null);
    this.ownerDocument = null;
    this.body = new FakeElement('body', {}, this);
    this.append(this.body);
  }

  createTreeWalker(root, whatToShow, filter) {
    const nodes = [];
    const accept = node => filter?.acceptNode ? filter.acceptNode(node) : FILTER_ACCEPT;
    const visible = node => {
      if (node.nodeType === FakeNode.ELEMENT_NODE) return (whatToShow & SHOW_ELEMENT) !== 0;
      if (node.nodeType === FakeNode.TEXT_NODE) return (whatToShow & SHOW_TEXT) !== 0;
      return false;
    };
    const visit = node => {
      for (const child of node.childNodes) {
        if (!visible(child)) {
          if (child.childNodes.length > 0) visit(child);
          continue;
        }
        const result = accept(child);
        if (result === FILTER_REJECT) continue;
        if (result === FILTER_ACCEPT) nodes.push(child);
        if (child.childNodes.length > 0) visit(child);
      }
    };
    visit(root);
    let index = 0;
    return {
      nextNode() {
        return nodes[index++] ?? null;
      },
    };
  }
}

export function installFakeDom() {
  globalThis.NodeFilter = {
    SHOW_ELEMENT,
    SHOW_TEXT,
    FILTER_ACCEPT,
    FILTER_REJECT,
    FILTER_SKIP,
  };
  globalThis.Node = FakeNode;
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLIFrameElement = FakeElement;
  globalThis.ShadowRoot = FakeShadowRoot;
  globalThis.Document = FakeDocument;
  globalThis.Text = FakeText;
}

export function createDocument() {
  const doc = new FakeDocument();
  globalThis.document = doc;
  return doc;
}

export function el(tagName, attrs = {}, ...children) {
  const node = new FakeElement(tagName, attrs, globalThis.document ?? null);
  node.append(...children);
  return node;
}

export function text(value) {
  return new FakeText(value, globalThis.document ?? null);
}
