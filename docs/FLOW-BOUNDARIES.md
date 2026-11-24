# Explicit graph start and end boundaries

Status: design only. No runtime or storage changes have been implemented for this feature.

## Meaning
A start node is an explicit entry point for reading a flow; an end node is an explicit destination or conclusion. These are not edge source/target IDs, execution state, completion status or a new node kind. Preserve concept/claim/decision/question/task and proposed/confirmed/retired independently.

Do not infer boundaries from zero indegree/outdegree. Knowledge graphs can contain references, cycles and disconnected content. Existing graphs and non-flow knowledge maps may leave boundaries unset; show Not set rather than inventing meaning. Agent guidance should explicitly set meaningful starts/ends when producing a flow.

## Representation
Add semantic graph metadata:

```json
{
  "flow": {
    "startNodeIds": ["question"],
    "endNodeIds": ["conclusion", "alternative-conclusion"]
  }
}
```

Use graph-level ID sets rather than overloading node.kind or adding artificial START/END graph nodes. This preserves old node payloads and avoids resetting a marker when an older client updates an unrelated node field.

- Support multiple starts and ends for branches and disconnected subflows.
- The same active node can be both start and end, including a single-node flow or a return-to-origin explanation.
- IDs must exist in the resulting graph and refer to non-retired nodes. Reject duplicates and foreign/missing IDs with actionable field errors; never silently coerce input.
- Input graph_commit.flow is optional: omission preserves existing metadata, presence replaces both sets, and two explicit empty lists clear the markers.
- Nodes/edges created in the same commit can be referenced by its flow metadata. Validate the complete resulting graph, not operation order.
- Agent retirement of a marked node must explicitly update/clear its boundary membership in the same commit; reject dangling metadata atomically. Human Retire node stages the corresponding marker removals and exposes them in Review changes.

## Agent API and persistence
- Extend graph_read and generated tool/OpenAPI contracts with flow. Extend graph_commit for atomic metadata-only or combined node/edge/flow commits. Do not add a separate out-of-band marker API or bypass revision checks.
- Treat a boundary change as semantic: increment revision, record flowChanged and before/after metadata in history, invalidate stale routes without moving saved coordinates, and preserve successful request replay behavior.
- Add a non-destructive SQLite metadata column defaulting to empty sets. Existing graphs, old snapshots and submitted packets default to unmarked; do not retroactively rewrite their meaning.
- Agent instructions: read current graph, set appropriate starts/ends explicitly, preserve other boundaries on unrelated updates, and never fabricate flow semantics for a pure relationship map.

## Human draft and review integration
- Add draft_change operation {type:"flow",flow:{startNodeIds,endNodeIds}}.
- Inspector controls: Mark as start, Mark as end and Clear flow role. Both checks may be enabled; existing node type/status controls remain separate.
- Add a Flow boundaries summary listing starts/ends by label and ID. Unset roles are visible as Not set.
- Keep all human marker changes draft-local until final Submit. They participate in durable Undo/Redo, net-zero diff, reload, review token invalidation, both canonical revision checks and one-shot notification.
- Review includes a dedicated flow before/after change, not a fabricated node edit. Removing a newly created marked node leaves no phantom boundary change.
- Rebase must merge independent role additions/removals safely and surface incompatible changes for explicit resolution. Never allow Undo after rebase to restore a stale base and erase remote markers.
- Submitted feedback includes immutable before/after flow metadata; later changes cannot alter the historical packet.

## Canvas presentation
- Place START, END or START + END badges in the existing node header area. Preserve node IDs, kinds, dimensions, labels, connection arrows and existing coordinates.
- Use text and a distinct outline/icon treatment, not color alone. Include boundary role in accessible names and inspector text. All application labels remain English; original node text is unchanged.
- Distinguish boundary markers in the minimap without relying on tiny text or conflicting with selection/focus styling.
- The review snapshot and submitted feedback SVG must show the same boundary badges as the canvas. Include them in fitting/geometry if the eventual badge design extends outside the node; prefer an inset design to avoid changing bounds.
- Changing metadata must not auto-rearrange a user's graph. Saved positions remain stable until explicit layout.

## Boundary-aware automatic layout: mandatory constraints
Start/end metadata is an actual Auto layout input, not merely a badge or an ordering preference. Whenever active boundaries exist, Auto layout must honor them and validate the resulting geometry before offering a successful preview.

### Placement contract
- RIGHT: all marked starts share the leading (leftmost) boundary layer; all marked ends share the trailing (rightmost) boundary layer.
- DOWN: all marked starts share the leading (topmost) layer; all marked ends share the trailing (bottommost) layer.
- Unmarked nodes belong between the marked layers when both exist. If only one boundary type is set, enforce that boundary and leave the opposite side unconstrained.
- Multiple starts/ends share their respective layer, with spacing on the perpendicular axis. A short disconnected flow must not put its end earlier than the shared end layer of a longer flow.
- Unmarked disconnected nodes remain in the middle region instead of being packed before starts or after ends.
- With no boundary metadata, retain the existing layout behavior. Manual movement remains permitted and never silently changes boundary roles; the placement guarantee applies to explicit Auto layout.

### Real ELK configuration
- Keep native same-origin Worker execution, layered/ORTHOGONAL routing, measured labels, fixed node dimensions, existing spacing and stable node/edge identities.
- Set per-node org.eclipse.elk.layered.layering.layerConstraint to FIRST_SEPARATE for start-only nodes, LAST_SEPARATE for end-only nodes, and NONE for unmarked nodes.
- Use a documented compatible cycle-breaking strategy such as GREEDY_MODEL_ORDER. Internal cycle breaking must not mutate the stored relationship direction or labels.
- Set org.eclipse.elk.separateConnectedComponents=false while boundaries are active. Independent component packing does not guarantee a shared leading/trailing layer across the complete graph.
- Do not compute ordinary layout and then drag start/end nodes to the edges: that would invalidate routed paths and labels. Constraints must enter the Worker calculation itself.

### Result validation and failure
Validate the actual rectangles, not only the engine options or node-array order. For RIGHT, verify starts' x positions form the leading band, ends' x positions form the trailing band, and non-boundary rectangles lie strictly between the applicable bands without overlap. For DOWN use y/height instead. Account for floating-point tolerance and the existing layer-spacing contract.

Also validate every active node has finite geometry, node/label overlap rules, complete orthogonal routes and preserved edge source/target semantics. A fulfilled ELK promise alone is not proof the requested ordering was achieved.

If the engine fails or the result violates the boundary contract, show a truthful boundary-layout error, preserve the previous graph/positions/routes and do not enable Apply for that result. Never silently revert to unconstrained placement, invent edges, remove cycles, relabel roles or claim the boundaries were honored.

A single active node marked both start and end is valid and occupies the only layer. With other active nodes, a node in both sets cannot satisfy two separated global boundary layers: reject that Auto layout request with actionable guidance to choose distinct boundaries or explicitly clear a role. Preserve the metadata and old layout; do not silently give the dual-role node ordinary placement.

Cycles, self-loops and links between boundary nodes are not rejected merely for existing. Process them with the supported engine strategy, retain their actual directions and apply the same geometry postconditions. Return a diagnostic when a particular combination is infeasible.

### Draft/review integration
Bind Worker jobs and previews to session, canonical revisions, draft version and the exact boundary sets. Changing a role, retiring a marked node or rebasing while a job is running makes its result stale.

Preview is temporary; Apply saves constrained geometry to the draft. Draft Undo/Redo and per-tab layout undo restore their exact prior states without silently reordering anything. Only final reviewed Submit publishes the complete flow metadata and geometry and completes one watcher. Marker changes alone do not auto-move nodes.

### Local feasibility evidence
Probed installed ELKjs 0.12.1 with two disconnected flows of different lengths plus an unmarked isolated node, in RIGHT and DOWN, using FIRST versus FIRST_SEPARATE and separateConnectedComponents true versus false.
- Independent component packing produced misaligned starts or ends in these examples.
- FIRST/LAST with joint processing aligned the boundaries but allowed the isolated node into the first layer.
- FIRST_SEPARATE/LAST_SEPARATE with joint processing met all three conditions: aligned starts, aligned ends and strictly intermediate unmarked nodes in both directions.
- Additional return-cycle and linked-start examples preserved their original edge endpoints while satisfying the marked layers.
These are feasibility probes, not a universal guarantee; the implementation still needs the result validator and regression/live acceptance below.

References:
- https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-layering-layerConstraint.html
- https://eclipse.dev/elk/reference/options/org-eclipse-elk-separateConnectedComponents.html
- https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html

## Implementation sequence
1. Extend schemas, additive DB migration, canonical commits/history and immutable graph snapshots. Preserve omission versus explicit clearing and metadata-only commits.
2. Add draft flow operations, retirement normalization, net diff, conflict rebase and review/submission support.
3. Add agent guidance, canvas/inspector/minimap/feedback rendering and real Worker layout constraints. Keep all node kinds and English defaults.
4. Execute TDD and actual browser validation below, then update public documentation and create an English showcase screenshot only from real persisted metadata.

## TDD and live acceptance
- Observe rejection/absence of explicit flow metadata against the current contract before implementation.
- Cover create/update/clear/omit preservation, metadata-only revisions/history/replay, missing/retired/duplicate IDs, cross-session isolation and atomic rollback.
- Cover RIGHT/DOWN with multiple starts/ends, disconnected flows of different lengths and unmarked isolated nodes. Assert global leading/trailing boundary bands and strictly intermediate unmarked rectangles, not just non-overlap or array order.
- Cover the valid single-node dual-role case and explicit rejection/preservation for a dual-role node with other active nodes.
- Cover cycles, self-loops and linked boundary nodes using real ELK output, preserving original edge endpoints/directions. Verify infeasible or contract-violating output never reaches Apply and never replaces old positions/routes.
- Permute input node order to prove placement comes from explicit roles rather than creation order. Changing roles during calculation/review must invalidate stale results and review tokens.
- Cover draft-only marking, removal of new marked nodes, durable undo/redo/reopen, stale review rejection, marker retirement diffs, concurrent rebase and exactly one final submission notification.
- Browser proof: agent-created markers render after reload; human role changes appear in review before Submit but not canonical data; badges, accessible labels, minimap and submitted SVG agree.
- Verify English chrome with multilingual user labels, medium/narrow viewports, selection/focus, existing pan/zoom, manual positions and native Worker cleanup.
- Do not claim automatic reasoning, execution or terminal completion merely because a node has an END badge.
