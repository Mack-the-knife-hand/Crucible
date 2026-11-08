// =============================================================================
// highlights.js — coloured passages in the writing area
// -----------------------------------------------------------------------------
// Passages with a linked picture stay light purple, passages with a margin
// note orange, passages with a linked song light green.
//
// How: the editor is a plain <textarea> (fast on a whole novel, exact
// character positions, native spell check and undo), and a textarea can't
// colour parts of its own text. So a "backdrop" layer sits behind it: the
// same text, in the same font, size, padding and line wrapping, but with the
// text itself invisible. Only coloured <mark>s under the linked passages
// show through the transparent textarea. The backdrop scrolls with the
// textarea and is rebuilt shortly after each edit, using the same live
// ranges that keep links and notes attached to their words.
// =============================================================================

const Highlights = {
  KINDS: { image: 'hl-img', note: 'hl-note', song: 'hl-song' },

  init() {
    this.ta = $('#editor');
    this.pane = $('#editorPane');
    this.back = el('div', { id: 'hlBackdrop', 'aria-hidden': 'true' }, el('div', { class: 'hl-inner' }));
    this.inner = this.back.firstChild;
    this.pane.prepend(this.back);
    // Rebuild once you pause typing; a little later on very long books (a
    // full novel takes ~0.1 s to lay out), so it never interrupts a burst.
    const quick = debounce(() => this.render(), 120), slow = debounce(() => this.render(), 450);
    this.refresh = () => (this.ta.value.length > 300000 ? slow : quick)();
    Bus.on('textChange', () => this.refresh());
    Bus.on('relocate', () => this.refresh());
    this.ta.addEventListener('scroll', () => this.sync());
    // Size or wrapping changes: window resize, panel toggles, font size.
    if (window.ResizeObserver) new ResizeObserver(() => this.refresh()).observe(this.ta);
    else window.addEventListener('resize', () => this.refresh());
  },

  previewOn: undefined, // Settings' live preview of the on/off switch
  enabled() { return this.previewOn ?? S.settings?.ui?.highlightLinked !== false; },

  // Every highlighted range, as { start, end, kind }.
  ranges() {
    const out = [];
    const len = this.ta.value.length;
    const add = (r, kind) => {
      if (r && !r.missing && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start) {
        out.push({ start: Math.max(0, r.start), end: Math.min(len, r.end), kind });
      }
    };
    for (const l of S.project?.links || []) add(l, l.kind === 'song' ? 'song' : 'image');
    for (const n of S.project?.notes || []) if (!n.resolved) add(n, 'note');
    return out.filter((r) => r.end > r.start);
  },

  render() {
    if (!this.back) return;
    const rs = this.enabled() ? this.ranges() : [];
    this.back.classList.toggle('hidden', !rs.length);
    if (!rs.length) { this.inner.textContent = ''; return; }
    this.matchBox();
    // Cut the text at every range edge; each piece knows which kinds cover it.
    const text = this.ta.value;
    const cuts = new Set([0, text.length]);
    for (const r of rs) { cuts.add(r.start); cuts.add(r.end); }
    const pts = [...cuts].sort((a, b) => a - b);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const piece = text.slice(a, b);
      const kinds = [...new Set(rs.filter((r) => r.start <= a && r.end >= b).map((r) => r.kind))];
      if (!kinds.length) { frag.append(document.createTextNode(piece)); continue; }
      const m = document.createElement('mark');
      m.className = kinds.map((k) => this.KINDS[k]).join(' ');
      if (kinds.length > 1) m.classList.add(`hl-${kinds.length}`);
      m.textContent = piece;
      frag.append(m);
    }
    // A trailing newline needs something after it to take up a line.
    frag.append(document.createTextNode('​'));
    this.inner.replaceChildren(frag);
    this.sync();
  },

  // Copy everything that affects where text wraps from the textarea.
  matchBox() {
    const cs = getComputedStyle(this.ta);
    const s = this.back.style;
    s.width = `${this.ta.clientWidth}px`;   // without the scrollbar
    s.height = `${this.ta.clientHeight}px`;
    s.left = `${this.ta.offsetLeft + this.ta.clientLeft}px`;
    s.top = `${this.ta.offsetTop + this.ta.clientTop}px`;
    const i = this.inner.style;
    for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
      'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'textIndent', 'textTransform', 'fontVariantLigatures', 'fontKerning']) i[p] = cs[p];
  },

  sync() {
    if (this.inner) this.inner.style.transform = `translateY(${-this.ta.scrollTop}px)`;
  },
};
