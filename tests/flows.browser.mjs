import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function verifyScopedFlows(page, baseUrl) {
  const sessionId = `flows-ui-${randomUUID()}`, cases = [];
  const call = async (tool, args = {}) => {
    const response = await fetch(`${baseUrl}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId, tool, arguments: args, actor: 'user' }) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body.result;
  };
  async function action(selector, tool = 'draft_change') {
    const pending = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === tool);
    await page.click(selector); const response = await pending, body = await response.json(); assert.equal(response.status(), 200, JSON.stringify(body));
    await page.waitForFunction(() => !document.getElementById('feedback-note').disabled); return body.result;
  }
  async function fill(selector, value) { await page.click(selector, { clickCount: 3 }); await page.type(selector, value); }
  async function scope(id) { await page.select('#flow-selector', id); await page.waitForFunction(id => document.getElementById('flow-selector').value === id, {}, id); await page.click('#fit'); }
  async function layout(direction) {
    await page.select('#layout-direction', direction); await page.click('#auto-layout'); await page.waitForSelector('#layout-status[data-state="preview"]');
    const draft = await action('#apply-layout'); await page.waitForSelector('#layout-status[data-state="idle"]'); await page.click('#fit'); return draft;
  }
  const node = id => ({ id, kind: 'concept', label: ({ a: 'Question — 질문', b: 'Shared result', c: 'Conclusion C', d: 'Conclusion D' })[id], detail: 'One semantic identity reused across flows.', status: 'confirmed', sources: [] });
  const edge = (id, source, target) => ({ id, source, target, relation: 'supports', status: 'active' });
  const flow = (id, label, nodeIds, edgeIds, startNodeIds, endNodeIds) => ({ id, scope: 'turn', turnId: id, label, nodeIds, edgeIds, startNodeIds, endNodeIds });
  await call('session_open', { title: 'Scoped flow browser contract' });
  await call('graph_commit', { baseRevision: 0, answerId: 'seed', nodes: ['a','b','c','d'].map(node), edges: [edge('ab','a','b'),edge('bc','b','c'),edge('bd','b','d')], flows: [
    { id: 'whole', scope: 'graph', label: 'Whole graph', startNodeIds: ['a'], endNodeIds: ['c','d'] },
    flow('turn-1','Turn 1',['a','b'],['ab'],['a'],['b']), flow('turn-2','Turn 2',['b','c','d'],['bc','bd'],['b'],['c','d'])
  ] });
  const original = await call('graph_read');
  await page.setViewport({ width: 1600, height: 1050, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/#${sessionId}`); await page.waitForSelector('[data-node-id="b"]');
  assert.equal(await page.$eval('#flow-selector', e => e.value), ''); assert.equal(await page.$$eval('.graph-node', nodes => nodes.length), 4);
  await scope('turn-1'); assert.equal(await page.$$eval('.graph-node', nodes => nodes.length), 2);
  assert.ok(await page.$('[data-node-id="b"] .flow-badge[data-flow-role="end"][data-flow-id="turn-1"]'));
  const first = await layout('RIGHT'), globalPositions = first.graph.positions, firstLayout = first.graph.flowLayouts['turn-1'];
  assert.ok(firstLayout.routes.ab); assert.deepEqual(first.graph.positions, original.positions);
  await scope('turn-2'); assert.equal(await page.$$eval('.graph-node', nodes => nodes.length), 3);
  assert.ok(await page.$('[data-node-id="b"] .flow-badge[data-flow-role="start"][data-flow-id="turn-2"]'));
  let draft = await layout('DOWN');
  assert.deepEqual(draft.graph.positions, globalPositions); assert.deepEqual(draft.graph.flowLayouts['turn-1'], firstLayout);
  assert.equal(draft.graph.flowLayouts['turn-2'].direction, 'DOWN'); assert.ok(draft.graph.flowLayouts['turn-2'].routes.bc);
  assert.deepEqual(await call('graph_read'), original); cases.push('same-node-qualified-roles-and-isolated-native-worker-views');

  await page.click('[data-node-id="b"]'); assert.equal(await page.$eval('#node-flow-start', e => e.checked), true); assert.equal(await page.$eval('#node-flow-end', e => e.checked), false);
  draft = await action('#node-flow-start'); assert.deepEqual(draft.graph.flows.find(f => f.id === 'turn-2').startNodeIds, []);
  await page.reload(); await page.waitForSelector('#flow-selector'); await scope('turn-2'); await page.click('[data-node-id="b"]');
  assert.equal(await page.$eval('#node-flow-start', e => e.checked), false);
  draft = await action('#draft-undo', 'draft_step'); assert.deepEqual(draft.graph.flows.find(f => f.id === 'turn-2').startNodeIds, ['b']); cases.push('role-draft-save-reload-and-durable-undo');

  await page.click('#add-flow'); await page.waitForSelector('#flow-editor[open]'); await fill('#flow-label', 'Review slice'); await page.select('#flow-scope', 'custom');
  await page.select('#flow-nodes', 'b', 'c'); await page.select('#flow-edges', 'bc'); await page.select('#flow-starts', 'b'); await page.select('#flow-ends', 'c');
  draft = await action('#flow-save'); const custom = draft.graph.flows.find(f => f.label === 'Review slice'); assert.ok(custom); assert.deepEqual([...custom.nodeIds].sort(), ['b','c']);
  await scope(custom.id); await page.click('#add-node'); await fill('#node-label', 'Temporary scoped node'); draft = await action('#save');
  const temporary = draft.graph.nodes.find(n => n.label === 'Temporary scoped node'); assert.ok(temporary); assert.ok(draft.graph.flows.find(f => f.id === custom.id).nodeIds.includes(temporary.id));
  assert.equal(draft.graph.positions[temporary.id], undefined); assert.ok(draft.graph.flowLayouts[custom.id].positions[temporary.id]);
  draft = await action('#retire-node'); assert.equal(draft.graph.nodes.some(n => n.id === temporary.id), false); assert.equal(draft.graph.flows.find(f => f.id === custom.id).nodeIds.includes(temporary.id), false);
  cases.push('custom-flow-authoring-scoped-node-and-net-zero-retirement');

  await scope('turn-2'); draft = await layout('RIGHT');
  await page.click('[data-node-id="b"]'); await page.click('#pen');
  const point = await page.$eval('[data-node-id="b"]', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 25, point.y + 20, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(() => !document.getElementById('feedback-note').disabled);
  await page.select('#flow-selector', 'turn-1'); assert.equal(await page.$eval('#flow-selector', e => e.value), 'turn-2', 'Captured drawing must block a scope switch');
  const note = 'Review the shared result in Turn 2, not Turn 1.';
  const noteSaved = page.waitForResponse(r => {
    if (!r.url().endsWith('/api/agent/v1') || r.request().method() !== 'POST') return false;
    const body = JSON.parse(r.request().postData());
    return body.tool === 'draft_change' && body.arguments.operation.type === 'instruction' && body.arguments.operation.note === note;
  });
  await fill('#feedback-note', note);
  const noteResponse = await noteSaved; assert.equal(noteResponse.status(), 200);
  assert.equal((await noteResponse.json()).result.captureFlowId, 'turn-2');
  await page.waitForFunction(() => !document.getElementById('feedback-note').disabled);
  await page.reload(); await page.waitForSelector('[data-node-id="b"]'); assert.equal(await page.$eval('#flow-selector', e => e.value), 'turn-2');
  assert.ok(await page.$('[data-node-id="b"] .flow-badge[data-flow-role="start"]')); cases.push('drawing-frame-blocks-switch-and-restores-captured-view');
  const emptyWait = await fetch(`${baseUrl}/api/submissions/wait?sessionId=${sessionId}&timeoutMs=5`).then(r => r.json()); assert.equal(emptyWait.feedback, null);
  await page.click('#send-feedback'); await page.waitForSelector('#review-dialog[open]');
  assert.ok(await page.$('#review-changes [data-entity="flow"]')); assert.ok(await page.$('#review-changes [data-entity="flow_layout"]'));
  assert.equal(await page.$$eval(`#review-changes [data-change-id="${temporary.id}"]`, all => all.length), 0);
  assert.deepEqual(await call('graph_read'), original); assert.deepEqual((await call('feedback_read')).feedback, []);
  const pending = fetch(`${baseUrl}/api/submissions/wait?sessionId=${sessionId}&timeoutMs=25000`).then(r => r.json());
  const packet = await action('#review-submit', 'draft_submit'), delivery = await pending;
  assert.equal(delivery.feedback.id, packet.id); assert.equal(packet.captureFlowId, 'turn-2'); assert.ok(packet.strokes.length > 0);
  const image = await fetch(packet.imageUrl).then(r => r.text()); assert.match(image, /Turn 2/); assert.match(image, /START/); assert.match(image, /END/); assert.doesNotMatch(image, /Question — 질문/);
  const saved = await call('graph_read'); assert.deepEqual(saved.positions, original.positions); assert.deepEqual(saved.flowLayouts['turn-1'].positions, firstLayout.positions);
  assert.equal((await fetch(`${baseUrl}/api/submissions/wait?sessionId=${sessionId}&after=${delivery.cursor}&timeoutMs=5`).then(r => r.json())).feedback, null);
  cases.push('qualified-review-single-final-watcher-packet-and-matching-svg');
  await page.click('#fit');
  for (const width of [390,800]) { await page.setViewport({ width, height: 844, deviceScaleFactor: 1 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.ok(await page.$eval('#flow-selector', e => e.getBoundingClientRect().width > 0)); }
  await page.setViewport({ width: 1600, height: 1050, deviceScaleFactor: 1 }); await page.click('#fit'); cases.push('narrow-and-medium-scope-controls');
  return { sessionId, cases, submissionId: packet.id, watcherCursor: delivery.cursor, finalRevision: saved.revision };
}
