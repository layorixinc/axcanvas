import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openMenu, showPanel, beginConnection, blankPoint, fillInput, draftResponse, result, idle, chord } from './workspace-helpers.mjs';

export async function verifyCompactWorkspace(page, baseUrl) {
  const sessionId = `workspace-${randomUUID()}`, cases = [], modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const call = async (tool, args = {}) => {
    const r = await fetch(`${baseUrl}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId, tool, arguments: args, actor: 'user' }) });
    const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return b.result;
  };
  const readDraft = async () => call('draft_read', { draftId: await page.evaluate(id => localStorage.getItem(`axcanvas-draft:${id}`), sessionId) });
  async function action(selector, tool = 'draft_change') {
    const wait = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === tool);
    await page.click(selector); const d = await result(await wait); await idle(page); return d;
  }
  async function shortcut(key, tool = 'draft_change') {
    const wait = page.waitForResponse(r => r.url().endsWith('/api/agent/v1') && r.request().method() === 'POST' && JSON.parse(r.request().postData()).tool === tool);
    await chord(page,modifier,key);const d=await result(await wait);await idle(page);return d;
  }
  async function selectMany(ids) {
    await page.click('#tool-select'); await page.click(`#nodes [data-node-id="${ids[0]}"]`);
    await page.keyboard.down('Shift');try{for(const id of ids.slice(1))await page.click(`#nodes [data-node-id="${id}"]`);}finally{await page.keyboard.up('Shift');}
    assert.equal(await page.$$eval('#nodes .graph-node.selected', all => all.length), ids.length);
  }
  await call('session_open', { title: 'Compact Office-style editing' });
  const node = (id, label) => ({ id, kind: 'concept', label, detail: 'Original content', status: 'confirmed', sources: [] });
  await call('graph_commit', { baseRevision: 0, answerId: 'seed', nodes: [node('a','Alpha'),node('b','Beta'),node('c','Gamma')], edges: [{id:'ab',source:'a',target:'b',relation:'supports',status:'active'}], flows:[{id:'topic',scope:'custom',label:'Topic',nodeIds:['a','b','c'],edgeIds:['ab'],startNodeIds:['a'],endNodeIds:['c']}] });
  await call('graph_layout',{baseRevision:1,baseLayoutRevision:0,mode:'move',positions:{a:{x:100,y:100},b:{x:600,y:100},c:{x:1100,y:100}}});
  const canonical=await call('graph_read');
  await page.setViewport({ width: 1365, height: 768, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/#${sessionId}`); await page.waitForSelector('#nodes [data-node-id="a"]');
  const geometry = await page.evaluate(() => ({ canvasHeight: document.querySelector('.canvas-wrap').getBoundingClientRect().height, overflow: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth }));
  assert.ok(geometry.canvasHeight >= 620, `Desktop canvas must reclaim editing space, got ${geometry.canvasHeight}px`);
  assert.equal(geometry.overflow, false); assert.ok(await page.$('#toolbox[role="toolbar"]'));
  const width=await page.$eval('.canvas-wrap',e=>e.getBoundingClientRect().width);
  await page.click('#inspector-toggle');assert.ok(await page.$eval('.canvas-wrap',e=>e.getBoundingClientRect().width)>width+250);await page.click('#inspector-toggle');
  cases.push('compact-desktop-and-collapsible-context');

  await page.select('#flow-selector','topic');await page.click('#fit');await page.click('#add-node');await page.select('#placement-kind','task');const placement=await blankPoint(page);await page.mouse.click(placement.x,placement.y);await showPanel(page);await fillInput(page,'#node-label','Created by placement');let d=await action('#save');
  const created=d.graph.nodes.find(n=>n.label==='Created by placement');assert.ok(created);assert.equal(created.kind,'task');assert.ok(d.graph.flows[0].nodeIds.includes(created.id));assert.equal(d.graph.positions[created.id],undefined);
  assert.equal(await page.$eval('#tool-select',e=>e.getAttribute('aria-pressed')),'true');
  await page.click('#fit');await beginConnection(page,'a',created.id);await fillInput(page,'#edge-relation','Direct connector');d=await action('#edge-save');assert.ok(d.graph.edges.some(e=>e.source==='a'&&e.target===created.id&&e.relation==='Direct connector'));
  const beforeCancel=d;await page.click('#connect-nodes');await page.click('#nodes [data-node-id="a"]');await page.keyboard.press('Escape');assert.deepEqual((await readDraft()).graph,beforeCancel.graph);
  cases.push('node-placement-direct-connection-and-cancellation');
  await page.click('#tool-select');await page.click('#nodes [data-node-id="a"]');
  const handle=await page.$eval('#nodes [data-node-id="a"] .connector-handle',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
  const target=await page.$eval('#nodes [data-node-id="b"]',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:8});await page.mouse.up();await page.waitForSelector('#edge-editor:not([hidden])');await fillInput(page,'#edge-relation','Dragged parallel edge');d=await action('#edge-save');assert.equal(d.graph.edges.filter(e=>e.source==='a'&&e.target==='b').length,2);
  await beginConnection(page,'a','a');await fillInput(page,'#edge-relation','Self relation');d=await action('#edge-save');assert.ok(d.graph.edges.some(e=>e.source==='a'&&e.target==='a'));
  cases.push('drag-connectors-parallel-and-self-links');

  await page.click('#tool-select');await page.click('#nodes [data-node-id="a"]');await showPanel(page);
  let saved=draftResponse(page,args=>args.operation.type==='node'&&args.operation.node.label==='Autosaved Alpha');await fillInput(page,'#node-label','Autosaved Alpha');d=await result(await saved);await idle(page);
  saved=draftResponse(page,args=>args.operation.type==='node'&&args.operation.node.label==='Autosaved Alpha final');await page.type('#node-label',' final');d=await result(await saved);await idle(page);
  await page.click('#draft-undo');await page.waitForFunction(()=>document.getElementById('node-label').value==='Alpha');d=await readDraft();assert.equal(d.graph.nodes.find(n=>n.id==='a').label,'Alpha');
  await fillInput(page,'#node-label','');await page.click('#nodes [data-node-id="b"]');assert.equal(await page.$eval('#node-id',e=>e.textContent),'a');assert.equal(await page.$eval('#node-label',e=>e.value),'');
  await page.click('#cancel');await page.waitForFunction(()=>document.getElementById('node-label').value==='Alpha');
  cases.push('grouped-property-autosave-undo-and-invalid-input-retention');
  await page.click('#node-label');await page.keyboard.press('End');const cdp=await page.createCDPSession();
  const premature=page.waitForResponse(r=>r.url().endsWith('/api/agent/v1')&&r.request().method()==='POST'&&JSON.parse(r.request().postData()).tool==='draft_change',{timeout:1000}).then(()=>true,error=>{if(error.name==='TimeoutError')return false;throw error;});
  await cdp.send('Input.imeSetComposition',{text:'한',selectionStart:1,selectionEnd:1});assert.equal(await premature,false,'Composition must not be autosaved before commit');
  saved=draftResponse(page,args=>args.operation.type==='node'&&args.operation.node.label.endsWith('한'));await cdp.send('Input.insertText',{text:'한'});d=await result(await saved);await idle(page);await cdp.detach();assert.equal(d.graph.nodes.find(n=>n.id==='a').label,'Alpha한');
  let textUndoSteps=0;const onTextRequest=request=>{if(request.method()==='POST'&&request.url().endsWith('/api/agent/v1')&&JSON.parse(request.postData()).tool==='draft_step')textUndoSteps++;};page.on('request',onTextRequest);
  await page.type('#node-label',' native');await chord(page,modifier,'KeyZ');assert.equal(textUndoSteps,0);assert.ok(!(await page.$eval('#node-label',e=>e.value)).endsWith(' native'));page.off('request',onTextRequest);
  await page.click('#cancel');await action('#draft-undo','draft_step');await page.waitForFunction(()=>document.getElementById('node-label').value==='Alpha');cases.push('native-ime-commit-and-input-local-undo');

  await page.click('#inspector-toggle');await page.click('#fit');await page.click('#tool-select');const beforeMarquee=(await readDraft()).version;
  const box=await page.evaluate(()=>{const a=document.querySelector('#nodes [data-node-id="a"]').getBoundingClientRect(),b=document.querySelector('#nodes [data-node-id="b"]').getBoundingClientRect(),tools=document.getElementById('toolbox').getBoundingClientRect();return{x:Math.min(a.left,b.left)-8,y:Math.max(a.bottom,b.bottom,tools.bottom)+8,right:Math.max(a.right,b.right)+8,top:Math.min(a.top,b.top)-8};});
  await page.mouse.move(box.x,box.y);await page.mouse.down();await page.mouse.move(box.right,box.top,{steps:8});await page.mouse.up();assert.equal(await page.$$eval('#nodes .graph-node.selected',nodes=>nodes.length),2);assert.equal((await readDraft()).version,beforeMarquee);await showPanel(page);cases.push('marquee-selection-is-view-only');

  await selectMany(['a','b']);const beforeMove=(await readDraft()).graph.flowLayouts.topic?.positions ?? canonical.positions;
  const p=await page.$eval('#nodes [data-node-id="a"]',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
  assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.closest('[data-node-id]')?.dataset.nodeId,p),'a','The real drag pointer must hit Alpha');
  const beforeTransform=await page.$eval('#nodes [data-node-id="a"]',e=>e.getAttribute('transform'));
  let wait=draftResponse(page,args=>args.operation.type==='batch');await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+30,p.y+24,{steps:6});
  const dragState=await page.evaluate(()=>({transform:document.querySelector('#nodes [data-node-id="a"]').getAttribute('transform'),notice:document.getElementById('notice').textContent,focus:document.activeElement?.id,tool:document.getElementById('workspace-main').dataset.tool}));
  assert.notEqual(dragState.transform,beforeTransform,JSON.stringify(dragState));await page.mouse.up();d=await result(await wait);await idle(page);
  const moved=d.graph.flowLayouts.topic.positions;assert.notDeepEqual(moved.a,beforeMove.a);assert.notDeepEqual(moved.b,beforeMove.b);assert.deepEqual(d.graph.positions,canonical.positions);
  d=await action('#draft-undo','draft_step');assert.deepEqual(d.graph.flowLayouts.topic?.positions.a??canonical.positions.a,beforeMove.a);
  await selectMany(['a','b']);wait=draftResponse(page,args=>args.operation.type==='batch');await page.keyboard.press('ArrowRight');d=await result(await wait);await idle(page);assert.equal(d.graph.flowLayouts.topic.positions.a.x,beforeMove.a.x+1);
  wait=draftResponse(page,args=>args.operation.type==='batch');await chord(page,'Shift','ArrowDown');d=await result(await wait);await idle(page);assert.equal(d.graph.flowLayouts.topic.positions.a.y,beforeMove.a.y+10);
  await openMenu(page,'arrange');d=await action('#align-left');assert.equal(d.graph.flowLayouts.topic.positions.a.x,d.graph.flowLayouts.topic.positions.b.x);
  d=await action('#draft-undo','draft_step');
  await selectMany(['a','b','c']);await openMenu(page,'arrange');d=await action('#distribute-horizontal');const xs=['a','b','c'].map(id=>d.graph.flowLayouts.topic.positions[id].x).sort((a,b)=>a-b);assert.ok(Math.abs((xs[1]-xs[0])-(xs[2]-xs[1]))<=1);
  await openMenu(page,'arrange');d=await action('#distribute-vertical');const ys=['a','b','c'].map(id=>d.graph.flowLayouts.topic.positions[id].y).sort((a,b)=>a-b);assert.ok(ys[2]>ys[0]);assert.ok(Math.abs((ys[1]-ys[0])-(ys[2]-ys[1]))<=1);
  await openMenu(page,'arrange');d=await action('#align-top');assert.equal(new Set(['a','b','c'].map(id=>d.graph.flowLayouts.topic.positions[id].y)).size,1);
  cases.push('atomic-multi-selection-drag-nudge-align-and-distribute');

  const originalIds=new Set(d.graph.nodes.map(n=>n.id)),edgeCount=d.graph.edges.length,internalEdges=d.graph.edges.filter(e=>['a','b','c'].includes(e.source)&&['a','b','c'].includes(e.target)).length;
  await selectMany(['a','b','c']);await chord(page,modifier,'KeyC');d=await shortcut('KeyV');const copies=d.graph.nodes.filter(n=>!originalIds.has(n.id));assert.equal(copies.length,3);assert.equal(d.graph.edges.length,edgeCount+internalEdges);assert.ok(copies.every(n=>d.graph.flows[0].nodeIds.includes(n.id)&&!d.graph.flows[0].startNodeIds.includes(n.id)&&!d.graph.flows[0].endNodeIds.includes(n.id)));
  d=await action('#draft-undo','draft_step');assert.equal(d.graph.nodes.length,originalIds.size);await selectMany(['a','b']);d=await shortcut('KeyD');assert.equal(d.graph.nodes.length,originalIds.size+2);d=await action('#draft-undo','draft_step');assert.equal(d.graph.nodes.length,originalIds.size);
  cases.push('copy-paste-duplicate-new-identities-and-one-step-undo');

  await page.click('#tool-select');const blank=await blankPoint(page);await page.mouse.click(blank.x,blank.y);
  await page.click('#pen');wait=draftResponse(page,args=>args.operation.type==='instruction'&&args.operation.strokes.length===1);const draw=await blankPoint(page);await page.mouse.move(draw.x,draw.y);await page.mouse.down();await page.mouse.move(draw.x+35,draw.y+20,{steps:6});await page.mouse.up();d=await result(await wait);await idle(page);assert.equal(d.captureFlowId,'topic');
  const inkPoint=await page.$eval('#ink polyline',e=>{const p=e.points.getItem(Math.floor(e.points.numberOfItems/2));const point=new DOMPoint(p.x,p.y).matrixTransform(e.getScreenCTM());return{x:point.x,y:point.y};});
  await page.click('#tool-erase');wait=draftResponse(page,args=>args.operation.type==='instruction'&&args.operation.strokes.length===0);await page.mouse.click(inkPoint.x,inkPoint.y);d=await result(await wait);await idle(page);assert.equal(d.strokes.length,0);assert.equal(d.graph.nodes.length,originalIds.size);
  d=await action('#draft-undo','draft_step');assert.equal(d.strokes.length,1);d=await action('#draft-redo','draft_step');assert.equal(d.strokes.length,0);
  cases.push('annotation-only-erase-and-durable-undo');

  await page.click('#tool-select');const panPoint=await blankPoint(page);await page.mouse.click(panPoint.x,panPoint.y);const camera=await page.$eval('#canvas',e=>e.getAttribute('viewBox'));await page.keyboard.down('Space');await page.mouse.move(panPoint.x,panPoint.y);await page.mouse.down();await page.mouse.move(panPoint.x+30,panPoint.y+20,{steps:5});await page.mouse.up();await page.keyboard.up('Space');assert.notEqual(await page.$eval('#canvas',e=>e.getAttribute('viewBox')),camera);assert.equal(await page.$eval('#tool-select',e=>e.getAttribute('aria-pressed')),'true');cases.push('temporary-hand-restores-previous-tool');
  await showPanel(page,'agent');await fillInput(page,'#feedback-note','Review all compact workspace edits as one packet.');await page.click('#send-feedback');await page.waitForSelector('#review-dialog[open]');assert.deepEqual(await call('graph_read'),canonical);
  const pending=fetch(`${baseUrl}/api/submissions/wait?sessionId=${sessionId}&timeoutMs=25000`).then(r=>r.json());const packet=await action('#review-submit','draft_submit'),delivery=await pending;assert.equal(delivery.feedback.id,packet.id);assert.ok(packet.review.changes.some(c=>c.entity==='node'));assert.ok(packet.review.changes.some(c=>c.entity==='flow_layout'));assert.equal((await call('feedback_read')).feedback.length,1);
  cases.push('single-complete-review-and-final-notification');

  await page.click('#fit');for(const viewport of [{width:1600,height:1050},{width:800,height:844},{width:390,height:844}]){await page.setViewport({...viewport,deviceScaleFactor:1});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight));for(const selector of ['#flow-selector','#send-feedback','#toolbox'])assert.ok(await page.$eval(selector,e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth;}),`${selector} reachable at ${viewport.width}`);}
  await page.setViewport({width:1365,height:768,deviceScaleFactor:1});await page.click('#fit');cases.push('desktop-medium-and-touch-layouts');
  return {sessionId,cases,geometry,submissionId:packet.id,watcherCursor:delivery.cursor};
}
