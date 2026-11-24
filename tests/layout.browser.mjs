import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Native Worker geometry remains draft-local until the separate reviewed submission.
export async function verifyLayoutWorkflow(page, baseUrl) {
  const sessionId = `layout-ui-${randomUUID()}`, cases = [], workerUrls = [];
  const call = async (tool, args = {}, actor = 'user') => {
    const r = await fetch(baseUrl + '/api/agent/v1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId, tool, arguments: args, actor }) });
    const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body)); return body.result;
  };
  const readDraft = async () => call('draft_read', { draftId: await page.evaluate(id => localStorage.getItem(`axcanvas-draft:${id}`), sessionId) });
  const node = id => ({ id, kind: 'concept', label: id === 'b' ? 'API server' : id, detail: 'Browser regression fixture', status: 'confirmed', sources: [] });
  const edge = (id, source, target, relation = 'uses') => ({ id, source, target, relation, status: 'active' });
  await call('session_open', { title: 'Layout browser regression' });
  await call('graph_commit', { baseRevision: 0, answerId: 'fixture', nodes: ['a','b','c','d','e','isolated'].map(node), edges: [edge('ab','a','b'),edge('bc','b','c','A deliberately long relationship label that must remain readable without overlapping nodes'),edge('bc2','b','c','also uses'),edge('cb','c','b','returns'),edge('bd','b','d'),edge('loop','d','d','self')] });
  const original = await call('graph_read');
  const onWorker = worker => workerUrls.push(worker.url()); page.on('workercreated', onWorker);
  const ready = () => page.waitForFunction(() => !document.getElementById('send-feedback').disabled);
  async function preview(direction) {
    await ready(); await page.select('#layout-direction', direction); await page.click('#auto-layout');
    await page.waitForSelector('#layout-status[data-state="preview"]', { timeout: 10000 });
    assert.equal(await page.$$eval('.graph-edge.routed', all => all.length), 6);
  }
  async function apply() {
    await page.click('#apply-layout'); await page.waitForSelector('#layout-status[data-state="idle"]'); await ready(); return (await readDraft()).graph;
  }
  async function discard() {
    page.once('dialog', dialog => dialog.accept());
    const opened = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === 'draft_open');
    await page.click('#discard-draft'); await opened; await ready();
  }
  try {
    await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/#${sessionId}`); await page.waitForSelector('.graph-node');
    await page.click('[data-node-id="a"]'); await page.type('#node-label', ' unsaved');
    assert.equal(await page.$eval('#auto-layout', e => e.disabled), true);
    await page.click('#cancel'); cases.push('dirty-form-blocking');
    await preview('RIGHT'); assert.deepEqual(await call('graph_read'), original);
    assert.equal(await page.$eval('#pen', e => e.disabled), true);
    await page.click('#cancel-layout'); await page.waitForSelector('#layout-status[data-state="idle"]');
    assert.deepEqual((await readDraft()).graph, original); cases.push('preview-cancel-no-write');
    await preview('DOWN'); const down = await apply();
    assert.equal(down.layoutDirection, 'DOWN'); assert.equal(Object.keys(down.routes).length, 6);
    assert.deepEqual(await call('graph_read'), original); cases.push('draft-direction-routing-without-publication');
    await page.reload(); await page.waitForSelector('.graph-edge.routed');
    assert.equal(await page.$eval('#undo-layout', e => e.disabled), true);
    assert.deepEqual((await readDraft()).graph, down); cases.push('durable-draft-layout');
    await preview('RIGHT'); await apply(); await page.click('#undo-layout'); await ready();
    const undone = (await readDraft()).graph;
    assert.deepEqual(undone.positions, down.positions); assert.deepEqual(undone.routes, down.routes); assert.equal(undone.layoutDirection, 'DOWN'); cases.push('exact-layout-undo');
    await page.keyboard.down('Control'); try { await page.click('[data-node-id="b"]'); } finally { await page.keyboard.up('Control'); }
    assert.ok(await page.$$eval('.graph-node.dimmed', all => all.length) > 0); assert.ok(await page.$$eval('.graph-edge.focused', all => all.length) > 0);
    assert.ok(await page.$$eval('#node-relations li', all => all.length) > 0);
    await page.click('[data-node-id="b"]'); assert.equal(await page.$$eval('.dimmed', all => all.length), 0); cases.push('focus-and-full-relations');
    await preview('RIGHT');
    await call('graph_edit', { baseRevision: original.revision, node: { ...node('b'), detail: 'Remote change during preview' } }, 'agent');
    await page.waitForSelector('#layout-status[data-state="idle"]');
    assert.equal(await page.$eval('#apply-layout', e => e.hidden), true);
    assert.deepEqual((await call('graph_read')).positions, original.positions); cases.push('remote-change-invalidates-preview');
    await discard(); await preview('RIGHT');
    const beforeRace = await call('graph_read'); let raced = false; const raceDone = Promise.withResolvers();
    const intercept = async request => {
      const post = request.method() === 'POST' && request.url().endsWith('/api/agent/v1') ? JSON.parse(request.postData()) : null;
      if (!raced && post?.tool === 'draft_change' && post.arguments.operation.type === 'layout') {
        raced = true;
        try { await call('graph_edit', { baseRevision: beforeRace.revision, node: { ...node('b'), detail: 'Remote change while saving draft layout' } }, 'agent'); await request.continue(); raceDone.resolve(); }
        catch (e) { await request.abort(); raceDone.reject(e); }
      } else await request.continue();
    };
    await page.setRequestInterception(true); page.on('request', intercept);
    try { await apply(); await raceDone.promise; } finally { page.off('request', intercept); await page.setRequestInterception(false); }
    assert.equal(raced, true); assert.deepEqual((await call('graph_read')).positions, beforeRace.positions);
    assert.equal((await call('draft_review', { draftId: (await readDraft()).id, baseDraftVersion: (await readDraft()).version })).canSubmit, false); cases.push('raced-draft-never-overwrites-canonical');
    await discard(); await preview('RIGHT'); const arranged = await apply(); await page.click('#fit');
    const p = await page.$eval('[data-node-id="a"]', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const saved = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === 'draft_change' && r.status() === 200);
    await page.mouse.move(p.x,p.y); await page.mouse.down(); await page.mouse.move(p.x+28,p.y+22,{steps:8}); await page.mouse.up(); await saved; await ready();
    const moved = (await readDraft()).graph;
    assert.deepEqual(moved.routes, {}); assert.notDeepEqual(moved.positions.a, arranged.positions.a); assert.deepEqual((await call('graph_read')).positions, original.positions); cases.push('draft-move-invalidates-routes');
    assert.ok(workerUrls.includes(`${baseUrl}/vendor/elk-worker.js`)); assert.equal(page.workers().length, 0);
    await discard(); await page.click('#fit');
    return { sessionId, cases, workerUrls, finalRevision: (await call('graph_read')).revision };
  } finally { page.off('workercreated', onWorker); }
}
