import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openMenu, draftResponse, result } from './workspace-helpers.mjs';

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
  async function start(direction) {
    await ready(); await openMenu(page, 'arrange'); await page.select('#layout-direction', direction); await page.click('#auto-layout');
  }
  async function arrange(direction) {
    const response = draftResponse(page, args => args.operation.type === 'layout');
    await start(direction); const d = await result(await response);
    await page.waitForSelector('#layout-status[data-state="idle"]'); await ready();
    assert.equal(await page.$$eval('.graph-edge.routed', all => all.length), 6);
    return d.graph;
  }
  async function pauseNextWorker() {
    const cdp = await page.createCDPSession(), attached = Promise.withResolvers();
    cdp.on('Target.attachedToTarget', event => { if (event.targetInfo.type === 'worker') attached.resolve(event); });
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    return {
      async wait() {
        let timer;
        try { return await Promise.race([attached.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native layout Worker did not attach')), 10000); })]); }
        finally { clearTimeout(timer); }
      },
      async close() { await cdp.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }); await cdp.detach(); }
    };
  }
  async function discard() {
    page.once('dialog', dialog => dialog.accept());
    const opened = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === 'draft_open');
    await openMenu(page, 'file'); await page.click('#discard-draft'); await opened; await ready();
  }
  try {
    await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/#${sessionId}`); await page.waitForSelector('.graph-node');
    const initialDraft = await readDraft(), initialCamera = await page.$eval('#canvas', e => e.getAttribute('viewBox'));
    const paused = await pauseNextWorker();
    try {
      await start('RIGHT'); await paused.wait();
      assert.equal(await page.$eval('#layout-status', e => e.dataset.state), 'computing');
      assert.equal(await page.$eval('#pen', e => e.disabled), true);
      await page.click('#cancel-layout'); await page.waitForSelector('#layout-status[data-state="idle"]');
      assert.deepEqual(await readDraft(), initialDraft); assert.equal(await page.$eval('#canvas', e => e.getAttribute('viewBox')), initialCamera);
    } finally { await paused.close(); }
    cases.push('native-computation-cancel-without-write');
    const down = await arrange('DOWN'), savedDraft = await readDraft();
    assert.equal(savedDraft.version, initialDraft.version + 1, 'One automatic calculation must create exactly one checkpoint');
    assert.equal(down.layoutDirection, 'DOWN'); assert.equal(Object.keys(down.routes).length, 6);
    assert.deepEqual(await call('graph_read'), original); assert.deepEqual((await call('feedback_read')).feedback, []); cases.push('immediate-draft-save-without-publication');
    await page.reload(); await page.waitForSelector('.graph-edge.routed');
    assert.equal(await page.$eval('#undo-layout', e => e.disabled), true);
    assert.deepEqual((await readDraft()).graph, down); cases.push('durable-draft-layout');
    await arrange('RIGHT'); await openMenu(page, 'arrange'); await page.click('#undo-layout'); await ready();
    const undone = (await readDraft()).graph;
    assert.deepEqual(undone.positions, down.positions); assert.deepEqual(undone.routes, down.routes); assert.equal(undone.layoutDirection, 'DOWN'); cases.push('exact-layout-undo');
    await page.keyboard.down('Control'); try { await page.click('[data-node-id="b"]'); } finally { await page.keyboard.up('Control'); }
    assert.ok(await page.$$eval('.graph-node.dimmed', all => all.length) > 0); assert.ok(await page.$$eval('.graph-edge.focused', all => all.length) > 0);
    assert.ok(await page.$$eval('#node-relations li', all => all.length) > 0);
    await page.click('[data-node-id="b"]'); assert.equal(await page.$$eval('.dimmed', all => all.length), 0); cases.push('focus-and-full-relations');
    const staleDraft = await readDraft(), staleWorker = await pauseNextWorker();
    try {
      await start('RIGHT'); await staleWorker.wait();
      await call('graph_edit', { baseRevision: original.revision, node: { ...node('b'), detail: 'Remote change during calculation' } }, 'agent');
      await page.waitForSelector('#layout-status[data-state="idle"]');
      assert.deepEqual(await readDraft(), staleDraft); assert.deepEqual((await call('graph_read')).positions, original.positions);
    } finally { await staleWorker.close(); }
    cases.push('remote-change-cancels-inflight-calculation');
    await discard();
    const beforeRace = await call('graph_read'), draftBeforeRace = await readDraft(); let raced = false; const raceDone = Promise.withResolvers();
    const intercept = async request => {
      const post = request.method() === 'POST' && request.url().endsWith('/api/agent/v1') ? JSON.parse(request.postData()) : null;
      if (!raced && post?.tool === 'draft_change' && post.arguments.operation.type === 'layout') {
        raced = true;
        try {
          assert.equal(await page.$eval('#layout-status', e => e.dataset.state), 'saving');
          assert.equal(await page.$eval('#cancel-layout', e => e.hidden), true);
          assert.equal(await page.$eval('#auto-layout', e => e.disabled), true);
          await call('graph_edit', { baseRevision: beforeRace.revision, node: { ...node('b'), detail: 'Remote change while saving draft layout' } }, 'agent');
          await request.continue(); raceDone.resolve();
        } catch (e) { await request.abort(); raceDone.reject(e); }
      } else await request.continue();
    };
    await page.setRequestInterception(true); page.on('request', intercept);
    try {
      const rejected = draftResponse(page, args => args.operation.type === 'layout');
      await start('RIGHT'); assert.equal((await rejected).status(), 409); await raceDone.promise;
      await page.waitForSelector('#layout-status[data-state="idle"]'); await ready();
    } finally { page.off('request', intercept); await page.setRequestInterception(false); }
    assert.equal(raced, true); assert.deepEqual((await call('graph_read')).positions, beforeRace.positions);
    assert.deepEqual(await readDraft(), draftBeforeRace); cases.push('saving-lockout-and-atomic-canonical-race-rejection');
    await discard(); const arranged = await arrange('RIGHT'); await page.click('#fit');
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
