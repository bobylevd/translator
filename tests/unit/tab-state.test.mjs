import assert from 'node:assert/strict';
import test from 'node:test';

const calls = [];
globalThis.browser = {
  action: {
    async setBadgeText(args) {
      calls.push(['text', args]);
    },
    async setBadgeBackgroundColor(args) {
      calls.push(['color', args]);
    },
    async setTitle(args) {
      calls.push(['title', args]);
    },
  },
};

const tabState = await import('../../.tmp-tests/background/tab-state.js');

test('tab state drives badge text, color, and tooltip', async () => {
  assert.equal(tabState.get(7), 'idle');

  await tabState.set(7, 'translating');
  assert.equal(tabState.get(7), 'translating');
  assert.deepEqual(calls.at(-3), ['text', { tabId: 7, text: '…' }]);
  assert.deepEqual(calls.at(-2), ['color', { tabId: 7, color: '#e67e22' }]);
  assert.deepEqual(calls.at(-1), ['title', { tabId: 7, title: 'Translating page…' }]);

  await tabState.set(7, 'translated', 'fr');
  assert.equal(tabState.get(7), 'translated');
  assert.deepEqual(calls.at(-3), ['text', { tabId: 7, text: 'FR' }]);
  assert.deepEqual(calls.at(-1), ['title', { tabId: 7, title: 'Restore original text (FR)' }]);

  tabState.forget(7);
  assert.equal(tabState.get(7), 'idle');
});
