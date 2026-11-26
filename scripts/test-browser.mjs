import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer';
import { startServer } from '../src/server.ts';
import { verifyLayoutWorkflow } from '../tests/layout.browser.mjs';
import { verifyCanvasSelection } from '../tests/canvas.browser.mjs';
import { verifyConnectionFocus } from '../tests/focus.browser.mjs';
import { verifyMiddleButtonPan } from '../tests/canvas-pan.browser.mjs';
import { verifyFitCenter } from '../tests/fit.browser.mjs';
import { verifyMinimap } from '../tests/minimap.browser.mjs';
import { verifyEnglishDefaults } from '../tests/english.browser.mjs';
import { verifyReviewedAuthoring } from '../tests/review.browser.mjs';
import { verifyScopedFlows } from '../tests/flows.browser.mjs';
import { verifyCompactWorkspace } from '../tests/workspace.browser.mjs';
import { verifyCenterSelection } from '../tests/center-selection.browser.mjs';
import { verifyGraphSearch } from '../tests/search.browser.mjs';
import { verifyTagsAndNeighborhood } from '../tests/tags-neighborhood.browser.mjs';

const dir = await mkdtemp(join(tmpdir(), 'axcanvas-browser-'));
const resultsDir = resolve('test-results');
let app, browser, page;
try {
  app = await startServer({ port: 0, host: '127.0.0.1', dbPath: join(dir, 'graph.sqlite') });
  browser = await puppeteer.launch({ headless: true, args: process.env.AXCANVAS_BROWSER_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => { pageErrors.push(error.message); console.error('BROWSER_ERROR', error.stack ?? error); });
  const tagsNeighborhood = await verifyTagsAndNeighborhood(page, app.url);
  await mkdir(resultsDir, { recursive: true });
  await page.screenshot({ path: join(resultsDir, 'tags-neighborhood.png'), fullPage: true });
  const search = await verifyGraphSearch(page, app.url);
  await mkdir(resultsDir, { recursive: true });
  await page.screenshot({ path: join(resultsDir, 'graph-search.png'), fullPage: true });
  await page.click('#graph-search-close');
  const centering = await verifyCenterSelection(page, app.url);
  const workspace = await verifyCompactWorkspace(page, app.url);
  await mkdir(resultsDir, { recursive: true });
  await page.screenshot({ path: join(resultsDir, 'compact-workspace.png'), fullPage: true });
  const english = await verifyEnglishDefaults(page, app.url);
  await mkdir(resultsDir, { recursive: true });
  await page.screenshot({ path: join(resultsDir, 'english-default.png'), fullPage: true });
  const reviewed = await verifyReviewedAuthoring(page, app.url);
  await page.screenshot({ path: join(resultsDir, 'reviewed-authoring.png'), fullPage: true });
  const flows = await verifyScopedFlows(page, app.url);
  await page.screenshot({ path: join(resultsDir, 'scoped-flows.png'), fullPage: true });
  const layout = await verifyLayoutWorkflow(page, app.url);
  await page.reload(); await page.waitForSelector('.graph-node');
  const selection = await verifyCanvasSelection(page);
  const focus = await verifyConnectionFocus(page);
  const pan = await verifyMiddleButtonPan(page);
  const fit = await verifyFitCenter(page);
  const minimap = await verifyMinimap(page);

  await page.click('#fit');
  assert.deepEqual(pageErrors, [], 'Browser must not emit uncaught JavaScript errors');
  await mkdir(resultsDir, { recursive: true });
  await page.screenshot({ path: join(resultsDir, 'browser.png'), fullPage: true });
  console.log(JSON.stringify({ tagsNeighborhood, search, centering, workspace, english, reviewed, flows, layout, selection, focus, pan, fit, minimap }, null, 2));
} catch (error) {
  console.error(error.stack ?? error);
  if (page && !page.isClosed()) {
    await mkdir(resultsDir, { recursive: true });
    await page.screenshot({ path: join(resultsDir, 'browser-failure.png'), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  try { if (browser) await browser.close(); }
  finally { try { if (app) await app.close(); } finally { await rm(dir, { recursive: true, force: true }); } }
}
