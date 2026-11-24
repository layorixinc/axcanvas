import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fillInput, showPanel } from './workspace-helpers.mjs';

export async function verifyGraphSearch(page, baseUrl) {
  const sessionId = `search-${randomUUID()}`, cases = [], mutations = [];
  async function call(tool, args = {}) {
    const response = await fetch(`${baseUrl}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId, tool, arguments: args, actor: 'user' }) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body.result;
  }
  const node = (id, label, detail = '') => ({ id, label, detail, kind: 'concept', status: 'confirmed', sources: [] });
  await call('session_open', { title: 'Search verification' });
  await call('graph_commit', { baseRevision: 0, answerId: 'search-seed', nodes: [
    node('api', 'API gateway', 'Routes credentials to the server'),
    { ...node('db', 'Database', 'Durable WAL storage'), kind: 'decision', sources: [{ kind: 'url', ref: 'https://example.test/storage-design.md' }] },
    node('ko', '한글 검색', 'Unicode normalization'), node('unsafe', '<img src=x onerror=alert(1)>', 'Literal markup'),
    { ...node('retired', 'Retired secret'), status: 'retired' },
  ], edges: [{ id: 'e', source: 'api', target: 'db', relation: 'persists transactions', status: 'active' }], flows: [{ id: 'gateway', scope: 'custom', label: 'Gateway only', nodeIds: ['api'], edgeIds: [], startNodeIds: ['api'], endNodeIds: ['api'] }] });
  await call('graph_layout', { baseRevision: 1, baseLayoutRevision: 0, mode: 'replace', positions: { api: { x: -500, y: 0 }, db: { x: 4000, y: 2000 }, ko: { x: 500, y: 0 }, unsafe: { x: 1000, y: 200 } }, routes: {} });
  await page.setViewport({ width: 1365, height: 768, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/#${sessionId}`); await page.waitForSelector('#nodes [data-node-id="api"]');
  assert.ok(await page.$('#graph-search-toggle'), 'Graph search must be available from the document row');
  const draftId = await page.evaluate(id => localStorage.getItem(`axcanvas-draft:${id}`), sessionId);
  const before = { graph: await call('graph_read'), draft: await call('draft_read', { draftId }) };
  const requests = r => { if (r.method() === 'POST' && r.url().endsWith('/api/agent/v1')) { const body = JSON.parse(r.postData()); if (!['graph_read', 'draft_read', 'feedback_read', 'draft_review'].includes(body.tool)) mutations.push(body.tool); } };
  page.on('request', requests);
  const query = async value => { await fillInput(page, '#graph-search-input', value); };
  const ids = () => page.$$eval('#graph-search-results button', all => all.map(e => e.dataset.nodeId));
  const camera = () => page.$eval('#canvas', e => e.getAttribute('viewBox').split(' ').map(Number));
  try {
    await page.click('#graph-search-toggle'); await query('Database'); assert.deepEqual(await ids(), ['db']);
    assert.equal(await page.$$eval('#nodes .search-match', all => all.length), 1);
    await query('credentials'); assert.deepEqual(await ids(), ['api']);
    await query('storage-design'); assert.deepEqual(await ids(), ['db']);
    await query('transactions'); assert.deepEqual(new Set(await ids()), new Set(['api', 'db']));
    await page.select('#graph-search-kind', 'decision'); assert.deepEqual(await ids(), ['db']); await page.select('#graph-search-kind', '');
    await query('한글'); assert.deepEqual(await ids(), ['ko']);
    await query(''); const cdp = await page.createCDPSession();
    await cdp.send('Input.imeSetComposition', { text: '한글', selectionStart: 2, selectionEnd: 2 }); assert.deepEqual(await ids(), []);
    await cdp.send('Input.insertText', { text: '한글' }); await cdp.detach(); assert.deepEqual(await ids(), ['ko']);
    await query('missing-xyz'); assert.match(await page.$eval('#graph-search-count', e => e.textContent), /No matches/);
    await query('<img'); assert.deepEqual(await ids(), ['unsafe']); assert.equal(await page.$$eval('#graph-search-results img', all => all.length), 0);
    await query('Retired secret'); assert.deepEqual(await ids(), []);
    await query(''); assert.deepEqual(await ids(), []); assert.equal(await page.$$eval('#nodes .search-match', all => all.length), 0);
    cases.push('multi-field-unicode-kind-empty-and-safe-text');
    await query('Database'); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'graph-search-toggle');
    await page.click('#nodes [data-node-id="api"]'); await page.click('#tool-hand'); await page.click('#zoom-in'); const c = await camera();
    await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control'); await page.keyboard.press('KeyK'); await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'graph-search-input');
    await query('Database'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForSelector('#graph-search-panel[hidden]');
    assert.equal(await page.$eval('#node-id', e => e.textContent), 'db'); assert.deepEqual((await camera()).slice(2), c.slice(2));
    assert.equal(await page.$eval('#tool-hand', e => e.getAttribute('aria-pressed')), 'true');
    const delta = await page.evaluate(() => { const c = document.getElementById('canvas').getBoundingClientRect(), t = document.getElementById('toolbox').getBoundingClientRect(), n = document.querySelector('#nodes [data-node-id="db"] .body').getBoundingClientRect(); return { x: (n.left + n.right - Math.max(c.left, t.right + 8) - c.right) / 2, y: (n.top + n.bottom - c.top - c.bottom) / 2 }; });
    assert.ok(Math.abs(delta.x) <= 2 && Math.abs(delta.y) <= 2, JSON.stringify(delta));
    cases.push('keyboard-selection-offscreen-center-and-tool-preservation');
    await page.select('#flow-selector', 'gateway'); await page.click('#graph-search-toggle'); await query('Database'); assert.deepEqual(await ids(), []);
    await page.select('#graph-search-range', 'all'); assert.deepEqual(await ids(), ['db']); assert.match(await page.$eval('#graph-search-results', e => e.textContent), /Outside scope/);
    await page.click('#graph-search-results button'); await page.waitForSelector('#graph-search-panel[hidden]'); assert.equal(await page.$eval('#flow-selector', e => e.value), ''); assert.equal(await page.$eval('#node-id', e => e.textContent), 'db');
    cases.push('explicit-whole-graph-discovery-and-scope-navigation');
    await page.click('#graph-search-toggle'); await query('Database');
    for (const width of [800, 390]) { await page.setViewport({ width, height: 844, deviceScaleFactor: 1 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await query('credentials'); await page.click('#graph-search-results button'); await page.waitForSelector('#graph-search-panel[hidden]'); assert.equal(await page.$eval('#node-id', e => e.textContent), 'api'); await page.click('#graph-search-toggle'); }
    cases.push('narrow-and-medium-pointer-reachability');
    await page.setViewport({ width: 1365, height: 768, deviceScaleFactor: 1 }); await page.keyboard.press('Escape');
    assert.deepEqual({ graph: await call('graph_read'), draft: await call('draft_read', { draftId }) }, before); assert.deepEqual(mutations, []);
    cases.push('no-canonical-draft-or-watcher-mutation');
    await page.click('#tool-select'); await showPanel(page); await fillInput(page, '#node-label', '');
    await page.click('#graph-search-toggle'); await query('Database'); assert.equal(await page.$eval('#graph-search-results button', e => e.disabled), true); assert.match(await page.$eval('#graph-search-warning', e => e.textContent), /Save or discard/);
    await page.keyboard.press('Escape'); assert.equal(await page.$eval('#node-label', e => e.value), ''); await page.click('#cancel'); assert.deepEqual(await call('draft_read', { draftId }), before.draft);
    cases.push('invalid-form-preserved-with-explicit-navigation-block');
    const current = await call('draft_read', { draftId });
    const captured = await call('draft_change', { draftId, baseDraftVersion: current.version, operation: { type: 'instruction', flowId: 'gateway', note: 'Keep this frame', nodeIds: ['api'], strokes: [{ points: [{ x: -450, y: 50 }, { x: -420, y: 80 }] }] } });
    page.off('request', requests);
    try { await page.reload(); await page.waitForSelector('#nodes [data-node-id="api"]'); } finally { page.on('request', requests); }
    await page.click('#graph-search-toggle'); await query('Database'); await page.select('#graph-search-range', 'all'); await page.click('#graph-search-results button');
    await page.waitForFunction(() => document.getElementById('graph-search-warning').textContent.includes('captured drawing'));
    assert.equal(await page.$eval('#flow-selector', e => e.value), 'gateway'); assert.deepEqual(await call('draft_read', { draftId }), captured); assert.deepEqual(mutations, []);
    cases.push('captured-drawing-prevents-cross-scope-navigation');
    await call('draft_change', { draftId, baseDraftVersion: captured.version, operation: { type: 'instruction', flowId: 'gateway', note: '', nodeIds: [], strokes: [] } });
    page.off('request', requests);
    try { await page.reload(); await page.waitForSelector('#nodes [data-node-id="api"]'); } finally { page.on('request', requests); }
    await page.click('#graph-search-toggle'); await query('Database');
    return { sessionId, cases, mutationRequests: mutations.length, delta };
  } finally { page.off('request', requests); }
}
