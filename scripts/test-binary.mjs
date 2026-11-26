import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { mkdtemp, copyFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { verifyDistribution } from './distribution-smoke.mjs';
const root = resolve(import.meta.dirname, '..');
const platform = { win32: 'windows', linux: 'linux', darwin: 'darwin' }[process.platform];
const { values } = parseArgs({ options: { binary: { type: 'string', default: join(root, 'dist-binaries', `axcanvas-${platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`) }, browser: { type: 'boolean', default: false } }, strict: true });
const temp = await mkdtemp(join(tmpdir(), 'axcanvas-binary-'));
try {
  const binary = join(temp, process.platform === 'win32' ? 'axcanvas.exe' : 'axcanvas');
  await copyFile(resolve(values.binary), binary); await chmod(binary, 0o755);
  console.log(JSON.stringify({ binary: values.binary, ...await verifyDistribution(binary, [], temp, { browser: values.browser, standalone: true }) }, null, 2));
} finally { await rm(temp, { recursive: true, force: true }); }
