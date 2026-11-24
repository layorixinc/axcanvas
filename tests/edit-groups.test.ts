import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../src/server.ts';
const node = (id: string, label = id) => ({id,kind:'concept',label,detail:'Original',status:'confirmed',sources:[]});
async function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'axcanvas-group-')), path=join(dir,'g.sqlite'); let app=await startServer({port:0,dbPath:path});
  async function request(tool:string,args:object={},requestId:string=randomUUID()) { const r=await fetch(app.url+'/api/agent/v1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'groups',requestId,tool,arguments:args,actor:'user'})}); return {status:r.status,body:await r.json()}; }
  async function call(tool:string,args:object={}){const r=await request(tool,args);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.result;}
  await call('session_open',{title:'Grouped editing'});await call('graph_commit',{baseRevision:0,answerId:'seed',nodes:[node('a'),node('b'),node('c')],edges:[]});
  return {get app(){return app;},request,call,restart:async()=>{await app.close();app=await startServer({port:0,dbPath:path});},close:async()=>{await app.close();rmSync(dir,{recursive:true,force:true});}};
}
const version=(d:any)=>({draftId:d.id,baseDraftVersion:d.version});
test('atomic grouped movement has one durable undo and invalid batch rolls back all edits',async()=>{
 const f=await fixture();try{let d=await f.call('draft_open',{draftId:'batch'});const before=d.graph;
 d=await f.call('draft_change',{...version(d),operation:{type:'batch',operations:[{type:'move',nodeId:'a',position:{x:10,y:20}},{type:'move',nodeId:'b',position:{x:30,y:40}}]}});
 assert.equal(d.version,1);assert.equal(d.graph.positions.b.x,30);const moved=d;
 const bad=await f.request('draft_change',{...version(d),operation:{type:'batch',operations:[{type:'move',nodeId:'a',position:{x:999,y:999}},{type:'move',nodeId:'missing',position:{x:0,y:0}}]}});assert.equal(bad.status,422);assert.deepEqual(await f.call('draft_read',{draftId:d.id}),moved);
 await f.restart();d=await f.call('draft_step',{...version(d),direction:'undo'});assert.deepEqual(d.graph,before);d=await f.call('draft_step',{...version(d),direction:'redo'});assert.deepEqual(d.graph,moved.graph);assert.deepEqual((await f.call('graph_read')).positions,{});
 }finally{await f.close();}
});
test('continuous existing-object autosaves coalesce while versions remain monotonic',async()=>{
 const f=await fixture();try{let d=await f.call('draft_open',{draftId:'typing'});
 for(const label of ['A','Alpha','Alpha final'])d=await f.call('draft_change',{...version(d),editGroup:'typing-a',operation:{type:'node',node:node('a',label)}});
 assert.equal(d.version,3);await f.restart();d=await f.call('draft_step',{...version(d),direction:'undo'});assert.equal(d.graph.nodes[0].label,'a');assert.equal(d.canUndo,false);
 d=await f.call('draft_step',{...version(d),direction:'redo'});assert.equal(d.graph.nodes[0].label,'Alpha final');
 d=await f.call('draft_change',{...version(d),editGroup:'typing-a',operation:{type:'node',node:node('a','After redo')}});d=await f.call('draft_step',{...version(d),direction:'undo'});assert.equal(d.graph.nodes[0].label,'Alpha final');
 }finally{await f.close();}
});
test('coalescing does not cross targets, gestures or undo branches and stale saves preserve work',async()=>{
 const f=await fixture();try{let d=await f.call('draft_open',{draftId:'boundaries'});const initial=d;
 d=await f.call('draft_change',{...version(d),editGroup:'same',operation:{type:'node',node:node('a','A')}});
 const first=d;d=await f.call('draft_change',{...version(d),editGroup:'same',operation:{type:'node',node:node('b','B')}});
 d=await f.call('draft_step',{...version(d),direction:'undo'});assert.equal(d.graph.nodes.find((n:any)=>n.id==='a').label,'A');assert.equal(d.graph.nodes.find((n:any)=>n.id==='b').label,'b');
 assert.equal((await f.request('draft_change',{...version(initial),editGroup:'same',operation:{type:'node',node:node('a','stale')}})).status,409);
 d=await f.call('draft_change',{...version(d),editGroup:'branch',operation:{type:'node',node:node('c','Branch')}});assert.equal(d.canRedo,false);d=await f.call('draft_step',{...version(d),direction:'undo'});assert.deepEqual(d.graph,first.graph);
 }finally{await f.close();}
});
test('batches isolate scoped positions, preserve captured drawing frames and stay unpublished',async()=>{
 const f=await fixture();try{await f.call('graph_commit',{baseRevision:1,answerId:'flow',nodes:[],edges:[],flows:[{id:'topic',scope:'custom',label:'Topic',nodeIds:['a','b'],edgeIds:[],startNodeIds:[],endNodeIds:[]}]});let d=await f.call('draft_open',{draftId:'scoped'});
 d=await f.call('draft_change',{...version(d),operation:{type:'batch',operations:[{type:'move',nodeId:'a',flowId:'topic',position:{x:10,y:20}},{type:'move',nodeId:'b',flowId:'topic',position:{x:30,y:40}}]}});assert.deepEqual(d.graph.positions,{});assert.equal(d.graph.flowLayouts.topic.positions.b.x,30);
 d=await f.call('draft_change',{...version(d),operation:{type:'instruction',flowId:'topic',note:'Drawn',nodeIds:['a'],strokes:[{points:[{x:10,y:20},{x:20,y:30}]}]}});const before=d;
 assert.equal((await f.request('draft_change',{...version(d),operation:{type:'batch',operations:[{type:'move',nodeId:'a',flowId:'topic',position:{x:100,y:200}}]}})).status,422);assert.deepEqual(await f.call('draft_read',{draftId:d.id}),before);
 assert.deepEqual((await f.call('feedback_read')).feedback,[]);const wait=await fetch(f.app.url+'/api/submissions/wait?sessionId=groups&timeoutMs=5').then(r=>r.json());assert.equal(wait.feedback,null);
 }finally{await f.close();}
});
