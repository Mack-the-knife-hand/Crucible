# Crucible 1.9.8

This release brings the saved 1.9.8 features into the GitHub distribution while retaining the save and navigation protections from its earlier refinement.

- Linked pictures are copied into the book's companion folder so they travel with the manuscript.
- Choose a writing-area background image and adjust its opacity.
- Colored passage markers distinguish pictures, notes, and songs.
- Collapse outline sections and use the expanded beta-reader controls.
- Updated OpenAI-compatible request handling adapts supported token parameters.
- Save snapshots preserve edits made while saving, prevent overlapping writes, and retain retry feedback. Book switching still checks unsaved work.

The browser HTML and portable Windows ZIP are rebuilt from this repository. The Windows executable is unsigned. Extract the entire ZIP before running Crucible.exe.

Back up your writing before updating. Replace application files only; keep your manuscripts, companion folders, media, and settings.

The updated [18-page PDF work instructions](docs/Crucible-1.9.8-Work-Instructions.pdf) cover both editions and the added 1.9.8 features.

Validation: unit checks and save/navigation regressions pass. Browser verification uses local simulated AI responses; paid provider calls were not exercised.
