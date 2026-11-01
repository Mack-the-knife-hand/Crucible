// =============================================================================
// links.js — songs and pictures linked to passages
// -----------------------------------------------------------------------------
// A link is just { kind, path, passage range } saved in project.json. The song
// or picture is NOT copied into the book and never appears in the manuscript
// or the PDF. If you move the file on disk, the link shows as missing and you
// can re-point it.
//
// "Auto-play" mode: as your cursor moves into a passage that has a song linked,
// Crucible starts that song — a soundtrack that follows you through the book.
// =============================================================================

const Links = {
  init() {
    trackAnchors(() => S.project.links, debounce(() => this.render(), 400));
    Bus.on('caret', debounce((pos) => this.onCaret(pos), 250));
    $('#ambientToggle').addEventListener('change', (e) => {
      S.project.meta.ambient = e.target.checked;
      markDirty(true);
      if (e.target.checked) this.onCaret(Editor.ta.selectionStart);
    });
    $('#stLinked').addEventListener('click', () => {
      const l = this._here;
      if (l) this.open(l);
    });
  },

  // Range to link: the selection, or the paragraph the cursor is in.
  targetRange() {
    const s = Editor.selection();
    if (s.end > s.start) return s;
    const p = TextOps.paragraphAt(Editor.text, s.start);
    return { start: p.start, end: p.end, text: Editor.text.slice(p.start, p.end) };
  },

  async startLink(kind) {
    const range = this.targetRange();
    if (!range.text.trim()) return toast('Put the cursor in a paragraph or highlight text first');
    const choose = (path, label) => {
      const chapter = Editor.chapterAt(range.start);
      S.project.links.push({
        id: uid(), kind, path, label: label || baseName(path),
        text: range.text, start: range.start, end: range.end,
        chapter: chapter ? chapter.title : '', created: Date.now(),
      });
      markDirty(true);
      this.render();
      toast(kind === 'song' ? 'Song linked to passage' : 'Picture linked to passage');
    };

    const list = el('div', { class: 'pick-list' });
    let modal;
    if (kind === 'song') {
      const songs = S.settings.playlist || [];
      if (!songs.length) list.append(el('div', { class: 'muted' }, 'Your playlist is empty — browse for a file instead.'));
      songs.forEach((s) => list.append(el('div', { class: 'mi', onclick: () => { choose(s.path, s.name); modal.close(); } }, '♪ ', s.name)));
    } else {
      const imgs = S.project.memory.filter((m) => m.kind === 'image');
      if (!imgs.length) list.append(el('div', { class: 'muted' }, 'No pictures in story memory — browse for a file instead.'));
      for (const m of imgs) {
        const img = el('img');
        Memory.pathOf(m).then(mediaUrl).then((u) => (img.src = u)).catch(() => {});
        list.append(el('div', {
          class: 'mi', onclick: async () => { choose(await Memory.pathOf(m), m.notes ? snippet(m.notes, 40) : m.name); modal.close(); },
        }, img, m.name));
      }
    }
    modal = openModal({
      title: kind === 'song' ? 'Link a song to this passage' : 'Link a picture to this passage',
      body: el('div', {}, el('p', { class: 'muted', style: 'font-family:var(--serif)' }, `“${snippet(range.text, 140)}”`), list),
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Browse for a file…', accent: true,
          onClick: async () => {
            const f = asPick(kind === 'song' ? (await window.crucible.pickSongs())[0] : await window.crucible.pickImage());
            if (f) choose(f.path, f.name);
          },
        },
      ],
    });
  },

  async open(link) {
    if (!(await window.crucible.fileExists(link.path))) {
      return toast(`File not found: ${link.label}`, true);
    }
    if (link.kind === 'song') return Player.playPath(link.path, link.label);
    let src;
    try { src = await mediaUrl(link.path); } catch (e) { return toast(e.message, true); }
    openModal({
      cls: 'lightbox',
      body: el('div', {}, el('img', { src }), el('div', { class: 'cap' }, link.label)),
      buttons: [],
    });
  },

  goTo(link) {
    const pos = TextOps.locate(Editor.text, link);
    if (pos === null) return toast("Can't find the linked passage any more", true);
    link.start = pos; link.end = pos + link.text.length;
    Editor.reveal(link.start, link.end);
  },

  async repoint(link) {
    const p = asPick(link.kind === 'song' ? (await window.crucible.pickSongs())[0] : await window.crucible.pickImage());
    if (!p) return;
    link.path = p.path;
    link.label = p.name;
    markDirty(true);
    this.render();
  },

  remove(link) {
    S.project.links = S.project.links.filter((l) => l !== link);
    markDirty(true);
    this.render();
  },

  at(pos, kind) {
    return S.project.links.find((l) => (!kind || l.kind === kind) && pos >= l.start && pos <= l.end);
  },

  onCaret(pos) {
    const here = this.at(pos);
    this._here = here;
    const chip = $('#stLinked');
    if (here) {
      chip.classList.remove('hidden');
      chip.textContent = here.kind === 'song' ? `♪ ${here.label}` : `▣ ${here.label}`;
      chip.title = here.kind === 'song' ? 'Click to play the linked song' : 'Click to view the linked picture';
    } else chip.classList.add('hidden');

    if (S.project.meta.ambient) {
      const song = this.at(pos, 'song');
      if (song && Player.currentPath !== song.path) Player.playPath(song.path, song.label);
    }
  },

  async render() {
    const list = $('#linkList');
    $('#linkBadge').textContent = S.project.links.length;
    $('#ambientToggle').checked = !!S.project.meta.ambient;
    list.innerHTML = '';
    if (!S.project.links.length) {
      list.append(el('div', { class: 'empty' },
        'Right-click in the manuscript → "Link a song" or "Link a picture" to tie music or images to a scene. ',
        el('br'), el('br'), 'They are referenced, never embedded — they won\'t appear in the text or the PDF.'));
      return;
    }
    const sorted = [...S.project.links].sort((a, b) => a.start - b.start);
    for (const l of sorted) {
      const exists = await window.crucible.fileExists(l.path);
      list.append(el('div', { class: `card ${exists ? '' : 'missing'}` },
        el('div', { class: 'row' },
          el('span', { class: 'tag' }, l.kind === 'song' ? '♪ song' : '▣ picture'),
          el('span', { class: 'name', title: window.crucible.platform === 'web' ? l.label : l.path }, l.label),
          !exists ? el('span', { class: 'tag st-missing' }, 'file missing') : null),
        el('div', { class: 'snippet', onclick: () => this.goTo(l), title: 'Show in manuscript' }, l.text),
        el('div', { class: 'actions' },
          el('button', { class: 'small accent', disabled: !exists, onclick: () => this.open(l) }, l.kind === 'song' ? 'Play' : 'View'),
          el('button', { class: 'small', onclick: () => this.goTo(l) }, 'Go to'),
          el('button', { class: 'small', onclick: () => this.repoint(l) }, 'Change file'),
          window.crucible.platform === 'web' ? null : el('button', { class: 'small ghost', onclick: () => window.crucible.reveal(l.path) }, 'Show file'),
          el('button', { class: 'small ghost danger', onclick: () => this.remove(l) }, '✕'))));
    }
  },
};
