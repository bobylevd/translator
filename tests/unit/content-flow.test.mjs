import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocument, el, installFakeDom, text } from './fake-dom.mjs';

installFakeDom();

class FakeMutationObserver {
  static observers = new Set();

  constructor(callback) {
    this.callback = callback;
    this.connected = false;
  }

  observe() {
    this.connected = true;
    FakeMutationObserver.observers.add(this);
  }

  disconnect() {
    this.connected = false;
    FakeMutationObserver.observers.delete(this);
  }

  takeRecords() {
    return [];
  }

  static emit(records) {
    for (const observer of FakeMutationObserver.observers) {
      if (observer.connected) observer.callback(records);
    }
  }
}

test('content script translates, observes dynamic text, restores, and can translate again', async () => {
  const timers = [];
  globalThis.setTimeout = fn => {
    timers.push(fn);
    return timers.length;
  };
  globalThis.clearTimeout = () => {};
  globalThis.MutationObserver = FakeMutationObserver;
  globalThis.window = globalThis;
  globalThis.location = { href: 'file:///fixture.html' };

  const doc = createDocument();
  const headline = el('h1', {}, text('Hallo Welt'));
  const input = el('input', { placeholder: 'Suche eingeben' });
  input.value = 'typed value';
  const button = el('button', {}, text('Absenden'));
  doc.body.append(headline, input, button);

  const listeners = [];
  globalThis.browser = {
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        },
      },
      async sendMessage(msg) {
        return { results: msg.strings.map(value => `EN:${value}`) };
      },
    },
  };

  await import('../../.tmp-tests/content/main.js');
  assert.equal(listeners.length, 1);

  const listener = listeners[0];
  const translated = await listener({ type: 'translator/translate-page' });
  assert.equal(translated.ok, true);
  assert.equal(headline.childNodes[0].data, 'EN:Hallo Welt');
  assert.equal(input.getAttribute('placeholder'), 'EN:Suche eingeben');
  assert.equal(input.value, 'typed value');
  assert.equal(button.childNodes[0].data, 'EN:Absenden');

  const dynamic = el('p', {}, text('Dynamischer Text'));
  doc.body.append(dynamic);
  FakeMutationObserver.emit([{ type: 'childList', addedNodes: [dynamic] }]);
  while (timers.length > 0) timers.shift()();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(dynamic.childNodes[0].data, 'EN:Dynamischer Text');

  const restored = await listener({ type: 'translator/restore-page' });
  assert.equal(restored.ok, true);
  assert.equal(headline.childNodes[0].data, 'Hallo Welt');
  assert.equal(input.getAttribute('placeholder'), 'Suche eingeben');
  assert.equal(button.childNodes[0].data, 'Absenden');
  assert.equal(dynamic.childNodes[0].data, 'Dynamischer Text');

  const translatedAgain = await listener({ type: 'translator/translate-page' });
  assert.equal(translatedAgain.ok, true);
  assert.equal(headline.childNodes[0].data, 'EN:Hallo Welt');
});
