# Changelog

## Unreleased

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
