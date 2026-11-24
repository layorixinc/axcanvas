import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { startServer } from '../src/server.ts';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'axcanvas-watch-'));
  const app = await startServer({ port: 0, dbPath: join(dir, 'data.sqlite') });
  const call = async (tool, args = {}) => {
    const r = await fetch(app.url + '/api/agent/v1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), sessionId: 'watch', tool, arguments: args }) });
    const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body)); return body.result;
  };
  await call('session_open', { title: 'Watch fixture' });
  return { app, call, close: async () => { await app.close(); await rm(dir, { recursive: true, force: true }); } };
}
function launch(url, session = 'watch', timeout = '10000') {
  const child = spawn(process.execPath, ['scripts/watch.mjs', '--url', url, '--session', session, '--timeout-ms', timeout], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const exited = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve({ code, stdout, stderr })); });
  return { child, exited, output: () => stdout };
}

test('the common watcher prints once and exits only after an explicit reviewed submission', async () => {
  const f = await fixture(); let watcher;
  try {
    watcher = launch(f.app.url);
    let connected = false;
    for (let i = 0; i < 100; i++) { connected = (await fetch(f.app.url + '/api/submissions/status?sessionId=watch').then(r => r.json())).connected; if (connected) break; await new Promise(r => setTimeout(r, 5)); }
    assert.equal(connected, true);
    let d = await f.call('draft_open', { draftId: 'watch-draft' });
    d = await f.call('draft_change', { draftId: d.id, baseDraftVersion: d.version, operation: { type: 'instruction', note: 'One completed user work packet', nodeIds: [], strokes: [] } });
    assert.equal(watcher.output(), '');
    const review = await f.call('draft_review', { draftId: d.id, baseDraftVersion: d.version });
    assert.equal(watcher.output(), '');
    const feedback = await f.call('draft_submit', { draftId: d.id, baseDraftVersion: d.version, reviewToken: review.token });
    const result = await watcher.exited;
    assert.equal(result.code, 0, result.stderr); assert.equal(result.stderr, '');
    const lines = result.stdout.trim().split('\n'); assert.equal(lines.length, 1);
    const notification = JSON.parse(lines[0]); assert.equal(notification.type, 'review_submitted'); assert.equal(notification.feedbackId, feedback.id); assert.ok(notification.cursor > 0);
    assert.equal((await f.call('feedback_read')).feedback[0].status, 'pending');
  } finally { watcher?.child.kill(); await f.close(); }
});

test('watcher deadline is a failure, not a successful empty notification', async () => {
  const f = await fixture(); let watcher;
  try {
    watcher = launch(f.app.url, 'watch', '150');
    const result = await watcher.exited; assert.notEqual(result.code, 0); assert.equal(result.stdout, ''); assert.match(result.stderr, /time|abort/i);
  } finally { watcher?.child.kill(); await f.close(); }
});

test('unknown sessions fail without retrying forever', async () => {
  const f = await fixture(); let watcher;
  try {
    watcher = launch(f.app.url, 'unknown', '3000');
    const result = await watcher.exited; assert.notEqual(result.code, 0); assert.equal(result.stdout, ''); assert.match(result.stderr, /404/);
  } finally { watcher?.child.kill(); await f.close(); }
});
