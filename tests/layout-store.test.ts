import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GraphStore } from '../src/store.ts';
import { AgentAPI } from '../src/agent.ts';
import { feedbackImage } from '../src/feedback-image.ts';
const node = (id: string) => ({ id, kind: 'concept', label: id, detail: '', status: 'confirmed', sources: [] });
const positions = { a: { x: 0, y: 0 }, b: { x: 520, y: 0 } };
const routes = { ab: { sections: [[{ x: 340, y: 75 }, { x: 520, y: 75 }]], label: { x: 370, y: 40, width: 120, height: 24, text: 'uses' } } };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'axcanvas-layout-')), path = join(dir, 'db.sqlite');
  const store = new GraphStore(path), api = new AgentAPI(store), g = store.open('layout', 'Layout');
  store.commit({ graphId: g.graphId, baseRevision: 0, requestId: 'seed', answerId: 'seed', nodes: [node('a'), node('b')], edges: [{ id: 'ab', source: 'a', target: 'b', relation: 'uses', status: 'active' }] });
  const call = (args: unknown) => api.call({ requestId: randomUUID(), sessionId: 'layout', tool: 'graph_layout', arguments: args }, 'http://127.0.0.1:43821');
  const arranged = { baseRevision: 1, baseLayoutRevision: 0, mode: 'replace', positions, routes, direction: 'RIGHT' };
  return { store, path, g, call, arranged, close: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test('layout persists routes and labels without changing semantic graph or history', () => {
  const f = fixture();
  try {
    assert.equal(f.call(f.arranged).status, 200);
    const graph = f.store.read(f.g.graphId);
    assert.equal(graph.revision, 1); assert.equal(graph.layoutRevision, 1);
    assert.deepEqual(graph.routes, routes); assert.equal(graph.layoutDirection, 'RIGHT');
    assert.equal(f.store.history(f.g.graphId).length, 1);
    f.store.close(); const reopened = new GraphStore(f.path);
    try { assert.deepEqual(reopened.read(f.g.graphId).routes, routes); assert.deepEqual(reopened.read(f.g.graphId).positions, positions); }
    finally { reopened.close(); }
  } finally { f.close(); }
});
test('preview results cannot overwrite a newer semantic revision or another layout', () => {
  const f = fixture();
  try {
    f.store.commit({ graphId: f.g.graphId, baseRevision: 1, requestId: 'human', answerId: 'human', nodes: [node('a')], edges: [] }, 'user');
    const stale = f.call(f.arranged); assert.equal(stale.status, 409);
    if (stale.body.ok) assert.fail('Expected revision conflict');
    assert.equal(stale.body.error.code, 'REVISION_CONFLICT');
    assert.deepEqual(f.store.read(f.g.graphId).positions, {});
    assert.equal(f.call({ ...f.arranged, baseRevision: 2 }).status, 200);
    const staleLayout = f.call({ ...f.arranged, baseRevision: 2 }); assert.equal(staleLayout.status, 409);
    if (staleLayout.body.ok) assert.fail('Expected layout conflict');
    assert.equal(staleLayout.body.error.code, 'LAYOUT_REVISION_CONFLICT');
  } finally { f.close(); }
});
test('undo restores an empty layout exactly and preserves submitted feedback snapshots', () => {
  const f = fixture();
  try {
    assert.equal(f.call(f.arranged).status, 200);
    const feedback = f.store.submitFeedback('layout', { baseRevision: 1, nodeIds: ['a'], note: 'Keep here', strokes: [] });
    const capture = f.store.feedbackItem('layout', feedback.id).capture;
    assert.ok(feedbackImage(feedback).includes('340,75 520,75'), 'Submitted drawings must preserve routed connection geometry, not revert to center lines');
    assert.equal(f.call({ baseRevision: 1, baseLayoutRevision: 1, mode: 'replace', positions: {}, routes: {}, direction: null }).status, 200);
    const undone = f.store.read(f.g.graphId);
    assert.deepEqual(undone.positions, {}); assert.deepEqual(undone.routes, {}); assert.equal(undone.layoutDirection, null);
    assert.equal(undone.layoutRevision, 2); assert.equal(undone.revision, 1);
    assert.deepEqual(f.store.feedbackItem('layout', feedback.id).capture, capture);
  } finally { f.close(); }
});
test('manual node movement and semantic edits invalidate routes but keep other node positions', () => {
  const f = fixture();
  try {
    f.call(f.arranged);
    assert.equal(f.call({ baseRevision: 1, baseLayoutRevision: 1, mode: 'move', positions: { a: { x: -100, y: 200 } } }).status, 200);
    let graph = f.store.read(f.g.graphId);
    assert.deepEqual(graph.routes, {}); assert.deepEqual(graph.positions.b, positions.b);
    assert.equal(f.call({ ...f.arranged, baseLayoutRevision: 2 }).status, 200);
    f.store.commit({ graphId: f.g.graphId, baseRevision: 1, requestId: 'semantic', answerId: 'new', nodes: [{ ...node('a'), label: 'Changed label' }], edges: [] });
    graph = f.store.read(f.g.graphId);
    assert.deepEqual(graph.routes, {}); assert.deepEqual(graph.positions, positions); assert.equal(graph.layoutRevision, 4);
  } finally { f.close(); }
});
test('invalid routing data is rejected without partially changing positions', () => {
  const f = fixture();
  try {
    const invalid = f.call({ ...f.arranged, routes: { missing: routes.ab } }); assert.equal(invalid.status, 422);
    assert.deepEqual(f.store.read(f.g.graphId).positions, {});
    const short = f.call({ ...f.arranged, routes: { ab: { ...routes.ab, sections: [[{ x: 0, y: 0 }]] } } }); assert.equal(short.status, 422);
    assert.equal(f.store.read(f.g.graphId).layoutRevision, 0);
  } finally { f.close(); }
});
