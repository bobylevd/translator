import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocument, el, installFakeDom, text } from './fake-dom.mjs';

installFakeDom();

const { collectTargets } = await import('../../.tmp-tests/content/walker.js');

test('collectTargets finds visible text, form labels, shadow DOM, and same-origin iframes', () => {
  const doc = createDocument();
  doc.body.append(
    el('p', {}, text('  Hallo Welt.  ')),
    el('input', { placeholder: 'Name eingeben' }),
    el('input', { type: 'submit', value: 'Nicht ändern', disabled: '' }),
    el('button', {}, text('Knopf drücken')),
    el('select', {}, el('option', {}, text('Auswahl eins'))),
    el('pre', {}, text('Quelltext bleibt deutsch')),
    el('span', { translate: 'no' }, text('Nicht übersetzen')),
  );

  const host = el('x-card');
  host.attachShadow().append(el('p', {}, text('Text im Schatten')));
  doc.body.append(host);

  const iframeDoc = createDocument();
  iframeDoc.body.append(el('p', {}, text('Text im Rahmen')));
  const iframe = el('iframe');
  iframe.contentDocument = iframeDoc;
  doc.body.append(iframe);

  const targets = collectTargets(doc.body);
  const textBodies = targets.filter(t => t.kind === 'text').map(t => t.body);
  const attrBodies = targets.filter(t => t.kind === 'attr').map(t => `${t.attr}:${t.body}`);

  assert.deepEqual(textBodies, [
    'Hallo Welt.',
    'Knopf drücken',
    'Auswahl eins',
    'Text im Schatten',
    'Text im Rahmen',
  ]);
  assert.deepEqual(attrBodies, ['placeholder:Name eingeben']);
});

test('collectTargets respects skipped roots and includes root attributes', () => {
  createDocument();

  const skipped = el('pre', {}, text('Nicht übersetzen'));
  assert.deepEqual(collectTargets(skipped), []);

  const input = el('input', { placeholder: 'Direkte Eingabe' });
  const targets = collectTargets(input);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].kind, 'attr');
  assert.equal(targets[0].body, 'Direkte Eingabe');
});
