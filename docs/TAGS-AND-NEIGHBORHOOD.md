# Tags and selected-neighborhood layout

## Separate tags from boundary roles

START/END remain structured, scoped flow roles: `flows[].startNodeIds` and `endNodeIds`. The same stable node may be END in one flow and START in another. Tags classify/search node content; a tag named START never changes layout boundaries. Tags apply to the shared node, not just one flow membership.

## Tags

- Optional `nodes[].tags: string[]`, maximum 32 tags, each 1–64 characters. Tags contain no whitespace, comma or `#`; the hash is search syntax, not stored data. Reject duplicates using Unicode NFKC/lowercase comparison; preserve authored spelling. Empty `[]` clears tags. Omitting tags during an existing-node upsert preserves that node's existing tags, including older clients.
- Preserve legacy databases/history/draft/feedback bytes; no destructive migration or retrospective tag invention. Missing tags mean no tags to consumers. Node operations, cloning, Undo/Redo, review, rebase and submission retain tags. Concurrent edits to the same tag array use the existing field conflict handling, never silent overwrite.
- Add a comma-separated Tags field to Properties, following existing validation, grouped autosave and native IME/Undo rules. Show tags in node/search context without resizing node geometry.
- Ordinary searches include tags; `#backend` requires the exact normalized tag, and `#backend database` combines that tag with a literal AND text term. Multiple hash terms require all tags. No inferred synonyms or automatic boundary roles.
- AI reads graph_read in the intended session, keeps the full current node and its stable ID, modifies only tags, then graph_commit at the current baseRevision. Existing tags must be explicitly unioned when adding tags; a provided array replaces the tag set. Document concrete ordinary-HTTP examples; no new agent install/tool protocol.

### Tag colors and boundary search

Render high-contrast palette chips without changing node dimensions. An optional node-local `tagColors` record maps normalized tag names to palette names (blue, teal, green, amber, coral, pink, violet). Omitted color metadata preserves existing overrides for older clients; `{}` resets overrides. Default colors are deterministic by normalized tag name. Properties edits, review images and submitted snapshots use the same palette.

Search `is:start` and `is:end` against actual active flow roles, never tag spelling. Current scope uses only that scope's roles; Whole graph searches roles across active flows. Combine role queries with tags and text using AND. A role dropdown also supports role-only search.

Verified locally on Windows/Node 24.16/Chrome: 12 focused search/tag contract tests and TypeScript checks passed. Real browser interactions verified palette autosave, reload persistence, canonical isolation before Submit, actual role search and empty-query role filtering. Inspected the rendered three-line node labels and colored chips. Existing live database was backed up before server restart. No GitHub CI or other-platform run is claimed.

### Assigning tags from an AI agent

Use the session ID from the existing canvas URL and the stable node ID shown in Properties. Read the current node before changing tags; preserve its label, detail, sources and status. This ordinary Node.js/HTTP example adds tags without replacing existing ones:

```js
const baseUrl = 'http://127.0.0.1:43821';
const sessionId = 'YOUR_SESSION_ID', nodeId = 'YOUR_NODE_ID';
async function call(tool, args = {}) {
  const response = await fetch(baseUrl + '/api/agent/v1', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: crypto.randomUUID(), sessionId, tool, arguments: args })
  });
  const body = await response.json();
  if (!response.ok || body.isError) throw new Error(JSON.stringify(body.error));
  return body.result;
}
const graph = await call('graph_read');
const node = graph.nodes.find(node => node.id === nodeId);
if (!node) throw new Error('Node does not exist in this session');
const tags = [...(node.tags ?? [])];
const known = new Set(tags.map(tag => tag.normalize('NFKC').toLowerCase()));
for (const tag of ['backend', '설계']) {
  const key = tag.normalize('NFKC').toLowerCase();
  if (!known.has(key)) { tags.push(tag); known.add(key); }
}
await call('graph_commit', {
  baseRevision: graph.revision, answerId: crypto.randomUUID(),
  nodes: [{ ...node, tags }], edges: []
});
```

If another writer changed the graph, re-read and reconcile the revision conflict; do not blindly retry an old node snapshot. An AI instruction can specify: “In this canvas session, add backend and 설계 tags to node NODE_ID, keeping its existing tags and other fields.” This is an explicit graph update, not a tag inferred automatically from the conversation.

## Selected + connected layout

- One explicit `Layout selected + connected` action in Arrange and the selection context menu; Shift+L in canvas/toolbox keyboard context. Existing Auto layout still arranges the entire current scope.
- Targets are selected active visible nodes plus their immediate incoming/outgoing active neighbors in the current scope (one hop, not recursive connected-component expansion). Include all induced internal edges, self-links and parallel edges. Ignore retired/outside-scope nodes/edges. Support multiple seeds and isolated selected nodes.
- Project this temporary neighborhood into the existing native ELK Worker; do not create persistent flows, clone semantic nodes or alter membership. Boundary roles apply within the projected neighborhood; whole-scope boundary-band guarantees remain the responsibility of whole-scope Auto layout. Keep outside nodes fixed.
- Translate the resulting nodes, routes and labels rigidly back near the neighborhood's previous center. If that region collides with fixed outside geometry, place the entire neighborhood beyond that geometry on the chosen layout axis. Reject out-of-range coordinates rather than clamp. Do not move outside nodes to make space.
- Merge only target positions/internal routes into the current view. Preserve unrelated positions/routes byte-for-byte; remove stale routes crossing the target boundary so ordinary rendering reconnects their fixed endpoints. Preserve other flow layouts/global coordinates. Keep the existing whole-view direction metadata for a partial layout.
- Computation cancellation persists nothing. Worker completion immediately saves one version-checked `layout_region` draft operation with exact target IDs/positions and internal routes, preserving even legacy retired outside coordinates. There is no preview/Apply step. Layout Undo and draft Undo restore the exact prior view. Preserve selection/tool. Existing draft/canonical version checks, Worker cleanup, drawing/dirty-form guards and final reviewed publication remain in force. Frame the saved neighborhood for inspection.

## Verification acceptance

- Establish uncovered tag API/search and neighborhood behavior failures before implementation.
- API: tag round-trip and explicit clear; omitted-tag preservation; invalid/duplicate tags rejected atomically; legacy compatibility; durable draft/rebase/review/submission and Undo/Redo.
- Search: ordinary/exact hash/multiple hash/mixed terms, normalization and no false match in non-tag fields.
- Real ELK geometry: one-hop projection, scope isolation, selected isolated/self/parallel nodes, unchanged outside positions/unrelated routes, crossing-route invalidation, collision translation and coordinate limits.
- Real browser: AI-authored tags appear/search, human tags save/reload/Undo; neighborhood actions and shortcuts immediately save one checkpoint while unrelated nodes and canonical data stay unchanged. Verify exact Undo, computation cancellation and failed-save preservation. Existing workflows must still pass.

## Observed verification

Status: implemented and deployed to the existing local server.

- Missing-tag HTTP writes, exact-tag searches, the absent neighborhood module/operation and absent Arrange action established failing baselines before implementation.
- Passing focused coverage: four tag HTTP/storage tests, three region transaction tests, six search tests and five real ELK neighborhood tests. Coverage includes omitted-tag compatibility, explicit clearing, atomic validation, durable review/rebase/Undo, retired outside coordinates, scope isolation, route retention/invalidation, collision placement and bounds.
- TypeScript checking passed. The complete standalone Chrome suite passed, including five new tag/neighborhood workflows and all existing search, centering, English-default, editing, review, flow, layout and navigation workflows.
- The documented AI tagging snippet was executed against an isolated real HTTP server: it preserved an existing tag and node detail while adding backend and 설계. Twenty local documentation links resolved.
- Initial deployed verification (before the immediate-save cutover): an AI-authored node retained search/frontend tags and gained backend/설계. Exact tag search found it. Native Chromium exercised its three-node neighborhood and exact Undo without moving outside nodes, changing START/END metadata, publishing canonical data or submitting feedback.
- The managed browser's instrumented Worker could not load under the existing CSP; deployed layout verification used a native uninstrumented Chromium page. No CSP relaxation, fake Worker or fallback layout was added. Private screenshots/proof remain in ignored artifacts. No new paid model session or GitHub CI run is claimed.
