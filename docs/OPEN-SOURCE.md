# Open-source release preparation

## Scope and invariants
- Publish source under MIT; preserve third-party licenses, including ELKjs EPL-2.0 and its exact source revision.
- Preserve all local SQLite databases, agent sessions, screenshots and historical verification reports. Exclude them from Git; do not delete or rewrite them.
- Keep the HTTP tool API, revision checks, idempotency, user feedback, native Worker layout, focus and minimap behavior.
- Bind to loopback by default. LAN access remains available through explicit AXCANVAS_HOST=0.0.0.0. No authentication or public-hosting claim is added.
- Replace vulnerable Zod 3 and its JSON Schema converter with patched Zod 4 and native JSON Schema generation. Describe input defaults as optional and output defaults as present.
- Use one standalone Puppeteer runner for the existing browser consumer tests. Tests use temporary DBs and ephemeral ports, never the user's live service or LLM credentials.
- Publish portable setup, contribution/security policies, a changelog and GitHub Actions. Do not create a remote or push without a separate request.

## Acceptance
1. HTTP regression tests prove default loopback, explicit LAN support, executable input/output discovery and downloadable ELK license/source notice.
2. A source-only temporary checkout installs with npm ci, passes npm test/typecheck and the real Chrome browser workflows.
3. Dependency audit has no known production advisories after migration.
4. Initial commit contains only intended source, legal files and public documentation; runtime data, private reports and generated artifacts are excluded.

## Verification boundaries
Local execution does not prove the GitHub-hosted workflow ran or that macOS/Linux passed. The workflow provides those checks on push. No new paid model session or credential is required for release checks.

## Observed local release verification — 2026-11-24
- Copied only the 41 publication candidates to a new temporary source directory; no node_modules, database, artifact, agent session or Git metadata was copied.
- A clean npm ci completed. npm run check passed: 29 Node tests, TypeScript and public JS syntax checks.
- The standalone Chrome runner passed layout preview/apply/cancel/undo/conflicts, node selection and unsaved input, Ctrl focus, middle-button pan, centered fit, minimap, real node editing, drawing submission and atomic feedback acknowledgement.
- The pan helper originally targeted a node hidden under the floating controls after repeated pan/zoom. It now hit-tests a visible node before dragging; all five original pan scenarios remain in the suite.
- npm audit --omit=dev reported zero known production vulnerabilities.
- A limited token/private-environment pattern scan of the publication candidates found no matches. This is not a guarantee that every form of sensitive data is absent.
- Verified locally on Windows with Node 24.16. GitHub Actions has not run; macOS/Linux checks are defined, not claimed as passed. No live user database/server or new paid model session was used.
