# Using axcanvas

[Start / installation](../README.md) · [Layout data for agents](LAYOUT-DATA.md) · [HTTP architecture](DESIGN.md)

## 1. Open the right document

Keep `axcanvas` or your standalone executable running (`npm start` for source development). Open the `canvasUrl` your agent returned, or enter its session ID in **File → Session ID → Open session**. The field accepts an ID, not a complete URL. A document is identified by its session ID; reuse the same link when you resume. Opening a new session does not import a conversation automatically.

Use the server's reachable address when the browser or agent is on another machine. Enable LAN mode only on a trusted network; the application has no login or access control.

## 2. Find your way around

| Area | Use it for |
| --- | --- |
| Document row | File/open, draft Undo/Redo, search, Inspector toggle, Review changes |
| Command row | Scope, Manage flows, Arrange, View and Draw options |
| Left toolbox | Select, Hand, Center selection, Add node, Connect, Draw, Erase drawing |
| Inspector → Properties | Node/relationship fields, tags/colors, flow roles, selection commands |
| Inspector → Agent | Additional instructions and submitted feedback status |
| Inspector → History | Published semantic revision history, not every draft/layout change |
| Bottom status bar | Save state, connection/watcher status, document details, Fit and zoom |

On a narrow screen, the Inspector becomes a drawer and the toolbox is horizontal. Close the drawer to expose more canvas. **Center selection** closes the narrow drawer without discarding its form.

### Navigate without changing the document

- Drag with **Hand**, hold Space while dragging, or middle-drag to pan.
- Use the wheel or bottom `−` / `+` buttons to zoom.
- **Fit** fits the current scope, changing zoom if needed.
- Select a node and click the target icon below Hand, or press **F** with canvas/toolbox focus, to center it without changing zoom. Several selected nodes are centered as a group.
- Click/drag the minimap to pan. With minimap focus, arrows pan and Home fits. Collapse/Expand changes only the minimap display.
- **View → Focus connections** dims unrelated content. Ctrl+node click enables focus; an ordinary node selection clears it.

Navigation does not persist coordinates, publish changes or notify an agent.

## 3. Edit nodes and relationships

### Existing nodes

Select a node and open **Inspector → Properties**. Edit Label, Details, Type or Status. Valid existing-object fields save to the draft after a short idle interval or when leaving the form. Watch the save state; **Unsaved input** or **Save failed** is not a successful save. **Save to draft** or Ctrl/Cmd+S explicitly flushes valid input.

Tags are comma-separated classification words, such as `backend, database, 설계`: at most 32, without spaces, commas or `#` inside a tag. Choose each tag's palette color below the Tags field. **Automatic** uses a stable color derived from the normalized tag name; a chosen color overrides that tag on this node, across its flows. Long lists collapse into `+N` chips; inspect Properties for the complete list.

Tags and colors do not create START/END roles. Use the selected scope's **Mark as start / Mark as end** checkboxes for boundaries.

### Create a node

1. Choose **Add node (N)** and the node type.
2. Click its intended canvas position.
3. Complete the Properties form and click **Save to draft**.

New nodes do not autosave while typing. Use the explicit save above; Ctrl/Cmd+S or opening Review can also save a valid creation form. Incomplete/invalid input blocks saving rather than becoming a placeholder. Escape cancels unfinished creation.

### Create or edit a relationship

1. Choose **Connect (C)**, then click its source and target, or drag a connector handle to a target.
2. Enter the relation text in Properties.
3. Click **Save relationship to draft**.

Click an existing connection or choose it in the relationship picker to edit it. **Reverse direction** swaps endpoints. Self-links and parallel relationships are supported. Escape cancels unfinished connections.

### Work with several nodes

Use Shift+click or drag a selection rectangle on blank canvas. Drag the selected group, nudge with arrows (Shift for larger steps), or use Properties/context commands to align, distribute, copy, paste, duplicate or retire. Distribution needs at least three selected nodes. Copies get new IDs and join only the current flow; they do not inherit boundary roles. The clipboard is internal to the current page, not an exported document.

**Retire** removes content from active views while preserving published history. **Erase drawing** removes annotation strokes only, never nodes or relationships.

## 4. Search

Open the magnifier or press **Ctrl/Cmd+K**. Pick Current scope or Whole graph, optionally choose Node type or Flow role, then click a result or use arrows/Enter. Escape closes search.

| Query / filter | Meaning |
| --- | --- |
| `database` | Literal text in labels, IDs, details, tags, sources or active relationship labels |
| `database WAL` | Both words must match the same node's indexed fields |
| `#backend` | Exact normalized tag, not just a label containing backend |
| `is:start` / `is:end` | Actual active flow boundary role |
| `is:start #backend` | Both a start role and the backend tag |
| Empty query + Flow role END | All eligible end nodes in the chosen search range |

Current scope tests only that scope's roles; Whole graph tests roles across active flows. `#START` finds a classification tag and does not imply a boundary. Search is Unicode/case normalized, not fuzzy, semantic or translated. Results are capped at 50 with the full match count.

Selecting a result preserves zoom. An outside-scope result switches to Whole graph only when safe. Unsaved/invalid forms, captured drawings, gestures or layout work can block navigation; preserve the input and follow the displayed explanation.

## 5. Choose a scope and arrange it

**Whole graph** shows active document content. Use the button beside Scope (**Manage flows**) to **Add flow** or **Edit flow**. Turn/custom flows have explicit member nodes and relationships; include both endpoints of each member relationship. A Turn also needs a stable turn identity. One shared node can end one flow and start another without being copied.

1. Select the intended Scope.
2. Finish active form edits and clear or submit captured drawings before rearranging.
3. Open **Arrange**, choose Left → right or Top → bottom.
4. Choose **Auto layout** for the complete scope, or **Layout selected + connected** for selected nodes plus their direct neighbors.

Computation completion saves one draft operation immediately: there is no Apply button. **Cancel layout** is available only while computing. After saving, **Undo layout** restores this tab's last layout; document Undo/Redo is durable and separate. A partial layout keeps outside nodes fixed and may move the neighborhood away from occupied space.

Flow layouts are independent. Arranging Turn 2 does not reposition Whole graph or Turn 1. Starts/ends constrain the selected layout; a multi-node flow with one node marked both START and END cannot satisfy separate first/last bands. Correct its roles or choose a different scope; failure preserves the old layout.

Manual moves or semantic edits can clear stored routes. Basic connections then render until you explicitly run layout again. See [layout storage and interpretation](LAYOUT-DATA.md).

## 6. Add instructions, review and submit

1. In **Inspector → Agent**, write Additional instructions. Use **Draw (P)** to annotate the current scope if useful; use **Erase (E)** or **Draw → Clear drawing** to remove strokes.
2. Choose **Review changes**. Valid active forms are flushed before the complete net diff is calculated. Invalid or unfinished forms must be fixed or explicitly discarded; they are not silently omitted.
3. Inspect the before/after values, layout changes, final snapshot and instructions. **Back to editing** lets you continue.
4. Choose **Submit to agent** once everything is ready.

**Saved to draft is not submitted.** Only final Submit publishes the full reviewed work and queues one immutable packet. This includes layout-only edits. Notes/drawings retain their captured scope; changing tools does not clear them. Clear or submit a drawing before switching its frame or moving its nodes.

| State | What it proves |
| --- | --- |
| Server connected | Browser transport can reach the service |
| Watcher connected | One HTTP submission wait is currently connected |
| Pending | Submitted, not yet acknowledged as processed |
| Applied / Needs clarification / Rejected | An agent/API caller recorded that result and explanation |

A watcher returns once for a reviewed submission and does not mark it applied. Without a running watcher, ask the agent to read pending feedback using the same session ID. Automatic continuation depends on the agent's own background-task support.

## 7. Recover and resume

- Use document **Undo/Redo** for saved draft actions. Inside text fields, normal native text Undo remains in effect. **Undo layout** is a separate per-tab shortcut for the last automatic layout.
- **Discard form edits** resets only the active form. **File → Discard draft** discards the saved unpublished draft; neither is a way to undo an already submitted document.
- On a canonical conflict, choose **Inspect latest / rebase**, inspect latest values and try **Merge nonconflicting changes**. If conflicts remain, explicitly choose draft or latest values for those conflicts. Review again before Submit. Rebase resets old-base Undo history so it cannot erase remote work.
- Keep your canvas link. Draft checkpoints survive reload; incomplete form text and the in-page clipboard are not guaranteed to survive leaving the page. Different browser draft IDs can hold different unpublished work for the same session.
- For backup, stop the service and copy the database with any WAL/SHM siblings, or use a SQLite-consistent backup. Restore only while stopped. See [security and data policy](../SECURITY.md).

## Keyboard reference

Shortcuts do not override typing, IME composition or modal dialogs. F and Shift+L require canvas/toolbox focus; minimap keys have their own navigation context.

| Shortcut | Action |
| --- | --- |
| V / H / N / C / P / E | Select / Hand / Add node / Connect / Draw / Erase |
| Hold Space; middle-drag | Temporary Hand; pan |
| F | Center visible selection, preserve zoom |
| Shift+L | Layout selected + connected |
| Ctrl/Cmd+K | Graph search |
| Ctrl/Cmd+S | Save valid forms to draft, never submit |
| Ctrl/Cmd+Z; Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y | Draft Undo; Redo outside text fields |
| Ctrl/Cmd+C / V / D | Copy / Paste / Duplicate selection outside text fields |
| Arrows; Shift+arrows | Nudge selected nodes by 1; by 10 world units |
| Escape | Cancel unfinished gesture/creation; does not discard the durable draft |
