// =============================================================================
// prose.js — Prose pass: correct the prose across a large stretch of the book
// -----------------------------------------------------------------------------
// Rewriting a whole chapter in one AI reply doesn't work well: replies have a
// length limit, and one giant "replace everything" card is impossible to
// review. So a prose pass:
//   1. splits the chosen text (selection / chapter / whole book) into
//      sections of whole paragraphs (~4,000 characters each),
//   2. sends each section to the AI in turn, asking for CORRECTIONS ONLY
//      (find → replace, with a short reason),
//   3. lists every correction as a card you can Accept, Skip or Revert.
//
// Each correction is anchored to its exact place in the manuscript and kept in
// place as you keep editing (same tracking as the change pool), so you can
// review at your own pace, even after closing and reopening the book. The pass
// is saved in the book's project.json; a stopped or failed pass can resume.
// =============================================================================

const Prose = {
  CHUNK_CHARS: 4000,     // target section size sent per request
  CONTEXT_CHARS: 600,    // preceding text shown to the AI for continuity
  SHOW_MAX: 300,         // cards drawn at once (the rest summarised)
  running: false,
  stopRequested: false,

  LEVELS: {
    proofread: {
      label: 'Proofread',
      desc: 'Spelling, grammar, punctuation, typos, missing or doubled words. Leaves your style alone.',
      rules: 'Fix ONLY objective errors: spelling, grammar, punctuation, typos, missing or doubled words, wrong-word mix-ups (their/there, its/it\'s). Do not change word choice, style or rhythm.',
    },
    copyedit: {
      label: 'Copy edit',
      desc: 'Proofread, plus awkward or unclear sentences, tense/POV slips and clumsy repetition.',
      rules: 'Fix objective errors (spelling, grammar, punctuation, typos), plus: genuinely awkward or unclear sentences, accidental tense or point-of-view slips, clumsy repetition of the same word close together, and inconsistent spelling or capitalisation of names and terms. Keep changes as small as possible.',
    },
    continuity: {
      label: 'Continuity check',
      desc: 'Reads front to back and flags contradictions with your story memory and with earlier chapters: names, ages, looks, dates, places, who knows what. Suggests a fix where it can. Story memory is always used.',
      rules: '',
    },
    line: {
      label: 'Line edit (tighten)',
      desc: 'Copy edit, plus tightening wordy sentences, sharper verbs and better rhythm. Meaning unchanged.',
      rules: 'Everything a copy edit fixes, plus: tighten wordy or flabby sentences, prefer strong specific verbs over weak verb + adverb, cut filler and redundancy, and improve sentence rhythm. Never change meaning, plot facts, or what characters know, and never add new content.',
    },
  },

  // ---------------------------------------------------------------- state --
  state() {
    if (!S.project.prose) S.project.prose = { items: [], chunks: [], level: 'proofread', instructions: '', useMemory: false };
    return S.project.prose;
  },
  items() { return S.project.prose ? S.project.prose.items : []; },

  init() {
    // Suggestions and unfinished sections follow your edits like pool items.
    trackAnchors(() => {
      const p = S.project.prose;
      if (!p) return [];
      return [...p.items.filter((i) => i.anchored), ...p.chunks];
    }, debounce(() => this.render(), 300));

    const lv = $('#proseLevel');
    for (const [k, v] of Object.entries(this.LEVELS)) lv.append(el('option', { value: k }, v.label));
    lv.addEventListener('change', () => {
      this.state().level = lv.value;
      if (lv.value === 'continuity' && $('#proseScope').value === 'selection' && Editor.selection().end === Editor.selection().start) $('#proseScope').value = 'book';
      markDirty(true);
      this.renderSetup();
    });
    $('#proseInstr').addEventListener('change', (e) => { this.state().instructions = e.target.value; markDirty(true); });
    $('#proseMemory').addEventListener('change', (e) => { this.state().useMemory = e.target.checked; markDirty(true); });
    $('#proseScope').addEventListener('change', () => this.renderSetup());
    $('#proseStart').addEventListener('click', () => this.start());
    $('#proseFilter').addEventListener('change', () => this.render());
    $('#proseAcceptAll').addEventListener('click', () => this.acceptAll());
    $('#proseClear').addEventListener('click', () => this.clear());
    Bus.on('caret', debounce(() => this.renderSetup(), 200));
  },

  // Open the Prose pass tab ready to run on the selection or chapter.
  openFor(scope) {
    App.showTab('right', 'prose');
    $('#proseScope').value = scope;
    this.renderSetup();
  },

  // -------------------------------------------------------------- scopes --
  resolveScope(kind = $('#proseScope').value) {
    const t = Editor.text;
    if (kind === 'selection') {
      const s = Editor.selection();
      if (s.end - s.start < 2) return null;
      return { start: s.start, end: s.end, label: 'Selected text' };
    }
    if (kind === 'chapter') {
      const r = Editor.sectionRange(Editor.ta.selectionStart);
      return r ? { start: r.start, end: r.end, label: r.title } : { start: 0, end: t.length, label: 'Whole book' };
    }
    return { start: 0, end: t.length, label: 'Whole book' };
  },

  makeChunks({ start, end }) {
    const text = Editor.text;
    // Paragraph spans (blank-line separated) inside the scope.
    const paras = [];
    let i = start;
    while (i < end) {
      let j = text.indexOf('\n\n', i);
      if (j === -1 || j > end) j = end;
      if (text.slice(i, j).trim()) paras.push(...this.splitLong(text, i, j));
      i = j;
      while (i < end && text[i] === '\n') i++;
    }
    const out = [];
    let cur = null;
    for (const [a, b] of paras) {
      if (!cur) cur = { start: a, end: b };
      else if (b - cur.start > this.CHUNK_CHARS) { out.push(cur); cur = { start: a, end: b }; }
      else cur.end = b;
    }
    if (cur) out.push(cur);
    return out.map((c) => ({ ...c, text: text.slice(c.start, c.end), status: 'pending' }));
  },

  // A single enormous paragraph is split at sentence ends.
  splitLong(text, a, b) {
    const max = this.CHUNK_CHARS * 2;
    if (b - a <= max) return [[a, b]];
    const out = [];
    let s = a;
    while (b - s > max) {
      const slice = text.slice(s, s + this.CHUNK_CHARS);
      const m = [...slice.matchAll(/[.!?]["”’']?\s+/g)].pop();
      const cut = m ? s + m.index + m[0].length : s + this.CHUNK_CHARS;
      out.push([s, cut]);
      s = cut;
    }
    out.push([s, b]);
    return out;
  },

  // ------------------------------------------------------------- running --
  async start() {
    if (this.running) return;
    if (!S.settings.providers.length) { toast('Add an AI provider in Settings first', true); return Settings.open(); }
    const scope = this.resolveScope();
    if (!scope) return toast('Highlight the text to correct first (or choose Chapter / Whole book).', true);
    const st = this.state();
    const pending = st.items.filter((i) => i.status === 'pending').length;
    if (pending && !(await confirmModal('Start a new prose pass?', `${pending} suggestion(s) from the last pass haven't been reviewed. Starting a new pass clears them (accepted changes stay in your book).`, 'Start new pass'))) return;
    const chunks = this.makeChunks(scope);
    if (!chunks.length) return toast('Nothing to correct there.', true);
    if (chunks.length > 25 && !(await confirmModal('Large prose pass',
      `${scope.label}: about ${countWords(Editor.text.slice(scope.start, scope.end)).toLocaleString()} words in ${chunks.length} sections, so ${chunks.length} AI requests. On a paid AI this costs more than a normal message, and it will take a while. You can stop at any time and resume later.`, 'Go ahead'))) return;
    Object.assign(st, {
      items: [], chunks, scopeLabel: scope.label, level: $('#proseLevel').value,
      instructions: $('#proseInstr').value, useMemory: $('#proseMemory').checked,
      startedAt: Date.now(), finishedAt: null, error: null, facts: '',
    });
    markDirty(true);
    $('#proseFilter').value = 'pending';
    this.run();
  },

  stop() { this.stopRequested = true; this.renderStatus(); },

  async systemPrompt(st) {
    const lv = this.LEVELS[st.level] || this.LEVELS.proofread;
    if (st.level === 'continuity') return this.continuityPrompt(st);
    const parts = [`You are a meticulous ${lv.label.toLowerCase()} editor working on a novelist's manuscript in the app Crucible. You receive ONE section of the book at a time. Report corrections only; never rewrite the whole section.

WHAT TO FIX
${lv.rules}
${st.instructions ? `\nAUTHOR'S INSTRUCTIONS (follow these)\n${st.instructions}\n` : ''}
ALWAYS
- Preserve the author's voice, tense, point of view and meaning.
- Leave dialect, slang, period-appropriate language and deliberate fragments in dialogue alone unless they are clearly typos.
- Don't change Markdown markup (#, >, *, ***, ::: alignment lines, <!-- hidden comments -->) and don't "fix" names that are spelled consistently.

FORMAT: one block per correction, and nothing else:
<change>
<find>exact text copied from the section</find>
<replace>corrected text</replace>
<why>a few words</why>
</change>
- <find> must be copied character-for-character from the section (same quotes, dashes and spacing). Keep it short but unique: usually the sentence or clause containing the problem. Never span two paragraphs.
- Combine several fixes in the same sentence into one block.
- If the section needs no changes, reply exactly: <none/>`];
    if (st.useMemory) {
      const mem = await Memory.buildContext();
      if (mem.text) parts.push(`STORY MEMORY (reference: names, places, style)\n\n${mem.text}`);
    }
    return parts.join('\n\n---\n\n');
  },

  userPrompt(ch, n, total) {
    const before = Editor.text.slice(Math.max(0, ch.start - this.CONTEXT_CHARS), ch.start).trim();
    const st = this.state();
    const facts = st.level === 'continuity'
      ? `<facts_so_far>\n${st.facts || '(none yet: this is the first section)'}\n</facts_so_far>\n\n` : '';
    return `${facts}${before ? `<context_before>(for reference only, do not edit)\n…${before}\n</context_before>\n\n` : ''}<section n="${n} of ${total}">\n${ch.text}\n</section>`;
  },

  // ---- continuity check
  FACTS_MAX: 20000,

  async continuityPrompt(st) {
    const parts = [`You are a continuity editor for a novel being written in the app Crucible. You read the book ONE section at a time, in order. With each section you get the FACTS SO FAR (established by earlier sections) and the author's STORY MEMORY (reference notes).

YOUR JOB
Find places in THIS section that contradict the story memory, the facts so far, or an earlier part of this same section: names and spellings, ages, physical descriptions, relationships, dates and the order of events, the time of day or season, places and distances, objects (who has what), injuries, and who knows what (a character acting on information they can't have yet). Ignore style and grammar. Don't flag deliberate mysteries or unreliable narration unless it looks accidental. Only report real contradictions you can point to.
${st.instructions ? `\nAUTHOR'S INSTRUCTIONS\n${st.instructions}\n` : ''}
FORMAT: for each problem:
<issue>
<find>exact text copied from the section that has the problem</find>
<problem>what it contradicts: quote or cite the earlier fact or memory note</problem>
<fix>corrected text to replace the find text (omit this tag if the author must decide)</fix>
</issue>
Then ALWAYS finish with the new facts this section establishes, one short line each (names, ages, looks, relationships, dates, places, objects, who learns what):
<facts>
- ...
</facts>
- <find> must be copied character-for-character from the section and be unique; keep it to the sentence or clause involved.
- If there are no problems, write only the <facts> block.`];
    const mem = await Memory.buildContext();
    parts.push(mem.text ? `STORY MEMORY\n\n${mem.text}` : 'STORY MEMORY\n(none: rely on the facts so far)');
    if (mem.images) parts.push(`PICTURES IN STORY MEMORY\n${mem.images}`);
    return parts.join('\n\n---\n\n');
  },

  parseContinuity(text) {
    const trim = (s) => (s || '').replace(/^\n+|\n+$/g, '');
    const out = [];
    const re = /<issue\b[^>]*>\s*<find>([\s\S]*?)<\/find>\s*<problem>([\s\S]*?)<\/problem>(?:\s*<fix>([\s\S]*?)<\/fix>)?\s*<\/issue>/gi;
    let m;
    while ((m = re.exec(text))) out.push({ find: trim(m[1]), replace: m[3] === undefined || !trim(m[3]) ? null : trim(m[3]), why: trim(m[2]), issue: true });
    const facts = (text.match(/<facts>([\s\S]*?)<\/facts>/i) || [])[1];
    return { items: out, facts: facts ? facts.split('\n').map((l) => l.trim()).filter((l) => l && l !== '-' && l !== '- ...') : [] };
  },

  addFacts(lines) {
    const st = this.state();
    const have = new Set((st.facts || '').split('\n'));
    const add = lines.map((l) => (l.startsWith('-') ? l : `- ${l}`)).filter((l) => !have.has(l));
    let facts = [st.facts, ...add].filter(Boolean).join('\n');
    if (facts.length > this.FACTS_MAX) {
      // Keep the earliest facts (the book's foundations) and the most recent.
      const head = facts.slice(0, this.FACTS_MAX * 0.4);
      const tail = facts.slice(-this.FACTS_MAX * 0.6);
      facts = `${head.slice(0, head.lastIndexOf('\n'))}\n- (…middle facts trimmed…)\n${tail.slice(tail.indexOf('\n') + 1)}`;
    }
    st.facts = facts;
  },

  parse(text) {
    const out = [];
    const trim = (s) => s.replace(/^\n+|\n+$/g, '');
    const re = /<change\b[^>]*>\s*<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>(?:\s*<why>([\s\S]*?)<\/why>)?\s*<\/change>/gi;
    let m;
    while ((m = re.exec(text))) out.push({ find: trim(m[1]), replace: trim(m[2]), why: (m[3] || '').trim() });
    return out;
  },

  async run() {
    const st = this.state();
    this.running = true;
    this.stopRequested = false;
    st.error = null;
    this.render();
    let i = 0;
    try {
      const system = await this.systemPrompt(st);
      const total = st.chunks.length;
      for (i = 0; i < total; i++) {
        const ch = st.chunks[i];
        if (ch.status === 'done' || ch.status === 'lost') continue;
        if (this.stopRequested) break;
        if (TextOps.locate(Editor.text, ch) === null) { ch.status = 'lost'; continue; } // rewritten by hand meanwhile
        ch.status = 'working';
        this.renderStatus(i);
        const res = await window.crucible.aiChat({
          providerId: $('#providerSelect').value || S.settings.activeProviderId,
          system,
          messages: [{ role: 'user', content: this.userPrompt(ch, i + 1, total) }],
          bookPath: S.path,
          imageFiles: [],
        });
        if (!res.ok) {
          ch.status = 'pending';
          st.error = `Section ${i + 1} of ${total}: ${res.error}`;
          break;
        }
        if (st.level === 'continuity') {
          const c = this.parseContinuity(res.text);
          this.addSuggestions(ch, c.items);
          this.addFacts(c.facts);
        } else this.addSuggestions(ch, this.parse(res.text));
        ch.status = 'done';
        markDirty(true);
        this.render();
      }
    } catch (e) {
      st.error = e.message;
    } finally {
      this.running = false;
      const left = st.chunks.filter((c) => c.status === 'pending' || c.status === 'working');
      left.forEach((c) => { c.status = 'pending'; });
      if (!left.length) {
        st.finishedAt = Date.now();
        st.chunks = []; // finished: no need to keep the section copies
        const n = st.items.filter((x) => x.status === 'pending').length;
        toast(n ? `Prose pass finished: ${n} suggestion(s) to review` : 'Prose pass finished: no corrections suggested', false, 5000);
      } else if (st.error) toast('Prose pass stopped by an error. Press Resume to continue from where it stopped.', true, 7000);
      markDirty(true);
      this.render();
    }
  },

  // Turn the AI's corrections for one section into anchored suggestions.
  addSuggestions(ch, list) {
    const st = this.state();
    const pos = TextOps.locate(Editor.text, ch);
    const taken = new Set(st.items.filter((x) => x.anchored).map((x) => x.start));
    const chapter = Editor.chapterAt(pos ?? ch.start);
    for (const s of list) {
      if (!s.find.trim() || s.find === s.replace) continue;
      const item = { id: uid(), find: s.find, replace: s.replace, why: s.why, issue: !!s.issue, chapter: chapter ? chapter.title : '', status: 'pending', anchored: false };
      // The same words can appear more than once in a section ("He nodded."):
      // use the next occurrence that no other correction has claimed.
      let f = null;
      if (pos !== null) {
        let off = 0;
        for (;;) {
          const hit = TextOps.findLoose(ch.text.slice(off), s.find);
          if (!hit) break;
          if (!taken.has(pos + off + hit.start)) { f = { start: off + hit.start, end: off + hit.end }; break; }
          off += hit.start + 1;
        }
      }
      if (f) {
        item.anchored = true;
        item.start = pos + f.start;
        item.end = pos + f.end;
        item.text = Editor.text.slice(item.start, item.end); // the exact words in the book
        taken.add(item.start);
      } else item.status = 'unmatched';
      st.items.push(item);
    }
  },

  // ------------------------------------------------------------ reviewing --
  // Where is this suggestion now? Returns start offset or null.
  place(item) {
    if (!item.anchored) return null;
    if (Editor.text.slice(item.start, item.end) === item.text) return item.start;
    const p = TextOps.locate(Editor.text, item);
    if (p === null) return null;
    item.start = p;
    item.end = p + item.text.length;
    return p;
  },

  accept(item, quiet = false) {
    if (item.replace == null) return false; // a flagged problem with no suggested fix
    const p = this.place(item);
    if (p === null) {
      item.status = 'stale';
      if (!quiet) { toast('That text has changed since the suggestion was made, so it can\'t be applied.', true); this.render(); }
      return false;
    }
    const original = item.text;
    Editor.replaceRange(p, p + original.length, item.replace);
    // replaceRange moved/stretched this anchor; pin it to the new words exactly.
    Object.assign(item, { start: p, end: p + item.replace.length, text: item.replace, original, status: 'accepted', missing: false });
    markDirty(true);
    if (!quiet) { this.render(); Editor.reveal(item.start, item.end); }
    return true;
  },

  revert(item) {
    const p = this.place(item);
    if (p === null) return toast('That text has changed since, so it can\'t be reverted automatically.', true);
    Editor.replaceRange(p, p + item.text.length, item.original);
    Object.assign(item, { start: p, end: p + item.original.length, text: item.original, status: 'pending' });
    markDirty(true);
    this.render();
    Editor.reveal(item.start, item.end);
  },

  skip(item) { item.status = 'skipped'; markDirty(true); this.render(); },
  unskip(item) { item.status = 'pending'; markDirty(true); this.render(); },

  show(item) {
    const p = this.place(item);
    if (p === null) return toast('Can\'t find that text any more.', true);
    Editor.reveal(item.start, item.end);
  },

  async acceptAll() {
    const pending = this.items().filter((i) => i.status === 'pending' && i.replace != null);
    if (!pending.length) return toast('Nothing to accept (problems without a suggested fix need your decision).');
    if (!(await confirmModal('Accept all suggestions', `Apply all ${pending.length} remaining suggestion(s)? Each one can still be reverted from its card ("Accepted" filter), and Ctrl+Z undoes them one at a time.`, 'Accept all'))) return;
    // From the end of the book backwards, so earlier positions stay valid.
    let ok = 0, failed = 0;
    for (const it of [...pending].sort((a, b) => b.start - a.start)) (this.accept(it, true) ? ok++ : failed++);
    this.render();
    toast(`Accepted ${ok}${failed ? `; ${failed} couldn't be applied because the text had changed` : ''}`, failed > 0, 5000);
  },

  async clear() {
    const st = this.state();
    if (this.running) return toast('Stop the pass first');
    const pending = st.items.filter((i) => i.status === 'pending').length;
    if (pending && !(await confirmModal('Clear prose pass', `Discard ${pending} unreviewed suggestion(s)? Accepted changes stay in your book.`, 'Clear'))) return;
    S.project.prose = null;
    markDirty(true);
    this.render();
  },

  // ---------------------------------------------------------------- render --
  renderSetup() {
    if (!S.project) return;
    const st = S.project.prose;
    const kind = $('#proseScope').value;
    if (st && document.activeElement !== $('#proseInstr')) $('#proseInstr').value = st.instructions || '';
    if (st) { $('#proseLevel').value = st.level || 'proofread'; $('#proseMemory').checked = !!st.useMemory; }
    $('#proseLevelDesc').textContent = this.LEVELS[$('#proseLevel').value].desc;
    $('#proseMemory').closest('label').classList.toggle('hidden', $('#proseLevel').value === 'continuity');
    $('#proseStart').textContent = $('#proseLevel').value === 'continuity' ? 'Check continuity' : 'Correct prose';
    const sc = this.resolveScope(kind);
    const info = $('#proseScopeInfo');
    if (!sc) info.textContent = 'Highlight text in the manuscript first.';
    else {
      const len = sc.end - sc.start;
      const words = countWords(Editor.text.slice(sc.start, sc.end));
      const reqs = Math.max(1, Math.ceil(len / this.CHUNK_CHARS));
      info.textContent = `${sc.label === 'Selected text' ? '' : sc.label + ' · '}${words.toLocaleString()} words · about ${reqs} AI request${reqs > 1 ? 's' : ''}`;
    }
    $('#proseStart').disabled = this.running;
  },

  renderStatus(current) {
    const box = $('#proseStatus');
    const st = S.project && S.project.prose;
    box.innerHTML = '';
    if (!st || (!st.chunks.length && !st.items.length)) return;
    const total = st.chunks.length;
    const done = st.chunks.filter((c) => c.status === 'done' || c.status === 'lost').length;
    if (this.running) {
      const n = (current ?? done) + 1;
      box.append(
        el('div', { class: 'meter-row' }, el('span', {}, this.stopRequested ? 'Stopping after this section…' : `Correcting section ${n} of ${total}…`),
          el('button', { class: 'small', disabled: this.stopRequested, onclick: () => this.stop() }, 'Stop')),
        el('div', { class: 'meter-bar' }, el('div', { class: 'meter-fill', style: `width:${(done / total) * 100}%` })));
    } else if (total) {
      box.append(
        el('div', { class: 'meter-row' },
          el('span', { class: st.error ? 'bad' : '' }, st.error ? `Stopped. ${st.error}` : `Paused after ${done} of ${total} sections.`),
          el('button', { class: 'small accent', onclick: () => this.run() }, 'Resume')),
        el('div', { class: 'meter-bar' }, el('div', { class: 'meter-fill', style: `width:${(done / total) * 100}%` })));
    } else if (st.finishedAt) {
      const c = (s) => st.items.filter((i) => i.status === s).length;
      box.append(el('div', { class: 'muted' },
        `${st.scopeLabel} · ${this.LEVELS[st.level]?.label || ''}: ${st.items.length} suggestion(s). ${c('pending')} to review, ${c('accepted')} accepted, ${c('skipped')} skipped.`));
    }
  },

  render() {
    if (!S.project) return;
    this.renderSetup();
    const items = this.items();
    const pending = items.filter((i) => i.status === 'pending').length;
    $('#proseBadge').textContent = pending;
    this.renderStatus();
    const filter = $('#proseFilter').value;
    const shown = items.filter((i) => (filter === 'all' ? true
      : filter === 'pending' ? i.status === 'pending'
        : filter === 'other' ? ['unmatched', 'stale'].includes(i.status)
          : filter === 'accepted' ? ['accepted', 'resolved'].includes(i.status) : i.status === filter))
      .sort((a, b) => (a.anchored ? a.start : 1e12) - (b.anchored ? b.start : 1e12));
    $('#proseBar').classList.toggle('hidden', !items.length);
    $('#proseAcceptAll').disabled = !pending || this.running;
    const list = $('#proseList');
    list.innerHTML = '';
    if (!items.length) {
      list.append(el('div', { class: 'empty' },
        'Highlight a stretch of your book (a scene, a chapter, everything), right-click and choose ', el('strong', {}, 'Correct prose…'),
        ', or pick a scope above and press ', el('strong', {}, 'Correct prose'), '.', el('br'), el('br'),
        'The AI works through it section by section and lists each correction here for you to accept or skip. Nothing changes in your book until you accept.'));
      return;
    }
    if (!shown.length) { list.append(el('div', { class: 'empty' }, 'Nothing here.')); return; }
    for (const it of shown.slice(0, this.SHOW_MAX)) list.append(this.card(it));
    if (shown.length > this.SHOW_MAX) list.append(el('div', { class: 'empty' }, `…and ${shown.length - this.SHOW_MAX} more. Accept or skip some to see the rest.`));
  },

  card(it) {
    const noFix = it.replace == null;
    const diff = noFix ? `<mark>${escapeHtml(it.find)}</mark>` : (diffWordsHtml(it.status === 'accepted' ? it.original : it.find, it.replace) ?? escapeHtml(it.replace));
    const b = (label, fn, cls = 'small') => el('button', { class: cls, onclick: fn }, label);
    const statusTag = { pending: it.issue ? '⚑ continuity' : '', accepted: '✓ accepted', skipped: it.issue ? 'not a problem' : 'skipped', resolved: '✓ handled', unmatched: '⚠ text not found', stale: '⚠ text changed since' }[it.status];
    if (it.issue && it.status === 'pending') {
      return el('div', { class: 'card prose-item st-pending issue' },
        el('div', { class: 'row' }, el('span', { class: 'tag st-negotiating' }, statusTag), el('span', { class: 'spacer' }), el('span', { class: 'tag', title: it.chapter }, snippet(it.chapter, 22))),
        el('div', { class: 'issue-why' }, it.why),
        el('div', { class: 'prose-diff', html: diff, title: 'Show in manuscript', onclick: () => it.anchored && this.show(it) }),
        el('div', { class: 'actions' },
          noFix ? null : b('Apply fix', () => this.accept(it), 'small accent'),
          b('Show', () => this.show(it)),
          b("I've fixed it", () => { it.status = 'resolved'; markDirty(true); this.render(); }),
          b('Not a problem', () => this.skip(it))));
    }
    return el('div', { class: `card prose-item st-${it.status}` },
      el('div', { class: 'row' },
        statusTag ? el('span', { class: `tag st-${it.status === 'accepted' ? 'applied' : it.status === 'skipped' ? '' : 'missing'}` }, statusTag) : null,
        it.why ? el('span', { class: 'note', style: 'font-style:normal' }, it.why) : null,
        el('span', { class: 'spacer' }),
        el('span', { class: 'tag', title: it.chapter }, snippet(it.chapter, 22))),
      el('div', { class: 'prose-diff', html: diff, title: 'Show in manuscript', onclick: () => it.anchored && this.show(it) }),
      el('div', { class: 'actions' },
        it.status === 'pending' ? [b('Accept', () => this.accept(it), 'small accent'), b('Skip', () => this.skip(it)), b('Show', () => this.show(it))] : null,
        it.status === 'accepted' ? [b('Revert', () => this.revert(it)), b('Show', () => this.show(it))] : null,
        it.status === 'skipped' ? [b('Reconsider', () => this.unskip(it)), b('Show', () => this.show(it))] : null,
        it.status === 'resolved' ? [b('Reopen', () => this.unskip(it)), b('Show', () => this.show(it))] : null,
        ['unmatched', 'stale'].includes(it.status) ? (noFix ? el('div', { class: 'issue-why' }, it.why) : b('Copy correction', () => { navigator.clipboard.writeText(it.replace); toast('Copied'); })) : null));
  },
};
