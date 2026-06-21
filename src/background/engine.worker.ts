/// <reference lib="webworker" />

import type { InitUrls, WorkerRequest, WorkerResponse } from '../shared/worker-protocol.js';

declare const importScripts: (...urls: string[]) => void;

interface AlignedMemory {
  getByteArrayView(): Uint8Array;
  size(): number;
  delete(): void;
}
interface AlignedMemoryList {
  push_back(m: AlignedMemory): void;
  delete(): void;
}
interface TranslationModel {
  delete(): void;
}
interface VectorString {
  push_back(s: string): void;
  size(): number;
  delete(): void;
}
interface VectorResponseOptions {
  push_back(o: { qualityScores: boolean; alignment: boolean; html: boolean }): void;
  delete(): void;
}
interface ResponseObj {
  getTranslatedText(): string;
  delete(): void;
}
interface VectorResponse {
  size(): number;
  get(i: number): ResponseObj;
  delete(): void;
}
interface BlockingService {
  translate(model: TranslationModel, m: VectorString, o: VectorResponseOptions): VectorResponse;
  delete(): void;
}
interface BergamotModule {
  AlignedMemory: new (size: number, alignment: number) => AlignedMemory;
  AlignedMemoryList: new () => AlignedMemoryList;
  TranslationModel: new (
    src: string,
    tgt: string,
    config: string,
    model: AlignedMemory,
    lex: AlignedMemory | null,
    vocab: AlignedMemoryList,
    qualityModel: null,
  ) => TranslationModel;
  VectorString: new () => VectorString;
  VectorResponseOptions: new () => VectorResponseOptions;
  BlockingService: new (opts: { cacheSize: number }) => BlockingService;
}

declare const loadBergamot: (mod: {
  wasmBinary?: Uint8Array;
  onRuntimeInitialized?: () => void;
  onAbort?: (err: unknown) => void;
  print?: (s: string) => void;
  printErr?: (s: string) => void;
  locateFile?: (path: string, scriptDir: string) => string;
}) => BergamotModule;

const swSelf = self as unknown as DedicatedWorkerGlobalScope;

const BERGAMOT_CONFIG = `
            beam-size: 1
            normalize: 1.0
            word-penalty: 0
            max-length-break: 128
            mini-batch-words: 1024
            workspace: 128
            max-length-factor: 2.0
            skip-cost: true
            cpu-threads: 0
            quiet: true
            quiet-translation: true
            gemm-precision: int8shiftAlphaAll
            alignment: soft
            `;

const ALIGNMENTS = { model: 256, lex: 64, vocab: 64 } as const;

let bergamot: BergamotModule | null = null;
let translationModel: TranslationModel | null = null;
let translationService: BlockingService | null = null;
let initPromise: Promise<void> | null = null;

function send(msg: WorkerResponse): void {
  swSelf.postMessage(msg);
}

async function fetchToArrayBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.arrayBuffer();
}

function allocateAligned(mod: BergamotModule, buf: ArrayBuffer, alignment: number): AlignedMemory {
  const mem = new mod.AlignedMemory(buf.byteLength, alignment);
  mem.getByteArrayView().set(new Uint8Array(buf));
  return mem;
}

async function init(urls: InitUrls): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    importScripts(urls.bergamotJs);
    const wasmBuf = await fetchToArrayBuffer(urls.wasm);
    const wasmBinary = new Uint8Array(wasmBuf);

    bergamot = await new Promise<BergamotModule>((resolve, reject) => {
      let mod: BergamotModule | null = null;
      const startedAt = performance.now();
      try {
        mod = loadBergamot({
          wasmBinary,
          onRuntimeInitialized: () => {
            console.log('[translator/worker] bergamot ready in', Math.round(performance.now() - startedAt), 'ms');
            resolve(mod!);
          },
          onAbort: err => reject(new Error(`bergamot abort: ${String(err)}`)),
          print: s => console.log('[bergamot]', s),
          printErr: s => console.warn('[bergamot]', s),
        });
      } catch (e) {
        reject(e);
      }
    });

    const [modelBuf, lexBuf, vocabBuf] = await Promise.all([
      fetchToArrayBuffer(urls.model),
      fetchToArrayBuffer(urls.lex),
      fetchToArrayBuffer(urls.vocab),
    ]);

    const modelMem = allocateAligned(bergamot, modelBuf, ALIGNMENTS.model);
    const lexMem = allocateAligned(bergamot, lexBuf, ALIGNMENTS.lex);
    const vocabMem = allocateAligned(bergamot, vocabBuf, ALIGNMENTS.vocab);

    const vocabList = new bergamot.AlignedMemoryList();
    vocabList.push_back(vocabMem);

    translationModel = new bergamot.TranslationModel(
      'de',
      'en',
      BERGAMOT_CONFIG,
      modelMem,
      lexMem,
      vocabList,
      null,
    );

    translationService = new bergamot.BlockingService({ cacheSize: 0 });
  })();
  return initPromise;
}

function translateMany(strings: string[], html: boolean): string[] {
  if (!bergamot || !translationModel || !translationService) {
    throw new Error('engine not initialized');
  }
  if (strings.length === 0) return [];

  const messages = new bergamot.VectorString();
  const options = new bergamot.VectorResponseOptions();
  let responses: VectorResponse | null = null;

  try {
    for (const s of strings) {
      messages.push_back(s);
      options.push_back({ qualityScores: false, alignment: true, html });
    }
    responses = translationService.translate(translationModel, messages, options);
    const results: string[] = [];
    for (let i = 0; i < responses.size(); i++) {
      const r = responses.get(i);
      results.push(r.getTranslatedText());
      r.delete();
    }
    return results;
  } finally {
    messages.delete();
    options.delete();
    responses?.delete();
  }
}

swSelf.addEventListener('message', async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'INIT') {
      await init(msg.urls);
      send({ type: 'READY' });
    } else if (msg.type === 'TRANSLATE') {
      if (!initPromise) throw new Error('engine not initialized — send INIT first');
      await initPromise;
      const start = performance.now();
      const results = translateMany(msg.strings, msg.html);
      send({ type: 'TRANSLATED', id: msg.id, results, ms: Math.round(performance.now() - start) });
    }
  } catch (err) {
    const error = err instanceof Error ? err.stack ?? err.message : String(err);
    send({ type: 'ERROR', id: 'id' in msg ? msg.id : undefined, error });
  }
});
