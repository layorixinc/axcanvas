# Distribution contract

## Deliverables

One shared CLI, two deliverables: an npm package of prebuilt Node ESM JavaScript and a Bun-compiled standalone executable per supported OS/architecture. Consumers need no source checkout, compiler or development dependencies. npm users need Node >=24.16; standalone users need neither Node nor Bun.

## Runtime and assets

- `axcanvas` (or `axcanvas serve`) runs in the foreground. `--host`, `--port`, `--db` override the corresponding existing environment variables. Default host remains 127.0.0.1; only explicit 0.0.0.0 enables trusted LAN use. `--help` and `--version` must not create a database or bind a port.
- `axcanvas watch --url ORIGIN --session ID [--after N] [--timeout-ms N]` reuses the one-shot watcher. Approval, silent empty waits, exactly one reviewed notification and no automatic acknowledgement remain unchanged. The dependency-free `/watch.mjs` source remains available for remote agents that cannot install the CLI.
- Runtime assets are loaded once and represented by one shared manifest. Source development resolves ELK through module resolution, not an assumed node_modules layout. Release builds embed the exact HTML/CSS/JS, ELK API/Worker, license/notices and standalone watcher source in a generated module. Both deliverables use that module; neither reads runtime assets from the repository or executable's working directory. Browser Worker URLs/CSP remain same-origin; no blob worker or CSP relaxation.
- Default database remains `.axcanvas/graph.sqlite` relative to invocation cwd, never the npm installation or npx cache. Print the resolved data path at startup. No automatic migration to a home directory, browser launch, daemon registration, network exposure or firewall modification.
- Keep existing storage/HTTP/semantic/layout schemas and node:sqlite. No Bun-specific database adapter or HTTP rewrite. Stop normally on SIGINT/SIGTERM. Compiled CLI termination must close owned HTTP waits and database; Windows forced process termination is separately distinguished from graceful Unix signal handling.

## Build and package

- A dedicated TypeScript emit config builds source and shared JavaScript into dist, rewriting relative .ts imports. Normal typecheck remains noEmit. Runtime dependencies remain external for Node; ELK is a build-time asset dependency. Build a static assets module so Bun can embed all browser assets without external files.
- npm `bin` points to the built CLI with a Node shebang. A `files` allowlist includes only dist, selected user docs, metadata and licenses. Exclude original TS, tests, generated screenshots, credentials and runtime data. Build in prepack, not consumer install/postinstall. No Puppeteer/Bun/TypeScript installation in production dependencies.
- Bun compilation consumes that same built CLI, embeds dependencies, and includes required MIT/EPL-2.0 notices. Compiler target/name is explicit for releases; local build defaults to host platform. Bundle completion is not proof that a foreign target executes.
- Release artifacts: Windows x64, Linux glibc x64/arm64, macOS x64/arm64. Each must run on a matching hosted runner before publication. No unsupported OS/CPU fallback. Record checksums; no signing claim without actual signing credentials.
- npm publication uses manual opt-in plus npm trusted publishing configuration. Workflow must validate tag/version before external release. Ordinary source pushes never publish packages. Building locally does not publish or reserve the npm name.

## Acceptance and TDD

1. First demonstrate failure installing the current tarball and invoking `axcanvas --version` without checkout scripts.
2. Build and pack; install the tarball into an empty consumer with production dependencies and install scripts disabled. Exercise npm's installed bin, help/version, default/overridden data path, static/legal/Worker assets, Host/Origin/schema enforcement, canonical data, draft/review/submission and one-shot CLI watch. Restart and verify persisted data.
3. Run the standalone binary from an empty working directory with no node_modules or source assets. Exercise the same API/CLI/data cases. Test invalid flags fail without creating a DB; retain current source API/watcher tests.
4. Use real Chrome against both installed server variants for native ELK Worker layouts and reviewed node/relationship authoring. Tests may import repository browser helpers but runtime servers may not load repository modules.
5. Inspect the actual tarball allowlist and demonstrate installs/runs without dev dependencies. CI repeats package and native host smoke on supported platforms; CI definitions do not imply completed foreign-platform runs.
6. Update installation, runtime agent instructions and release documentation; preserve existing source development commands through the common CLI. Never run npm publish or create a release merely to test packaging.

## Local build and consumer checks

From a checkout with Node >=24.16:

```sh
npm ci
npm run check
npm run test:package -- --browser
# Requires Bun 1.4.2:
npm run build:binary
npm run test:binary -- --browser
```

`test:package` builds through prepack, installs the actual tarball into an empty consumer using production dependencies and disabled install scripts, invokes npm's installed command, and exercises the runtime from another empty directory. It leaves the tested tarball under `artifacts/`. `test:binary` copies only the executable into an empty directory and repeats the consumer scenarios. Browser mode uses real Chrome and native ELK Workers, not a simulated layout. Temporary DBs are isolated; neither check publishes anything.

Source development is `npm start -- [serve options]`. Built Node invocation is `node dist/src/cli.js`. A native build writes `dist-binaries/axcanvas-OS-ARCH[.exe]` and a SHA-256 sidecar. Build another target explicitly, for example:

```sh
npm run build:binary -- --target bun-linux-arm64
# A custom output is optional:
npm run build:binary -- --target bun-windows-x64 --outfile dist-binaries/axcanvas-windows-x64.exe
```

Supported targets are bun-windows-x64, bun-linux-x64, bun-linux-arm64, bun-darwin-x64 and bun-darwin-arm64. Linux artifacts target glibc, not Alpine/musl. OS/runtime support follows the pinned Bun release; a current hosted-runner result does not prove compatibility with every older OS. No signing/notarization is configured. `--version` reports the application version, not compiler version; the compiler is pinned in build-binary.mjs and release.yml.

## Publishing

1. Update application version and lockfile together; review notices, compiler pin and relevant platform support. Create/push its matching `vVERSION` tag only after review.
2. The Distribution release workflow builds and verifies five native targets. Tag pushes and default manual runs upload **workflow artifacts only**, not an npm package or public GitHub Release.
3. Configure the GitHub `release` environment with required reviewers. Configure npm trusted publishing for repository layorixinc/axcanvas, workflow release.yml and environment release, explicitly permitting direct npm publish. The first registry package/name/account setup must be completed by its owner; an empty registry lookup does not grant ownership.
4. Manually run Distribution release on the matching tag with `publish` enabled. After all native jobs pass and environment approval, it verifies hashes and publishes the exact tested npm tarball with install/build scripts disabled, then creates the GitHub Release containing binaries, checksums and notices. A branch/ref mismatch fails before publication. No long-lived npm token is embedded.
5. GitHub's tag source archives identify the corresponding application source/build scripts. Retain those tags and the pinned compiler source references so recipients can rebuild modified versions.

Npm publication and GitHub release creation are external irreversible/public operations; they are not run by local checks or ordinary main-branch pushes. Workflow configuration is not evidence that the npm account, approvals or foreign runners have been exercised. If publication partially succeeds, inspect registry/release state before retrying; published versions cannot be overwritten.

## Runtime licensing and relinking

Original application code is MIT; ELK remains EPL-2.0 and Zod MIT. `axcanvas --licenses` prints embedded notices/license texts without starting a server. Standalone builds also expose /licenses/bun.txt with the exact upstream Bun 1.4.2 licensing inventory; [the checked-in notice](../licenses/Bun-LICENSE.md) links runtime dependencies and LGPL-covered JavaScriptCore/WebKit. Do not describe the entire executable as MIT-only.

Corresponding application source and build scripts are available from this repository's matching release tag. The compiler source is [Bun bun-v1.4.2](https://github.com/oven-sh/bun/tree/bun-v1.4.2); use its pinned WebKit revision and upstream build instructions in the notice to build a modified runtime. To relink the application:

```sh
# In the matching application source checkout; use Bun 1.4.2 as compiler:
npm ci
npm run build:binary -- --runtime-executable /absolute/path/to/modified/bun
```

Use a replacement runtime for the same target platform, or specify its matching --target. That option passes the replacement executable to Bun's --compile-executable-path instead of silently downloading/reusing the standard runtime. No application restriction on debugging or reverse engineering LGPL runtime modifications is imposed. Preserve source availability and relevant notices when redistributing; compiler changes require a fresh licensing/support review.

## Observed local verification — 2026-11-26

- Before implementation, a production-only installation of the original tarball could not run axcanvas --version: npm reported that it could not determine an executable.
- Source checks passed: 83 tests, TypeScript and public browser JavaScript syntax checks. The first package probe exposed prepack logging on stdout (fixed to stderr); a Host-header probe was changed to a real node:http request because fetch did not send the requested Host override.
- The actual npm tarball installed with production dependencies and install scripts disabled. npm exec invoked its CLI; TypeScript, Puppeteer and ELK were absent from consumer dependencies. Default/overridden DB paths, help/version/invalid options, all 16 embedded assets, Host/Origin/schema failures, durable layout/review/one-shot watch and restart persistence passed.
- A Bun 1.4.2 Windows x64 executable, copied alone into a fresh temporary directory, passed the same consumer scenarios, embedded runtime-license access and independence from invocation-directory .env settings. Windows subprocess tests force-terminate processes; they do not prove graceful SIGTERM behavior on Unix.
- Real Chrome ran 8 native Worker layout scenarios and 6 reviewed authoring scenarios against each installed variant, including cancellation, exact Undo, canonical races, node/relationship editing, rebase and final submission. Screenshots are local test-results/distribution-package.png and distribution-binary.png.
- Release workflow YAML parsed successfully. Native macOS/Linux runners, modified-runtime relinking, signing/notarization and actual registry/GitHub publication were not exercised locally. No user document was edited, no paid model session was started, and neither npm publish nor GitHub Release creation ran.
