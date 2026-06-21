import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const wasmBinary = new Uint8Array(await readFile('vendor/bergamot-translator.wasm'));
const js = await readFile('vendor/bergamot-translator.js', 'utf8');

const context = { console, fetch, performance, setTimeout, clearTimeout, WebAssembly };
context.self = context;
context.location = { href: 'file:///engine.worker.js' };
context.importScripts = () => {};
vm.createContext(context);
vm.runInContext(js, context);

const bergamot = await new Promise((resolve, reject) => {
  let mod;
  mod = context.loadBergamot({
    wasmBinary,
    onRuntimeInitialized: () => resolve(mod),
    onAbort: reject,
    print: () => {},
    printErr: () => {},
  });
});

const toArrayBuffer = buf => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const aligned = (buf, alignment) => {
  const mem = new bergamot.AlignedMemory(buf.byteLength, alignment);
  mem.getByteArrayView().set(new Uint8Array(buf));
  return mem;
};

const [modelFile, lexFile, vocabFile] = await Promise.all([
  readFile('models/deen/model.deen.intgemm.alphas.bin'),
  readFile('models/deen/lex.50.50.deen.s2t.bin'),
  readFile('models/deen/vocab.deen.spm'),
]);

const vocabList = new bergamot.AlignedMemoryList();
vocabList.push_back(aligned(toArrayBuffer(vocabFile), 64));

const config = `
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

const model = new bergamot.TranslationModel(
  'de',
  'en',
  config,
  aligned(toArrayBuffer(modelFile), 256),
  aligned(toArrayBuffer(lexFile), 64),
  vocabList,
  null,
);
const service = new bergamot.BlockingService({ cacheSize: 0 });

function translateMany(strings) {
  const messages = new bergamot.VectorString();
  const options = new bergamot.VectorResponseOptions();
  let responses = null;
  try {
    for (const value of strings) {
      messages.push_back(value);
      options.push_back({ qualityScores: false, alignment: true, html: false });
    }
    responses = service.translate(model, messages, options);
    const translated = [];
    for (let i = 0; i < responses.size(); i++) {
      const response = responses.get(i);
      translated.push(response.getTranslatedText());
      response.delete();
    }
    return translated;
  } finally {
    messages.delete();
    options.delete();
    responses?.delete();
  }
}

const [hello] = translateMany(['Hallo Welt.']);
assert.equal(hello, 'Hello world.');

const largeBatch = Array.from({ length: 128 }, () => 'Hallo Welt. Dies ist ein einfacher Test mit mehreren deutschen Worten.');
const startedAt = performance.now();
const results = translateMany(largeBatch);
const elapsedMs = Math.round(performance.now() - startedAt);
assert.equal(results.length, largeBatch.length);
assert.ok(results.every(value => value.length > 0));
assert.ok(elapsedMs < 8000, `large batch took ${elapsedMs}ms`);

console.log(`Bergamot smoke passed: ${largeBatch.length} strings in ${elapsedMs}ms`);
