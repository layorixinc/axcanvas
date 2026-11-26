# Reviewed editing and one-shot notification

Start with [review/submit usage](USER-GUIDE.md#6-add-instructions-review-and-submit) or [layout delivery fields](LAYOUT-DATA.md#what-is-saved-and-when-an-agent-can-read-it). This reference describes the implemented contracts. Historical verification appears at the end.

## Invariants
All UI text is English. Human node/edge/content/layout changes are saved to a durable browser-owned draft, not the canonical graph. Pan/zoom/selection do not create changes. Drawings and notes belong to the draft. Only explicit final Submit to agent creates an immutable submission and wakes a watcher. Preserve old databases, graph APIs, stable IDs, history, CSP, native Workers, minimap and Ctrl focus. No MCP/plugin/account installation or terminal keystroke injection. Session IDs and actor labels remain non-authenticating; use only loopback/trusted LAN and explicit watcher consent.

## Shared HTTP contracts
All tools use existing POST /api/agent/v1. New read-only tools must not enter replay storage. Normal mutation requestId replay remains transactional.

GraphView is the public graph (no internal graphId), including flows, flowLayouts and optional node tags/tagColors. DraftView: {id,sessionId,version,state:'editing'|'submitted'|'discarded',baseRevision,baseLayoutRevision,graph:GraphView,note,strokes,nodeIds,captureFlowId,canUndo,canRedo}. Internal history is not returned. UI stores a random draftId in localStorage per session and restores it on reload. Different drafts/tabs use optimistic draft versions.

Tools:
- draft_open {draftId}: create from the canonical graph or read the existing matching-session draft. Returns DraftView.
- draft_read {draftId}: returns DraftView.
- draft_change {draftId,baseDraftVersion,operation,editGroup?}: persist one leaf operation or non-nested atomic batch, increment version, support bounded undo/redo. Consecutive same-target property/instruction saves may coalesce under editGroup. Returns DraftView.
- draft_step {draftId,baseDraftVersion,direction:'undo'|'redo'}: restores one persisted draft checkpoint. Returns DraftView.
- draft_rebase {draftId,baseDraftVersion,baseRevision,baseLayoutRevision,resolution:'fail'|'draft'|'latest'}: three-way merge against the exact latest graph the user inspected. Preserve nonconflicting remote changes. Report conflict paths before modifying; explicit draft/latest resolutions resolve conflicts only. Returns DraftView. Never silently overwrite concurrent input.
- draft_review {draftId,baseDraftVersion}: returns {draftId,version,token,changes,baseRevision,baseLayoutRevision,conflict,canSubmit}. Read-only. The token binds the exact version/work and canonical base. Do not enable submission for no meaningful changes/instructions or a changed canonical base.
- draft_submit {draftId,baseDraftVersion,reviewToken}: compare-and-swap draft plus canonical graph/layout versions; atomically publish semantic/layout changes and create one pending feedback with an immutable review. Returns public Feedback. Identical token replay of an already submitted draft returns the original feedback even with a new requestId; altered submission is rejected. Failures leave draft/history/graph/feedback/submission sequence untouched.
- draft_discard {draftId,baseDraftVersion}: marks discarded, preserves canonical graph. Returns DraftView.

Leaf operation discriminated union (exact limits/defaults come from tools_list):
- {type:'node',node:GraphNode,position?:Position,flowId?:string|null}
- {type:'edge',edge:GraphEdge,flowId?:string|null}
- {type:'flow',flow:Flow} / {type:'retire_flow',flowId:string}
- {type:'retire_node',nodeId:string} / {type:'retire_edge',edgeId:string}
- {type:'move',nodeId:string,position:Position,flowId?:string|null}
- {type:'layout',positions,routes,direction:'RIGHT'|'DOWN'|null,flowId?:string|null}
- {type:'layout_region',nodeIds:string[],positions,routes,flowId?:string|null}
- {type:'instruction',note:string,strokes:Stroke[],nodeIds:string[],flowId?:string|null}

Batch: {type:'batch',operations:LeafOperation[]} with 1–300 leaves and no nesting. One batch is one atomic checkpoint or no change. See [workspace grouping](WORKSPACE-IMPLEMENTATION.md#backend) and [scoped operation rules](SCOPED-FLOW-CONTRACT.md#draft-operations-and-annotation-frames).

Retiring an existing node also retires incident edges. Removing newly created items removes them from the final delta. A create/edit followed by undo/reversal produces no phantom change. Node/edge/move operations invalidate routes. Layout is explicit and draft-local. Do not silently relocate existing nodes for new nodes. Support self-loops/parallel directed edges like the existing backend.

Change: {entity:'node'|'edge'|'position'|'layout'|'flow'|'flow_layout'|'instruction',id:string,change:'added'|'modified'|'retired'|'removed',before:unknown|null,after:unknown|null}. Review includes before/after values using safe DOM text, not HTML. Exclude revision counters/view navigation. A review token becomes invalid after further draft edits. draft_review returns this diff/token, not full graph snapshots.

Public reviewed feedback includes optional review:{draftId,baseRevision,baseLayoutRevision,changes,before:GraphView,after:GraphView}, captureFlowId and imageUrl. The server's internal capture is not exposed directly; it renders the immutable SVG. Existing feedback_submit remains an explicit simple-instruction API, not a whole-change submission or watcher event. feedback_read/feedback_ack and graph_commit.feedbackIds handle submitted feedback; acknowledgement is never performed on notification delivery.

## Store/HTTP boundary
GraphStore adds nextSubmission(sessionId,after:number): {cursor:number,feedback:Feedback}|null, selecting the oldest still-pending reviewed submission after a durable SQLite sequence. A draft save, ordinary graph edit/layout or legacy feedback_submit never inserts this sequence. Export publicFeedback(item,baseUrl) from agent.ts for server serialization.

GET /api/submissions/wait?sessionId=...&after=0&timeoutMs=25000 returns {cursor,feedback:null|PublicFeedback}. Validate session/cursor/time bounds and existing Host/Origin checks. One outstanding waiter per session; reject another with 409. Register before checking pending submissions, clean up on response close/abort/server shutdown, and only fulfill from committed submissions. Empty timeout is not agent work. GET /api/submissions/status?sessionId=... returns {connected:boolean}; this is transport presence, not proof an agent read/processed anything.

## Common watcher
scripts/watch.mjs takes --url, --session, optional --after and --timeout-ms (overall deadline; 0 unlimited). It silently repeats empty long polls and reconnects transient network failures with bounded backoff; permanent HTTP errors fail clearly. On one submitted review it outputs one JSON result with sessionId/cursor/feedbackId and exits 0. Deadline/cancellation is not successful delivery. It never acknowledges feedback, executes feedback text, registers callbacks or starts an agent. Both omp and Claude Code invoke the same command through their native background shell capability. Startup/rearming requires agent consent; process exit or tool policy can stop it. Do not claim live Claude integration passed without running it.

## UI
The UI supports node/relationship creation, editing and retirement; draft Undo/Redo; discard/rebase; full review and final Submit. Valid existing-object properties autosave to the draft; new objects require explicit creation. Review flushes valid active forms before calculating the complete net diff; invalid/unfinished input blocks it rather than being silently omitted. Back to editing retains saved work; further edits invalidate the review token. Conflicts preserve the draft and offer inspected rebase choices. Details shows exact draft version; connection status distinguishes transport from processing. Drawings retain their captured frame and must be cleared/submitted before rearranging its geometry.

## Acceptance
Backend regressions cover draft isolation/reopen, two-tab CAS, invalid graph/edge atomicity, undo/redo and net-zero drafts, stale review/canonical/layout conflict, explicit rebase, immutable before/after and replay, committed-only one-shot waits, disconnect cleanup and session isolation. Real browser tests cover creation/connection/edit/retirement, persisted draft reload, review/back/edit/resubmit, no canonical changes before Submit, note/drawing inclusion, conflict recovery, Worker layout, focus/pan/minimap, keyboard and narrow viewports. Start a real background watcher in this omp session and show draft saves do not finish it but one reviewed submission does. Keep synthetic tests separate from live model proof.

## Observed verification — 2026-11-24
- TDD baseline: the new HTTP regression initially failed with UNKNOWN_TOOL for draft_open.
- Final npm run check passed: 41 tests, TypeScript and public JavaScript syntax checks.
- Real Chrome passed full authoring, direction/relation editing and retirement, persisted draft Undo/Redo, reload, native Worker draft layout, complete review/back/edit, unsaved form inclusion, intercepted-submit conflict, three-way rebase and one final submission with notes/strokes. Existing English/Korean-locale, multilingual preservation, focus, pan, fit and minimap scenarios also passed.
- The first browser run found missing live feedback-status refresh after acknowledgement; the SSE handler now refreshes feedback with session isolation. An old refresh test was migrated from an implementation-specific graph_read assumption to the actual Inspect latest/rebase UI.
- On the deployed server, a real background invocation of scripts/watch.mjs remained silent through draft node creation, relationship creation, saved instructions and opening Review changes. The canonical graph stayed at its original revision and no feedback existed.
- Final Submit published the complete packet. The watcher printed one review_submitted JSON result and exited successfully; this omp session received the native background completion notification. Feedback remained pending until this session inspected it and explicitly acknowledged the completed verification.
- The previous owned server was stopped, its SQLite database plus WAL/SHM were backed up locally, and the new server was started on the existing port with the existing explicit LAN bind. Existing user graphs were retained. Runtime evidence, backup files and live-session IDs are excluded from Git.
- This proves the common script and omp notification transport in the current environment, not every agent's idle scheduling, permission policy or model behavior. No live Claude Code session or GitHub-hosted CI run was exercised for this change, and no extra paid model session was started.
