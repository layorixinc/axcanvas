# Relationship focus and minimap design

Usage: [Navigation](USER-GUIDE.md#navigate-without-changing-the-document). The minimap summarizes the current scope, not every other flow's independent view.

## Relationship focus
Off by default. Ctrl+node click, or Ctrl+Enter/Space, focuses the selected node and its neighbors. Ordinary selection clears focus. Internal refresh/select calls preserve the mode. Keep dirty-edit selection protection and the checkbox as an alternative explicit control.

## Minimap
- Show current-scope graph geometry and the viewport in the bottom-right corner of the same canvas.
- At narrow/medium widths, keep the minimap clear of working controls; the compact shell puts Fit/zoom in the bottom status bar. The minimap starts collapsed on narrow screens.
- Summarize visible nodes and routes without node details or relationship text. Indicate the selected node.
- Compute the visible world rectangle from the actual SVG screen-to-world transform, including mismatched viewport/viewBox ratios.
- Map bounds are the union of graph geometry and viewport, so distant panning still shows the current location.
- Clicking centers the camera on that world point. Dragging inside the viewport preserves the initial grab offset.
- Freeze minimap bounds and coordinate transform for each drag to prevent jitter. Handle pointer release, cancellation and capture loss.
- Arrow keys pan by 10%; Home fits the graph. Support Collapse/Expand and hide the minimap for empty graphs.
- Synchronize with main pan/zoom/resize, node moves and immediate draft layout save/Undo.
- Navigation changes only the camera. Never call graph_layout/graph_commit or alter user drawings or stored node coordinates.
- Use safe DOM/attribute construction, not SVG strings inserted through innerHTML.
- Keep collapse state in tab memory, not graph data or layout revisions. UI text defaults to English while graph text remains user-authored.

## Verification
Observe regressions against the original checked focus default and absent minimap. Verify Ctrl/ordinary selection, internal refresh, map geometry and viewport, zoom, click/drag, keyboard, collapse, layout save/Undo, resize and unchanged canonical graphs. Pan tests must hit an actual exposed canvas/node rather than a floating overlay.
