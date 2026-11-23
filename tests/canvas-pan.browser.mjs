import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Called by scripts/test-browser.mjs on a real canvas session. No stored data is changed.
export async function verifyMiddleButtonPan(page) {
  await page.waitForSelector('.graph-node');
  const location = await page.evaluate(() => ({ origin: window.location.origin, sessionId: decodeURIComponent(window.location.hash.slice(1)) }));
  async function stored() {
    const response = await fetch(`${location.origin}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId: location.sessionId, tool: 'graph_read', arguments: {} }) });
    assert.equal(response.status, 200);
    const reply = await response.json();
    assert.equal(reply.isError, false);
    return reply.result;
  }
  async function state(target) {
    return page.evaluate(target => {
      const canvas = document.getElementById('canvas'), box = canvas.getBoundingClientRect();
      const node = document.querySelector('.graph-node'), rect = node.getBoundingClientRect();
      const pointer = target === 'node' ? [...document.querySelectorAll('.graph-node')].map(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }).find(p => document.elementFromPoint(p.x, p.y)?.closest('.graph-node')) : null;
      if (target === 'node' && !pointer) throw new Error('Pan regression needs a visible node not covered by canvas controls');
      return {
        view: [canvas.viewBox.baseVal.x, canvas.viewBox.baseVal.y, canvas.viewBox.baseVal.width, canvas.viewBox.baseVal.height],
        node: { x: rect.x, y: rect.y }, strokes: document.querySelectorAll('#ink polyline').length,
        selected: document.getElementById('node-id').textContent,
        start: target === 'node' ? pointer : { x: box.right - 45, y: box.top + 45 },
        outsideX: box.right + 35,
        panning: canvas.classList.contains('panning'), pen: document.getElementById('pen').getAttribute('aria-pressed')
      };
    }, target);
  }
  async function dragCase(name, target, outside = false) {
    const before = await state(target);
    const dx = outside ? before.outsideX - before.start.x : 44, dy = 31;
    await page.mouse.move(before.start.x, before.start.y);
    await page.mouse.down({ button: 'middle' });
    try { await page.mouse.move(before.start.x + dx, before.start.y + dy, { steps: 8 }); }
    finally { await page.mouse.up({ button: 'middle' }); }
    const after = await state();
    assert.ok(after.view[0] < before.view[0] && after.view[1] < before.view[1], `${name}: middle drag must pan the viewport`);
    assert.ok(Math.abs(after.node.x - before.node.x - dx) < 2, `${name}: graph must follow horizontal pointer distance`);
    assert.ok(Math.abs(after.node.y - before.node.y - dy) < 2, `${name}: graph must follow vertical pointer distance`);
    assert.equal(after.strokes, before.strokes, `${name}: pan must not create ink`);
    assert.equal(after.selected, before.selected, `${name}: pan must not select another node`);
    assert.equal(after.pen, before.pen, `${name}: pan must preserve drawing mode`);
    assert.equal(after.panning, false, `${name}: releasing the mouse must end pan`);
    return name;
  }
  const original = await stored();
  const originalPen = await page.$eval('#pen', e => e.getAttribute('aria-pressed'));
  const cases = [];
  try {
    if (originalPen === 'true') await page.click('#pen');
    await page.click('#fit');
    cases.push(await dragCase('background', 'background'));
    cases.push(await dragCase('over-node', 'node'));
    await page.click('#pen');
    cases.push(await dragCase('drawing-mode', 'node'));
    await page.click('#zoom-in');
    cases.push(await dragCase('zoomed', 'node'));
    cases.push(await dragCase('release-outside-canvas', 'node', true));
    const final = await stored();
    assert.deepEqual(final, original, 'Viewport-only panning must not change graph data, layout revision or positions');
    return { cases, persistedGraphUnchanged: true };
  } finally {
    if (await page.$eval('#pen', e => e.getAttribute('aria-pressed')) !== originalPen) await page.click('#pen');
    await page.click('#fit');
  }
}
