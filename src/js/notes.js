// =============================================================================
// notes.js — margin notes
// -----------------------------------------------------------------------------
// A note is attached to a passage (selection, or the paragraph at the cursor)
// and follows it as you edit, like change-pool items. Notes live in the book's
// project.json, never in the manuscript, the PDF, Word or EPUB exports.
// =============================================================================

const Notes = {
  init() {
    trackAnchors(() => S.project.notes || [], debounce(() => this.render(), 300));
    $('#notesFilter').addEventListener('change', () => this.render());
    $('#btnAddNote').addEventListener('click', () => Notes.add());
    Bus.on('caret', debounce((pos) => this.onCaret(pos), 200));
    $('#stNotes').addEventListener('click', () => {
      App.showTab('left', 'notes');
      this.render(this._here?.map((n) => n.id));
    });
  },

  list() { return S.project.notes || (S.project.notes = []); },

  async add() {
    const s = Editor.selection();
    let { start, end } = s;
    if (end <= start) {
      const p = TextOps.paragraphAt(Editor.text, start);
      start = p.start; end = p.end;
    }
    const text = Editor.text.slice(start, end);
    if (!text.trim()) return toast('Put the cursor in a paragraph or highlight some text first.');
    const note = await promptModal('Margin note', `On: “${snippet(text, 160)}”`, '', true);
    if (!note || !note.trim()) return;
    const ch = Editor.chapterAt(start);
    this.list().push({ id: uid(), start, end, text, note: note.trim(), created: Date.now(), resolved: false, chapter: ch ? ch.title : '' });
    markDirty(true);
    this.render();
    this.onCaret(Editor.ta.selectionStart);
    toast('Note added. It stays out of the manuscript and exports.');
  },

  at(pos) {
    return this.list().filter((n) => !n.resolved && !n.missing && pos >= n.start && pos <= n.end);
  },

  onCaret(pos) {
    const here = this.at(pos);
    this._here = here;
    const chip = $('#stNotes');
    chip.classList.toggle('hidden', !here.length);
    chip.textContent = `💬 ${here.length} note${here.length > 1 ? 's' : ''} here`;
    chip.title = here.map((n) => n.note).join('\n—\n');
  },

  goTo(n) {
    const pos = TextOps.locate(Editor.text, n);
    if (pos === null) return toast('That passage has been rewritten; the note is kept but can\'t be placed.', true);
    n.start = pos; n.end = pos + n.text.length;
    Editor.reveal(n.start, n.end);
  },

  render(highlight = []) {
    if (!S.project) return;
    const list = $('#notesList');
    const open = this.list().filter((n) => !n.resolved);
    $('#notesBadge').textContent = open.length;
    const f = $('#notesFilter').value;
    const shown = this.list().filter((n) => (f === 'all' ? true : f === 'resolved' ? n.resolved : !n.resolved))
      .sort((a, b) => a.start - b.start);
    list.innerHTML = '';
    if (!shown.length) {
      list.append(el('div', { class: 'empty' }, f === 'open'
        ? 'Right-click in the manuscript → "Add margin note…" (or Alt+N) to leave yourself a note on a passage. Notes never appear in the book or its exports.'
        : 'Nothing here.'));
      return;
    }
    for (const n of shown) {
      const ta = el('textarea', { rows: 2 });
      ta.value = n.note;
      ta.addEventListener('change', () => { n.note = ta.value; markDirty(true); });
      list.append(el('div', { class: `card note-card ${n.resolved ? 'applied' : n.missing ? 'missing' : 'pending'} ${highlight.includes(n.id) ? 'flash' : ''}` },
        el('div', { class: 'row' },
          el('span', { class: 'tag' }, n.missing ? '⚠ passage rewritten' : n.resolved ? 'resolved' : 'note'),
          el('span', { class: 'spacer' }),
          el('span', { class: 'tag', title: n.chapter }, snippet(n.chapter || '', 22))),
        el('div', { class: 'snippet', title: 'Show in manuscript', onclick: () => this.goTo(n) }, n.text),
        ta,
        el('div', { class: 'actions' },
          el('button', { class: 'small', onclick: () => { n.resolved = !n.resolved; markDirty(true); this.render(); this.onCaret(Editor.ta.selectionStart); } }, n.resolved ? 'Reopen' : 'Resolve'),
          el('button', { class: 'small', onclick: () => this.goTo(n) }, 'Show'),
          el('span', { class: 'spacer' }),
          el('button', { class: 'small ghost danger', onclick: () => { S.project.notes = this.list().filter((x) => x !== n); markDirty(true); this.render(); this.onCaret(Editor.ta.selectionStart); } }, '✕'))));
    }
  },
};
