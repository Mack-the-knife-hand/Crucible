<p align="center"><img src="build/icon.png" width="180" alt="Crucible: crossed pen and sword"></p>

# Crucible

Manuscript writing and editing software with some twists.

Crucible is a free, portable writing workspace with optional AI assistance. Write your book, organize story facts, leave editorial notes, arrange scenes and timelines, and listen to your own music or other audio while you work. No Crucible subscription is required. AI providers may charge separately for API use.

## Start writing

1. **[Download crucible.html](https://github.com/Mack-the-knife-hand/Crucible/raw/refs/heads/main/crucible.html)**. Save the file to a folder on your computer or USB drive.
2. Open the downloaded file in Chrome or Edge.
3. Choose your Crucible working folder and grant the browser permission to save there.
4. Create a practice book, save it, and reopen it before using your main manuscript.

**[Read the illustrated PDF instructions](docs/Crucible-1.9.3-Work-Instructions.pdf)** - includes the program logo and MP3-player controls.

For the complete source, choose **Code > Download ZIP**. Extract it before opening `crucible.html`. This repository contains the browser edition and desktop source, not a prebuilt Windows executable. GitHub's file view does not run the editor: download the HTML first.

## What is included

- Markdown writing with Write, Split and Read views, dark/light themes, chapters and an outline.
- Margin notes, a change pool, reviewable AI suggestions and batch prose passes.
- Story memory for character details, reference photos and rules beyond the manuscript; Markdown and structured-data imports.
- Corkboard and timeline tools for scene structure and chronology.
- Connections to multiple AI providers, with a choice of model and context. AI is optional.
- PDF, Word and EPUB export. PDF import is not a supported workflow documented for this build.
- A local audio player for music, ambient sound or spoken recordings while you write. Listening does not add audio to your exported book.
- Folder-based book data and package backups.

## Your writing and settings

Keep each `.md` manuscript together with its matching `.crucible` folder and referenced images/media. Browser folder settings live in `crucible-settings.json`; that file may contain unencrypted API keys. Do not upload your working folder to this repository.

To update, save and close the app, back up your working folder, and replace only `crucible.html`. Preserve settings, books and companion files. The author's About statement is unchanged.

## Version 1.9.3

The refinement protects edits made while saving, prevents overlapping writes, adds persistent save-error feedback and Retry save, and checks unsaved work before switching books. It also explains AI context and fixes Windows line-ending handling in browser script-security hashes.

See [refinement notes](REFINEMENT-NOTES.md) for changes, validation and limits. Unit tests, focused save/navigation regressions and a browser smoke check passed during refinement. Full desktop/export/restore acceptance testing and live paid-AI calls remain outstanding. Test copies of important work and inspect exports.

## Develop from source

Install Node.js and npm, then run these commands from the extracted repository:

```sh
npm ci
npm run build:web
npm run test:unit
npm run test:refinement
npm start
```

`npm start` runs the Electron desktop source. `npm run build:web` produces `dist-web/crucible.html`; copy that file to the root `crucible.html` when preparing a new browser distribution. Build commands and dependencies are defined in `package.json`. Keep both browser copies synchronized.

Use `npm run audit:shipped` for the shipped-dependency check. The refinement audit reported no advisories in its checked shipped components at the time; build-only dependency advisories were recorded separately. This is not a guarantee against vulnerabilities.

## Feedback and security

Use repository Issues for ordinary bugs and feature requests. Include version, browser/desktop edition and steps to reproduce, with keys and private writing removed. Read [SECURITY.md](SECURITY.md) before reporting a vulnerability; do not publish exploit details or credentials in an issue.

## License

The supplied [LICENSE](LICENSE) is MIT with the Commons Clause condition. Read it for the exact terms, including restrictions on selling the software. Your manuscripts and exports remain yours. See [third-party notices](THIRD_PARTY_LICENSES.md) for included dependencies.
