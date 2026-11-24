import assert from 'node:assert/strict';

export async function openMenu(page, name) {
  const toggle = `#${name}-toggle`;
  if (await page.$eval(toggle, e => e.getAttribute('aria-expanded') !== 'true')) await page.click(toggle);
}
export async function showPanel(page, name = 'properties') {
  const toggle = '#inspector-toggle';
  if (await page.$eval(toggle, e => e.getAttribute('aria-expanded') !== 'true')) await page.click(toggle);
  await page.click(`#tab-${name}`);
}
export async function blankPoint(page) {
  return page.evaluate(() => {
    const r = document.getElementById('canvas').getBoundingClientRect();
    for (const fy of [.7,.4,.85,.2,.55]) for (const fx of [.5,.7,.3,.85,.15]) {
      const x=r.x+r.width*fx,y=r.y+r.height*fy,e=document.elementFromPoint(x,y);
      if (e?.closest('#canvas') && !e.closest('.graph-node,.graph-edge')) return {x,y};
    }
    throw new Error('No uncovered blank canvas point for actual pointer interaction');
  });
}
export async function beginNode(page) {
  await page.click('#add-node'); const p=await blankPoint(page);await page.mouse.click(p.x,p.y);
  await page.waitForSelector('#editor:not([hidden])');await showPanel(page);
}
export async function beginConnection(page, source, target) {
  await page.click('#connect-nodes');await page.click(`#nodes [data-node-id="${source}"]`);await page.click(`#nodes [data-node-id="${target}"]`);
  await page.waitForSelector('#edge-editor:not([hidden])');await showPanel(page);
}
export async function fillInput(page, selector, value) {
  await page.click(selector);await page.keyboard.down(process.platform==='darwin'?'Meta':'Control');await page.keyboard.press('KeyA');await page.keyboard.up(process.platform==='darwin'?'Meta':'Control');await page.keyboard.press('Backspace');if(value)await page.type(selector,value);
}
export function draftResponse(page, predicate = () => true) {
  const origin = new Error('Draft response requested here').stack;
  return page.waitForResponse(r => {
    if (!r.url().endsWith('/api/agent/v1') || r.request().method() !== 'POST') return false;
    const body=JSON.parse(r.request().postData());return body.tool==='draft_change' && predicate(body.arguments,r);
  }).catch(error => { error.stack += `\n${origin}`; throw error; });
}
export async function result(response) { const b=await response.json();assert.equal(response.status(),200,JSON.stringify(b));return b.result; }
export async function idle(page) { await page.waitForFunction(()=>!document.getElementById('send-feedback').disabled && !document.getElementById('feedback-note').disabled); }
export async function chord(page, modifier, key) {
  await page.keyboard.down(modifier);
  try { await page.keyboard.press(key); } finally { await page.keyboard.up(modifier); }
}
