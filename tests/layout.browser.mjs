import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Uses a dedicated real HTTP session and actual Chromium interactions, not model output.
export async function verifyLayoutWorkflow(page, baseUrl) {
  const sessionId = `layout-ui-${randomUUID()}`;
  async function call(tool, args = {}, actor = 'user') {
    const response = await fetch(`${baseUrl}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId, tool, arguments: args, actor }) });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body)); return body.result;
  }
  const node = id => ({ id, kind: 'concept', label: id === 'b' ? 'API server' : id, detail: 'Browser regression fixture', status: 'confirmed', sources: [] });
  const edge = (id, source, target, relation = 'uses') => ({ id, source, target, relation, status: 'active' });
  await call('session_open', { title: 'Layout browser regression' });
  await call('graph_commit', { baseRevision: 0, answerId: 'fixture', nodes: ['a','b','c','d','e','isolated'].map(node), edges: [edge('ab','a','b'),edge('bc','b','c','A deliberately long relationship label that must remain readable without overlapping nodes'),edge('bc2','b','c','also uses'),edge('cb','c','b','returns'),edge('bd','b','d'),edge('loop','d','d','self')] });
  const original = await call('graph_read');
  const cases = [], workerUrls = [];
  const onWorker = worker => workerUrls.push(worker.url());
  page.on('workercreated', onWorker);
  async function preview(direction) {
    await page.select('#layout-direction', direction); await page.click('#auto-layout');
    await page.waitForSelector('#layout-status[data-state="preview"]', { timeout: 10000 });
    assert.equal(await page.$$eval('.graph-edge.routed', all => all.length), 6);
  }
  async function apply() {
    await page.click('#apply-layout');
    await page.waitForFunction(() => document.getElementById('layout-status').dataset.state === 'idle' && !document.getElementById('undo-layout').disabled, { timeout: 10000 });
    return call('graph_read');
  }
  try {
    await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/#${sessionId}`); await page.waitForSelector('.graph-node');
    await page.type('#feedback-note', 'unsent instruction');
    assert.equal(await page.$eval('#auto-layout', e => e.disabled), true, 'Unsubmitted instructions must block rearrangement');
    await page.click('#clear-ink'); cases.push('draft-blocking');
    await preview('RIGHT');
    assert.deepEqual(await call('graph_read'), original, 'Preview must not write anything');
    assert.equal(await page.$eval('#pen', e => e.disabled), true);
    await page.click('#cancel-layout'); await page.waitForSelector('#layout-status[data-state="idle"]');
    assert.deepEqual(await call('graph_read'), original);
    assert.equal(await page.$$eval('.graph-edge.routed', all => all.length), 0); cases.push('preview-cancel-no-write');
    await preview('DOWN'); const down = await apply();
    assert.equal(down.revision, original.revision); assert.equal(down.layoutDirection, 'DOWN');
    assert.equal(Object.keys(down.routes).length, 6); cases.push('apply-direction-and-routing');
    await page.reload(); await page.waitForSelector('.graph-edge.routed');
    assert.equal(await page.$eval('#undo-layout', e => e.disabled), true, 'Undo is one step in the current tab, not persistent history');
    assert.deepEqual(await call('graph_read'), down); cases.push('reload-persistence');
    await preview('RIGHT'); await apply(); await page.click('#undo-layout');
    await page.waitForFunction(() => document.getElementById('layout-status').dataset.state === 'idle' && document.getElementById('undo-layout').disabled);
    const undone = await call('graph_read');
    assert.deepEqual(undone.positions, down.positions); assert.deepEqual(undone.routes, down.routes); assert.equal(undone.layoutDirection, 'DOWN');
    assert.equal(undone.revision, original.revision); cases.push('exact-layout-undo');
    await page.keyboard.down('Control');
    try { await page.click('[data-node-id="b"]'); } finally { await page.keyboard.up('Control'); }
    assert.ok(await page.$$eval('.graph-node.dimmed', all => all.length) > 0);
    assert.ok(await page.$$eval('.graph-edge.focused', all => all.length) > 0);
    assert.ok(await page.$$eval('#node-relations li', all => all.length) > 0);
    await page.click('#focus-relations'); assert.equal(await page.$$eval('.dimmed', all => all.length), 0);
    await page.click('#focus-relations'); cases.push('focus-and-full-relations');
    await preview('RIGHT');
    const current = await call('graph_read');
    await call('graph_edit', { baseRevision: current.revision, node: { ...current.nodes.find(n => n.id === 'b'), detail: 'Concurrent human change' } });
    await page.waitForSelector('#layout-status[data-state="idle"]');
    assert.equal(await page.$eval('#apply-layout', e => e.hidden), true);
    assert.deepEqual((await call('graph_read')).positions, current.positions); cases.push('remote-change-invalidates-preview');
    await preview('RIGHT');
    const beforeRace = await call('graph_read'); let raced = false;
    const raceDone = Promise.withResolvers();
    const intercept = async request => {
      const post = request.method() === 'POST' && request.url().endsWith('/api/agent/v1') ? JSON.parse(request.postData()) : null;
      if (!raced && post?.tool === 'graph_layout') {
        raced = true;
        try { await call('graph_edit', { baseRevision: beforeRace.revision, node: { ...beforeRace.nodes.find(n => n.id === 'b'), detail: 'Changed between preview and save' } }); await request.continue(); raceDone.resolve(); }
        catch (error) { await request.abort(); raceDone.reject(error); }
      } else await request.continue();
    };
    await page.setRequestInterception(true); page.on('request', intercept);
    try {
      await page.click('#apply-layout'); await raceDone.promise;
      await page.waitForFunction(() => document.getElementById('notice').textContent.includes('REVISION_CONFLICT') && document.getElementById('layout-status').dataset.state === 'idle');
    } finally { page.off('request', intercept); await page.setRequestInterception(false); }
    assert.equal(raced, true); assert.deepEqual((await call('graph_read')).positions, beforeRace.positions); cases.push('save-race-rejected-without-overwrite');
    await preview('RIGHT'); const arranged = await apply();
    await page.click('#fit');
    const p = await page.$eval('[data-node-id="a"]', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const saved = page.waitForResponse(response => response.url().endsWith('/api/agent/v1') && response.request().method() === 'POST' && JSON.parse(response.request().postData()).tool === 'graph_layout' && response.status() === 200);
    await page.mouse.move(p.x,p.y); await page.mouse.down(); await page.mouse.move(p.x+28,p.y+22,{steps:8}); await page.mouse.up(); await saved;
    await page.waitForFunction(() => document.querySelectorAll('.graph-edge.routed').length === 0);
    const moved = await call('graph_read');
    assert.deepEqual(moved.routes, {}); assert.notDeepEqual(moved.positions.a, arranged.positions.a);
    assert.equal(moved.revision, arranged.revision); cases.push('manual-move-invalidates-routing');
    assert.ok(workerUrls.some(url => url === `${baseUrl}/vendor/elk-worker.js`), 'Actual same-origin Worker must have run');
    assert.equal(page.workers().length, 0, 'Completed layout Workers must be released');
    return { sessionId, cases, workerUrls, finalRevision: moved.revision };
  } finally { page.off('workercreated', onWorker); }
}
