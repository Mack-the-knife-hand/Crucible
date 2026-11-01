// =============================================================================
// scenes.js — Corkboard and Timeline
// -----------------------------------------------------------------------------
// Both work on the scene model (SceneOps in util.js) and, like the Chapter
// builder, change nothing until Apply. Apply is one edit: one Ctrl+Z undoes it.
// =============================================================================

const SceneUI = {
  COLORS: { '': 'none', red: '#d9665b', orange: '#e8743b', yellow: '#e3b448', green: '#7fb685', blue: '#5b8fd9', purple: '#a07bd9' },

  // Edit a scene's card details (summary, when, track, colour).
  editMeta(scene, tracks, onDone) {
    const f = (label, input, hint) => el('div', { class: 'field' }, el('label', {}, label), input, hint ? el('div', { class: 'hint' }, hint) : null);
    const summary = el('textarea', { rows: 2, style: 'width:100%' });
    summary.value = scene.meta.summary;
    const when = el('input', { value: scene.meta.when, placeholder: 'e.g. 1952-06-14, 1952-06-14 21:30, June 1952, Day 3' });
    const listId = `tracks-${uid()}`;
    const track = el('input', { value: scene.meta.track, placeholder: 'e.g. Present, Flashback, The colony', list: listId });
    const dl = el('datalist', { id: listId }, ...tracks.map((t) => el('option', { value: t })));
    const color = el('select', {}, ...Object.keys(this.COLORS).map((c) => el('option', { value: c }, c || 'none')));
    color.value = scene.meta.color;
    openModal({
      title: `Scene: ${snippet(SceneOps.label(scene), 60)}`,
      body: el('div', {},
        f('Summary', summary, 'Shown on the card. Stored as a hidden note in the manuscript, never printed.'),
        f('When (in the story)', when, 'Used to sort the Timeline. Leave empty if it doesn\'t matter.'),
        f('Track', track, 'Separate storylines or eras get their own timeline lane.'),
        f('Card colour', color), dl),
      buttons: [
        { label: 'Cancel' },
        { label: 'OK', accent: true, onClick: () => { SceneOps.setMeta(scene, { summary: summary.value, when: when.value, track: track.value, color: color.value }); onDone(); } },
      ],
    });
  },

  tracks(model) {
    const t = new Set();
    model.chapters.forEach((c) => c.scenes.forEach((s) => s.meta.track && t.add(s.meta.track)));
    return [...t];
  },

  apply(model, label) {
    const out = SceneOps.buildBoard(model);
    if (out === Editor.text) { toast('No changes'); return; }
    Editor.replaceAll(out, (t) => t, label);
    Editor.refreshAll();
    markDirty(true);
    toast(`${label[0].toUpperCase() + label.slice(1)} applied. One Ctrl+Z in the manuscript undoes it.`, false, 5000);
  },
};

// ------------------------------------------------------------- Corkboard --
const Corkboard = {
  open() {
    this.model = SceneOps.board(Editor.text);
    if (!this.model.chapters.length) return toast('Add chapter headings (## Chapter…) first. The corkboard shows scenes inside chapters.', true, 6000);
    this.body = el('div', { class: 'cork' });
    openModal({
      title: 'Corkboard',
      wide: true,
      cls: 'cork-modal',
      body: this.body,
      buttons: [{ label: 'Cancel' }, { label: 'Apply changes', accent: true, onClick: () => SceneUI.apply(this.model, 'corkboard changes') }],
    });
    this.render();
  },

  move(fromC, fromI, toC, toI) {
    const ch = this.model.chapters;
    const [s] = ch[fromC].scenes.splice(fromI, 1);
    if (fromC === toC && toI > fromI) toI--;
    ch[toC].scenes.splice(Math.max(0, Math.min(toI, ch[toC].scenes.length)), 0, s);
    this.render();
  },

  render() {
    const m = this.model;
    const b = this.body;
    const scroll = b.querySelector('.cork-cols')?.scrollLeft || 0;
    b.innerHTML = '';
    b.append(el('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' },
      'Drag cards to reorder scenes, within or between chapters. Double-click a card (or ✎) to give it a summary, a date, a track and a colour. Scenes are split at sub-headings and at *** breaks.'));
    const cols = el('div', { class: 'cork-cols' });
    let drag = null;
    m.chapters.forEach((c, ci) => {
      const col = el('div', { class: 'cork-col' });
      const list = el('div', { class: 'cork-list' });
      const dropAt = (i) => (e) => { e.preventDefault(); e.stopPropagation(); if (drag) this.move(drag.c, drag.i, ci, i); drag = null; };
      list.addEventListener('dragover', (e) => { e.preventDefault(); list.classList.add('over'); });
      list.addEventListener('dragleave', () => list.classList.remove('over'));
      list.addEventListener('drop', dropAt(c.scenes.length));
      c.scenes.forEach((s, si) => {
        const color = SceneUI.COLORS[s.meta.color] || 'transparent';
        const card = el('div', {
          class: 'cork-card', draggable: 'true', 'data-c': ci, 'data-i': si, style: `border-top-color:${color}`,
          ondblclick: () => SceneUI.editMeta(s, SceneUI.tracks(m), () => this.render()),
        },
        el('div', { class: 'cc-title' }, SceneOps.label(s)),
        s.meta.summary && s.title ? el('div', { class: 'cc-sum' }, s.meta.summary) : null,
        el('div', { class: 'cc-foot' },
          s.meta.when ? el('span', { class: 'cc-when' }, s.meta.when) : null,
          s.meta.track ? el('span', { class: 'cc-track' }, s.meta.track) : null,
          el('span', { class: 'spacer' }),
          el('span', { class: 'muted' }, `${s.words.toLocaleString()} w`),
          el('button', { class: 'small ghost', title: 'Edit card', onclick: (e) => { e.stopPropagation(); SceneUI.editMeta(s, SceneUI.tracks(m), () => this.render()); } }, '✎')));
        card.addEventListener('dragstart', (e) => { drag = { c: ci, i: si }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', `${ci}:${si}`); card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop-before'); });
        card.addEventListener('dragleave', () => card.classList.remove('drop-before'));
        card.addEventListener('drop', dropAt(si));
        list.append(card);
      });
      if (!c.scenes.length) list.append(el('div', { class: 'empty', style: 'padding:10px' }, 'Drop scenes here'));
      const changed = c.scenes.length !== c.scenesOrig.length || c.scenes.some((s, i) => s !== c.scenesOrig[i] || s.dirty);
      col.append(el('div', { class: 'cork-head' }, el('span', {}, c.title), changed ? el('em', {}, 'edited') : null), list);
      cols.append(col);
    });
    b.append(cols);
    cols.scrollLeft = scroll;
  },
};

// -------------------------------------------------------------- Timeline --
const Timeline = {
  open() {
    this.model = SceneOps.board(Editor.text);
    if (!this.model.chapters.length) return toast('Add chapter headings (## Chapter…) first. The timeline works with scenes inside chapters.', true, 6000);
    this.mode = 'chrono';
    this.body = el('div', { class: 'tl' });
    openModal({
      title: 'Timeline',
      wide: true,
      cls: 'cork-modal',
      body: this.body,
      buttons: [{ label: 'Cancel' }, { label: 'Apply changes', accent: true, onClick: () => SceneUI.apply(this.model, 'timeline changes') }],
    });
    this.render();
  },

  scenes() {
    const out = [];
    let n = 0;
    this.model.chapters.forEach((c) => c.scenes.forEach((s) => out.push({ s, c, order: n++, key: SceneOps.dateKey(s.meta.when) })));
    return out;
  },

  // Inline editors for date and track.
  row(x, tracks) {
    const s = x.s;
    const when = el('input', { class: 'tl-when', value: s.meta.when, placeholder: 'when?' });
    when.addEventListener('change', () => { SceneOps.setMeta(s, { when: when.value }); this.render(); });
    const lid = `tl-tracks-${x.order}`;
    const track = el('input', { class: 'tl-track', value: s.meta.track, placeholder: 'track', list: lid });
    track.addEventListener('change', () => { SceneOps.setMeta(s, { track: track.value }); this.render(); });
    const color = SceneUI.COLORS[s.meta.color] || 'var(--line)';
    return el('div', { class: `tl-card ${x.jump ? 'jump' : ''}`, style: `border-left-color:${color}` },
      el('div', { class: 'tl-title', title: 'Double-click to edit the card', ondblclick: () => SceneUI.editMeta(s, tracks, () => this.render()) },
        x.jump ? el('span', { class: 'tl-jumpmark', title: 'Earlier in story time than the scene before it in this track (a flashback?)' }, '↩ ') : null,
        SceneOps.label(s)),
      el('div', { class: 'tl-sub muted' }, `${x.c.title} · ${s.words.toLocaleString()} w`),
      el('div', { class: 'tl-edit' }, when, track, el('datalist', { id: lid }, ...tracks.map((t) => el('option', { value: t })))));
  },

  render() {
    const b = this.body;
    b.innerHTML = '';
    const all = this.scenes();
    const tracks = SceneUI.tracks(this.model);
    const dated = all.filter((x) => x.key !== null).length;
    const modeSel = el('div', { class: 'seg' },
      el('button', { class: this.mode === 'chrono' ? 'on' : '', onclick: () => { this.mode = 'chrono'; this.render(); } }, 'Story time'),
      el('button', { class: this.mode === 'reading' ? 'on' : '', onclick: () => { this.mode = 'reading'; this.render(); } }, 'Reading order'));
    b.append(el('div', { class: 'cb-top' }, modeSel, el('span', { class: 'spacer' }),
      el('span', { class: 'muted', style: 'font-size:12px' }, `${dated} of ${all.length} scenes dated · ${tracks.length || 'no'} track${tracks.length === 1 ? '' : 's'}`)));
    if (this.mode === 'reading') {
      // Book order; flag scenes that go back in time within their track.
      const lastByTrack = {};
      for (const x of all) {
        const t = x.s.meta.track || '';
        if (x.key !== null) {
          if (lastByTrack[t] !== undefined && x.key < lastByTrack[t]) x.jump = true;
          lastByTrack[t] = x.key;
        }
      }
      const list = el('div', { class: 'tl-reading' }, ...all.map((x) => this.row(x, tracks)));
      b.append(el('div', { class: 'muted', style: 'font-size:12px;margin:6px 0' }, 'Scenes in the order a reader meets them. ↩ marks a jump back in story time within the same track.'), list);
      return;
    }
    const lanes = [...tracks, ''].filter((t) => all.some((x) => (x.s.meta.track || '') === t && x.key !== null));
    const undated = all.filter((x) => x.key === null);
    const cols = el('div', { class: 'cork-cols' });
    for (const t of lanes) {
      const items = all.filter((x) => (x.s.meta.track || '') === t && x.key !== null).sort((a, b2) => a.key - b2.key || a.order - b2.order);
      cols.append(el('div', { class: 'cork-col' }, el('div', { class: 'cork-head' }, t || 'No track'), el('div', { class: 'cork-list' }, ...items.map((x) => this.row(x, tracks)))));
    }
    cols.append(el('div', { class: 'cork-col undated' }, el('div', { class: 'cork-head' }, `Undated (${undated.length})`),
      el('div', { class: 'cork-list' }, ...undated.map((x) => this.row(x, tracks)))));
    b.append(el('div', { class: 'muted', style: 'font-size:12px;margin:6px 0' },
      'Give scenes a "when" (1952-06-14, June 1952, 2078, Day 3…) and a track to see them in story-time order, one lane per track. Undated scenes wait on the right.'), cols);
  },
};
