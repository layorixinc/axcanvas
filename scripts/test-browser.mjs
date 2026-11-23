import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import puppeteer from 'puppeteer';
import { startServer } from '../src/server.ts';
import { verifyLayoutWorkflow } from '../tests/layout.browser.mjs';
import { verifyCanvasSelection } from '../tests/canvas.browser.mjs';
import { verifyConnectionFocus } from '../tests/focus.browser.mjs';
import { verifyMiddleButtonPan } from '../tests/canvas-pan.browser.mjs';
import { verifyFitCenter } from '../tests/fit.browser.mjs';
import { verifyMinimap } from '../tests/minimap.browser.mjs';
import { verifyEnglishDefaults } from '../tests/english.browser.mjs';

const dir = await mkdtemp(join(tmpdir(), 'axcanvas-browser-'));
const resultsDir = resolve('test-results');
let app, browser, page;
try {
  app = await startServer({ port: 0, host: '127.0.0.1', dbPath: join(dir, 'graph.sqlite') });
  browser = await puppeteer.launch({ headless: true, args: process.env.AXCANVAS_BROWSER_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const english = await verifyEnglishDefaults(page, app.url);
  await mkdir(resultsDir, { recursive: true });
  await page.screenshot({ path: join(resultsDir, 'english-default.png'), fullPage: true });
  const layout = await verifyLayoutWorkflow(page, app.url);
  await page.reload(); await page.waitForSelector('.graph-node');
  const selection = await verifyCanvasSelection(page);
  const focus = await verifyConnectionFocus(page);
  const pan = await verifyMiddleButtonPan(page);
  const fit = await verifyFitCenter(page);
  const minimap = await verifyMinimap(page);

  const call = async (tool, args = {}, actor = 'user') => {
    const response = await fetch(`${app.url}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId: layout.sessionId, tool, arguments: args, actor }) });
    const reply = await response.json();
    assert.equal(response.status, 200, JSON.stringify(reply)); return reply.result;
  };
  await page.click('[data-node-id="a"]');
  const detail = `${await page.$eval('#node-detail', e => e.value)}\nBrowser edit: keep stable IDs.`;
  await page.click('#node-detail');
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.down(modifier); await page.keyboard.press('KeyA'); await page.keyboard.up(modifier);
  await page.keyboard.type(detail);
  const saved = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === 'graph_edit');
  await page.click('#save'); assert.equal((await saved).status(), 200);
  assert.equal((await call('graph_read')).nodes.find(n => n.id === 'a').detail, detail);

  await page.click('#pen');
  const start = await page.$eval('[data-node-id="b"]', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 25, start.y + 18, { steps: 5 }); await page.mouse.up();
  await page.type('#feedback-note', 'Please preserve stable node IDs.');
  const sent = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === 'feedback_submit');
  await page.click('#send-feedback'); assert.equal((await sent).status(), 200);
  const pending = await call('feedback_read');
  const feedback = pending.feedback.find(f => f.note === 'Please preserve stable node IDs.');
  assert.ok(feedback && feedback.strokes.length > 0, 'Actual pointer drawing must reach the feedback queue');
  const image = await fetch(feedback.imageUrl); assert.equal(image.status, 200); assert.match(await image.text(), /polyline/);
  const graph = await call('graph_read');
  const result = await call('graph_commit', { baseRevision: graph.revision, answerId: 'browser-feedback', nodes: [{ ...graph.nodes.find(n => n.id === 'b'), detail: 'Browser fixture feedback applied; IDs preserved.' }], edges: [], feedbackIds: [feedback.id] }, 'agent');
  assert.deepEqual((await call('feedback_read')).feedback, []);
  await page.waitForFunction(revision => document.getElementById('revision').textContent === `rev ${revision}`, {}, result.revision);
  await page.click('#fit');
  assert.deepEqual(pageErrors, [], 'Browser must not emit uncaught JavaScript errors');
  await mkdir(resultsDir, { recursive: true });
  await page.screenshot({ path: join(resultsDir, 'browser.png'), fullPage: true });
  console.log(JSON.stringify({ english, layout, selection, focus, pan, fit, minimap, editAndDrawingFeedback: 'passed' }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    await mkdir(resultsDir, { recursive: true });
    await page.screenshot({ path: join(resultsDir, 'browser-failure.png'), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  try { if (browser) await browser.close(); }
  finally { try { if (app) await app.close(); } finally { await rm(dir, { recursive: true, force: true }); } }
}
