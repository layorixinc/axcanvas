# Center selection navigation

Status: implemented. Center selection is a camera-only navigation command; existing Fit and editing modes remain unchanged.

For task-oriented navigation and a keyboard table, see the [user guide](USER-GUIDE.md#navigate-without-changing-the-document). Saved geometry and UI camera state are distinguished in [Layout data](LAYOUT-DATA.md#coordinates-and-line-shapes).

## Decision

Add one view-navigation command, **Center selection**, rather than another editing mode. It pans the active canvas so the selected node's center is at the visible viewport center, keeping the current zoom. The application uses an SVG camera/viewBox, not a scrollable document; `scrollIntoView()` is not the implementation.

Existing **Fit** continues to fit the whole current flow, potentially changing zoom. Center selection does not call Fit or rearrange nodes.

## Usage

1. Select a visible node, or use Shift+click to select several nodes.
2. Click the target icon directly below Hand. Alternatively, choose **View → Center selection**, use the selected node's context menu, or press **F** with keyboard focus on the canvas/toolbox.
3. Continue editing with the same tool and zoom. For a multi-selection, the command centers its bounding box; use **Fit** instead when you want to fit the entire current flow.

Without a visible selection the button is disabled. It is also unavailable during active gestures, layout computation/application and modal review/rebase. F typed into a property field, note or minimap does not pan the canvas.

On narrow screens, the horizontal toolbox stays above the Inspector drawer. Activating Center selection closes that drawer to expose the canvas without discarding its form input. On desktop, the Inspector stays as it was.

## Placement and access

- Primary location: the left toolbox, immediately below Hand, using a target/crosshair SVG icon. On narrow screens it stays in the same relative order in the horizontal toolbox. Do not add a persistent copy to the upper toolbar or bottom Fit cluster.
- Accessible name/tooltip: `Center selection (F)`; use a real button with native disabled state and the workspace's normal desktop/touch target sizes.
- Alternate access: View → Center selection and the node/selection context menu. These dispatch the same command, not separate implementations.
- Shortcut: F while the canvas has keyboard context. Ignore inputs, textareas, selects, editable content, IME composition, modal dialogs, modifier shortcuts and minimap keyboard handling.
- This is a one-shot toolbox action, not an editing mode: no data-tool or pressed state. Clicking Center preserves Select/Hand/Draw/Erase and the selection. Include the action in enabled-button keyboard traversal without activating another tool.
- Do not automatically center on every node click. Keep the existing spatial stability during selection, dragging and multi-selection.

## Target and camera semantics

- One selected, visible node: use its currently rendered rectangle center.
- Multiple selected, visible nodes: use the center of their union rectangle. Keep zoom even if their union is larger than the viewport; centering is not a promise that every selected node fits.
- No visible selection: disable the command; do not silently center the whole graph or an unrelated node.
- Current-flow visibility applies. Do not switch Scope, reveal hidden nodes or create memberships to satisfy navigation. A retired node is eligible only when it is actually visible under the current display options.
- Use the same current draft positions as the canvas, including a completed automatically saved layout or initial fallback position. Do not navigate to stale canonical/global coordinates when a scoped view is active.
- Node rectangles only: relationship routes, labels, unrelated nodes and annotation strokes must not affect the selection center. The current `geometryBounds(nodes)` includes all routes, so it cannot be reused unchanged for this operation.

For a target center `(cx, cy)` and camera dimensions `(w, h)`, set only camera origin `(x, y)` so that the target maps to the intended canvas viewport center. Keep `w` and `h` unchanged. Account for SVG aspect-ratio mapping rather than assuming DOM pixels equal world coordinates.

Use the canvas content rectangle, not the whole browser window: the desktop Inspector is outside it. Account for the left toolbox or narrow top tray as navigation insets, without treating the corner minimap as a full-width sidebar. The center target must remain unobstructed. If an open narrow-screen Inspector drawer leaves too little usable canvas, this explicit command closes the drawer before measuring/centering; desktop Inspector state is unchanged. Do not close a modal dialog or discard form input.
Reserve the overlapping toolbox strip plus an 8 CSS-pixel gap on its left/top edge; center in the remaining canvas rectangle. Node bounds are 340 × 150 world units, excluding connector handles. Use the canvas screen CTM/inverse to translate screen-center displacement into camera-origin displacement without changing camera dimensions.
Keep the horizontal toolbox pointer-accessible above the narrow Inspector drawer, including at 390px width.

## Allowed states and safety

- Allow after ordinary selection, zoom/pan, role edits and scoped layout changes; update minimap viewport and zoom/status display through the normal camera view path.
- Allow while valid/invalid form text, notes or saved strokes exist: navigation must not require flushing, clearing or submitting them. Existing independent autosave may finish under its own policy; Center itself must not invoke saving or publication.
- Use completed saved layout coordinates. Disable while the Worker is computing, a layout is saving, a geometry gesture is in progress, a modal review/rebase is active, or the target viewport has no usable dimensions.
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
2. Repeat in RIGHT/DOWN layouts, whole/turn/custom scopes, immediately saved layouts, negative coordinates and different zoom levels. Verify actual rendered/scoped coordinates, not assumed global positions.
3. Multi-select dispersed nodes: union center is centered, unrelated routes do not skew it, zoom is unchanged and no extra nodes become selected.
4. No selection/hidden-scope selection, active gesture/computation/saving and modal states have correct eligibility. An invalid property form and a captured drawing remain intact when navigation is allowed.
5. Desktop Inspector open/collapsed and 800px/390px screens center in the correct usable canvas area; the narrow drawer closes without losing input. Check actual pointer reachability and keyboard focus.
6. F activates only in canvas keyboard context. Typing F in labels/notes, Korean IME input and minimap navigation do not activate it.
7. On a clean settled draft, compare graph/layout data, draft version, Undo/Redo and mutation/watcher traffic before/after: all remain unchanged. Minimap camera viewport follows the pan.
8. Live verification uses the real control on an existing graph, without moving nodes or injecting page state. Report measured centering and zoom preservation.

## Observed verification

- `npm run test:browser` passed, including nine dedicated centering cases and the existing editing, English-default, review, scoped-flow, layout, selection, focus, pan, Fit and minimap workflows.
- Centering coverage includes single/multiple selections, negative/scoped/fallback positions, RIGHT/DOWN saved Worker layouts, F keyboard context, invalid input, captured drawings, modal eligibility, View/context-menu access and 800px/390px drawers.
- On an existing live graph, the actual toolbox button centered the selected node with 0 CSS-pixel horizontal/vertical error at 178% zoom. Hand mode, graph/layout data, draft version and feedback were unchanged; the page emitted no API request during centering.
- Changed browser modules pass Node syntax checks. Screenshots and live proof remain in ignored artifacts; no additional model session or GitHub CI run is claimed.
