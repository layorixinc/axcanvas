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

## Explicit automatic layout
ELK layered supports per-node FIRST/LAST layer constraints. On explicit Auto layout, apply suitable constraints so starts favor the first layer and ends the last (RIGHT or DOWN). Preserve real edge identities and directions even where the engine uses cycle breaking internally.

A node marked both start and end must not receive contradictory FIRST and LAST constraints; keep its ordinary placement while rendering both roles. Cycles and other incompatible constraints require truthful diagnostics and preview inspection. Never silently invent edges, remove cycles or claim a forced order that was not achieved. Marker meaning remains valid even if an ordering constraint cannot be satisfied; preserve the old layout on engine failure.

References:
- https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-layering-layerConstraint.html
- https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html

## Implementation sequence
1. Extend schemas, additive DB migration, canonical commits/history and immutable graph snapshots. Preserve omission versus explicit clearing and metadata-only commits.
2. Add draft flow operations, retirement normalization, net diff, conflict rebase and review/submission support.
3. Add agent guidance, canvas/inspector/minimap/feedback rendering and real Worker layout constraints. Keep all node kinds and English defaults.
4. Execute TDD and actual browser validation below, then update public documentation and create an English showcase screenshot only from real persisted metadata.

## TDD and live acceptance
- Observe rejection/absence of explicit flow metadata against the current contract before implementation.
- Cover create/update/clear/omit preservation, metadata-only revisions/history/replay, missing/retired/duplicate IDs, cross-session isolation and atomic rollback.
- Cover multiple starts/ends, one node with both roles, cycles and disconnected components using real ELK output. Assert original edge source/target semantics remain unchanged.
- Cover draft-only marking, removal of new marked nodes, durable undo/redo/reopen, stale review rejection, marker retirement diffs, concurrent rebase and exactly one final submission notification.
- Browser proof: agent-created markers render after reload; human role changes appear in review before Submit but not canonical data; badges, accessible labels, minimap and submitted SVG agree.
- Verify English chrome with multilingual user labels, medium/narrow viewports, selection/focus, existing pan/zoom, manual positions and native Worker cleanup.
- Do not claim automatic reasoning, execution or terminal completion merely because a node has an END badge.
