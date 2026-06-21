import type { WorkerRequest, WorkerResponse } from '../shared/worker-protocol.js';

type Pending = {
  resolve: (results: string[]) => void;
  reject: (err: Error) => void;
};

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(browser.runtime.getURL('background/engine.worker.js'));
  worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === 'TRANSLATED') {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        p.resolve(msg.results);
      }
    } else if (msg.type === 'ERROR') {
      if (msg.id !== undefined) {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          p.reject(new Error(msg.error));
          return;
        }
      }
      console.error('[translator/engine] worker error:', msg.error);
    }
  });
  worker.addEventListener('error', e => {
    console.error('[translator/engine] worker crashed:', e.message);
    for (const p of pending.values()) p.reject(new Error('worker crashed'));
    pending.clear();
    worker = null;
    readyPromise = null;
  });
  return worker;
}

export function ready(): Promise<void> {
  if (readyPromise) return readyPromise;
  const w = ensureWorker();
  readyPromise = new Promise<void>((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.type === 'READY') {
        w.removeEventListener('message', onMessage);
        resolve();
      } else if (e.data.type === 'ERROR' && e.data.id === undefined) {
        w.removeEventListener('message', onMessage);
        reject(new Error(e.data.error));
      }
    };
    w.addEventListener('message', onMessage);
    const req: WorkerRequest = {
      type: 'INIT',
      urls: {
        bergamotJs: browser.runtime.getURL('vendor/bergamot-translator.js'),
        wasm: browser.runtime.getURL('vendor/bergamot-translator.wasm'),
        model: browser.runtime.getURL('models/deen/model.deen.intgemm.alphas.bin'),
        lex: browser.runtime.getURL('models/deen/lex.50.50.deen.s2t.bin'),
        vocab: browser.runtime.getURL('models/deen/vocab.deen.spm'),
      },
    };
    w.postMessage(req);
  });
  return readyPromise;
}

export async function translate(strings: string[], html = false): Promise<string[]> {
  if (strings.length === 0) return [];
  await ready();
  const w = ensureWorker();
  const id = nextId++;
  return new Promise<string[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: WorkerRequest = { type: 'TRANSLATE', id, strings, html };
    w.postMessage(req);
  });
}
