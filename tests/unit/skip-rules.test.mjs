import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeElement, installFakeDom } from './fake-dom.mjs';

installFakeDom();

const { attrTargetsFor, shouldSkipElement, shouldSkipText } = await import('../../.tmp-tests/content/skip-rules.js');

test('shouldSkipElement rejects non-translatable subtrees', () => {
  assert.equal(shouldSkipElement(new FakeElement('script')), true);
  assert.equal(shouldSkipElement(new FakeElement('textarea')), true);
  assert.equal(shouldSkipElement(new FakeElement('span', { translate: 'no' })), true);
  assert.equal(shouldSkipElement(new FakeElement('span', { class: 'notranslate' })), true);

  const editable = new FakeElement('div');
  editable.isContentEditable = true;
  assert.equal(shouldSkipElement(editable), true);

  assert.equal(shouldSkipElement(new FakeElement('p')), false);
});

test('shouldSkipText rejects empty, numeric, and URL-like strings', () => {
  assert.equal(shouldSkipText('   '), true);
  assert.equal(shouldSkipText('42,00 €'), true);
  assert.equal(shouldSkipText('https://example.com/de'), true);
  assert.equal(shouldSkipText('Hallo Welt'), false);
});

test('attrTargetsFor covers form labels without mutating disabled controls', () => {
  assert.deepEqual(attrTargetsFor(new FakeElement('input', { placeholder: 'Name' })), ['placeholder']);
  assert.deepEqual(attrTargetsFor(new FakeElement('input', { type: 'submit', value: 'Senden' })), ['value', 'placeholder']);
  assert.deepEqual(attrTargetsFor(new FakeElement('textarea', { placeholder: 'Kommentar' })), ['placeholder']);
  assert.deepEqual(attrTargetsFor(new FakeElement('input', { type: 'submit', disabled: '' })), []);
});
