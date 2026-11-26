#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import metadata from '../package.json' with { type: 'json' };
import { startServer } from './server.ts';
import { assets } from './assets.ts';
import { runWatcher } from '../scripts/watch.mjs';

const help = `axcanvas ${metadata.version}

Usage: axcanvas [serve] [--host 127.0.0.1|0.0.0.0] [--port N] [--db PATH]
       axcanvas watch --url ORIGIN --session ID [--after N] [--timeout-ms N]
       axcanvas --help | --version | --licenses

Runs in the foreground. Ctrl+C stops the server. No browser or service is installed.
Flags override AXCANVAS_HOST, AXCANVAS_PORT and AXCANVAS_DB.
Default: 127.0.0.1:43821, database .axcanvas/graph.sqlite relative to your current directory.
AXCANVAS_PUBLIC_URL and AXCANVAS_ALLOWED_HOSTS remain supported.
No authentication: use loopback or an explicitly trusted LAN only.
Start watch only with user-approved native background execution; delivery is not acknowledgement.`;

async function main() {
  let args = process.argv.slice(2);
  if (args[0] === 'watch') { await runWatcher(args.slice(1)); return; }
  if (args[0] === 'serve') args = args.slice(1);
  const { values } = parseArgs({ args, strict: true, options: {
    host: { type: 'string' }, port: { type: 'string' }, db: { type: 'string' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, licenses: { type: 'boolean' },
  } });
  if (values.help) { console.log(help); return; }
  if (values.version) { console.log(metadata.version); return; }
  if (values.licenses) {
    for (const [route, [content]] of Object.entries(assets)) if (route === '/third-party-notices.txt' || route.startsWith('/licenses/')) console.log(`\n--- ${route} ---\n${content}`);
    return;
  }
  const host = values.host ?? process.env.AXCANVAS_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '0.0.0.0') throw new Error('--host / AXCANVAS_HOST must be 127.0.0.1 or 0.0.0.0');
  const portText = values.port ?? process.env.AXCANVAS_PORT ?? '43821';
  if (!/^\d+$/.test(portText) || !Number.isSafeInteger(Number(portText)) || Number(portText) > 65535) throw new Error('--port / AXCANVAS_PORT must be an integer from 0 to 65535');
  const path = values.db ?? process.env.AXCANVAS_DB ?? '.axcanvas/graph.sqlite';
  if (!path.trim()) throw new Error('--db / AXCANVAS_DB must not be empty');
  const dbPath = resolve(path);
  const app = await startServer({ host, port: Number(portText), dbPath, publicUrl: process.env.AXCANVAS_PUBLIC_URL, allowedHosts: process.env.AXCANVAS_ALLOWED_HOSTS?.split(',').map(h => h.trim()).filter(Boolean) });
  const stop = () => { app.close().catch(error => { console.error(`axcanvas: ${error.message}`); process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log(`AXCANVAS_READY ${process.env.AXCANVAS_PUBLIC_URL ?? app.url} bind=${host} db=${dbPath}`);
}

try { await main(); }
catch (error) { console.error(`axcanvas: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
