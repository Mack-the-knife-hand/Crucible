// =============================================================================
// app.js — startup, file commands, tabs, keyboard shortcuts
// =============================================================================

const App = {
  // The Crucible icon as an <img> (the browser edition carries it inside the file).
  logo(cls = '') {
    const src = document.getElementById('appLogo')?.innerHTML.trim() || 'img/icon-128.png';
    return el('img', { class: `app-logo ${cls}`, src, alt: '' });
  },

  async init() {
    S.settings = await window.crucible.getSettings();
    S.project = blankProject();
    this.applyUi();

    Editor.init();
    Pool.init();
    Memory.init();
    Prose.init();
    AI.init();
    Links.init();
    Notes.init();
    Highlights.init();
    Speech.init();
    Goals.init();
    Player.init();

    AI.renderProviders();
    Editor.setView(S.settings.ui.view || 'edit');
    this.renderAll();
    this.bindTopbar();
    this.bindTabs();
    this.bindPanels();
    this.bindShortcuts();

    // Autosave (top-bar checkbox): every 5 minutes while ticked.
    $('#autosaveToggle').addEventListener('change', (e) => this.setAutosave(e.target.checked));
    this.setAutosave(!!S.settings.ui.autosave, false);
    window.crucible.onSaveAndQuit(async () => {
      if (await this.save() && !S.dirty) window.crucible.quitNow();
    });

    updateTitle();
    if (window.crucible.platform === 'web') {
      // Browsers only let a page touch your files after a click, so instead of
      // reopening silently we offer a one-click "welcome back".
      this.welcome();
    } else if (S.settings.recent?.[0] && (await window.crucible.fileExists(S.settings.recent[0]))) {
      // Reopen the last book.
      this.openPath(S.settings.recent[0]).catch(() => {});
    }
  },

  // Browser edition start-up. Browsers only let a page touch your files after
  // a click, so we start with one button that reconnects your Crucible folder
  // (where crucible-settings.json lives) and then lists your books.
  async welcome() {
    const c = window.crucible;
    if (c.storageMode !== 'folder') return this.welcomeBrowserStorage();
    const info = await c.homeInfo();
    let modal;
    const body = el('div', {}, this.logo());
    if (info) {
      body.append(
        el('p', { style: 'margin-top:0' }, 'Your Crucible folder: ', el('strong', {}, info.name)),
        el('p', { class: 'muted', style: 'font-size:12.5px' }, 'Crucible loads your settings from crucible-settings.json in that folder. Your browser will ask once per session to allow access.'));
    } else {
      body.append(
        el('p', { style: 'margin-top:0' }, 'Choose your ', el('strong', {}, 'Crucible folder'),
          '. That\'s the folder holding crucible.html, such as the one on your thumb drive.'),
        el('ul', { style: 'margin:0 0 8px;padding-left:20px;line-height:1.6' },
          el('li', {}, 'Your settings are saved there in ', el('code', {}, 'crucible-settings.json'), ', so they go wherever the folder goes.'),
          el('li', {}, 'Books, music and pictures kept inside it are found automatically on any computer.')),
        el('p', { class: 'muted', style: 'font-size:12.5px' }, 'Already have a crucible-settings.json there? It\'ll be loaded.'));
    }
    modal = openModal({
      title: info ? 'Welcome back' : 'Welcome to Crucible',
      body,
      buttons: [
        { label: 'Restore a backup…', onClick: () => { setTimeout(() => Package.restore(), 0); } },
        { label: info ? 'Use a different folder…' : 'Skip for now', onClick: () => (info ? this.connectHome(true) : this.showBookChooser()) },
        { label: info ? `Open ${info.name}` : 'Choose Crucible folder…', accent: true, onClick: () => this.connectHome(false) },
      ],
    });
  },

  async connectHome(pickNew) {
    const r = await window.crucible.connectHome(pickNew);
    if (!r.ok) {
      if (r.reason === 'missing') return this.driveMissing(r.name);
      if (r.reason === 'denied') toast('Folder access wasn\'t allowed. Your settings file can\'t be read until it is.', true, 6000);
      if (r.reason === 'blocked') toast('This browser won\'t allow folder access, so Crucible will use browser storage instead.', true, 7000);
      if (r.reason !== 'cancelled') this.showBookChooser();
      else this.welcome();
      return;
    }
    this.reloadSettings(r.settings);
    toast(r.loaded ? `Settings loaded from ${r.name}/crucible-settings.json` : `Created crucible-settings.json in ${r.name}`, false, 4000);
    await Settings.reviewEndpoints(r, `The settings file in "${r.name}"`);
    this.showBookChooser();
  },

  // The remembered Crucible folder can't be reached: the drive is locked
  // (BitLocker), unplugged, or Windows gave it a different drive letter.
  driveMissing(name) {
    openModal({
      title: `Can't reach "${name}"`,
      body: el('div', {},
        el('p', { style: 'margin-top:0' }, 'Crucible remembers your Crucible folder, but can\'t open it right now. Usually that means:'),
        el('ul', { style: 'margin:0 0 8px;padding-left:20px;line-height:1.7' },
          el('li', {}, 'the thumb drive isn\'t plugged in, or'),
          el('li', {}, 'it\'s ', el('strong', {}, 'still locked'), '. Open it in File Explorer and enter your BitLocker password first, or'),
          el('li', {}, 'Windows gave it a ', el('strong', {}, 'different drive letter'), ' on this computer.')),
        el('p', { class: 'muted', style: 'font-size:12.5px' }, 'Unlock or plug in the drive, then click Try again. If the drive letter changed, use Choose folder… and pick the same folder. Your settings file there will load.')),
      buttons: [
        { label: 'Skip for now', onClick: () => this.showBookChooser() },
        { label: 'Choose folder…', onClick: () => this.connectHome(true) },
        { label: 'Try again', accent: true, onClick: () => this.connectHome(false) },
      ],
    });
  },

  // ------------------------------------------------------------ autosave --
  AUTOSAVE_MS: 5 * 60 * 1000,
  _autosaveTimer: null,

  setAutosave(on, persist = true) {
    $('#autosaveToggle').checked = on;
    clearInterval(this._autosaveTimer);
    this._autosaveTimer = null;
    if (on) {
      // The 5-minute clock starts when you tick the box. Each tick saves only
      // if there are unsaved changes and the book already has a file.
      this._autosaveTimer = setInterval(() => this.autosaveTick(), this.AUTOSAVE_MS);
      if (persist) toast(S.path ? 'Autosave on: saving every 5 minutes' : 'Autosave on. It starts once the book has been saved the first time.');
    } else if (persist) toast('Autosave off');
    if (persist) persistSettings({ ui: { ...S.settings.ui, autosave: on } });
  },

  async autosaveTick() {
    if (!S.dirty || !S.path) return;
    await this.save(true);
  },

  // Apply a freshly loaded settings object to the running app.
  reloadSettings(s) {
    S.settings = s;
    this.applyUi();
    AI.renderProviders();
    Player.audio.volume = s.volume ?? 0.7;
    $('#plVol').value = Player.audio.volume;
    Player.render();
    this.setCollapsed('left', !!s.ui.leftCollapsed, false);
    this.setCollapsed('right', !!s.ui.rightCollapsed, false);
    Editor.setView(s.ui.view || 'edit');
    this.setAutosave(!!s.ui.autosave, false);
  },

  async showBookChooser() {
    const c = window.crucible;
    const homeBooks = c.listHomeBooks ? await c.listHomeBooks() : [];
    // Recent books outside the Crucible folder (inside ones are already listed).
    const info = c.homeInfo ? await c.homeInfo() : null;
    const keyOf = (p) => { const parts = p.split('/'); return parts.length > 1 ? parts.slice(-2).join('/') : `${info?.name}/${p}`; };
    const inHomeKeys = new Set(homeBooks.map((b) => keyOf(b.path)));
    const recent = [];
    for (const r of (S.settings.recent || []).slice(0, 6)) {
      if (!inHomeKeys.has(r) && await c.fileExists(r)) recent.push(r);
    }
    const body = el('div', {});
    let modal;
    const list = el('div', { class: 'pick-list' });
    homeBooks.slice(0, 14).forEach(({ path: p, book }) => list.append(el('div', {
      class: `mi ${book ? '' : 'not-book'}`, title: book ? p : `${p}: a Markdown file Crucible hasn't opened as a book yet`, onclick: async () => {
        modal.close();
        try { if (await this.confirmDiscard()) { this.loadBook(await c.openHomeBook(p)); toast(`Opened ${baseName(p)}`); } } catch (e) { toast(e.message, true, 6000); }
      },
    }, el(book ? 'strong' : 'span', {}, baseName(p)), el('span', { class: 'muted', style: 'margin-left:auto;font-size:12px' }, `${book ? '' : 'not opened yet · '}${p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '(top of folder)'}`))));
    recent.forEach((r) => list.append(el('div', {
      class: 'mi', onclick: () => { modal.close(); this.openPath(r).catch((e) => toast(e.message, true, 6000)); },
    }, el('strong', {}, baseName(r)), el('span', { class: 'muted', style: 'margin-left:auto;font-size:12px' }, r.split('/')[0]))));
    if (homeBooks.length || recent.length) body.append(el('p', { class: 'muted', style: 'margin-top:0' }, 'Pick up where you left off:'), list);
    else body.append(el('p', { style: 'margin-top:0' }, 'Open the folder that contains your manuscript, or start a new book. Tip: keep your books inside your Crucible folder so they travel with it.'));
    modal = openModal({
      title: 'Your books',
      body,
      buttons: [
        { label: 'Start a new book', onClick: () => this.newBook() },
        { label: 'Open another book…', accent: !homeBooks.length && !recent.length, onClick: () => this.open() },
      ],
    });
  },

  async welcomeBrowserStorage() {
    const recent = [];
    for (const r of (S.settings.recent || []).slice(0, 6)) if (await window.crucible.fileExists(r)) recent.push(r);
    const body = el('div', {}, this.logo());
    let modal;
    if (recent.length) {
      const list = el('div', { class: 'pick-list' });
      recent.forEach((r) => list.append(el('div', {
        class: 'mi', onclick: () => { modal.close(); this.openPath(r).catch((e) => toast(e.message, true, 6000)); },
      }, el('strong', {}, baseName(r)))));
      body.append(el('p', { class: 'muted', style: 'margin-top:0' }, 'Pick up where you left off:'), list);
    }
    body.append(el('p', {}, 'This browser can\'t edit files in place, so your book is kept in the browser\'s own storage. Use ',
      el('strong', {}, 'Download .md'), ' to save a copy, and ', el('strong', {}, 'Settings → Export settings'),
      ' to carry your settings elsewhere. Edge or Chrome can save straight to your files.'));
    modal = openModal({
      title: recent.length ? 'Welcome back' : 'Welcome to Crucible',
      body,
      buttons: [
        { label: 'Start a new book', onClick: () => this.newBook() },
        { label: 'Open book…', accent: true, onClick: () => this.open() },
      ],
    });
  },

  download() {
    const name = S.path ? baseName(S.path) : 'Untitled.md';
    window.crucible.downloadText(name, Editor.text);
    toast(`Downloading ${name}`);
  },

  applyUi() {
    const ui = S.settings.ui;
    document.documentElement.dataset.theme = ui.theme || 'dark';
    $('#btnTheme').textContent = ui.theme === 'light' ? 'Dark' : 'Light';
    document.documentElement.style.setProperty('--editor-size', (ui.fontSize || 17) + 'px');
    this.applyBackground(ui);
    if (typeof Highlights !== 'undefined' && Highlights.refresh) { Highlights.previewOn = undefined; Highlights.refresh(); } // text size changes the wrapping
  },

  // Writing-area background photo, seen through a veil of the theme's own
  // background colour: opacity 25 % shows a quarter of the photo.
  async applyBackground(ui) {
    const wrap = $('#editorWrap');
    const root = document.documentElement.style;
    const op = Math.max(0, Math.min(100, Number(ui.bgOpacity ?? 25)));
    root.setProperty('--bg-veil', `${100 - op}%`);
    wrap.classList.toggle('bg-read', !!ui.bgRead);
    const ref = ui.bgImage || '';
    if (!ref) { wrap.classList.remove('has-bg'); root.removeProperty('--editor-bg'); this._bgRef = ''; return; }
    if (this._bgRef !== ref) {
      this._bgRef = ref;
      const url = await window.crucible.backgroundUrl(ref).catch(() => null);
      if (this._bgRef !== ref) return; // changed again meanwhile
      if (!url) { wrap.classList.remove('has-bg'); root.removeProperty('--editor-bg'); return; }
      root.setProperty('--editor-bg', `url("${url.replace(/["\\\n]/g, '')}")`);
    }
    wrap.classList.add('has-bg');
  },

  renderAll() {
    Pool.render();
    Memory.render();
    Links.render();
    Highlights.refresh();
    AI.renderContext();
    AI.renderChat();
    Prose.render();
    Notes.render();
  },

  // -------------------------------------------------------------- files --
  async confirmDiscard() {
    if (this._savePromise) await this._savePromise;
    if (AI.busy || Prose.running) {
      toast('Wait for the AI request to finish, or stop the prose pass before switching books.', true, 6000);
      return false;
    }
    if (!S.dirty) return true;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
      openModal({
        title: 'Save your changes?',
        body: el('p', {}, 'This book has unsaved writing or notes. Save them before leaving?'),
        buttons: [
          { label: 'Cancel', onClick: () => finish(false) },
          { label: 'Discard changes', onClick: () => finish(true) },
          { label: 'Save and continue', accent: true, onClick: async () => {
            if (!(await this.save()) || S.dirty) return false;
            finish(true);
          } },
        ],
        onClose: () => finish(false),
      });
    });
  },

  loadBook(res) {
    S.path = res.path;
    S.sidecar = res.sidecar;
    S.project = Object.assign(blankProject(), res.project);
    S.project.meta = Object.assign({ negotiate: [] }, S.project.meta);
    Memory.cache = {};
    BookImages.clear();
    Goals.sessionStart = null;
    Speech.stop();
    Editor.setText(res.text);
    // Offsets saved last time should match, but re-find anything that drifted
    // (e.g. if the .md was edited in another program).
    Bus.emit('relocate', { text: res.text, transform: (t) => t });
    S.lastSaved = null;
    S.lastAutosave = null;
    S.saveError = null;
    markDirty(false);
    updateTitle();
    this.renderAll();
  },

  async open() {
    if (!(await this.confirmDiscard())) return;
    const res = await window.crucible.openBook();
    if (res) { this.loadBook(res); toast(`Opened ${baseName(res.path)}`); }
  },

  async openPath(p) {
    if (!(await this.confirmDiscard())) return;
    const res = await window.crucible.openBookPath(p);
    this.loadBook(res);
    toast(`Opened ${baseName(res.path)}`);
  },

  async newBook() {
    if (!(await this.confirmDiscard())) return;
    S.path = null;
    S.sidecar = null;
    S.project = blankProject();
    S.lastSaved = null; S.lastAutosave = null; S.saveError = null;
    Memory.cache = {}; BookImages.clear(); Goals.sessionStart = null; Speech.stop();
    Editor.setText('# Title\n\n## Chapter One\n\n');
    markDirty(false);
    this.renderAll();
    updateTitle();
  },

  // One write at a time. Keep editing during a write without losing dirty state.
  _savePromise: null,
  save(quiet = false) { return this.writeBook(false, quiet); },
  saveAs() { return this.writeBook(true, false); },

  writeBook(asNew, quiet) {
    if (this._savePromise) return this._savePromise;
    const project = S.project;
    const revision = S.revision;
    const text = Editor.text;
    const bookPath = S.path;
    asNew = asNew || !bookPath;
    let snapshot;
    try { snapshot = structuredClone(project); }
    catch (e) { this.saveFailed(e); return Promise.resolve(false); }
    S.saving = true; S.saveError = null; updateTitle();
    this._savePromise = (async () => {
      try {
        const r = asNew
          ? await window.crucible.saveBookAs({ text, project: snapshot, currentPath: bookPath })
          : await window.crucible.saveBook({ bookPath, text, project: snapshot });
        if (!r || r.canceled) return false;
        // A late result must never change the identity or status of another book.
        if (S.project !== project) return false;
        if (asNew) { S.path = r.path; S.sidecar = r.sidecar; Memory.cache = {}; BookImages.clear(); }
        S.lastSaved = r.savedAt || Date.now();
        S.lastAutosave = quiet ? S.lastSaved : null;
        markDirty(S.revision !== revision || Editor.text !== text);
        if (asNew) this.renderAll();
        if (!quiet) toast(S.dirty ? 'Snapshot saved. Newer changes still need saving.' : asNew ? `Saved as ${baseName(S.path)}` : 'Saved');
        return true;
      } catch (e) {
        if (S.project === project) this.saveFailed(e);
        return false;
      } finally {
        S.saving = false; this._savePromise = null; updateTitle();
      }
    })();
    return this._savePromise;
  },

  saveFailed(e) {
    S.saveError = e.message || 'The book could not be saved.';
    markDirty(true); updateTitle();
    toast(`Save failed: ${S.saveError}. Your work is still open. Reconnect the drive and retry, or use File > Save as.`, true, 12000);
  },

  async backups() {
    if (!S.path) return toast('Save the book first — backups are made on every save.');
    const names = await window.crucible.listBackups(S.path);
    if (!names.length) return toast('No backups yet. One is made each time you save.');
    const pre = el('pre', {}, 'Select a backup to preview it.');
    let chosen = null;
    const list = el('div', { class: 'list pick-list', style: 'padding:0' });
    names.forEach((n) => {
      const m = n.match(/_(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)/);
      const label = m ? `${m[1]}  ${m[2]}:${m[3]}:${m[4]} UTC` : n;
      list.append(el('div', {
        class: 'mi', onclick: async (e) => {
          $$('.mi', list).forEach((x) => (x.style.borderColor = ''));
          e.currentTarget.style.borderColor = 'var(--ember)';
          chosen = await window.crucible.readBackup({ bookPath: S.path, name: n });
          pre.textContent = `${countWords(chosen).toLocaleString()} words\n\n${chosen.slice(0, 20000)}${chosen.length > 20000 ? '\n\n…' : ''}`;
        },
      }, label));
    });
    openModal({
      title: 'Restore from backup',
      wide: true,
      body: el('div', { class: 'backup-view' }, list, pre),
      buttons: [
        { label: 'Close' },
        {
          label: 'Restore into editor', accent: true,
          onClick: () => {
            if (!chosen) { toast('Pick a backup first'); return false; }
            Editor.replaceAll(chosen, (t) => t, 'backup restore');
            toast('Backup restored — Ctrl+Z undoes, Save keeps it');
          },
        },
      ],
    });
  },

  // File ▾ menu: less-used file commands + recent books.
  async showFileMenu() {
    const dd = $('#btnFile').parentElement;
    const menu = $('#fileMenu');
    menu.innerHTML = '';
    const cmd = (label, key, fn) => menu.append(el('div', { class: 'mi', onclick: () => { dd.classList.remove('open'); fn(); } },
      label, key ? el('span', { class: 'muted', style: 'margin-left:auto;padding-left:16px;font-size:11px' }, key) : null));
    menu.style.display = '';
    cmd('New book', '', () => this.newBook());
    cmd('Open book…', 'Ctrl+O', () => this.open());
    if (window.crucible.platform === 'web' && window.crucible.showBooks !== false) cmd('Books in my Crucible folder…', '', () => this.showBookChooser());
    cmd('Save as…', 'Ctrl+Shift+S', () => this.saveAs());
    cmd('Backups…', '', () => this.backups());
    menu.append(el('div', { class: 'sep', style: 'height:1px;background:var(--line);margin:4px 2px' }));
    cmd('☰ Chapter builder…', '', () => Chapters.open());
    cmd('▦ Corkboard…', '', () => Corkboard.open());
    cmd('⟿ Timeline…', '', () => Timeline.open());
    cmd('Writing goals…', '', () => Goals.open());
    cmd('About Crucible…', '', () => Settings.about());
    cmd('📑 Insert table of contents at cursor', '', () => Editor.insertToc());
    menu.append(el('div', { class: 'sep', style: 'height:1px;background:var(--line);margin:4px 2px' }));
    cmd('📦 Package & back up everything…', '', () => Package.open());
    cmd('♻ Restore from a backup…', '', () => Package.restore());
    if (window.crucible.platform === 'web') cmd('Download .md copy', '', () => this.download());
    menu.append(el('div', { class: 'sep', style: 'height:1px;background:var(--line);margin:4px 2px' }));
    menu.append(el('div', { class: 'mi muted', style: 'cursor:default;font-size:11px;text-transform:uppercase;letter-spacing:.06em' }, 'Recent'));
    const rec = S.settings.recent || [];
    if (!rec.length) menu.append(el('div', { class: 'mi muted' }, 'No recent books'));
    rec.forEach((p) => menu.append(el('div', {
      class: 'mi', title: p, onclick: async () => {
        dd.classList.remove('open');
        this.openPath(p).catch((e) => toast(`Couldn't open: ${e.message}`, true));
      },
    }, baseName(p), el('span', { class: 'muted', style: 'margin-left:8px;font-size:11px' }, p))));
    dd.classList.toggle('open');
  },

  // ----------------------------------------------------------- UI wiring --
  bindTopbar() {
    $('#btnRetrySave').onclick = () => this.save();
    $('#btnOpen').onclick = () => this.open();
    $('#btnChapters').onclick = () => Chapters.open();
    $('#btnCork').onclick = () => Corkboard.open();
    $('#btnTimeline').onclick = () => Timeline.open();
    $('#btnPackage').onclick = () => Package.open();
    $('#btnBeta').onclick = () => Beta.open();
    $('#btnImportData').onclick = () => DataImport.open();
    $('#btnSave').onclick = () => this.save();
    $('#btnFile').onclick = (e) => { e.stopPropagation(); this.showFileMenu(); };
    document.addEventListener('click', (e) => { if (!e.target.closest('.dropdown')) $$('.dropdown').forEach((d) => d.classList.remove('open')); });
    $('#btnFind').onclick = () => Editor.openFind();
    $('#btnExport').onclick = () => Export.open();
    $('#btnSettings').onclick = () => Settings.open();
    $('#btnTheme').onclick = () => {
      const t = S.settings.ui.theme === 'light' ? 'dark' : 'light';
      persistSettings({ ui: { ...S.settings.ui, theme: t } }).then(() => this.applyUi());
    };
  },

  bindTabs() {
    $$('.tabs').forEach((nav) => nav.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => this.showTab(nav.dataset.for, b.dataset.tab))));
  },

  // ------------------------------------------------- collapsible panels --
  bindPanels() {
    $$('.collapse-btn').forEach((b) => (b.onclick = () => this.setCollapsed(b.dataset.panel, true)));
    $$('.rail-expand').forEach((b) => (b.onclick = () => this.setCollapsed(b.dataset.panel, false)));
    $$('.rail-tab').forEach((b) => (b.onclick = () => { this.setCollapsed(b.dataset.panel, false); this.showTab(b.dataset.panel, b.dataset.tab); }));
    $('#btnFocus').onclick = () => this.toggleFocus();
    // Rail badges mirror the real tab badges.
    $$('[data-mirror]').forEach((m) => {
      const src = document.getElementById(m.dataset.mirror);
      const sync = () => (m.textContent = src.textContent);
      new MutationObserver(sync).observe(src, { childList: true, characterData: true, subtree: true });
      sync();
    });
    const ui = S.settings.ui;
    this.setCollapsed('left', !!ui.leftCollapsed, false);
    this.setCollapsed('right', !!ui.rightCollapsed, false);
  },

  setCollapsed(side, on, persist = true) {
    document.body.classList.toggle(`${side}-collapsed`, on);
    $(`#${side}`).classList.toggle('collapsed', on);
    $('#btnFocus').classList.toggle('on', document.body.classList.contains('left-collapsed') && document.body.classList.contains('right-collapsed'));
    if (persist) persistSettings({ ui: { ...S.settings.ui, [`${side}Collapsed`]: on } });
  },

  toggleFocus() {
    const both = document.body.classList.contains('left-collapsed') && document.body.classList.contains('right-collapsed');
    document.body.classList.toggle('left-collapsed', !both);
    document.body.classList.toggle('right-collapsed', !both);
    $('#left').classList.toggle('collapsed', !both);
    $('#right').classList.toggle('collapsed', !both);
    $('#btnFocus').classList.toggle('on', !both);
    persistSettings({ ui: { ...S.settings.ui, leftCollapsed: !both, rightCollapsed: !both } });
  },

  showTab(side, tab) {
    if ($(`#${side}`).classList.contains('collapsed')) this.setCollapsed(side, false);
    const panel = $(`#${side}`);
    panel.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    panel.querySelectorAll('.tab').forEach((s) => s.classList.toggle('on', s.dataset.tab === tab));
  },

  bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's' && e.shiftKey) { e.preventDefault(); this.saveAs(); }
      else if (k === 's') { e.preventDefault(); this.save(); }
      else if (k === 'o') { e.preventDefault(); this.open(); }
      else if (k === 'f' || k === 'h') { e.preventDefault(); Editor.openFind(); }
      else if (k === 'e' && e.shiftKey) { e.preventDefault(); Export.open(); }
      else if (e.key === '[') { e.preventDefault(); this.setCollapsed('left', !$('#left').classList.contains('collapsed')); }
      else if (e.key === ']') { e.preventDefault(); this.setCollapsed('right', !$('#right').classList.contains('collapsed')); }
      else if (e.key === '\\') { e.preventDefault(); this.toggleFocus(); }
    });
  },
};

window.addEventListener('DOMContentLoaded', () => App.init().catch((e) => {
  console.error(e);
  toast(`Startup error: ${e.message}`, true, 10000);
}));
