import { rm, writeFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { assets } from '../src/assets.ts';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
await rm(join(root, 'dist'), { recursive: true, force: true });
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
// No runtime filesystem/module lookup for HTML, browser Workers, licenses or watcher source.
await writeFile(join(root, 'dist/src/assets.js'), `export const assets = ${JSON.stringify(assets)};\n`);
await chmod(join(root, 'dist/src/cli.js'), 0o755);
console.error(`Built Node CLI with ${Object.keys(assets).length} embedded HTTP assets.`);
