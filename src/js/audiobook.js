// =============================================================================
// audiobook.js — the Audiobook studio (right panel, "Audio" tab)
// -----------------------------------------------------------------------------
// How it works:
//   1. Make your cast. Each actor is a voice: Gemini TTS, ElevenLabs, or you
//      reading into the microphone. One actor is the Narrator.
//   2. Select text in the manuscript, pick an actor, press "Voice selection".
//      Words inside quotation marks go to that actor; everything else goes to
//      the Narrator. Each piece becomes a clip, stored in
//      "<Book>.crucible/audio/". Voiced text is underlined in the actor's colour.
//   3. Edit the text later and its underline turns red-dashed: the clip no
//      longer matches the words. Regenerate it with one click.
//   4. Export: clips are joined in reading order with natural pauses,
//      levelled to audiobook standards (Audible/ACX) and written as one MP3
//      per chapter plus the full book.
//
// Stored in project.json (S.project.audio):
//   actors[]  { id, name, color, engine: 'tts'|'mic', providerId, voice, style, narrator }
//   clips[]   { id, start, end, text, spoken, actorId, kind, file, dur, status, error }
//             start/end/text follow edits like change-pool items do;
//             spoken = the words when the clip was made (text ≠ spoken → out of date)
//   lexicon[] { from, to, matchCase }   pronunciation list
//   opts      { gapInline, gapPara, gapScene, roomTone, master, format, fullBook }
// =============================================================================

const Audiobook = {
  COLORS: ['#e8743b', '#5aa9e6', '#7fb685', '#c792ea', '#f4c95d', '#ef6f8b', '#4fd1c5', '#b5a58a'],
  busy: false,
  cancel: false,
  player: null,

  // ------------------------------------------------------------- data --
  data() {
    const a = (S.project.audio ||= {});
    a.actors ||= [];
    a.clips ||= [];
    a.lexicon ||= [];
    a.opts = Object.assign({ gapInline: 0.3, gapPara: 0.8, gapScene: 2.0, roomTone: true, master: true, format: 'mp3', fullBook: true }, a.opts || {});
    // A clip interrupted mid-voicing (app closed) is simply waiting again.
    if (!this.busy) for (const c of a.clips) if (c.status === 'working') c.status = 'pending';
    return a;
  },
  actor(id) { return this.data().actors.find((x) => x.id === id) || null; },
  narrator() { return this.data().actors.find((x) => x.narrator) || null; },
  voiceProviders() { return (S.settings.providers || []).filter((p) => AudioScript.TTS.isVoice(p)); },
  // Without a real voice name the service picks a different voice for
  // every line, so one actor sounds like a crowd.
  voiceProblem(x) {
    if (x.engine === 'mic') return null;
    const vprov = this.voiceProviders().find((p) => p.id === x.providerId);
    const v = (x.voice || '').trim();
    if (!v) return `${x.name} has no voice chosen. Press ✎ next to ${x.name}, then Load my voices and pick one.`;
    if (vprov && vprov.type === 'gemini-tts' && !/^voice(key)?_[\w-]+$|^[A-Za-z]+$/.test(v)) {
      return `"${v}" isn't a Gemini voice name. Press ✎ next to ${x.name}, then Load my voices and pick one (e.g. Kore) or your designed voice_… ID.`;
    }
    return null;
  },
  stale(c) { return c.status === 'ok' && c.text !== c.spoken; },
  state(c) { return c.missing ? 'missing' : this.stale(c) ? 'stale' : c.status; },

  // ------------------------------------------------------------- init --
  init() {
    trackAnchors(() => S.project?.audio?.clips || [], debounce(() => { this.renderClips(); }, 400));
    const ta = Editor.ta;
    const sel = debounce(() => this.renderSelection(), 150);
    ['select', 'mouseup', 'keyup'].forEach((ev) => ta.addEventListener(ev, sel));
    Bus.on('caret', debounce(() => this.renderClips(), 300));
    Bus.on('settings', () => this.render());
    $('#auAddActor').addEventListener('click', () => this.editActor(null));
    $('#auVoice').addEventListener('click', () => this.voiceSelection());
    $('#auCancel').addEventListener('click', () => { this.cancel = true; });
    $('#auPlayFrom').addEventListener('click', () => this.playFrom());
    $('#auStop').addEventListener('click', () => this.stopPlay());
    $('#auStale').addEventListener('click', () => this.regenerateStale());
    $('#auLexicon').addEventListener('click', () => this.editLexicon());
    $('#auExport').addEventListener('click', () => this.openExport());
    $('#auUnderline').addEventListener('change', (e) => { persistSettings({ ui: { ...S.settings.ui, audioUnderline: e.target.checked } }); Highlights.refresh(); });
  },

  // ----------------------------------------------------------- render --
  render() {
    if (!$('#auActors')) return;
    this.renderActors();
    this.renderSelection();
    this.renderClips();
    $('#auUnderline').checked = S.settings?.ui?.audioUnderline !== false;
    $('#auLexCount').textContent = this.data().lexicon.length;
  },

  renderActors() {
    const box = $('#auActors');
    const a = this.data();
    box.innerHTML = '';
    if (!a.actors.length) {
      box.append(el('div', { class: 'empty' }, 'No actors yet. Start with your Narrator: ', el('br'),
        el('button', { class: 'small accent', onclick: () => this.editActor(null, true) }, '+ Add Narrator')));
    }
    for (const x of a.actors) {
      const p = (S.settings.providers || []).find((q) => q.id === x.providerId);
      const how = x.engine === 'mic' ? '🎙 your microphone' : !p ? '⚠ no voice service' : this.voiceProblem(x) ? `⚠ ${x.voice ? '"' + x.voice + '" isn\'t a voice' : 'no voice chosen'}` : `${p.name} · ${x.voice}`;
      box.append(el('div', { class: 'au-actor' },
        el('span', { class: 'au-dot', style: `background:${x.color}` }),
        el('div', { class: 'au-who' }, el('strong', {}, x.name), x.narrator ? el('span', { class: 'au-tag' }, 'Narrator') : null,
          el('div', { class: 'muted small au-how', title: how }, how)),
        el('button', { class: 'small ghost', title: 'Edit this actor', onclick: () => this.editActor(x) }, '✎')));
    }
    const pick = $('#auActorPick');
    const keep = pick.value;
    pick.innerHTML = '';
    for (const x of a.actors) pick.append(el('option', { value: x.id }, x.narrator ? `${x.name} (narrator)` : x.name));
    if (a.actors.some((x) => x.id === keep)) pick.value = keep;
  },

  renderSelection() {
    const info = $('#auSelInfo');
    if (!info) return;
    const s = Editor.selection();
    if (s.end <= s.start) { info.textContent = 'Select a passage in the manuscript.'; $('#auVoice').disabled = true; return; }
    const segs = AudioScript.segment(Editor.text, s.start, s.end);
    const d = segs.filter((x) => x.kind === 'dialogue').length;
    info.textContent = `${segs.length} piece${segs.length === 1 ? '' : 's'}: ${d} in quotes, ${segs.length - d} narration`;
    $('#auVoice').disabled = this.busy || !segs.length;
  },

  chapterAtCaret() {
    const pos = Editor.selection().start;
    const chs = AudioScript.chapters(Editor.text);
    return chs.find((c) => pos >= c.start && pos < c.end) || chs[chs.length - 1];
  },

  renderClips() {
    const box = $('#auClips');
    if (!box) return;
    const a = this.data();
    const ch = this.chapterAtCaret();
    const inCh = a.clips.filter((c) => !c.missing && c.start >= ch.start && c.start < ch.end).sort((x, y) => x.start - y.start);
    const missing = a.clips.filter((c) => c.missing);
    const stale = a.clips.filter((c) => this.stale(c) || c.status === 'error');
    $('#auChapter').textContent = ch.title;
    const secs = inCh.reduce((t, c) => t + (c.dur || 0), 0);
    const all = a.clips.reduce((t, c) => t + (c.dur || 0), 0);
    $('#auTotals').textContent = `${inCh.length} clip${inCh.length === 1 ? '' : 's'} · ${AudioScript.clock(secs)} here · ${AudioScript.clock(all)} in the book`;
    $('#auStale').classList.toggle('hidden', !stale.length);
    $('#auStale').textContent = `↻ Redo ${stale.length} out-of-date`;
    box.innerHTML = '';
    if (!inCh.length) box.append(el('div', { class: 'empty' }, 'No voiced clips in this chapter yet.'));
    for (const c of inCh) box.append(this.clipRow(c));
    if (missing.length) {
      box.append(el('div', { class: 'au-sub' }, `${missing.length} clip${missing.length === 1 ? '' : 's'} whose text was deleted`,
        el('button', { class: 'small ghost', onclick: () => this.removeClips(missing) }, 'Remove')));
    }
    Highlights.refresh();
  },

  clipRow(c) {
    const x = this.actor(c.actorId);
    const st = this.state(c);
    const label = { ok: '', stale: 'text changed', error: 'failed', pending: 'waiting', working: 'working…', missing: 'missing' }[st] ?? st;
    const row = el('div', { class: `au-clip st-${st}`, 'data-id': c.id },
      el('span', { class: 'au-dot', style: `background:${x?.color || '#888'}`, title: x?.name || 'Unknown actor' }),
      el('div', { class: 'au-ctext', title: c.error || 'Show in manuscript', onclick: () => Editor.reveal(c.start, c.end) },
        el('span', { class: 'muted small' }, `${x?.name || '?'}${label ? ' · ' + label : ''}${c.dur ? ' · ' + (c.dur < 60 ? `${c.dur.toFixed(1)}s` : AudioScript.clock(c.dur)) : ''}`), el('br'),
        snippet(c.text, 90),
        st === 'error' && c.error ? el('div', { class: 'au-err' }, c.error) : null),
      el('div', { class: 'au-cbtn' },
        el('button', { class: 'small ghost', title: 'Play', disabled: !c.file, onclick: () => this.play(c) }, '▶'),
        el('button', { class: 'small ghost', title: x?.engine === 'mic' ? 'Record again' : 'Generate again', onclick: () => this.regenerate([c]) }, '↻'),
        el('button', { class: 'small ghost', title: 'Give this line to another actor', onclick: (e) => this.recast(c, e) }, '⇄'),
        el('button', { class: 'small ghost danger', title: 'Delete clip', onclick: () => this.removeClips([c]) }, '✕')));
    return row;
  },

  // Coloured underlines for the backdrop behind the editor (highlights.js).
  ranges() {
    if (S.settings?.ui?.audioUnderline === false || !S.project?.audio) return [];
    const out = [];
    for (const c of S.project.audio.clips || []) {
      if (c.missing || !(c.end > c.start)) continue;
      const st = this.state(c);
      out.push({ start: c.start, end: c.end, kind: 'audio', color: this.actor(c.actorId)?.color || '#888', st });
    }
    return out;
  },

  // ----------------------------------------------------------- actors --
  async editActor(actor, asNarrator = false) {
    // Fresh settings, in case a voice service was added in another tab.
    try { S.settings = await window.crucible.getSettings(); } catch { /* keep current */ }
    const a = this.data();
    const isNew = !actor;
    const x = actor ? { ...actor } : {
      id: uid(), name: asNarrator || !this.narrator() ? 'Narrator' : '', engine: 'tts', color: this.COLORS[a.actors.length % this.COLORS.length],
      providerId: this.voiceProviders()[0]?.id || '', voice: '', style: '', narrator: asNarrator || !this.narrator(),
    };
    const field = (label, input, hint) => el('div', { class: 'field' }, el('label', {}, label), input, hint ? el('div', { class: 'hint' }, hint) : null);
    const name = el('input', { value: x.name, placeholder: 'Character name, e.g. Alistair Finch' });
    const color = el('input', { type: 'color', value: x.color, style: 'width:48px;padding:0;height:28px' });
    const engine = el('select', {}, el('option', { value: 'tts' }, 'AI voice'), el('option', { value: 'mic' }, 'Me, recording with my microphone'));
    engine.value = x.engine;
    const prov = el('select');
    const provs = this.voiceProviders();
    if (!provs.length) prov.append(el('option', { value: '' }, 'No voice service yet. In Settings ⚙ use "+ Add an AI or voice service…" → Gemini TTS'));
    for (const p of provs) {
      const kind = p.type === 'elevenlabs' ? 'ElevenLabs' : 'Gemini TTS';
      prov.append(el('option', { value: p.id }, p.name.toLowerCase().includes(kind.split(' ')[0].toLowerCase()) ? p.name : `${p.name} (${kind})`));
    }
    prov.value = x.providerId || provs[0]?.id || '';
    const voice = el('input', { value: x.voice, placeholder: 'Voice name or ID, e.g. Kore or voice_abc123' });
    const voiceList = el('select', { id: 'auVoiceList', style: 'display:none;margin-top:4px;width:100%' });
    voiceList.onchange = () => { if (voiceList.value) voice.value = voiceList.value; };
    const voiceMsg = el('span', { class: 'muted small' });
    const loadVoices = el('button', {
      class: 'small', onclick: async () => {
        voiceMsg.textContent = 'Loading…';
        const r = await window.crucible.listVoices({ providerId: prov.value });
        voiceList.innerHTML = '';
        if (!r.ok) { voiceList.style.display = 'none'; voiceMsg.textContent = `✕ ${snippet(r.error, 90)}`; return; }
        voiceList.append(el('option', { value: '' }, `Choose a voice (${r.voices.length})…`));
        r.voices.forEach((v) => voiceList.append(el('option', { value: v.id }, `${v.name}${v.type ? ' · ' + v.type : ''}${v.name !== v.id ? '  [' + v.id + ']' : ''}`)));
        voiceList.value = r.voices.some((v) => v.id === voice.value.trim()) ? voice.value.trim() : '';
        voiceList.style.display = '';
        voiceMsg.textContent = 'Pick one from the list below, then ▶ Test voice.';
      },
    }, 'Load my voices');
    const style = el('textarea', { rows: 3, placeholder: 'How this character talks, e.g. Warm South Wales lilt, mid-low baritone, unhurried, dry humour.' });
    style.value = x.style || '';
    const narr = el('input', { type: 'checkbox', checked: !!x.narrator });
    const test = el('span', { class: 'muted small' });
    const aiBits = el('div', {},
      field('Voice service', prov),
      field('Voice', el('div', {}, voice, voiceList, el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:4px' }, loadVoices, voiceMsg)),
        'Gemini: a voice name (Kore, Puck…) or your designed voice ID from Google AI Studio (voice_…). ElevenLabs: the voice ID.'),
      field('Direction', style, 'Gemini follows this as delivery direction. Accent and age are best built into a designed voice.'));
    const syncEngine = () => { aiBits.style.display = engine.value === 'mic' ? 'none' : ''; };
    engine.onchange = syncEngine;
    syncEngine();
    const read = () => Object.assign(x, { name: name.value.trim() || 'Unnamed', color: color.value, engine: engine.value, providerId: prov.value, voice: voice.value.trim(), style: style.value.trim(), narrator: narr.checked });
    const body = el('div', {},
      el('div', { style: 'display:flex;gap:8px;align-items:end' }, el('div', { style: 'flex:1' }, field('Name', name)), field('Colour', color)),
      field('Who reads', engine), aiBits,
      el('label', { class: 'check', style: 'margin:6px 0' }, narr, 'This is the Narrator (reads everything outside quotation marks)'),
      el('div', { style: 'display:flex;gap:8px;align-items:center' },
        el('button', {
          class: 'small', onclick: async () => {
            read();
            if (x.engine === 'mic') { test.textContent = 'Microphone actors record in the studio.'; return; }
            const bad = this.voiceProblem(x);
            if (bad) { test.textContent = `✕ ${bad}`; return; }
            test.textContent = 'Speaking…';
            const sel = Editor.selection();
            const line = sel.end > sel.start ? AudioScript.spoken(sel.text, this.data().lexicon).slice(0, 300) : `This is ${x.name}. Testing, one, two, three.`;
            const r = await window.crucible.tts({ providerId: x.providerId, text: line, voice: x.voice, style: x.style });
            if (!r.ok) { test.textContent = `✕ ${snippet(r.error, 120)}`; return; }
            test.textContent = '✓ Playing';
            this.playBytes(r.data, r.ext);
          },
        }, '▶ Test voice'), test));
    openModal({
      title: isNew ? 'New actor' : `Actor: ${x.name}`,
      body,
      buttons: [
        ...(!isNew ? [{
          label: 'Delete', cls: 'danger', onClick: async () => {
            const n = a.clips.filter((c) => c.actorId === x.id).length;
            if (n && !(await confirmModal('Delete actor', `${x.name} has ${n} clip${n === 1 ? '' : 's'}. They stay, but show as "Unknown actor" until you recast them.`, 'Delete'))) return false;
            a.actors = a.actors.filter((q) => q.id !== x.id);
            markDirty(true); this.render(); return true;
          },
        }] : []),
        { label: 'Cancel' },
        {
          label: 'Save', accent: true, onClick: () => {
            read();
            if (x.narrator) a.actors.forEach((q) => { if (q.id !== x.id) q.narrator = false; });
            const i = a.actors.findIndex((q) => q.id === x.id);
            if (i === -1) a.actors.push(x); else a.actors[i] = x;
            markDirty(true);
            this.render();
            if (!x.narrator) $('#auActorPick').value = x.id;
          },
        },
      ],
    });
  },

  // ---------------------------------------------------------- voicing --
  requireBook() {
    if (!S.path) { toast('Save the book first. Voice clips are kept in its folder.', true, 5000); return false; }
    return true;
  },

  async voiceSelection() {
    if (this.busy || !this.requireBook()) return;
    const a = this.data();
    const s = Editor.selection();
    const chosen = this.actor($('#auActorPick').value);
    if (!chosen) return toast('Add an actor first.', true);
    const narrator = this.narrator();
    const whole = $('#auWhole').checked || chosen.narrator;
    const segs = AudioScript.segment(Editor.text, s.start, s.end, { split: !whole });
    if (!segs.length) return toast('Nothing to read there.');
    if (!whole && !narrator && segs.some((g) => g.kind === 'narration')) {
      return toast('Add a Narrator actor first: they read everything outside quotation marks. (Or tick "Whole selection".)', true, 6000);
    }
    // Clips already on these words are replaced.
    const old = a.clips.filter((c) => !c.missing && c.start < s.end && c.end > s.start);
    if (old.length && !(await confirmModal('Replace clips?', `${old.length} clip${old.length === 1 ? ' is' : 's are'} already on this passage. Replace ${old.length === 1 ? 'it' : 'them'}?`, 'Replace'))) return;
    await this.removeClips(old, true);
    const fresh = segs.map((g) => ({
      id: uid(), start: g.start, end: g.end, text: Editor.text.slice(g.start, g.end), spoken: '',
      actorId: whole ? chosen.id : g.kind === 'dialogue' ? chosen.id : narrator.id,
      kind: g.kind, file: '', dur: 0, status: 'pending', created: Date.now(),
    }));
    a.clips.push(...fresh);
    markDirty(true);
    this.renderClips();
    await this.generate(fresh);
  },

  // Make audio for clips: AI voices one after another, then the microphone
  // lines in the recorder.
  async generate(clips) {
    const tts = clips.filter((c) => this.actor(c.actorId)?.engine !== 'mic');
    const mic = clips.filter((c) => this.actor(c.actorId)?.engine === 'mic');
    this.busy = true; this.cancel = false;
    $('#auProgress').classList.remove('hidden');
    this.renderSelection();
    let done = 0, failed = 0;
    try {
      for (const c of tts) {
        if (this.cancel) break;
        $('#auProgText').textContent = `Voicing ${done + 1} of ${tts.length}…`;
        $('#auBar').style.width = `${Math.round((done / Math.max(1, tts.length)) * 100)}%`;
        c.status = 'working'; this.renderClips();
        try {
          await this.synthesize(c);
        } catch (e) {
          c.status = 'error'; c.error = e.message; failed++;
          // Wrong key or no credit: the rest would fail the same way.
          if (/key|auth|401|403|quota|credit|permission|billing/i.test(e.message)) { toast(`Voice service: ${e.message}`, true, 9000); break; }
        }
        done++;
        markDirty(true);
      }
    } finally {
      this.busy = false;
      $('#auProgress').classList.add('hidden');
      for (const c of tts) if (c.status === 'working' || c.status === 'pending') c.status = 'pending';
      this.renderClips(); this.renderSelection();
    }
    if (failed) toast(`${failed} clip${failed === 1 ? '' : 's'} failed. Hover a red line in the list to see why, then ↻ to retry.`, true, 7000);
    else if (this.cancel) toast('Stopped. Unfinished clips are marked "waiting"; ↻ voices them.');
    if (mic.length && !this.cancel) Recorder.open(mic);
  },

  async synthesize(c) {
    const x = this.actor(c.actorId);
    if (!x) throw new Error('This clip\'s actor was deleted. Use ⇄ to give it to someone.');
    // An actor made before the voice service was added (or after it was
    // removed and added again) points at nothing: with just one voice
    // service, that's obviously the one to use.
    if (!this.voiceProviders().some((p) => p.id === x.providerId)) {
      const vp = this.voiceProviders();
      if (vp.length === 1) { x.providerId = vp[0].id; markDirty(true); this.renderActors(); }
      else throw new Error(vp.length ? `Choose a voice service for ${x.name}: press ✎ next to ${x.name} in the Cast list.` : 'Add a voice service first: Settings ⚙ → "+ Add an AI or voice service…" → Gemini TTS (audiobook voices).');
    }
    const bad = this.voiceProblem(x);
    if (bad) throw new Error(bad);
    const text = AudioScript.spoken(Editor.text.slice(c.start, c.end), this.data().lexicon);
    if (!text) throw new Error('Nothing to say in this clip.');
    // Busy or rate-limited services usually answer on a second try.
    for (let attempt = 0; ; attempt++) {
      const r = await window.crucible.tts({ providerId: x.providerId, text, voice: x.voice, style: x.style });
      if (r.ok) return this.storeClip(c, r.data, r.ext);
      const retry = /\b(429|500|502|503|504)\b|rate.?limit|too many|overloaded|unavailable|try again|didn't answer in time/i.test(r.error || '');
      if (!retry || attempt >= 3 || this.cancel) throw new Error(r.error);
      $('#auProgText').textContent = 'The voice service is busy, trying again…';
      await new Promise((res) => setTimeout(res, 4000 * (attempt + 1)));
    }
  },

  // Save audio for a clip and mark it current.
  async storeClip(c, data, ext) {
    const name = `${c.id}-${Date.now().toString(36)}.${ext}`;
    await window.crucible.writeBookAudio({ bookPath: S.path, name, data });
    if (c.file && c.file !== name) await window.crucible.deleteBookAudio({ bookPath: S.path, name: c.file }).catch(() => {});
    c.file = name;
    c.dur = await this.duration(data).catch(() => 0);
    c.spoken = Editor.text.slice(c.start, c.end);
    c.text = c.spoken;
    c.status = 'ok';
    delete c.error;
    markDirty(true);
  },

  async regenerate(clips) {
    if (this.busy || !this.requireBook()) return;
    for (const c of clips) { c.text = Editor.text.slice(c.start, c.end); c.status = 'pending'; }
    await this.generate(clips);
  },

  regenerateStale() {
    const list = this.data().clips.filter((c) => !c.missing && (this.stale(c) || c.status === 'error' || c.status === 'pending'));
    if (list.length) this.regenerate(list);
  },

  recast(c, e) {
    const items = this.data().actors.map((x) => [`${x.id === c.actorId ? '✓ ' : ''}${x.name}`,
      () => { if (x.id !== c.actorId) { c.actorId = x.id; markDirty(true); this.regenerate([c]); } }]);
    if (!items.length) return toast('Add an actor first.');
    Editor.showMenu(e.clientX, e.clientY, items);
  },

  async removeClips(list, quiet = false) {
    if (!list.length) return;
    const a = this.data();
    const ids = new Set(list.map((c) => c.id));
    for (const c of list) if (c.file && S.path) await window.crucible.deleteBookAudio({ bookPath: S.path, name: c.file }).catch(() => {});
    a.clips = a.clips.filter((c) => !ids.has(c.id));
    markDirty(true);
    if (!quiet) this.renderClips();
  },

  // ---------------------------------------------------------- playback --
  async clipBytes(c) {
    if (!c.file || !S.path) return null;
    return window.crucible.readBookAudio({ bookPath: S.path, name: c.file });
  },
  mime: (ext) => ({ wav: 'audio/wav', mp3: 'audio/mpeg', webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4' }[ext] || 'audio/wav'),

  playBytes(data, ext) {
    this.stopPlay();
    const url = URL.createObjectURL(new Blob([data], { type: this.mime(ext) }));
    const au = new Audio(url);
    this.player = { au, url };
    au.onended = () => this.stopPlay();
    return au.play().catch(() => {});
  },

  async play(c) {
    const b = await this.clipBytes(c);
    if (!b) return toast('That clip\'s audio file is missing. Use ↻ to make it again.', true);
    this.playBytes(b, c.file.split('.').pop());
  },

  stopPlay() {
    this.playing = false;
    if (this.player) { this.player.au.pause(); URL.revokeObjectURL(this.player.url); this.player = null; }
    $('#auStop')?.classList.add('hidden');
    $('#auPlayFrom')?.classList.remove('hidden');
  },

  // Play every finished clip from the cursor to the end of the chapter, with
  // the same pauses the export uses, following along in the manuscript.
  async playFrom() {
    const pos = Editor.selection().start;
    const ch = this.chapterAtCaret();
    const o = this.data().opts;
    const list = this.data().clips.filter((c) => !c.missing && c.status === 'ok' && c.end > pos && c.start < ch.end).sort((x, y) => x.start - y.start);
    if (!list.length) return toast('No finished clips from here to the end of the chapter.');
    this.stopPlay();
    this.playing = true;
    $('#auStop').classList.remove('hidden');
    $('#auPlayFrom').classList.add('hidden');
    for (let i = 0; i < list.length && this.playing; i++) {
      const c = list[i];
      Editor.reveal(c.start, c.end, false);
      const b = await this.clipBytes(c);
      if (!b || !this.playing) continue;
      await new Promise((res) => {
        const url = URL.createObjectURL(new Blob([b], { type: this.mime(c.file.split('.').pop()) }));
        const au = new Audio(url);
        this.player = { au, url };
        au.onended = res; au.onerror = res; au.onpause = res;
        au.play().catch(res);
      });
      if (this.player) { URL.revokeObjectURL(this.player.url); this.player = null; }
      const next = list[i + 1];
      if (next && this.playing) {
        const g = this.gapSeconds(Editor.text, c, next);
        await new Promise((r) => setTimeout(r, g * 1000));
      }
    }
    this.stopPlay();
  },

  gapSeconds(text, c, next) {
    const o = this.data().opts;
    const kind = AudioScript.isHeading(text, c.start) ? 'scene' : AudioScript.gapAfter(text, c.end, next.start);
    return kind === 'scene' ? +o.gapScene : kind === 'para' ? +o.gapPara : +o.gapInline;
  },

  // Decode any stored clip to mono samples at 44.1 kHz.
  async decode(bytes) {
    const ctx = new OfflineAudioContext(1, 1, AudioScript.Master.RATE);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const buf = await ctx.decodeAudioData(ab);
    if (buf.numberOfChannels === 1) return buf.getChannelData(0);
    const out = new Float32Array(buf.length);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
    }
    return out;
  },
  async duration(bytes) { return (await this.decode(bytes)).length / AudioScript.Master.RATE; },

  // ----------------------------------------------------- pronunciation --
  editLexicon() {
    const a = this.data();
    const rows = a.lexicon.map((e) => ({ ...e }));
    const box = el('div');
    const draw = () => {
      box.innerHTML = '';
      const t = el('table', { class: 'au-lex' }, el('tr', {}, el('th', {}, 'Written'), el('th', {}, 'Say it as'), el('th', {}, 'Aa'), el('th')));
      rows.forEach((r, i) => {
        const from = el('input', { value: r.from || '', placeholder: 'Mamgu' });
        const to = el('input', { value: r.to || '', placeholder: 'Mam-ghee' });
        const mc = el('input', { type: 'checkbox', checked: !!r.matchCase, title: 'Match capital letters exactly' });
        from.oninput = () => (r.from = from.value);
        to.oninput = () => (r.to = to.value);
        mc.onchange = () => (r.matchCase = mc.checked);
        t.append(el('tr', {}, el('td', {}, from), el('td', {}, to), el('td', {}, mc),
          el('td', {}, el('button', { class: 'small ghost danger', onclick: () => { rows.splice(i, 1); draw(); } }, '✕'))));
      });
      box.append(t, el('button', { class: 'small', onclick: () => { rows.push({ from: '', to: '', matchCase: false }); draw(); } }, '+ Add word'));
    };
    draw();
    openModal({
      title: 'Pronunciation list',
      body: el('div', {}, el('p', { class: 'muted' }, 'Voices receive the right-hand spelling; your manuscript keeps the left. Whole words only. Changing the list doesn\'t redo existing clips: use ↻ on the lines that need it.'), box),
      buttons: [{ label: 'Cancel' }, {
        label: 'Save', accent: true, onClick: () => {
          a.lexicon = rows.filter((r) => r.from && r.from.trim()).map((r) => ({ from: r.from.trim(), to: r.to || '', matchCase: !!r.matchCase }));
          markDirty(true);
          $('#auLexCount').textContent = a.lexicon.length;
        },
      }],
    });
  },

  // ------------------------------------------------------------ export --
  coverage(text, ch) {
    const segs = AudioScript.segment(text, ch.start, ch.end);
    const clips = this.data().clips.filter((c) => !c.missing && c.start < ch.end && c.end > ch.start);
    let need = 0, have = 0;
    for (const g of segs) {
      need += g.end - g.start;
      have += clips.filter((c) => c.status === 'ok' && c.start <= g.start && c.end >= g.end).length ? g.end - g.start : 0;
    }
    return { pct: need ? Math.round((have / need) * 100) : 0, clips, stale: clips.filter((c) => this.stale(c)).length, notReady: clips.filter((c) => c.status !== 'ok').length };
  },

  openExport() {
    if (!this.requireBook()) return;
    const a = this.data();
    const o = a.opts;
    const text = Editor.text;
    const chs = AudioScript.chapters(text);
    const here = this.chapterAtCaret();
    const scope = el('select', {}, el('option', { value: 'book' }, 'Whole book'), el('option', { value: 'chapter' }, `This chapter only: ${here.title}`));
    const format = el('select', {}, el('option', { value: 'mp3' }, 'MP3, 192 kbps (Audible / ACX)'), el('option', { value: 'wav' }, 'WAV, 16-bit (master copy)'));
    format.value = o.format;
    const full = el('input', { type: 'checkbox', checked: o.fullBook });
    const master = el('input', { type: 'checkbox', checked: o.master });
    const tone = el('input', { type: 'checkbox', checked: o.roomTone });
    const num = (v, step = 0.1) => el('input', { type: 'number', min: '0', max: '10', step, value: v, style: 'width:64px' });
    const gi = num(o.gapInline), gp = num(o.gapPara), gs = num(o.gapScene, 0.5);
    const table = el('table', { class: 'au-cov' }, el('tr', {}, el('th', {}, 'Chapter'), el('th', {}, 'Clips'), el('th', {}, 'Voiced'), el('th', {}, '')));
    for (const ch of chs) {
      const cv = this.coverage(text, ch);
      if (ch.n === 0 && !cv.clips.length) continue;
      const warn = cv.stale ? `${cv.stale} out of date` : cv.notReady ? `${cv.notReady} not ready` : cv.pct < 100 && cv.clips.length ? 'gaps' : '';
      table.append(el('tr', { class: cv.clips.length ? '' : 'muted' }, el('td', {}, ch.title), el('td', {}, String(cv.clips.length)), el('td', {}, `${cv.pct}%`), el('td', { class: warn ? 'warn' : '' }, warn)));
    }
    const progress = el('div', { class: 'au-exprog hidden' }, el('div', { class: 'au-barwrap' }, el('div', { class: 'au-bar' })), el('div', { class: 'muted small au-exmsg' }));
    const results = el('div');
    const field = (label, input, hint) => el('div', { class: 'field' }, el('label', {}, label), input, hint ? el('div', { class: 'hint' }, hint) : null);
    let running = false;
    const body = el('div', {},
      el('p', { class: 'muted' }, 'Clips are joined in reading order with pauses between them. Chapters without clips are skipped. Text with no clip is simply not heard, so check the Voiced column.'),
      el('div', { class: 'au-covwrap' }, table),
      el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap' }, field('Export', scope), field('Format', format)),
      el('div', { class: 'au-opts' },
        el('label', { class: 'check' }, full, 'Also make one full-book file (MP3 only)'),
        el('label', { class: 'check' }, master, 'Level to audiobook standard: average -20 dB, peaks under -3 dB (ACX)'),
        el('label', { class: 'check' }, tone, 'Add quiet room tone so pauses aren\'t dead silence')),
      el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;margin-top:6px' },
        field('Pause inside a paragraph (s)', gi), field('Between paragraphs (s)', gp), field('Scene break / heading (s)', gs)),
      progress, results);
    openModal({
      title: 'Export audiobook', wide: true, body,
      buttons: [
        { label: 'Close', onClick: () => { if (running) { this.cancel = true; return false; } } },
        {
          label: 'Export', accent: true, onClick: async () => {
            if (running) return false;
            Object.assign(o, { format: format.value, fullBook: full.checked, master: master.checked, roomTone: tone.checked, gapInline: +gi.value || 0, gapPara: +gp.value || 0, gapScene: +gs.value || 0 });
            markDirty(true);
            running = true; this.cancel = false;
            progress.classList.remove('hidden'); results.innerHTML = '';
            const bar = progress.querySelector('.au-bar'), msg = progress.querySelector('.au-exmsg');
            try {
              const list = scope.value === 'chapter' ? [here] : chs;
              const out = await this.exportBook(list, o, (f, m) => { bar.style.width = `${Math.round(f * 100)}%`; msg.textContent = m; });
              results.append(this.exportReport(out));
              msg.textContent = this.cancel ? 'Stopped.' : 'Done.';
            } catch (e) {
              msg.textContent = `✕ ${e.message}`;
            } finally { running = false; }
            return false;
          },
        },
      ],
    });
  },

  exportReport(out) {
    const t = el('table', { class: 'au-cov' }, el('tr', {}, el('th', {}, 'File'), el('th', {}, 'Length'), el('th', {}, 'Average'), el('th', {}, 'Peak'), el('th', {}, 'ACX')));
    for (const r of out.files) {
      const ok = r.rmsDb >= -23 && r.rmsDb <= -18 && r.peakDb <= -3;
      t.append(el('tr', {}, el('td', {}, r.name), el('td', {}, AudioScript.clock(r.seconds)), el('td', {}, `${r.rmsDb.toFixed(1)} dB`), el('td', {}, `${r.peakDb.toFixed(1)} dB`), el('td', { class: ok ? 'ok' : 'warn' }, ok ? '✓' : 'check')));
    }
    return el('div', {}, el('p', {}, out.where ? `Saved in “${out.where}”.` : 'Downloaded.'), t,
      el('p', { class: 'muted small' }, 'ACX also asks for opening and closing credits as their own files, and checks for background noise you can only judge by ear. Listen to each chapter before you upload.'));
  },

  // Join, level and write chapters. Two passes per chapter so it never has to
  // hold a whole chapter of finished audio in memory: pass 1 measures, pass 2
  // writes.
  async exportBook(chapters, o, progress) {
    const M = AudioScript.Master;
    const R = M.RATE;
    const text = Editor.text;
    const a = this.data();
    const mp3 = o.format === 'mp3';
    if (mp3 && typeof lamejs === 'undefined') throw new Error('The MP3 encoder is missing from this copy of Crucible.');
    const work = chapters.map((ch) => ({ ch, clips: a.clips.filter((c) => !c.missing && c.status === 'ok' && c.file && c.start >= ch.start && c.start < ch.end).sort((x, y) => x.start - y.start) }))
      .filter((w) => w.clips.length);
    if (!work.length) throw new Error('No finished clips to export.');
    const totalClips = work.reduce((t, w) => t + w.clips.length, 0);
    let step = 0; // measuring a clip = 1 step, writing it = 2
    const files = [];
    const noise = M.noise(7);
    const toneDb = -72;
    const head = Math.round(0.75 * R), tail = Math.round(2.5 * R);
    const bookName = baseName(S.path).replace(/\.[^.]+$/, '');
    let full = null, where = '';
    if (mp3 && o.fullBook && work.length > 1) full = await window.crucible.audiobookBegin({ bookPath: S.path, name: `${bookName} - Full book.mp3` });
    const cache = new Map();
    const CACHE_LIMIT = 24e6; // samples kept between the passes (~100 MB)
    try {
      for (const w of work) {
        const { ch, clips } = w;
        const label = ch.n ? `${String(ch.n).padStart(2, '0')} - ${ch.title}` : `00 - ${ch.title}`;
        // ---- pass 1: measure
        let samples = head + tail, sumSq = 0, cached = 0;
        const lens = [], gaps = [];
        for (const [i, c] of clips.entries()) {
          if (this.cancel) throw new Error('Stopped.');
          progress(step / (3 * totalClips), `${label}: measuring ${i + 1} of ${clips.length}`);
          const b = await this.clipBytes(c);
          if (!b) throw new Error(`A clip's audio file is missing in “${ch.title}”: “${snippet(c.text, 40)}”. Redo it with ↻.`);
          const x = M.trim(await this.decode(b), R);
          const st = M.stats(x);
          sumSq += st.sumSq;
          lens.push(x.length);
          if (cached + x.length < CACHE_LIMIT) { cache.set(c.id, x); cached += x.length; }
          step++;
          const g = i + 1 < clips.length ? Math.round(this.gapSeconds(text, c, clips[i + 1]) * R) : 0;
          gaps.push(g);
          samples += x.length + g;
        }
        const rms = Math.sqrt(sumSq / Math.max(1, samples));
        const gain = o.master && rms > 0 ? Math.min(M.lin(24), M.lin(-20) / rms) : 1;
        // ---- pass 2: write
        const name = AudioScript.fileSafe(`${label}.${mp3 ? 'mp3' : 'wav'}`);
        const f = await window.crucible.audiobookBegin({ bookPath: S.path, name });
        where = f.where.includes('/') || f.where.includes('\\') ? f.where.replace(/[\\/][^\\/]*$/, '') : '';
        const enc = mp3 ? new lamejs.Mp3Encoder(1, R, 192) : null;
        let pend = [], pendBytes = 0, outSq = 0, outPeak = 0, outN = 0;
        const flushOut = async (force) => {
          if (!pendBytes || (!force && pendBytes < 1 << 20)) return;
          const all = new Uint8Array(pendBytes);
          let off = 0;
          for (const p of pend) { all.set(p, off); off += p.length; }
          pend = []; pendBytes = 0;
          await window.crucible.audiobookWrite({ token: f.token, data: all });
          if (full) await window.crucible.audiobookWrite({ token: full.token, data: all });
        };
        const push = (u8) => { if (u8.length) { pend.push(u8); pendBytes += u8.length; } };
        const emit = async (x) => {
          if (o.roomTone) { const n = noise(x.length, toneDb); for (let i = 0; i < x.length; i++) x[i] += n[i]; }
          for (let i = 0; i < x.length; i++) { const v = x[i]; outSq += v * v; const av = v < 0 ? -v : v; if (av > outPeak) outPeak = av; }
          outN += x.length;
          const pcm = M.toInt16(x);
          if (enc) {
            for (let i = 0; i < pcm.length; i += 1152 * 20) push(new Uint8Array(enc.encodeBuffer(pcm.subarray(i, i + 1152 * 20)).buffer));
          } else push(new Uint8Array(pcm.buffer));
          await flushOut(false);
        };
        const silence = (n) => emit(new Float32Array(n));
        if (!mp3) push(M.wavHeader(samples, R));
        await silence(head);
        for (const [i, c] of clips.entries()) {
          if (this.cancel) { await window.crucible.audiobookAbort({ token: f.token }); throw new Error('Stopped.'); }
          progress(step / (3 * totalClips), `${label}: writing ${i + 1} of ${clips.length}`);
          let x = cache.get(c.id);
          if (!x) x = M.trim(await this.decode(await this.clipBytes(c)), R);
          cache.delete(c.id);
          // Keep the exact length measured in pass 1 (a WAV header depends on it).
          if (x.length !== lens[i]) { const y = new Float32Array(lens[i]); y.set(x.subarray(0, lens[i])); x = y; }
          const y = new Float32Array(x.length);
          for (let k = 0; k < x.length; k++) y[k] = x[k] * gain;
          if (o.master) M.limit(y, -3.5, R);
          await emit(y);
          if (gaps[i]) await silence(gaps[i]);
          step += 2;
        }
        await silence(tail);
        if (enc) push(new Uint8Array(enc.flush().buffer));
        await flushOut(true);
        const fin = await window.crucible.audiobookEnd({ token: f.token });
        files.push({ name, path: fin?.path, seconds: outN / R, rmsDb: M.db(Math.sqrt(outSq / Math.max(1, outN))), peakDb: M.db(outPeak) });
        cache.clear();
        progress(step / (3 * totalClips), `${label}: done`);
      }
      if (full) {
        await window.crucible.audiobookEnd({ token: full.token });
        const secs = files.reduce((t, r) => t + r.seconds, 0);
        files.push({ name: AudioScript.fileSafe(`${bookName} - Full book.mp3`), seconds: secs, rmsDb: Math.max(...files.map((r) => r.rmsDb)), peakDb: Math.max(...files.map((r) => r.peakDb)) });
        full = null;
      }
    } catch (e) {
      if (full) await window.crucible.audiobookAbort({ token: full.token }).catch(() => {});
      throw e;
    }
    return { files, where };
  },
};

// =============================================================================
// Recorder — read your own lines into the microphone, one clip at a time.
// =============================================================================
const Recorder = {
  async open(clips) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return toast('This browser can\'t record from a microphone.', true, 6000);
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      return toast(`Microphone not available: ${e.message}. Allow microphone access for Crucible and try again.`, true, 8000);
    }
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
    const ext = /ogg/.test(mime) ? 'ogg' : 'webm';
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    let i = 0, rec = null, chunks = [], take = null, raf = 0;
    const who = el('div', { class: 'muted' });
    const line = el('div', { class: 'rec-line' });
    const meter = el('div', { class: 'rec-meter' }, el('div', { class: 'rec-level' }));
    const status = el('div', { class: 'muted small' });
    const btnRec = el('button', { class: 'accent' }, '● Record');
    const btnPlay = el('button', { disabled: true }, '▶ Play take');
    const btnKeep = el('button', { disabled: true }, '✓ Keep & next');
    const btnSkip = el('button', { class: 'ghost' }, 'Skip');
    const level = () => {
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      let pk = 0;
      for (const v of buf) pk = Math.max(pk, Math.abs(v));
      const db = AudioScript.Master.db(pk);
      meter.firstChild.style.width = `${Math.max(0, Math.min(100, (db + 60) / 60 * 100))}%`;
      meter.firstChild.classList.toggle('hot', db > -3);
      raf = requestAnimationFrame(level);
    };
    level();
    const show = () => {
      const c = clips[i];
      if (!c) { done(); return; }
      const x = Audiobook.actor(c.actorId);
      who.textContent = `Line ${i + 1} of ${clips.length} · ${x?.name || ''}`;
      line.textContent = AudioScript.clean(Editor.text.slice(c.start, c.end));
      Editor.reveal(c.start, c.end, false);
      take = null; btnPlay.disabled = true; btnKeep.disabled = true;
      status.textContent = 'Press Record, read the line, press Stop. Keep the meter out of the red.';
    };
    btnRec.onclick = () => {
      if (rec && rec.state === 'recording') { rec.stop(); return; }
      chunks = [];
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        take = new Uint8Array(await new Blob(chunks, { type: mime || 'audio/webm' }).arrayBuffer());
        btnRec.textContent = '● Record again';
        btnPlay.disabled = false; btnKeep.disabled = false;
        status.textContent = 'Play it back. Keep it, or record again.';
      };
      rec.start();
      btnRec.textContent = '■ Stop';
      status.textContent = 'Recording…';
    };
    btnPlay.onclick = () => take && Audiobook.playBytes(take, ext);
    btnKeep.onclick = async () => {
      if (!take) return;
      btnKeep.disabled = true;
      try { await Audiobook.storeClip(clips[i], take, ext); } catch (e) { status.textContent = `✕ ${e.message}`; btnKeep.disabled = false; return; }
      Audiobook.renderClips();
      i++; btnRec.textContent = '● Record'; show();
    };
    btnSkip.onclick = () => { i++; btnRec.textContent = '● Record'; show(); };
    let m;
    const done = () => {
      cancelAnimationFrame(raf);
      try { if (rec && rec.state === 'recording') rec.stop(); } catch { /* stopped */ }
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      Audiobook.stopPlay();
      Audiobook.renderClips();
      m?.close();
    };
    m = openModal({
      title: 'Record your lines', cls: 'rec-modal',
      body: el('div', {}, who, line, meter, el('div', { class: 'rec-btns' }, btnRec, btnPlay, btnKeep, btnSkip), status),
      buttons: [{ label: 'Finish', onClick: () => { done(); } }],
      onClose: () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); },
    });
    show();
  },
};
