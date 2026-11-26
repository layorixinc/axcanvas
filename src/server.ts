import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GraphStore, GraphError } from './store.ts';
import { AgentAPI, errorResponse, sessionIdSchema, publicFeedback } from './agent.ts';
import { feedbackImage } from './feedback-image.ts';

const assets: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/layout.js': ['layout.js', 'text/javascript; charset=utf-8'],
  '/flows.js': ['flows.js', 'text/javascript; charset=utf-8'],
  '/workspace.js': ['workspace.js', 'text/javascript; charset=utf-8'],
  '/search.js': ['search.js', 'text/javascript; charset=utf-8'],
  '/neighborhood.js': ['neighborhood.js', 'text/javascript; charset=utf-8'],
  '/tags.js': ['tags.js', 'text/javascript; charset=utf-8'],
  '/vendor/elk-api.js': ['../node_modules/elkjs/lib/elk-api.js', 'text/javascript; charset=utf-8'],
  '/vendor/elk-worker.js': ['../node_modules/elkjs/lib/elk-worker.min.js', 'text/javascript; charset=utf-8'],
  '/third-party-notices.txt': ['../THIRD-PARTY-NOTICES.txt', 'text/plain; charset=utf-8'],
  '/licenses/elkjs.txt': ['../licenses/ELKjs-LICENSE.txt', 'text/plain; charset=utf-8'],
  '/watch.mjs': ['../scripts/watch.mjs', 'text/javascript; charset=utf-8']
};
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) { req.resume(); throw new GraphError('UNSUPPORTED_MEDIA_TYPE', 'Send Content-Type: application/json'); }
  const limit = 1024 * 1024;
  if (Number(req.headers['content-length'] ?? 0) > limit) { req.resume(); throw new GraphError('PAYLOAD_TOO_LARGE', 'JSON body must be at most 1 MiB'); }
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const data = Buffer.from(chunk); size += data.length;
    if (size > limit) { req.resume(); throw new GraphError('PAYLOAD_TOO_LARGE', 'JSON body must be at most 1 MiB'); }
    chunks.push(data);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new GraphError('INVALID_JSON', 'Send a valid JSON object, not shell-escaped fragments'); }
}
export interface ServerOptions { port?: number; dbPath?: string; host?: '0.0.0.0' | '127.0.0.1'; publicUrl?: string; allowedHosts?: string[] }
export async function startServer(options: ServerOptions = {}) {
  const store = new GraphStore(options.dbPath ?? resolve('.axcanvas/graph.sqlite'));
  const api = new AgentAPI(store);
  const publicUrl = options.publicUrl ? new URL(options.publicUrl) : undefined;
  if (publicUrl && (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash)) { store.close(); throw new Error('AXCANVAS_PUBLIC_URL must be an HTTP(S) origin without path or credentials'); }
  const streams = new Map<ServerResponse, string>();
  const waiters = new Map<string, { res: ServerResponse; after: number; timer: ReturnType<typeof setTimeout> }>();
  function finishWait(sessionId: string, status: number, payload: unknown) {
    const waiter = waiters.get(sessionId); if (!waiter) return;
    waiters.delete(sessionId); clearTimeout(waiter.timer);
    if (!waiter.res.destroyed) json(waiter.res, status, payload);
  }
  function deliverSubmission(sessionId: string) {
    const waiter = waiters.get(sessionId); if (!waiter) return;
    const next = store.nextSubmission(sessionId, waiter.after);
    if (next) finishWait(sessionId, 200, { cursor: next.cursor, feedback: publicFeedback(next.feedback, publicUrl?.origin ?? `http://${waiter.res.req.headers.host}`) });
  }
  store.onChange = graphId => {
    const sessionId = store.read(graphId).sessionId;
    for (const [res, subscribed] of streams) if (subscribed === sessionId && !res.destroyed) res.write(`data: ${JSON.stringify({ sessionId })}\n\n`);
    deliverSubmission(sessionId);
  };
  const addresses = new Set(['127.0.0.1', 'localhost', ...(options.allowedHosts ?? [])]);
  for (const list of Object.values(networkInterfaces())) for (const item of list ?? []) if (item.family === 'IPv4') addresses.add(item.address);
  let allowedHosts = new Set<string>();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    let raw: unknown;
    try {
      const host = req.headers.host?.toLowerCase() ?? '';
      const origin = req.headers.origin;
      if (!allowedHosts.has(host) || (origin !== undefined && origin !== `http://${host}` && origin !== publicUrl?.origin) || req.headers['sec-fetch-site'] === 'cross-site') {
        const error = errorResponse('FORBIDDEN', 'Use this LAN server host and its same-origin page'); json(res, error.status, error.body); return;
      }
      const baseUrl = publicUrl?.origin ?? `http://${host}`;
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (req.method === 'GET' && Object.hasOwn(assets, url.pathname)) {
        const [file, mime] = assets[url.pathname];
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
        res.end(await readFile(new URL(`../public/${file}`, import.meta.url))); return;
      }
      if (req.method === 'GET' && url.pathname === '/health') { json(res, 200, { service: 'axcanvas', status: 'pass', apiVersion: '1' }); return; }
      if (req.method === 'GET' && url.pathname === '/agents.md') { res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(api.guide(baseUrl)); return; }
      if (req.method === 'GET' && url.pathname === '/openapi.json') { json(res, 200, api.openapi(baseUrl)); return; }
      if (req.method === 'GET' && (url.pathname === '/api/submissions/wait' || url.pathname === '/api/submissions/status')) {
        const sessionId = sessionIdSchema.parse(url.searchParams.get('sessionId'));
        store.readSession(sessionId);
        if (url.pathname.endsWith('/status')) { json(res, 200, { connected: waiters.has(sessionId) }); return; }
        const afterText = url.searchParams.get('after') ?? '0', timeoutText = url.searchParams.get('timeoutMs') ?? '25000';
        const after = Number(afterText), timeoutMs = Number(timeoutText);
        if (!/^\d+$/.test(afterText) || !Number.isSafeInteger(after) || !/^\d+$/.test(timeoutText) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 25000) throw new GraphError('INVALID_REQUEST', 'after must be a nonnegative safe integer and timeoutMs must be 1..25000');
        if (waiters.has(sessionId)) {
          const error = errorResponse('WATCHER_BUSY', 'One watcher is already waiting for this session', { sessionId }, { recovery: { retryable: false, action: 'stop_duplicate_watcher', instructions: 'Keep one background watcher per session. Stop the existing watcher before starting another.' } });
          json(res, 409, error.body); return;
        }
        const timer = setTimeout(() => finishWait(sessionId, 200, { cursor: after, feedback: null }), timeoutMs);
        timer.unref(); waiters.set(sessionId, { res, after, timer });
        res.on('close', () => { if (waiters.get(sessionId)?.res === res) { clearTimeout(timer); waiters.delete(sessionId); } });
        deliverSubmission(sessionId); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const sessionId = sessionIdSchema.parse(url.searchParams.get('sessionId'));
        store.readSession(sessionId);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(': connected\n\n'); streams.set(res, sessionId); req.on('close', () => streams.delete(res)); return;
      }
      const image = /^\/feedback\/([A-Za-z0-9-]+)\.svg$/.exec(url.pathname);
      if (req.method === 'GET' && image) {
        const sessionId = sessionIdSchema.parse(url.searchParams.get('sessionId'));
        const item = store.feedbackItem(sessionId, image[1]);
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline' }); res.end(feedbackImage(item)); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/agent/v1') {
        raw = await body(req);
        const reply = api.call(raw, baseUrl); json(res, reply.status, reply.body); return;
      }
      const error = errorResponse('NOT_FOUND', 'Route not found; agent calls use POST /api/agent/v1'); json(res, error.status, error.body);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof GraphError) { const reply = errorResponse(error.code, error.message, raw); json(res, reply.status, reply.body); }
      else if (error instanceof Error && error.name === 'ZodError') { const reply = errorResponse('INVALID_REQUEST', 'Invalid URL/session parameters; use a valid sessionId'); json(res, reply.status, reply.body); }
      else { console.error('[axcanvas] HTTP failure', error); const reply = errorResponse('INTERNAL_ERROR', 'The server could not complete this request', raw); json(res, reply.status, reply.body); }
    }
  });
  const heartbeat = setInterval(() => { for (const res of streams.keys()) if (!res.destroyed) res.write(': heartbeat\n\n'); }, 15000); heartbeat.unref();
  try {
    const ready = Promise.withResolvers<void>();
    server.once('error', ready.reject);
    server.listen(options.port ?? 43821, options.host ?? '127.0.0.1', () => {
      const address = server.address(); const port = typeof address === 'object' && address ? address.port : options.port;
      allowedHosts = new Set([...addresses].map(host => `${host.toLowerCase()}:${port}`));
      if (publicUrl) allowedHosts.add(publicUrl.host.toLowerCase());
      server.off('error', ready.reject); ready.resolve();
    });
    await ready.promise;
  } catch (error) { clearInterval(heartbeat); store.close(); throw error; }
  const address = server.address(); const port = typeof address === 'object' && address ? address.port : options.port;
  const url = `http://127.0.0.1:${port}`;
  let closed = false;
  return { server, store, url, close: async () => {
    if (closed) return; closed = true; clearInterval(heartbeat);
    for (const sessionId of [...waiters.keys()]) finishWait(sessionId, 503, { error: 'Server is stopping; pending submissions remain saved' });
    for (const res of streams.keys()) res.end();
    server.closeIdleConnections();
    const stopped = Promise.withResolvers<void>(); server.close(error => error ? stopped.reject(error) : stopped.resolve());
    await stopped.promise; store.close();
  } };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const host = process.env.AXCANVAS_HOST ?? '127.0.0.1';
  if (host !== '0.0.0.0' && host !== '127.0.0.1') throw new Error('AXCANVAS_HOST must be 0.0.0.0 or 127.0.0.1');
  const app = await startServer({ port: Number(process.env.AXCANVAS_PORT ?? 43821), dbPath: process.env.AXCANVAS_DB, host, publicUrl: process.env.AXCANVAS_PUBLIC_URL, allowedHosts: process.env.AXCANVAS_ALLOWED_HOSTS?.split(',').map(h => h.trim()).filter(Boolean) });
  console.log(`AXCANVAS_READY ${process.env.AXCANVAS_PUBLIC_URL ?? app.url} bind=${host}`);
  const stop = async () => app.close();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
