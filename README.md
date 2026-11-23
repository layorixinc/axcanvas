# axcanvas

**An agent-neutral knowledge canvas.** Agents write answers as nodes and relationships through a local HTTP API; people edit the same graph, draw annotations and submit feedback.

Experimental software. No authentication. Local use by default; explicitly trusted LANs only when enabled. **Do not expose the server to the internet.**

한국어 UI를 제공하는 지식 그래프 캔버스입니다. agent와 사람이 같은 그래프를 편집하며, agent용 MCP·WebMCP·플러그인·skill 추가 설치가 필요하지 않습니다.

## Quick start

Requirements: **Node.js >=24.16** and npm. From the repository root:

```sh
npm ci --omit=dev
npm start
```

Open **http://127.0.0.1:43821**. The default listener is loopback, not all network interfaces. Runtime data is stored in `.axcanvas/graph.sqlite`.

For development and browser tests, use `npm ci` without `--omit=dev`.

## Connect an agent

Ask your existing agent:

> Read http://127.0.0.1:43821/agents.md and use its HTTP tools to write this conversation as a knowledge graph. Reuse one stable sessionId, show me the returned canvasUrl, and read the latest graph and pending feedback before each update.

Use the agent's conversation ID if it is available; otherwise generate a UUID once and reuse it. Resume with the same sessionId or canvas link.

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

Tools:
- `tools_list`, `session_open`
- `graph_read`, `graph_commit`, `graph_edit`, `graph_layout`, `graph_history`
- `feedback_submit`, `feedback_read`, `feedback_ack`

`tools_list` may omit sessionId; other tools require it. sessionId is 1–128 letters, digits, hyphens or underscores, starting with a letter or digit. The returned `canvasUrl` opens that session.

Input/output JSON Schemas are generated from the actual tool contracts. Inspect them rather than guessing field names. Mutations require a unique requestId and, where applicable, the current revision. `graph_layout` requires **both** baseRevision and baseLayoutRevision.

Errors return a non-2xx HTTP status, `isError:true`, readable `content`, `fieldErrors`, `expectedSchema` and recovery instructions. Validation failures apply nothing and do not reserve requestId: fix the input and retry. Replaying a successful mutation requires the exact original body/requestId; changing its tool, arguments or actor returns 409. For revision conflicts, re-read and reconcile rather than overwriting human edits. Prefer `curl -sS` when the agent needs to inspect error bodies.

## Canvas controls

- Click a node to read details, sources and relationships, or edit its label, detail and status.
- Drag nodes to move them. Drag with the **middle mouse button** to pan, including over nodes and in drawing mode. Wheel zooms; **전체 보기** fits the full graph.
- **자동 정렬** previews RIGHT/DOWN layout in a native Web Worker. Apply explicitly, or cancel without saving. Undo restores the current tab's last applied layout. Unsubmitted edits/drawings block rearrangement.
- **연결 집중** is off by default. **Ctrl+node click** focuses the node and its neighbors; ordinary node selection clears focus. Ctrl+Enter/Space works for keyboard selection.
- The **minimap** shows the graph and current viewport. Click to center, drag the viewport to pan, use arrow keys/Home, or collapse it.
- **그리기** creates annotations. Submit selected nodes, strokes and a note with **agent에게 보내기**. Passive artwork is not an agent command.
- Feedback stays pending until acknowledged. Agents can include feedbackIds in graph_commit to atomically apply a graph change and acknowledge feedback. If a drawing is ambiguous or unsupported, ask rather than pretend it was understood.

Layout changes do not change semantic revisions. Semantic edits or manual node movement invalidate old routes while preserving node coordinates. Layout does not verify the truth of claims or sources, and answers are not automatically rearranged after every turn.

## Data and backups

SQLite WAL stores graph history, layout, successful mutation replay results and submitted feedback snapshots. Only agent-submitted graph content is stored; raw conversations are not collected automatically.

Stop the server before manually copying/deleting the database and its WAL/SHM files, or use SQLite-consistent backups. Back up before resetting data. Existing databases are preserved; publishing the repository does not require deleting local work.

`.axcanvas/`, `artifacts/`, local `.omp/` settings, private historical reports and common secret-file formats are excluded from Git. Ignore rules are not a secret scanner; review every publication candidate. Do not commit real session URLs or private screenshots.

## Development

```sh
npm ci
npm run check
npm run test:browser
npm audit --omit=dev
```

The browser runner installs/uses Puppeteer's matching Chrome, creates an isolated temporary database on an ephemeral loopback port and runs actual editing, drawing, layout, focus and minimap workflows. It does not use your live service, LLM credentials or paid model calls. Screenshots go to ignored `test-results/`.

For a preinstalled browser, set `PUPPETEER_EXECUTABLE_PATH`. To skip browser downloads for server/core-only work, set `PUPPETEER_SKIP_DOWNLOAD=true` before installation. The test-only `AXCANVAS_BROWSER_NO_SANDBOX=1` opt-out is reserved for disposable CI; keep sandboxing enabled on your computer.

GitHub Actions defines Windows/macOS/Linux core checks and an Ubuntu browser job. A workflow definition is not evidence that all platforms have already passed.

See [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), [architecture](docs/DESIGN.md), [layout design](docs/LAYOUT-DESIGN.md) and [CHANGELOG.md](CHANGELOG.md).

## License

Original project code: [MIT](LICENSE). Dependencies retain their own licenses. ELKjs is used under EPL-2.0, not relicensed as MIT. See [third-party notices](THIRD-PARTY-NOTICES.txt) and [ELK license](licenses/ELKjs-LICENSE.txt). The running UI also links to these notices.
