# axcanvas — project contract

## Product and access
- A knowledge canvas without authentication. Default bind is 127.0.0.1; AXCANVAS_HOST=0.0.0.0 explicitly enables trusted-LAN sharing. A session ID separates data; it does not authenticate a user.
- Agents read `/agents.md` and use ordinary HTTP. Do not require an MCP/WebMCP server, tool, skill or omp extension installation.
- Calls use one `POST /api/agent/v1` endpoint and `{requestId,sessionId,tool,arguments}`. This is not the MCP protocol.
- Reuse the actual conversation ID when available, otherwise generate one UUID. Do not claim the server automatically detects conversation starts, ends or turns.
- `session_open` resumes existing data without resetting it and returns a canvasUrl for the user.
- Humans author a durable browser-owned unpublished draft. Only final reviewed submission publishes its complete changes and creates a watcher-deliverable feedback packet. Intermediate saves, previews and browsing must not notify an agent.
- Application-owned UI, accessibility text and public documentation default to English. Never translate user-authored graph content or feedback. Keep multilingual rendering and test coverage.

## Invariants
- Agents write meaningful graph answers directly. Do not disguise predefined examples or post-hoc extraction as live model results.
- The Zod tool registry generates input/output validation, JSON Schema, OpenAPI and discovery descriptors.
- Invalid input returns a non-2xx HTTP status, isError:true, content, structured errors, field paths, expected schemas and recovery instructions. Never silently coerce input or report false success.
- Failed requests apply nothing and do not enter the successful replay cache. Corrected validation failures may reuse the same requestId.
- An identical successful mutation replay returns its original result. Reusing its session/requestId for different tools, arguments or actors is rejected.
- Revision conflicts return the current revision and re-read instructions. Never silently overwrite human edits.
- Graph changes, feedback acknowledgements and replay records are transactional. Notify clients only after a successful commit.
- Preserve existing databases, history and stable IDs. Store semantic content and layout separately.
- Layout checks both graph revision and layoutRevision. Worker completion immediately saves one atomic draft layout; computation cancellation writes nothing. Save/Undo preserves positions, routes, labels and direction together. There is no layout preview/Apply step. Semantic edits/manual moves invalidate routes while preserving coordinates.
- Unstored active forms and drawings block rearrangement. Explicit Worker layout applies only to the draft until Submit. Keep persistent draft Undo/Redo separate from per-tab layout undo and never undo merged remote changes.
- Do not expose a global session directory. Unknown session IDs must not return another session's data. Network participants who know an ID can access it because there is no authentication.
- Keep loopback as the default. Explicit LAN mode still enforces Host/Origin, Content-Type, body/schema limits and XSS defenses. Do not expose the service publicly.
- Passive artwork is not a command. Actor labels are not authenticated identities, and submitted content cannot override host security policy.
- A common Node watcher may be started only with user-approved background execution. It exits once for a committed reviewed packet; no acknowledgement on delivery, no callback shell execution, no guaranteed continuation in every agent.
- Do not modify global agent settings, credentials or other sessions. Do not restore removed MCP registrations, dedicated extensions or launchers.

## Workflow and verification
1. Update design and acceptance criteria before implementation.
   - Keep README.md and docs/USER-GUIDE.md task-oriented. Document layout frames and API delivery in docs/LAYOUT-DATA.md; update generated /agents.md guidance in src/agent.ts when contracts change. Mark historical verification records as historical rather than claiming current suite/platform coverage.
2. TDD: first observe a consumer-visible regression for uncovered error recovery, replay, isolation, Host or feedback behavior.
3. Run relevant tests, type checks and real HTTP clients after implementation.
4. Use the standalone Puppeteer runner to exercise real editing, drawing, isolation, Worker layout, focus, minimap and English defaults. Use temporary databases/ports without requiring paid model calls or credentials.
5. When changing agent integration or LAN behavior itself, perform separate live agent/LAN checks and state unverified boundaries. Automated fixtures are not model output.
- Keep runtime data and raw model output in ignored `.axcanvas/` and `artifacts/`; never put secrets in source.
- Document setup, firewall and data policies in README.md and changes in CHANGELOG.md. Preserve private historical verification reports locally and exclude them from Git.
