# English-default interface

## Scope
English is the fixed default for product documentation and application-owned UI, including HTML language, accessible names, tooltips, placeholders, legends, status labels, notifications, layout errors and empty states. The public README, contributor/agent instructions and design documents use English. Historical ignored verification reports remain local records, not product documentation.

Use the existing direct DOM/string conventions. Do not introduce a locale picker, browser-language detection, translation dependencies or an i18n framework for a single default language.

## Vocabulary
- Auto layout; Cancel layout (while computing); Undo layout
- Fit graph; Draw; Clear drawing; Include retired
- Focus connections; Minimap; Collapse; Expand
- Save changes; Reload; Show history; Send to agent
- Concept, Claim, Decision, Question, Task
- Proposed, Confirmed, Retired; Pending, Applied, Needs clarification, Rejected

History times use en-US formatting while retaining the browser's local time zone. OS/browser language must not change the application chrome to another language.

## Data invariant
Never translate or rewrite user session titles, node labels/details, relationships, sources, feedback notes/resolutions, IDs, existing databases or browser history. API tool names, enums, revisions, schema and storage formats do not change. Keep Unicode font fallback and genuine multilingual test coverage.

## TDD and live acceptance
1. A browser regression first fails against the existing Korean document language.
2. Under a Korean browser locale, actual controls and accessibility text are English. Exercise selection, dirty-edit protection, history, minimap collapse/expand, feedback states and immediate layout save/Undo.
3. Use a clearly synthetic Korean/Japanese graph and feedback. Verify exact display and deep-equal stored graph/feedback before and after view-only interaction.
4. The existing standalone Chrome suite still verifies editing, drawing submission, acknowledgement, layout conflicts/undo, focus, pan and minimap.
5. Inspect actual screenshots. Check narrow and medium viewports for document overflow, reachable controls and minimap/control overlap. Do not claim GitHub CI or untested platforms passed.

## Observed verification — 2026-11-24
- Before implementation, the browser regression failed because the document language was ko rather than en.
- Before the responsive fix, the new overlap assertion failed at 800px because the minimap covered the canvas controls.
- npm run check passed: 29 Node tests, TypeScript and public JavaScript syntax checks.
- The actual Chrome runner passed with a ko-KR locale override, English history formatting, English application/accessibility text and unchanged Korean/Japanese graph/feedback data.
- Actual 390px and 800px viewport checks passed without document overflow or minimap/control intersection.
- Existing layout/apply/cancel/undo/conflict, selection, focus, pan, minimap, editing and drawing-feedback workflows passed.
- Screenshots are local-only test-results/english-default.png and test-results/browser.png. Public documentation and application source were checked for remaining Korean defaults; intentional multilingual test data is retained.
- Verification ran locally on Windows with Node 24.16 and headless Chrome. No live user DB was changed, no model call was made, and GitHub CI/push remains unverified and paused.
