import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../src/server.ts';

const node = (id = 'a', extra = {}) => ({ id, label: id, kind: 'concept', detail: 'Original detail', status: 'confirmed', sources: [], ...extra });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'axcanvas-tags-'));
  let app = await startServer({ port: 0, dbPath: join(dir, 'graph.sqlite') });
  async function request(tool, args = {}, sessionId = 'tags') {
    const response = await fetch(app.url + '/api/agent/v1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId, tool, arguments: args }) });
    return { status: response.status, body: await response.json() };
  }
  async function call(tool, args = {}, sessionId = 'tags') { const r = await request(tool, args, sessionId); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; }
  await call('session_open', { title: 'Tags' });
  return { call, request, restart: async () => { await app.close(); app = await startServer({ port: 0, dbPath: join(dir, 'graph.sqlite') }); }, close: async () => { await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
const version = d => ({ draftId: d.id, baseDraftVersion: d.version });

test('AI node tags round-trip, omitted fields preserve them and explicit empty arrays clear them', async () => {
  const f = await fixture();
  try {
    await f.call('graph_commit', { baseRevision: 0, answerId: 'tagged', nodes: [node('a', { tags: ['backend', '설계'] })], edges: [] });
    await f.restart(); assert.deepEqual((await f.call('graph_read')).nodes[0].tags, ['backend', '설계']);
    await f.call('graph_commit', { baseRevision: 1, answerId: 'older-client', nodes: [node('a', { detail: 'Updated by older client' })], edges: [] });
    assert.deepEqual((await f.call('graph_read')).nodes[0].tags, ['backend', '설계']);
    await f.call('graph_edit', { baseRevision: 2, node: node('a', { tags: [] }) });
    assert.deepEqual((await f.call('graph_read')).nodes[0].tags, []);
    const history = (await f.call('graph_history')).history;
    assert.deepEqual(history[0].nodes[0].tags, ['backend', '설계']);
    assert.deepEqual(history[1].nodes[0].tags, ['backend', '설계']);
  } finally { await f.close(); }
});

test('invalid tags reject the complete delta without advancing revisions', async () => {
  const f = await fixture();
  try {
    for (const tags of [[''], ['with space'], ['#stored-hash'], ['one,two'], ['API', 'ａｐｉ'], Array(33).fill(0).map((_, i) => 'tag' + i), ['x'.repeat(65)]]) {
      const r = await f.request('graph_commit', { baseRevision: 0, answerId: 'invalid', nodes: [node('ok'), node('invalid', { tags })], edges: [] });
      assert.equal(r.status, 422, JSON.stringify(tags)); assert.equal((await f.call('graph_read')).revision, 0); assert.deepEqual((await f.call('graph_read')).nodes, []);
    }
  } finally { await f.close(); }
});

test('tag edits retain durable Undo/Redo and reviewed immutable publication', async () => {
  const f = await fixture();
  try {
    await f.call('graph_commit', { baseRevision: 0, answerId: 'legacy', nodes: [node()], edges: [] });
    let d = await f.call('draft_open', { draftId: 'edit' });
    const baseline = await f.call('graph_read');
    d = await f.call('draft_change', { ...version(d), operation: { type: 'node', node: node('a', { tags: ['database'] }) } });
    assert.deepEqual(await f.call('graph_read'), baseline);
    d = await f.call('draft_step', { ...version(d), direction: 'undo' }); assert.deepEqual(d.graph.nodes[0].tags ?? [], []);
    d = await f.call('draft_step', { ...version(d), direction: 'redo' }); assert.deepEqual(d.graph.nodes[0].tags, ['database']);
    d = await f.call('draft_change', { ...version(d), operation: { type: 'node', node: node('a', { label: 'Legacy draft editor' }) } });
    assert.deepEqual(d.graph.nodes[0].tags, ['database']);
    const review = await f.call('draft_review', version(d)); assert.ok(review.changes.some(c => c.entity === 'node'));
    const packet = await f.call('draft_submit', { ...version(d), reviewToken: review.token });
    assert.deepEqual(packet.review.after.nodes[0].tags, ['database']); assert.deepEqual((await f.call('graph_read')).nodes[0].tags, ['database']);
    await f.restart(); assert.deepEqual((await f.call('feedback_read')).feedback[0].review.after.nodes[0].tags, ['database']);
  } finally { await f.close(); }
});

test('rebase preserves independent field edits and reports concurrent tag conflicts', async () => {
  const f = await fixture();
  try {
    await f.call('graph_commit', { baseRevision: 0, answerId: 'seed', nodes: [node('a', { tags: ['base'] })], edges: [] });
    let d = await f.call('draft_open', { draftId: 'merge' });
    d = await f.call('draft_change', { ...version(d), operation: { type: 'node', node: node('a', { tags: ['human'] }) } });
    await f.call('graph_commit', { baseRevision: 1, answerId: 'independent', nodes: [node('a', { detail: 'Agent update' })], edges: [] });
    let latest = await f.call('graph_read');
    d = await f.call('draft_rebase', { ...version(d), baseRevision: latest.revision, baseLayoutRevision: latest.layoutRevision, resolution: 'fail' });
    assert.equal(d.graph.nodes[0].detail, 'Agent update'); assert.deepEqual(d.graph.nodes[0].tags, ['human']);
    await f.call('graph_commit', { baseRevision: latest.revision, answerId: 'tag-conflict', nodes: [node('a', { detail: 'Agent update', tags: ['agent'] })], edges: [] });
    latest = await f.call('graph_read');
    const r = await f.request('draft_rebase', { ...version(d), baseRevision: latest.revision, baseLayoutRevision: latest.layoutRevision, resolution: 'fail' });
    assert.equal(r.status, 409); assert.match(JSON.stringify(r.body), /nodes.a.tags/); assert.deepEqual((await f.call('draft_read', { draftId: d.id })).graph.nodes[0].tags, ['human']);
  } finally { await f.close(); }
});
