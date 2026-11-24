# Compact, Office-style canvas workspace

Status: design only. This document proposes a UI and editing redesign; it does not change the running application. Product-owned text remains English. User graph content and feedback are never translated.

## Evidence and problem

Review used the current real browser surface and public/index.html. At a 1365 × 768 viewport, the canvas begins at y=420 and has 300px height. The app header is 70px; separate heading, draft, scope and layout sections consume the remaining upper workspace. The title partly scrolls behind the header. These measurements describe this viewport/state, not every screen size.

The current UI mixes document identity, authoring, flow metadata, arrangement, transport status and explanatory prose. Add node/Connect nodes are above the canvas while Draw/Clear drawing are at its bottom. The right sidebar simultaneously displays session internals, node properties, relationship management, instructions and history. This makes the primary editing area small and forces unnecessary scanning and scrolling.

Borrow Office's command grouping, contextual properties, predictable selection, keyboard support and clear document state. Do not copy a tall ribbon, decorative branding or every Office feature.

## Workspace layout

Desktop uses exactly two compact top rows and one bottom status bar. The canvas fills the remaining space without document-level vertical scrolling. A collapsed Inspector must immediately return its width to the canvas.

1. Document row: small application/File menu, current document title/session switcher, Undo/Redo, Inspector toggle and one prominent Review changes command. Session ID entry, copy link, recent sessions and agent connection setup live in File/Open or a document popover, not permanent inputs.
2. Command row: current Scope selector, contextual commands for the active tool/selection and Arrange/View overflow menus. Scope management sits in the scope dropdown's Manage flows action. No separate scope-description line or permanent layout-explanation line.
3. Canvas: a small left toolbox, unobstructed working surface, optional lower-right minimap. Temporary previews and editing handles are spatially attached to the object, not another full-width toolbar.
4. Inspector: collapsible right properties pane, normally 288–320px. It shows the selected node, selected relationship, current scope or active drawing settings—not all editors stacked together. No selection shows a compact document/scope summary rather than a large tutorial.
5. Status bar: current tool's short instruction, draft save state, a single agent-delivery indicator and zoom controls/percentage. Revision/counts/IDs are available in a details popover. Legal notices and keyboard help move to Help/About.

Desktop target: top chrome at most 96px; bottom bar at most 28px. At 1365 × 768 the canvas should have at least 620px usable height, rather than the observed 300px. These are acceptance targets, not measured improvements.

## Remove, merge or relocate

| Current element | Decision |
| --- | --- |
| LAN · HTTP tools badge; ONE CONVERSATION, ONE CANVAS eyebrow | Remove from editing chrome; explain connection in setup/help. |
| Large title, subtitle/session ID and separate revision/count block | Replace with one document title and a details popover. |
| Persistent Session ID textbox and Open button | Move to File → Open session/link. Keep one recent-document switcher. |
| Separate draft, flow and layout panels | Replace with the document row, command row and toolbox. |
| Flow label + type + ID description below selector | Show selected label once; type/ID appear in Manage flows/tooltip. |
| Positions change only when you run layout | Remove static text; show state only during calculation/preview/failure. |
| Draft version repeated in toolbar and sidebar | One save-state indicator; exact version in details. |
| Permanent session/API card and agent guide link | Move to Connection popover / Help; keep a compact status indicator. |
| Repeated watcher/delivery/security paragraphs | Move detail to connection status and onboarding; retain warnings at relevant risky actions. |
| Permanent relationship picker and connected-relations block | Show in relationship/node context; no duplicate persistent global editor. |
| Permanent instructions, feedback history and graph history | Inspector tabs: Properties, Agent, History. Agent has the note editor and submission states. |
| Bottom floating Fit/zoom/Draw/Clear/Include retired bar | Drawing moves to toolbox, zoom to status bar, display options to View. |
| Permanent legend and mouse-instruction footer | Legend in View, shortcuts in Help; current-tool hint only in status bar. |

Removing repeated prose does not remove security or data-loss safeguards. No authentication, scope-frame restrictions and delivery-versus-processing distinctions remain discoverable and appear where they affect a decision.

## Toolbox and icon language

Use a single self-contained SVG icon family: consistent stroke, visible active state and no emoji or external icon fonts. Tooltips contain the English command and shortcut. Every icon button has an accessible name; toggle tools expose aria-pressed. Tooltips also work on keyboard focus. Primary Review remains icon plus text, not an unexplained symbol.

| Tool | Shortcut proposal | Pointer behavior | Completion |
| --- | --- | --- | --- |
| Select (arrow) | V | Select objects; drag a node to move; drag blank canvas for marquee in the full selection model. | Remains active. |
| Hand | H; hold Space temporarily | Pan from blank space or over an object. Existing middle-drag remains. | Space release restores the prior tool. |
| Add node (node with plus) | N | Click canvas to place a node; choose type in a small adjacent menu or Inspector. | Focus Label; return to Select after creation. |
| Connect (directed connector) | C | Choose source then target, or drag a visible connector handle onto a target. | Edit relationship label; return to Select after creation. |
| Draw (pen) | P | Freehand annotation in the current scope frame; never a semantic edge. | Remains active until changed/Escape. |
| Erase drawing (eraser) | E | Remove an entire hit annotation stroke, not nodes/edges. | One erase gesture is one undoable edit. |

Top command row changes with the active tool: node type for Add; source/target and direction for Connect; pen width/color and eraser options for Draw. Colors are an optional annotation styling extension, not a reason to reinterpret existing stored strokes. Initially retain the existing annotation style unless its schema and SVG rendering are extended together.

Clear drawing is a secondary Draw menu command with undo/confirmation when needed. Retire node/relationship belongs to selection context and the context menu, not the eraser.

Toolbar icon hit targets are at least 36px on desktop and 44px in touch layouts. The same icon must mean the same action in every context. Compactness must not depend on unreadable labels or hover-only access.

## Editing interaction contracts

### Selection, movement and connection

- A visible, exclusive active tool prevents a click from ambiguously creating, selecting and drawing.
- Selection is view state. Single selection opens contextual properties; blank click clears it. Ctrl+click retains the shipped connection-focus behavior. Use Shift+click for additive selection rather than silently replacing Ctrl behavior.
- Escape cancels the current placement, connector or uncommitted drawing gesture, then returns to Select/clears selection as appropriate. It never discards the durable draft.
- Source highlight, live directed connector, target highlight and invalid-target cursor make connection creation explicit. The preview is not persisted until the user completes it. Escape produces no phantom relationship.
- Self-links and parallel relationships remain supported. Reversal is an explicit contextual command. Edge direction is not inferred from visual placement.
- New nodes/relationships belong to the selected turn/custom flow using existing scoped authoring contracts. Adding an existing outside node to a flow requires an explicit membership action; no silent copying or cross-scope insertion.
- Panning, zooming and selection never save geometry. Node movement persists only to the active view and only after the gesture completes.
- Multi-select, group movement, keyboard nudge, alignment/distribution and clipboard operations need atomic, scoped edit transactions. Do not expose their controls until end-to-end storage/review/undo is implemented.

### Properties and draft saving

Aim for Office-style saved-state clarity without changing publication rules:

- Existing valid object properties can save automatically to the durable draft after a short idle interval and on Enter/blur. New nodes/relationships keep an explicit creation transaction so incomplete objects are not published as placeholders.
- Show Saving… → Saved to draft, or a persistent actionable failure. Never label local-only text as saved, or draft persistence as agent submission.
- Treat one continuous property edit or one drag/erase gesture as one undoable action. Avoid one checkpoint per keystroke; this requires an explicit edit-group/coalescing design, not ad hoc deletion of server history.
- Invalid/partial input remains visible in the form with field errors. Do not silently revert or claim it was saved. Scope/session switches must offer explicit save/discard of local form input when required.
- Inside an input, Ctrl/Cmd+Z uses native text editing. Outside inputs, Ctrl/Cmd+Z and Redo operate the durable draft. Suppress canvas shortcuts while typing, composing IME text or using a dialog.
- Ctrl/Cmd+S flushes valid edits to the draft only. It never submits to an agent. Review also flushes valid active forms before calculating its complete net diff.
- One primary Review changes button opens the existing review gate. Submit to agent exists only inside that review. Saving, tool switching and arranging do not notify the watcher.

### Scope, arrangement and drawing frames

- The Scope selector is always visible. Current-scope badges remain START/END/START + END, with qualified additional roles in properties/tooltips.
- Arrange provides Auto layout and direction choices. Geometry is still scoped. Calculation and preview replace the contextual command area with a compact Calculating…/Apply/Cancel state; do not add a third toolbar row.
- Preview cancellation and failure preserve the prior geometry. Stale canonical/draft versions invalidate Apply. Do not conflate per-tab Undo layout with durable Undo; explain the former in Arrange, not as a second permanent Undo icon.
- Drawings retain captureFlowId. A blocked scope switch or arrangement explains that the drawing must be kept in its frame or explicitly cleared; changing tools is not clearing a drawing.
- Minimap, review snapshot and submitted image continue to reflect the selected/captured scope. Rebase and immutable submissions retain current safeguards.

### Agent and conflict states

- Connection indicator distinguishes server disconnected, no watcher, watcher connected, submitted/pending, applied, needs clarification and rejected. Do not collapse these into a misleading green Connected.
- Save failures and canonical conflicts remain visible until resolved. A contextual conflict banner offers Inspect latest / rebase without permanently occupying space during normal editing.
- Agent tab contains instructions, selected targets and received packet history. Optional attention badge indicates actual pending/response state, not invented completion.

## Responsive and accessible behavior

- Wide desktop: two rows, left toolbox, optional right Inspector and minimap. Do not allow toolbar wrapping to consume extra rows.
- Medium desktop: collapse lower-frequency commands into named overflow menus before shrinking hit targets or hiding Review/Scope.
- Narrow/touch: keep document/Review and Scope/tool access visible; Inspector becomes a drawer, tools a compact horizontal tray. Minimap is collapsed initially. Canvas remains usable rather than being pushed below a tall form.
- Support keyboard toolbar navigation, visible focus, semantic tool names and non-color-only active states. Focus returns to the originating command after dialogs close.
- Preserve multilingual labels, Korean IME, existing middle-pan/Ctrl-focus, browser zoom, and OS shortcuts. Shortcut labels use Ctrl on Windows/Linux and Cmd on macOS where applicable. Announce save/error state changes without flooding live regions during every pointer movement.

## Implementation plan and scope boundaries

This is a product plan, not an assertion that Office editing features already exist.

1. Compact shell and progressive disclosure: consolidate chrome, toolbox, status, contextual Inspector, File/Scope/Arrange/View menus; keep existing backend and publication semantics.
2. Direct-manipulation tools: explicit Select/Hand/Add/Connect/Draw/Erase state machine, source/target previews, keyboard cancellation and scoped gesture transactions. Retain inspector-based authoring as an accessible fallback, not duplicate permanent chrome.
3. Office-style selection and persistence: atomic multi-selection/group move/nudge/alignment, grouped durable undo and validated property autosave. Clipboard/duplicate must allocate new IDs and explicitly define copied memberships/roles; never clone stable identity accidentally.
4. Review/agent polish and end-to-end verification: concise net-diff review, contextual conflicts, real save/failure/notification states, responsive/accessibility acceptance.

Do not silently bundle tables, text documents, arbitrary Office file formats, real-time multi-user cursors or unrestricted rich-text editing into this redesign. Further tool expansion requires its own data and undo contracts.

## Acceptance and TDD

- At 1365 × 768, verify the real canvas height target and no document-level vertical overflow; repeat at 1600 × 1050, 800px and 390px widths. Distinguish content scrolling inside Inspector from the whole application scrolling.
- Core authoring tools, Scope and Review are reachable without scrolling or opening unrelated panels. Each persistent command has one primary home; context menus and shortcuts may provide alternate access.
- Tool activation, temporary Space Hand, Escape cancellation, source/target validation, no phantom nodes/edges and annotation-only erasing have consumer-visible tests.
- Verify grouped Undo/Redo, input-local text undo, IME safety, failed autosave retention, pending-save navigation and exact draft reload. No checkpoint churn per keystroke.
- Multi-object operations are atomic and scoped; arranging/moving one flow never changes another view. Role/membership and captured drawing safeguards remain intact.
- Review contains every staged edit, final Submit emits one watcher packet, and receipt remains distinct from processing. Existing API/replay/migration/conflict tests continue to pass.
- Inspect actual screenshots at each supported width, keyboard-only traversal and touch-sized targets. Test the native Worker, minimap, Inspector/drawer and dialog focus on the real page, not DOM/source-text substitutes.

No runtime tests were rerun for this planning-only document. Implementation must establish failing regressions for new interactions, then run the focused automated and actual-browser acceptance scenarios above.
