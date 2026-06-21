import assert from 'node:assert/strict';
import test from 'node:test';

class FakeWorker {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter(value => value !== listener));
  }

  postMessage(msg) {
    if (msg.type === 'INIT') {
      queueMicrotask(() => this.emit('message', { data: { type: 'READY' } }));
    }
  }

  terminate() {}

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

async function flushMicrotasks() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

test('service worker action injects, translates, restores, and resets on navigation', async () => {
  const actionListeners = [];
  const removedListeners = [];
  const updatedListeners = [];
  const runtimeListeners = [];
  const executeCalls = [];
  const sentMessages = [];
  const badgeCalls = [];

  globalThis.Worker = FakeWorker;
  globalThis.performance = { now: () => 10 };
  globalThis.browser = {
    runtime: {
      getURL(path) {
        return `moz-extension://test/${path}`;
      },
      onMessage: {
        addListener(listener) {
          runtimeListeners.push(listener);
        },
      },
    },
    scripting: {
      async executeScript(args) {
        executeCalls.push(args);
      },
    },
    tabs: {
      async sendMessage(tabId, msg, options) {
        sentMessages.push({ tabId, msg, options });
        return { ok: true };
      },
      onRemoved: {
        addListener(listener) {
          removedListeners.push(listener);
        },
      },
      onUpdated: {
        addListener(listener) {
          updatedListeners.push(listener);
        },
      },
    },
    action: {
      onClicked: {
        addListener(listener) {
          actionListeners.push(listener);
        },
      },
      async setBadgeText(args) {
        badgeCalls.push(['text', args]);
      },
      async setBadgeBackgroundColor(args) {
        badgeCalls.push(['color', args]);
      },
      async setTitle(args) {
        badgeCalls.push(['title', args]);
      },
    },
  };

  await import('../../.tmp-tests/background/service-worker.js');
  assert.equal(actionListeners.length, 1);
  assert.equal(runtimeListeners.length, 1);
  assert.equal(updatedListeners.length, 1);

  const lastCall = kind => badgeCalls.filter(([callKind]) => callKind === kind).at(-1);

  actionListeners[0]({ id: 42 });
  await flushMicrotasks();

  assert.equal(executeCalls.length, 1);
  assert.deepEqual(executeCalls[0].target, { tabId: 42 });
  assert.equal(executeCalls[0].target.allFrames, undefined);
  assert.deepEqual(sentMessages.at(-1), {
    tabId: 42,
    msg: { type: 'translator/translate-page' },
    options: { frameId: 0 },
  });
  assert.deepEqual(lastCall('text'), ['text', { tabId: 42, text: 'EN' }]);
  assert.deepEqual(lastCall('title'), ['title', { tabId: 42, title: 'Restore original German text' }]);

  actionListeners[0]({ id: 42 });
  await flushMicrotasks();

  assert.deepEqual(sentMessages.at(-1), {
    tabId: 42,
    msg: { type: 'translator/restore-page' },
    options: { frameId: 0 },
  });
  assert.deepEqual(lastCall('text'), ['text', { tabId: 42, text: '' }]);

  actionListeners[0]({ id: 42 });
  await flushMicrotasks();
  updatedListeners[0](42, { status: 'loading' });
  await flushMicrotasks();

  assert.deepEqual(lastCall('text'), ['text', { tabId: 42, text: '' }]);
  removedListeners[0](42);
});
