import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openMenu, draftResponse, result, idle } from './workspace-helpers.mjs';

// Minimap navigation is view-only; the explicit layout exercise saves only to the draft.
export async function verifyMinimap(page) {
  await page.waitForSelector('.graph-node');
  assert.ok(await page.$('#minimap'), 'A navigable minimap must be present');
  const where = await page.evaluate(() => ({ origin: location.origin, sessionId: decodeURIComponent(location.hash.slice(1)) }));
  async function stored() {
    const r = await fetch(`${where.origin}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId: where.sessionId, tool: 'graph_read', arguments: {} }) });
    assert.equal(r.status, 200); return (await r.json()).result;
  }
  async function state() {
    return page.evaluate(() => {
      const v = document.getElementById('canvas').viewBox.baseVal;
      const r = document.getElementById('minimap-viewport');
      return { camera: { x: v.x, y: v.y, w: v.width, h: v.height }, viewport: { x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') } };
    });
  }
  const original = await stored(), originalViewport = page.viewport(), cases = [];
  try {
    await page.click('#fit');
    assert.equal(await page.$$eval('#minimap-nodes rect', e => e.length), await page.$$eval('.graph-node', e => e.length));
    const beforeZoom = await state(); await page.click('#zoom-in'); const zoomed = await state();
    assert.ok(zoomed.viewport.w < beforeZoom.viewport.w && zoomed.viewport.h < beforeZoom.viewport.h); cases.push('graph-and-zoom-sync');
    const expected = await page.$eval('#minimap-nodes rect', e => ({ x: +e.getAttribute('x') + +e.getAttribute('width') / 2, y: +e.getAttribute('y') + +e.getAttribute('height') / 2 }));
    await page.click('#minimap-nodes rect'); const clicked = await state();
    assert.ok(Math.abs(clicked.camera.x + clicked.camera.w / 2 - expected.x) < .01);
    assert.ok(Math.abs(clicked.camera.y + clicked.camera.h / 2 - expected.y) < .01); cases.push('click-to-center');
    const box = await page.$eval('#minimap-viewport', e => { const r = e.getBoundingClientRect(), inverse = document.getElementById('minimap').getScreenCTM().inverse(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, scaleX: inverse.a, scaleY: inverse.d }; });
    await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + 14, box.y + 9, { steps: 6 }); await page.mouse.up();
    const dragged = await state();
    assert.ok(Math.abs(dragged.camera.x - clicked.camera.x - 14 * box.scaleX) < .05, 'Drag must keep its initial map transform instead of accelerating as map bounds change');
    assert.ok(Math.abs(dragged.camera.y - clicked.camera.y - 9 * box.scaleY) < .05); cases.push('drag-viewport');
    const main = await page.$eval('#canvas', e => { const r = e.getBoundingClientRect(); return { x: r.right - 35, y: r.top + 35 }; });
    await page.mouse.move(main.x,main.y); await page.mouse.down({ button:'middle' }); await page.mouse.move(main.x+35,main.y+20,{steps:5}); await page.mouse.up({button:'middle'});
    const panned = await state(); assert.notEqual(panned.viewport.x,dragged.viewport.x); assert.notEqual(panned.viewport.y,dragged.viewport.y); cases.push('main-pan-sync');
    await page.focus('#minimap-toggle'); await page.keyboard.press('Tab'); await page.keyboard.press('ArrowRight'); const keyed = await state(); assert.ok(keyed.camera.x > panned.camera.x); await page.keyboard.press('Home'); cases.push('keyboard-navigation');
    await page.click('#minimap-toggle'); assert.equal(await page.$eval('#minimap',e=>e.hasAttribute('hidden')),true);
    await page.click('#minimap-toggle'); assert.equal(await page.$eval('#minimap',e=>e.hasAttribute('hidden')),false); cases.push('collapse-expand');
    await openMenu(page, 'arrange'); const arranged = draftResponse(page, args => args.operation.type === 'layout'); await page.click('#auto-layout'); await result(await arranged); await idle(page);
    const matching = await page.evaluate(() => {
      const node=document.querySelector('.graph-node'), id=node.getAttribute('data-node-id');
      const mini=[...document.querySelectorAll('#minimap-nodes rect')].find(e=>e.getAttribute('data-minimap-node')===id);
      const matrix=node.transform.baseVal.consolidate().matrix;
      return Math.abs(matrix.e-+mini.getAttribute('x'))<.01 && Math.abs(matrix.f-+mini.getAttribute('y'))<.01;
    });
    assert.equal(matching,true); await openMenu(page, 'arrange'); await page.click('#undo-layout'); await idle(page); cases.push('layout-save-undo-sync');
    await page.setViewport({ width:1100,height:800,deviceScaleFactor:1 });
    await page.waitForFunction(() => {
      const map=document.getElementById('minimap').getBoundingClientRect(),v=document.getElementById('minimap-viewport').getBoundingClientRect();
      return v.width>0&&v.height>0&&v.left>=map.left-1&&v.right<=map.right+1&&v.top>=map.top-1&&v.bottom<=map.bottom+1;
    }); cases.push('resize-viewport-bounds');
    assert.deepEqual(await stored(),original,'Minimap navigation and draft layout must not publish canonical changes');
    return {cases,graphUnchanged:true};
  } finally { await page.setViewport(originalViewport); await page.click('#fit'); }
}
