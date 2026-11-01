# Security

Crucible is free software that people download, run and modify. It must never become a way into someone's computer, so security reports are taken seriously.

## Reporting a problem

**Please report security problems privately.**

- **On GitHub:** if private vulnerability reporting is enabled, use the **Security** tab of the repository → **Report a vulnerability**. This opens a private report that only the maintainer can see.
- **Don't** describe the problem in a public issue, discussion or post until a fix has been released.

Please include:
- which edition (browser `crucible.html`, or the desktop program) and which version (*Settings → About*);
- what an attacker would need to control (a manuscript, a backup zip, a settings file, an AI reply, a web page…);
- steps or a sample file that shows the problem.

You'll get an answer as soon as possible. Fixes are released as a new version, and the release notes credit the reporter unless they'd rather stay anonymous.

## Supported versions

Only the **latest release** gets security fixes. Upgrading is just replacing `crucible.html` (or the desktop program); your books and settings are kept.

## What Crucible protects against

Crucible treats everything it opens as possibly hostile: manuscripts, story-memory files, imported data, settings files, backup zips and AI replies. In particular:

- **Book content is sanitized to prevent code execution.** All HTML made from Markdown, notes or AI replies passes through [DOMPurify](https://github.com/cure53/DOMPurify) with a strict allow-list (plain formatting only, links only to web pages, e-mail or anchors, pictures only from the book's folder). The browser edition only runs scripts whose exact fingerprints are built into it; the desktop window only runs Crucible's own script files. Print and page-layout frames are sandboxed with scripts disabled.
- **Exports restrict file and network access.** The print page carries its own lock-down rules (no scripts, no network, no frames), and on desktop it is rendered in a private, JavaScript-free window that refuses every request except the page itself.
- **The desktop window can only touch books you chose** through an Open or Save dialog, or by restoring a backup. Every request is checked by the main program, which also verifies that requests come from Crucible's own window.
- **Pictures must really be pictures** (checked by their contents, not their names) and must be inside the book's folder.
- **No network paths.** Crucible never opens or checks paths on other computers (`\\server\share`, `//server`, `file://server`), which on Windows could hand your login credentials to that server.
- **Your writing and keys only go where you chose.**
  - A settings file never adds an AI or changes where one sends your text by itself. That covers Import, a restored backup, and **any** Crucible folder's settings file, including the folder Crucible remembers, every time it connects. Crucible lists every server it would use and changes nothing unless you click **Use these addresses**. That includes your active AI and AIs that need no key.
  - "Approved" means exactly the addresses already in your settings, which only get there through your own edits or that click. Remembering a folder is not approval: an address you turned down is asked about again on the next connection, never applied.
  - While a decision is pending, and after **Keep my current AIs**, your existing AIs and your choice of AI stay exactly as they were.
  - If a provider's address or type does change, its saved key is dropped and must be typed again. Addresses are compared exactly: only the scheme and server name ignore letter case; the path and query don't (`/TenantA` ≠ `/tenanta`).
  - AI requests **never follow redirects**, so a server can't bounce your key header and text on to somewhere else.
  - Imported files never switch which AI you're using.
- **Desktop keys are only saved encrypted.** Keys are written to disk only when the operating system can encrypt them (Windows DPAPI, macOS Keychain, a Linux keyring). Linux's `basic_text` fallback is not real encryption and doesn't count. Without secure storage, keys are kept in memory for the session only and never written to disk; *Settings* says so, and you re-enter them next time. Keys saved in plain text by versions before 1.9.1 are encrypted (or removed from the file) the first time 1.9.1 starts. Backups leave keys out unless you tick the box.
- **Backups are unpacked safely.** No paths outside the new folder, no Windows device names, every file checked against its checksum and its declared size, overlapping entries and implausible sizes refused, and free disk space checked first.
- **The desktop program is hardened.** Sandboxed window, context isolation, no Node.js in the page, all permissions refused except the clipboard for Paste, navigation and new windows blocked, and Electron "fuses" set so the program can't be repurposed as a general script runner (no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no debugger flags, app files integrity-checked).

## Known limits (by design)

- **Browser edition API keys** are stored in plain text in `crucible-settings.json` (unless you turn that off) so they travel with your drive. Anyone with the unlocked drive can read them. Use BitLocker, set spending limits, and revoke keys if a drive is lost.
- **Your AI provider sees what you send it**: the passages, notes and, if you tick it, the whole manuscript. Choose providers you trust, or a local model.
- **A malicious AI provider** (one *you* added) can suggest harmful edits. Every AI change needs your click to apply, and is undoable.
- **The browser edition can connect to any web address**, because your AI could be anywhere. Script fingerprinting and the sanitizer are what stop a manuscript from using that.
- **Unsigned Windows build**: until it's code-signed, Windows SmartScreen will warn about `Crucible.exe`. Download it only from the official release page, and check it on VirusTotal if in doubt.

## Reviews

- **Version 1.9.0:** an independent code review covered Electron hardening, the IPC surface, HTML sanitizing, archive handling, secret storage, network behaviour, settings import and the build. It found 14 issues (three severe). All were fixed or mitigated, and each attack is replayed by the automated tests (`npm run test:smoke`, `npm run test:web`). Also scanned with Electronegativity.
- **Version 1.9.1:** a second, outside review of 1.9.0 found four more gaps, all fixed and covered by tests:
  1. AI requests followed redirects, forwarding the `x-api-key` header and manuscript text.
  2. An import could change the active AI's address.
  3. Address comparison ignored letter case in the path.
  4. Desktop keys fell back to plain text without OS encryption.

  It also found two verification problems, both fixed: Playwright wasn't declared, and `npm audit --omit=dev` skipped the shipped libraries.
- **Version 1.9.2:** a review of 1.9.1 found:
  1. A remembered Crucible folder re-applied an AI address you had rejected (a bypass of the 1.9.1 confirmation).
  2. **Keep my current AIs** could remove your existing AIs when a folder proposed different ones.
  3. `audit:shipped` reported success when the registry couldn't be reached.

  All three are fixed and replayed by the unit and browser tests.

## Third-party code that ships inside Crucible

- **Electron** 45.x: the desktop program's runtime (Chromium + Node.js).
- **marked** 18.x: Markdown parser, copied into `src/vendor/`.
- **DOMPurify** 3.x: HTML sanitizer, copied into `src/vendor/`.

All three are listed as *devDependencies* (Crucible bundles them itself), so `npm audit --omit=dev` would **skip them**. Use `npm run audit:shipped` instead. It runs a full audit and reports advisories for these three by name, listing build-only tools separately. Exit codes:
- **0**: every check completed and is clean.
- **1**: something shipped needs attention.
- **2**: NOT VERIFIED. A check couldn't be completed (offline, registry error, incomplete or unexpected answer), and it never says "all clear" in that case. It also confirms the copies in `src/vendor/` are byte-identical to the audited package versions, and that Electron is on the newest patch release of its major version (Electron patches carry Chromium security fixes). npm advisories don't cover every Chromium fix, so staying on the latest Electron patch is the real protection there.

## Checking a build yourself

```bash
npm install                                  # includes Playwright (pinned) for the browser tests
npm run test:setup                           # once: downloads the Chromium the browser tests use
npm run audit:shipped                        # third-party code inside Crucible (see above)
npx @doyensec/electronegativity -i .         # Electron security checks
npm run test:unit
npm run test:smoke                           # desktop, includes the attack replays
npm run test:web                             # rebuilds crucible.html, then the browser tests (with the attack replays)
```

On Linux without a display, run the last two under `xvfb-run -a`. The end-to-end tests also need `python3` with `python-docx` (Word and backup checks). They use `pdftotext`/`pdfinfo` (poppler-utils) and `epubcheck` when installed, and skip those checks otherwise. Put a `test.png` and `test.mp3` in a folder and point `CRUCIBLE_FIXTURES` at it to include the picture and music checks.
