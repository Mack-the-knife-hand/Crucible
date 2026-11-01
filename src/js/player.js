// =============================================================================
// player.js — built-in music player
// -----------------------------------------------------------------------------
// Plays files straight from where they live on your disk (MP3, M4A, OGG, WAV,
// FLAC, AAC). The playlist is a list of file paths saved in Crucible's global
// settings, so it's there no matter which book you open.
// =============================================================================

const Player = {
  audio: null,
  index: -1,
  currentPath: null,
  shuffle: false,
  repeat: false,
  seeking: false,

  init() {
    const a = (this.audio = $('#audio'));
    a.volume = S.settings.volume ?? 0.7;
    $('#plVol').value = a.volume;

    $('#plPlay').onclick = () => this.toggle();
    $('#plNext').onclick = () => this.next();
    $('#plPrev').onclick = () => (a.currentTime > 3 ? (a.currentTime = 0) : this.prev());
    $('#plShuffle').onclick = (e) => { this.shuffle = !this.shuffle; e.currentTarget.classList.toggle('on', this.shuffle); };
    $('#plRepeat').onclick = (e) => { this.repeat = !this.repeat; e.currentTarget.classList.toggle('on', this.repeat); };
    $('#plVol').oninput = (e) => { a.volume = +e.target.value; };
    $('#plVol').onchange = (e) => persistSettings({ volume: +e.target.value });
    $('#plListBtn').onclick = () => { $('#playlistPanel').classList.toggle('hidden'); this.render(); };
    $('#plAddFiles').onclick = async () => this.addPaths(await window.crucible.pickSongs());
    $('#plAddFolder').onclick = async () => this.addPaths(await window.crucible.pickMusicFolder());
    $('#plClear').onclick = async () => {
      if (await confirmModal('Clear playlist', 'Remove every song from the playlist? (Files on disk are untouched.)', 'Clear')) {
        await persistSettings({ playlist: [] });
        this.render();
      }
    };

    const seek = $('#plSeek');
    seek.addEventListener('input', () => { this.seeking = true; $('#plCur').textContent = fmtTime((seek.value / 1000) * a.duration); });
    seek.addEventListener('change', () => { a.currentTime = (seek.value / 1000) * a.duration; this.seeking = false; });
    a.addEventListener('timeupdate', () => {
      if (!this.seeking && a.duration) seek.value = (a.currentTime / a.duration) * 1000;
      if (!this.seeking) $('#plCur').textContent = fmtTime(a.currentTime);
    });
    a.addEventListener('loadedmetadata', () => ($('#plDur').textContent = fmtTime(a.duration)));
    a.addEventListener('play', () => ($('#plPlay').textContent = '❚❚'));
    a.addEventListener('pause', () => ($('#plPlay').textContent = '▶'));
    a.addEventListener('ended', () => (this.repeat ? (a.currentTime = 0, a.play()) : this.next()));
    a.addEventListener('error', () => { if (a.getAttribute('src')) toast(`Can't play ${$('#plTitle').textContent} — file missing or unsupported`, true); });

    // Space bar = play/pause when you're not typing somewhere.
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement.tagName)) {
        e.preventDefault(); this.toggle();
      }
    });
  },

  list() { return S.settings.playlist || []; },

  async addPaths(paths) {
    if (!paths.length) return;
    const existing = new Set(this.list().map((s) => s.path));
    const added = paths.map(asPick).filter((p) => !existing.has(p.path))
      .map((p) => ({ path: p.path, name: p.name.replace(/\.(mp3|m4a|ogg|wav|flac|aac)$/i, '') }));
    await persistSettings({ playlist: [...this.list(), ...added] });
    this.render();
    toast(`Added ${added.length} song(s)`);
  },

  load(i) {
    const s = this.list()[i];
    if (!s) return;
    this.index = i;
    this.playPath(s.path, s.name);
  },

  async playPath(p, name) {
    this.currentPath = p;
    const i = this.list().findIndex((s) => s.path === p);
    if (i !== -1) this.index = i;
    $('#plTitle').textContent = name || baseName(p);
    this.render();
    try {
      this.audio.src = await mediaUrl(p);
    } catch (e) {
      return toast(`Can't play ${name || 'that song'}: ${e.message}`, true, 5000);
    }
    this.audio.play().catch(() => {});
  },

  toggle() {
    if (!this.audio.src) { if (this.list().length) this.load(0); return; }
    this.audio.paused ? this.audio.play() : this.audio.pause();
  },

  next() {
    const n = this.list().length;
    if (!n) return;
    const i = this.shuffle ? Math.floor(Math.random() * n) : (this.index + 1) % n;
    this.load(i);
  },

  prev() {
    const n = this.list().length;
    if (!n) return;
    this.load((this.index - 1 + n) % n);
  },

  async removeAt(i) {
    const pl = [...this.list()];
    pl.splice(i, 1);
    await persistSettings({ playlist: pl });
    this.render();
  },

  async move(i, d) {
    const pl = [...this.list()];
    const j = i + d;
    if (j < 0 || j >= pl.length) return;
    [pl[i], pl[j]] = [pl[j], pl[i]];
    await persistSettings({ playlist: pl });
    this.render();
  },

  render() {
    const box = $('#playlist');
    if ($('#playlistPanel').classList.contains('hidden')) return;
    box.innerHTML = '';
    if (!this.list().length) {
      box.append(el('div', { class: 'empty' }, window.crucible.platform === 'web' && window.crucible.storageMode === 'browser' ? 'Add songs to play. In this browser they can only be remembered for the current session.' : 'Add songs or a whole music folder. They play from where they are — nothing is copied.'));
      return;
    }
    this.list().forEach((s, i) => box.append(el('div', {
      class: `pl-item ${s.path === this.currentPath ? 'cur' : ''}`, title: window.crucible.platform === 'web' ? s.name : s.path, ondblclick: () => this.load(i),
    },
    el('span', { class: 'nm', onclick: () => this.load(i) }, s.name),
    el('button', { class: 'ghost', title: 'Move up', onclick: () => this.move(i, -1) }, '↑'),
    el('button', { class: 'ghost', title: 'Move down', onclick: () => this.move(i, 1) }, '↓'),
    el('button', { class: 'ghost danger', title: 'Remove', onclick: () => this.removeAt(i) }, '✕'))));
  },
};
