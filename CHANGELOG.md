# Changelog

## Unreleased

- Save both whole-scope and selected-neighborhood layout directly to the draft when computation completes. Remove the preview/Apply step; retain computation cancellation, exact Undo and final reviewed submission. Reject newer canonical/draft revisions atomically rather than saving stale geometry.

- Add optional node tags across agent writes, human Properties, draft/review/rebase/history and search. Support exact `#tag` queries while preserving omitted tags for older clients; keep classification separate from scoped START/END roles.
- Add selected-plus-direct-neighbor layout through Arrange, the context menu and Shift+L. Compute only the projected neighborhood, preserve outside geometry, and apply it as one undoable draft operation.

- Add indexed graph search with ranked multi-field literal matching, Unicode normalization, scope/type filters, visible match highlights, keyboard navigation and zoom-preserving result selection. Preserve drafts and captured drawing frames; document Graphify research and matching limitations.

- Add Center selection below Hand in the toolbox, with F and View/context-menu access. Preserve zoom, tools, scoped geometry and draft state while navigating; support preview positions and mobile Inspector dismissal.

- Replace stacked editing panels with a compact two-row workspace, accessible SVG toolbox, contextual Inspector tabs/drawer and consolidated status.
- Add direct node placement/connector gestures, selection marquee, scoped group moves, nudging, alignment/distribution and identity-safe Copy/Paste/Duplicate.
- Add annotation-only stroke erasing, temporary Space Hand, contextual keyboard controls and input-local Undo/IME safeguards.
- Add grouped existing-object property autosave and atomic draft batches. Preserve monotonic versions, failed-input retention, durable Undo/Redo and final reviewed publication.

- Add graph, turn and custom flow memberships with multiple scoped START/END roles. Shared nodes keep one identity across flows.
- Add scope selection, qualified canvas/minimap badges, role and membership editors, and independently persisted turn/custom layouts.
- Enforce selected-flow boundary bands in native Worker layout; reject infeasible or invalid geometry without replacing the previous view.
- Carry flows and scoped drawing frames through durable drafts, rebase, review, immutable feedback images and final one-shot submission. Additive migration preserves existing graph/history data.

- Add durable human drafts, node/relationship creation and editing, retirement, persistent Undo/Redo, full before/after review and atomic final submission.
- Add inspected three-way rebase with explicit conflict resolution, immutable submitted packets and captured drawing-frame protection.
- Add one common dependency-free Node watcher: draft saves remain silent, final reviewed Submit completes one background command, and delivery never acknowledges processing.
- Change human node saves and layout application from immediate canonical writes to draft-local changes. Existing agent graph tools remain available.
- Add backend, real-process watcher and actual browser coverage for the complete workflow.

- Default application text, accessibility labels and public documentation to English without translating user graph or feedback content.
- Format history times in English while retaining the local time zone.
- Add Korean-locale/multilingual browser coverage and keep the minimap clear of canvas controls at narrow and medium widths.

## 0.1.0 — experimental — 2026-11-24

- Agent-neutral HTTP tools, discoverable schemas/OpenAPI, SQLite graph history and idempotent mutations.
- Shared human editing, drawing feedback and atomic feedback acknowledgement.
- Explicit native-Worker graph layout, preview/apply/cancel/undo, Ctrl-click relationship focus and interactive minimap.
- Default listener changed from all interfaces to loopback. LAN use now requires explicit AXCANVAS_HOST=0.0.0.0. Existing running processes are unaffected until restarted.
- Upgraded to Zod 4.6.7 for GHSA-mrhx-c7xc-m3w5; removed zod-to-json-schema in favor of native input/output-aware conversion.
- Added MIT licensing, third-party source/license notices, public documentation, standalone Puppeteer tests and GitHub Actions.
- Excluded runtime databases, agent sessions, artifacts and private historical verification reports from Git without deleting local originals.

This release has no authentication and is not suitable for public hosting. Compatibility with every agent or deployment platform is not guaranteed.
