import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openMenu, fillInput, showPanel, draftResponse, result, idle } from './workspace-helpers.mjs';

export async function verifyTagsAndNeighborhood(page, baseUrl) {
  const sessionId = `tags-region-${randomUUID()}`, cases = [], workerUrls = [];
  async function call(tool, args = {}) {
    const r = await fetch(baseUrl + '/api/agent/v1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId, tool, arguments: args }) });
    const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return b.result;
  }
  const node = id => ({ id, label: id === 'b' ? 'Database' : `Node ${id}`, kind: 'concept', detail: 'Knowledge graph', status: 'confirmed', sources: [], ...(id === 'a' ? { tags: ['backend', '설계'] } : {}) });
  const edge = (id, source, target) => ({ id, source, target, relation: 'uses', status: 'active' });
  const route = x => ({ sections: [[{ x, y: 75 }, { x: x + 100, y: 75 }]], label: { x, y: 25, width: 80, height: 20, text: 'uses' } });
  await call('session_open', { title: 'Tags and neighborhood layout' });
  await call('graph_commit', { baseRevision: 0, answerId: 'agent-tags', nodes: ['a','b','c','d','e','isolated'].map(node), edges: [edge('ab','a','b'),edge('ab2','a','b'),edge('bb','b','b'),edge('bc','b','c'),edge('cd','c','d'),edge('de','d','e')], flows: [{ id: 'topic', scope: 'custom', label: 'Topic', nodeIds: ['a','b','c'], edgeIds: ['ab','ab2','bb','bc'], startNodeIds: ['a'], endNodeIds: ['c'] }] });
  await call('graph_layout', { baseRevision: 1, baseLayoutRevision: 0, mode: 'replace', positions: Object.fromEntries(['a','b','c','d','e','isolated'].map((id, i) => [id, { x: 100 + i * 550, y: i === 5 ? 800 : 0 }])), routes: { cd: route(1540), de: route(2090) }, direction: 'RIGHT' });
  await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/#${sessionId}`); await page.waitForSelector('#nodes [data-node-id="a"]');
  assert.ok(await page.$('#auto-layout-neighborhood'), 'Arrange must expose Layout selected + connected');
  const draftId = await page.evaluate(id => localStorage.getItem(`axcanvas-draft:${id}`), sessionId);
  const read = () => call('draft_read', { draftId });
  const canonical = await call('graph_read');
  async function select(id) { await page.click('#tool-select'); await page.click('#fit'); await page.click(`#nodes [data-node-id="${id}"]`); }
  async function preview(direction = 'RIGHT') { await openMenu(page, 'arrange'); await page.select('#layout-direction', direction); await page.click('#auto-layout-neighborhood'); await page.waitForSelector('#layout-status[data-state="preview"]', { timeout: 10000 }); }
  async function cancel() { await page.click('#cancel-layout'); await page.waitForSelector('#layout-status[data-state="idle"]'); }
  async function apply() { const response = draftResponse(page, args => args.operation.type === 'layout_region'); await page.click('#apply-layout'); const d = await result(await response); await idle(page); return d; }
  async function undo() { const response = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === 'draft_step'); await openMenu(page, 'arrange'); await page.click('#undo-layout'); const d = await result(await response); await idle(page); return d; }
  const worker = w => workerUrls.push(w.url()); page.on('workercreated', worker);
  try {
    await page.click('#graph-search-toggle'); await fillInput(page, '#graph-search-input', '#backend #설계'); assert.equal(await page.$$eval('#graph-search-results button', all => all.length), 1); await page.click('#graph-search-results button'); await page.waitForSelector('#graph-search-panel[hidden]');
    assert.equal(await page.$eval('#node-id', e => e.textContent), 'a'); assert.equal(await page.$eval('#node-tags', e => e.value), 'backend, 설계'); assert.match(await page.$eval('#nodes [data-node-id="a"] .node-tags', e => e.textContent), /#backend/);
    const response = draftResponse(page, args => args.operation.type === 'node' && args.operation.node.tags?.includes('human'));
    await fillInput(page, '#node-tags', 'backend, human'); let d = await result(await response); await idle(page); assert.deepEqual(d.graph.nodes.find(n => n.id === 'a').tags, ['backend','human']); assert.deepEqual(await call('graph_read'), canonical);
    await page.reload(); await page.waitForSelector('#nodes [data-node-id="a"]'); await select('a'); assert.equal(await page.$eval('#node-tags', e => e.value), 'backend, human');
    let step = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === 'draft_step'); await page.click('#draft-undo'); await step; await idle(page);
    assert.equal(await page.$eval('#node-tags', e => e.value), 'backend, 설계');
    await fillInput(page, '#node-tags', 'backend, BACKEND'); await page.click('#save'); await page.waitForFunction(() => document.getElementById('node-tags').validationMessage.includes('unique'));
    assert.equal(await page.$eval('#auto-layout-neighborhood', e => e.disabled), true); await page.click('#cancel'); assert.deepEqual((await read()).graph, canonical);
    cases.push('agent-tags-exact-search-human-autosave-reload-undo-and-validation');

    await select('b'); const before = await read(), outside = await page.$eval('#nodes [data-node-id="d"]', e => e.getAttribute('transform'));
    await preview(); assert.match(await page.$eval('#layout-status', e => e.textContent), /3 nodes/); assert.equal(await page.$eval('#nodes [data-node-id="d"]', e => e.getAttribute('transform')), outside); assert.deepEqual(await read(), before); await cancel(); assert.deepEqual(await read(), before);
    cases.push('one-hop-native-worker-preview-cancel-without-write');
    await openMenu(page, 'arrange'); await page.select('#layout-direction', 'DOWN'); await page.keyboard.press('Escape'); await page.focus('#tool-select'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyL'); await page.keyboard.up('Shift'); await page.waitForSelector('#layout-status[data-state="preview"]', { timeout: 10000 });
    d = await apply();
    for (const id of ['d','e','isolated']) assert.deepEqual(d.graph.positions[id], before.graph.positions[id]);
    assert.deepEqual(d.graph.routes.de, before.graph.routes.de); assert.equal(d.graph.routes.cd, undefined); assert.equal(d.graph.layoutDirection, before.graph.layoutDirection);
    assert.ok(d.graph.positions.a.y < d.graph.positions.b.y && d.graph.positions.b.y < d.graph.positions.c.y); assert.deepEqual(d.graph.nodes, before.graph.nodes); assert.deepEqual(d.graph.edges, before.graph.edges); assert.deepEqual(d.graph.flows, before.graph.flows);
    assert.deepEqual(await call('graph_read'), canonical); assert.deepEqual((await call('feedback_read')).feedback, []);
    assert.deepEqual((await undo()).graph, before.graph); cases.push('shortcut-one-checkpoint-apply-and-exact-undo');

    await page.select('#flow-selector', 'topic'); await select('b'); const scopedBefore = await read(); await preview(); d = await apply();
    assert.deepEqual(d.graph.positions, scopedBefore.graph.positions); assert.deepEqual(d.graph.routes, scopedBefore.graph.routes); assert.deepEqual(d.graph.flows, canonical.flows); assert.deepEqual(Object.keys(d.graph.flowLayouts.topic.positions).sort(), ['a','b','c']); assert.deepEqual((await undo()).graph, scopedBefore.graph);
    cases.push('scoped-neighborhood-preserves-global-geometry-and-role-metadata');

    await page.select('#flow-selector', ''); await select('b'); await page.keyboard.down('Shift'); try { await page.click('#nodes [data-node-id="isolated"]'); } finally { await page.keyboard.up('Shift'); }
    await page.click('#nodes [data-node-id="b"]', { button: 'right' }); await page.click('#canvas-context-menu [data-command="layout-neighborhood"]'); await page.waitForSelector('#layout-status[data-state="preview"]', { timeout: 10000 }); assert.match(await page.$eval('#layout-status', e => e.textContent), /4 nodes/); await cancel();
    cases.push('context-menu-multiple-seeds-and-isolated-selection');
    await select('b'); await preview(); await page.click('#apply-layout'); await page.waitForSelector('#layout-status[data-state="idle"]'); await idle(page); await page.click('#fit');
    return { sessionId, cases, workerUrls, canonicalUnchanged: JSON.stringify(await call('graph_read')) === JSON.stringify(canonical) };
  } finally { page.off('workercreated', worker); }
}
