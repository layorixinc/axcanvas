import assert from 'node:assert/strict';

// Called by scripts/test-browser.mjs on a real page. No fake DOM or source-text assertions.
// Requires a real graph already visible. It never saves or changes the stored graph.
export async function verifyCanvasSelection(page) {
  await page.waitForSelector('.graph-node');
  const selector = '.graph-node';
  const id = await page.$eval(selector, e => e.getAttribute('data-node-id'));
  await page.click(selector);
  const visible = await page.$eval('#editor', e => !e.hidden);
  assert.equal(visible, true, 'A pointer click must open the node editor');
  assert.equal(await page.$eval('#node-id', e => e.textContent), id);
  const original = await page.$eval('#node-label', e => e.value);
  await page.click('#node-label');
  await page.keyboard.press('End');
  await page.keyboard.type(' browser-unsaved-check');
  await page.click(`[data-node-id="${id}"]`);
  assert.equal(await page.$eval('#node-label', e => e.value), `${original} browser-unsaved-check`, 'Selecting the same node must not discard unsaved input');
  await page.click('#cancel');
  await page.waitForFunction(expected => document.getElementById('node-label').value === expected, {}, original);
  return { selection: 'pass', unsavedInput: 'pass', restored: original };
}
