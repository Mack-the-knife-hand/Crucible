# Crucible 1.9.3 — refinement build

Prepared October 31, 2026 from the supplied 1.9.2 source and matching browser HTML.

## Preserved

Mack's author statement and the entire About section are unchanged, verified against the supplied source. The license and security controls remain in place. AI remains optional. Book and settings formats are unchanged.

## Changes

- Save operations use an independent snapshot of manuscript and project data. Edits made while a save is running remain marked unsaved.
- Overlapping Save requests share the ongoing operation instead of starting competing writes.
- The status bar shows Saving, Unsaved changes, Saved time, or a persistent Save failed message. A Retry save button appears after failure.
- Save as errors are handled without losing the current book. Canceling a picker keeps unsaved work open.
- Leaving an edited book offers Cancel, Discard changes, or Save and continue. Recent-book links use the same check.
- Switching books is blocked while an AI-desk request or prose pass is running, to keep results associated with the intended book.
- New books reset the previous book's save timestamps, image cache and narration state.
- Native save-and-quit checks for edits that arrived during the save. Backup packaging also stops if new edits remain unsaved after its preliminary save.
- An expandable explanation beside the AI composer describes the context supplied to the AI, including the distinction between margin notes and change-pool notes.
- Sending without a configured AI keeps the draft message intact. Replies retain the provider name selected when the request started, even if the selector changes later.
- Clearing the conversation waits for an active AI reply to finish.
- Choosing a folder through Settings now presents the same imported-address confirmation used by the welcome screen.
- Browser builds normalize Windows line endings before computing script-security hashes, preventing startup failures without weakening the security policy.
- The status bar can wrap rather than squeezing every indicator into a single row.

## Validation

- Supplied unit suite passed, including endpoint approval and the offline-audit regression.
- New `npm run test:refinement` checks passed for delayed saves, independent project snapshots, duplicate-save prevention, failures, canceled Save as, navigation choices, active-AI navigation blocking and late save results.
- Live `npm run audit:shipped` completed successfully: no reported advisories for Electron 45.2.1, Marked 18.1.2 or DOMPurify 3.4.17; vendored files matched installed packages; Electron patch check passed at test time.
- npm reported 15 moderate advisories in build-only dependencies. They were not automatically upgraded, to avoid unreviewed packaging changes.
- Rebuilt browser HTML includes fresh script-policy hashes.
- Chromium browser smoke check passed: startup with the security policy enabled, editing/unsaved status, About display, canceled navigation preserving text, and expandable AI context help.
- The complete About section was compared with the original and is identical.

## Limits and next validation

This is a refinement build, not a completed release certification. The focused browser smoke check passed; the full browser acceptance suite and Electron desktop checks are not claimed as passed. Live paid AI calls were not made. The full save/reopen/restore/PDF/Word/EPUB acceptance workflow still needs an interactive run on the intended computer. Existing security-review scope and known limitations continue to apply.

Before adopting it for a manuscript, test a copy of a book: edit, save, reopen, apply and undo a suggestion, make a package backup, restore it into a separate folder, and inspect an export.

## Update the browser edition

1. Save and close the current app. Keep a backup of the working folder.
2. Extract this package to a separate folder. The root `crucible.html` is the ready-to-open browser edition; `source/` contains the editable application source.
3. To update your existing working folder, replace only its `crucible.html`. Keep `crucible-settings.json`, books, companion `.crucible` folders and images.
4. Open the new HTML in Chrome or Edge and reconnect your existing folder. Your About statement remains in File > About Crucible.

The source directory is not a prebuilt Windows executable. The earlier PDF manual is not updated by this package; these notes describe the new behavior.
