import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } });
after(() => vite.close());
const { default: DeepModelResults } = await vite.ssrLoadModule('/src/pages/surgeon/DeepModelResults.tsx');
const render = (results, catalog) => renderToStaticMarkup(createElement(DeepModelResults, { results, catalog }));

const ts = '2026-11-15T15:00:00.000Z';
const base = { status: 'result', source: 'simulated', ts };

test('renders model metadata and all five stages from real simulated predictions', () => {
  const html = render({
    'ecg-deep': { ...base, model_id: 'EVA-13', flag: 'No calibrated flag', confidence: '0.91' },
    'sleep-deep': { ...base, model_id: 'EVA-14', flag: null, confidence: '0.7',
      minutes_per_stage: { W: 0, N1: 0.5, N2: 2, N3: 1.5, REM: 1 } },
  });
  for (const label of [
    'EVA-13', 'EVA-14', 'No calibrated flag', '91%', '70%', ts, 'Flag for human review, not a diagnosis',
    'Stage breakdown (submitted epochs)', 'W 0.0 min', 'N1 0.5 min', 'N2 2.0 min', 'N3 1.5 min', 'REM 1.0 min',
  ]) assert(html.includes(label), label);
  assert.equal(html.match(/>Simulated</g)?.length, 2);
});

test('renders stored and catalog placeholders without model result details', () => {
  const html = render({ 'ecg-deep': { status: 'placeholder' }, 'sleep-deep': null }, {
    data: { deep_models: [{ task: 'sleep_deep', state: 'mock', source: 'mock' }] },
  });
  assert.equal(html.match(/>placeholder</g)?.length, 2);
  assert.doesNotMatch(html, /Model ID|Confidence|Stage breakdown|>Simulated</);
  assert.match(render({ 'ecg-deep': null, 'sleep-deep': null }), /No result yet/);
});
