# Crucible 1.11.0

Crucible 1.11.0 rolls up the Audiobook studio (1.10.0) and every fix since, and adds:

## New
- **Opening splash screen.** Crucible opens with its logo for five seconds. Any key, click or tap skips it; the key that skips it never lands in your book.
- **Record narration yourself.** A selection with no quotation marks goes entirely to the actor you choose, so a microphone actor can read narration as well as dialogue.
- **Keyboard recorder.** Space starts and stops a take, Enter keeps it and moves to the next line, P plays it back, Esc finishes. Finish keeps a take you recorded but hadn't kept.
- **Voice list dropdown.** Load my voices fills a real dropdown with every voice: stock voices, Google's extended library, voices you designed, and voices cloned from your own recording.

## Changed
- The About window keeps the author's note but drops its opening line.
- Settings recognises a voice model set up on a writing-AI card and converts it with one click.
- Actors whose Voice box is empty or holds a name with spaces are stopped with a clear message, instead of the service choosing a random voice for each line.
- Play from cursor says when it skips lines that have no audio yet.

## Fixed
- Load my voices no longer fails when Google refuses the list of cloned voices.
- Voices from Google's extended library (for example `ar-eg-storyteller-10`) are accepted.

See [RELEASE-NOTES-1.10.0.md](RELEASE-NOTES-1.10.0.md) for the Audiobook studio itself, and the [work instructions](docs/Crucible-1.11.0-Work-Instructions.pdf) for step-by-step use.

## Tests
- Unit tests (including audio) pass.
- `test/audiobook.js`: 53/53 browser end-to-end checks with a fake Gemini TTS server and simulated microphone, including the splash, keyboard recording and playback of recorded lines.
- `test/smoke.js`: 68/68 desktop checks.
- `test/web.js`: the same two chapter-image checks fail as on 1.9.8 under the test harness; everything before them passes.
- Live paid voice and AI calls were not run by the test suites.
