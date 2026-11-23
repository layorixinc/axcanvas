# Automatic layout design

## Workflow
Choose Left → right or Top → bottom, run Auto layout, wait for the Worker, then inspect a preview and Apply or Cancel. Apply is one HTTP mutation; positions, routes and labels survive reload. Undo restores this tab's most recent applied layout. Closing the tab clears undo memory, not semantic history.

## Invariants
- Never auto-layout after every answer or change semantic nodes, relationships, sources or feedback.
- Use ELKjs 0.12.1 layered/ORTHOGONAL with 340×150 nodes and font-measured shortened relationship labels. Render returned section start/bend/end points and label boxes.
- Exclude retired nodes/edges from layout input. Handle cycles, parallel edges, self-loops and disconnected nodes while retaining source/target identities.
- Calculate in a real same-origin Worker. Bind job ID, sessionId and graph/layout revisions; discard late results. Preserve existing layout on failure, with no fake fallback success.
- Preview writes nothing. Cancel restores the previous camera and layout. Apply/undo checks both baseRevision and baseLayoutRevision.
- Unsubmitted drawings, instructions or node edits block layout. Computing/preview blocks node editing/moving, drawing and session changes, but keeps pan/zoom available.
- A manual node move invalidates every stored route because it may obstruct unrelated edges. Preserve coordinates and require explicit layout to reroute.
- Semantic commits invalidate routes while preserving coordinates. Clearing routes increments layoutRevision. Re-reading invalidates stale previews and undo.
- Never silently display obsolete routes for changed data. Unrouted edges use basic connections until the user requests layout.

## Contract and storage
Graph includes routes and layoutDirection. A route has sections: Position[][] and label: {x,y,width,height,text}. Direction is RIGHT, DOWN or null.

graph_layout input: baseRevision, baseLayoutRevision, mode (move/replace), positions, routes (default {}) and direction (default null).
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
- Exercise real browser Workers, cancel-without-write, apply/reload/undo, draft blocking, conflict cancellation, relationship focus and pan.
