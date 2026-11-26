import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../src/server.ts';
const node = id => ({ id, label: id, detail: '', kind: 'concept', status: 'confirmed', sources: [] });
const route = x => ({ sections: [[{ x, y: 75 }, { x: x + 100, y: 75 }]], label: { x, y: 20, width: 80, height: 20, text: 'uses' } });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'axcanvas-region-')), app = await startServer({ port: 0, dbPath: join(dir, 'db.sqlite') });
  async function request(tool, args = {}) { const r = await fetch(app.url + '/api/agent/v1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId: 'region', tool, arguments: args }) }); return { status: r.status, body: await r.json() }; }
  async function call(tool, args = {}) { const r = await request(tool, args); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; }
  await call('session_open', { title: 'Region layout' });
  await call('graph_commit', { baseRevision: 0, answerId: 'seed', nodes: ['a','b','c','d','old'].map(node), edges: [['ab','a','b'],['bc','b','c'],['cd','c','d']].map(([id,source,target]) => ({ id, source, target, relation: 'uses', status: 'active' })), flows: [{ id: 'scope', scope: 'custom', label: 'Scope', nodeIds: ['a','b'], edgeIds: ['ab'], startNodeIds: ['a'], endNodeIds: ['b'] }] });
  const positions = Object.fromEntries(['a','b','c','d','old'].map((id,i) => [id,{ x: i*500, y: 0 }]));
  await call('graph_layout', { baseRevision: 1, baseLayoutRevision: 0, mode: 'replace', positions, routes: { ab: route(340), bc: route(840), cd: route(1340) }, direction: 'RIGHT' });
  return { call, request, close: async () => { await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
const version = d => ({ draftId: d.id, baseDraftVersion: d.version });
const operation = extra => ({ type: 'layout_region', nodeIds: ['a','b'], positions: { a: { x: 100, y: 300 }, b: { x: 600, y: 300 } }, routes: { ab: { ...route(440), sections: [[{ x: 440, y: 375 }, { x: 600, y: 375 }]] } }, ...extra });

test('region layout preserves outside nodes and routes with one undoable draft-only checkpoint', async () => {
  const f = await fixture();
  try {
    const canonical = await f.call('graph_read'); let d = await f.call('draft_open', { draftId: 'layout' });
    d = await f.call('draft_change', { ...version(d), operation: operation() });
    assert.deepEqual(d.graph.positions.c, canonical.positions.c); assert.deepEqual(d.graph.positions.d, canonical.positions.d); assert.deepEqual(d.graph.routes.cd, canonical.routes.cd); assert.equal(d.graph.routes.bc, undefined); assert.equal(d.graph.layoutDirection, 'RIGHT');
    assert.deepEqual(await f.call('graph_read'), canonical); assert.deepEqual((await f.call('feedback_read')).feedback, []);
    d = await f.call('draft_step', { ...version(d), direction: 'undo' }); assert.deepEqual(d.graph, canonical);
    d = await f.call('draft_step', { ...version(d), direction: 'redo' }); assert.deepEqual(d.graph.positions.a, { x: 100, y: 300 });
  } finally { await f.close(); }
});

test('malformed region geometry and outside routes reject atomically; scoped geometry stays isolated', async () => {
  const f = await fixture();
  try {
    const d = await f.call('draft_open', { draftId: 'scope' });
    for (const op of [operation({ positions: { a: { x: 1, y: 2 } } }), operation({ routes: { cd: route(1340) } }), operation({ nodeIds: ['a','a'] }), operation({ nodeIds: ['a','missing'] })]) {
      assert.equal((await f.request('draft_change', { ...version(d), operation: op })).status, 422); assert.deepEqual(await f.call('draft_read', { draftId: d.id }), d);
    }
    const scoped = await f.call('draft_change', { ...version(d), operation: operation({ flowId: 'scope' }) });
    assert.deepEqual(scoped.graph.positions, d.graph.positions); assert.deepEqual(scoped.graph.routes, d.graph.routes); assert.deepEqual(scoped.graph.flows, d.graph.flows); assert.deepEqual(scoped.graph.flowLayouts.scope.positions.a, { x: 100, y: 300 });
  } finally { await f.close(); }
});

test('region apply keeps retired outside coordinates instead of deleting legacy geometry', async () => {
  const f = await fixture();
  try {
    await f.call('graph_commit', { baseRevision: 1, answerId: 'retire', nodes: [], edges: [], retireNodeIds: ['old'] });
    const canonical = await f.call('graph_read'); const d = await f.call('draft_open', { draftId: 'legacy' });
    const changed = await f.call('draft_change', { ...version(d), operation: operation() });
    assert.deepEqual(changed.graph.positions.old, canonical.positions.old); assert.equal(changed.graph.nodes.find(n => n.id === 'old').status, 'retired');
  } finally { await f.close(); }
});
