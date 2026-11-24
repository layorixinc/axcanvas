import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beginNode, beginConnection, openMenu, showPanel } from './workspace-helpers.mjs';

export async function verifyReviewedAuthoring(page, baseUrl) {
  const sessionId = `review-ui-${randomUUID()}`, cases = [];
  const call = async (tool, args = {}, actor = 'user') => {
    const r = await fetch(baseUrl + '/api/agent/v1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId, tool, arguments: args, actor }) });
    const reply = await r.json(); assert.equal(r.status, 200, JSON.stringify(reply)); return reply.result;
  };
  const response = (tool, status = 200) => page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === tool && r.status() === status);
  async function action(selector, tool, status = 200) {
    const done = response(tool, status); await page.click(selector);
    const result = (await (await done).json()).result;
    await page.waitForFunction(() => !document.getElementById('send-feedback').disabled);
    return result;
  }
  async function fill(selector, text) {
    await page.click(selector); const key = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.down(key); await page.keyboard.press('KeyA'); await page.keyboard.up(key); await page.keyboard.type(text);
  }
  const n = id => ({ id, kind: 'concept', label: id === 'a' ? 'Original root' : 'Existing neighbor', detail: 'Original content', status: 'confirmed', sources: [] });
  await call('session_open', { title: 'Reviewed graph authoring' });
  await call('graph_commit', { baseRevision: 0, answerId: 'seed', nodes: [n('a'), n('b')], edges: [{ id: 'ab', source: 'a', target: 'b', relation: 'uses', status: 'active' }] });
  const original = await call('graph_read');
  await page.setViewport({ width: 1600, height: 1050, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/#${sessionId}`); await page.waitForSelector('.graph-node');
  const originalPosition = await page.$eval('[data-node-id="a"]', e => e.getAttribute('transform'));
  await beginNode(page); await page.select('#node-type', 'task');
  await fill('#node-label', 'New review task'); await fill('#node-detail', 'Human-authored task, staged until final review.');
  let d = await action('#save', 'draft_change');
  const created = d.graph.nodes.find(n => n.label === 'New review task'); assert.ok(created);
  assert.equal(await page.$eval('[data-node-id="a"]', e => e.getAttribute('transform')), originalPosition);
  assert.deepEqual(await call('graph_read'), original); cases.push('new-node-isolated-and-position-preserved');

  await beginConnection(page, 'a', created.id);
  await fill('#edge-relation', 'requests review'); d = await action('#edge-save', 'draft_change');
  let edge = d.graph.edges.find(e => e.target === created.id); assert.ok(edge);
  await page.select('#edge-picker', edge.id); await page.click('#edge-reverse'); await fill('#edge-relation', 'responds to');
  d = await action('#edge-save', 'draft_change');
  edge = d.graph.edges.find(e => e.id === edge.id); assert.equal(edge.source, created.id); assert.equal(edge.target, 'a'); assert.equal(edge.relation, 'responds to');
  await page.select('#edge-picker', edge.id); d = await action('#edge-retire', 'draft_change'); assert.equal(d.graph.edges.some(e => e.id === edge.id), false);
  d = await action('#draft-undo', 'draft_step'); assert.ok(d.graph.edges.some(e => e.id === edge.id));
  d = await action('#draft-redo', 'draft_step'); assert.equal(d.graph.edges.some(e => e.id === edge.id), false);
  d = await action('#draft-undo', 'draft_step'); cases.push('directed-edge-create-edit-retire-undo-redo');

  await beginNode(page); await fill('#node-label', 'Temporary node'); d = await action('#save', 'draft_change');
  const temporary = d.graph.nodes.find(n => n.label === 'Temporary node');
  d = await action('#retire-node', 'draft_change'); assert.equal(d.graph.nodes.some(n => n.id === temporary.id), false);
  await page.click('[data-node-id="a"]'); await fill('#node-label', 'Human-reviewed root'); d = await action('#save', 'draft_change');
  const draftId = d.id;
  await page.reload(); await page.waitForSelector(`[data-node-id="${created.id}"]`);
  assert.deepEqual((await call('draft_read', { draftId })).graph, d.graph);
  d = await action('#draft-undo', 'draft_step'); assert.equal(d.graph.nodes.find(n => n.id === 'a').label, 'Original root');
  d = await action('#draft-redo', 'draft_step'); assert.equal(d.graph.nodes.find(n => n.id === 'a').label, 'Human-reviewed root'); cases.push('durable-draft-and-history');

  await openMenu(page, 'arrange'); await page.click('#auto-layout'); await page.waitForSelector('#layout-status[data-state="preview"]');
  d = await action('#apply-layout', 'draft_change'); await page.waitForSelector('#layout-status[data-state="idle"]'); await page.click('#fit');
  assert.ok(Object.keys(d.graph.routes).length > 0); assert.deepEqual(await call('graph_read'), original); cases.push('worker-layout-remains-draft');
  await page.click('[data-node-id="a"]'); await page.click('#pen');
  const point = await page.$eval('[data-node-id="a"]', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 30, point.y + 20, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(() => !document.getElementById('feedback-note').disabled);
  await showPanel(page, 'agent');
  await page.type('#feedback-note', 'Review the complete graph, connections, layout and drawing.');
  await page.click('#send-feedback'); await page.waitForSelector('#review-dialog[open]');
  assert.ok((await page.$eval('#review-changes', e => e.textContent)).includes('New review task'));
  assert.equal(await page.$$eval(`#review-changes [data-change-id="${temporary.id}"]`, all => all.length), 0);
  assert.ok(await page.$('#review-changes [data-entity="instruction"]'));
  assert.deepEqual(await call('graph_read'), original); assert.deepEqual((await call('feedback_read')).feedback, []);
  await page.click('#review-back');
  if (await page.$eval('#pen', e => e.getAttribute('aria-pressed') === 'true')) await page.click('#pen');
  await page.click('[data-node-id="a"]'); await fill('#node-detail', 'Final reviewed content');
  await page.click('#send-feedback'); await page.waitForSelector('#review-dialog[open]');
  assert.ok((await page.$eval('#review-changes', e => e.textContent)).includes('Final reviewed content')); cases.push('review-all-back-edit-review-again');

  const waiting = fetch(`${baseUrl}/api/submissions/wait?sessionId=${sessionId}&timeoutMs=25000`);
  let raced = false; const raceDone = Promise.withResolvers();
  const intercept = async request => {
    const post = request.method() === 'POST' && request.url().endsWith('/api/agent/v1') ? JSON.parse(request.postData()) : null;
    if (!raced && post?.tool === 'draft_submit') {
      raced = true;
      try { await call('graph_edit', { baseRevision: original.revision, node: { ...n('b'), detail: 'Concurrent agent content must survive' } }, 'agent'); await request.continue(); raceDone.resolve(); }
      catch (e) { await request.abort(); raceDone.reject(e); }
    } else await request.continue();
  };
  await page.setRequestInterception(true); page.on('request', intercept);
  try { await action('#review-submit', 'draft_submit', 409); await raceDone.promise; }
  finally { page.off('request', intercept); await page.setRequestInterception(false); }
  assert.equal((await call('graph_read')).nodes.find(n => n.id === 'a').label, 'Original root');
  assert.deepEqual((await call('feedback_read')).feedback, []);
  if (await page.$eval('#review-dialog', e => e.open)) await page.click('#review-back');
  await openMenu(page, 'file'); await page.click('#inspect-latest'); await page.waitForSelector('#rebase-dialog[open]');
  d = await action('#rebase-merge', 'draft_rebase');
  assert.equal(d.graph.nodes.find(n => n.id === 'b').detail, 'Concurrent agent content must survive');
  await page.click('#send-feedback'); await page.waitForSelector('#review-dialog[open]');
  assert.equal(await page.$$eval('#review-changes [data-entity="node"][data-change-id="b"]', all => all.length), 0);
  const feedback = await action('#review-submit', 'draft_submit');
  const delivery = await (await waiting).json(); assert.equal(delivery.feedback.id, feedback.id);
  assert.ok(feedback.strokes.length > 0); assert.equal(feedback.note, 'Review the complete graph, connections, layout and drawing.');
  const saved = await call('graph_read'); assert.equal(saved.nodes.find(n => n.id === 'a').label, 'Human-reviewed root'); assert.equal(saved.nodes.find(n => n.id === 'a').detail, 'Final reviewed content');
  assert.equal(saved.nodes.find(n => n.id === 'b').detail, 'Concurrent agent content must survive');
  assert.ok(saved.nodes.some(n => n.id === created.id)); assert.ok(saved.edges.some(e => e.id === edge.id));
  assert.equal((await call('feedback_read')).feedback[0].status, 'pending'); cases.push('conflict-preserved-rebase-and-one-final-submission');
  const image = await fetch(feedback.imageUrl); assert.equal(image.status, 200); assert.match(await image.text(), /polyline/);
  await call('feedback_ack', { feedbackIds: [feedback.id], status: 'applied', note: 'Browser fixture reviewed the complete packet.' }, 'agent');
  await page.waitForFunction(() => document.getElementById('feedback-list').textContent.includes('Applied'));
  await page.click('#fit');
  return { sessionId, cases, finalRevision: saved.revision, submissionId: feedback.id, watcherCursor: delivery.cursor };
}
