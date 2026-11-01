// =============================================================================
// chapters.js — Chapter builder + chapter images
// -----------------------------------------------------------------------------
// The builder edits a model of the book (see ChapterOps in util.js): rename,
// add, delete, reorder chapters and tick "Image" to give a chapter an
// illustration. Nothing touches the manuscript until you press Apply, and
// Apply is a single edit, so one Ctrl+Z undoes the whole set of changes.
// Pool items, links and prose suggestions re-find their text afterwards.
// =============================================================================

// Chapter images are read from the book's folder and cached as data: URLs
// (used for thumbnails, the preview and the PDF).
const BookImages = {
  cache: new Map(),
  isLocal: (src) => !!src && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src),
  async url(rel) {
    if (!S.path || !rel) return null;
    const key = `${S.path}|${rel}`;
    if (!this.cache.has(key)) this.cache.set(key, await window.crucible.readBookImage({ bookPath: S.path, rel }).catch(() => null));
    return this.cache.get(key);
  },
  clear() { this.cache.clear(); },

  // Swap local image paths in rendered HTML for placeholders (so the page
  // never tries to load a relative path) and tag chapter images for styling.
  defer(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src');
      if (img.getAttribute('alt') === 'chapter-image') {
        img.classList.add('chapter-image');
        img.setAttribute('alt', '');
        const p = img.parentElement;
        if (p && p.tagName === 'P' && p.textContent.trim() === '') p.classList.add('img-p');
      }
      if (this.isLocal(src)) { img.removeAttribute('src'); img.dataset.rel = ChapterOps.decodeImg(src); }
    });
    return tpl.innerHTML;
  },

  // Fill placeholders inside a live element.
  async fill(root) {
    for (const img of root.querySelectorAll('img[data-rel]')) {
      const u = await this.url(img.dataset.rel);
      if (u) img.src = u;
      else { img.alt = `(missing image: ${img.dataset.rel})`; img.classList.add('missing'); }
    }
  },

  // For the PDF: embed every local image as data: so the export is self-contained.
  async embed(html) {
    // A whole page: only touch the <body>, so the doctype and <head> survive
    // (without the doctype the browser lays the page out in "quirks mode").
    const doc = html.match(/^([\s\S]*?<body[^>]*>)([\s\S]*)(<\/body>[\s\S]*)$/i);
    if (doc) return doc[1] + (await this.embed(doc[2])) + doc[3];
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    for (const img of tpl.content.querySelectorAll('img[data-rel]')) {
      const u = await this.url(img.dataset.rel);
      if (u) img.src = u; else img.remove();
      img.removeAttribute('data-rel');
    }
    return tpl.innerHTML;
  },
};

const Chapters = {
  model: null,
  sel: 0,

  open() {
    const text = Editor.text;
    const level = ChapterOps.detectLevel(text);
    this.model = ChapterOps.parse(text, level);
    this.base = text;
    // Start with the chapter the cursor is in selected.
    const pos = Editor.ta.selectionStart;
    let acc = this.model.preamble.length;
    this.sel = 0;
    this.model.chapters.forEach((c, i) => { if (acc <= pos) this.sel = i; acc += c.raw.length; });
    this.body = el('div', { class: 'cb' });
    this.modal = openModal({
      title: 'Chapter builder',
      wide: true,
      body: this.body,
      buttons: [
        { label: 'Cancel' },
        { label: 'Apply changes', accent: true, onClick: () => this.apply() },
      ],
    });
    this.render();
  },

  changed() {
    return ChapterOps.build(this.model) !== this.base;
  },

  apply() {
    const out = ChapterOps.build(this.model);
    if (out === Editor.text) { toast('No changes'); return; }
    Editor.replaceAll(out, (t) => t, 'chapter changes');
    Editor.refreshAll();
    markDirty(true);
    toast('Chapters updated. One Ctrl+Z in the manuscript undoes all of it.', false, 5000);
  },

  async setLevel(level) {
    if (this.changed() && !(await confirmModal('Change chapter level?', 'This re-reads the chapters from the manuscript and discards the changes you\'ve made here so far.', 'Re-read'))) {
      this.render();
      return;
    }
    this.model = ChapterOps.parse(this.base, level);
    this.sel = 0;
    this.render();
  },

  add(where) {
    const ch = this.model.chapters;
    const i = where === 'end' || !ch.length ? ch.length : this.sel + 1;
    const n = i + 1;
    const style = this.guessStyle();
    ch.splice(i, 0, ChapterOps.newChapter(ChapterOps.numbered('', n, style === 'keep' ? 'chapter-num' : style)));
    this.sel = i;
    this.render();
    setTimeout(() => { const inp = this.body.querySelectorAll('.cb-title')[i]; inp?.focus(); inp?.select(); }, 20);
  },

  // Guess the numbering style the book already uses (for new chapters).
  guessStyle() {
    const t = this.model.chapters.map((c) => c.title);
    if (t.some((x) => /^chapter\s+\d+/i.test(x))) return 'chapter-num';
    if (t.some((x) => /^chapter\s+[a-z]/i.test(x))) return 'chapter-word';
    if (t.some((x) => /^\d+\.\s/.test(x))) return 'num';
    return 'chapter-num';
  },

  move(i, d) {
    const ch = this.model.chapters;
    const j = i + d;
    if (j < 0 || j >= ch.length) return;
    [ch[i], ch[j]] = [ch[j], ch[i]];
    this.sel = j;
    this.render();
  },

  remove(i) {
    const c = this.model.chapters[i];
    const words = countWords(c.rest);
    const choose = (fn) => { fn(); this.sel = Math.max(0, Math.min(this.sel, this.model.chapters.length - 1)); this.render(); };
    openModal({
      title: `Remove “${snippet(c.title, 50)}”?`,
      body: el('div', {},
        el('p', { style: 'margin-top:0' }, words ? `This chapter has ${words.toLocaleString()} words.` : 'This chapter is empty.'),
        words ? el('ul', { style: 'padding-left:20px;line-height:1.6;margin:0' },
          el('li', {}, el('strong', {}, 'Delete chapter & text'), ' removes the heading and everything in it.'),
          el('li', {}, el('strong', {}, 'Keep the text'), ' removes only the heading; its text joins the chapter before it.')) : null,
        el('p', { class: 'muted', style: 'font-size:12px' }, 'Nothing changes until you press Apply, and Ctrl+Z undoes it afterwards.')),
      buttons: [
        { label: 'Cancel' },
        words ? { label: 'Keep the text', onClick: () => choose(() => ChapterOps.mergeIntoPrevious(this.model, i)) } : null,
        { label: words ? 'Delete chapter & text' : 'Delete chapter', accent: true, cls: 'danger-accent', onClick: () => choose(() => this.model.chapters.splice(i, 1)) },
      ].filter(Boolean),
    });
  },

  renumber(style) {
    if (style === 'keep') return;
    this.model.chapters.forEach((c, i) => { c.title = ChapterOps.numbered(c.title, i + 1, style); });
    this.render();
    toast('Chapter titles renumbered. Check them, then Apply.');
  },

  async toggleImage(c, on, box) {
    if (!on) { c.image = null; this.render(); return; }
    if (!S.path) {
      box.checked = false;
      return toast('Save the book first. Chapter images are kept in an "images" folder next to it.', true, 6000);
    }
    const r = await window.crucible.chooseChapterImage(S.path);
    if (!r) { box.checked = false; return; }
    c.image = r.rel;
    this.render();
  },

  async changeImage(c) {
    const r = await window.crucible.chooseChapterImage(S.path);
    if (r) { c.image = r.rel; this.render(); }
  },

  render() {
    const m = this.model;
    const b = this.body;
    b.innerHTML = '';
    const levelSel = el('select', { onchange: (e) => this.setLevel(+e.target.value) },
      el('option', { value: 1 }, '# headings'), el('option', { value: 2 }, '## headings'));
    levelSel.value = String(m.level);
    const numSel = el('select', {},
      el('option', { value: 'chapter-num' }, 'Chapter 1: Title'),
      el('option', { value: 'chapter-word' }, 'Chapter One: Title'),
      el('option', { value: 'num' }, '1. Title'),
      el('option', { value: 'none' }, 'Title only (remove numbers)'));
    numSel.value = this.guessStyle();
    b.append(el('div', { class: 'cb-top' },
      el('label', {}, 'Chapters are ', levelSel),
      el('span', { class: 'spacer' }),
      el('label', {}, 'Numbering ', numSel),
      el('button', { class: 'small', onclick: () => this.renumber(numSel.value), title: 'Rewrite every title with this numbering, in the current order' }, 'Renumber all')));

    if (m.preamble.trim()) {
      b.append(el('div', { class: 'cb-pre muted' }, `Before the first chapter (title, dedication, epigraph): ${countWords(m.preamble).toLocaleString()} words, unchanged.`));
    }
    const list = el('div', { class: 'cb-list' });
    if (!m.chapters.length) {
      list.append(el('div', { class: 'empty' }, `No ${'#'.repeat(m.level)} chapter headings yet. Add your first chapter below.`));
    }
    m.chapters.forEach((c, i) => {
      const title = el('input', { class: 'cb-title', value: c.title, placeholder: 'Chapter title' });
      title.addEventListener('input', () => { c.title = title.value; });
      title.addEventListener('focus', () => { this.sel = i; $$('.cb-row', b).forEach((r, k) => r.classList.toggle('sel', k === i)); });
      const box = el('input', { type: 'checkbox', checked: !!c.image });
      box.addEventListener('change', () => this.toggleImage(c, box.checked, box));
      const thumb = c.image ? el('img', { class: 'cb-thumb', title: c.image, onclick: () => this.changeImage(c) }) : null;
      if (thumb) BookImages.url(c.image).then((u) => { if (u) thumb.src = u; else thumb.classList.add('missing'); });
      const state = c.raw == null ? 'new' : ChapterOps.isChanged(c, m) ? 'edited' : '';
      list.append(el('div', { class: `cb-row ${i === this.sel ? 'sel' : ''}`, onclick: () => { this.sel = i; $$('.cb-row', b).forEach((r, k) => r.classList.toggle('sel', k === i)); } },
        el('span', { class: 'cb-num' }, String(i + 1)),
        title,
        el('span', { class: 'cb-wc muted' }, state ? el('em', {}, state) : `${countWords(c.rest).toLocaleString()} w`),
        el('label', { class: 'check cb-img', title: 'Show an image under this chapter\'s title (in the preview and the PDF)' }, box, 'Image'),
        thumb || el('span', { class: 'cb-thumb-empty' }),
        c.image ? el('button', { class: 'small ghost', onclick: () => this.changeImage(c), title: 'Choose a different image' }, 'Change') : el('span', { class: 'cb-chg' }),
        el('button', { class: 'small ghost', title: 'Move up', disabled: i === 0, onclick: (e) => { e.stopPropagation(); this.move(i, -1); } }, '↑'),
        el('button', { class: 'small ghost', title: 'Move down', disabled: i === m.chapters.length - 1, onclick: (e) => { e.stopPropagation(); this.move(i, 1); } }, '↓'),
        el('button', { class: 'small ghost danger', title: 'Remove chapter', onclick: (e) => { e.stopPropagation(); this.remove(i); } }, '✕')));
    });
    b.append(list);
    b.append(el('div', { class: 'cb-add' },
      el('button', { class: 'small', disabled: !m.chapters.length, onclick: () => this.add('after') }, '+ Add chapter after selected'),
      el('button', { class: 'small', onclick: () => this.add('end') }, '+ Add chapter at end'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'muted', style: 'font-size:12px' }, 'Moving a chapter moves all of its text. Nothing changes until you press Apply.')));
  },
};
