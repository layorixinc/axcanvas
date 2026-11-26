import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../src/server.ts';

const node = (id: string, label = id) => ({ id, kind: 'concept', label, detail: 'Original detail', status: 'confirmed', sources: [] });
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'axcanvas-review-'));
  let app = await startServer({ port: 0, dbPath: join(dir, 'data.sqlite') });
  async function request(tool: string, args: object = {}, sessionId = 'review', requestId = randomUUID()) {
    const response = await fetch(`${app.url}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, sessionId, tool, arguments: args, actor: 'user' }) });
    return { status: response.status, body: await response.json() };
  }
  async function call(tool: string, args: object = {}, sessionId = 'review') {
    const result = await request(tool, args, sessionId); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.result;
  }
  await call('session_open', { title: 'Reviewed editing' });
  await call('graph_commit', { baseRevision: 0, answerId: 'seed', nodes: [node('a'), node('b')], edges: [{ id: 'ab', source: 'a', target: 'b', relation: 'uses', status: 'active' }] });
  return { get app() { return app; }, request, call,
    restart: async () => { await app.close(); app = await startServer({ port: 0, dbPath: join(dir, 'data.sqlite') }); },
    close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  };
}
const change = (draft: any, operation: object) => ({ draftId: draft.id, baseDraftVersion: draft.version, operation });
const version = (draft: any) => ({ draftId: draft.id, baseDraftVersion: draft.version });

test('draft node/edge/movement/instructions survive reopen without changing the canonical graph', async () => {
  const f = await fixture();
  try {
    const original = await f.call('graph_read');
    let d = await f.call('draft_open', { draftId: 'draft-one' });
    d = await f.call('draft_change', change(d, { type: 'node', node: node('new', '새 노드 — 日本語'), position: { x: 55, y: 80 } }));
    d = await f.call('draft_change', change(d, { type: 'edge', edge: { id: 'new-link', source: 'a', target: 'new', relation: 'explains', status: 'active' } }));
    d = await f.call('draft_change', change(d, { type: 'move', nodeId: 'a', position: { x: 20, y: 30 } }));
    d = await f.call('draft_change', change(d, { type: 'instruction', note: 'Review all of these changes', nodeIds: ['new'], strokes: [{ points: [{ x: 1, y: 2 }, { x: 8, y: 9 }] }] }));
    assert.deepEqual(await f.call('graph_read'), original);
    assert.deepEqual((await f.call('feedback_read')).feedback, []);
    await f.restart();
    assert.deepEqual(await f.call('draft_read', { draftId: d.id }), d);
    assert.deepEqual(await f.call('graph_read'), original);
    const foreign = await f.call('session_open', { title: 'Other' }, 'other'); assert.equal(foreign.sessionId, 'other');
    assert.equal((await f.request('draft_read', { draftId: d.id }, 'other')).status, 404);
  } finally { await f.close(); }
});

test('draft CAS and invalid operations preserve the last valid version', async () => {
  const f = await fixture();
  try {
    const d = await f.call('draft_open', { draftId: 'cas' });
    const saved = await f.call('draft_change', change(d, { type: 'node', node: node('a', 'Human title') }));
    assert.equal((await f.request('draft_change', change(d, { type: 'node', node: node('b', 'Stale tab') }))).status, 409);
    assert.equal((await f.request('draft_change', change(saved, { type: 'edge', edge: { id: 'bad', source: 'a', target: 'missing', relation: 'invalid', status: 'active' } }))).status, 422);
    assert.deepEqual(await f.call('draft_read', { draftId: d.id }), saved);
  } finally { await f.close(); }
});

test('undo/redo and removing newly created nodes leave no phantom changes', async () => {
  const f = await fixture();
  try {
    let d = await f.call('draft_open', { draftId: 'undo' });
    d = await f.call('draft_change', change(d, { type: 'node', node: node('temporary'), position: { x: 100, y: 100 } }));
    d = await f.call('draft_change', change(d, { type: 'edge', edge: { id: 'temporary-edge', source: 'a', target: 'temporary', relation: 'links', status: 'active' } }));
    d = await f.call('draft_change', change(d, { type: 'retire_node', nodeId: 'temporary' }));
    assert.equal((await f.call('draft_review', version(d))).canSubmit, false);
    d = await f.call('draft_step', { ...version(d), direction: 'undo' });
    assert.ok(d.graph.nodes.some((n: any) => n.id === 'temporary'));
    assert.ok(d.graph.edges.some((e: any) => e.id === 'temporary-edge'));
    d = await f.call('draft_step', { ...version(d), direction: 'redo' });
    assert.equal((await f.call('draft_review', version(d))).changes.length, 0);
    d = await f.call('draft_discard', version(d)); assert.equal(d.state, 'discarded');
    assert.equal((await f.call('graph_read')).nodes.length, 2);
  } finally { await f.close(); }
});

test('review tokens bind exact work and repeated Submit creates one immutable packet', async () => {
  const f = await fixture();
  try {
    const before = await f.call('graph_read');
    let d = await f.call('draft_open', { draftId: 'submit' });
    d = await f.call('draft_change', change(d, { type: 'node', node: node('a', 'Reviewed title') }));
    const stale = await f.call('draft_review', version(d));
    d = await f.call('draft_change', change(d, { type: 'instruction', note: 'Please review the entire packet', nodeIds: ['a'], strokes: [] }));
    assert.equal((await f.request('draft_submit', { ...version(d), reviewToken: stale.token })).status, 409);
    assert.deepEqual(await f.call('graph_read'), before);
    const reviewed = await f.call('draft_review', version(d)); assert.equal(reviewed.canSubmit, true);
    const submitted = await f.call('draft_submit', { ...version(d), reviewToken: reviewed.token });
    const replay = await f.call('draft_submit', { ...version(d), reviewToken: reviewed.token });
    assert.equal(replay.id, submitted.id);
    assert.equal((await f.call('feedback_read')).feedback.length, 1);
    assert.equal((await f.call('graph_read')).revision, before.revision + 1);
    assert.deepEqual(submitted.review.before, before);
    assert.equal(submitted.review.after.nodes.find((n: any) => n.id === 'a').label, 'Reviewed title');
    await f.call('graph_edit', { baseRevision: before.revision + 1, node: node('b', 'Later agent edit') });
    assert.deepEqual((await f.call('feedback_read')).feedback[0].review, submitted.review);
  } finally { await f.close(); }
});

test('canonical conflicts preserve draft and three-way rebase preserves remote work', async () => {
  const f = await fixture();
  try {
    let d = await f.call('draft_open', { draftId: 'rebase' });
    d = await f.call('draft_change', change(d, { type: 'node', node: node('a', 'Human title') }));
    const reviewed = await f.call('draft_review', version(d));
    await f.call('graph_edit', { baseRevision: 1, node: node('b', 'Remote title') });
    assert.equal((await f.request('draft_submit', { ...version(d), reviewToken: reviewed.token })).status, 409);
    assert.equal((await f.call('draft_read', { draftId: d.id })).graph.nodes.find((n: any) => n.id === 'a').label, 'Human title');
    const latest = await f.call('graph_read');
    d = await f.call('draft_rebase', { ...version(d), baseRevision: latest.revision, baseLayoutRevision: latest.layoutRevision, resolution: 'fail' });
    assert.equal(d.graph.nodes.find((n: any) => n.id === 'a').label, 'Human title');
    assert.equal(d.graph.nodes.find((n: any) => n.id === 'b').label, 'Remote title');
    const r = await f.call('draft_review', version(d));
    assert.equal(r.changes.filter((c: any) => c.entity === 'node').length, 1);
    await f.call('draft_submit', { ...version(d), reviewToken: r.token });
    assert.equal((await f.call('graph_read')).nodes.find((n: any) => n.id === 'b').label, 'Remote title');
  } finally { await f.close(); }
});

test('same-field rebase requires explicit resolution and layout-only conflicts also block Submit', async () => {
  const f = await fixture();
  try {
    let d = await f.call('draft_open', { draftId: 'collision' });
    d = await f.call('draft_change', change(d, { type: 'node', node: node('a', 'Human') }));
    await f.call('graph_edit', { baseRevision: 1, node: node('a', 'Remote') });
    let latest = await f.call('graph_read');
    const args = { ...version(d), baseRevision: latest.revision, baseLayoutRevision: latest.layoutRevision };
    assert.equal((await f.request('draft_rebase', { ...args, resolution: 'fail' })).status, 409);
    d = await f.call('draft_rebase', { ...args, resolution: 'draft' });
    assert.equal(d.graph.nodes.find((n: any) => n.id === 'a').label, 'Human');
    const r = await f.call('draft_review', version(d));
    await f.call('graph_layout', { baseRevision: latest.revision, baseLayoutRevision: latest.layoutRevision, mode: 'move', positions: { a: { x: 500, y: 200 } } });
    assert.equal((await f.request('draft_submit', { ...version(d), reviewToken: r.token })).status, 409);
    assert.equal((await f.call('draft_review', version(d))).conflict, true);
    assert.deepEqual((await f.call('feedback_read')).feedback, []);
  } finally { await f.close(); }
});

test('one-shot wait ignores draft saves, ordinary writes and simple feedback, then returns only final Submit', async () => {
  const f = await fixture();
  try {
    const waiting = fetch(`${f.app.url}/api/submissions/wait?sessionId=review&after=0&timeoutMs=25000`);
    for (let i = 0; i < 20; i++) { if ((await fetch(`${f.app.url}/api/submissions/status?sessionId=review`).then(r => r.json())).connected) break; }
    let d = await f.call('draft_open', { draftId: 'watch' });
    d = await f.call('draft_change', change(d, { type: 'instruction', note: 'Only notify after review', nodeIds: [], strokes: [] }));
    await f.call('feedback_submit', { baseRevision: 1, note: 'Legacy standalone feedback' });
    const r = await f.call('draft_review', version(d));
    const submission = await f.call('draft_submit', { ...version(d), reviewToken: r.token });
    const response = await waiting; assert.equal(response.status, 200);
    const delivery = await response.json(); assert.equal(delivery.feedback.id, submission.id); assert.ok(delivery.cursor > 0);
    assert.equal((await f.call('graph_read')).revision, 1, 'Instruction-only submission must not manufacture a graph revision');
    const empty = await fetch(`${f.app.url}/api/submissions/wait?sessionId=review&after=${delivery.cursor}&timeoutMs=5`).then(r => r.json());
    assert.equal(empty.feedback, null);
    assert.equal((await f.call('feedback_read')).feedback.find((x: any) => x.id === submission.id).status, 'pending');
  } finally { await f.close(); }
});

test('wait cancellation releases the session and foreign sessions do not receive submissions', async () => {
  const f = await fixture();
  try {
    await f.call('session_open', { title: 'Other session' }, 'other');
    const abort = new AbortController();
    const first = fetch(`${f.app.url}/api/submissions/wait?sessionId=review&timeoutMs=25000`, { signal: abort.signal }).catch(() => null);
    for (let i = 0; i < 20; i++) { if ((await fetch(`${f.app.url}/api/submissions/status?sessionId=review`).then(r => r.json())).connected) break; }
    assert.equal((await fetch(`${f.app.url}/api/submissions/wait?sessionId=review&timeoutMs=5`)).status, 409);
    abort.abort(); await first;
    for (let i = 0; i < 20; i++) { if (!(await fetch(`${f.app.url}/api/submissions/status?sessionId=review`).then(r => r.json())).connected) break; }
    const next = await fetch(`${f.app.url}/api/submissions/wait?sessionId=review&timeoutMs=5`); assert.equal(next.status, 200);
    const other = await fetch(`${f.app.url}/api/submissions/wait?sessionId=other&timeoutMs=5`).then(r => r.json()); assert.equal(other.feedback, null);
  } finally { await f.close(); }
});

test('drawing coordinates survive semantic rebase but never silently follow moved geometry', async () => {
  const f = await fixture();
  try {
    let d = await f.call('draft_open', { draftId: 'drawing-frame' });
    const strokes = [{ points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] }];
    d = await f.call('draft_change', change(d, { type: 'instruction', note: 'Keep this drawing', nodeIds: ['a'], strokes }));
    const refused = await f.request('draft_change', change(d, { type: 'move', nodeId: 'a', position: { x: 100, y: 100 } }));
    assert.ok([409, 422].includes(refused.status));
    assert.deepEqual(await f.call('draft_read', { draftId: d.id }), d);
    await f.call('graph_edit', { baseRevision: 1, node: { ...node('b'), detail: 'Unrelated semantic edit' } });
    let latest = await f.call('graph_read');
    d = await f.call('draft_rebase', { ...version(d), baseRevision: latest.revision, baseLayoutRevision: latest.layoutRevision, resolution: 'fail' });
    assert.deepEqual(d.strokes, strokes);
    await f.call('graph_layout', { baseRevision: latest.revision, baseLayoutRevision: latest.layoutRevision, mode: 'move', positions: { a: { x: 700, y: 500 } } });
    latest = await f.call('graph_read');
    assert.equal((await f.request('draft_rebase', { ...version(d), baseRevision: latest.revision, baseLayoutRevision: latest.layoutRevision, resolution: 'fail' })).status, 409);
    assert.deepEqual(await f.call('draft_read', { draftId: d.id }), d);
  } finally { await f.close(); }
});

test('automatic draft layout rejects newer canonical content or geometry atomically', async () => {
  const f = await fixture();
  try {
    let d = await f.call('draft_open', { draftId: 'automatic-layout-race' });
    await f.call('graph_commit', { baseRevision: 1, answerId: 'remote', nodes: [node('b', 'New remote content')], edges: [] });
    const layout = { type: 'layout', positions: { a: { x: 0, y: 0 }, b: { x: 500, y: 0 } }, routes: {}, direction: 'RIGHT' };
    const region = { type: 'layout_region', nodeIds: ['a'], positions: { a: { x: 100, y: 100 } }, routes: {} };
    for (const operation of [layout, region, { type: 'batch', operations: [{ type: 'instruction', note: 'Must roll back', nodeIds: [], strokes: [] }, layout] }]) {
      const response = await f.request('draft_change', change(d, operation));
      assert.equal(response.status, 409); assert.equal(response.body.error.code, 'DRAFT_BASE_CONFLICT');
      assert.deepEqual(await f.call('draft_read', { draftId: d.id }), d);
    }
    let latest = await f.call('graph_read');
    d = await f.call('draft_rebase', { ...version(d), baseRevision: latest.revision, baseLayoutRevision: latest.layoutRevision, resolution: 'fail' });
    await f.call('graph_layout', { baseRevision: latest.revision, baseLayoutRevision: latest.layoutRevision, mode: 'move', positions: { a: { x: 900, y: 900 } } });
    assert.equal((await f.request('draft_change', change(d, layout))).status, 409);
    assert.deepEqual(await f.call('draft_read', { draftId: d.id }), d);
    assert.deepEqual((await f.call('graph_read')).positions.a, { x: 900, y: 900 });
  } finally { await f.close(); }
});
