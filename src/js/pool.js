// =============================================================================
// pool.js — the change pool
// -----------------------------------------------------------------------------
// Each pool item remembers:
//   text     the exact passage you highlighted (kept current as you edit it)
//   start/end its character position in the manuscript (auto-adjusted on every edit)
//   note     what you want changed (optional)
//   status   pending → negotiating → applied   (or dismissed / missing)
//   history  every version this passage has had, so you can see what changed
// =============================================================================

// Shared by the pool and links: keep stored ranges glued to their words.
function trackAnchors(getList, onChanged) {
  Bus.on('textChange', ({ change, text }) => {
    let touched = false;
    for (const it of getList()) {
      if (it.status === 'dismissed') continue;
      const before = it.start + ':' + it.end;
      // Did the edit touch the passage itself (not just text before/after it)?
      const inside = change.start < it.end && change.oldEnd > it.start;
      // A large edit sweeping over the passage (undo/redo of a big change, a
      // big paste): if the passage's exact words still exist, find them again
      // rather than stretching the range over whatever replaced them.
      const large = (change.oldEnd - change.start) > 200 || (change.newEnd - change.start) > 200;
      if (inside && large && it.text) {
        const pos = TextOps.locate(text, it);
        if (pos !== null) {
          it.start = pos;
          it.end = pos + it.text.length;
          it.missing = false;
          touched = true;
          continue;
        }
      }
      const r = TextOps.shiftRange(it, change);
      it.start = Math.max(0, r.start);
      it.end = Math.min(text.length, Math.max(it.start, r.end));
      if (inside) {
        // Refresh the stored words, even when the length didn't change.
        it.text = text.slice(it.start, it.end);
        touched = true;
      } else if (before !== it.start + ':' + it.end) touched = true;
    }
    if (touched) onChanged();
  });
  Bus.on('relocate', ({ text, transform }) => {
    for (const it of getList()) {
      let pos = TextOps.locate(text, it);
      if (pos === null) {
        const t2 = transform(it.text);
        pos = TextOps.locate(text, { ...it, text: t2 });
        if (pos !== null) it.text = t2;
      }
      if (pos === null) { if (it.status !== 'dismissed' && it.status !== 'applied') it.missing = true; }
      else { it.start = pos; it.end = pos + it.text.length; it.missing = false; }
    }
    onChanged();
  });
}

const Pool = {
  init() {
    trackAnchors(() => S.project.pool, debounce(() => this.render(), 400));
    $('#poolFilter').addEventListener('change', () => this.render());
    $('#btnNegotiateSel').addEventListener('click', () => {
      const ids = $$('#poolList input[type=checkbox]:checked').map((c) => c.dataset.id);
      if (!ids.length) return toast('Tick one or more items first');
      this.negotiate(ids);
    });
  },

  items() { return S.project.pool; },
  get(id) { return S.project.pool.find((p) => p.id === id); },

  async addFromSelection(withNote = false, negotiateNow = false) {
    const s = Editor.selection();
    if (!s.text.trim()) return toast('Highlight some text first');
    let note = '';
    if (withNote) {
      note = await promptModal('What should change?', snippet(s.text, 220), '', true);
      if (note === null) return;
    }
    const chapter = Editor.chapterAt(s.start);
    const item = {
      id: uid(),
      text: s.text,
      start: s.start,
      end: s.end,
      note,
      status: 'pending',
      chapter: chapter ? chapter.title : '',
      created: Date.now(),
      history: [],
    };
    S.project.pool.unshift(item);
    markDirty(true);
    this.render();
    if (negotiateNow) this.negotiate([item.id]);
    else toast('Added to change pool');
  },

  // Return the item's current position, re-finding it if needed.
  resolve(item) {
    const pos = TextOps.locate(Editor.text, item);
    if (pos === null) { item.missing = true; return null; }
    item.missing = false;
    item.start = pos;
    item.end = pos + item.text.length;
    return pos;
  },

  goTo(item) {
    if (this.resolve(item) === null) return toast("Can't find that passage any more — it may have been rewritten.", true);
    Editor.reveal(item.start, item.end);
  },

  negotiate(ids) {
    const big = ids.map((id) => this.get(id)).find((it) => it && it.text.length > 8000);
    if (big) toast('That\'s a long passage to rewrite in one go. To correct prose across a big stretch, right-click → "Correct prose in selection" works better.', false, 8000);
    S.project.meta.negotiate = ids;
    for (const id of ids) {
      const it = this.get(id);
      if (it && it.status === 'pending') it.status = 'negotiating';
    }
    markDirty(true);
    this.render();
    AI.showTab();
    AI.renderContext();
    const first = this.get(ids[0]);
    const input = $('#chatInput');
    if (first && first.note && !input.value) input.value = first.note;
    input.focus();
  },

  // Record an AI insert/change so it shows in the pool with history.
  logAiEdit({ start, end, text, oldText, note }) {
    const chapter = Editor.chapterAt(start);
    const item = {
      id: uid(), text, start, end, note, status: 'applied', ai: true,
      chapter: chapter ? chapter.title : '', created: Date.now(),
      history: [{ text: oldText || '(nothing — new text)', at: Date.now() }],
    };
    S.project.pool.unshift(item);
    markDirty(true);
    this.render();
    return item.id;
  },

  // Called when you press "Apply" on an AI revision.
  apply(id, newText) {
    const item = this.get(id);
    if (!item) return toast('That pool item no longer exists', true);
    if (this.resolve(item) === null) return toast("Can't find the original passage — was it edited by hand? Use Copy instead.", true);
    const old = item.text;
    const start = item.start;
    Editor.replaceRange(item.start, item.end, newText);
    // replaceRange triggered anchor shifting; pin this item to its new text exactly.
    item.history = item.history || [];
    item.history.push({ text: old, at: Date.now() });
    item.text = newText;
    item.start = start;
    item.end = start + newText.length;
    item.status = 'applied';
    item.missing = false;
    markDirty(true);
    this.render();
    AI.renderContext();
    Editor.reveal(item.start, item.end);
    toast('Change applied — Ctrl+Z in the manuscript undoes it');
  },

  setStatus(item, st) {
    item.status = st;
    if (st !== 'negotiating') {
      S.project.meta.negotiate = (S.project.meta.negotiate || []).filter((x) => x !== item.id);
      AI.renderContext();
    }
    markDirty(true);
    this.render();
  },

  async editNote(item) {
    const n = await promptModal('Change note', snippet(item.text, 220), item.note || '', true);
    if (n === null) return;
    item.note = n;
    markDirty(true);
    this.render();
  },

  remove(item) {
    S.project.pool = S.project.pool.filter((p) => p !== item);
    S.project.meta.negotiate = (S.project.meta.negotiate || []).filter((x) => x !== item.id);
    markDirty(true);
    this.render();
    AI.renderContext();
  },

  showHistory(item) {
    const body = el('div', {},
      ...(item.history || []).map((h, i) => el('div', { class: 'card' },
        el('div', { class: 'tag' }, `Version ${i + 1} · ${new Date(h.at).toLocaleString()}`),
        el('div', { style: 'font-family:var(--serif);white-space:pre-wrap;margin-top:4px' }, h.text))),
      el('div', { class: 'card applied' }, el('div', { class: 'tag st-applied' }, 'Current'),
        el('div', { style: 'font-family:var(--serif);white-space:pre-wrap;margin-top:4px' }, item.text)));
    openModal({ title: 'Passage history', body, wide: true });
  },

  render() {
    const filter = $('#poolFilter').value;
    const list = $('#poolList');
    const open = S.project.pool.filter((p) => p.status === 'pending' || p.status === 'negotiating');
    $('#poolBadge').textContent = open.length;
    const shown = S.project.pool.filter((p) =>
      filter === 'all' ? true : filter === 'open' ? (p.status === 'pending' || p.status === 'negotiating') : p.status === filter);
    list.innerHTML = '';
    if (!shown.length) {
      list.append(el('div', { class: 'empty' },
        filter === 'open'
          ? 'Highlight text in your manuscript, right-click, and choose "Add to change pool". Everything you want to rework collects here.'
          : 'Nothing here.'));
      return;
    }
    const negotiating = new Set(S.project.meta.negotiate || []);
    for (const it of shown) {
      const st = it.missing && it.status !== 'applied' ? 'missing' : it.status;
      const card = el('div', { class: `card ${st}` },
        el('div', { class: 'row' },
          (it.status === 'pending' || it.status === 'negotiating')
            ? el('input', { type: 'checkbox', 'data-id': it.id, checked: negotiating.has(it.id), title: 'Include in the next negotiation' })
            : null,
          el('span', { class: `tag st-${st}` }, st),
          el('span', { class: 'spacer' }),
          el('span', { class: 'tag', title: it.chapter }, snippet(it.chapter, 26))),
        el('div', { class: 'snippet', title: 'Show in manuscript', onclick: () => this.goTo(it) }, it.text),
        it.note ? el('div', { class: 'note' }, it.note) : null,
        el('div', { class: 'actions' },
          (it.status === 'pending' || it.status === 'negotiating')
            ? el('button', { class: 'small accent', onclick: () => this.negotiate([it.id]) }, 'Negotiate')
            : null,
          el('button', { class: 'small', onclick: () => this.editNote(it) }, it.note ? 'Edit note' : 'Add note'),
          it.history?.length ? el('button', { class: 'small', onclick: () => this.showHistory(it) }, `History (${it.history.length})`) : null,
          it.status === 'applied' || it.status === 'dismissed'
            ? el('button', { class: 'small', onclick: () => this.setStatus(it, 'pending') }, 'Reopen')
            : el('button', { class: 'small ghost', onclick: () => this.setStatus(it, 'dismissed') }, 'Dismiss'),
          el('button', { class: 'small ghost danger', title: 'Delete from pool', onclick: () => this.remove(it) }, '✕')));
      list.append(card);
    }
  },
};
