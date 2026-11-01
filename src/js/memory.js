// =============================================================================
// memory.js — story memory (the AI's reference shelf)
// -----------------------------------------------------------------------------
// Files you add are COPIED into <book>.crucible/memory/ so the memory travels
// with the book. Each item has:
//   includeInAI  text files: send the file's contents to the AI as background
//   sendImage    pictures: attach the actual image (only works with vision models)
//   notes/tags   your description — always sent, so the AI knows what a photo
//                shows even when the image itself isn't attached
// =============================================================================

const Memory = {
  cache: {}, // file -> text contents
  dirs: {},

  init() {
    $('#btnAddMemory').addEventListener('click', () => this.add());
    $('#btnNewNote').addEventListener('click', () => this.newNote());
    $('#memSearch').addEventListener('input', debounce(() => this.render(), 150));
    Bus.on('settings', () => this.updateMeter()); // limit changed in Settings
  },

  items() { return S.project.memory; },
  images() { return S.project.memory.filter((m) => m.kind === 'image'); },

  async requireSaved() {
    if (S.path) return true;
    const ok = await confirmModal('Save the book first',
      'Story memory is stored in a folder next to your manuscript, so the book needs a file name first.', 'Save as…');
    if (ok) await App.saveAs();
    return !!S.path;
  },

  async add() {
    if (!(await this.requireSaved())) return;
    const items = await window.crucible.addMemory(S.path);
    if (!items.length) return;
    S.project.memory.push(...items);
    markDirty(true);
    await this.render();
    toast(`Added ${items.length} item(s) to story memory`);
  },

  async newNote() {
    if (!(await this.requireSaved())) return;
    const name = await promptModal('New memory note', 'e.g. "World geography", "Character bible – the detective", "Style guide"');
    if (!name) return;
    const item = await window.crucible.newMemoryNote({ bookPath: S.path, name });
    S.project.memory.push(item);
    markDirty(true);
    await this.render();
    this.editText(item);
  },

  async pathOf(item) {
    return window.crucible.memoryPath({ bookPath: S.path, file: item.file });
  },

  async textOf(item) {
    if (this.cache[item.file] === undefined) {
      this.cache[item.file] = await window.crucible.readMemoryText({ bookPath: S.path, file: item.file });
    }
    return this.cache[item.file];
  },

  async editText(item) {
    const ta = el('textarea', { style: 'width:100%;height:58vh;font:14px/1.6 var(--serif)' });
    ta.value = await this.textOf(item);
    openModal({
      title: `Edit ${item.name}`,
      body: ta,
      wide: true,
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Save note', accent: true,
          onClick: async () => {
            await window.crucible.writeMemoryText({ bookPath: S.path, file: item.file, text: ta.value });
            this.cache[item.file] = ta.value;
            this.render(); // also refreshes the size meter
            toast('Memory note saved');
          },
        },
      ],
    });
  },

  async view(item) {
    let src;
    try { src = await mediaUrl(await this.pathOf(item)); } catch (e) { return toast(e.message, true); }
    openModal({
      cls: 'lightbox',
      body: el('div', {}, el('img', { src }),
        el('div', { class: 'cap' }, item.notes || item.name)),
      buttons: [],
    });
  },

  async remove(item) {
    if (!(await confirmModal('Remove from memory', `Delete "${item.name}" from story memory? The copy inside the book folder will be removed (your original file is untouched).`, 'Remove'))) return;
    await window.crucible.deleteMemory({ bookPath: S.path, file: item.file });
    S.project.memory = S.project.memory.filter((m) => m !== item);
    markDirty(true);
    this.render();
  },

  // Assemble the memory text block sent to the AI, within a size budget.
  limit() {
    return SettingsCore.clampMemoryLimit(S.settings.memoryLimit);
  },

  headOf(m) {
    return `### ${m.name}${m.tags ? ` [${m.tags}]` : ''}${m.notes ? `\n(${m.notes})` : ''}\n`;
  },

  // Size of everything that would be sent, file by file (in list order).
  async measure() {
    const out = [];
    for (const m of S.project.memory.filter((x) => x.kind === 'text' && x.includeInAI)) {
      out.push({ m, size: this.headOf(m).length + (await this.textOf(m)).length });
    }
    return out;
  },

  // Assemble the memory text sent to the AI, within the limit set in Settings.
  // Files go in list order; once the limit is reached the current file is cut
  // short (trimmed) and the rest are left out (skipped).
  async buildContext(budgetChars = this.limit()) {
    let used = 0;
    const parts = [], trimmed = [], skipped = [];
    for (const m of S.project.memory.filter((x) => x.kind === 'text' && x.includeInAI)) {
      if (used >= budgetChars) { skipped.push(m.name); continue; }
      let t = await this.textOf(m);
      const head = this.headOf(m);
      if (used + t.length + head.length > budgetChars) {
        const room = budgetChars - used - head.length;
        if (room <= 0) { skipped.push(m.name); used = budgetChars; continue; }
        t = t.slice(0, room);
        trimmed.push(m.name);
      }
      parts.push(head + t);
      used += head.length + t.length;
    }
    const truncated = trimmed.length > 0 || skipped.length > 0;
    const imgs = this.images();
    const imageLines = imgs.map((m) =>
      `- ${m.name}${m.tags ? ` [${m.tags}]` : ''}: ${m.notes || '(no description)'}${m.sendImage ? ' — image attached' : ''}`);
    return {
      text: parts.join('\n\n'),
      images: imageLines.join('\n'),
      imageFiles: imgs.filter((m) => m.sendImage).map((m) => m.file),
      truncated, trimmed, skipped, used,
    };
  },

  // The meter at the top of the Story memory tab.
  async updateMeter() {
    const box = $('#memMeter');
    if (!box) return;
    const sizes = await this.measure();
    const total = sizes.reduce((a, b) => a + b.size, 0);
    const limit = this.limit();
    const pct = Math.min(100, (total / limit) * 100);
    const over = total > limit;
    box.classList.toggle('over', over);
    box.innerHTML = '';
    box.append(
      el('div', { class: 'meter-row' },
        el('span', {}, 'Sent to AI: ', el('strong', {}, total.toLocaleString()), ` / ${limit.toLocaleString()} characters`),
        el('span', { class: 'muted' }, `≈${Math.round(total / 4).toLocaleString()} tokens`)),
      el('div', { class: 'meter-bar' }, el('div', { class: 'meter-fill', style: `width:${pct}%` })),
      over ? el('div', { class: 'meter-warn' }, `Over the limit by ${(total - limit).toLocaleString()}. Files at the bottom of this list will be trimmed or left out. Untick some, or raise the limit in Settings.`) : null);
  },

  async render() {
    this.updateMeter();
    const list = $('#memList');
    const q = $('#memSearch').value.trim().toLowerCase();
    $('#memBadge').textContent = S.project.memory.length;
    list.innerHTML = '';
    if (!S.project.memory.length) {
      list.append(el('div', { class: 'empty' },
        'Add photos, maps, character bibles, timelines, research notes — anything the AI should know about your story. ',
        el('br'), el('br'),
        'Text files (.md/.txt) are read in full. Photos get your written description, and can optionally be shown to vision-capable AIs.'));
      return;
    }
    const shown = S.project.memory.filter((m) => !q || `${m.name} ${m.tags} ${m.notes}`.toLowerCase().includes(q));
    for (const m of shown) {
      const notes = el('textarea', { rows: 2, placeholder: m.kind === 'image' ? 'What does this picture show? (the AI reads this)' : 'Short description (optional)' });
      notes.value = m.notes || '';
      notes.addEventListener('change', () => { m.notes = notes.value; markDirty(true); this.updateMeter(); });
      const tags = el('input', { class: 'tags', placeholder: 'tags: character, place, 1952…', value: m.tags || '' });
      tags.addEventListener('change', () => { m.tags = tags.value; markDirty(true); this.updateMeter(); });

      const card = el('div', { class: 'card' },
        el('div', { class: 'row' },
          el('span', { class: 'tag' }, m.kind === 'image' ? 'photo' : 'note'),
          el('span', { class: 'name', title: m.name }, m.name)));

      if (m.kind === 'image') {
        const img = el('img', { class: 'mem-thumb', onclick: () => this.view(m) });
        this.pathOf(m).then(mediaUrl).then((u) => (img.src = u)).catch(() => {});
        card.append(img);
      } else {
        const preview = el('div', { class: 'snippet muted', onclick: () => this.editText(m) }, '…');
        this.textOf(m).then((t) => (preview.textContent = snippet(t.replace(/^#.*$/m, ''), 200) || '(empty)'));
        card.append(preview);
      }
      card.append(notes, tags);

      const opt = m.kind === 'image'
        ? el('label', { class: 'check', title: 'Attach this image when talking to vision-capable AIs' },
          el('input', { type: 'checkbox', checked: m.sendImage, onchange: (e) => { m.sendImage = e.target.checked; markDirty(true); } }), 'Show image to AI')
        : el('label', { class: 'check' },
          el('input', { type: 'checkbox', checked: m.includeInAI, onchange: (e) => { m.includeInAI = e.target.checked; markDirty(true); this.updateMeter(); } }), 'AI reads this');

      card.append(el('div', { class: 'actions' }, opt, el('span', { class: 'spacer' }),
        m.kind === 'text' ? el('button', { class: 'small', onclick: () => this.editText(m) }, 'Edit') : null,
        el('button', { class: 'small ghost danger', onclick: () => this.remove(m) }, '✕')));
      list.append(card);
    }
  },
};
