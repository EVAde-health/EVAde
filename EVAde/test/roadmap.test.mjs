import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true, ws: false, watch: null } });
after(() => vite.close());
const { roadmap, roadmapGroups } = await vite.ssrLoadModule('/src/data/roadmap.ts');
const { default: RoadmapPage } = await vite.ssrLoadModule('/src/pages/RoadmapPage.tsx');
const { formatModelId } = await vite.ssrLoadModule('/src/services/modelCatalog.ts');

test('every roadmap item inherits its release and status, and has a repo citation or a proposal label', () => {
  assert.ok(roadmap.length >= 3);
  assert.equal(new Set(roadmap.map(release => release.version)).size, roadmap.length);
  assert.equal(roadmap[0].version, 'v0.1');
  assert.equal(roadmap[0].status, 'Shipped');
  assert.equal(roadmap[0].window, 'Nov 15, 2026');
  const status = new Set(['Shipped', 'In progress', 'Planned', 'Research']);
  const repo = /^https:\/\/github\.com\/(?:deconghh\/EVAde|Mikeblackbelt\/EVAde-backend-models)\/blob\/main\/.+/;
  for (const release of roadmap) {
    assert.match(release.version, /^v\d+\.\d+$/);
    assert.ok(release.title && release.window && status.has(release.status));
    assert.deepEqual(Object.keys(release.groups), roadmapGroups);
    for (const items of Object.values(release.groups)) {
      assert.ok(items.length);
      for (const item of items) {
        assert.match(item.text, /^[^\r\n]+$/);
        if (item.source === 'team proposal') continue;
        assert.ok(item.source.label, item.text);
        assert.match(item.source.href, repo, item.text);
      }
    }
  }
});

test('the timeline displays all release milestones, status badges and source links', () => {
  const html = renderToStaticMarkup(createElement(RoadmapPage));
  assert.match(html, /aria-label="Release timeline"/);
  assert.match(html, /data-orientation="vertical"/);
  for (const release of roadmap) {
    assert.ok(html.includes(`aria-label="${release.version} ${release.title}"`));
    assert.ok(html.includes(`>${release.status}<`));
    assert.ok(html.includes(release.window));
    for (const items of Object.values(release.groups)) {
      for (const item of items) {
        assert.ok(html.includes(formatModelId(item.text)), item.text);
        if (item.source !== 'team proposal') assert.ok(html.includes(`href="${item.source.href}"`));
      }
    }
  }
  assert.match(html, /\[team proposal\]/);
  assert.match(html, /Planned work, not commitments\. Every model output stays a flag for human review, not a diagnosis\./);
});
