const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'CODE',
  'PRE',
  'KBD',
  'SAMP',
  'CANVAS',
  'SVG',
  'MATH',
  'OBJECT',
  'EMBED',
  'VIDEO',
  'AUDIO',
]);

export function shouldSkipElement(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.getAttribute('translate') === 'no') return true;
  if (el.classList.contains('notranslate')) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

const NUMERIC_ONLY = /^[\s\d.,:;!?\-+/*()%€$£¥]+$/;
const URL_LIKE = /^https?:\/\/\S+$/i;

export function shouldSkipText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 2) return true;
  if (NUMERIC_ONLY.test(trimmed)) return true;
  if (URL_LIKE.test(trimmed)) return true;
  return false;
}

const BUTTON_INPUT_TYPES = new Set(['submit', 'button', 'reset']);

export function attrTargetsFor(el: Element): ReadonlyArray<string> {
  if (el.tagName === 'INPUT') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (BUTTON_INPUT_TYPES.has(type)) return ['value', 'placeholder'];
    return ['placeholder'];
  }
  if (el.tagName === 'TEXTAREA') return ['placeholder'];
  return [];
}
