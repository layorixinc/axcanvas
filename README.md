# axcanvas

**An agent-neutral knowledge canvas.** Agents write nodes and relationships through ordinary HTTP; people edit the graph, arrange it, annotate it and submit one reviewed packet.

**Experimental. No authentication.** Loopback by default; explicitly trusted LANs only. Do not expose this service to the internet. Session IDs separate documents, not permissions.

The interface and documentation use English. Your graph content and instructions keep their original language. No MCP/WebMCP server, agent plugin or skill installation is required.

## Start here

| I want to… | Read |
| --- | --- |
| Install and connect an agent | [Quick start](#quick-start) |
| Learn the workspace, editing and submission | [User guide](docs/USER-GUIDE.md) |
| Find commands and keyboard shortcuts | [Workspace map](docs/USER-GUIDE.md#2-find-your-way-around) · [Keyboard reference](docs/USER-GUIDE.md#keyboard-reference) |
| Understand saved coordinates, line shapes and AI delivery | [Layout data](docs/LAYOUT-DATA.md) |
| Call the API or integrate an agent | [HTTP example](#http-api) · live `/agents.md` · [Architecture](docs/DESIGN.md) |
| Share safely, back up or troubleshoot | [LAN configuration](#lan-and-configuration) · [Data and recovery](#data-and-recovery) |
| Contribute or report a security issue | [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) |

![Example graph in the real axcanvas UI](docs/images/english-default-workflow.png)

This is an earlier example screenshot, not a complete picture of the current toolbar or evidence of automatic conversation capture.

## Quick start

### npm package

Requires **Node.js >=24.16** and npm, but no Git, compiler or checkout. Once a release is published:

```sh
npx axcanvas@latest
# Or install once:
npm install -g axcanvas
axcanvas
```

Before the first registry publication, install the locally built tarball instead: `npm install -g ./axcanvas-0.1.0.tgz`. Package support does not mean the registry release already exists.

### Standalone executable

Download the executable matching your OS/CPU and its `.sha256` from [GitHub Releases](https://github.com/layorixinc/axcanvas/releases). Standalone releases are built with Bun but require **neither Node nor Bun** on your computer.

```powershell
# Windows x64
.\axcanvas-windows-x64.exe
```

```sh
# Example: Apple Silicon; choose darwin-x64 for Intel or linux-x64/linux-arm64 for Linux
chmod +x ./axcanvas-darwin-arm64
./axcanvas-darwin-arm64
```

Artifacts are unsigned unless the release explicitly says otherwise. Check the checksum against a trusted release; a checksum is not a publisher signature. No release is created merely by building locally.

Both variants run in the foreground. Open **http://127.0.0.1:43821**, keep the process running and use Ctrl+C to stop. Data defaults to `.axcanvas/graph.sqlite` in the directory you launched from—not the installed package or executable directory. Startup prints the resolved DB path. A new session is empty, not a preloaded conversation.

```sh
axcanvas --help
axcanvas --version
axcanvas --port 43822 --db ./my-canvas.sqlite
```

For source development: clone this repository, run `npm ci`, then `npm start` (the same CLI via source). Developer/build dependencies are required for source mode; `npm ci --omit=dev` is only for consumers of a prebuilt package.

### Connect an agent

Give an agent with HTTP access this prompt:

> Read http://127.0.0.1:43821/agents.md and use its HTTP tools to maintain this conversation as a knowledge graph. Reuse one stable sessionId, preserve existing IDs and human edits, and show me the canvasUrl. Before each answer, read graph_read and feedback_read. Start the documented one-shot watcher only with my approval, using your native background-command mechanism. Acknowledge submitted feedback only after processing.

Use the actual conversation ID when available; otherwise generate a UUID once and reuse it. Keep the returned canvas link when resuming. An agent on another machine/container needs the server's reachable address, not its own localhost.

The server does **not** collect transcripts, detect turns, interrupt a CLI or force an agent to call the API. Automatic continuation depends on the agent's available tools and background-task policy.

### The everyday workflow

1. Open the canvas link. Select a node to edit **Properties**, or use **Add node / Connect** to create content.
2. Existing valid fields autosave to a **durable draft**. New objects require an explicit save. Check the bottom save state.
3. Choose **Scope**, then optionally **Arrange → Auto layout** or **Layout selected + connected**. Completion saves directly to the draft; there is no Apply step.
4. Add instructions in **Inspector → Agent** or draw annotations. Choose **Review changes** to inspect the complete work.
5. Choose **Submit to agent** to publish once and queue one immutable packet. Saving or opening Review does not notify the watcher.

**Saved to draft ≠ submitted ≠ applied by an agent.** See the [step-by-step user guide](docs/USER-GUIDE.md) for selection, search, tag colors, START/END roles, Undo, conflicts and resuming.

## LAN and configuration

Only enable LAN access on a network whose participants you trust:

```sh
axcanvas --host 0.0.0.0
```

For an executable use the same flags, for example `./axcanvas-linux-x64 --host 0.0.0.0`. From source use `npm start -- --host 0.0.0.0`. `--host`, `--port` and `--db` override their environment variables; existing AXCANVAS_* configuration still works.

Use the server computer's LAN IPv4 address on port 43821. Restrict firewall access to the intended subnet; do not disable the firewall, enable router port forwarding or use a public tunnel. Anyone with network access and the session ID can read/write it. See [SECURITY.md](SECURITY.md).

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `AXCANVAS_HOST` | `127.0.0.1` | Supported binds: loopback or explicit `0.0.0.0` |
| `AXCANVAS_PORT` | `43821` | Listener port |
| `AXCANVAS_DB` | `.axcanvas/graph.sqlite` | Database path, relative to the server working directory unless absolute |
| `AXCANVAS_PUBLIC_URL` | Accepted request origin | Origin used in returned links; no credentials, path, query or fragment |
| `AXCANVAS_ALLOWED_HOSTS` | Local IPv4 addresses, loopback and localhost | Additional internal hostnames, comma-separated |

The server does not load `.env` automatically or terminate TLS itself. Set variables in the launching shell/process manager. Host/Origin checks, JSON validation, a 1 MiB request limit and CSP remain active; none is authentication.

## HTTP API

Discovery: `GET /agents.md`, `GET /openapi.json`; health: `GET /health`. All tool calls use **one endpoint**, `POST /api/agent/v1`. This is HTTP tool calling, not the MCP protocol.

### Create or resume a session

POSIX shell (macOS/Linux, Git Bash or WSL):

```sh
curl -sS http://127.0.0.1:43821/api/agent/v1 \
  -H 'Content-Type: application/json' \
  --data-binary '{"requestId":"open-1","sessionId":"demo-session","tool":"session_open","arguments":{"title":"My conversation"}}'
```

Windows PowerShell:

```powershell
$body = @{
  requestId = "open-1"
  sessionId = "demo-session"
  tool = "session_open"
  arguments = @{ title = "My conversation" }
} | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri "http://127.0.0.1:43821/api/agent/v1" -Method Post -ContentType "application/json" -Body $body
```

### Add the first node

On a fresh example session, send:

```sh
curl -sS http://127.0.0.1:43821/api/agent/v1 \
  -H 'Content-Type: application/json' \
  --data-binary '{"requestId":"example-commit-1","sessionId":"demo-session","tool":"graph_commit","arguments":{"baseRevision":0,"answerId":"readme-example","nodes":[{"id":"idea","kind":"concept","label":"A shared knowledge canvas","detail":"Created through the HTTP API.","status":"proposed","sources":[]}],"edges":[]}}'
```

Open http://127.0.0.1:43821/#demo-session. This agent-side commit publishes immediately; human UI edits instead use the draft/review workflow. If the session already changed, read `graph_read` and use its current revision before a different commit. An exact successful replay returns its original result and does not reset the document.

| Tool group | Tools |
| --- | --- |
| Discovery / session | `tools_list`, `session_open` |
| Canonical graph | `graph_read`, `graph_commit`, `graph_edit`, `graph_layout`, `graph_history` |
| Human draft | `draft_open`, `draft_read`, `draft_change`, `draft_step`, `draft_rebase`, `draft_review`, `draft_submit`, `draft_discard` |
| Feedback | `feedback_submit`, `feedback_read`, `feedback_ack` |

- `tools_list` may omit sessionId; other tools require it. Session IDs are 1–128 letters, digits, hyphens or underscores, beginning with a letter/digit.
- Read actual `inputSchema`/`outputSchema` from `tools_list`; do not guess fields. The runtime guide is generated from [src/agent.ts in the repository](https://github.com/layorixinc/axcanvas/blob/main/src/agent.ts), not the contributor-only AGENTS.md. Source checkout is not needed by installed consumers.
- Calls carry `requestId`, `sessionId`, `tool`, `arguments` and optional informational `actor`. A successful mutation replay must reuse the exact original tool/arguments/actor. Changed reuse returns 409.
- Errors use non-2xx HTTP status, `isError:true` and `error` fields including paths/schema/recovery where available. Validation failures apply nothing and do not reserve requestId. Re-read/reconcile revision conflicts; never blindly overwrite human edits.
- `graph_read` separates semantic nodes/edges/flows from layout. `graph_layout` saves geometry, does not compute it, and requires both `baseRevision` and `baseLayoutRevision`. See [layout fields, coordinate conventions and read-only example](docs/LAYOUT-DATA.md).

## Optional automatic notification

With user approval, an agent can run this through its **native background shell**:

```sh
axcanvas watch --url http://127.0.0.1:43821 --session YOUR_SESSION_ID --after 0
```

For a standalone executable use its actual absolute path instead of axcanvas; it needs no Node/Bun installation. The agent machine must have the CLI/executable—it is not enough to install it only on the server. An inspected, approved local copy of `/watch.mjs` can alternatively run with Node >=24.16 and no npm dependencies. Serving source is not permission to blindly download/execute it.

It waits silently through empty polls and returns one JSON line with `feedbackId` and `cursor` only after a **reviewed submission**. The agent then reads `feedback_read` and `graph_read`, processes or clarifies it, acknowledges honestly, and rearms with `--after` set to the returned cursor.

Keep one watcher per session. `--timeout-ms` sets an optional total deadline; cancellation/timeout is failure, not empty success. Simple `feedback_submit` calls do not complete this watcher. “Watcher connected” proves an HTTP wait, not model execution. See [review/watcher contract](docs/REVIEW-WORKFLOW.md).

## Data and recovery

SQLite stores published graphs/layouts, semantic history, durable drafts/checkpoints, replay records and immutable feedback snapshots. Browser storage holds session/draft pointers, not a complete document backup. Raw transcripts are not collected automatically.

Stop the server before copying/restoring the database and any WAL/SHM siblings, or use a SQLite-consistent backup. Back up before resetting anything. `.axcanvas/`, `artifacts/`, `test-results/`, local `.omp/` settings and private reports are excluded from Git; ignore rules are not a secret scanner.

| Symptom | Next step |
| --- | --- |
| Startup or `node:sqlite` failure | For npm, check `node --version` (>=24.16); for a standalone executable, check the OS/CPU and release requirements. No repository root is needed. |
| Port already in use | Stop your other axcanvas process or set `AXCANVAS_PORT`; update browser/agent URLs together. |
| Empty canvas | Open the correct session; create a node or ask the agent for `graph_commit`. `session_open` creates no example content. |
| Agent cannot connect | Test `/health` from the agent's environment; check its localhost/container/LAN boundary. |
| Watcher stays silent | Save is not Submit. Review, then Submit using the same session; check for a duplicate watcher. |
| Draft conflicts | Inspect latest, merge nonconflicting changes, explicitly resolve remaining conflicts, then review again. |
| Layout will not run | Finish form edits, clear/submit captured strokes, and check selected scope/START+END feasibility. |
| Saved coordinates seem absent | Check the intended Flow's `flowLayouts`, not only global `positions`; display fallback is not stored geometry. |

Detailed recovery and Undo distinctions: [User guide](docs/USER-GUIDE.md#7-recover-and-resume).

## Development and reference

```sh
npm ci
npm run check
npm run test:browser
npm audit --omit=dev
npm run test:package -- --browser
# Developers building executables also install pinned Bun 1.4.2:
npm run build:binary
npm run test:binary -- --browser
```

The browser runner uses Chrome, temporary databases and ephemeral loopback ports without live user data, LLM credentials or paid model calls. Set `PUPPETEER_EXECUTABLE_PATH` for an existing browser, or `PUPPETEER_SKIP_DOWNLOAD=true` before installing for server-only work. Keep sandboxing enabled; `AXCANVAS_BROWSER_NO_SANDBOX=1` is reserved for disposable CI.

GitHub Actions defines Windows/macOS/Linux core checks and an Ubuntu browser job; a workflow definition is not proof those runs passed. Feature documents' verification sections are historical records, not the current suite count.

See [distribution/build/release instructions](docs/DISTRIBUTION.md). Release automation verifies native Windows x64, Linux glibc x64/arm64 and macOS x64/arm64 artifacts, with real browser checks on Linux x64. Publication is a separate manual opt-in workflow on a matching version tag, not an effect of npm pack or ordinary Git pushes. These workflow definitions do not claim that foreign-platform runs have already passed.

[Contributor contract](AGENTS.md) · [Architecture](docs/DESIGN.md) · [Layout design](docs/LAYOUT-DESIGN.md) · [Flows](docs/FLOW-BOUNDARIES.md) · [Search](docs/GRAPH-SEARCH.md) · [Tags and neighborhood layout](docs/TAGS-AND-NEIGHBORHOOD.md) · [Changelog](CHANGELOG.md)

## License

Original project code: [MIT](LICENSE). Dependencies retain their licenses. ELKjs is used under EPL-2.0, not relicensed as MIT. See [third-party notices](THIRD-PARTY-NOTICES.txt) and [ELK license](licenses/ELKjs-LICENSE.txt).

Standalone builds additionally contain Bun and LGPL-covered runtime components; use `axcanvas --licenses` and the [runtime/relinking notice](docs/DISTRIBUTION.md#runtime-licensing-and-relinking).
