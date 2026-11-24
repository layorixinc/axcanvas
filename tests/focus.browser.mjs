import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openMenu, fillInput } from './workspace-helpers.mjs';

// Run on a loaded graph with at least one relation and one node outside the selected neighborhood.
export async function verifyConnectionFocus(page) {
  await page.waitForSelector('.graph-node');
  const where = await page.evaluate(() => ({ origin: location.origin, sessionId: decodeURIComponent(location.hash.slice(1)) }));
  async function stored() {
    const response = await fetch(`${where.origin}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId: where.sessionId, tool: 'graph_read', arguments: {} }) });
    assert.equal(response.status, 200); return (await response.json()).result;
  }
  const before = await stored();
  assert.equal(await page.$eval('#focus-relations', e => e.checked), false, 'Connection focus must start disabled');
  await page.click('.graph-node');
  assert.equal(await page.$$eval('.dimmed', e => e.length), 0, 'A normal click must show the whole graph');
  assert.equal(await page.$$eval('.graph-edge.focused', e => e.length), 0, 'Normal selection must not focus connections');
  await page.keyboard.down('Control');
  try { await page.click('.graph-node'); } finally { await page.keyboard.up('Control'); }
  assert.equal(await page.$eval('#focus-relations', e => e.checked), true);
  assert.ok(await page.$$eval('.graph-edge.focused', e => e.length) > 0);
  assert.ok(await page.$$eval('.dimmed', e => e.length) > 0);
  await openMenu(page, 'file');
  await fillInput(page, '#session-id', await page.evaluate(() => decodeURIComponent(location.hash.slice(1))));
  const refreshed = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === 'graph_read');
  await page.click('#open-session'); await refreshed;
  assert.equal(await page.$eval('#focus-relations', e => e.checked), true, 'Programmatic refresh must preserve focus');
  assert.ok(await page.$$eval('.dimmed', e => e.length) > 0);
  await page.click('.graph-node');
  assert.equal(await page.$eval('#focus-relations', e => e.checked), false);
  assert.equal(await page.$$eval('.dimmed', e => e.length), 0);
  assert.equal(await page.$$eval('.graph-edge.focused', e => e.length), 0);
  assert.deepEqual(await stored(), before, 'Focus interaction must not change stored graph or layout');
  return { defaultOff: true, normalClick: true, ctrlClick: true, refreshPreserved: true, normalClickClears: true, graphUnchanged: true };
}
