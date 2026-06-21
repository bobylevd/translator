import assert from 'node:assert/strict';
import test from 'node:test';

const { normalizeModelRecords } = await import('../../.tmp-tests/background/model-registry.js');

function record(fromLang, toLang, version, fileType, lastModified = 1) {
  return {
    fromLang,
    toLang,
    version,
    fileType,
    name: `${fileType}.${fromLang}${toLang}`,
    hash: `${fileType}-hash`,
    last_modified: lastModified,
    attachment: {
      hash: `${fileType}-hash`,
      size: 10,
      filename: `${fileType}.bin`,
      location: `main-workspace/translations-models/${fileType}.bin`,
    },
  };
}

test('normalizes complete direct pairs and filters incomplete pairs', () => {
  const pairs = normalizeModelRecords([
    record('de', 'en', '2.0', 'model'),
    record('de', 'en', '2.0', 'lex'),
    record('de', 'en', '2.0', 'vocab'),
    record('fr', 'en', '2.0', 'model'),
    record('fr', 'en', '2.0', 'lex'),
  ]);

  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].key, 'de->en@2.0');
  assert.equal(pairs[0].size, 30);
  assert.equal(pairs[0].files.model.url, 'https://firefox-settings-attachments.cdn.mozilla.net/main-workspace/translations-models/model.bin');
});

test('supports split vocab pairs and keeps latest version per direction', () => {
  const pairs = normalizeModelRecords([
    record('zh-Hant', 'en', '1.0', 'model'),
    record('zh-Hant', 'en', '1.0', 'srcvocab'),
    record('zh-Hant', 'en', '1.0', 'trgvocab'),
    record('zh-Hant', 'en', '2.0', 'model'),
    record('zh-Hant', 'en', '2.0', 'lex'),
    record('zh-Hant', 'en', '2.0', 'srcvocab'),
    record('zh-Hant', 'en', '2.0', 'trgvocab'),
  ]);

  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].key, 'zh-Hant->en@2.0');
  assert.ok(pairs[0].files.srcvocab);
  assert.ok(pairs[0].files.trgvocab);
});
