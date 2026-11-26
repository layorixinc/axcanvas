import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, access, readFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { verifyDistribution } from './distribution-smoke.mjs';
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run test:package');
const { values } = parseArgs({ options: { browser: { type: 'boolean', default: false } }, strict: true });
const temp = await mkdtemp(join(tmpdir(), 'axcanvas-package-'));
try {
  const packed = await exec(process.execPath, [npm, 'pack', '--json', '--pack-destination', temp], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  const info = JSON.parse(packed.stdout)[0], tarball = join(temp, info.filename);
  for (const file of info.files) assert.ok(!/^(?:src\/|tests\/|scripts\/|\.axcanvas\/|artifacts\/|test-results\/)|\.(?:ts|sqlite|pem|key|map)$/.test(file.path), `Unexpected publication file: ${file.path}`);
  const consumer = join(temp, 'consumer');
  await exec(process.execPath, [npm, 'install', '--prefix', consumer, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: temp });
  const version = await exec(process.execPath, [npm, 'exec', '--prefix', consumer, '--offline', '--', 'axcanvas', '--version'], { cwd: temp });
  const expected = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
  assert.equal(version.stdout.trim(), expected);
  for (const dev of ['typescript', 'puppeteer', 'elkjs']) await assert.rejects(access(join(consumer, 'node_modules', dev)));
  const work = join(temp, 'empty-workdir'); await mkdir(work);
  const result = await verifyDistribution(process.execPath, [join(consumer, 'node_modules/axcanvas/dist/src/cli.js')], work, { browser: values.browser });
  await mkdir(join(root, 'artifacts'), { recursive: true }); await copyFile(tarball, join(root, 'artifacts', info.filename));
  console.log(JSON.stringify({ tarball: info.filename, files: info.files.length, packedBytes: info.size, installedBin: 'npm exec passed', ...result }, null, 2));
} finally { await rm(temp, { recursive: true, force: true }); }
