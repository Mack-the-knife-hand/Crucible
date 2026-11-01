// =============================================================================
// editor.js — the manuscript editor
// -----------------------------------------------------------------------------
// The editor is a plain <textarea>. That's deliberate: it handles a 150,000-word
// file smoothly, keeps exact character positions (which the change pool and
// links rely on), and gives native spell-check and Ctrl+Z undo for free.
//
// Every programmatic change (AI revision, replace, restore) goes through
// Editor.replaceRange(), which uses the browser's insertText command so it
// lands on the normal undo stack — Ctrl+Z undoes an AI change like any typing.
// =============================================================================

const Editor = {
  ta: null,
  lastText: '',
  outline: [],
  spell: { word: '', suggestions: [] },

  init() {
    this.ta = $('#editor');
    this.ta.addEventListener('input', () => this.onInput());
    this.ta.addEventListener('keyup', () => this.onCaret());
    this.ta.addEventListener('mouseup', () => this.onCaret());
    this.ta.addEventListener('scroll', debounce(() => this.syncPreviewScroll(), 30));
    this.ta.addEventListener('contextmenu', (e) => this.showContextMenu(e));
    this.ta.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('mousedown', (e) => {
      if (!$('#ctxMenu').contains(e.target)) $('#ctxMenu').classList.add('hidden');
    });
    window.crucible.onSpelling((d) => {
      this.spell = d;
      if (!$('#ctxMenu').classList.contains('hidden') && d.word) this.renderContextMenu(this._ctxPos);
    });
    $$('#viewSeg button').forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.view)));
    // mousedown + preventDefault keeps the editor's selection while clicking.
    $$('#alignSeg button').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); this.setAlign(b.dataset.align); }));
    this.initFind();
  },

  get text() { return this.ta.value; },

  // Load a whole new manuscript (clears undo history; that's expected on open).
  setText(t) {
    this.bulkUndo = [];
    this.bulkRedo = [];
    this.ta.value = t;
    this.lastText = t;
    this.ta.setSelectionRange(0, 0);
    this.ta.scrollTop = 0;
    this.refreshAll();
  },

  // ---------------------------------------------------------------- input --
  onInput() {
    const now = this.ta.value;
    if (now === this.lastText) return;
    if (this.bulk) {
      // Whole-document changes (replace all, restore backup) are re-anchored
      // by searching for each passage's text afterwards instead.
      this.bulk = false;
    } else {
      const ch = TextOps.changedRegion(this.lastText, now);
      // Keep every stored passage pointing at the same words after the edit.
      Bus.emit('textChange', { change: ch, text: now });
    }
    this.lastText = now;
    markDirty(true);
    this.refreshSoon();
  },

  refreshSoon: debounce(function () { Editor.refreshAll(); }, 350),

  refreshAll() {
    this.outline = TextOps.outline(this.ta.value);
    this.renderOutline();
    const words = countWords(this.ta.value);
    $('#stWords').textContent = `${words.toLocaleString()} words`;
    Goals.update(words);
    if ($('#editorWrap').dataset.view !== 'edit') this.renderPreview();
    this.onCaret();
  },

  // Align the paragraph(s) under the cursor/selection: left | center | right.
  // Put a [TOC] line (where the table of contents goes in exports) on its
  // own line just before the paragraph the cursor is in.
  insertToc() {
    const t = this.ta.value;
    const m = t.match(Export.TOC_LINE);
    if (m) {
      const at = t.search(Export.TOC_LINE);
      this.reveal(at, at + m[0].length);
      toast('Your book already has a [TOC] line (selected). Delete it first to put the table of contents somewhere else.', false, 7000);
      return;
    }
    const pos = this.ta.selectionStart;
    const ls = t.lastIndexOf('\n', pos - 1) + 1;
    const before = t.slice(0, ls);
    const pre = !before || /\n\n$/.test(before) ? '' : '\n';
    this.replaceRange(ls, ls, `${pre}[TOC]\n\n`);
    toast('Table of contents marker added. Exports put the contents here; choose chapters or scenes in Export.', false, 6000);
  },

  setAlign(align) {
    const { selectionStart: a, selectionEnd: b } = this.ta;
    const p = Align.plan(this.ta.value, a, b, align);
    if (p.error) return toast(p.error);
    this.replaceRange(p.from, p.to, p.insert);
    this.ta.setSelectionRange(p.selStart, p.selEnd);
    this.onCaret();
    if ($('#editorWrap').dataset.view === 'edit') toast(`${align === 'left' ? 'Back to normal alignment' : align === 'center' ? 'Centered' : 'Right-aligned'}. Use Split or Read view to see it.`);
  },

  updateAlignButtons(a, b) {
    const blk = Align.at(this.ta.value, a, b);
    const cur = blk ? blk.align : 'left';
    $$('#alignSeg button').forEach((x) => x.classList.toggle('on', x.dataset.align === cur));
  },

  onCaret() {
    const { selectionStart: a, selectionEnd: b } = this.ta;
    this.updateAlignButtons(a, b);
    $('#stSel').textContent = b > a ? `${countWords(this.ta.value.slice(a, b))} selected` : '';
    const cur = this.chapterAt(a);
    $('#stChapter').textContent = cur ? cur.title : '';
    $$('#outline .ol-item').forEach((n) => n.classList.toggle('cur', cur && +n.dataset.offset === cur.offset));
    Bus.emit('caret', a);
  },

  onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      const redo = k === 'y' || (k === 'z' && e.shiftKey);
      if ((k === 'z' || k === 'y') && this.bulkUndoRedo(redo)) { e.preventDefault(); return; }
    }
    // Ctrl+Shift+A: add selection to the change pool
    if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); Notes.add(); return; }
    if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') || (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'a')) {
      e.preventDefault();
      Pool.addFromSelection();
    }
  },

  // ------------------------------------------------------------- geometry --
  chapterAt(pos) {
    let cur = null;
    for (const h of this.outline) { if (h.offset <= pos) cur = h; else break; }
    return cur;
  },

  // Textareas can't tell you the pixel height of a character offset, so we
  // measure it with an invisible copy of the editor ("mirror") holding the
  // text up to that point.
  offsetTop(pos) {
    const cs = getComputedStyle(this.ta);
    let m = this._mirror;
    if (!m) {
      m = this._mirror = document.createElement('div');
      Object.assign(m.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', wordWrap: 'break-word', overflowWrap: 'break-word' });
      document.body.append(m);
    }
    for (const p of ['fontFamily', 'fontSize', 'lineHeight', 'paddingLeft', 'paddingRight', 'paddingTop', 'letterSpacing', 'tabSize', 'boxSizing']) m.style[p] = cs[p];
    m.style.width = this.ta.clientWidth + 'px';
    m.textContent = this.ta.value.slice(0, pos) + '​';
    return m.scrollHeight;
  },

  // Select a range and scroll it to about a third of the way down the screen.
  reveal(start, end = start, focus = true) {
    if ($('#editorWrap').dataset.view === 'preview') this.setView('split');
    if (focus) this.ta.focus();
    this.ta.setSelectionRange(start, end);
    const y = this.offsetTop(start);
    this.ta.scrollTop = Math.max(0, y - this.ta.clientHeight / 3);
    this.onCaret();
  },

  // Undo-friendly replacement of [start,end) with new text.
  replaceRange(start, end, text) {
    this.ta.focus();
    this.ta.setSelectionRange(start, end);
    const ok = document.execCommand('insertText', false, text);
    if (!ok) {
      // Fallback (no undo) if the command is unavailable.
      this.ta.setRangeText(text, start, end, 'end');
      this.onInput();
    }
  },

  // Replace the whole manuscript but keep it undoable.
  // transform(passageText) tells linked passages how their own text changed.
  // ------------------------------------------------- big (bulk) changes --
  // Used by the Chapter builder, Replace All and Restore backup.
  //
  // The browser's undoable insert is slow on big text (~30 ms per 1,000
  // characters: a whole novel takes most of a minute and freezes the app). So:
  //  * if only a little text is being inserted, use the normal undoable path;
  //  * otherwise swap the text in directly (milliseconds) and keep our own
  //    before/after copy, so Ctrl+Z still undoes the whole change in one step.
  // The direct swap clears the browser's own undo history for earlier typing;
  // the backups folder covers anything older.
  NATIVE_INSERT_MAX: 4000,
  BULK_UNDO_KEEP: 10,
  bulkUndo: [],
  bulkRedo: [],

  replaceAll(text, transform = (t) => t, label = 'that change') {
    const old = this.ta.value;
    if (text === old) return;
    const ch = TextOps.changedRegion(old, text);
    const inserted = text.slice(ch.start, ch.newEnd);
    if (inserted.length <= this.NATIVE_INSERT_MAX) {
      this.bulk = true;
      this.replaceRange(ch.start, ch.oldEnd, inserted);
      this.bulk = false;
    } else {
      this.swapText(text, ch);
      this.bulkUndo.push({ before: old, after: text, label });
      if (this.bulkUndo.length > this.BULK_UNDO_KEEP) this.bulkUndo.shift();
      this.bulkRedo = [];
    }
    this.ta.setSelectionRange(ch.start, ch.start);
    Bus.emit('relocate', { text: this.ta.value, transform });
  },

  // Replace the text directly (fast, not on the browser's undo stack).
  swapText(text, ch = TextOps.changedRegion(this.ta.value, text)) {
    const top = this.ta.scrollTop;
    this.ta.setRangeText(text.slice(ch.start, ch.newEnd), ch.start, ch.oldEnd, 'start');
    this.ta.scrollTop = top;
    this.bulk = true;
    this.onInput(); // setRangeText doesn't fire an input event
    this.bulk = false;
  },

  // Ctrl+Z / Ctrl+Y for big changes. Returns true if it handled the key.
  bulkUndoRedo(redo) {
    const stack = redo ? this.bulkRedo : this.bulkUndo;
    const step = stack[stack.length - 1];
    if (!step || this.ta.value !== (redo ? step.before : step.after)) return false;
    stack.pop();
    (redo ? this.bulkUndo : this.bulkRedo).push(step);
    const text = redo ? step.after : step.before;
    const ch = TextOps.changedRegion(this.ta.value, text);
    this.swapText(text, ch);
    this.ta.focus();
    this.ta.setSelectionRange(ch.start, ch.start);
    Bus.emit('relocate', { text, transform: (t) => t });
    this.refreshAll();
    toast(`${redo ? 'Redid' : 'Undid'} ${step.label}`);
    return true;
  },

  selection() {
    const { selectionStart: start, selectionEnd: end } = this.ta;
    return { start, end, text: this.ta.value.slice(start, end) };
  },

  // ---------------------------------------------------------------- views --
  setView(v) {
    $('#editorWrap').dataset.view = v;
    $$('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    if (v !== 'edit') this.renderPreview();
    if (S.settings && S.settings.ui.view !== v) persistSettings({ ui: { ...S.settings.ui, view: v } });
  },

  renderPreview() {
    const md = this.ta.value;
    const html = marked.parse(Align.toHtmlMd(md.replace(/<!--[\s\S]*?-->/g, '')));
    let out = sanitizeHtml(html)
      .replace(/(<blockquote>[\s\S]*?<\/blockquote>)/g, (bq) => bq.replace(/<p>(\s*(?:—|–|--|―)\s*)/g, '<p class="attr">$1'));
    // A [TOC] line shows the contents list (page numbers come with the PDF).
    if (Export.TOC_LINE.test(md)) {
      const eo = S.project?.meta?.export || {};
      out = Export.applyToc(out, md, { toc: eo.toc && eo.toc !== 'none' ? eo.toc : 'chapters', breakLevel: eo.breakLevel || '0', title: eo.title });
    }
    $('#preview').innerHTML = BookImages.defer(out);
    BookImages.fill($('#preview'));
  },

  syncPreviewScroll() {
    if ($('#editorWrap').dataset.view !== 'split') return;
    const ta = this.ta, pv = $('#previewPane');
    const ratio = ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight);
    pv.scrollTop = ratio * (pv.scrollHeight - pv.clientHeight);
  },

  renderOutline() {
    const box = $('#outline');
    box.innerHTML = '';
    if (!this.outline.length) {
      box.append(el('div', { class: 'empty' }, 'Chapters appear here from your Markdown headings (# Chapter One, ## Scene…).'));
      return;
    }
    for (const h of this.outline) {
      box.append(el('div', {
        class: `ol-item ol-${h.level}`,
        'data-offset': h.offset,
        title: `${h.title} (right-click to select or correct it)`,
        onclick: () => this.reveal(h.offset),
        oncontextmenu: (e) => {
          e.preventDefault();
          this.showMenu(e.clientX, e.clientY, [
            ['▤  Select this chapter / scene', () => this.selectSection(h.offset)],
            ['✓  Correct prose in it…', () => { this.selectSection(h.offset); Prose.openFor('selection'); }],
            ['→  Go to it', () => this.reveal(h.offset)],
            ['☰  Chapter builder…', () => Chapters.open()],
          ]);
        },
      }, el('span', { class: 'wc' }, h.words.toLocaleString()), h.title));
    }
  },

  // A heading's section: from the heading to the next heading of the same or
  // higher level (so a "## Chapter" includes its "### scenes").
  sectionRange(pos) {
    const h = this.chapterAt(pos);
    if (!h) return null;
    const next = this.outline.find((o) => o.offset > h.offset && o.level <= h.level);
    let end = next ? next.offset : this.ta.value.length;
    while (end > h.offset && /\s/.test(this.ta.value[end - 1])) end--;
    return { start: h.offset, end, title: h.title };
  },

  selectSection(pos) {
    const r = this.sectionRange(pos);
    if (!r) return toast('Add a Markdown heading (## Chapter …) to select by chapter.', true);
    this.reveal(r.start, r.end);
    toast(`Selected "${r.title}": ${countWords(this.ta.value.slice(r.start, r.end)).toLocaleString()} words`);
  },

  // Small menu at the mouse (used by the outline).
  showMenu(x, y, entries) {
    const menu = $('#ctxMenu');
    menu.innerHTML = '';
    for (const [label, fn] of entries) {
      menu.append(el('div', { class: 'mi', onmousedown: (ev) => { ev.preventDefault(); menu.classList.add('hidden'); fn(); } }, label));
    }
    menu.classList.remove('hidden');
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  },

  // --------------------------------------------------------- context menu --
  showContextMenu(e) {
    if (e.shiftKey) return; // Shift+right-click: let the browser show its own menu (spelling suggestions)
    e.preventDefault();
    this.spell = { word: '', suggestions: [] }; // fresh; main process will fill it in
    this._ctxPos = { x: e.clientX, y: e.clientY };
    this.renderContextMenu(this._ctxPos);
  },

  renderContextMenu({ x, y }) {
    const menu = $('#ctxMenu');
    const sel = this.selection();
    const has = sel.end > sel.start;
    const item = (label, fn, opts = {}) => el('div', {
      class: `mi ${opts.hot ? 'hot' : ''} ${opts.disabled ? 'disabled' : ''}`,
      onmousedown: (ev) => { ev.preventDefault(); menu.classList.add('hidden'); fn(); },
    }, label, opts.key ? el('span', { class: 'k' }, opts.key) : null);
    const sep = () => el('div', { class: 'sep' });

    menu.innerHTML = '';
    if (this.spell.word) {
      const sugg = this.spell.suggestions.slice(0, 5);
      if (sugg.length) sugg.forEach((w) => menu.append(item(w, () => window.crucible.replaceMisspelling(w), { hot: true })));
      else menu.append(item('No spelling suggestions', () => {}, { disabled: true }));
      menu.append(sep());
    }
    menu.append(
      item('✚  Add to change pool', () => Pool.addFromSelection(), { hot: true, disabled: !has, key: window.crucible.platform === 'web' ? 'Alt+A' : 'Ctrl+Shift+A' }),
      item('✎  Add to pool with a note…', () => Pool.addFromSelection(true), { disabled: !has }),
      item(`💬  Add margin note${has ? '' : ' to this paragraph'}…`, () => Notes.add(), { key: 'Alt+N' }),
      item(has ? '🔊  Read selection aloud' : '🔊  Read aloud from here', () => Speech.fromCursor()),
      item('👥  Ask a beta reader…', () => Beta.open()),
      item('⚒  Negotiate this with AI now', () => Pool.addFromSelection(false, true), { disabled: !has }),
      sep(),
      item(has ? `✓  Correct prose in selection (${countWords(sel.text).toLocaleString()} words)…` : '✓  Correct prose in this chapter…',
        () => Prose.openFor(has ? 'selection' : 'chapter'), { hot: true }),
      item('▤  Select this chapter / scene', () => this.selectSection(sel.start)),
      sep(),
      item('📑  Insert table of contents here', () => this.insertToc()),
      sep(),
      item('⯇  Align left (normal)', () => this.setAlign('left')),
      item('≡  Align center', () => this.setAlign('center')),
      item('⯈  Align right', () => this.setAlign('right')),
      sep(),
      item(`♪  Link a song${has ? '' : ' to this paragraph'}…`, () => Links.startLink('song')),
      item(`▣  Link a picture${has ? '' : ' to this paragraph'}…`, () => Links.startLink('image')),
      window.crucible.platform === 'web' ? el('div', { class: 'mi disabled', style: 'font-size:11px' }, 'Shift+right-click for spelling suggestions') : null,
      sep(),
      item('Cut', () => document.execCommand('cut'), { disabled: !has, key: 'Ctrl+X' }),
      item('Copy', () => document.execCommand('copy'), { disabled: !has, key: 'Ctrl+C' }),
      item('Paste', async () => {
        const t = await navigator.clipboard.readText().catch(() => '');
        if (t) { const s = this.selection(); this.replaceRange(s.start, s.end, t); }
      }, { key: 'Ctrl+V' }),
    );
    menu.classList.remove('hidden');
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  },

  // --------------------------------------------------------- find/replace --
  initFind() {
    const bar = $('#findBar'), fi = $('#findInput'), ri = $('#replaceInput');
    const re = () => {
      const q = fi.value;
      if (!q) return null;
      return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $('#findCase').checked ? 'g' : 'gi');
    };
    const count = () => {
      const r = re();
      $('#findCount').textContent = r ? `${(this.ta.value.match(r) || []).length} found` : '';
    };
    const go = (dir) => {
      const r = re(); if (!r) return;
      const t = this.ta.value;
      const matches = [...t.matchAll(r)].map((m) => m.index);
      if (!matches.length) return toast('Not found');
      const pos = dir > 0 ? this.ta.selectionEnd : this.ta.selectionStart;
      let idx = dir > 0 ? matches.find((i) => i >= pos) : [...matches].reverse().find((i) => i < pos);
      if (idx === undefined) idx = dir > 0 ? matches[0] : matches[matches.length - 1];
      this.reveal(idx, idx + fi.value.length, false);
      fi.focus();
    };
    this.openFind = () => {
      bar.classList.remove('hidden');
      const s = this.selection();
      if (s.text && s.text.length < 80 && !s.text.includes('\n')) fi.value = s.text;
      fi.focus(); fi.select(); count();
    };
    fi.addEventListener('input', count);
    $('#findCase').addEventListener('change', count);
    fi.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e.shiftKey ? -1 : 1); if (e.key === 'Escape') bar.classList.add('hidden'); });
    $('#findNext').onclick = () => go(1);
    $('#findPrev').onclick = () => go(-1);
    $('#findClose').onclick = () => bar.classList.add('hidden');
    $('#replaceOne').onclick = () => {
      const s = this.selection(), r = re();
      if (r && s.text && s.text.match(new RegExp(`^${r.source}$`, r.flags.replace('g', '')))) {
        this.replaceRange(s.start, s.end, ri.value);
      }
      go(1); count();
    };
    $('#replaceAll').onclick = async () => {
      const r = re(); if (!r) return;
      const n = (this.ta.value.match(r) || []).length;
      if (!n) return toast('Nothing to replace');
      if (!(await confirmModal('Replace all', `Replace ${n} occurrence(s)? You can undo with Ctrl+Z.`, 'Replace all'))) return;
      this.replaceAll(this.ta.value.replace(r, () => ri.value), (t) => t.replace(r, () => ri.value), 'Replace all');
      count();
      toast(`Replaced ${n}`);
    };
  },
};
