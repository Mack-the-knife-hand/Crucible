// =============================================================================
// beta.js — Beta readers
// -----------------------------------------------------------------------------
// Ask the AI to read a passage or chapter AS a particular kind of reader and
// report honest reactions. The reply lands in the AI desk like any message, so
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
    const scope = el('select', {},
      el('option', { value: 'selection', disabled: s.end <= s.start }, `Selected text${s.end > s.start ? ` (${countWords(s.text).toLocaleString()} words)` : ' (nothing selected)'}`),
      el('option', { value: 'chapter' }, 'Chapter / scene at the cursor'));
    scope.value = s.end > s.start ? 'selection' : 'chapter';
    const focus = el('input', { style: 'width:100%', placeholder: 'Optional: what should they look out for? e.g. "Is the twist too obvious?"' });
    const f = (label, input) => el('div', { class: 'field' }, el('label', {}, label), input);
    openModal({
      title: '👥 Beta reader',
      body: el('div', {},
        f('Reader', sel), f('Who they are', desc), f('Read', scope), f('Focus', focus),
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
        { label: 'Ask for a read', accent: true, onClick: () => this.run(ps[+sel.value].name, desc.value, scope.value, focus.value) },
      ],
    });
  },

  async run(name, desc, scope, focus) {
    let range;
    if (scope === 'selection') {
      const s = Editor.selection();
      if (s.end <= s.start) return toast('Highlight the text first.', true);
      range = { start: s.start, end: s.end, label: 'the selected passage' };
    } else {
      const r = Editor.sectionRange(Editor.ta.selectionStart);
      range = r ? { start: r.start, end: r.end, label: `“${r.title}”` } : { start: 0, end: Editor.text.length, label: 'the manuscript' };
    }
    const text = Editor.text.slice(range.start, range.end).replace(/<!--[\s\S]*?-->/g, '');
    if (text.length > 400000) return toast('That\'s too long for one read. Select a chapter or a few scenes.', true, 6000);
    const system = `You are a beta reader for an author using the app Crucible. Stay fully in character as this reader:

${name.toUpperCase()}: ${desc}

Read the passage and give honest, specific reactions as that reader. Be kind but candid: the author wants the truth, not praise. Quote short phrases (a few words) so the author can find the spots you mean.

Structure your answer:
1. Overall impression (2–3 sentences)
2. Where I was hooked
3. Where my attention drifted
4. What confused me or pulled me out of the story
5. Questions I'm left with as a reader
6. Would I keep reading? Why or why not?
Do not rewrite the text.`;
    const display = `👥 ${name} reads ${range.label} (${countWords(text).toLocaleString()} words)${focus ? `\nFocus: ${focus}` : ''}`;
    const payload = `${focus ? `What to look out for: ${focus}\n\n` : ''}<passage>\n${text}\n</passage>`;
    App.showTab('right', 'ai');
    await AI.ask({ display, payload, system, by: name });
  },
};
