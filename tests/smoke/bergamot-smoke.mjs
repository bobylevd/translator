import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const recordsUrl = 'https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records?_limit=10000';
const attachmentBase = 'https://firefox-settings-attachments.cdn.mozilla.net/';
const cacheDir = '.tmp-tests/model-cache/deen';

function hex(buffer) {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(buffer) {
  return hex(await crypto.subtle.digest('SHA-256', buffer));
}

async function fetchJson(url) {
  const res = await fetch(url);
  assert.equal(res.ok, true, `GET ${url} failed with ${res.status}`);
  return res.json();
}

async function fileBuffer(record) {
  await mkdir(cacheDir, { recursive: true });
  const file = join(cacheDir, record.attachment.filename);
  if (existsSync(file)) {
    const cached = await readFile(file);
    if (await sha256(cached) === record.attachment.hash) return cached.buffer.slice(cached.byteOffset, cached.byteOffset + cached.byteLength);
  }

  const url = new URL(record.attachment.location, attachmentBase).href;
  const res = await fetch(url);
  assert.equal(res.ok, true, `GET ${url} failed with ${res.status}`);
  const buffer = await res.arrayBuffer();
  assert.equal(await sha256(buffer), record.attachment.hash, `hash mismatch for ${record.name}`);
  await writeFile(file, new Uint8Array(buffer));
  return buffer;
}

const wasmBinary = new Uint8Array(await readFile('vendor/bergamot-translator.wasm'));
const js = await readFile('vendor/bergamot-translator.js', 'utf8');
const records = (await fetchJson(recordsUrl)).data.filter(record => record.fromLang === 'de' && record.toLang === 'en' && record.version === '2.0');
const byType = new Map(records.map(record => [record.fileType, record]));

for (const type of ['model', 'lex', 'vocab']) {
  assert.ok(byType.has(type), `missing DE->EN ${type} record`);
}

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

const aligned = (buf, alignment) => {
  const mem = new bergamot.AlignedMemory(buf.byteLength, alignment);
  mem.getByteArrayView().set(new Uint8Array(buf));
  return mem;
};

const [modelFile, lexFile, vocabFile] = await Promise.all([
  fileBuffer(byType.get('model')),
  fileBuffer(byType.get('lex')),
  fileBuffer(byType.get('vocab')),
]);

const vocabList = new bergamot.AlignedMemoryList();
vocabList.push_back(aligned(vocabFile, 64));

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
  aligned(modelFile, 256),
  aligned(lexFile, 64),
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
