# Automatic layout design

User steps: [Arrange a scope](USER-GUIDE.md#5-choose-a-scope-and-arrange-it). Agent-readable field paths, coordinate conventions, initial fallbacks and delivery snapshots: [Layout data](LAYOUT-DATA.md). This design describes current layout computation; graph_layout only saves caller-supplied geometry.

## Workflow
Choose Left → right or Top → bottom, then run Auto layout. A successful calculation immediately saves positions/routes/labels to the durable draft in one undoable operation; there is no preview/Apply step. Cancel is available only while computing, before any write starts. Undo layout restores this tab's most recent saved draft layout; persistent draft Undo/Redo is separate. Final reviewed Submit still publishes the graph/layout together. Connected component and Matching tags use the same lifecycle for their isolated region: recursive undirected connectivity or direct overlap with the original selected-tag union, respectively. Both are restricted to active current-scope content and show exact target counts.

## Invariants
- Never auto-layout after every answer or change semantic nodes, relationships, sources or feedback.
- Use ELKjs 0.12.1 layered/ORTHOGONAL with 340×150 nodes and font-measured shortened relationship labels. Render returned section start/bend/end points and label boxes.
- Exclude retired nodes/edges from layout input. Handle cycles, parallel edges, self-loops and disconnected nodes while retaining source/target identities.
- Calculate in a real same-origin Worker. Bind job ID, sessionId and graph/layout revisions; discard late results. Preserve existing layout on failure, with no fake fallback success.
- Computing writes nothing. Cancel discards the in-flight Worker and late results without changing the draft or camera. Once saving starts, hide Cancel and keep editing blocked until the atomic request succeeds or fails. Draft save/Undo uses optimistic draft versions; final Submit checks both canonical graph and layout revisions.
- Unstored active forms and drawings block rearrangement. Saved draft text/graph changes may be explicitly laid out. Computing/saving blocks editing, moving, drawing and session changes while preserving pan/zoom. Do not show new geometry or create an Undo marker until the save succeeds.
- A manual node move invalidates stored routes in that view because it may obstruct unrelated edges in the same view. Preserve coordinates and require explicit layout to reroute. It does not clear another view's independently saved geometry.
- Semantic commits invalidate routes while preserving coordinates. Clearing routes increments layoutRevision. Re-reading invalidates stale jobs and undo. A newer draft/canonical revision during computation or saving must preserve that writer's changes and the last valid layout, never overwrite them.
- Never silently display obsolete routes for changed data. Unrouted edges use basic connections until the user requests layout.

## Contract and storage
Graph includes routes and layoutDirection. A route has sections: Position[][] and label: {x,y,width,height,text}. Direction is RIGHT, DOWN or null.
Whole-graph fields live at the graph root; turn/custom fields live under flowLayouts[flowId] with direction rather than layoutDirection. A route's section arrays are independent polylines in the same world-coordinate frame as node top-lefts, not node-local offsets. Missing positions/routes can render unstored fallbacks; they are not saved ELK output.

Agents can still use canonical graph_layout with baseRevision, baseLayoutRevision, mode (move/replace), positions, routes and direction. Human layout uses draft_change with operation.type=layout and is published only by draft_submit.
- move merges supplied positions, clears routes and keeps the existing direction.
- replace exactly replaces positions/routes/direction, including empty maps for undo.
- Validate node/edge IDs, active status, finite coordinates and positive label dimensions. Failures/conflicts apply nothing.
- Add routes/layout_direction to SQLite graphs with non-destructive migration. Preserve old databases, history and successful replay records.
- Compare-and-swap both graph and layout revisions. All callers and tests use this contract without compatibility shims.

## Rendering
public/layout.js shares pure conversion between browser and Node tests. Serve the pinned ELK client/Worker only through explicit same-origin asset URLs. Keep worker-src self and never expose arbitrary node_modules or use an external CDN.

Include routes and label boxes in Fit graph bounds. Shorten displayed labels while exposing the original through SVG titles and the selected node's relationship list. Focus connections is off by default; Ctrl+node click focuses its neighborhood, ordinary selection clears focus. During node drag, draw connections to the current position rather than using stored routes.

## Verification
- Observe initial regression failures for unsupported HTTP layout fields and the missing computation module.
- Use actual ELK output to test direction, overlaps, orthogonal routes, labels, cycles, parallel edges, self-loops and isolated nodes.
- Verify persistence/reopen, exact undo, semantic/layout conflicts, invalidation after moves/commits and preserved feedback snapshots.
- Exercise real browser Workers, deterministic computation cancellation without writes, immediate save/reload/exact Undo, one checkpoint per completed action, saving-state lockout, draft blocking, canonical/draft races, relationship focus and pan. Preserve final reviewed submission and watcher boundaries.

## Immediate-save verification

- Baselines failed against the obsolete Apply control and a stale draft layout save that incorrectly returned HTTP 200 after a canonical change.
- `npm run check` passed: 81 tests, TypeScript and public JavaScript syntax checks. Layout/region/batched saves now check canonical content and layout revisions inside the same transaction before changing any draft state.
- `npm run test:browser` passed all workflows after removing preview-dependent callers. Whole-scope and neighborhood actions save one checkpoint immediately; exact Undo, reload, scoped isolation, final reviewed publication and watcher boundaries remain covered.
- Real Worker targets were paused through CDP to exercise computation cancellation and concurrent canonical changes deterministically. A real intercepted save request verified Saving lockout, unavailable cancellation and HTTP 409 rollback without fake layout results.
- On the deployed server, native uninstrumented Chromium verified whole-scope and three-node neighborhood saves without Apply, one checkpoint each, fixed outside geometry, unchanged canonical data, exact Undo and zero feedback packets. Screenshots and proof remain in ignored artifacts; existing user sessions were not edited.
- No new paid model session or GitHub CI run is claimed.
