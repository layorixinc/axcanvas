# Layout data: storage and agent interpretation

[User guide](USER-GUIDE.md#5-choose-a-scope-and-arrange-it) · [HTTP contract](DESIGN.md) · [Automatic layout design](LAYOUT-DESIGN.md)

## Read semantic structure first

Call `graph_read` for the same session before changing anything. Its `result` contains the current published document, not a browser's unpublished draft.

| Field | Meaning |
| --- | --- |
| `nodes[]` | Semantic nodes, stable IDs, text, status, sources, optional tags/colors |
| `edges[]` | Directed semantic relationships: `source`, `target`, `relation`, `status` |
| `flows[]` | Explicit membership and START/END roles, keyed by flow ID |
| `positions[nodeId]` | Whole-graph node top-left `{x,y}` |
| `routes[edgeId]` | Whole-graph line sections and label rectangle |
| `layoutDirection` | Whole-graph `RIGHT`, `DOWN` or `null` |
| `flowLayouts[flowId]` | Turn/custom layout with its own `positions`, `routes`, `direction` |
| `revision` | Semantic content version |
| `layoutRevision` | Global concurrency version protecting geometry across all views |

Node IDs join content to positions; edge IDs join relationships to routes. A shared node has one semantic identity even when it has different positions and boundary roles in several flows. Proximity, palette color and line bends do not encode a relationship: use `edges` and `flows`, not guessed spatial meaning.

### Example excerpt, not a complete graph or mutation request

```json
{
  "positions": {
    "question": {"x": 80, "y": 120},
    "result": {"x": 560, "y": 120}
  },
  "routes": {
    "question-result": {
      "sections": [[{"x": 420, "y": 195}, {"x": 560, "y": 195}]],
      "label": {"x": 442, "y": 170, "width": 96, "height": 20, "text": "supports"}
    }
  },
  "layoutDirection": "RIGHT",
  "flowLayouts": {
    "turn-2": {
      "positions": {"result": {"x": 80, "y": 400}},
      "routes": {},
      "direction": "DOWN"
    }
  }
}
```

The excerpt's `turn-2` is meaningful only if an active flow definition with that ID exists and includes `result`. Directions describe saved view arrangement, not execution order. Both connected-component and matching-tag region layouts preserve the previous whole-view direction even when their selected region is arranged on another axis.

## Coordinates and line shapes

- Coordinates are **SVG world units**, not screen pixels. X increases rightward; Y increases downward. Negative coordinates are valid. The origin is the view's `(0,0)`, not the viewport's current corner after pan/zoom.
- Node positions are the **top-left** of fixed 340 × 150 world-unit rectangles. Node center is `(x + 170, y + 75)`. Width/height are rendering constants, not editable node fields.
- A route's `sections` is an array of point arrays. Draw each array as a separate polyline in its listed order; do not connect the end of one section to the start of the next. Worker output runs from the relationship source toward its target, including bend points. Read the authoritative directed endpoints from `edges[]`.
- Each route label has top-left `x,y`, positive `width,height` and display `text`. Display text can be shortened; the full semantic relation is `edges[].relation`.
- Positions and all route/label coordinates use the same view frame. Extracted Worker compound-node coordinates are already flattened; do not add a parent offset again.
- Coordinates are finite numbers in `[-100000,100000]`. A route allows 1–50 sections of 2–1000 points each; label dimensions are positive and at most 10000. Schemas reject invalid input; the explicit Worker pipeline additionally verifies layout postconditions. Merely saving geometry through `graph_layout` is not proof of a valid ELK computation.
- A missing position is **not `(0,0)`**. The browser can display an unstored grid fallback. A missing route means the renderer draws a basic connection from the current endpoints; that computed curve is not a persisted route. Do not claim those fallback shapes were saved or returned by the API.
- Pan, zoom, selection, active editing tool, search query and Inspector state are UI state, not layout fields. They are not part of `graph_read` or the submitted layout.

## Resolve the intended view

Use `flows` to choose scope explicitly; `graph_read` does not tell you which Scope another browser currently has selected.

1. Whole graph (`null`/omitted flow ID, or a graph-scope ID): use top-level `positions`, `routes`, `layoutDirection`. Membership is all active nodes/edges.
2. Turn/custom flow: use its explicit member IDs and `flowLayouts[flow.id]` if that layout entry exists.
3. If no scoped layout entry exists, use saved global positions for its member nodes, **no scoped routes**, and `direction:null`. This is initial display fallback, not an independently saved layout. An existing scoped entry with missing positions is not filled from global coordinates per node.
4. Never use a retired/missing flow or silently substitute another flow's boundaries. Whole-graph roles come only from the active graph-scope definition; other turns' roles are separate.

### Read-only Node.js example

Run with Node >=24.16 as an ES module (`.mjs`). Set `baseUrl`, `sessionId` and `flowId` to the intended document/view. This reads and reports saved geometry; it does not invent missing positions or call layout.

```js
const baseUrl = 'http://127.0.0.1:43821';
const sessionId = 'YOUR_SESSION_ID';
const flowId = null; // null = Whole graph; or an active turn/custom/graph flow ID
const response = await fetch(baseUrl + '/api/agent/v1', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ requestId: crypto.randomUUID(), sessionId, tool: 'graph_read', arguments: {} })
});
const body = await response.json();
if (!response.ok || body.isError) throw new Error(JSON.stringify(body.error));
const graph = body.result;
const flow = flowId === null ? graph.flows.find(f => f.status === 'active' && f.scope === 'graph')
  : graph.flows.find(f => f.id === flowId && f.status === 'active');
if (flowId !== null && !flow) throw new Error('Unknown or retired flow');
const scoped = flow && flow.scope !== 'graph';
const saved = scoped && Object.hasOwn(graph.flowLayouts, flow.id) ? graph.flowLayouts[flow.id] : null;
const nodes = graph.nodes.filter(n => n.status !== 'retired' && (!scoped || flow.nodeIds.includes(n.id)));
const nodeIds = new Set(nodes.map(n => n.id));
const edges = graph.edges.filter(e => e.status === 'active' && nodeIds.has(e.source) && nodeIds.has(e.target)
  && (!scoped || flow.edgeIds.includes(e.id)));
const positions = scoped ? saved?.positions ?? graph.positions : graph.positions;
const routes = scoped ? saved?.routes ?? {} : graph.routes;
console.log(JSON.stringify({
  revision: graph.revision, layoutRevision: graph.layoutRevision,
  scope: flow?.label ?? 'Whole graph',
  hasIndependentLayout: Boolean(scoped && saved),
  direction: scoped ? saved?.direction ?? null : graph.layoutDirection,
  nodes: nodes.map(n => ({ id: n.id, label: n.label,
    start: flow?.startNodeIds.includes(n.id) ?? false,
    end: flow?.endNodeIds.includes(n.id) ?? false,
    position: Object.hasOwn(positions, n.id) ? positions[n.id] : null })),
  edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target,
    relation: e.relation, route: Object.hasOwn(routes, e.id) ? routes[e.id] : null }))
}, null, 2));
```

## What is saved, and when an agent can read it

| Stage | Storage / API | Publication |
| --- | --- | --- |
| Valid human edits or completed automatic layout | `drafts.payload` and bounded `draft_history` checkpoints; `draft_read.graph` | Unpublished; `graph_read` remains unchanged |
| Review changes | Version-bound `draft_review` token and net changes | Read-only review, no watcher delivery |
| Final Submit | Canonical graph fields + immutable feedback/review snapshots + submission cursor | `graph_read` sees the new document; watcher can deliver one notification |
| Agent canonical write | `graph_commit`, `graph_edit` or `graph_layout` | Immediate canonical change, not a human draft/Submit cycle |

The default physical database is `.axcanvas/graph.sqlite` relative to the server working directory; `AXCANVAS_DB` overrides it. In table `graphs`, content lives in `snapshot`, with separate JSON columns `positions`, `routes`, `flows`, `flow_layouts`, plus `layout_direction` and `layout_revision`. Use the HTTP API rather than editing SQLite behind the running service.

`feedback_read` returns `review.before`, `review.after`, `review.changes`, `captureFlowId`, strokes, notes and `imageUrl` for reviewed submissions. The internal `capture` field is **not returned** by the public API. The server uses that immutable capture to render the SVG. `draft_review` itself returns a token/diff, not those full before/after snapshots; read `draft_read.graph` for the draft view. Simple `feedback_submit` packets need not have a `review`.

The one-shot watcher prints only the feedback ID/cursor and instructions to read it, not the entire graph or image. An agent must call `feedback_read` and `graph_read`; open `imageUrl` with an available image/browser tool if it needs visual evidence. A link is not proof that a model viewed the image. Historical review snapshots must never overwrite later canonical edits.

## Preserve layout when writing

- Read current semantic and layout revisions before writing. `graph_layout` requires **both** `baseRevision` and `baseLayoutRevision`, with `flowId` selecting only one view.
- `mode:"move"` merges supplied positions, clears routes in that view and retains its direction. `mode:"replace"` replaces the view's complete positions/routes/direction; omitted members are not implicitly preserved. It does not run ELK or create semantic history.
- Human automatic layout uses `draft_change` (`layout` or `layout_region`) and final `draft_submit`; use those draft workflows when staging human changes, not canonical `graph_layout` as a shortcut around Review.
- Semantic edits conservatively invalidate routes while keeping saved coordinates, subject to retirement/membership cleanup. Manual moves clear routes in the moved view. A cleared route is not deleted semantic connectivity.
- `graph_history` records semantic revisions, not a checkpoint for every layout-only change. Durable draft Undo/Redo, per-tab Undo layout and immutable submitted review snapshots have different purposes.
- Do not regenerate routes from guesswork or automatically rearrange every answer. Preserve the user's layout unless they request a layout change. Re-read and reconcile conflicts; never repeat stale coordinates blindly.

Source of truth in the repository: [schemas](https://github.com/layorixinc/axcanvas/blob/main/src/schema.ts), [HTTP tool registry](https://github.com/layorixinc/axcanvas/blob/main/src/agent.ts), [storage](https://github.com/layorixinc/axcanvas/blob/main/src/store.ts), [view selection](https://github.com/layorixinc/axcanvas/blob/main/public/flows.js), [canvas rendering](https://github.com/layorixinc/axcanvas/blob/main/public/app.js) and [layout pipeline](https://github.com/layorixinc/axcanvas/blob/main/public/layout.js). Use the matching release tag for a particular installed version; source checkout is not required to run the package.
