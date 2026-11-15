#!/usr/bin/env python3
# Crucible work instructions -> PDF (WeasyPrint). Usage: build.py OUT.pdf
import sys, html
from weasyprint import HTML

VER = '1.11.0'
DATE = '15 November 2026'
esc = html.escape

pages = []  # (id, html)

def P(t, cls=''): return f'<p class="{cls}">{t}</p>'
def H2(t): return f'<h2>{t}</h2>'
def OL(*items): return '<ol>' + ''.join(f'<li>{i}</li>' for i in items) + '</ol>'
def UL(*items): return '<ul>' + ''.join(f'<li>{i}</li>' for i in items) + '</ul>'
def NOTE(t): return f'<div class="note">{t}</div>'
def TABLE(head, rows, w='38%'):
    h = ''.join(f'<th>{c}</th>' for c in head)
    b = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
    return f'<table><colgroup><col style="width:{w}"><col></colgroup><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>'
def KICK(t): return f'<div class="kicker">{t}</div>'
def page(pid, title, *body):
    k = ''
    pages.append((pid, title, f'<section class="pg" id="{pid}"><h1>{title}</h1>{k}' + ''.join(body) + '</section>'))

# ------------------------------------------------------------------ content
cover = f'''<section class="cover">
<img class="logo" src="icon-512.png">
<div class="ct1">CRUCIBLE</div><div class="ct2">Work Instructions</div>
<div class="tag">Write. Organize. Revise. Voice. Save.</div>
<div class="meta">Version {VER} | Updated {DATE}</div>
<p class="small">A practical guide to the portable browser and Windows editions, with edition-specific steps identified where relevant.</p>
<p>AI is optional. You can write, organize and export without configuring an AI provider.</p>
<p class="small spaced">This edition replaces the 1.9.8 instructions and covers the GitHub {VER} release, including the new Audiobook studio. Your books and settings remain separate from the program files.</p>
</section>'''

page('open', 'Open Crucible',
  H2('Browser edition: computer or USB drive'),
  OL(f'Download crucible.html from the GitHub {VER} release into a folder on your computer or USB drive. Open the downloaded file in Chrome, Edge or another Chromium browser such as Opera.',
     'Choose the Crucible-folder option and select your working folder. Grant file-editing permission when prompted. You can make a new folder using the folder picker or your file manager.',
     'Keep books in this folder or named subfolders. On later visits, reconnect the remembered folder with Open &lt;folder&gt; and grant permission again if requested.',
     'Create and save a practice book. Close and reopen it to confirm that the saved file and its companion data are available.'),
  P('If folder editing is unavailable, Crucible can fall back to browser storage. That storage is tied to that browser, not to a portable USB folder. Download a manuscript copy before clearing browser data or changing computers.'),
  NOTE('<b>Run one copy at a time.</b> Open Crucible in a single browser tab. A second tab can overwrite settings made in the first, such as a new voice service and its key; Crucible warns when it notices two tabs. After replacing crucible.html, close every old Crucible tab before opening the new file. If your browser saved the download as crucible (1).html, rename it.'),
  H2('Desktop edition'),
  P(f'Download Crucible-{VER}-win.zip from the release page. Extract the entire ZIP, then run Crucible.exe. Keep its supporting files together. This unsigned build may show a Windows publisher warning; confirm its source before opening.'),
  H2('Opening splash'),
  P('Crucible opens with its logo, name and version for five seconds. Press any key, click or tap to skip it sooner. The key that skips the splash is not typed into your book.'),
  H2('Make the workspace comfortable'),
  P('Use the Light/Dark button to switch appearance. Write shows editable Markdown; Split shows editing and preview; Read shows the rendered manuscript. Collapse side panels or use Focus when you need more writing space.'),
  H2('Offline use'),
  P('Writing and local file work do not need a hosted AI. Cloud AI and voice requests need a connection and a provider account. A local model service must be running and configured to accept Crucible requests. Any provider usage charges are separate from Crucible.'))

page('books', 'Create, open and save books',
  OL('Choose File &gt; New book. Replace the starter title and chapter heading.',
     'Use Ctrl+Shift+S for Save as. Choose a book folder and filename, such as The Lantern House.md.',
     'Use Open or Ctrl+O to reopen an existing .md manuscript. Crucible loads companion data from the adjacent matching .crucible folder.',
     'Use Ctrl+S after meaningful changes. Autosave is optional, runs at five-minute intervals when enabled, and requires an already named book.'),
  TABLE(['Keep together', 'Purpose'], [
    ['The Lantern House.md', 'Editable manuscript.'],
    ['The Lantern House.crucible/', 'Notes, pool, chat, memory, metadata, manuscript backups and audiobook clips (audio/).'],
    ['The Lantern House audiobook/', 'Exported chapter and full-book audio files.'],
    ['Images and linked media', 'Files referenced by the manuscript or research links.'],
    ['crucible-settings.json', 'Browser folder settings; may contain API keys.']]),
  H2('Move a complete project'),
  P('One named folder per book makes projects easier to manage. Copy the manuscript, matching companion folder and referenced assets together. External links may point elsewhere; include or relink those files, or use Package &amp; back up.'),
  H2('Bring in an existing manuscript'),
  P('Open a Markdown book directly. For other manuscript formats, obtain a Markdown or plain-text version first and check its paragraphs, headings and pictures. This build does not provide a verified PDF-reading/import or Word-manuscript import workflow.'),
  NOTE('A PDF, Word or EPUB export is a delivery copy. Keep the editable .md book and companion folder for continued work. Opening a research .md file as a book is different from importing it into Story memory.'))

page('save', 'Save status and recovery',
  TABLE(['Status', 'What to do'], [
    ['Not saved yet', 'Use Save or Save as to name and store the book.'],
    ['Unsaved changes', 'Writing or book data needs saving.'],
    ['Saving', 'A snapshot is being written. Wait before closing or removing a drive.'],
    ['Saved / Autosaved + time', 'That save completed. Check that no newer changes remain unsaved.'],
    ['No unsaved changes', 'The opened book currently has no changes marked for saving; this is not a new save confirmation.'],
    ['Save failed - retry', 'Read the error, restore folder access, then use Retry save or Save as.']]),
  H2('You can continue typing during a save'),
  P('A save writes a snapshot of the manuscript and book data. Edits made afterward remain marked unsaved when that save finishes. Save again to write them. Repeated Save clicks during an active write share that operation; they do not queue a separate save of newer text.'),
  H2('Before leaving a changed book'),
  P('New, Open and recent-book navigation use the same decision: Save and continue saves first; Discard changes leaves without preserving the unsaved changes; Cancel keeps the current book open. A failed or canceled save does not authorize the switch. If you edited during the save, save the newer changes before continuing.'),
  P('Wait for an AI-desk reply to finish, or stop the Prose pass and let its active request finish, before switching books. This keeps results associated with the intended manuscript. New chat is also blocked while an AI-desk reply is in progress.'),
  H2('Recover from a failed save'),
  OL('Keep the app open. Reconnect or unlock the drive and restore write permission.',
     'Click Retry save. If the location is still unavailable, use File &gt; Save as to save in another accessible location.',
     'Confirm the saved filename and status before closing. Pause typing for the final save, close the app, then safely remove the USB drive.'))

page('write', 'Write and organize chapters',
  TABLE(['Markdown in Write view', 'Rendered result'], [
    ['# The Lantern House', 'Book title.'],
    ['## Chapter One: The Letter', 'Chapter heading and outline entry.'],
    ['### The Harbor', 'Smaller scene heading.'],
    ['**bold** / *italic*', 'Emphasis.'],
    ['*** on its own line', 'Scene break.'],
    ['Blank line between paragraphs', 'Separate paragraphs.']]),
  H2('Everyday editing'),
  P('Write or Split is for entering text; Read or preview shows formatting. Ctrl+F or Ctrl+H opens finding and replacing. In the browser edition, Shift+right-click exposes the browser spelling menu. Right-click &gt; Align changes paragraph alignment; alignment markers can remain visible in Markdown.'),
  H2('Chapter builder and collapsible outline'),
  OL('Open Chapters from Outline or File. Outline arrows collapse or expand child entries.',
     'Select a chapter. Rename it, add another, change order with the controls, or choose numbering options.',
     'When deleting, distinguish removing only a heading from removing the whole chapter and its text.',
     'Add a chapter image if wanted, review the order, and choose Apply changes.',
     'Check the Outline and manuscript, then save. Back up before major restructuring.'),
  NOTE('Bulk operations can reset earlier typing undo history. Undo can reverse the applied bulk change, but a separate backup is the better recovery point for an extended restructuring session.'),
  H2('Space to write'),
  P('Ctrl+[ toggles the left panel; Ctrl+] toggles the right; Ctrl+backslash toggles Focus. Restore panels when you need Outline, Notes, the pool, AI tools or the Audio tab. Click Today in the status area for writing goals; word-count progress is net additions, so cutting text can reduce it.'))

page('notes', 'Notes and the change pool',
  TABLE(['Type', 'Use it for'], [
    ['Margin note', 'An editorial reminder anchored to text.'],
    ['Change pool note', 'An instruction about a passage you want AI to revise.'],
    ['Story memory note', 'Persistent facts and rules beyond the manuscript.']]),
  H2('Add and manage a margin note'),
  OL('Select text or place the cursor in its paragraph. Press Alt+N or use the right-click margin-note command.',
     'Enter the reminder. In Notes, use Edit to revise it, Show to return to the passage, Resolve when finished, or delete a mistaken note.',
     'When the cursor is in annotated text, the status area can show a note indicator such as 1 note here. Click it to open the associated note.'),
  NOTE('Margin notes are not automatically included in AI requests. Put an AI editing instruction in a pool note or the AI message. Put durable background in enabled Story memory.'),
  H2('Queue an AI request'),
  OL('Highlight a sentence or passage. Right-click &gt; Add to pool with a note.',
     'State both the change and the constraints: Make the coffee stale; preserve the quiet tone and the action.',
     'Use Negotiate on that item, or select several items and use the batch Negotiate control. Confirm they appear On the table at the AI desk.'),
  H2('Clean up work'),
  P('Dismiss removes an item from active work without deleting it; Reopen returns it to pending work. Delete from pool removes a mistaken list item. History records associated edits. Deleting or dismissing an item does not undo text already applied. Review outstanding work using Notes and pool statuses, and save changes to the book data.'))

page('ai', 'AI connections and saved keys',
  OL('Open Settings and use the <b>+ Add an AI or voice service…</b> list at the bottom. Choose a writing-AI preset (Claude, OpenAI, Google Gemini, Ollama and others) or a compatible service.',
     'Enter your API key and the exact model ID from your provider. Chat-service subscriptions and API access can be separate.',
     'Use Test to save and send a small request. Resolve the reported error before a longer editing job.',
     'Add other connections as needed. Switch using the top AI selector. Edit the model field in Settings to change a connection\'s model.'),
  NOTE('<b>Writing AIs and voice services are different cards.</b> Gemini TTS and ElevenLabs voice services (marked 🎙 Voices) are used only by actors in the Audio tab and never appear in the AI selector. Add them from the same list; do not rename a Google Gemini writing card. If a voice model is entered on a writing card, Settings flags it and offers <b>Make this a voice service</b>. See page <a class="pref" href="#ab-setup"></a>.'),
  H2('Check imported addresses'),
  P('When folder settings, imported settings or a backup would add or change an AI or voice address, review Check these AI addresses. Choose Use these addresses only for servers you recognize. Keep my current AIs retains your existing connections while other settings can import. Importing does not automatically switch the active AI.'),
  P('Changing a provider Base URL or connection type clears its saved key; enter the key intended for that destination. A saved key shows as <b>✓ Key saved</b> in green; the box is left blank for safety, and typing in it replaces the key. Requests do not follow redirects.'),
  H2('Keep keys between updates'),
  P('Browser folder mode normally stores keys in crucible-settings.json. Preserve this file when replacing crucible.html. It is not encrypted. Untick Keep API keys in crucible-settings.json to keep keys off that drive; they may still be retained in the browser. Settings export/import offers a separate choice about including keys.'),
  P('The desktop edition uses operating-system secure storage when available. Without secure storage, it keeps keys only for the session and asks again after restart.'),
  H2('Using AI is optional'),
  P('Writing, organizing and exporting work without an API key. Before sharing settings or a backup, check whether keys are included. Never place keys in your manuscript, memory notes or AI messages.'))

page('context', 'Context and passage rewrites',
  H2('What the AI receives'),
  P('Expand What does the AI receive? beside the composer. The AI desk includes up to 30 recent chat messages, including the current message; passages On the table with pool notes and nearby text; and either the whole manuscript when selected, or the outline and opening 1,500 characters. Enabled story memory and selected memory images are supplied when Use story memory is checked, subject to limits. Margin notes are not automatic context. Prose pass and Beta reader use their own selected scope.'),
  P('To use several models, ask one for analysis, wait for its reply, switch connections, and ask another to revise using the same relevant context. Replies retain the provider selected when their request began. Put accepted decisions into Story memory.'),
  H2('Example: fresh coffee becomes stale coffee'),
  OL('Select: The kitchen smelled of fresh coffee.',
     'Right-click &gt; Add to pool with a note. Enter: Make the coffee stale instead of fresh. Keep one sentence and preserve the quiet tone.',
     'Choose Negotiate. Confirm that sentence appears On the table and select your AI.',
     'Send: Rewrite this passage using its note. Return a suggested change I can apply. Ctrl+Enter sends from the AI box.',
     'Review the proposed card and its Diff. Ask for adjustments if needed.',
     'Choose Apply on the accepted rewrite. Confirm the actual manuscript changed, then save.'),
  H2('A suggestion is not yet an edit'),
  P('Copy only copies a suggestion. Ordinary chat text does not replace manuscript text. Ask for an apply-ready replacement if no card appears. If the original passage cannot be matched, reselect the current wording and request a fresh replacement. Use Ctrl+Z promptly for a wrong applied edit; deleting its pool item does not reverse it.'))

page('batch', 'Batch revision and continuity',
  H2('Run a Prose pass'),
  OL('Save and make a backup before broad edits. Open Prose pass in the right panel.',
     'Choose Selection, Chapter at cursor or Whole book. Choose Proofread, Copy edit or Line edit according to how much change you want.',
     'Enter constraints, such as Keep all dialogue unchanged. Enable story memory when the pass should follow established facts.',
     'Start the pass. Large sections are processed in chunks. Stop pauses after the current request; Resume continues saved progress.',
     'Review cards. Show locates a passage, Accept applies a proposal, and Skip leaves the text unchanged. Inspect scope before using Accept all.',
     'Use the Accepted filter and Revert for accepted changes you want to reverse. Check the resulting manuscript and save.'),
  P('A proposal is not applied when its original text cannot be matched. Editing the same passage during a pass can make proposals stale. Book switching is blocked while the pass is running.'),
  H2('Check continuity'),
  OL('Update and enable the Story memory facts that must remain true.',
     'In Prose pass, choose Continuity check and normally Whole book, then Check continuity.',
     'Review each contradiction against the story and notes. Use Apply fix when appropriate, or mark I\'ve fixed it / Not a problem.'),
  NOTE('Continuity checking uses a running fact sheet and enabled memory. It can miss issues or mistake deliberate mysteries for errors. Beta reader supports selected chapters and custom reader profiles; see page <a class="pref" href="#beta"></a>.'))

page('memory', 'Story memory and data imports',
  H2('A reference shelf beyond the manuscript'),
  OL('Open Story memory &gt; + New note. Use focused topics such as Mara - character, Time travel rules, or Harbor geography.',
     'Write concise facts and constraints, add useful tags, and enable AI reads this when the note should influence AI work.',
     'Enable the AI tool\'s story-memory option and ask a specific question: Does this scene violate the return-marker rule?'),
  P('Separate established facts from possibilities and unanswered questions. Record approved decisions here after AI discussions instead of relying only on old chat messages.'),
  H2('Import a Markdown data dump'),
  OL('Choose + Photos/files in Story memory and select your .md or .txt background file.',
     'Inspect the imported material, give it a useful name, and enable it for AI reading where appropriate.',
     'Break long dumps into focused notes and disable irrelevant material for a narrowly scoped request.'),
  P('Memory is not automatically inserted into the story or printed in exports.'),
  H2('Import structured facts'),
  P('Use + Import data for CSV, TSV or JSON. Inspect the preview, choose the record-identifying field, and decide whether to create a combined note or separate notes per record.'),
  H2('Check the context meter'),
  P('The story-memory limit is set in Settings. Changing it does not expand a model\'s own context capacity. Later material can be omitted when the limit is exceeded. Inspect truncation warnings, shorten notes or reduce enabled context before asking questions that depend on exact facts.'))

page('scenes', 'Scenes, timelines and media',
  H2('Arrange the story'),
  OL('Use chapter headings and scene headings or breaks to divide the manuscript. Open Corkboard from Outline or File.',
     'Double-click a scene card to edit its summary, date/time, track and color. Drag cards to change scene order or move between chapters; review and Apply changes.',
     'Open Timeline. Use consistent dates, such as 2032-05-04 08:00, and meaningful tracks. Compare story-time order with reading order, then save.'),
  NOTE('Scene metadata is stored in hidden Markdown comments. Preserve them when editing elsewhere. Timeline follows scene dates, not reading order.'),
  TABLE(['Asset purpose', 'Where to put it'], [
    ['Picture printed in the book', 'Chapter image or manuscript image.'],
    ['AI reference photo', 'Story memory with a useful description.'],
    ['Picture tied to a passage', 'Right-click picture-link command; manage in Links.'],
    ['Atmosphere or music', 'Playlist or passage-linked song.'],
    ['Narration of your book', 'Audio tab (Audiobook studio).']]),
  H2('Reference photos and linked pictures'),
  P('In Story memory, use + Photos/files. Describe the important details and enable AI reads this. To send image pixels, enable Show image to AI and select a model that accepts images. Linked pictures are copied to the book\'s .crucible/linked folder and travel with it.'),
  H2('Listening'),
  P('Use the right-click read-aloud command for a quick listen with your system voice. To produce a real audiobook with character voices or your own recordings, use the Audio tab (page <a class="pref" href="#ab-setup"></a>). The MP3 player is for listening while you write (page <a class="pref" href="#mp3"></a>).'))

page('export', 'Export PDF, Word and EPUB',
  H2('PDF reading copy'),
  OL('Save the book. Open Export or press Ctrl+Shift+E and choose PDF.',
     'Set page size, margins, font and text size. Choose title-page, page-number and contents options.',
     'Set New page for to the heading level used by chapters, normally ## when # is the book title. Enable Book-style indents if wanted, and Leave out comments to omit internal Markdown comments.',
     'In the browser, finish through its print window and choose Save as PDF. In the desktop edition, choose the PDF destination.',
     'Open the exported PDF and inspect title page, chapter starts, images, contents numbers and first/last lines on pages.'),
  P('Turn off browser headers/footers if dates, URLs or duplicate headers appear.'),
  H2('Place the contents'),
  P('Export offers Chapters, Chapters and scenes, or no contents. To choose a location, put the cursor there and use right-click &gt; Insert table of contents here. Keep [TOC] on its own line.'),
  H2('Word'),
  P('Choose Word (.docx), then Manuscript format or Book style. Open the exported file in Word and update the contents field when prompted.'),
  H2('EPUB'),
  P('Choose EPUB e-book and fill in available title, author and cover options. Open the result in the intended reader and test navigation, chapter starts, images and several text sizes.'),
  NOTE('Audiobook export is separate: Audio tab &gt; Export audiobook… (page <a class="pref" href="#ab-export"></a>). Keep an editable project backup and regenerate delivery files after manuscript revisions.'))

page('backup', 'Back up, restore and update',
  H2('Package a complete workspace'),
  OL('Save, then choose Package &amp; back up from the top bar or File. If newer edits remain unsaved after its preliminary save, packaging stops; save again and retry.',
     'Review the included books, media, settings and app where offered. Leave API keys out of shared packages unless you deliberately intend to include them.',
     'Save the ZIP somewhere separate, preferably another drive. Keep dated copies before major edits and software updates.'),
  P('Audiobook clips live inside the book\'s .crucible/audio folder and travel with the book. They can be large; check free space on a USB drive.'),
  H2('Restore and verify'),
  OL('Choose the File menu\'s restore-backup command and select the ZIP.',
     'Choose a destination; the restore workflow makes a new restored folder.',
     'Open a restored .md file. Check manuscript, memory, notes, pool, linked pictures and audio clips. Review any imported AI-address prompt before accepting connections.',
     'Keep the original backup until the restored project is confirmed usable.'),
  P('File &gt; Backups previews and restores earlier manuscript versions (up to 30 previous .md versions).'),
  H2('Update without losing keys or books'),
  OL('Save and close Crucible. Back up the working folder.',
     'Replace only your working folder\'s crucible.html with the updated browser file. Check that the new file is named exactly crucible.html.',
     'Preserve crucible-settings.json, manuscripts, matching .crucible folders, images and other media.',
     'Close every old Crucible tab, open the new HTML, reconnect the working folder, and check the version on the splash screen or in File &gt; About Crucible.'),
  NOTE('For Windows, extract the full ZIP into a new application folder. Keep your book folders intact. Program files are not a backup of writing.'))

page('trouble', 'Troubleshooting and shortcuts',
  TABLE(['Symptom', 'Next step'], [
    ['Save failed / USB unavailable', 'Keep the app open. Restore access and Retry save, or use Save as elsewhere.'],
    ['Unsaved after a save', 'New edits arrived during the write. Save again after it finishes.'],
    ['Book will not switch', 'Finish the AI reply or stop Prose pass; resolve the Save / Discard / Cancel choice.'],
    ['HTTP 404', 'Check preset, Base URL and exact model ID.'],
    ['401 / 403 / 429', 'Check key and model permissions; for 429, check usage limits/credit and retry later.'],
    ['AI ignored a note', 'Use pool instructions or enabled memory; margin notes are not sent automatically.'],
    ['Rewrite did not change text', 'Use Apply on a card, not Copy. Reselect if the original text no longer matches.'],
    ['Old version still showing', 'You opened an older crucible.html (check the splash version). Replace it and close old tabs.'],
    ['Actor has no voice service', 'Add Gemini TTS or ElevenLabs from + Add an AI or voice service…'],
    ['Developer instruction not enabled', 'A voice model is on a writing card. Use Make this a voice service.'],
    ['Narrator changes voice each line', 'The actor\'s Voice box is empty or not a voice name. Load my voices and pick one.'],
    ['Recorded line skipped in playback', 'The take was not kept. Press ↻ on the waiting clip and record again.']], w='40%'),
  TABLE(['Shortcut', 'Action'], [
    ['Ctrl+O / Ctrl+S / Ctrl+Shift+S', 'Open / Save / Save as.'],
    ['Alt+A (browser)', 'Add selection to pool; desktop uses Ctrl+Shift+A.'],
    ['Alt+N / Ctrl+F or Ctrl+H', 'Margin note / Find and replace.'],
    ['Ctrl+Enter / Ctrl+Shift+E', 'Send from AI box / Export.'],
    ['Ctrl+[ / Ctrl+] / Ctrl+backslash', 'Toggle left / right / Focus.'],
    ['Space / Enter / P (recorder)', 'Record or stop / keep &amp; next / play take.'],
    ['Any key (splash)', 'Skip the opening splash.']], w='40%'),
  P('For a fault report, record version, edition, exact error and reproducible steps. Remove keys from anything you share.', 'small'))

page('mp3', 'MP3 player: listen while you write',
  P('The bottom player is simply for listening to music or other audio while you write. It needs no AI and does not add audio to your manuscript or exports. To make an audiobook of your manuscript, use the Audio tab instead.'),
  H2('Add audio and start listening'),
  OL('Click Playlist at the bottom right to open the playlist panel.',
     'Choose + Songs to select individual audio files, or + Folder to add audio from a folder.',
     'Click a track name or double-click its row to start. Play starts the first item if none is loaded.',
     'Return to writing. Use the bottom controls without leaving your book. Click Playlist again to hide the list.'),
  TABLE(['Control', 'Operation'], [
    ['Play / Pause', 'Start or pause the loaded track. Space does the same when you are not typing in an input field.'],
    ['Previous / Next', 'Next advances to another track. Previous restarts the current track after more than 3 seconds; near its beginning, it selects the previous track.'],
    ['Progress slider', 'Drag to move within the loaded track.'],
    ['Volume slider', 'Adjust listening volume; this preference is saved.'],
    ['Shuffle / Repeat', 'Random next track / repeat the current track.']]),
  H2('Arrange or remove playlist entries'),
  P('Use the up/down arrows beside an entry to change its order. Remove deletes that entry from the playlist; Clear asks before removing the whole list. Neither deletes audio files from disk.'),
  H2('Keep audio available between sessions'),
  P('The playlist is shared across books and saved in settings. Files play from their original locations. For USB use, keep audio inside the working folder and use + Folder.'))

page('pictures', 'Pictures, colour and backgrounds',
  H2('Keep linked pictures with the book'),
  OL('Save the book to give it a folder. Select the passage and choose the right-click picture-link command.',
     'Select the picture. Crucible stores a copy inside &lt;Book&gt;.crucible/linked. Move this entire companion folder with the manuscript.',
     'Use Links to View the picture, Go to its passage, or Change file.'),
  H2('Read the coloured passage markers'),
  TABLE(['Colour', 'Meaning'], [
    ['Purple', 'A picture is attached to this passage.'],
    ['Orange', 'An unresolved margin note is attached.'],
    ['Green', 'A song is attached.'],
    ['Striped colours', 'More than one attachment type overlaps here.'],
    ['Underline in an actor\'s colour', 'This passage has audiobook audio (Audio tab). Red dashes mean the words changed since it was voiced.']]),
  P('Click within the coloured passage and check the status bar for its attachments. In Settings &gt; Coloured passages, switch highlighting on or off. The Audio tab has its own Underline voiced text switch.'),
  H2('Choose a writing background'),
  OL('Open Settings and find Background photo. Select Choose photo and pick an image (up to 20 MB).',
     'Adjust Opacity. Start around 10-30% so text remains easy to read.',
     'Save to retain the setting. Use Remove photo to return to the plain background, then Save.'))

page('beta', 'Beta reads and Windows updates',
  H2('Ask for a chapter-range beta read'),
  OL('Choose your configured AI from the top selector. In the AI desk, open Beta reader.',
     'Select a Reader. Edit Who they are to describe the reader you want. Save as new reader keeps a named profile for later.',
     'Choose what to Read: selected text, the section at the cursor, a chapter range, or the whole manuscript.',
     'Check the displayed scope and length. Large requests can be slower and cost more with a paid provider.',
     'Enter an optional Focus and select Ask for a read. Review the response at the AI desk.'),
  P('This is simulated reader feedback, not a manuscript rewrite or a guarantee of factual accuracy.'),
  H2('Update the portable Windows application'),
  OL('Save your book, confirm no unsaved changes remain, and close Crucible. Make a dated project backup.',
     f'Download Crucible-{VER}-win.zip from the official release. Extract the complete ZIP into a new application folder; do not run from inside the ZIP or copy only Crucible.exe.',
     'Launch the new Crucible.exe. The build is unsigned, so Windows may show an unknown-publisher warning. Verify that the download came from this release before choosing to run it.',
     'Open a practice copy of a book. Check text, notes, memory, pictures, audio clips, provider settings and a save/reopen cycle.'),
  P('The desktop edition asks for microphone access (sound only) the first time you record a line; camera and other permissions remain refused.'))

# ---------------------------------------------------------------- audiobook
page('ab-setup', 'Audiobook studio: set up voices', KICK(f'New in {VER} | The Audio tab in the right panel'),
  P('The Audiobook studio turns your manuscript into narrated audio. Each character is an <b>actor</b> voiced by Gemini TTS, ElevenLabs, or you through a microphone. One actor is the Narrator.'),
  H2('Add a voice service (once)'),
  OL('Open Settings. At the bottom, open <b>+ Add an AI or voice service…</b> and choose <b>Gemini TTS (audiobook voices)</b> or <b>ElevenLabs (audiobook voices)</b>.',
     'The new card shows a 🎙 Voices tag. Paste your API key. A Google Gemini key works for Gemini TTS; the model is gemini-3.8-flash-tts.',
     'Press Test. It should report how many voices are available. Press Save.'),
  NOTE('Do not add Google Gemini (the writing AI) and rename it "Gemini TTS"; it will not appear in the actor list. The connection type must say Gemini TTS (voices).'),
  H2('Create your cast'),
  OL('Open the Audio tab and press <b>+ Actor</b>. Your first actor is offered as the Narrator.',
     'Enter the character\'s name and colour. Under Who reads, choose AI voice or Me, recording with my microphone.',
     'For an AI voice, choose the Voice service, press <b>Load my voices</b>, and pick a voice from the dropdown. Do not type the character\'s name in the Voice box: Crucible refuses names with spaces.',
     'Write a short <b>Direction</b>: how the character speaks (age, accent, pace, temperament). Keep the Narrator\'s direction about delivery only, for example: Calm, warm, measured audiobook narration.',
     'Select a line of the character\'s dialogue in the manuscript and press <b>▶ Test voice</b>. Try several voices before you commit. Save.'),
  H2('Stock, designed and cloned voices'),
  TABLE(['Voice kind', 'How to get it'], [
    ['Stock and library voices', 'Listed by Load my voices (for example Kore, Charon, ar-eg-storyteller-10).'],
    ['Designed voice (voice_…)', 'Describe a voice in Google AI Studio (Gemini 3.8 Flash TTS &gt; Create new voice &gt; Voice Design). It appears in Load my voices.'],
    ['Your own cloned voice', 'AI Studio &gt; Create new voice &gt; Voice Replication: a 10-30 second sample and a spoken consent statement, recorded in the same quiet room. Listed first in Load my voices once your account allows it.']]),
  P('A designed or cloned voice keeps the same sound from line to line. A stock voice with a long character description can drift slightly. Generated audio carries Google\'s SynthID watermark; check your retailer\'s rules on AI narration before publishing.', 'small'))

page('ab-voice', 'Voice your book', KICK(f'New in {VER} | Audio tab'),
  H2('Voice a passage'),
  OL('Select a passage in the manuscript: a line, a paragraph or a whole scene.',
     'In Voice a passage, pick the Actor. The panel summarises the selection, for example 3 pieces: 2 in quotes, 1 narration.',
     'Press <b>Voice selection</b>. Words inside quotation marks go to the chosen actor; everything else goes to the Narrator. Progress shows each line; Cancel stops after the current one.',
     'Listen with ▶ on each clip, or put the cursor at the start of a passage and press <b>▶ Play from cursor</b>.'),
  TABLE(['Situation', 'What happens'], [
    ['Selection with quotes and narration', 'Quotes to the chosen actor, the rest to the Narrator.'],
    ['Selection with no quotation marks', 'All of it to the chosen actor (useful for reading narration yourself).'],
    ['Whole selection to this actor ticked', 'All of it to the chosen actor, quotes or not: letters, songs, broadcasts.'],
    ['Narrator chosen', 'Always reads the whole selection.'],
    ['Passage already voiced', 'Crucible asks before replacing its clips.']]),
  H2('Read the clip list and underlines'),
  P('Voiced text is underlined in the actor\'s colour. Each clip shows actor, length and status. <b>↻</b> voices or records it again, <b>⇄</b> gives it to another actor, <b>✕</b> deletes it. A failed clip shows its reason in red under the line.'),
  P('If you edit voiced words, the underline turns red-dashed and the clip is out of date. Press <b>Redo out-of-date</b> to voice only those lines again.'),
  H2('Fix pronunciation'),
  OL('Press <b>Pronunciation list</b> in the Finish area.',
     'Add a word as written (Mamgu) and how it should sound (Mam-ghee). Tick Aa to match capitals exactly.',
     'Save, then press ↻ on lines already voiced. The manuscript keeps the real spelling; only the voices hear the respelling.'),
  NOTE('Voice services charge by use. Voice a test passage first, listen, then work through the book chapter by chapter. Play from cursor names any lines it skips because they have no audio yet.'))

page('ab-export', 'Record yourself and export', KICK(f'New in {VER} | Audio tab'),
  H2('Record your own lines'),
  OL('Create an actor with Who reads set to Me, recording with my microphone.',
     'Select the passage, pick that actor and press Voice selection. The recorder opens with the first line. Allow microphone access the first time.',
     'Press <b>Space</b> (or ● Record), read the line, press <b>Space</b> again to stop. Keep the level meter out of the red.',
     'Press <b>P</b> to play the take. Press <b>Enter</b> (✓ Keep &amp; next) to keep it, or Space to record again. Skip leaves a line for later.',
     'Press Finish when done. A take you recorded but had not kept is kept automatically.'),
  NOTE('Record in a quiet room with soft furnishings, the same distance from the microphone every time. Crucible records without noise suppression or automatic gain so your voice stays natural; levelling happens at export.'),
  H2('Export the audiobook'),
  OL('Save the book. In the Finish area, check coverage: how much of each chapter is voiced.',
     'Press <b>Export audiobook…</b>. Choose MP3 (192 kbps, for Audible/ACX) or WAV, the pauses between lines, paragraphs and scenes, and whether to level to ACX standards and add room tone.',
     'Choose per-chapter files and, if wanted, the full book. Export.',
     'Files are written to a &lt;Book&gt; audiobook folder beside the manuscript (browser storage mode downloads them). Read the level report.'),
  TABLE(['ACX levelling', 'Target'], [
    ['Average loudness (RMS)', 'About −20 dB (ACX allows −23 to −18 dB).'],
    ['Peaks', 'Limited below −3 dB.'],
    ['Room tone', 'Quiet tone in pauses; 0.75 s at the head, 2.5 s at the tail of each chapter.'],
    ['Format', 'MP3 192 kbps, 44.1 kHz, one file per chapter.']]),
  P('Listen to every exported chapter before you publish. MP3 encoding uses lamejs (LGPL-3.0).', 'small'))

page('final', 'Final check before you close',
  TABLE(['Check', 'Expected result'], [
    ['Version', f'The splash screen and File &gt; About Crucible show {VER}.'],
    ['Save', 'The status shows a completed save, with no newer unsaved changes.'],
    ['Audio', 'Clip list shows no waiting or failed lines you meant to finish.'],
    ['Backup', 'A separate ZIP or full project copy exists and can be opened.']]),
  P(f'Official downloads: github.com/Mack-the-knife-hand/crucible/releases/tag/v{VER}'))

# ----------------------------------------------------------- start page / toc
toc_rows = ''.join(f'<tr><td>{t}</td><td><a class="pref" href="#{pid}"></a></td></tr>' for pid, t, _ in pages if pid != 'final')
start = f'''<section class="pg" id="start"><h1>Start here</h1>
<p>Crucible keeps manuscript text in Markdown and book data beside it. Download crucible.html for the browser edition or the complete Windows ZIP to run Crucible.exe.</p>
<table class="toc"><colgroup><col style="width:78%"><col></colgroup><thead><tr><th>Task</th><th>Page</th></tr></thead><tbody>{toc_rows}</tbody></table>
<h3>What changed in {VER}</h3>
<p class="small">New: the Audiobook studio (Audio tab) with AI voices from Gemini TTS or ElevenLabs, your own microphone recordings, a pronunciation list and ACX-ready MP3 export (pages <a class="pref" href="#ab-setup"></a>&#8211;<a class="pref" href="#ab-export"></a>); an opening splash screen; voice services in Settings. Earlier 1.9.8 features remain.</p>
<p class="small">Validation: unit tests, 53 audiobook browser checks and 68 desktop checks passed. Live paid AI and voice calls were not part of the automated tests.</p>
</section>'''

CSS = '''
@page { size: letter; margin: 0.75in 0.75in 0.85in;
  @bottom-left { content: "CRUCIBLE ''' + VER + '''  |  WORK INSTRUCTIONS"; font: 7.5pt Arial, sans-serif; color: #333; border-top: 0.8pt solid #2a7f86; padding-top: 4pt; vertical-align: top; }
  @bottom-right { content: counter(page); font: 7.5pt Arial, sans-serif; color: #333; border-top: 0.8pt solid #2a7f86; padding-top: 4pt; vertical-align: top; } }
body { font-family: "DejaVu Sans", sans-serif; font-size: 8.6pt; line-height: 1.5; color: #1d2a33; }
section { page-break-after: always; }
section:last-child { page-break-after: auto; }
h1 { font-size: 19pt; color: #1f2f3b; margin: 0 0 6pt; }
h2 { font-size: 10.5pt; color: #20797f; margin: 12pt 0 4pt; }
h3 { font: bold 10pt Arial, sans-serif; margin: 14pt 0 4pt; }
.kicker { color: #2a7f86; font-size: 8pt; margin: -2pt 0 8pt; }
p { margin: 0 0 6pt; }
.small { font: 7.6pt/1.4 Arial, sans-serif; }
ol, ul { margin: 0 0 6pt; padding-left: 16pt; }
li { margin-bottom: 3.5pt; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0 8pt; font-size: 8pt; }
th { background: #e8f3f2; text-align: left; font-weight: normal; padding: 4pt 6pt; border-bottom: 0.8pt solid #2a7f86; }
td { padding: 4pt 6pt; vertical-align: top; }
tbody tr:nth-child(even) td { background: #f6f8f9; }
.note { background: #f3f6f7; border-left: 2.5pt solid #2a7f86; padding: 6pt 8pt; margin: 6pt 0 8pt; font: 7.8pt/1.45 Arial, sans-serif; }
a.pref { color: inherit; text-decoration: none; }
a.pref::after { content: target-counter(attr(href), page); }
.cover .logo { width: 1.35in; margin: 0.2in 0 0.55in; }
.ct1, .ct2 { font: bold 17pt "DejaVu Sans", sans-serif; color: #1f2f3b; }
.ct2 { margin-top: 8pt; font-size: 18pt; }
.tag { margin: 8pt 0 0.55in; }
.meta { font: 7.6pt Arial, sans-serif; margin-bottom: 8pt; }
.spaced { margin-top: 0.4in; }
.toc td, .toc th { padding: 3.5pt 6pt; }
'''

doc = f'<html><head><meta charset="utf-8"><style>{CSS}</style></head><body>{cover}{start}' + ''.join(h for _, _, h in pages) + '</body></html>'
HTML(string=doc, base_url=__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..', '..', 'build') + '/').write_pdf(sys.argv[1])
print('ok')
