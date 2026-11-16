import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } });
after(() => vite.close());
const { formatModelId } = await vite.ssrLoadModule('/src/services/modelCatalog.ts');
const { ModelsContent } = await vite.ssrLoadModule('/src/pages/ModelsPage.tsx');
const { default: BibliographyPage } = await vite.ssrLoadModule('/src/pages/BibliographyPage.tsx');
const { bibliography } = await vite.ssrLoadModule('/src/data/bibliography.ts');
const { modelRegistry } = await vite.ssrLoadModule('/src/data/modelRegistry.ts');

const render = (Component, props) => renderToStaticMarkup(
  createElement(MemoryRouter, null, createElement(Component, props))
);
const checkedAt = '2026-11-15T19:00:00.000Z';
const lastRun = '2026-11-15T18:00:00.000Z';
const mockCatalog = {
  checkedAt,
  data: {
    models: [2, 6, 12].map(id => ({ model_id: `EVA-${id}`, available: true })),
    unavailable: [{ model_id: 'EVA-4', available: false }],
    deep_models: [
      ...[13, 14].map(id => ({ model_id: `EVA-${id}`, state: 'available', source: 'model' })),
      { model_id: null, task: 'seizure_deep', state: 'mock', source: 'mock' },
    ],
  },
};
const catalogHtml = render(ModelsContent, {
  catalog: mockCatalog,
  runs: { scope: 'demo', models: [{ model_id: 'EVA-6', last_run: lastRun }] },
});
const bibliographyHtml = render(BibliographyPage);

test('formats registry IDs for display while retaining the upstream value', () => {
  assert.equal(formatModelId('EVA-2'), 'EVA-02');
  assert.equal(formatModelId('EVA-12'), 'EVA-12');
  assert.equal(formatModelId('EVA-02'), 'EVA-02');
  assert.equal(formatModelId('EVA-6 and EVA-14'), 'EVA-06 and EVA-14');
  assert.equal(modelRegistry[1].id, 'EVA-2');
});

test('renders every registry entry with the right live and evidence badges', () => {
  const cards = [...catalogHtml.matchAll(/<article[^>]+aria-labelledby="model-(EVA-\d+)"[^>]*>([\s\S]*?)<\/article>/g)];
  assert.equal(cards.length, 15);
  for (let n = 1; n <= 15; n++) {
    const id = `EVA-${String(n).padStart(2, '0')}`;
    const card = cards.find(([, label]) => label === id)?.[2];
    assert.ok(card, id);
    const arch = [1, 3, 5, 7, 10].includes(n);
    const active = [2, 6, 12, 13, 14].includes(n);
    assert.equal(card.includes('>Architecture spec<'), arch, id);
    assert.equal(card.includes('>ON \u2014 serving<'), active, id);
    assert.equal(card.includes('>Developed, not served<'), !arch && !active, id);
    assert.equal(card.includes('>Evaluated<'), !arch, id);
    assert.equal(card.includes('>Placeholder<'), n === 15, id);
    assert.equal(card.includes('Last run'), active, id);
    assert.equal(card.includes(lastRun), n === 6, id);
  }
  assert.match(catalogHtml, /Model API reachable/);
  assert.ok(catalogHtml.includes(checkedAt));
  assert.match(catalogHtml, /href="\/roadmap"/);
});

test('keeps registry facts but does not claim availability when the live check fails', () => {
  const html = render(ModelsContent, { catalog: { checkedAt } });
  assert.match(html, /Model API unavailable/);
  assert.match(html, /Serving status unknown/);
  assert.doesNotMatch(html, /ON \u2014 serving|Developed, not served|>Placeholder</);
});

test('bibliography entries are unique and each one links to its source', () => {
  const entries = bibliography.flatMap(group => group.entries);
  for (const field of ['key', 'number', 'url', 'title']) {
    assert.equal(new Set(entries.map(entry => entry[field])).size, entries.length, field);
  }
  for (const [i, entry] of entries.entries()) {
    assert.equal(entry.number, i + 1);
    assert.equal(new URL(entry.url).protocol, 'https:');
    assert.ok(bibliographyHtml.includes(`id="ref-${entry.number}"`));
    assert.ok(bibliographyHtml.includes(`href="${entry.url}"`));
  }
});

test('each model card links to its numbered bibliography entries', () => {
  const numbers = new Map(bibliography.flatMap(group => group.entries.map(entry => [entry.key, entry.number])));
  const methods = bibliography.find(group => group.title === 'Models and methods (including reviewed candidates)');
  assert.match(bibliographyHtml, /Models and methods \(including reviewed candidates\)/);
  assert.match(bibliographyHtml, /EVAde trains and serves EVA-02, 06, 12, 13 and 14\./);
  assert.match(bibliographyHtml, /candidates and are not used in the demo/);
  const candidateKeys = new Set(methods.entries.slice(methods.reviewedStart).map(entry => entry.key));
  const allowed = [
    ['beta-method'], ['chb', 'siena', 'beta-method'],
    ['beta-method'], ['sleep', 'beta-method'],
    ['beta-method'], ['ptb', 'beta-method'],
    ['spe-method'], ['goes-sem', 'spe-method'],
    ['goes-sem', 'goes-r', 'spe-method'], ['spe-method'],
    ['goes-sem', 'goes-r', 'cdaw', 'spe-method'], ['goes-sem', 'goes-r', 'spe-method'],
    ['ptb', 'ecg-benchmark'], ['sleep', 'sleep-method'], ['chb', 'siena', 'seizure-method'],
  ];
  for (const card of modelRegistry) {
    const id = formatModelId(card.id);
    const rendered = catalogHtml.split(`aria-labelledby="model-${id}"`)[1]?.split('</article>')[0];
    assert.deepEqual(card.citations, allowed[Number(card.id.slice(4)) - 1], id);
    for (const key of card.citations) {
      assert.equal(candidateKeys.has(key), false, key);
      const number = numbers.get(key);
      assert.ok(number && rendered.includes(`href="/bibliography#ref-${number}"`), `${id} cites ${key}`);
      assert.ok(bibliographyHtml.includes(`id="ref-${number}"`), key);
    }
  }
});
