import assert from 'node:assert/strict';
import test from 'node:test';

const {
  isAttrTranslated,
  isTextTranslated,
  remember,
  restoreAll,
  touchedTextCount,
} = await import('../../.tmp-tests/content/store.js');

test('store restores text nodes and clears translated state', () => {
  const node = { data: 'Hallo', isConnected: true };
  remember({
    kind: 'text',
    node,
    original: 'Hallo',
    leading: '',
    body: 'Hallo',
    trailing: '',
  });

  assert.equal(isTextTranslated(node), true);
  assert.equal(touchedTextCount(), 1);

  node.data = 'Hello';
  restoreAll();

  assert.equal(node.data, 'Hallo');
  assert.equal(isTextTranslated(node), false);
  assert.equal(touchedTextCount(), 0);
});

test('store restores attributes and clears translated state', () => {
  const attrs = new Map([['placeholder', 'Ihr Name']]);
  const el = {
    isConnected: true,
    setAttribute(name, value) {
      attrs.set(name, value);
    },
  };

  remember({
    kind: 'attr',
    el,
    attr: 'placeholder',
    original: 'Ihr Name',
    body: 'Ihr Name',
  });

  assert.equal(isAttrTranslated(el, 'placeholder'), true);
  attrs.set('placeholder', 'Your name');
  restoreAll();

  assert.equal(attrs.get('placeholder'), 'Ihr Name');
  assert.equal(isAttrTranslated(el, 'placeholder'), false);
});
