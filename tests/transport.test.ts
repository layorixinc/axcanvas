import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { startServer } from '../src/server.ts';
import { nodeSchema } from '../src/schema.ts';

const replySchema = z.object({
  ok: z.boolean(), isError: z.boolean(),
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  result: z.unknown().optional(),
  error: z.object({
    code: z.string(), message: z.string(),
    fieldErrors: z.array(z.object({ path: z.string(), message: z.string() })),
    expectedSchema: z.record(z.string(), z.unknown()).optional(),
    currentRevision: z.number().optional(),
    availableTools: z.array(z.string()).optional(),
    recovery: z.object({ retryable: z.boolean(), action: z.string(), instructions: z.string() })
  }).optional()
});
const graphView = z.object({ sessionId: z.string(), revision: z.number(), nodes: z.array(nodeSchema), edges: z.array(z.object({ id: z.string(), status: z.string() })), layoutRevision: z.number(), positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })) });
const n = (label = 'Use PostgreSQL') => ({ id: 'db', kind: 'decision', label, detail: 'Keep the existing schema', status: 'confirmed', sources: [] });
const delta = (baseRevision = 0) => ({ baseRevision, answerId: 'answer-one', nodes: [n()], edges: [] });
async function fixture(host: '127.0.0.1' | '0.0.0.0' = '127.0.0.1') {
  const dir = mkdtempSync(join(tmpdir(), 'axcanvas-http-'));
  const app = await startServer({ port: 0, dbPath: join(dir, 'db.sqlite'), host });
  const call = async (tool: string, args: unknown = {}, sessionId = 'test-session', requestId = randomUUID(), actor = 'agent') => {
    const response = await fetch(`${app.url}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, arguments: args, sessionId, requestId, actor }) });
    return { status: response.status, body: replySchema.parse(await response.json()) };
  };
  return { app, dir, call, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('discovery and OpenAPI publish executable schemas at one endpoint without installation', async () => {
  const f = await fixture();
  try {
    const response = await fetch(`${f.app.url}/agents.md`);
    assert.equal(response.status, 200);
    const tools = await f.call('tools_list');
    assert.equal(tools.status, 200);
    const list = z.object({ tools: z.array(z.object({ name: z.string(), inputSchema: z.record(z.string(), z.unknown()), outputSchema: z.record(z.string(), z.unknown()) })) }).parse(tools.body.result).tools;
    assert.ok(list.some(t => t.name === 'graph_commit' && t.inputSchema.properties));
    const spec = z.object({ openapi: z.string(), paths: z.record(z.string(), z.unknown()) }).parse(await fetch(`${f.app.url}/openapi.json`).then(r => r.json()));
    assert.ok(spec.paths['/api/agent/v1']);
    assert.equal((await fetch(`${f.app.url}/api/graphs`)).status, 404);
  } finally { await f.close(); }
});

test('bad arguments return MCP-like repair information and the corrected request succeeds', async () => {
  const f = await fixture();
  try {
    await f.call('session_open', { title: 'Repair' });
    const id = randomUUID();
    const bad = await f.call('graph_commit', { ...delta(), nodes: 'not-an-array' }, 'test-session', id);
    assert.equal(bad.status, 422); assert.equal(bad.body.isError, true);
    assert.equal(bad.body.error?.code, 'VALIDATION_FAILED');
    assert.ok(bad.body.error?.fieldErrors.some(e => e.path === 'arguments.nodes'));
    assert.ok(bad.body.error?.expectedSchema?.properties);
    assert.equal(bad.body.error?.recovery.action, 'fix_arguments');
    assert.match(bad.body.content[0].text, /nodes/);
    assert.equal(graphView.parse((await f.call('graph_read')).body.result).revision, 0);
    const corrected = await f.call('graph_commit', delta(), 'test-session', id);
    assert.equal(corrected.status, 200);
    assert.equal(graphView.parse((await f.call('graph_read')).body.result).revision, 1);
  } finally { await f.close(); }
});

test('session creation resumes without clearing data and never mixes unknown sessions', async () => {
  const f = await fixture();
  try {
    const opened = await f.call('session_open', { title: 'One' }, 'one');
    const result = z.object({ canvasUrl: z.string(), sessionId: z.string() }).parse(opened.body.result);
    assert.equal(new URL(result.canvasUrl).hash, '#one');
    await f.call('graph_commit', delta(), 'one');
    await f.call('session_open', { title: 'Do not reset' }, 'one');
    assert.equal(graphView.parse((await f.call('graph_read', {}, 'one')).body.result).revision, 1);
    assert.equal((await f.call('graph_read', {}, 'unknown')).status, 404);
    await f.call('session_open', { title: 'Two' }, 'two');
    assert.deepEqual(graphView.parse((await f.call('graph_read', {}, 'two')).body.result).nodes, []);
    assert.equal((await f.call('session_open', { title: 'Bad' }, '../escape')).status, 400);
  } finally { await f.close(); }
});

test('successful mutation retries are durable and request IDs cannot change tools or bodies', async () => {
  const f = await fixture();
  try {
    await f.call('session_open', { title: 'Retry' });
    const id = randomUUID();
    const first = await f.call('graph_commit', delta(), 'test-session', id);
    assert.deepEqual((await f.call('graph_commit', delta(), 'test-session', id)).body, first.body);
    const changed = await f.call('graph_commit', { ...delta(), nodes: [n('Other')] }, 'test-session', id);
    assert.equal(changed.status, 409); assert.equal(changed.body.error?.code, 'REQUEST_ID_REUSED');
    assert.equal((await f.call('graph_layout', { baseRevision: 1, baseLayoutRevision: 0, positions: {} }, 'test-session', id)).body.error?.code, 'REQUEST_ID_REUSED');
    assert.equal(graphView.parse((await f.call('graph_read')).body.result).revision, 1);
  } finally { await f.close(); }
});

test('revision conflicts provide the latest revision and allow a safe re-read and correction', async () => {
  const f = await fixture();
  try {
    await f.call('session_open', { title: 'Conflict' });
    await f.call('graph_commit', delta());
    await f.call('graph_edit', { baseRevision: 1, node: n('Human constraint') }, 'test-session', randomUUID(), 'user');
    const stale = await f.call('graph_commit', { ...delta(1), nodes: [n('Stale')] });
    assert.equal(stale.status, 409); assert.equal(stale.body.error?.code, 'REVISION_CONFLICT');
    assert.equal(stale.body.error?.currentRevision, 2);
    assert.equal(stale.body.error?.recovery.action, 'read_graph');
    const latest = graphView.parse((await f.call('graph_read')).body.result);
    assert.equal(latest.nodes[0].label, 'Human constraint');
    await f.call('graph_commit', { ...delta(latest.revision), nodes: [{ ...latest.nodes[0], detail: 'Human constraint retained' }] });
    assert.equal(graphView.parse((await f.call('graph_read')).body.result).nodes[0].label, 'Human constraint');
  } finally { await f.close(); }
});

test('semantic graph failures are actionable, atomic and do not poison a request retry', async () => {
  const f = await fixture();
  try {
    await f.call('session_open', { title: 'Atomic' });
    const id = randomUUID();
    const bad = await f.call('graph_commit', { ...delta(), edges: [{ id: 'bad', source: 'db', target: 'missing', relation: 'uses', status: 'active' }] }, 'test-session', id);
    assert.equal(bad.status, 422); assert.equal(bad.body.error?.code, 'INVALID_GRAPH');
    assert.equal(bad.body.error?.recovery.retryable, true);
    assert.equal(graphView.parse((await f.call('graph_read')).body.result).nodes.length, 0);
    assert.equal((await f.call('graph_commit', delta(), 'test-session', id)).status, 200);
  } finally { await f.close(); }
});

test('unknown tools, invalid envelopes and invalid JSON return repairable error objects', async () => {
  const f = await fixture();
  try {
    const unknown = await f.call('graph_comit', {});
    assert.equal(unknown.status, 400); assert.equal(unknown.body.error?.code, 'UNKNOWN_TOOL');
    assert.ok(unknown.body.error?.availableTools?.includes('graph_commit'));
    const wrong = await fetch(`${f.app.url}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'graph_read', arguments: [] }) });
    assert.equal(wrong.status, 400);
    const invalid = replySchema.parse(await wrong.json());
    assert.equal(invalid.error?.code, 'INVALID_REQUEST'); assert.ok(invalid.error?.expectedSchema);
    const broken = await fetch(`${f.app.url}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(broken.status, 400);
    assert.equal(replySchema.parse(await broken.json()).error?.code, 'INVALID_JSON');
  } finally { await f.close(); }
});

test('LAN listener accepts headerless HTTP clients but rejects untrusted browser origins and hosts', async () => {
  const f = await fixture('0.0.0.0');
  try {
    const address = f.app.server.address();
    assert.ok(address && typeof address !== 'string'); assert.equal(address.address, '0.0.0.0');
    assert.equal((await f.call('tools_list')).status, 200);
    const post = (headers: Record<string, string>, body = '{}') => fetch(`${f.app.url}/api/agent/v1`, { method: 'POST', headers, body });
    assert.equal((await post({ 'Content-Type': 'application/json', Origin: 'http://evil.example' })).status, 403);
    assert.equal((await post({ 'Content-Type': 'application/json', Origin: 'null' })).status, 403);
    const rawHost = Promise.withResolvers<number>();
    const rawRequest = httpRequest(`${f.app.url}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'evil.example' } }, response => { response.resume(); response.on('end', () => rawHost.resolve(response.statusCode ?? 0)); });
    rawRequest.on('error', rawHost.reject); rawRequest.end('{}');
    assert.equal(await rawHost.promise, 403);
    const media = await post({ 'Content-Type': 'text/plain' });
    assert.equal(media.status, 415); assert.equal(replySchema.parse(await media.json()).error?.code, 'UNSUPPORTED_MEDIA_TYPE');
    const large = await post({ 'Content-Type': 'application/json' }, JSON.stringify({ data: 'x'.repeat(1024 * 1024) }));
    assert.equal(large.status, 413); assert.equal(replySchema.parse(await large.json()).error?.code, 'PAYLOAD_TOO_LARGE');
  } finally { await f.close(); }
});

test('feedback is session-scoped and graph commits acknowledge it only after an atomic success', async () => {
  const f = await fixture();
  try {
    await f.call('session_open', { title: 'Draw' }, 'one');
    await f.call('graph_commit', delta(), 'one');
    const sent = await f.call('feedback_submit', { baseRevision: 1, note: 'Keep this table unchanged', nodeIds: ['db'], strokes: [{ points: [{ x: 10, y: 20 }, { x: 50, y: 60 }] }] }, 'one', randomUUID(), 'user');
    assert.equal(sent.status, 200);
    const feedback = z.object({ id: z.string(), imageUrl: z.string() }).parse(sent.body.result);
    const image = await fetch(feedback.imageUrl); assert.equal(image.status, 200); assert.match(await image.text(), /polyline/);
    const pending = z.object({ feedback: z.array(z.object({ id: z.string() })) }).parse((await f.call('feedback_read', {}, 'one')).body.result);
    assert.equal(pending.feedback[0].id, feedback.id);
    await f.call('session_open', { title: 'Other' }, 'two');
    assert.deepEqual(z.object({ feedback: z.array(z.unknown()) }).parse((await f.call('feedback_read', {}, 'two')).body.result).feedback, []);
    const invalid = await f.call('graph_commit', { ...delta(1), feedbackIds: [feedback.id, 'not-found'] }, 'one');
    assert.equal(invalid.status, 404);
    assert.equal(graphView.parse((await f.call('graph_read', {}, 'one')).body.result).revision, 1);
    assert.equal(z.object({ feedback: z.array(z.unknown()) }).parse((await f.call('feedback_read', {}, 'one')).body.result).feedback.length, 1);
    const result = await f.call('graph_commit', { ...delta(1), feedbackIds: [feedback.id] }, 'one');
    assert.equal(result.status, 200);
    assert.deepEqual(z.object({ feedback: z.array(z.unknown()) }).parse((await f.call('feedback_read', {}, 'one')).body.result).feedback, []);
    assert.equal((await f.call('feedback_ack', { feedbackIds: [feedback.id], status: 'applied', note: 'Wrong session' }, 'two')).status, 404);
  } finally { await f.close(); }
});

test('committed HTTP response and feedback survive service restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'axcanvas-restart-'));
  const path = join(dir, 'db.sqlite');
  let app = await startServer({ port: 0, dbPath: path });
  const send = async (request: unknown) => fetch(`${app.url}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }).then(r => r.json());
  try {
    await send({ tool: 'session_open', sessionId: 'restart', requestId: 'open', arguments: { title: 'Persistence' } });
    const request = { tool: 'graph_commit', sessionId: 'restart', requestId: 'commit', arguments: delta() };
    const first = await send(request);
    const submitted = replySchema.parse(await send({ tool: 'feedback_submit', sessionId: 'restart', requestId: 'feedback', arguments: { baseRevision: 1, note: 'Preserve this instruction after restart' } }));
    const feedbackId = z.object({ id: z.string() }).parse(submitted.result).id;
    await app.close(); app = await startServer({ port: 0, dbPath: path });
    assert.deepEqual(await send(request), first);
    const current = replySchema.parse(await send({ tool: 'graph_read', sessionId: 'restart', requestId: 'read', arguments: {} }));
    assert.equal(graphView.parse(current.result).revision, 1);
    const pending = replySchema.parse(await send({ tool: 'feedback_read', sessionId: 'restart', requestId: 'pending', arguments: {} }));
    assert.equal(z.object({ feedback: z.array(z.object({ id: z.string(), note: z.string() })) }).parse(pending.result).feedback[0].id, feedbackId);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
