import { parseArgs } from 'node:util';
import { resolve, join, basename } from 'node:path';
import { mkdir, mkdtemp, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assets } from '../src/assets.ts';

const root = resolve(import.meta.dirname, '..');
const platform = { win32: 'windows', linux: 'linux', darwin: 'darwin' }[process.platform];
const { values } = parseArgs({ options: { target: { type: 'string', default: `bun-${platform}-${process.arch}` }, outfile: { type: 'string' }, 'runtime-executable': { type: 'string' } }, strict: true });
const supported = ['bun-windows-x64', 'bun-linux-x64', 'bun-linux-arm64', 'bun-darwin-x64', 'bun-darwin-arm64'];
if (!supported.includes(values.target)) throw new Error(`Supported targets: ${supported.join(', ')}`);
const windows = values.target.includes('-windows-');
let outfile = resolve(values.outfile ?? join(root, 'dist-binaries', values.target.replace('bun-', 'axcanvas-') + (windows ? '.exe' : '')));
if (windows && !outfile.endsWith('.exe')) outfile += '.exe';
const compilerVersion = execFileSync('bun', ['--version'], { cwd: root, encoding: 'utf8' }).trim();
if (compilerVersion !== '1.4.2') throw new Error('Standalone releases require Bun 1.4.2; update compiler and pinned license/source references together.');
const license = await readFile(join(root, 'licenses/Bun-LICENSE.md'), 'utf8');
execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
await mkdir(join(root, '.axcanvas'), { recursive: true });
const stage = await mkdtemp(join(root, '.axcanvas', 'compile-'));
try {
  await cp(join(root, 'dist'), stage, { recursive: true });
  await writeFile(join(stage, 'src/assets.js'), `export const assets = ${JSON.stringify({ ...assets, '/licenses/bun.txt': [license, 'text/plain; charset=utf-8'] })};\n`);
  await mkdir(resolve(outfile, '..'), { recursive: true });
  execFileSync('bun', ['build', join(stage, 'src/cli.js'), '--compile', `--target=${values.target}`, '--outfile', outfile, '--env=disable', '--reject-unresolved', '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig', '--no-compile-autoload-package-json', '--no-compile-autoload-tsconfig', ...(values['runtime-executable'] ? ['--compile-executable-path', resolve(values['runtime-executable'])] : [])], { cwd: root, stdio: 'inherit' });
  const hash = createHash('sha256').update(await readFile(outfile)).digest('hex');
  await writeFile(outfile + '.sha256', `${hash}  ${basename(outfile)}\n`);
  console.log(`Built ${outfile}\nSHA256 ${hash}`);
} finally { await rm(stage, { recursive: true, force: true }); }
