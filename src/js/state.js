// =============================================================================
// state.js — the single place where the app's live data lives
// -----------------------------------------------------------------------------
// S.path      full path of the open .md file (null for an unsaved book)
// S.project   everything stored in <book>.crucible/project.json:
//               pool[]    passages you flagged for change
//               links[]   songs/pictures tied to passages (paths only)
//               memory[]  photos + fact files the AI reads
//               chat[]    the AI desk conversation
//               meta{}    title, author, export options, etc.
// S.settings  global app settings (AI providers, playlist, theme)
// The manuscript text itself is the editor's value: editor.value.
// =============================================================================

const S = {
  path: null,
  sidecar: null,
  project: null,
  settings: null,
  dirty: false,
  lastSaved: null,
  saving: false,
  saveError: null,
  revision: 0,
};

function blankProject() {
  return { version: 1, pool: [], links: [], memory: [], chat: [], notes: [], prose: null, meta: { negotiate: [] } };
}

// Tiny event bus so modules can react to each other without tangling.
const Bus = {
  handlers: {},
  on(evt, fn) { (this.handlers[evt] ||= []).push(fn); },
  emit(evt, data) { (this.handlers[evt] || []).forEach((fn) => fn(data)); },
};

function markDirty(on = true) {
  if (on) S.revision++; // Count every change, including changes while already dirty.
  if (S.dirty === on) return;
  S.dirty = on;
  window.crucible.setDirty(on);
  updateTitle();
}

function updateTitle() {
  const name = S.path ? baseName(S.path) : 'Untitled';
  window.crucible.setTitle(`${S.dirty ? '• ' : ''}${name} — Crucible`);
  $('#stFile').textContent = S.path || 'Unsaved manuscript';
  const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const status = $('#stDirty');
  status.textContent = S.saving ? 'Saving…' : S.saveError ? 'Save failed — retry'
    : S.dirty ? 'Unsaved changes' : S.lastSaved ? `${S.lastAutosave === S.lastSaved ? 'Autosaved' : 'Saved'} ${t(S.lastSaved)}`
    : S.path ? 'No unsaved changes' : 'Not saved yet';
  status.dataset.state = S.saving ? 'saving' : S.saveError ? 'error' : S.dirty ? 'dirty' : 'saved';
  status.title = S.saveError || (S.saving ? 'Writing a snapshot. New edits will remain marked unsaved.' : '');
  $('#btnRetrySave').classList.toggle('hidden', !S.saveError || S.saving);
  $('#stFile').title = S.path || 'Choose Save to give this book a filename.';
}

async function persistSettings(partial) {
  S.settings = await window.crucible.saveSettings(partial);
  Bus.emit('settings', S.settings);
}
