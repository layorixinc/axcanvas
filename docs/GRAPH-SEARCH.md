# Graph search

For everyday search steps and examples, see the [user guide](USER-GUIDE.md#4-search). The contract below describes the implemented matcher; upstream research is background, not a feature dependency.

## Upstream evidence

Research pinned to Graphify commit `013a6461c31da6e003c0dea191aca84c94cb8d47` (v8 branch).

- [Browser search](https://github.com/Graphify-Labs/graphify/blob/013a6461c31da6e003c0dea191aca84c94cb8d47/graphify/exporters/html.py#L375-L403) lowercases/trims the query, substring-matches labels and shows at most 20 results. Picking a result selects and focuses that node and opens its information panel. Neighbor links support continuing exploration.
- [Focus and inspection](https://github.com/Graphify-Labs/graphify/blob/013a6461c31da6e003c0dea191aca84c94cb8d47/graphify/exporters/html.py#L286-L302) connect search/navigation with graph context rather than just filtering a text list.
- [Query reference](https://github.com/Graphify-Labs/graphify/blob/013a6461c31da6e003c0dea191aca84c94cb8d47/graphify/skills/claude/references/query.md) explicitly distinguishes literal matching from agent-assisted, actual-vocabulary query expansion. The matcher itself supplies no synonyms, stemming or cross-language translation. Its CLI traversal is separate from browser search.

The implemented interaction adapts search/select/focus to axcanvas's scoped canvas. It does not import Graphify code, dependencies or its force-directed renderer.

## Behavior and implementation contract

- Search button in the document row, Ctrl/Cmd+K shortcut. A bounded responsive search panel contains a labeled query, Current scope / Whole graph range, node-kind filter, result count, empty state and keyboard-operable result buttons. Escape closes and restores focus; arrows move among results, Enter opens one. Ignore IME composition and modal dialogs.
- Normalize Unicode with NFKC and lowercase; split whitespace into literal AND terms. Search node label, ID, detail, tags, source references and active incident relationship labels. Rank exact label/ID, label prefix and label substring ahead of detail/source/relation matches; stable lexical tie-breaking. `#backend` matches only the exact normalized node tag, not a label containing that text. Combine multiple hash terms or mix tags and words using AND. Tags do not change START/END flow roles. Do not claim fuzzy, semantic or translated search.
- `is:start` and `is:end` match actual boundary roles in active flows, never tags. Current scope restricts roles to its selected flow (Whole graph uses the active graph-scope definition); Whole graph search range includes roles across all active flows. Multiple role terms use AND at node level: in Whole graph search a shared node may satisfy START in one flow and END in another. Results list qualified roles.
- Flow role START/END is an additional AND filter and works with an empty text query. `#START` still means an exact classification tag. Unknown `is:` role names match nothing. Color overrides do not affect matching.
- Show up to 50 ranked results with the full match count, kind/ID, qualified roles and a matching-field snippet; refine the query or filters for larger result sets. Use textContent, never HTML interpolation for graph content. Highlight visible listed matches without hiding the rest of the graph. Empty queries without a role filter return no matches.
- Default to current visible scope and existing retired-display policy. Whole graph explicitly searches the same session's other scopes, never a global session directory. Outside-scope results say so. Navigation to one switches to Whole graph only when scope switching is safe; captured drawings must not be reinterpreted or discarded, and computing/saving layout blocks result navigation.
- Picking selects, shows node properties and reuses camera-only Center selection, preserving zoom and the active tool. Read current state at activation, rejecting disappeared results. Block result activation during unsaved/composing forms, pending saves, new-object creation, gestures, computation/application or modal review/rebase. Searching remains possible with an incomplete form; explain the block rather than discarding input.
- Searching and clean navigation invoke no mutation API, change no durable graph/layout/draft/Undo state and notify no watcher. Explicit cross-scope navigation resets per-tab layout undo/review state just like the existing Scope control; it does not rewrite stored review tokens. Existing independently scheduled autosave/blur policy remains independent. Query/filter/highlights are local UI state, not graph metadata. Clear the search when sessions change and refresh results after graph/draft/scope changes.
- Use a small shared search module and existing static-asset allowlist. Index normalized fields once per graph object; do not rebuild on every camera pan. No embeddings, remote search service or agent installation.

## Acceptance

1. Observe a real missing-control failure before implementation. Test ranking, Unicode, multi-term matching, sources/relations, kind/scope/retired filters, result limits and deterministic order through the search API.
2. Real browser: type a title/detail/source/relation query, see count and highlights, choose an offscreen result and verify selection/Inspector/center/zoom/tool. Arrow/Enter/Escape and Ctrl/Cmd+K work without intercepting IME.
3. Zero results and clearing are explicit; untrusted graph text remains inert. Whole-graph results reveal outside-scope nodes safely; drawings/invalid forms remain intact on blocked activation. Reload/draft updates do not leave stale results.
4. Verify no mutation requests and unchanged durable draft/canonical data for clean search/navigation. Check reachable controls and no document overflow at desktop, 800px and 390px. Run existing browser workflows to catch compact-header regressions.

## Observed verification

Status: implemented and deployed to the existing local server.

- Baseline: the real browser failed because the graph-search document-row control did not exist.
- `node --test tests/search.test.mjs`: five tests passed for field ranking, deterministic order, AND semantics, Unicode normalization, filters/counts/limits and deep-body snippets.
- `npm run typecheck`: passed.
- `npm run test:browser`: passed seven search scenarios and the existing centering, editing, English-default, review, scoped-flow, Worker-layout, selection, focus, pan, Fit and minimap workflows. Search tests include native Korean IME composition, inert markup, 800px/390px pointer reachability, invalid-form preservation and captured-drawing scope protection.
- On an existing live graph, searching `grouped Undo` selected and centered the real node at 178% zoom with zero CSS-pixel horizontal/vertical error, preserving Hand mode, canonical data, draft and feedback. No API mutation request was emitted.
- Screenshots and live proof remain in ignored artifacts. No extra model session, external search service or GitHub CI run was used for this verification.

The observations above describe the initial search release, not the current test count. Subsequent tag and boundary-role support is covered in tests/search.test.mjs and the palette/role verification record in [Tags and neighborhood layout](TAGS-AND-NEIGHBORHOOD.md#tag-colors-and-boundary-search).
