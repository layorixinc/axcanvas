import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openMenu, fillInput, showPanel, draftResponse, result, idle } from './workspace-helpers.mjs';

export async function verifyTagsAndNeighborhood(page, baseUrl) {
  const sessionId = `tags-region-${randomUUID()}`, cases = [], workerUrls = [];
  async function call(tool, args = {}) {
    const r = await fetch(baseUrl + '/api/agent/v1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId, tool, arguments: args }) });
    const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return b.result;
  }
  const ids = ['a','b','c','d','e','isolated','f','g'];
  const tags = { a: ['backend','설계'], b: ['backend','database'], c: ['database'], d: ['database'], isolated: ['BACKEND'], f: ['ui'] };
  const node = id => ({ id, label: id === 'b' ? 'Database' : `Node ${id}`, kind: 'concept', detail: 'Knowledge graph', status: 'confirmed', sources: [], ...(tags[id] ? { tags: tags[id] } : {}) });
  const edge = (id, source, target) => ({ id, source, target, relation: 'uses', status: 'active' });
  const route = x => ({ sections: [[{ x, y: 75 }, { x: x + 100, y: 75 }]], label: { x, y: 25, width: 80, height: 20, text: 'uses' } });
  await call('session_open', { title: 'Tags and neighborhood layout' });
  await call('graph_commit', { baseRevision: 0, answerId: 'agent-tags', nodes: ids.map(node), edges: [edge('ab','a','b'),edge('ab2','a','b'),edge('bb','b','b'),edge('bc','b','c'),edge('cd','c','d'),edge('de','d','e'),edge('fg','f','g')], flows: [{ id: 'topic', scope: 'custom', label: 'Topic', nodeIds: ['a','b','c'], edgeIds: ['ab','ab2','bb','bc'], startNodeIds: ['a'], endNodeIds: ['c'] }] });
  await call('graph_layout', { baseRevision: 1, baseLayoutRevision: 0, mode: 'replace', positions: Object.fromEntries(ids.map((id, i) => [id, { x: 100 + i * 550, y: i === 5 ? 800 : 0 }])), routes: { bc: route(990), cd: route(1540), de: route(2090), fg: route(3540) }, direction: 'RIGHT' });
  await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/#${sessionId}`); await page.waitForSelector('#nodes [data-node-id="a"]');
  assert.ok(await page.$('#auto-layout-connected'), 'Arrange must expose Layout connected component');
  assert.equal(await page.$('#apply-layout'), null, 'Automatic layout must save to the draft without an Apply step');
  const draftId = await page.evaluate(id => localStorage.getItem(`axcanvas-draft:${id}`), sessionId);
  const read = () => call('draft_read', { draftId });
  const canonical = await call('graph_read');
  async function select(id) { await page.click('#tool-select'); await page.click('#fit'); await page.click(`#nodes [data-node-id="${id}"]`); }
  async function arrange(direction = 'RIGHT', mode = 'connected', expected) {
    await openMenu(page, 'arrange'); await page.select('#layout-direction', direction);
    const response = draftResponse(page, args => args.operation.type === 'layout_region');
    if (expected) assert.match(await page.$eval(`#auto-layout-${mode}`, e => e.textContent), new RegExp('\\(' + expected.length + '\\)'));
    await page.click(`#auto-layout-${mode}`); const raw = await response, d = await result(raw);
    if (expected) assert.deepEqual(JSON.parse(raw.request().postData()).arguments.operation.nodeIds, expected);
    await page.waitForSelector('#layout-status[data-state="idle"]'); await idle(page); return d;
  }
  async function undo() { const response = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === 'draft_step'); await openMenu(page, 'arrange'); await page.click('#undo-layout'); const d = await result(await response); await idle(page); return d; }
  const worker = w => workerUrls.push(w.url()); page.on('workercreated', worker);
  try {
    await page.click('#graph-search-toggle'); await fillInput(page, '#graph-search-input', '#backend #설계'); assert.equal(await page.$$eval('#graph-search-results button', all => all.length), 1); await page.click('#graph-search-results button'); await page.waitForSelector('#graph-search-panel[hidden]');
    assert.equal(await page.$eval('#node-id', e => e.textContent), 'a'); assert.equal(await page.$eval('#node-tags', e => e.value), 'backend, 설계'); assert.match(await page.$eval('#nodes [data-node-id="a"] .tag-chip', e => e.textContent), /#backend/);
    const response = draftResponse(page, args => args.operation.type === 'node' && args.operation.node.tags?.includes('human'));
    await fillInput(page, '#node-tags', 'backend, human'); let d = await result(await response); await idle(page); assert.deepEqual(d.graph.nodes.find(n => n.id === 'a').tags, ['backend','human']); assert.deepEqual(await call('graph_read'), canonical);
    await page.reload(); await page.waitForSelector('#nodes [data-node-id="a"]'); await select('a'); assert.equal(await page.$eval('#node-tags', e => e.value), 'backend, human');
    let step = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === 'draft_step'); await page.click('#draft-undo'); await step; await idle(page);
    assert.equal(await page.$eval('#node-tags', e => e.value), 'backend, 설계');
    await fillInput(page, '#node-tags', 'backend, BACKEND'); await page.click('#save'); await page.waitForFunction(() => document.getElementById('node-tags').validationMessage.includes('unique'));
    assert.equal(await page.$eval('#auto-layout-connected', e => e.disabled), true); await page.click('#cancel'); assert.deepEqual((await read()).graph, canonical);
    cases.push('agent-tags-exact-search-human-autosave-reload-undo-and-validation');

    await select('b'); const before = await read(), outside = await page.$eval('#nodes [data-node-id="f"]', e => e.getAttribute('transform'));
    d = await arrange('RIGHT', 'connected', ['a','b','c','d','e']); assert.equal(d.version, before.version + 1); assert.equal(await page.$eval('#nodes [data-node-id="f"]', e => e.getAttribute('transform')), outside);
    assert.deepEqual((await undo()).graph, before.graph); cases.push('connected-component-native-worker-immediate-save-and-one-checkpoint');
    await openMenu(page, 'arrange'); await page.select('#layout-direction', 'DOWN'); await page.keyboard.press('Escape'); await page.focus('#tool-select');
    const shortcutSave = draftResponse(page, args => args.operation.type === 'layout_region');
    await page.keyboard.down('Shift'); await page.keyboard.press('KeyL'); await page.keyboard.up('Shift');
    d = await result(await shortcutSave); await idle(page);
    for (const id of ['f','g','isolated']) assert.deepEqual(d.graph.positions[id], before.graph.positions[id]);
    assert.deepEqual(d.graph.routes.fg, before.graph.routes.fg); assert.ok(d.graph.routes.cd); assert.equal(d.graph.layoutDirection, before.graph.layoutDirection);
    assert.ok(d.graph.positions.a.y < d.graph.positions.b.y && d.graph.positions.b.y < d.graph.positions.c.y); assert.deepEqual(d.graph.nodes, before.graph.nodes); assert.deepEqual(d.graph.edges, before.graph.edges); assert.deepEqual(d.graph.flows, before.graph.flows);
    assert.deepEqual(await call('graph_read'), canonical); assert.deepEqual((await call('feedback_read')).feedback, []);
    assert.deepEqual((await undo()).graph, before.graph); cases.push('shortcut-immediate-save-and-exact-undo');

    await page.select('#flow-selector', 'topic'); await select('b'); const scopedBefore = await read(); d = await arrange('RIGHT', 'connected', ['a','b','c']);
    assert.deepEqual(d.graph.positions, scopedBefore.graph.positions); assert.deepEqual(d.graph.routes, scopedBefore.graph.routes); assert.deepEqual(d.graph.flows, canonical.flows); assert.deepEqual(Object.keys(d.graph.flowLayouts.topic.positions).sort(), ['a','b','c']); assert.deepEqual((await undo()).graph, scopedBefore.graph);
    cases.push('scoped-neighborhood-preserves-global-geometry-and-role-metadata');

    await page.select('#flow-selector', ''); await select('b'); await page.keyboard.down('Shift'); try { await page.click('#nodes [data-node-id="isolated"]'); } finally { await page.keyboard.up('Shift'); }
    await page.click('#nodes [data-node-id="b"]', { button: 'right' });
    const contextSave = draftResponse(page, args => args.operation.type === 'layout_region');
    await page.click('#canvas-context-menu [data-command="layout-connected"]'); const contextResponse = await contextSave;
    d = await result(contextResponse); await idle(page);
    assert.equal(JSON.parse(contextResponse.request().postData()).arguments.operation.nodeIds.length, 6);
    for (const id of ['f','g']) assert.deepEqual(d.graph.positions[id], before.graph.positions[id]);
    await undo();
    cases.push('context-menu-multiple-seeds-and-isolated-selection');
    await select('a'); const tagBefore = await read(); d = await arrange('RIGHT', 'tags', ['a','b','isolated']);
    assert.equal(d.version, tagBefore.version + 1);
    for (const id of ['c','d','e','f','g']) assert.deepEqual(d.graph.positions[id], tagBefore.graph.positions[id]);
    assert.deepEqual(d.graph.routes.cd, tagBefore.graph.routes.cd); assert.deepEqual(d.graph.routes.de, tagBefore.graph.routes.de); assert.deepEqual(d.graph.routes.fg, tagBefore.graph.routes.fg); assert.equal(d.graph.routes.bc, undefined);
    assert.deepEqual(d.graph.nodes, tagBefore.graph.nodes); assert.deepEqual(d.graph.edges, tagBefore.graph.edges); assert.deepEqual(d.graph.flows, tagBefore.graph.flows);
    assert.deepEqual((await undo()).graph, tagBefore.graph); cases.push('original-tag-overlap-includes-disconnected-matches-without-tag-chaining');

    await select('e'); await openMenu(page, 'arrange');
    assert.equal(await page.$eval('#auto-layout-tags', e => e.disabled), true); assert.match(await page.$eval('#auto-layout-tags', e => e.textContent), /\(0\)/);
    await page.keyboard.press('Escape'); await select('a');
    await page.keyboard.down('Shift');
    try { await page.click('#nodes [data-node-id="f"]'); await page.click('#nodes [data-node-id="e"]'); } finally { await page.keyboard.up('Shift'); }
    const unionBefore = await read(); await page.click('#nodes [data-node-id="a"]', { button: 'right' });
    const unionSave = draftResponse(page, args => args.operation.type === 'layout_region');
    await page.click('#canvas-context-menu [data-command="layout-tags"]'); const unionRaw = await unionSave; d = await result(unionRaw); await idle(page);
    assert.deepEqual(JSON.parse(unionRaw.request().postData()).arguments.operation.nodeIds, ['a','b','isolated','f']);
    for (const id of ['c','d','e','g']) assert.deepEqual(d.graph.positions[id], unionBefore.graph.positions[id]);
    assert.equal(d.graph.routes.fg, undefined); assert.deepEqual(d.graph.routes.de, unionBefore.graph.routes.de);
    assert.deepEqual((await undo()).graph, unionBefore.graph); cases.push('empty-tag-disable-and-multi-selection-union-excludes-untagged-seeds');

    await page.select('#flow-selector', 'topic'); await select('a'); const tagScopedBefore = await read();
    d = await arrange('DOWN', 'tags', ['a','b']);
    assert.deepEqual(d.graph.positions, tagScopedBefore.graph.positions); assert.deepEqual(d.graph.routes, tagScopedBefore.graph.routes);
    assert.deepEqual(d.graph.flowLayouts.topic.positions.c, canonical.positions.c);
    assert.deepEqual(d.graph.flows, canonical.flows); assert.deepEqual((await undo()).graph, tagScopedBefore.graph);
    cases.push('tag-region-scope-isolation-and-projected-boundaries');

    await page.select('#flow-selector', ''); await select('a'); d = await arrange('RIGHT', 'tags', ['a','b','isolated']);
    assert.deepEqual(await call('graph_read'), canonical); assert.deepEqual((await call('feedback_read')).feedback, []);
    await page.reload(); await page.waitForSelector('#nodes [data-node-id="a"]'); assert.deepEqual((await read()).graph, d.graph);
    const reviewResponse = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === 'draft_review');
    await page.click('#send-feedback'); await reviewResponse; await page.waitForSelector('#review-dialog[open]');
    const submitResponse = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === 'draft_submit');
    await page.click('#review-submit'); const packet = await result(await submitResponse); await idle(page);
    const saved = await call('graph_read');
    assert.deepEqual(saved.positions, d.graph.positions); assert.deepEqual(saved.routes, d.graph.routes);
    assert.deepEqual(saved.nodes, canonical.nodes); assert.deepEqual(saved.edges, canonical.edges); assert.deepEqual(saved.flows, canonical.flows);
    assert.equal((await call('feedback_read')).feedback[0].id, packet.id);
    assert.ok(workerUrls.length > 0 && workerUrls.every(url => url.endsWith('/vendor/elk-worker.js')));
    cases.push('tag-region-durable-reload-and-final-reviewed-publication');
    return { sessionId, cases, workerUrls, submissionId: packet.id };
  } finally { page.off('workercreated', worker); }
}
