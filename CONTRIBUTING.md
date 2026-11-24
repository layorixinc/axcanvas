# Contributing

Use Node.js >=24.16 and npm. From the repository root:

```sh
npm ci
npm run check
npm run test:browser
```

The browser runner uses Puppeteer and a temporary loopback server/database. It requires no running axcanvas instance, agent account or LLM API key. npm installs its matching Chrome; an existing executable may be selected with PUPPETEER_EXECUTABLE_PATH. Browser screenshots are written under ignored test-results/.

- Read AGENTS.md and the relevant design documents before changing behavior.
- Keep the HTTP tool registry as the source of input/output schemas and OpenAPI. Use native Zod JSON Schema generation with the correct input/output mode.
- Preserve stable node IDs, revision checks, transactional retries and user edits. Do not weaken CSP or replace real Worker layout with fake results.
- Human UI authoring must stay in durable drafts until final reviewed submission. Verify no watcher delivery from saves/previews, exact review-token/version checks, atomic publication and preserved drafts on conflicts.
- Use tests/review.test.ts, tests/watch.test.mjs and tests/review.browser.mjs for draft, real watcher-process and browser contracts. Do not mistake fixture HTTP clients for live agent-model validation.
- For bugs, add a consumer-visible regression when existing tests do not cover the path. Run the narrowest relevant checks while iterating; run the commands above before submitting.
- Do not commit SQLite databases, agent histories, private screenshots, tokens or machine-specific configuration. Historical verification files and artifacts are intentionally local-only.
- Explain behavior changes and observed verification in the pull request. Do not claim unrun platforms or model compatibility.

Contributions to original project code are submitted under the MIT license. Preserve the licenses and notices of third-party code; do not copy code you cannot license for this project. See SECURITY.md for private security reporting.
