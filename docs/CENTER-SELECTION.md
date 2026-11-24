# Center selection navigation

Status: design only. No runtime controls or camera behavior are changed by this proposal.

## Decision

Add one view-navigation command, **Center selection**, rather than another editing mode. It pans the active canvas so the selected node's center is at the visible viewport center, keeping the current zoom. The application uses an SVG camera/viewBox, not a scrollable document; `scrollIntoView()` is not the implementation.

Existing **Fit** continues to fit the whole current flow, potentially changing zoom. Center selection does not call Fit or rearrange nodes.

## Placement and access

- Primary location: the upper command toolbar, immediately after View, using a target/crosshair SVG icon. This keeps selection navigation discoverable without extending the bottom status/zoom cluster. Do not add a second persistent copy beside Fit.
- Accessible name/tooltip: `Center selection (F)`; use a real button with native disabled state and the workspace's normal desktop/touch target sizes.
- Alternate access: View → Center selection and the node/selection context menu. These dispatch the same command, not separate implementations.
- Shortcut: F while the canvas has keyboard context. Ignore inputs, textareas, selects, editable content, IME composition, modal dialogs, modifier shortcuts and minimap keyboard handling.
- This is a one-shot toolbar action, not a left-toolbox editing mode. Clicking Center does not change Select/Hand/Draw/Erase or the selection; do not show an active/pressed mode state. On narrow screens keep it reachable in the existing View menu if the toolbar cannot fit its normal touch target, without wrapping into an additional row.
- Do not automatically center on every node click. Keep the existing spatial stability during selection, dragging and multi-selection.

## Target and camera semantics

- One selected, visible node: use its currently rendered rectangle center.
- Multiple selected, visible nodes: use the center of their union rectangle. Keep zoom even if their union is larger than the viewport; centering is not a promise that every selected node fits.
- No visible selection: disable the command; do not silently center the whole graph or an unrelated node.
- Current-flow visibility applies. Do not switch Scope, reveal hidden nodes or create memberships to satisfy navigation. A retired node is eligible only when it is actually visible under the current display options.
- Use the same displayed positions as the canvas, including an active layout preview or initial fallback position. Do not navigate to stale canonical/global coordinates when a scoped view is active.
- Node rectangles only: relationship routes, labels, unrelated nodes and annotation strokes must not affect the selection center. The current `geometryBounds(nodes)` includes all routes, so it cannot be reused unchanged for this operation.

For a target center `(cx, cy)` and camera dimensions `(w, h)`, set only camera origin `(x, y)` so that the target maps to the intended canvas viewport center. Keep `w` and `h` unchanged. Account for SVG aspect-ratio mapping rather than assuming DOM pixels equal world coordinates.

Use the canvas content rectangle, not the whole browser window: the desktop Inspector is outside it. Account for the left toolbox or narrow top tray as navigation insets, without treating the corner minimap as a full-width sidebar. The center target must remain unobstructed. If an open narrow-screen Inspector drawer leaves too little usable canvas, this explicit command closes the drawer before measuring/centering; desktop Inspector state is unchanged. Do not close a modal dialog or discard form input.

## Allowed states and safety

- Allow after ordinary selection, zoom/pan, role edits and scoped layout changes; update minimap viewport and zoom/status display through the normal camera view path.
- Allow while valid/invalid form text, notes or saved strokes exist: navigation must not require flushing, clearing or submitting them. Existing independent autosave may finish under its own policy; Center itself must not invoke saving or publication.
- Allow a settled layout preview, using preview coordinates. Disable while the Worker is computing, a geometry gesture is in progress, a preview is being applied, a modal review/rebase is active, or the target viewport has no usable dimensions.
- At activation, resolve the current selection/scope/positions again. Do not cache a rectangle across draft updates or Inspector resizing.
- Preserve graph positions/routes, flow definitions/layouts, selection, tool, note/strokes/captureFlowId, draft version, review token and durable Undo/Redo history. Emit no mutation request or watcher event.
- Default to an immediate deterministic pan. Animation is not required; do not add inertial motion or an animation state machine for this command.

## Integration design

- Add a camera-only `centerSelection()` path next to `fit()`/`view()` in app.js.
- Route UI/context/keyboard access through one navigation command before `dispatchCommand()`'s `prepareSwitch()` and geometry guards. Current bulk-edit guards intentionally require clean forms/no drawings and are wrong for a pure pan.
- Add a small selection-rectangle helper based on the current visible selected nodes and `point(node)`, not global routed bounds.
- Extend the workspace bridge only as needed to expose navigation eligibility and explicit mobile canvas focus/drawer closure. Do not put graph calculations into workspace.js.
- Inspector/toolbox resizing is measured before calculating the camera. Use one layout-ready update when needed, not arbitrary sleeps or repeated fitting.

## TDD and live acceptance

1. Select a node, pan it out of view, activate the actual button: its rendered center matches the unobstructed canvas center within 2 CSS pixels; camera width/height and zoom percentage remain unchanged.
2. Repeat in RIGHT/DOWN layouts, whole/turn/custom scopes, an accepted preview, negative coordinates and different zoom levels. Verify actual rendered/scoped coordinates, not assumed global positions.
3. Multi-select dispersed nodes: union center is centered, unrelated routes do not skew it, zoom is unchanged and no extra nodes become selected.
4. No selection/hidden-scope selection, active gesture/computation/apply and modal states have correct eligibility. An invalid property form and a captured drawing remain intact when navigation is allowed.
5. Desktop Inspector open/collapsed and 800px/390px screens center in the correct usable canvas area; the narrow drawer closes without losing input. Check actual pointer reachability and keyboard focus.
6. F activates only in canvas keyboard context. Typing F in labels/notes, Korean IME input and minimap navigation do not activate it.
7. On a clean settled draft, compare graph/layout data, draft version, Undo/Redo and mutation/watcher traffic before/after: all remain unchanged. Minimap camera viewport follows the pan.
8. Live verification uses the real control on an existing graph, without moving nodes or injecting page state. Report measured centering and zoom preservation.

This planning-only change does not rerun application tests or imply the feature is already available.
