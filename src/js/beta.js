// =============================================================================
// beta.js — Beta readers
// -----------------------------------------------------------------------------
// Ask the AI to read a passage, a chapter, several chapters in a row, or the
// whole manuscript AS a particular kind of reader and report honest reactions. The reply lands in the AI desk like any message, so
// you can ask follow-up questions. The passage itself is sent only with that
// one request (not resent with every later message).
// =============================================================================

const Beta = {
  PRESETS: [
    { name: 'First-time reader', desc: 'An ordinary reader who picked this book up in a shop. Knows nothing beyond what is on the page; reads for enjoyment.' },
    { name: 'Genre fan', desc: 'Reads 50+ books a year in this book\'s genre. Knows the tropes, spots clichés instantly, wants pace, tension and payoff.' },
    { name: 'Literary agent', desc: 'A busy literary agent reading a submission. Decides quickly whether to keep reading: is the voice distinctive, are the stakes clear, is it marketable, where did attention slip?' },
    { name: 'Developmental editor', desc: 'Looks at the big picture: structure, stakes, character motivation and arcs, pacing, and whether every scene earns its place.' },
    { name: 'Line critic', desc: 'A sharp critique-group member who notices clunky sentences, repetition, filter words, unclear pronouns and confusing moments, line by line.' },
    { name: 'Accuracy checker', desc: 'Checks period, technical, legal, medical, military and geographic details for plausibility; flags anything a knowledgeable reader would trip over.' },
  ],

  MAX_CHARS: 400000, // about 100,000 words: more than one read should hold

  // The book's chapters with their positions (they sit end to end in the text).
  chapters() {
    const text = Editor.text;
    const model = ChapterOps.parse(text, ChapterOps.detectLevel(text));
    let pos = model.preamble.length;
    return model.chapters.map((c) => {
      const ch = { title: c.title, start: pos, end: pos + c.raw.length };
      pos = ch.end;
      ch.words = countWords(text.slice(ch.start, ch.end).replace(/<!--[\s\S]*?-->/g, ''));
      return ch;
    });
  },

  personas() {
    return [...this.PRESETS, ...(S.settings.personas || [])];
  },

  open() {
    if (!S.settings.providers.length) { toast('Add an AI provider in Settings first', true); return Settings.open(); }
    const ps = this.personas();
    const sel = el('select', {}, ...ps.map((p, i) => el('option', { value: i }, p.name)));
    const desc = el('textarea', { rows: 3, style: 'width:100%' });
    const pick = () => { desc.value = ps[+sel.value].desc; };
    sel.addEventListener('change', pick);
    pick();
    const s = Editor.selection();
    const chs = this.chapters();
    const scope = el('select', {},
      el('option', { value: 'selection', disabled: s.end <= s.start }, `Selected text${s.end > s.start ? ` (${countWords(s.text).toLocaleString()} words)` : ' (nothing selected)'}`),
      el('option', { value: 'chapter' }, 'Chapter / scene at the cursor'),
      el('option', { value: 'chapters', disabled: chs.length < 2 }, `Several chapters in a row${chs.length < 2 ? ' (needs 2+ chapters)' : ''}`),
      el('option', { value: 'book' }, `The whole manuscript (${countWords(Editor.text).toLocaleString()} words)`));
    scope.value = s.end > s.start ? 'selection' : 'chapter';
    // From … through … (consecutive chapters)
    const here = Math.max(0, chs.findIndex((c) => Editor.ta.selectionStart >= c.start && Editor.ta.selectionStart < c.end));
    const chOpt = (c, i) => el('option', { value: i }, `${i + 1}. ${snippet(c.title, 48)}`);
    const from = el('select', { style: 'flex:1;min-width:0' }, ...chs.map(chOpt));
    const thru = el('select', { style: 'flex:1;min-width:0' }, ...chs.map(chOpt));
    from.value = String(here);
    thru.value = String(Math.min(chs.length - 1, here + 1));
    const info = el('div', { class: 'hint' });
    const rangeRow = el('div', { class: 'field beta-range' },
      el('label', {}, 'Chapters'),
      el('div', { style: 'display:flex;gap:8px;align-items:center' }, el('span', { class: 'muted' }, 'From'), from, el('span', { class: 'muted' }, 'through'), thru),
      info);
    const refresh = () => {
      rangeRow.style.display = scope.value === 'chapters' ? '' : 'none';
      if (+thru.value < +from.value) thru.value = from.value; // keep the range in order
      const a = +from.value, b = +thru.value;
      const words = chs.slice(a, b + 1).reduce((n, c) => n + c.words, 0);
      const chars = chs[a] ? chs[b].end - chs[a].start : 0;
      info.textContent = `${b - a + 1} chapter${b === a ? '' : 's'} · ${words.toLocaleString()} words`
        + (chars > this.MAX_CHARS ? ' · too long for one read: choose fewer chapters' : words > 40000 ? ' · a long read: slower, and costs more on a paid AI' : '');
      info.style.color = chars > this.MAX_CHARS ? 'var(--bad)' : '';
    };
    [scope, from, thru].forEach((x) => x.addEventListener('change', refresh));
    from.addEventListener('change', () => { if (+thru.value < +from.value) thru.value = from.value; refresh(); });
    refresh();
    const focus = el('input', { style: 'width:100%', placeholder: 'Optional: what should they look out for? e.g. "Is the twist too obvious?"' });
    const f = (label, input) => el('div', { class: 'field' }, el('label', {}, label), input);
    openModal({
      title: '👥 Beta reader',
      body: el('div', {},
        f('Reader', sel), f('Who they are', desc), f('Read', scope), rangeRow, f('Focus', focus),
        el('p', { class: 'muted', style: 'font-size:12px' }, 'Edit "Who they are" to make your own reader; "Save as new reader" keeps it for next time.')),
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Save as new reader',
          onClick: async () => {
            const name = await promptModal('Name this reader', '', '');
            if (!name) return false;
            await persistSettings({ personas: [...(S.settings.personas || []), { name, desc: desc.value }] });
            toast(`Saved "${name}"`);
            return false;
          },
        },
        { label: 'Ask for a read', accent: true, onClick: () => this.run(ps[+sel.value].name, desc.value, scope.value, focus.value, { from: +from.value, thru: +thru.value }) },
      ],
    });
  },

  async run(name, desc, scope, focus, span = {}) {
    let range;
    if (scope === 'selection') {
      const s = Editor.selection();
      if (s.end <= s.start) return toast('Highlight the text first.', true);
      range = { start: s.start, end: s.end, label: 'the selected passage' };
    } else if (scope === 'chapters') {
      const chs = this.chapters();
      const a = Math.max(0, Math.min(span.from ?? 0, chs.length - 1));
      const b = Math.max(a, Math.min(span.thru ?? a, chs.length - 1));
      if (!chs.length) return toast('No chapters found. Chapters come from your # or ## headings.', true);
      range = {
        start: chs[a].start, end: chs[b].end, multi: b > a,
        label: b > a ? `chapters ${a + 1}–${b + 1} (“${chs[a].title}” through “${chs[b].title}”)` : `“${chs[a].title}”`,
      };
    } else if (scope === 'book') {
      range = { start: 0, end: Editor.text.length, multi: true, label: 'the whole manuscript' };
    } else {
      const r = Editor.sectionRange(Editor.ta.selectionStart);
      range = r ? { start: r.start, end: r.end, label: `“${r.title}”` } : { start: 0, end: Editor.text.length, label: 'the manuscript' };
    }
    const text = Editor.text.slice(range.start, range.end).replace(/<!--[\s\S]*?-->/g, '');
    if (text.length > this.MAX_CHARS) return toast(`That's about ${countWords(text).toLocaleString()} words, too long for one read. Choose fewer chapters.`, true, 7000);
    const system = `You are a beta reader for an author using the app Crucible. Stay fully in character as this reader:

${name.toUpperCase()}: ${desc}

Read the passage and give honest, specific reactions as that reader. Be kind but candid: the author wants the truth, not praise. Quote short phrases (a few words) so the author can find the spots you mean.

Structure your answer:
1. Overall impression (2–3 sentences)
2. Where I was hooked
3. Where my attention drifted
4. What confused me or pulled me out of the story
5. Questions I'm left with as a reader
6. Would I keep reading? Why or why not?${range.multi ? `

You are reading several chapters in a row, in order. Read them as one continuous stretch of the book, and also cover:
7. How it flows from chapter to chapter: momentum, transitions, where I wanted to put the book down or couldn't
8. Threads set up in one chapter and dropped, repeated or paid off later
9. A one-line reaction to each chapter, in order (use the chapter titles)` : ''}
Do not rewrite the text.`;
    const display = `👥 ${name} reads ${range.label} (${countWords(text).toLocaleString()} words)${focus ? `\nFocus: ${focus}` : ''}`;
    const payload = `${focus ? `What to look out for: ${focus}\n\n` : ''}<passage>\n${text}\n</passage>`;
    App.showTab('right', 'ai');
    await AI.ask({ display, payload, system, by: name });
  },
};
