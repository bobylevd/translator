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
    if (msg.type === 'INIT_BERGAMOT') {
      queueMicrotask(() => this.emit('message', { data: { type: 'READY' } }));
    } else if (msg.type === 'LOAD_PAIR') {
      queueMicrotask(() => this.emit('message', { data: { type: 'PAIR_READY', id: msg.id, pairKey: msg.pair.key } }));
    }
  }

  terminate() {}

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

async function flushMicrotasks() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    await Promise.resolve();
    if (predicate()) return;
  }
  assert.fail('condition was not met');
}

test('service worker action injects, translates, restores, and resets on navigation', async () => {
  const actionListeners = [];
  const removedListeners = [];
  const updatedListeners = [];
  const runtimeListeners = [];
  const executeCalls = [];
  const sentMessages = [];
  const badgeCalls = [];
  const pair = {
    key: 'de->en@2.0',
    fromLang: 'de',
    toLang: 'en',
    version: '2.0',
    size: 3,
    files: {
      model: { type: 'model', name: 'model', hash: 'hash', size: 1, url: 'https://example.test/model' },
      lex: { type: 'lex', name: 'lex', hash: 'hash', size: 1, url: 'https://example.test/lex' },
      vocab: { type: 'vocab', name: 'vocab', hash: 'hash', size: 1, url: 'https://example.test/vocab' },
    },
  };
  const storageData = {
    'translator.selectedPairKey': pair.key,
    'translator.installedPairs': { [pair.key]: pair },
  };
  const fileRecords = new Map([
    [`${pair.key}:model`, { id: `${pair.key}:model`, pairKey: pair.key, type: 'model', buffer: new ArrayBuffer(1) }],
    [`${pair.key}:lex`, { id: `${pair.key}:lex`, pairKey: pair.key, type: 'lex', buffer: new ArrayBuffer(1) }],
    [`${pair.key}:vocab`, { id: `${pair.key}:vocab`, pairKey: pair.key, type: 'vocab', buffer: new ArrayBuffer(1) }],
  ]);

  globalThis.Worker = FakeWorker;
  globalThis.performance = { now: () => 10 };
  globalThis.indexedDB = {
    open() {
      const req = {};
      queueMicrotask(() => {
        req.result = {
          close() {},
          objectStoreNames: { contains: () => true },
          transaction() {
            return {
              objectStore() {
                return {
                  get(id) {
                    const getReq = {};
                    queueMicrotask(() => {
                      getReq.result = fileRecords.get(id);
                      getReq.onsuccess?.();
                    });
                    return getReq;
                  },
                };
              },
            };
          },
        };
        req.onsuccess?.();
      });
      return req;
    },
  };
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
    storage: {
      local: {
        async get(key) {
          if (Array.isArray(key)) return Object.fromEntries(key.map(k => [k, storageData[k]]));
          if (typeof key === 'string') return { [key]: storageData[key] };
          return { ...storageData };
        },
        async set(values) {
          Object.assign(storageData, values);
        },
        async remove(key) {
          delete storageData[key];
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
  await waitFor(() => sentMessages.length === 1 && lastCall('text')?.[1]?.text === 'EN' && lastCall('title')?.[1]?.title === 'Restore original text (EN)');

  assert.equal(executeCalls.length, 1);
  assert.deepEqual(executeCalls[0].target, { tabId: 42 });
  assert.equal(executeCalls[0].target.allFrames, undefined);
  assert.deepEqual(sentMessages.at(-1), {
    tabId: 42,
    msg: { type: 'translator/translate-page' },
    options: { frameId: 0 },
  });
  assert.deepEqual(lastCall('text'), ['text', { tabId: 42, text: 'EN' }]);
  assert.deepEqual(lastCall('title'), ['title', { tabId: 42, title: 'Restore original text (EN)' }]);

  actionListeners[0]({ id: 42 });
  await waitFor(() => sentMessages.length === 2 && lastCall('text')?.[1]?.text === '' && lastCall('title')?.[1]?.title === 'Translate page');

  assert.deepEqual(sentMessages.at(-1), {
    tabId: 42,
    msg: { type: 'translator/restore-page' },
    options: { frameId: 0 },
  });
  assert.deepEqual(lastCall('text'), ['text', { tabId: 42, text: '' }]);

  actionListeners[0]({ id: 42 });
  await waitFor(() => sentMessages.length === 3 && lastCall('text')?.[1]?.text === 'EN');
  updatedListeners[0](42, { status: 'loading' });
  await flushMicrotasks();

  assert.deepEqual(lastCall('text'), ['text', { tabId: 42, text: '' }]);
  removedListeners[0](42);
});
