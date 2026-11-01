// =============================================================================
// speech.js — Read aloud
// -----------------------------------------------------------------------------
// Uses the computer's built-in voices (the browser's speech synthesis), so it's
// free and works offline with local voices. Reads one sentence at a time and
// highlights it in the manuscript; Markdown symbols, hidden comments and image
// lines are skipped. Typing stops the reading (so it never reads stale text).
// =============================================================================

const Speech = {
  get supported() { return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'; },
  queue: [],
  i: 0,
  active: false,
  paused: false,

  init() {
    $('#rdPause').addEventListener('click', () => this.togglePause());
    $('#rdStop').addEventListener('click', () => this.stop());
    $('#rdRate').addEventListener('change', (e) => persistSettings({ ui: { ...S.settings.ui, speechRate: +e.target.value } }));
    $('#rdVoice').addEventListener('change', (e) => persistSettings({ ui: { ...S.settings.ui, speechVoice: e.target.value } }));
    $('#stRead').addEventListener('click', () => this.fromCursor());
    Editor.ta.addEventListener('input', () => { if (this.active) this.stop('Stopped reading because the text changed.'); });
    if (this.supported) {
      this.loadVoices();
      speechSynthesis.addEventListener?.('voiceschanged', () => this.loadVoices());
    }
  },

  loadVoices() {
    const sel = $('#rdVoice');
    const voices = speechSynthesis.getVoices();
    sel.innerHTML = '';
    sel.append(el('option', { value: '' }, 'Default voice'));
    voices.forEach((v) => sel.append(el('option', { value: v.name }, `${v.name}${v.localService ? '' : ' (online)'}`)));
    sel.value = S.settings?.ui.speechVoice || '';
    $('#rdRate').value = String(S.settings?.ui.speechRate || 1);
  },

  // Plain spoken text for a stretch of Markdown.
  clean(s) {
    return s.replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^:::.*$/gm, ' ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/[*_`~]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  },

  // Sentence ranges in [start, end), as offsets into the manuscript.
  sentences(text, start, end) {
    const out = [];
    const re = /[^.!?…\n]+(?:[.!?…]+["”’')\]]*|\n|$)/g;
    re.lastIndex = start;
    let m;
    while ((m = re.exec(text)) && m.index < end) {
      if (!m[0].length) { re.lastIndex++; continue; }
      let a = m.index, b = Math.min(end, m.index + m[0].length);
      while (a < b && /\s/.test(text[a])) a++;
      while (b > a && /\s/.test(text[b - 1])) b--;
      if (b > a && this.clean(text.slice(a, b))) out.push([a, b]);
    }
    return out;
  },

  fromCursor() {
    const s = Editor.selection();
    if (s.end > s.start) return this.read(s.start, s.end);
    const p = TextOps.paragraphAt(Editor.text, s.start);
    return this.read(p.start, Editor.text.length);
  },

  read(start, end) {
    if (!this.supported) return toast('This browser has no built-in voices. Try Edge or Chrome on Windows.', true, 6000);
    this.stop();
    this.queue = this.sentences(Editor.text, start, end);
    if (!this.queue.length) return toast('Nothing to read there.');
    this.i = 0;
    this.active = true;
    this.paused = false;
    $('#readBar').classList.remove('hidden');
    $('#rdPause').textContent = '❚❚ Pause';
    this.next();
  },

  next() {
    if (!this.active) return;
    if (this.i >= this.queue.length) return this.stop('Finished reading.');
    const [a, b] = this.queue[this.i];
    Editor.reveal(a, b);
    $('#rdInfo').textContent = `Sentence ${this.i + 1} of ${this.queue.length}`;
    const u = new SpeechSynthesisUtterance(this.clean(Editor.text.slice(a, b)));
    const v = speechSynthesis.getVoices().find((x) => x.name === S.settings.ui.speechVoice);
    if (v) u.voice = v;
    u.rate = S.settings.ui.speechRate || 1;
    u.onend = () => { if (this.active && this.utter === u) { this.i++; this.next(); } };
    u.onerror = (e) => { if (this.active && this.utter === u && e.error !== 'interrupted' && e.error !== 'canceled') this.stop(`Speech stopped: ${e.error}`); };
    this.utter = u;
    speechSynthesis.speak(u);
  },

  togglePause() {
    if (!this.active) return;
    if (this.paused) { speechSynthesis.resume(); this.paused = false; $('#rdPause').textContent = '❚❚ Pause'; }
    else { speechSynthesis.pause(); this.paused = true; $('#rdPause').textContent = '▶ Resume'; }
  },

  stop(msg) {
    const was = this.active;
    this.active = false;
    this.utter = null;
    if (this.supported) speechSynthesis.cancel();
    $('#readBar').classList.add('hidden');
    if (was && msg) toast(msg);
  },
};
