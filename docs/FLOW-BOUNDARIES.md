# Scoped flows and start/end roles

Status: implemented. Scoped persistence, draft/review integration, qualified canvas roles and boundary-aware native Worker layout are covered by automated and browser acceptance checks. This document replaces the earlier single graph-wide flow proposal.

## Decision: scoped roles, displayed as badges
Multiple start/end nodes alone do not describe which flow they belong to. The same stable node can be a turn's end, the next turn's start and an ordinary node in the whole knowledge graph.

Use structured flow membership and boundary roles. Display them as compact badges, distinct from free-form node tags. A role always belongs to one identified flow. Node kind, status and edge direction remain independent. See [user steps](USER-GUIDE.md#5-choose-a-scope-and-arrange-it) and [geometry fields](LAYOUT-DATA.md).

## Flows and membership
Add graph-level flows, keyed/upserted by stable flow ID:

```json
{
  "flows": [
    {
      "id": "whole",
      "scope": "graph",
      "label": "Whole graph",
      "startNodeIds": ["question"],
      "endNodeIds": ["final-conclusion"]
    },
    {
      "id": "turn-1",
      "scope": "turn",
      "turnId": "turn-1",
      "label": "Turn 1",
      "nodeIds": ["question", "shared-result"],
      "edgeIds": ["question-result"],
      "startNodeIds": ["question"],
      "endNodeIds": ["shared-result"]
    },
    {
      "id": "turn-2",
      "scope": "turn",
      "turnId": "turn-2",
      "label": "Turn 2",
      "nodeIds": ["shared-result", "final-conclusion"],
      "edgeIds": ["result-conclusion"],
      "startNodeIds": ["shared-result"],
      "endNodeIds": ["final-conclusion"]
    }
  ]
}
```

The IDs above illustrate metadata; referenced graph entities must actually exist. scope is graph, turn or custom. A graph scope covers all active nodes/edges implicitly; permit at most one active whole-graph scope. Turn/custom scopes have explicit nodeIds and edgeIds, so later unrelated edges between shared nodes do not silently become part of an earlier flow.

- One node or edge can belong to several flows without copying its semantic identity or content.
- Each flow can have several start/end IDs. A role references an active member node, not another flow's node.
- The same node can be start and end within a flow; see the layout feasibility rule below.
- Reject duplicates, missing/retired members, edges outside membership and boundary IDs outside their flow with actionable field errors.
- Do not infer roles from indegree/outdegree or merge distinct branches into an invented start/end.
- A turn scope uses an agent-provided stable turn identity. Existing answerId/history and sources provide provenance, not automatic flow membership; graph revision is not a turn number.
- The server must not claim it detects external conversation turns. Several commits can refine one turn; one reused node can participate in later turns.
- A turn view shows current graph content for that membership. Historical content comes from immutable history/submission snapshots, not copied semantic nodes or a claim to reconstruct an unrecorded transcript.

## Agent API and persistence
- Extend graph_read and generated tool/OpenAPI schemas with flows. graph_commit.flows upserts complete definitions by ID; omission preserves existing flows. Explicit retired/removed flow IDs are handled atomically and recorded in history.
- Do not keep a parallel singular flow alias: that proposal was never implemented. No compatibility shim is needed for an unshipped design.
- Validate the resulting graph after combined node/edge/flow changes. Newly created entities can be members in the same commit.
- Metadata-only flow commits increment semantic revision and record the actual flow before/after delta. Preserve replay and optimistic concurrency rules.
- Agent retirement of a marked/member entity must explicitly repair affected flows in the same commit. Human retirement stages the related membership/role changes and exposes them in review.
- Use additive SQLite migration with an empty flow collection for existing graphs. Never invent old turn memberships or rewrite historical snapshots.
- Agent instructions: declare the current turn/custom scope and appropriate boundaries, preserve other flows on unrelated updates, reuse node IDs and register shared membership explicitly.

## Human drafts and review
- Add flow create/update/retire draft operations; durable Undo/Redo, net-zero diff and reload cover memberships, roles and scope layouts.
- Inspector exposes Mark as start/Mark as end for the selected scope, plus other flow memberships/roles. In Whole graph, checking a role creates the graph-scope definition if none exists; it does not create a classification tag.
- Retiring a node/edge stages membership cleanup and role removal. Removing a newly created marked node must not leave a phantom flow change.
- Review shows dedicated flow/membership/role and per-view layout diffs. Final Submit atomically publishes them with the rest of the draft and creates only one notification.
- Rebase merges independent flow changes and reports incompatible membership/role changes. Undo after rebase cannot restore stale remote metadata.
- Review tokens and Worker jobs bind the draft version and relevant flow definitions. Editing another role or scope invalidates affected calculations before their automatic draft save.
- Drawings must retain their flow ID and captured frame. Do not reinterpret coordinates after a scope/view switch; require explicit preservation of the captured annotation or clearing it. Submitted snapshots retain the exact view and boundary tags.

## Canvas presentation
- A Scope selector offers Whole graph, named turns and custom flows. The default is Whole graph; selection is view state, not a new semantic mutation.
- Display START, END or START + END for the selected scope inside the node header. If a node has other roles, show a compact additional-role count; inspector/tooltip lists each qualified role, such as Turn 1 · END and Turn 2 · START.
- Do not draw every turn's role as if it were a whole-graph boundary. Keep kind/status text, IDs, node dimensions and original user labels.
- Use text and distinct shape/outline cues, not color alone. Accessible names include the qualified scope/role. All product labels remain English.
- The minimap, review snapshot and submitted SVG show the same selected scope and role meaning.
- Turn/custom views show only their explicit active members and edges. Use Whole graph or Whole graph search range to inspect outside content; outside-scope search results are labeled. No automatic cross-scope membership is inferred.

## Automatic layout uses one explicit scope
The previous global leading/trailing-layer guarantee applies to the flow being laid out, not to every tag from every turn at once. Overlapping scopes can impose contradictory orders on the same shared node. Never merge all START/END tags into global constraints.

- Whole graph Auto layout uses whole-graph boundaries across all active nodes and edges.
- Turn/custom Auto layout uses that scope's members, edges and roles. Its starts are the first layer and its ends the last within that view.
- In RIGHT, starts share the leftmost layer and ends the rightmost; in DOWN, starts share the topmost layer and ends the bottommost.
- Multiple starts/ends share their respective band. Unmarked members remain between the applicable boundaries, including disconnected members.
- A shared node may legitimately occupy a different position in another view. Store per-flow view geometry separately from the existing whole-graph positions/routes; never duplicate the semantic node or overwrite the whole-graph layout merely by arranging a turn view.
- Existing whole-graph layout storage remains the default view. Non-global layouts are distinct scoped geometry, not aliases. Use revision checks and invalidate affected routes after semantic/membership changes while preserving saved coordinates.
- Applying layout changes only the current draft view. Publish reviewed view geometry with the final packet; do not move nodes automatically when tags change.
- Do not claim all overlapping scope constraints were honored by one flat layout. Simultaneous multi-flow compound layout would require its own satisfiability/geometry contract; it is not a fallback for the defined scope-selection behavior.

### Engine constraints and postconditions
Use the real same-origin ELK layered/ORTHOGONAL Worker with label measurements, spacing and stable identities. Ordinary scopes use FIRST_SEPARATE for start-only members and LAST_SEPARATE for end-only members, with GREEDY_MODEL_ORDER cycle breaking and separateConnectedComponents=false.

ELK rejects links between FIRST_SEPARATE nodes, even when their roles and semantic directions are valid. For linked boundary bands, represent full-size boundary nodes as ELK compound bands with fixed-side ports. Extract compound-local coordinates into one view frame and apply the same strict boundary, route and label postconditions. Preserve original semantic node/edge identities and endpoints; do not independently post-shift nodes or invent semantic relationships.

Validate actual rectangles: leading/trailing bands, strictly intermediate unmarked members, finite positions, non-overlap, labels, complete routes and preserved edge endpoints/directions. Engine success alone is insufficient. On infeasible/invalid output, preserve the old view geometry and save nothing. Never silently drop constraints, remove cycles, invent edges or clear roles.

A single-member flow can mark its node both start and end, even when other scopes contain many nodes. If a flow with multiple members gives the same node both roles, two separated boundary layers cannot both hold; reject that scope's Auto layout with actionable guidance, without deleting valid metadata or silently placing it normally.

Cycles, self-loops and links between boundary nodes are not rejected merely for existing. Use supported cycle breaking, retain semantic directions and enforce result postconditions.

### Existing feasibility evidence and limits
Earlier installed-ELKjs 0.12.1 probes covered one scope containing disconnected flows of different lengths and an isolated member in RIGHT/DOWN:
- Separate component packing misaligned starts or ends.
- Joint FIRST/LAST aligned boundaries but allowed an unmarked member into the first layer.
- Joint FIRST_SEPARATE/LAST_SEPARATE met the tested leading/trailing/intermediate postconditions.
- Return-cycle and linked-start examples preserved original edge endpoints.
The implementation's real-ELK regressions additionally cover multiple-scope views, shared roles, input permutations, linked starts/ends, boundary-only views, isolated members, cycles, parallel edges and boundary self-loops in both directions.

References:
- https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-layering-layerConstraint.html
- https://eclipse.dev/elk/reference/options/org-eclipse-elk-separateConnectedComponents.html
- https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html

## Implementation and acceptance
1. Define schemas and additive storage for named flow membership/roles and scoped geometry. Keep turn provenance separate and preserve omitted definitions on commits.
2. Integrate agent updates, human draft authoring, retirement cleanup, undo/rebase and immutable review/submission captures.
3. Render qualified scope badges/inspector/selector/minimap/SVG and pass only the selected scope's constraints to the actual Worker.
4. TDD: graph/turn/custom scopes; shared nodes with different roles; multiple starts/ends; one turn refined by several commits; no inference from revision; node/edge membership validation; atomic failures and replay.
5. Real geometry: both directions, unequal disconnected paths, isolated members, cycles, linked boundaries, one-member dual-role scopes and explicit infeasibility. Permute node order and preserve real edge directions.
6. View isolation: arranging Turn 2 cannot overwrite Whole graph or Turn 1 positions. A new scope must not steal a reused node from another view.
7. Browser proof: switch scopes and see the correct role on the same node; edit a role in a draft, review its qualified diff, submit once, reload and inspect matching badges/geometry in canvas and feedback image.
8. Cover multilingual content, English UI, narrow screens, stale Worker/review rejection, concurrent rebase and safe drawing-frame handling across scope changes. State unverified limits honestly.

## Observed verification

- `npm run check`: 58 tests passed, followed by TypeScript and public JavaScript syntax checks.
- `npm run test:browser`: real Chrome passed scoped selection/roles, independent native Worker views, durable role Undo/reload, custom-flow authoring, scoped node retirement, captured drawing reload, qualified review/SVG, one final watcher packet, and 390px/800px controls. Existing English, authoring/rebase, layout conflict/undo, selection, focus, pan, fit and minimap workflows also passed.
- A separately deployed local session received an actual agent-authored graph with four flows. Native Worker layouts preserved Whole graph/Turn 1 geometry while arranging Turn 2. The same shared node rendered END in Turn 1 and START in Turn 2; two linked Turn 2 starts were laid out successfully.
- The actual common watcher completed once after final reviewed submission. The agent read the captured packet and canonical graph, then acknowledged it; the UI displayed Applied. The stopped live database and WAL/SHM were backed up before additive migration.
- Verification ran on Windows with Node.js 24.16 and Chrome. No additional paid model session, live Claude Code integration or GitHub CI run was used for this change; those are not claimed as verified.
