import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphStore } from '../src/store.ts';
import type { CommitInput } from '../src/schema.ts';

const node = (id = 'cache', label = 'Redis cache') => ({ id, kind: 'concept' as const, label, detail: 'Shared cache', status: 'proposed' as const, sources: [] });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'axcanvas-'));
  const path = join(dir, 'graph.sqlite');
  const store = new GraphStore(path);
  return { store, path, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function change(graphId: string, baseRevision = 0): CommitInput {
  return { graphId, baseRevision, requestId: 'req-1', answerId: 'turn-1', nodes: [node()], edges: [], retireNodeIds: [], retireEdgeIds: [] };
}

test('session resumes its graph without mixing another session', () => {
  const f = fixture();
  try {
    const a = f.store.open('omp-one', 'Question');
    assert.equal(f.store.open('omp-one', 'Again').graphId, a.graphId);
    assert.notEqual(f.store.open('omp-two', 'Other').graphId, a.graphId);
  } finally { f.cleanup(); }
});

test('correction reuses IDs, preserves provenance and earlier revisions', () => {
  const f = fixture();
  try {
    const g = f.store.open('one', 'Architecture');
    const first = change(g.graphId);
    first.nodes = [node('cache'), node('api')];
    first.edges = [{ id: 'depends', source: 'api', target: 'cache', relation: 'uses', status: 'active' }];
    f.store.commit(first);
    f.store.commit({ ...change(g.graphId, 1), requestId: 'req-2', answerId: 'turn-2', nodes: [{ ...node(), label: 'PostgreSQL cache', sources: [{ kind: 'turn', ref: 'turn-2' }] }] });
    const current = f.store.read(g.graphId);
    assert.equal(current.revision, 2);
    assert.equal(current.nodes.length, 2);
    assert.equal(current.nodes.find(n => n.id === 'cache')?.label, 'PostgreSQL cache');
    assert.equal(current.edges[0].target, 'cache');
    assert.equal(f.store.history(g.graphId)[0].nodes.find(n => n.id === 'cache')?.label, 'Redis cache');
  } finally { f.cleanup(); }
});

test('dangling relations and duplicate IDs reject the whole change', () => {
  const f = fixture();
  try {
    const g = f.store.open('one', 'Invalid');
    assert.throws(() => f.store.commit({ ...change(g.graphId), edges: [{ id: 'bad', source: 'cache', target: 'missing', relation: 'uses', status: 'active' }] }), /endpoint/i);
    assert.equal(f.store.read(g.graphId).revision, 0);
    assert.equal(f.store.read(g.graphId).nodes.length, 0);
    assert.throws(() => f.store.commit({ ...change(g.graphId), nodes: [node(), node()] }), /duplicate/i);
    assert.equal(f.store.history(g.graphId).length, 0);
  } finally { f.cleanup(); }
});

test('replayed requests apply once; request ID reuse with another body is rejected', () => {
  const f = fixture();
  try {
    const g = f.store.open('one', 'Retry');
    const c = change(g.graphId);
    const initial = f.store.commit(c);
    assert.deepEqual(f.store.commit(c), initial);
    assert.equal(f.store.read(g.graphId).revision, 1);
    assert.throws(() => f.store.commit({ ...c, nodes: [node('cache', 'Changed')] }), /request.*reus/i);
  } finally { f.cleanup(); }
});

test('stale agent cannot overwrite a user edit; latest read permits an explicit correction', () => {
  const f = fixture();
  try {
    const g = f.store.open('one', 'Conflict');
    f.store.commit(change(g.graphId));
    f.store.commit({ ...change(g.graphId, 1), requestId: 'human', nodes: [node('cache', 'Human decision')] }, 'user');
    assert.throws(() => f.store.commit({ ...change(g.graphId, 1), requestId: 'stale' }), /revision/i);
    assert.equal(f.store.read(g.graphId).nodes[0].label, 'Human decision');
    f.store.commit({ ...change(g.graphId, 2), requestId: 'fresh', nodes: [node('cache', 'Reviewed decision')] });
    assert.equal(f.store.read(g.graphId).nodes[0].label, 'Reviewed decision');
  } finally { f.cleanup(); }
});

test('positions survive agent edits and database reopen; layout conflicts are independent', () => {
  const f = fixture();
  try {
    const g = f.store.open('one', 'Persist');
    f.store.commit(change(g.graphId));
    f.store.layout(g.graphId, { baseRevision: 1, baseLayoutRevision: 0, positions: { cache: { x: 320, y: 210 } } });
    assert.throws(() => f.store.layout(g.graphId, { baseRevision: 1, baseLayoutRevision: 0, positions: { cache: { x: 1, y: 2 } } }), /revision/i);
    f.store.commit({ ...change(g.graphId, 1), requestId: 'new-label', nodes: [node('cache', 'Updated')] });
    f.store.close();
    const reopened = new GraphStore(f.path);
    try {
      const restored = reopened.read(g.graphId);
      assert.equal(restored.nodes[0].label, 'Updated');
      assert.deepEqual(restored.positions.cache, { x: 320, y: 210 });
      assert.equal(restored.layoutRevision, 1);
      assert.equal(reopened.history(g.graphId).length, 2);
    } finally { reopened.close(); }
  } finally { f.cleanup(); }
});

test('retirement retains the node and historical explanation', () => {
  const f = fixture();
  try {
    const g = f.store.open('one', 'Retire');
    f.store.commit(change(g.graphId));
    f.store.commit({ ...change(g.graphId, 1), requestId: 'retire', nodes: [], retireNodeIds: ['cache'] });
    assert.equal(f.store.read(g.graphId).nodes[0].status, 'retired');
    assert.equal(f.store.history(g.graphId)[0].nodes[0].status, 'proposed');
  } finally { f.cleanup(); }
});


test('retiring a node through its editable status also retires incident relations', () => {
  const f = fixture();
  try {
    const g = f.store.open('one', 'Canvas retirement');
    f.store.commit({ ...change(g.graphId), nodes: [node('api'), node('cache')], edges: [{ id: 'uses', source: 'api', target: 'cache', relation: 'uses', status: 'active' }] });
    f.store.commit({ ...change(g.graphId, 1), requestId: 'user-retire', nodes: [{ ...node('cache'), status: 'retired' }] }, 'user');
    const current = f.store.read(g.graphId);
    assert.equal(current.nodes.find(n => n.id === 'cache')?.status, 'retired');
    assert.equal(current.edges.find(e => e.id === 'uses')?.status, 'retired');
  } finally { f.cleanup(); }
});
