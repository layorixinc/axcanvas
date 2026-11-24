import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../src/server.ts';
import { DatabaseSync } from 'node:sqlite';

const n = (id: string) => ({ id, kind: 'concept', label: id, detail: 'Shared knowledge', status: 'confirmed', sources: [] });
const e = (id: string, source: string, target: string) => ({ id, source, target, relation: 'supports', status: 'active' });
const flow = (id: string, ids = ['a','b'], edges = ['ab'], starts = ['a'], ends = ['b']) => ({ id, scope: 'turn', turnId: id, label: id, status: 'active', nodeIds: ids, edgeIds: edges, startNodeIds: starts, endNodeIds: ends });
const whole = () => ({ id: 'whole', scope: 'graph', label: 'Whole graph', status: 'active', nodeIds: [], edgeIds: [], startNodeIds: ['a'], endNodeIds: ['c','d'] });
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'axcanvas-flows-'));
  let app = await startServer({ port: 0, dbPath: join(dir, 'data.sqlite') });
  async function request(tool: string, args: object = {}, sessionId = 'flows', requestId: string = randomUUID()) {
    const r = await fetch(app.url + '/api/agent/v1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, sessionId, tool, arguments: args, actor: 'user' }) });
    return { status: r.status, body: await r.json() };
  }
  async function call(tool: string, args: object = {}, sessionId = 'flows') { const r = await request(tool, args, sessionId); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; }
  await call('session_open', { title: 'Scoped flow contract' });
  await call('graph_commit', { baseRevision: 0, answerId: 'seed', nodes: ['a','b','c','d'].map(n), edges: [e('ab','a','b'),e('bc','b','c'),e('bd','b','d')] });
  return { get app() { return app; }, call, request, restart: async () => { await app.close(); app = await startServer({ port: 0, dbPath: join(dir, 'data.sqlite') }); }, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const v = (d: any) => ({ draftId: d.id, baseDraftVersion: d.version });

test('agent commits scoped boundaries and shared turn membership without copying nodes', async () => {
  const f = await fixture();
  try {
    await f.call('graph_commit', { baseRevision: 1, answerId: 'scope-definitions', nodes: [], edges: [], flows: [whole(),flow('turn-1'),flow('turn-2',['b','c','d'],['bc','bd'],['b'],['c','d'])] });
    const graph = await f.call('graph_read');
    assert.equal(graph.revision, 2); assert.equal(graph.nodes.length, 4); assert.equal(graph.flows.length, 3);
    assert.deepEqual(graph.flows.find((x: any) => x.id === 'turn-1').endNodeIds, ['b']);
    assert.deepEqual(graph.flows.find((x: any) => x.id === 'turn-2').startNodeIds, ['b']);
    const history = await f.call('graph_history'); assert.ok(history.history.some((h: any) => h.changedFlowIds?.includes('turn-1')));
    await f.restart(); assert.deepEqual(await f.call('graph_read'), graph);
  } finally { await f.close(); }
});

test('unrelated commits preserve flows and same-turn updates upsert rather than infer revision membership', async () => {
  const f = await fixture();
  try {
    await f.call('graph_commit', { baseRevision: 1, answerId: 'turn-answer', nodes: [], edges: [], flows: [flow('turn-1')] });
    await f.call('graph_commit', { baseRevision: 2, answerId: 'turn-answer', nodes: [{ ...n('a'), detail: 'Refinement of the same turn' }], edges: [] });
    let graph = await f.call('graph_read'); assert.equal(graph.flows.length, 1); assert.equal(graph.flows[0].turnId, 'turn-1');
    await f.call('graph_commit', { baseRevision: 3, answerId: 'turn-answer', nodes: [], edges: [], flows: [{ ...flow('turn-1'), label: 'Refined turn', startNodeIds: [], endNodeIds: [] }] });
    graph = await f.call('graph_read'); assert.equal(graph.flows.length, 1); assert.deepEqual(graph.flows[0].startNodeIds, []);
  } finally { await f.close(); }
});

test('invalid scope membership, duplicate roles, duplicate turn identity and dangling retirement fail atomically', async () => {
  const f = await fixture();
  try {
    const original = await f.call('graph_read');
    const bad = [flow('bad',['a'],['ab']),flow('bad',['a','b'],['ab'],['c']),flow('bad',['a','b'],['ab'],['a','a']),{ ...flow('bad'), scope: 'turn', turnId: '' }];
    for (const item of bad) { assert.equal((await f.request('graph_commit', { baseRevision: 1, answerId: 'invalid', nodes: [], edges: [], flows: [item] })).status, 422); assert.deepEqual(await f.call('graph_read'), original); }
    assert.equal((await f.request('graph_commit', { baseRevision: 1, answerId: 'duplicate-turn', nodes: [], edges: [], flows: [flow('one'), { ...flow('two'), turnId: 'one' }] })).status, 422);
    assert.equal((await f.request('graph_commit', { baseRevision: 1, answerId: 'duplicate-flow', nodes: [], edges: [], flows: [flow('one'), flow('one')] })).status, 422);
    assert.equal((await f.request('graph_commit', { baseRevision: 1, answerId: 'explicit-global-members', nodes: [], edges: [], flows: [{ ...whole(), nodeIds: ['a'] }] })).status, 422);
    await f.call('graph_commit', { baseRevision: 1, answerId: 'valid', nodes: [], edges: [], flows: [flow('turn-1')] });
    const valid = await f.call('graph_read');
    assert.equal((await f.request('graph_commit', { baseRevision: 2, answerId: 'dangling', nodes: [], edges: [], retireNodeIds: ['a'] })).status, 422);
    assert.deepEqual(await f.call('graph_read'), valid);
    await f.call('graph_commit', { baseRevision: 2, answerId: 'explicit-repair', nodes: [], edges: [], retireNodeIds: ['a'], retireFlowIds: ['turn-1'] });
    assert.equal((await f.call('graph_read')).flows[0].status, 'retired');
  } finally { await f.close(); }
});

test('flow metadata replay is exact and isolated by session', async () => {
  const f = await fixture();
  try {
    const args = { baseRevision: 1, answerId: 'replay', nodes: [], edges: [], flows: [flow('turn-1')] };
    const first = await f.request('graph_commit', args, 'flows', 'flow-replay'); assert.equal(first.status, 200);
    assert.deepEqual(await f.request('graph_commit', args, 'flows', 'flow-replay'), first);
    assert.equal((await f.request('graph_commit', { ...args, flows: [{ ...flow('turn-1'), label: 'Different' }] }, 'flows', 'flow-replay')).status, 409);
    await f.call('session_open', { title: 'Other session' }, 'other'); assert.deepEqual((await f.call('graph_read', {}, 'other')).flows, []);
  } finally { await f.close(); }
});

test('view layouts isolate global, Turn 1 and Turn 2 geometry after reopen', async () => {
  const f = await fixture();
  try {
    await f.call('graph_commit', { baseRevision: 1, answerId: 'scopes', nodes: [], edges: [], flows: [flow('turn-1'),flow('turn-2',['b','c'],['bc'],['b'],['c'])] });
    let graph = await f.call('graph_read');
    await f.call('graph_layout', { baseRevision: graph.revision, baseLayoutRevision: graph.layoutRevision, mode: 'move', positions: { a: { x: 10, y: 20 }, b: { x: 400, y: 20 } } });
    graph = await f.call('graph_read'); const globalPositions = graph.positions;
    await f.call('graph_layout', { baseRevision: graph.revision, baseLayoutRevision: graph.layoutRevision, flowId: 'turn-1', mode: 'replace', positions: { a: { x: 30, y: 40 }, b: { x: 500, y: 40 } }, routes: {}, direction: 'RIGHT' });
    graph = await f.call('graph_read'); const firstLayout = graph.flowLayouts['turn-1'];
    await f.call('graph_layout', { baseRevision: graph.revision, baseLayoutRevision: graph.layoutRevision, flowId: 'turn-2', mode: 'replace', positions: { b: { x: 80, y: 90 }, c: { x: 80, y: 400 } }, routes: {}, direction: 'DOWN' });
    graph = await f.call('graph_read'); assert.deepEqual(graph.positions, globalPositions); assert.deepEqual(graph.flowLayouts['turn-1'], firstLayout); assert.notDeepEqual(graph.flowLayouts['turn-2'].positions.b, firstLayout.positions.b);
    assert.equal((await f.request('graph_layout', { baseRevision: graph.revision, baseLayoutRevision: graph.layoutRevision, flowId: 'turn-1', mode: 'move', positions: { c: { x: 0, y: 0 } } })).status, 422);
    await f.restart(); assert.deepEqual(await f.call('graph_read'), graph);
  } finally { await f.close(); }
});

test('draft flow roles and view layouts persist, undo and submit as one immutable reviewed packet', async () => {
  const f = await fixture();
  try {
    const original = await f.call('graph_read');
    let d = await f.call('draft_open', { draftId: 'scope-draft' });
    d = await f.call('draft_change', { ...v(d), operation: { type: 'flow', flow: flow('turn-1') } });
    d = await f.call('draft_change', { ...v(d), operation: { type: 'layout', flowId: 'turn-1', positions: { a: { x: 20, y: 20 }, b: { x: 400, y: 20 } }, routes: {}, direction: 'RIGHT' } });
    assert.deepEqual(await f.call('graph_read'), original); await f.restart(); assert.deepEqual(await f.call('draft_read', { draftId: d.id }), d);
    const beforeUndo = d.graph.flowLayouts['turn-1']; d = await f.call('draft_step', { ...v(d), direction: 'undo' }); assert.equal(d.graph.flowLayouts['turn-1'], undefined);
    d = await f.call('draft_step', { ...v(d), direction: 'redo' }); assert.deepEqual(d.graph.flowLayouts['turn-1'], beforeUndo);
    d = await f.call('draft_change', { ...v(d), operation: { type: 'instruction', flowId: 'turn-1', nodeIds: ['a'], note: 'Review this turn', strokes: [{ points: [{ x: 20, y: 20 }, { x: 40, y: 50 }] }] } });
    const review = await f.call('draft_review', v(d)); assert.ok(review.changes.some((x: any) => x.entity === 'flow')); assert.ok(review.changes.some((x: any) => x.entity === 'flow_layout'));
    const packet = await f.call('draft_submit', { ...v(d), reviewToken: review.token });
    assert.equal(packet.captureFlowId, 'turn-1'); assert.deepEqual(packet.review.after.flowLayouts['turn-1'], beforeUndo);
    const image = await fetch(packet.imageUrl).then(r => r.text()); assert.match(image, /START/); assert.match(image, /END/); assert.doesNotMatch(image, />c<|>d</);
    const immutable = packet.review; await f.call('graph_commit', { baseRevision: packet.graphRevision, answerId: 'later', nodes: [], edges: [], flows: [{ ...flow('turn-1'), label: 'Later label' }] });
    assert.deepEqual((await f.call('feedback_read')).feedback[0].review, immutable);
  } finally { await f.close(); }
});

test('human retirement repairs memberships and newly created scopes leave no net-zero phantom delta', async () => {
  const f = await fixture();
  try {
    await f.call('graph_commit', { baseRevision: 1, answerId: 'scope', nodes: [], edges: [], flows: [flow('turn-1')] });
    let d = await f.call('draft_open', { draftId: 'retire-scope-member' });
    d = await f.call('draft_change', { ...v(d), operation: { type: 'retire_node', nodeId: 'a' } });
    assert.deepEqual(d.graph.flows[0].startNodeIds, []); assert.equal(d.graph.flows[0].nodeIds.includes('a'), false); assert.equal(d.graph.flows[0].edgeIds.includes('ab'), false);
    d = await f.call('draft_step', { ...v(d), direction: 'undo' }); assert.deepEqual(d.graph.flows[0], (await f.call('graph_read')).flows[0]);
    d = await f.call('draft_change', { ...v(d), operation: { type: 'node', node: n('temporary-member'), position: { x: 10, y: 20 }, flowId: 'turn-1' } });
    d = await f.call('draft_change', { ...v(d), operation: { type: 'retire_node', nodeId: 'temporary-member' } });
    assert.equal((await f.call('draft_review', v(d))).changes.length, 0, 'Creating then removing a scoped node must not leave an empty phantom view layout');
    d = await f.call('draft_change', { ...v(d), operation: { type: 'flow', flow: { ...flow('temporary'), scope: 'custom', turnId: undefined } } });
    d = await f.call('draft_change', { ...v(d), operation: { type: 'retire_flow', flowId: 'temporary' } });
    assert.equal((await f.call('draft_review', v(d))).changes.length, 0);
  } finally { await f.close(); }
});

test('independent role additions rebase without dropping either shared-flow change', async () => {
  const f = await fixture();
  try {
    const initial = flow('turn-1',['a','b','c'],['ab','bc'],[],[]);
    await f.call('graph_commit', { baseRevision: 1, answerId: 'scope', nodes: [], edges: [], flows: [initial] });
    let d = await f.call('draft_open', { draftId: 'role-rebase' });
    d = await f.call('draft_change', { ...v(d), operation: { type: 'flow', flow: { ...initial, startNodeIds: ['a'] } } });
    await f.call('graph_commit', { baseRevision: 2, answerId: 'remote-role', nodes: [], edges: [], flows: [{ ...initial, startNodeIds: ['b'] }] });
    const latest = await f.call('graph_read'); d = await f.call('draft_rebase', { ...v(d), baseRevision: latest.revision, baseLayoutRevision: latest.layoutRevision, resolution: 'fail' });
    assert.deepEqual([...d.graph.flows[0].startNodeIds].sort(), ['a','b']);
  } finally { await f.close(); }
});

test('old SQLite graph, history and feedback migrate without inventing flows or rewriting snapshots', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'axcanvas-old-flows-')), path = join(dir, 'old.sqlite');
  const at = '2026-01-01T00:00:00.000Z';
  const legacy = { graphId: 'legacy-graph', sessionId: 'legacy', title: '보존된 지식', revision: 3, nodes: [n('a')], edges: [], positions: { a: { x: 51, y: 73 } }, layoutRevision: 7, routes: {}, layoutDirection: null };
  const snapshot = JSON.stringify({ ...legacy, actor: 'agent', answerId: 'legacy', changedNodeIds: ['a'], at });
  const feedback = JSON.stringify({ id: 'legacy-feedback', sessionId: 'legacy', graphRevision: 3, nodeIds: ['a'], note: 'Keep original drawing', strokes: [], status: 'pending', resolution: '', createdAt: at, capture: legacy });
  let db = new DatabaseSync(path);
  db.exec(`CREATE TABLE graphs (graph_id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, snapshot TEXT NOT NULL, positions TEXT NOT NULL DEFAULT '{}', layout_revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    CREATE TABLE history (graph_id TEXT NOT NULL, revision INTEGER NOT NULL, snapshot TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(graph_id,revision));
    CREATE TABLE feedback (id TEXT PRIMARY KEY, graph_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);`);
  db.prepare('INSERT INTO graphs VALUES(?,?,?,?,?,?,?,?)').run(legacy.graphId, 'legacy', legacy.title, 3, JSON.stringify({ nodes: legacy.nodes, edges: [] }), JSON.stringify(legacy.positions), 7, at);
  db.prepare('INSERT INTO history VALUES(?,?,?,?,?)').run(legacy.graphId, 3, snapshot, 'agent', at);
  db.prepare('INSERT INTO feedback VALUES(?,?,?,?)').run('legacy-feedback', legacy.graphId, 'pending', feedback); db.close();
  const app = await startServer({ port: 0, dbPath: path });
  async function call(tool: string) {
    const r = await fetch(app.url + '/api/agent/v1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'legacy', requestId: randomUUID(), tool, arguments: {} }) });
    assert.equal(r.status, 200); return (await r.json()).result;
  }
  try {
    const graph = await call('graph_read');
    assert.equal(graph.title, legacy.title); assert.equal(graph.revision, 3); assert.equal(graph.layoutRevision, 7); assert.deepEqual(graph.positions, legacy.positions); assert.deepEqual(graph.flows, []); assert.deepEqual(graph.flowLayouts, {});
    const history = await call('graph_history'); assert.equal(history.history[0].nodes[0].id, 'a');
    const packet = (await call('feedback_read')).feedback[0]; const image = await fetch(packet.imageUrl);
    assert.equal(image.status, 200); assert.match(await image.text(), /Keep original drawing/);
  } finally {
    await app.close(); db = new DatabaseSync(path);
    try { assert.equal(db.prepare('SELECT snapshot FROM history').get()!.snapshot, snapshot); assert.equal(db.prepare('SELECT payload FROM feedback').get()!.payload, feedback); }
    finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  }
});

test('captured turn drawing survives unrelated global geometry but blocks moving its own frame', async () => {
  const f = await fixture();
  try {
    await f.call('graph_commit', { baseRevision: 1, answerId: 'scope', nodes: [], edges: [], flows: [flow('turn-1')] });
    let d = await f.call('draft_open', { draftId: 'scoped-drawing' });
    d = await f.call('draft_change', { ...v(d), operation: { type: 'layout', flowId: 'turn-1', positions: { a: { x: 20, y: 30 }, b: { x: 420, y: 30 } }, routes: {}, direction: 'RIGHT' } });
    d = await f.call('draft_change', { ...v(d), operation: { type: 'instruction', flowId: 'turn-1', note: 'Captured Turn 1', nodeIds: ['a'], strokes: [{ points: [{ x: 20, y: 30 }, { x: 40, y: 60 }] }] } });
    const layout = d.graph.flowLayouts['turn-1'];
    const review = await f.call('draft_review', v(d)); await f.call('draft_submit', { ...v(d), reviewToken: review.token });
    d = await f.call('draft_open', { draftId: 'rebase-scoped-drawing' });
    d = await f.call('draft_change', { ...v(d), operation: { type: 'instruction', flowId: 'turn-1', note: 'New drawing', nodeIds: ['a'], strokes: [{ points: [{ x: 20, y: 30 }, { x: 40, y: 60 }] }] } });
    let graph = await f.call('graph_read');
    await f.call('graph_layout', { baseRevision: graph.revision, baseLayoutRevision: graph.layoutRevision, mode: 'move', positions: { a: { x: 999, y: 999 } } });
    graph = await f.call('graph_read'); d = await f.call('draft_rebase', { ...v(d), baseRevision: graph.revision, baseLayoutRevision: graph.layoutRevision, resolution: 'fail' });
    assert.deepEqual(d.graph.flowLayouts['turn-1'], layout); assert.equal(d.captureFlowId, 'turn-1'); assert.equal(d.strokes.length, 1);
    await f.call('graph_layout', { baseRevision: graph.revision, baseLayoutRevision: graph.layoutRevision, flowId: 'turn-1', mode: 'move', positions: { a: { x: 100, y: 100 } } });
    graph = await f.call('graph_read');
    assert.equal((await f.request('draft_rebase', { ...v(d), baseRevision: graph.revision, baseLayoutRevision: graph.layoutRevision, resolution: 'fail' })).status, 409);
    assert.deepEqual(await f.call('draft_read', { draftId: d.id }), d);
  } finally { await f.close(); }
});
