# Crucible 1.10.0 — Audiobook studio

**1.10.4:** Settings and the actor editor always start from the stored settings, and the browser edition warns when Crucible is open in two tabs (where one could undo the other's changes, such as a new voice service and its key).
**1.10.11:** A selection with no quotation marks now goes entirely to the actor you chose (so "Me (microphone)" opens the recorder for narration too, instead of handing it to the Narrator). The recorder works from the keyboard: Space starts and stops a take, Enter keeps it and moves on, P plays it back.

**1.10.10:** Fix: voices from Google's extended voice library (names like ar-eg-storyteller-10) were wrongly refused as "not a Gemini voice name". Only names with spaces (such as a character name typed into the Voice box) are refused now.

**1.10.9:** Fix: if Google refuses the list of cloned voices (accounts without Voice Replication get "Permission denied"), Load my voices and Test skip it and list your other voices instead of failing.

**1.10.8:** Settings spots a voice model (such as gemini-3.8-flash-tts) set up on a writing-AI card, explains the mix-up, and turns it into a voice service with one click.

**1.10.7:** Load my voices also lists voices you cloned from your own recording in Google AI Studio (Voice Replication), first in the list with your designed voices.

**1.10.6:** An actor whose Voice box is empty or holds something that isn't a voice name (e.g. a character name) is now stopped with a clear message instead of being sent; the service otherwise picks a different voice for every line. The Cast list flags such actors with ⚠.

**1.10.5:** After "Load my voices", the actor editor shows a real dropdown of every voice (picking one fills in the Voice box); the empty voice-service message now says exactly where to add one.


**1.10.3:** a saved API key now says so in green ("✓ Key saved") instead of looking like an empty box.

**1.10.2:** failed clips show their error in the list; an actor left without a voice service uses your only one automatically.

**1.10.1:** voice-service errors now say exactly why a request failed (the browser's own reason, or Google's message), and a key pasted with a stray character is caught with a clear message.

A new **Audio** tab in the right panel turns your manuscript into an audiobook.

## Cast
- Add actors: each one is a voice from **Gemini TTS** or **ElevenLabs**, or **you**, recording through your microphone.
- One actor is the **Narrator**.
- Gemini actors can use a stock voice (Kore, Puck…) or a voice you designed in Google AI Studio (`voice_…`). **Load my voices** lists them.
- The **Direction** box tells Gemini how the character speaks.
- **Test voice** reads the selected text, or a test line, before you commit.

## Voicing
- Select a passage, pick an actor and press **Voice selection**.
- Words inside quotation marks go to that actor. Everything else ("he said", description) goes to the Narrator.
- Tick **Whole selection to this actor** for letters, songs or broadcasts.
- Each piece becomes a clip, saved in `<Book>.crucible/audio/`.
- Voiced text is underlined in the actor's colour.
- Change the words later and the underline turns red-dashed. **Redo out-of-date** voices them again.
- Microphone actors open the recorder: read the line, play it back, keep it or record again. A level meter warns when you're too loud.
- **⇄** gives a line to a different actor. **▶ Play from cursor** plays the finished clips in order, following along in the manuscript.
- **Pronunciation list:** voices receive your spelling of tricky words ("Mamgu" → "Mam-ghee"). The manuscript keeps the real spelling.

## Export
- Clips are joined in reading order with natural pauses: within a paragraph, between paragraphs, and longer at scene breaks and headings.
- Output is one file per chapter, plus a full-book MP3, in a `<Book> audiobook` folder beside the manuscript.
- Formats: MP3 192 kbps (Audible/ACX) or 16-bit WAV.
- Optional levelling to ACX standards: average −20 dB, peaks limited below −3 dB, quiet room tone in the pauses. A report shows each file's levels.
- A coverage table shows how much of each chapter has been voiced.

## Settings
- Two new connection types, **Gemini TTS** and **ElevenLabs**. Add them from "+ Add an AI or voice service…".
- Voice keys are stored and protected exactly like AI keys, and only ever sent to the address saved with them.
- Voice services never appear in the AI desk.

## Desktop edition
- The microphone may be used (sound only) for recording your own lines. Camera and every other permission are still refused.

## Third-party
- MP3 export uses lamejs (LGPL-3.0). See THIRD_PARTY_LICENSES.md.

## Tests
- `test/audio-unit.js` covers segmenting, pronunciation, pauses, chapters, the limiter, WAV writing and the voice-service requests. It runs as part of `npm run test:unit`.
- `test/audiobook.js` is a browser end-to-end test with a fake Gemini TTS server and a simulated microphone. It covers cast, voicing, out-of-date clips, recording, saving, and MP3/WAV export with level checks.
- `test/smoke.js` adds desktop checks: voice calls through the main process, key handling, clip and export files, and microphone-only permission.
