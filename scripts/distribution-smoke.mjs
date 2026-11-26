import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { access, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assets } from '../src/assets.ts';

import { runDistributionBrowser } from './distribution-browser.mjs';
const exec = promisify(execFile);
export async function verifyDistribution(command, prefix, cwd, { browser = false, standalone = false } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AXCANVAS_')));
  const run = args => exec(command, [...prefix, ...args], { cwd, env, timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  const version = (await run(['--version'])).stdout.trim(); assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.match((await run(['--help'])).stdout, /axcanvas watch/);
  await assert.rejects(access(join(cwd, '.axcanvas')));
  await assert.rejects(run(['--host', 'public.example']));
  await assert.rejects(run(['--port', '65536']));
  await assert.rejects(run(['watch', '--session', 'not a session']));
  await assert.rejects(access(join(cwd, '.axcanvas')));
  const licenses = (await run(['--licenses'])).stdout;
  assert.ok(licenses.includes('Eclipse Public License') && licenses.includes('MIT License'));
  if (standalone) assert.ok(licenses.includes('/licenses/bun.txt'));
  // Neither runtime should load invocation-directory .env, bunfig or package scripts.
  await writeFile(join(cwd, '.env'), 'AXCANVAS_DB=unexpected.sqlite\nAXCANVAS_HOST=0.0.0.0\n');
  async function start(extra = [], extraEnv = {}) {
    const child = spawn(command, [...prefix, '--port', '0', ...extra], { cwd, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stderr.on('data', chunk => { errors += chunk; });
    const ready = await new Promise((done, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('CLI readiness timeout: ' + output + errors)); }, 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`CLI exited before ready: ${code}/${signal} ${output} ${errors}`)); });
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/AXCANVAS_READY (http:\/\/127\.0\.0\.1:\d+) bind=([^\s]+) db=(.+)\r?\n/);
        if (match) { clearTimeout(timer); done({ url: match[1], host: match[2], db: match[3].trim() }); }
      });
    });
    return { ...ready, child, stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const ended = once(child, 'exit'); child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
      try { const [code] = await ended; if (process.platform !== 'win32') assert.equal(code, 0, errors); }
      finally { clearTimeout(timer); }
    } };
  }
  let app = await start(), watcher;
  const processes = [app];
  const sessionId = 'distribution-' + crypto.randomUUID();
  let graph;
  try {
    assert.equal(app.host, '127.0.0.1'); assert.equal(app.db, join(cwd, '.axcanvas', 'graph.sqlite'));
    await access(app.db); await assert.rejects(access(join(cwd, 'unexpected.sqlite')));
    const endpoint = tool => app.url + tool;
    for (const [route, [content, mime]] of Object.entries(assets)) {
      const response = await fetch(endpoint(route)); assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('content-type'), mime, route); assert.equal(await response.text(), content, route);
      if (route === '/') assert.ok(!response.headers.get('content-security-policy').includes('blob:'));
    }
    const refusedHost = await new Promise((done, reject) => {
      const request = httpRequest(endpoint('/health'), { headers: { Host: 'evil.example' } }, response => { response.resume(); response.on('end', () => done(response.statusCode)); });
      request.on('error', reject); request.end();
    });
    assert.equal(refusedHost, 403);
    assert.equal((await fetch(endpoint('/health'), { headers: { origin: 'https://evil.example' } })).status, 403);
    const call = async (tool, args = {}) => {
      const response = await fetch(endpoint('/api/agent/v1'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), sessionId, tool, arguments: args }) });
      const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data.result;
    };
    await call('session_open', { title: 'Installed distribution' });
    const node = id => ({ id, kind: 'concept', label: id, detail: '', status: 'confirmed', sources: [], tags: ['backend'] });
    await call('graph_commit', { baseRevision: 0, answerId: 'seed', nodes: [node('a'), node('b')], edges: [{ id: 'ab', source: 'a', target: 'b', relation: 'supports', status: 'active' }] });
    const bad = await fetch(endpoint('/api/agent/v1'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: 'bad', sessionId, tool: 'graph_commit', arguments: { baseRevision: 1, nodes: 'invalid', edges: [] } }) });
    assert.equal(bad.status, 422); assert.equal((await call('graph_read')).revision, 1);
    watcher = spawn(command, [...prefix, 'watch', '--url', app.url, '--session', sessionId, '--timeout-ms', '20000'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let watchOutput = '', watchError = ''; watcher.stdout.on('data', data => { watchOutput += data; }); watcher.stderr.on('data', data => { watchError += data; });
    const watcherDone = once(watcher, 'exit');
    let d = await call('draft_open', { draftId: 'installed-draft' });
    const change = async operation => { d = await call('draft_change', { draftId: d.id, baseDraftVersion: d.version, operation }); };
    await change({ type: 'node', node: { ...d.graph.nodes[0], label: '검증済 · Installed', tagColors: { backend: 'coral' } } });
    await change({ type: 'layout', positions: { a: { x: 80, y: 120 }, b: { x: 560, y: 120 } }, routes: { ab: { sections: [[{ x: 420, y: 195 }, { x: 560, y: 195 }]], label: { x: 440, y: 170, width: 100, height: 20, text: 'supports' } } }, direction: 'RIGHT' });
    await change({ type: 'instruction', note: 'One reviewed installed submission', nodeIds: ['a'], strokes: [] });
    assert.equal((await call('graph_read')).nodes[0].label, 'a');
    const review = await call('draft_review', { draftId: d.id, baseDraftVersion: d.version });
    const packet = await call('draft_submit', { draftId: d.id, baseDraftVersion: d.version, reviewToken: review.token });
    const [watchCode] = await watcherDone; assert.equal(watchCode, 0, watchError);
    const delivery = JSON.parse(watchOutput.trim()); assert.equal(delivery.feedbackId, packet.id);
    assert.equal((await call('feedback_read')).feedback[0].status, 'pending');
    const image = await fetch(packet.imageUrl); assert.equal(image.status, 200); assert.ok((await image.text()).includes('<polyline'));
    graph = await call('graph_read'); assert.equal(graph.nodes[0].label, '검증済 · Installed'); assert.equal(graph.routes.ab.sections[0][1].x, 560);
    let browserCases;
    if (browser) {
      browserCases = await runDistributionBrowser(app.url, standalone ? 'binary' : 'package');
    }
    await app.stop();
    app = await start(); processes.push(app);
    assert.deepEqual(await call('graph_read'), graph);
    await app.stop();
    app = await start(['--host', '127.0.0.1', '--db', 'custom.sqlite'], { AXCANVAS_DB: 'wrong.sqlite', AXCANVAS_HOST: '0.0.0.0' }); processes.push(app);
    assert.equal(app.host, '127.0.0.1'); assert.equal(app.db, join(cwd, 'custom.sqlite')); await access(app.db); await assert.rejects(access(join(cwd, 'wrong.sqlite')));
    return { version, assets: Object.keys(assets).length, api: 'draft/layout/review/watch/security passed', restart: 'data preserved', browser: browserCases ?? 'not requested', shutdown: process.platform === 'win32' ? 'forced Windows process termination' : 'graceful SIGTERM' };
  } finally {
    if (watcher && watcher.exitCode === null && watcher.signalCode === null) { const ended = once(watcher, 'exit'); watcher.kill(); await ended; }
    for (const process of processes) await process.stop();
  }
}
