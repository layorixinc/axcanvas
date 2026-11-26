# axcanvas

**An agent-neutral knowledge canvas.** Agents write answers as nodes and relationships through a local HTTP API; people edit the same graph, draw annotations and submit feedback.

Experimental software. No authentication. Local use by default; explicitly trusted LANs only when enabled. **Do not expose the server to the internet.**

The interface and public documentation default to English. User-authored graph content and feedback retain their original language; no agent plugin, MCP/WebMCP server or skill installation is required.

![English-default workflow in the real axcanvas UI](docs/images/english-default-workflow.png)

The screenshot documents the English-default implementation. It is an example graph, not a claim that conversations are captured or translated automatically.

## Quick start

Requirements: **Node.js >=24.16**, npm and Git. Clone the repository and start the local server:

```sh
git clone https://github.com/layorixinc/axcanvas.git
cd axcanvas
npm ci --omit=dev
npm start
```

Open **http://127.0.0.1:43821**. The default listener is loopback, not all network interfaces. Runtime data is stored in `.axcanvas/graph.sqlite`.

For development and browser tests, use `npm ci` without `--omit=dev`.

## Connect an agent

Ask your existing agent:

> Read http://127.0.0.1:43821/agents.md and use its HTTP tools to write this conversation as a knowledge graph. Reuse one stable sessionId and show me its canvasUrl. With my approval, run the documented one-shot watcher as a background command. Read submitted review packets and the latest canonical graph before responding; acknowledge only after processing.

Use the agent's conversation ID if it is available; otherwise generate a UUID once and reuse it. Resume with the same sessionId or canvas link.

### Your first graph

1. Keep the server running and open the local URL.
2. Send the prompt above to an agent that can make HTTP requests. The agent should create a session, submit graph content and give you its canvas link.
3. Open that link. Use **Add node**, **Connect nodes**, node/relationship editors and **Save to draft** to author changes. The canonical graph remains unchanged while you edit.
4. Optionally run **Auto layout**; its completed result saves directly to the draft. Use **Undo layout** if needed. Add notes or a drawing, then choose **Review changes**. Inspect the complete before/after list and return to editing if needed.
5. Click **Submit to agent** only when the whole work is ready. This atomically publishes the reviewed graph/layout and queues one immutable packet. Intermediate saves and opening the review do not notify a watcher.
6. A connected one-shot watcher completes after final Submit. Without a watcher, the submission stays pending until the agent reads it. Keep your session link when resuming; recent-session and draft pointers belong to the browser, not a global session directory.

A new session starts empty. You can author its first node in the UI, ask an agent to send graph_commit, or use the HTTP example below. Server-backed draft changes and bounded Undo/Redo history survive reload; active form text must be saved or included by Review changes before leaving the page.

This is **HTTP tool calling, not the MCP protocol**. The server does not automatically collect a conversation, detect turns, interrupt a running CLI or force an agent to call the API. Whether an agent follows the guide depends on that agent and its available HTTP tools.

An agent on another machine needs explicit LAN mode and the server's reachable address, not its own localhost.

## Enable LAN sharing

Only on a network whose participants you trust:

```sh
# macOS / Linux
AXCANVAS_HOST=0.0.0.0 npm start
```

```powershell
# Windows PowerShell
$env:AXCANVAS_HOST = "0.0.0.0"
npm start
```

Use the server computer's LAN IPv4 address on port 43821. Restrict the firewall to the intended local subnet. Do not disable the firewall or enable router port forwarding.

**Anyone with network access and a sessionId can read and modify that session.** Session IDs separate data; they are not authentication. There is no global session directory, and `actor` is only an informational label. See [SECURITY.md](SECURITY.md).

### Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `AXCANVAS_HOST` | `127.0.0.1` | `0.0.0.0` explicitly enables LAN access |
| `AXCANVAS_PORT` | `43821` | Listener port |
| `AXCANVAS_DB` | `.axcanvas/graph.sqlite` | SQLite database path |
| `AXCANVAS_PUBLIC_URL` | Accepted request origin | Origin returned in links; no path, credentials, query or fragment |
| `AXCANVAS_ALLOWED_HOSTS` | Local interface addresses and localhost | Additional internal DNS hostnames, comma-separated |

The server does not load `.env` automatically. Set environment variables in your shell or process manager. Host/Origin checks, JSON Content-Type validation, a 1MiB request limit and CSP remain active in LAN mode; they do not replace authentication.

## HTTP API

Discovery: `GET /agents.md`, `GET /openapi.json`.

All tool calls use **one endpoint**, `POST /api/agent/v1`:

```sh
curl -sS http://127.0.0.1:43821/api/agent/v1 \
  -H 'Content-Type: application/json' \
  --data-binary '{"requestId":"open-1","sessionId":"demo-session","tool":"session_open","arguments":{"title":"My conversation"}}'
```

This creates or resumes an empty example session. To add its first node on a fresh session:

```sh
curl -sS http://127.0.0.1:43821/api/agent/v1 \
  -H 'Content-Type: application/json' \
  --data-binary '{"requestId":"example-commit-1","sessionId":"demo-session","tool":"graph_commit","arguments":{"baseRevision":0,"answerId":"readme-example","nodes":[{"id":"idea","kind":"concept","label":"A shared knowledge canvas","detail":"Created through the HTTP API. People and agents can edit the same graph.","status":"proposed","sources":[]}],"edges":[]}}'
```

Open http://127.0.0.1:43821/#demo-session to see the node. These curl examples use POSIX shell syntax: use macOS/Linux, Git Bash or WSL. PowerShell users can use this equivalent session-opening call:

```powershell
$body = @{
  requestId = "open-1"
  sessionId = "demo-session"
  tool = "session_open"
  arguments = @{ title = "My conversation" }
} | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri "http://127.0.0.1:43821/api/agent/v1" -Method Post -ContentType "application/json" -Body $body
```

If you have already edited the example session, read its current revision before submitting a different commit. Re-running the exact successful request returns its original result; it does not reset the graph.

Tools:
- `tools_list`, `session_open`
- `graph_read`, `graph_commit`, `graph_edit`, `graph_layout`, `graph_history`
- `feedback_submit`, `feedback_read`, `feedback_ack`
- `draft_open`, `draft_read`, `draft_change`, `draft_step`, `draft_rebase`, `draft_review`, `draft_submit`, `draft_discard`

`tools_list` may omit sessionId; other tools require it. sessionId is 1–128 letters, digits, hyphens or underscores, starting with a letter or digit. The returned `canvasUrl` opens that session.

Input/output JSON Schemas are generated from the actual tool contracts. Inspect them rather than guessing field names. Mutations require a unique requestId and, where applicable, the current revision. `graph_layout` requires **both** baseRevision and baseLayoutRevision.

Errors return a non-2xx HTTP status, `isError:true`, readable `content`, `fieldErrors`, `expectedSchema` and recovery instructions. Validation failures apply nothing and do not reserve requestId: fix the input and retry. Replaying a successful mutation requires the exact original body/requestId; changing its tool, arguments or actor returns 409. For revision conflicts, re-read and reconcile rather than overwriting human edits. Prefer `curl -sS` when the agent needs to inspect error bodies.

## Scoped flows and turn boundaries

**Scope** selects Whole graph, a named turn or a custom flow. Nodes retain one semantic ID: the same node can be **Turn 1 · END** and **Turn 2 · START**. Start/end roles are independent of node type, status and relationship direction.

- Use **Add flow** to name a turn/custom flow and choose its member nodes, relationships and multiple start/end nodes. **Edit flow** changes memberships and boundaries. Whole graph includes all active content.
- The Inspector's start/end checkboxes stage roles for the selected scope. Qualified additional roles remain visible without applying another turn's boundaries to the current view.
- Auto layout constrains only the selected scope. Starts share its leading band; ends share its trailing band, including disconnected members. Turn/custom view geometry is stored separately: arranging Turn 2 does not relocate Whole graph or Turn 1.
- Role, membership and scoped-layout edits use the same durable draft, Undo/Redo, review and final Submit workflow. No agent notification is emitted by intermediate saves.
- Drawings retain their captured scope. Clear a drawing before switching views or changing its coordinate frame; do not reinterpret a Turn 1 drawing as Turn 2.

Agents explicitly provide stable flow IDs and turnId values; revision numbers are not turn numbers. `graph_commit.flows` upserts complete definitions while omitted flows remain unchanged. Example metadata for already-existing graph entities:

```json
{
  "flows": [
    {"id":"turn-1","scope":"turn","turnId":"turn-1","label":"Turn 1","nodeIds":["question","shared"],"edgeIds":["question-shared"],"startNodeIds":["question"],"endNodeIds":["shared"]},
    {"id":"turn-2","scope":"turn","turnId":"turn-2","label":"Turn 2","nodeIds":["shared","conclusion"],"edgeIds":["shared-conclusion"],"startNodeIds":["shared"],"endNodeIds":["conclusion"]}
  ]
}
```

Use `retireFlowIds` to retire definitions explicitly. Retiring member nodes/relationships through an agent commit must repair affected flows in that same transaction. `graph_layout.flowId` selects a turn/custom layout; omit it for Whole graph. A one-member flow may be both START and END; with multiple members, that conflicting layout constraint is rejected without deleting valid metadata or moving nodes.

Existing databases default to no flows; historical memberships are never invented. A turn view shows current shared node content, while immutable history/submissions preserve earlier content. See [scoped-flow design](docs/FLOW-BOUNDARIES.md) and [implementation contract](docs/SCOPED-FLOW-CONTRACT.md).

## Canvas controls

- The compact document row holds **File**, the document title, durable Undo/Redo, the Inspector toggle and one **Review changes** command. **Scope** stays visible; **Arrange**, **View** and drawing options use menus rather than permanent explanatory panels.
- The icon toolbox provides **Select (V)**, **Hand (H)**, **Center selection (F)**, **Add node (N)**, **Connect (C)**, **Draw (P)** and **Erase (E)**. Tooltips and accessible names identify every icon. Hold Space temporarily or middle-drag to pan; wheel zoom and status-bar Fit/zoom controls remain available.
- The target icon immediately below **Hand** is **Center selection (F)**. It pans the selected node—or a multi-selection's bounding box—to the unobstructed canvas center without changing zoom, the active tool, node positions or the draft. It is a one-shot action, not another editing mode. View/context menus offer the same command; it remains available with drawings or incomplete form input.
- **Search graph (Ctrl/Cmd+K)** opens ranked node search across labels, details, IDs, tags, source references and relationship text. Use **Current scope** or **Whole graph**, optionally filter by node type, then click a result or use arrows/Enter to select, inspect and center it without changing zoom. Escape closes search. Ordinary words include tag text; `#backend` matches that exact normalized tag, and `#backend database` requires both the tag and text. See [Graph search](docs/GRAPH-SEARCH.md).
- **Properties → Tags** edits comma-separated classification tags. Tags are shared node metadata, not scope-specific START/END roles. AI agents set `nodes[].tags` through the existing HTTP `graph_commit`; omitted tags preserve existing tags and `[]` clears them. See the [AI tagging example](docs/TAGS-AND-NEIGHBORHOOD.md#assigning-tags-from-an-ai-agent).
- **Add node**: activate the tool, click its canvas position, complete the Properties form and explicitly save. Existing nodes stay in place. **Connect**: choose source and target, or drag a connector handle; label and save the relationship. Escape cancels unfinished gestures. Self-links and parallel relations are supported.
- Valid existing-object properties autosave to the durable draft. One continuous object edit is one Undo action; new objects still require explicit creation. Invalid input stays editable. Input fields retain native text Undo and IME behavior; Ctrl/Cmd+S saves to the draft, never to the agent.
- Shift+click or drag a marquee for multiple selection. Drag the group, use arrows to nudge (Shift for larger steps), or use selection alignment/distribution commands. Copy/Paste/Duplicate assign new IDs, copy internal relationships and add only current-flow membership; boundary roles are not copied.
- **Retire** preserves existing history and repairs incident relationships/memberships. **Erase drawing** removes annotation strokes only; it never deletes nodes or edges. Gestures and multi-object operations are undoable atomic draft edits.
- **Arrange → Auto layout** uses a native same-origin Worker and saves the completed result directly to the current draft view. There is no Apply step. Cancel layout stops computation before saving; once saved, use Undo layout. Durable draft Undo/Redo is separate and survives reload. Nothing is published until final reviewed Submit.
- **Arrange → Layout selected + connected**, the node context menu, or **Shift+L** with canvas/toolbox focus lays out selected active nodes and their immediate incoming/outgoing neighbors in the current scope. It saves that neighborhood as one undoable draft edit; outside nodes and unrelated routes stay fixed. Boundary roles constrain the neighborhood locally; use whole-scope Auto layout for whole-scope boundary bands. See [tags and neighborhood layout](docs/TAGS-AND-NEIGHBORHOOD.md).
- Inspector tabs separate **Properties**, **Agent** instructions/submission history and graph **History**. On narrow screens the Inspector becomes a drawer. File/Connection details contain session IDs, setup and exact status instead of repeating them across the canvas.
- **View → Focus connections** is off by default. Ctrl+node click focuses neighbors; ordinary selection clears focus. The minimap supports click/drag, arrow keys, Home and collapse.
- Notes and drawings retain their captured scope. Clear or submit drawings before changing their coordinate frame; semantic-only rebases preserve them. Switching tools does not clear a drawing.
- **Review changes** includes unsaved valid active forms rather than silently omitting them. Inspect before/after values, layout, notes, strokes and the final snapshot. Final **Submit to agent** is version-checked and replay-safe.
- On a canonical conflict, the draft is retained. **Inspect latest / rebase** shows the latest data; merge nonconflicting changes or explicitly choose draft/latest for conflicts, then review again. Rebase resets old-base Undo history so undo cannot erase remote work.
- Feedback remains pending after delivery. Agents use feedback_read and graph_commit.feedbackIds, or feedback_ack with an explanation, only after processing. Ambiguous drawings require clarification, not invented interpretation.

Layout changes do not change semantic revisions. Semantic edits or manual node movement invalidate old routes while preserving node coordinates. Layout does not verify the truth of claims or sources, and answers are not automatically rearranged after every turn.

See the [compact workspace design](docs/COMPACT-WORKSPACE.md) for interaction and accessibility contracts, and [Center selection usage](docs/CENTER-SELECTION.md#usage) for navigation shortcuts, disabled states and narrow-screen behavior.

## Automatic notification without an agent-specific plugin

Run the same Node.js command using your agent's native **background shell task** capability, not as a blocking foreground tool:

```sh
node scripts/watch.mjs --url http://127.0.0.1:43821 --session YOUR_SESSION_ID --after 0
```

The watcher needs Node >=24.16 on its execution machine, no npm dependencies of its own, and permission to reach the server. From another project, use the absolute path to this repository's script. `/watch.mjs` serves the same source for inspection; do not blindly execute downloaded service code.

It waits silently through empty HTTP long polls. Draft saves, node moves, ordinary graph updates and simple legacy feedback_submit calls do not finish it. One **reviewed submission** produces one JSON line containing feedbackId and a durable cursor, then exits successfully. The agent's own background-completion mechanism delivers that result; there is no shell keystroke injection or agent-specific SDK.

After handling the packet, rearm with `--after` set to its cursor. Stopping the agent can stop its watcher. `--timeout-ms` sets an optional overall deadline; timeout/cancellation fails rather than reporting empty success. Keep only one watcher per session. `Watcher connected` means an HTTP wait is connected, not that a model read or applied anything.

The shared transport is implemented; automatic continuation remains subject to the agent's version, permissions and background-task policy. The application does not bypass tool approvals, interrupt a CLI or impersonate user/system messages. See [review and watcher design](docs/REVIEW-WORKFLOW.md).

## Data and backups

SQLite WAL stores canonical graphs/history, durable drafts and bounded checkpoints, immutable reviewed submissions, replay results and submitted feedback snapshots. The browser stores only draft/session pointers. Raw conversations are not collected automatically.

Stop the server before manually copying/deleting the database and its WAL/SHM files, or use SQLite-consistent backups. Back up before resetting data. Existing databases are preserved; publishing the repository does not require deleting local work.

`.axcanvas/`, `artifacts/`, local `.omp/` settings, private historical reports and common secret-file formats are excluded from Git. Ignore rules are not a secret scanner; review every publication candidate. Do not commit real session URLs or private screenshots.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Startup fails or `node:sqlite` is unavailable | Run `node --version`; use Node.js 24.16 or newer, then install from the repository root. |
| Port 43821 is already in use | Stop your other axcanvas process or choose another `AXCANVAS_PORT`. Use the same port in the browser and agent URL. |
| The canvas is empty | Create a node in the UI or have the agent send graph_commit; session_open does not create example content. |
| The agent cannot reach the server | Test `/health` from the agent's own environment. Its localhost may refer to another machine, container or sandbox. Enable trusted-LAN mode only when needed. |
| A watcher has not returned | Save alone is not Submit. Open Review changes, resolve conflicts and use final Submit to agent. Check the same session ID and the Watcher connected indicator. |
| A draft save conflicts | Inspect the saved draft/latest canonical graph and reconcile versions. Do not discard or overwrite someone else's input automatically. |

For LAN access, verify the server address, explicit bind setting and narrow firewall rule. Do not solve connection problems by exposing the port publicly. See [SECURITY.md](SECURITY.md).

## Development

```sh
npm ci
npm run check
npm run test:browser
npm audit --omit=dev
```

The browser runner uses matching Chrome, temporary databases and ephemeral loopback ports. It exercises complete authoring/review/rebase/submission, real drawing and feedback acknowledgement, native layout, English/multilingual content, focus, pan and minimap. Watcher tests launch the actual common script as a child process. No live user data, LLM credentials or paid model calls are needed; screenshots are ignored under test-results/.

For a preinstalled browser, set `PUPPETEER_EXECUTABLE_PATH`. To skip browser downloads for server/core-only work, set `PUPPETEER_SKIP_DOWNLOAD=true` before installation. The test-only `AXCANVAS_BROWSER_NO_SANDBOX=1` opt-out is reserved for disposable CI; keep sandboxing enabled on your computer.

GitHub Actions defines Windows/macOS/Linux core checks and an Ubuntu browser job. A workflow definition is not evidence that all platforms have already passed.

See [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), [architecture](docs/DESIGN.md), [layout design](docs/LAYOUT-DESIGN.md), [English-default contract](docs/ENGLISH-DEFAULT.md) and [CHANGELOG.md](CHANGELOG.md).

## License

Original project code: [MIT](LICENSE). Dependencies retain their own licenses. ELKjs is used under EPL-2.0, not relicensed as MIT. See [third-party notices](THIRD-PARTY-NOTICES.txt) and [ELK license](licenses/ELKjs-LICENSE.txt). The running UI also links to these notices.
