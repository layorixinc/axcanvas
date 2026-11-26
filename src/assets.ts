import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const javascript = 'text/javascript; charset=utf-8';
const plain = 'text/plain; charset=utf-8';
const files: Record<string, [URL | string, string]> = {
  '/': [new URL('../public/index.html', import.meta.url), 'text/html; charset=utf-8'],
  ...Object.fromEntries(['app', 'layout', 'flows', 'workspace', 'search', 'regions', 'tags'].map(name => [`/${name}.js`, [new URL(`../public/${name}.js`, import.meta.url), javascript]])),
  '/style.css': [new URL('../public/style.css', import.meta.url), 'text/css; charset=utf-8'],
  '/vendor/elk-api.js': [require.resolve('elkjs/lib/elk-api.js'), javascript],
  '/vendor/elk-worker.js': [require.resolve('elkjs/lib/elk-worker.min.js'), javascript],
  '/third-party-notices.txt': [new URL('../THIRD-PARTY-NOTICES.txt', import.meta.url), plain],
  '/licenses/elkjs.txt': [new URL('../licenses/ELKjs-LICENSE.txt', import.meta.url), plain],
  '/licenses/axcanvas.txt': [new URL('../LICENSE', import.meta.url), plain],
  '/licenses/zod.txt': [new URL('../licenses/Zod-LICENSE.txt', import.meta.url), plain],
  '/watch.mjs': [new URL('../scripts/watch.mjs', import.meta.url), javascript],
};

// Loaded once in development; release builds replace this module with these exact bytes.
export const assets: Record<string, [string, string]> = Object.fromEntries(await Promise.all(
  Object.entries(files).map(async ([route, [path, mime]]) => [route, [await readFile(path, 'utf8'), mime]])
));
