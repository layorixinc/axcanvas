import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../src/server.ts';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'axcanvas-publication-'));
  const app = await startServer({ port: 0, dbPath: join(dir, 'graph.sqlite') });
  return { app, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('default server is reachable on loopback without exposing every network interface', async () => {
  const f = await fixture();
  try {
    const address = f.app.server.address();
    assert.ok(address && typeof address !== 'string');
    assert.equal(address.address, '127.0.0.1');
    assert.equal((await fetch(`${f.app.url}/health`)).status, 200);
  } finally { await f.close(); }
});

test('discovery distinguishes optional input defaults from guaranteed output fields', async () => {
  const f = await fixture();
  try {
    const response = await fetch(`${f.app.url}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: 'discover', tool: 'tools_list', arguments: {} }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    const commit = body.result.tools.find((t: { name: string }) => t.name === 'graph_commit');
    assert.ok(commit.inputSchema.required.includes('nodes'));
    assert.equal(commit.inputSchema.required.includes('retireNodeIds'), false);
    assert.equal(commit.inputSchema.additionalProperties, false);
    const read = body.result.tools.find((t: { name: string }) => t.name === 'graph_read');
    assert.ok(read.outputSchema.required.includes('routes'));
    assert.ok(read.outputSchema.required.includes('layoutDirection'));
    const opened = await fetch(`${f.app.url}/api/agent/v1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: 'open', sessionId: 'publication', tool: 'session_open', arguments: { title: 'Public contract' } }) });
    assert.equal(opened.status, 200);
    const spec = await fetch(`${f.app.url}/openapi.json`).then(r => r.json());
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.paths['/api/agent/v1'].post.requestBody.content['application/json'].schema.oneOf.length > 0);
  } finally { await f.close(); }
});

test('browser recipients can obtain the ELK license and exact source notice', async () => {
  const f = await fixture();
  try {
    const notice = await fetch(`${f.app.url}/third-party-notices.txt`);
    assert.equal(notice.status, 200);
    assert.match(await notice.text(), /https:\/\/github\.com\/kieler\/elkjs\/tree\/[a-f0-9]{40}/);
    const license = await fetch(`${f.app.url}/licenses/elkjs.txt`);
    assert.equal(license.status, 200);
    assert.match(await license.text(), /Eclipse Public License/);
    const page = await fetch(f.app.url).then(r => r.text());
    assert.match(page, /href="\/third-party-notices\.txt"/);
  } finally { await f.close(); }
});
