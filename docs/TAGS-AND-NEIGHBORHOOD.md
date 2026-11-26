# Tags and selected-region layout

User steps: [Tag editing](USER-GUIDE.md#existing-nodes), [search](USER-GUIDE.md#4-search) and [arrangement](USER-GUIDE.md#5-choose-a-scope-and-arrange-it). This reference explains the data/implementation contract.

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
Keys use Unicode NFKC then lowercase; a supplied map replaces all overrides, while omission preserves them. Palette values are names, not arbitrary CSS/hex strings. Colors belong to the shared node across views, not to a document-wide editable tag registry. Chips use one bounded row with truncated names/overflow count; Properties retains the full list. Setting colors does not set flow roles or tag membership.

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

## Selected-region layout contract

| Arrange command | Target rule | Keyboard |
| --- | --- | --- |
| Auto layout | All active current-scope nodes | Arrange menu |
| Layout connected component | Union of all components reachable from the selected nodes, ignoring edge direction | Shift+L in canvas/toolbox |
| Layout matching tags | Any active current-scope node sharing an original selected tag; disconnected matches included | Arrange or context menu |

For `A → B → C`, selecting A and running Connected component includes A, B and C. For selected tags `{backend}`, a match `{backend,database}` does not make `{database}` nodes eligible. Matching tags is a filter against the original selection, not a second graph traversal. Counts include only eligible target nodes; no selected tags means zero targets and a disabled command.

- **Layout connected component** replaces the one-hop command in Arrange/context menus and Shift+L (canvas/toolbox focus). Traverse active incoming/outgoing edges recursively within the current scope; multiple seeds select the union of their components. Selected isolated nodes remain included. Retired nodes/edges and nonmember edges never bridge components.
- **Layout matching tags** is a separate Arrange/context action. Form the union of NFKC/lowercase tags on the originally selected active in-scope nodes. Include every active in-scope node whose tags intersect that union, even if disconnected. Do not propagate new tags from matches, require all tags, compare colors or infer START/END roles. Untagged selected nodes are excluded; an empty tag union disables the command.
- Display each command's target count before execution. Whole-scope Auto layout remains separate. All selectors use the current draft, not an older canonical graph, and freeze selection/targets for the calculation.
- Project only the chosen nodes and their existing induced internal edges (including self/parallel edges) into the existing native ELK Worker. Do not create flows, clone nodes, add semantic relationships or alter membership. Apply boundary roles only within that projected region; whole-scope boundary guarantees remain the responsibility of whole-scope Auto layout.
- Translate computed nodes/bends/labels together near the previous region center; if occupied by fixed outside geometry, place the whole region beyond it on the chosen axis. Reject out-of-range coordinates without clamping. Outside nodes never move to make space.
- Merge one layout_region checkpoint into the active view: preserve outside positions/unrelated routes and other views, invalidate crossing routes, and retain the prior whole-view direction. Tag sets and semantic IDs/content remain unchanged.
- Completion immediately saves to draft with no Apply. Computation cancellation writes nothing; layout/draft Undo restores exact prior geometry. Keep dirty-form/drawing/gesture/IME/modal guards, canonical/draft CAS checks, native Worker cleanup, preserved selection/tool and final reviewed publication. Both installed distributions must embed the updated UI/module and run real browser coverage.

## Verification acceptance

- Establish uncovered tag API/search and neighborhood behavior failures before implementation.
- API: tag round-trip and explicit clear; omitted-tag preservation; invalid/duplicate tags rejected atomically; legacy compatibility; durable draft/rebase/review/submission and Undo/Redo.
- Search: ordinary/exact hash/multiple hash/mixed terms, normalization and no false match in non-tag fields.
- Real ELK geometry: recursive/cyclic multi-seed connectivity; direct selected-tag overlap without chaining; scope/retirement isolation, empty tags, normalized tags, self/parallel edges, fixed outside geometry, crossing routes, collision translation and limits.
- Real browser: tags appear/search/save/reload/Undo; both region commands show accurate counts, save one checkpoint, preserve outside/canonical data and support exact Undo. Exercise shortcut/context commands, scoped tag matches, disconnected matches, no tag propagation, untagged seed exclusion, reload and final reviewed publication in both installed distributions.

## Observed verification

The bullets below record the original direct-neighbor release and its earlier deployed checks, not the current target-selection rules or current suite count. Current connected-component/tag-region evidence follows in the next verification section.

- Missing-tag HTTP writes, exact-tag searches, the absent neighborhood module/operation and absent Arrange action established failing baselines before implementation.
- Passing focused coverage: four tag HTTP/storage tests, three region transaction tests, six search tests and five real ELK neighborhood tests. Coverage includes omitted-tag compatibility, explicit clearing, atomic validation, durable review/rebase/Undo, retired outside coordinates, scope isolation, route retention/invalidation, collision placement and bounds.
- TypeScript checking passed. The complete standalone Chrome suite passed, including five new tag/neighborhood workflows and all existing search, centering, English-default, editing, review, flow, layout and navigation workflows.
- The documented AI tagging snippet was executed against an isolated real HTTP server: it preserved an existing tag and node detail while adding backend and 설계. Twenty local documentation links resolved.
- Initial deployed verification (before the immediate-save cutover): an AI-authored node retained search/frontend tags and gained backend/설계. Exact tag search found it. Native Chromium exercised its three-node neighborhood and exact Undo without moving outside nodes, changing START/END metadata, publishing canonical data or submitting feedback.
- The managed browser's instrumented Worker could not load under the existing CSP; deployed layout verification used a native uninstrumented Chromium page. No CSP relaxation, fake Worker or fallback layout was added. Private screenshots/proof remain in ignored artifacts. No new paid model session or GitHub CI run is claimed.

## Connected-component and matching-tag verification — 2026-11-26

- TDD observed three failures before implementation: incomplete recursive traversal, missing disconnected tag matches and incorrect retirement/tag targeting.
- Final npm run check passed 85 tests plus TypeScript/syntax checks. The complete source Chrome suite passed; both installed npm and Windows x64 standalone variants also ran the same nine tag/region browser scenarios with native ELK Workers.
- Browser coverage exercised all five nodes of a multi-hop component, scoped traversal, Shift+L/context access, isolated multi-seeds, exact target counts, original-tag matching without chaining, disconnected matches, empty-tag disablement, mixed tagged/untagged selection, outside/crossing route behavior, one-checkpoint Undo, reload and final reviewed publication.
- Rebuilt the npm tarball and Windows executable/checksum. Backed up the existing local database before restarting the owned service on the shared CLI; inspected both new Arrange controls on the deployed page without rearranging an existing user document.
- Other-platform binaries/CI, npm publication and GitHub Releases were not exercised or published. No paid model session was started. Earlier one-hop verification above is historical, not the current command contract.
