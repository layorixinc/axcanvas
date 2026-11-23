# axcanvas local HTTP tool contract

## Product
An agent controls a local or explicitly trusted-LAN canvas without extra plugins. Each conversation uses one stable sessionId and a canvas URL shared with its user. MCP, WebMCP and dedicated omp extensions are not required. Network participants who know the ID can read and edit it; there is no authentication.

## Discovery and calls
- GET /agents.md provides workflow, curl/Node examples, recovery instructions, security boundaries and tool descriptions. Reading it does not grant execution authority.
- GET /openapi.json generates tool-specific request/response variants for one POST endpoint.
- POST /api/agent/v1 accepts required requestId, sessionId for session tools, tool, object arguments and an optional informational agent/user actor.
- tools_list needs no session. Descriptors include descriptions, input/output JSON Schemas, readOnlyHint and idempotentHint. Native Zod 4 generation distinguishes optional input defaults from guaranteed output fields.
- Tools: session_open, graph_read, graph_commit, graph_edit, graph_layout, graph_history, feedback_submit, feedback_read and feedback_ack. The human UI uses the same contract; actor is not identity verification.
- GET /api/events?sessionId=... emits only that session's change notifications. GET /feedback/{id}.svg?sessionId=... safely renders the graph and strokes captured at submission.

## Sessions and storage
- External callers use sessionId; internal graphId maps to existing SQLite graphs and history.
- session_open creates or resumes idempotently without replacing the existing title or content.
- Successful mutations store their result under (sessionId,requestId), with a normalized tool/arguments/actor hash. Identical retries return the original response; changed reuse returns 409.
- Validation failures and revision conflicts are not cached. Corrected validation input can reuse requestId; reconstructed conflicting edits should use a new ID.
- Replay records, graph deltas and feedback acknowledgements share one transaction. Exceptions roll back everything. SSE is emitted after the outermost commit.
- graph_commit preserves stable IDs, baseRevision checks, retired history and atomic deltas. Optional feedbackIds acknowledge feedback in the same transaction.
- Layout uses a separate layoutRevision. Human semantic edits participate in the same optimistic concurrency and history rules.

## Errors and recovery
- Failures contain ok:false, isError:true, content text, identifiable requestId/sessionId and error.
- Errors include code, message, fieldErrors, expectedSchema, recovery instructions and relevant currentRevision/availableTools.
- HTTP statuses: 400 malformed requests/tools/JSON; 403 forbidden origins/hosts; 404 unknown sessions/items; 409 revision/layout/request-ID conflicts; 413 oversized bodies; 415 unsupported media; 422 validation/graph/layout failures; 500 internal errors.
- Envelope errors return the envelope schema; argument errors return the selected tool's schema. Retryable means follow the recovery steps, not repeat invalid requests indefinitely.
- Raw SQLite/internal errors are logged to stderr rather than exposed to clients.

## Human collaboration and language
The canvas opens a session URL and stores only a browser-local list of recently opened sessions. People inspect/edit/move nodes and explicitly submit selected node IDs, notes and pen strokes. Feedback preserves graphRevision, coordinates and a graph snapshot. It does not inject messages into a running CLI; agents read pending feedback before responding.

All application-owned text and public documentation default to English. User-authored titles, labels, details, relationships, sources and feedback remain in their original language. History times use en-US formatting with the local time zone. See ENGLISH-DEFAULT.md.

## Network boundary
Node >=24.16, TypeScript and SQLite. Default listener: 127.0.0.1:43821. AXCANVAS_HOST=0.0.0.0 explicitly enables LAN access. AXCANVAS_PUBLIC_URL defines returned origins when configured; otherwise use the accepted request Host.

Allowed hosts include localhost, loopback, local IPv4 addresses and explicitly configured hostnames. Browsers must use the same allowed Origin; external/null origins and cross-site requests are rejected. Headerless curl/HTTP clients are allowed. JSON bodies are limited to 1MiB. Safe session IDs are never used as file paths. Restrict access to one computer or a trusted LAN and narrow firewall rules; do not change firewalls without user approval.

## Verification
- Exercise actionable schema errors and successful correction using the same requestId.
- Reject stale writes and preserve human edits after re-reading; never mix session data.
- Verify durable replay, changed-ID reuse, unknown tools, invalid origins/hosts/media/JSON and oversized bodies.
- Verify atomic graph/feedback changes, isolation and persistence after reopening the DB.
- The standalone Chrome runner tests actual editing, drawing, Worker layout, focus, minimap and English chrome with multilingual user data in temporary databases.
- For agent/LAN integration changes, separately verify a real agent or external LAN client and state unverified limits. Synthetic fixtures are not live model output.
