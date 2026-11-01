// =============================================================================
// ai.js — the AI desk (negotiation box)
// -----------------------------------------------------------------------------
// How a message is built:
//   SYSTEM  = editing-partner instructions + story memory (+ whole book if ticked)
//   USER    = your words + a fresh copy of every passage under negotiation,
//             with ~1,000 characters of surrounding text so the AI sees context
//
// The AI is told to wrap proposed wording in <revision id="...">…</revision>.
// Crucible turns each of those into a card with Apply / Diff / Copy buttons.
// Nothing touches your manuscript until you press Apply.
// =============================================================================

const AI = {
  busy: false,
  CONTEXT_CHARS: 1000,

  init() {
    $('#btnSend').addEventListener('click', () => this.send());
    $('#chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.send(); }
    });
    $('#btnNewChat').addEventListener('click', async () => {
      if (this.busy) return toast('Wait for the current reply before clearing the conversation.');
      if (S.project.chat.length && !(await confirmModal('New chat', 'Clear this conversation? (Applied changes stay in your manuscript.)', 'Clear'))) return;
      S.project.chat = [];
      markDirty(true);
      this.renderChat();
    });
    $('#providerSelect').addEventListener('change', (e) => persistSettings({ activeProviderId: e.target.value }));
    Bus.on('settings', () => this.renderProviders());
  },

  showTab() { App.showTab('right', 'ai'); },

  renderProviders() {
    const sel = $('#providerSelect');
    sel.innerHTML = '';
    const ps = S.settings.providers;
    if (!ps.length) sel.append(el('option', { value: '' }, 'Add an AI in Settings ⚙'));
    for (const p of ps) sel.append(el('option', { value: p.id }, `${p.name} · ${p.model || '?'}`));
    sel.value = S.settings.activeProviderId || ps[0]?.id || '';
  },

  activeItems() {
    return (S.project.meta.negotiate || []).map((id) => Pool.get(id)).filter(Boolean);
  },

  renderContext() {
    const box = $('#aiContext');
    const items = this.activeItems();
    box.innerHTML = '';
    if (!items.length) return;
    box.append(el('div', { class: 'ctx-head' }, `On the table (${items.length})`, el('span', { class: 'spacer' }),
      el('button', {
        class: 'small ghost', onclick: () => { S.project.meta.negotiate = []; markDirty(true); this.renderContext(); Pool.render(); },
      }, 'Clear')));
    for (const it of items) {
      box.append(el('div', { class: 'ctx-item' },
        el('span', { class: 't', title: 'Show in manuscript', style: 'cursor:pointer', onclick: () => Pool.goTo(it) }, it.text),
        el('button', {
          title: 'Take off the table',
          onclick: () => {
            S.project.meta.negotiate = S.project.meta.negotiate.filter((x) => x !== it.id);
            markDirty(true); this.renderContext(); Pool.render();
          },
        }, '✕')));
    }
  },

  async buildSystem() {
    const parts = [
      `You are the editing partner for a novelist working on their manuscript in an app called Crucible.
Your job is to negotiate revisions with the author: propose wording, explain your reasoning briefly, and adapt to their feedback. Preserve the author's voice, tense, point of view, and Markdown formatting unless asked otherwise. Leave <!-- hidden comments --> and ::: alignment lines exactly as they are. Stay consistent with the story memory below.

HOW TO EDIT THE MANUSCRIPT
Every edit you propose becomes a card the author reviews and applies. Nothing changes until they press Apply. You have three tools:

1) REWRITE a passage that is on the table:
<revision id="ITEM_ID">complete replacement text</revision>
The text must be a drop-in replacement for the ENTIRE <target>: no quotation marks around it, no commentary inside it. Several revision tags with the same id = alternatives.

2) ADD new text anywhere (epigraph, dedication, new paragraph, scene, chapter…):
<insert position="before" anchor="## Chapter One: Dust">
new text
</insert>
- position is "before" or "after".
- anchor is ONE of: a heading line exactly as listed in the outline (e.g. "## Chapter One: Dust"); a short exact quote (5–15 words) copied from the manuscript that appears only once; a passage id from the table; or "start" / "end" of the manuscript.
- The new text is placed as its own paragraph(s) immediately before/after the heading or the paragraph containing the quote.
- Write it in Markdown that matches the book: "> " lines for an epigraph or block quote (put the attribution on its own "> — Name" line), the same heading levels the book uses for new chapters, "***" for a scene break.

3) CHANGE or DELETE any existing text, even if it isn't on the table:
<change>
<find>exact text copied from the manuscript</find>
<replace>new text (leave empty to delete)</replace>
</change>
The <find> text must be copied exactly and be unique. Only quote text you have actually seen (on the table, in the context, or in the full manuscript). If you need text you can't see, ask the author to tick "Include whole manuscript" or put the passage on the table.

Use as many tags as the request needs. When the author supplies exact wording (e.g. a quote for an epigraph), use it verbatim. Keep discussion outside the tags short and useful. If the author is only asking a question, just answer it.`,
    ];
    if ($('#optMemory').checked) {
      const mem = await Memory.buildContext();
      if (mem.text) parts.push(`STORY MEMORY (reference material from the author)\n\n${mem.text}`);
      if (mem.images) parts.push(`PICTURES IN STORY MEMORY\n${mem.images}`);
      if (mem.truncated) {
        const bits = [];
        if (mem.trimmed.length) bits.push(`cut short: ${mem.trimmed.join(', ')}`);
        if (mem.skipped.length) bits.push(`left out: ${mem.skipped.join(', ')}`);
        toast(`Story memory is over your ${Memory.limit().toLocaleString()}-character limit, so the AI didn't see all of it (${bits.join('; ')}). Raise the limit in Settings or untick files in Story memory.`, true, 12000);
      }
      this._imageFiles = mem.imageFiles;
    } else this._imageFiles = [];
    if ($('#optFullBook').checked) {
      parts.push(`FULL MANUSCRIPT\n\n${Editor.text}`);
    } else {
      // Exact heading lines so the AI can use them as insert anchors.
      const ol = Editor.outline.map((h) => `${'#'.repeat(h.level)} ${h.title}   (${h.words} words)`).join('\n');
      if (ol) parts.push(`MANUSCRIPT OUTLINE (heading lines exactly as written)\n${ol}`);
      const first = Editor.outline[0];
      const opening = Editor.text.slice(0, Math.min(Editor.text.length, 1500));
      if (opening.trim()) parts.push(`OPENING OF THE MANUSCRIPT (first ${opening.length} characters)\n${opening}`);
      if (!first) parts.push('(The manuscript has no Markdown headings yet.)');
    }
    return parts.join('\n\n---\n\n');
  },

  passagesBlock() {
    const items = this.activeItems();
    if (!items.length) return '';
    const t = Editor.text;
    const blocks = items.map((it) => {
      Pool.resolve(it);
      const before = t.slice(Math.max(0, it.start - this.CONTEXT_CHARS), it.start);
      const after = t.slice(it.end, it.end + this.CONTEXT_CHARS);
      return `<passage id="${it.id}"${it.chapter ? ` chapter="${it.chapter.replace(/"/g, "'")}"` : ''}>
${it.note ? `Author's note: ${it.note}\n` : ''}<context_before>…${before}</context_before>
<target>${it.text}</target>
<context_after>${after}…</context_after>
</passage>`;
    });
    return `\n\n[Passages on the table — rewrite only the <target> text]\n${blocks.join('\n\n')}`;
  },

  async send() {
    if (this.busy) return;
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;
    if (!S.settings.providers.length) { toast('AI is optional. Add a provider in Settings when you want to send this message.', true, 6000); return Settings.open(); }
    input.value = '';
    await this.ask({ display: text });
  },

  // Send a message. display = what's shown and kept in the chat;
  // payload = what's actually sent this once (e.g. a whole chapter for a
  // beta read); system = a different instruction set (beta readers).
  async ask({ display, payload = null, system = null, by = '' }) {
    if (this.busy) return;
    if (!S.settings.providers.length) {
      toast('Add an AI provider in Settings first', true);
      return Settings.open();
    }
    const providerId = $('#providerSelect').value || S.settings.activeProviderId;
    const provider = S.settings.providers.find((p) => p.id === providerId);
    S.project.chat.push({ role: 'user', content: display, items: payload ? [] : [...(S.project.meta.negotiate || [])], at: Date.now() });
    markDirty(true);
    this.renderChat();
    this.busy = true;
    $('#btnSend').disabled = true;
    const thinking = el('div', { class: 'msg assistant thinking' }, el('div', { class: 'who' }, by || 'AI'), el('div', { class: 'body' }, 'Thinking'));
    $('#chatLog').append(thinking);
    thinking.scrollIntoView({ block: 'end' });

    try {
      const sys = system || await this.buildSystem();
      if (system) this._imageFiles = [];
      // Send prior turns as-is; attach live passages (or the payload) to the newest message.
      const history = S.project.chat
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-30)
        .map((m) => ({ role: m.role, content: m.content }));
      while (history.length && history[0].role !== 'user') history.shift(); // APIs require a user turn first
      const last = history[history.length - 1];
      last.content = payload ? `${last.content}\n\n${payload}` : last.content + this.passagesBlock();
      const res = await window.crucible.aiChat({
        providerId,
        system: sys,
        messages: history,
        bookPath: S.path,
        imageFiles: this._imageFiles,
      });
      if (res.ok) {
        const prov = provider;
        S.project.chat.push({ role: 'assistant', content: res.text, at: Date.now(), by: by ? `${by}${prov ? ` (${prov.name})` : ''}` : prov ? prov.name : '', applied: [] });
      } else {
        S.project.chat.push({ role: 'error', content: res.error, at: Date.now() });
      }
    } catch (e) {
      S.project.chat.push({ role: 'error', content: e.message, at: Date.now() });
    } finally {
      this.busy = false;
      $('#btnSend').disabled = false;
      markDirty(true);
      this.renderChat();
    }
  },

  // Split AI text into prose and edit blocks (<revision>, <insert>, <change>).
  parse(text) {
    const out = [];
    const trimNL = (s) => s.replace(/^\n+|\n+$/g, '');
    const attr = (s, name) => {
      const m = s.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
      return m ? (m[1] ?? m[2] ?? m[3]) : '';
    };
    const re = /<revision\s+id\s*=\s*["']?([\w-]+)["']?\s*>([\s\S]*?)<\/revision>|<insert\b([^>]*)>([\s\S]*?)<\/insert>|<change\b[^>]*>\s*<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>\s*<\/change>/gi;
    let last = 0, m;
    const prose = (s) => { if (s.trim() && !/^\s*```[\w-]*\s*$/.test(s)) out.push({ type: 'prose', text: s }); };
    while ((m = re.exec(text))) {
      prose(text.slice(last, m.index));
      if (m[1] !== undefined) out.push({ type: 'revision', id: m[1], text: trimNL(m[2]) });
      else if (m[3] !== undefined) {
        let body = m[4], anchor = attr(m[3], 'anchor');
        const inner = body.match(/<anchor>([\s\S]*?)<\/anchor>/i);
        if (inner) { anchor = anchor || inner[1].trim(); body = body.replace(inner[0], ''); }
        const pos = (attr(m[3], 'position') || 'after').toLowerCase().startsWith('b') ? 'before' : 'after';
        out.push({ type: 'insert', position: pos, anchor, text: trimNL(body) });
      } else out.push({ type: 'change', find: trimNL(m[5]), text: trimNL(m[6]) });
      last = re.lastIndex;
    }
    prose(text.slice(last));
    return out;
  },

  renderChat() {
    const log = $('#chatLog');
    log.innerHTML = '';
    if (!S.project.chat.length) {
      log.append(el('div', { class: 'empty' },
        'Put passages on the table from the Change pool (or right-click → "Negotiate this with AI now"), then tell the AI what you want: ',
        el('br'), el('br'),
        el('em', {}, '"Make this tenser — she shouldn\'t say outright that she knows."'),
        el('br'), el('br'),
        'You can also ask for new material anywhere: ',
        el('em', {}, '"Add this epigraph before Chapter One: …"'),
        el('br'), el('br'),
        'Every proposed edit shows up as a card you can check and apply.'));
      return;
    }
    S.project.chat.forEach((m, mi) => {
      if (m.role === 'user') {
        log.append(el('div', { class: 'msg user' }, el('div', { class: 'who' }, 'You'), el('div', { class: 'body' }, m.content)));
        return;
      }
      if (m.role === 'error') {
        log.append(el('div', { class: 'msg error' }, el('div', { class: 'who' }, 'Error'), el('div', { class: 'body' }, m.content)));
        return;
      }
      const body = el('div', { class: 'body' });
      this.parse(m.content).forEach((part, pi) => {
        if (part.type === 'prose') {
          if (part.text.trim()) body.append(el('div', { html: sanitizeHtml(marked.parse(part.text)) }));
        } else if (part.type === 'revision') body.append(this.revisionCard(part, m, `${mi}:${pi}`));
        else body.append(this.editCard(part, m, `${mi}:${pi}`));
      });
      log.append(el('div', { class: 'msg assistant' }, el('div', { class: 'who' }, m.by || 'AI'), body));
    });
    log.scrollTop = log.scrollHeight;
  },

  revisionCard(part, msg, key) {
    const item = Pool.get(part.id);
    const applied = (msg.applied || []).includes(key);
    const card = el('div', { class: `revision ${applied ? 'applied' : ''}` });
    const diffBox = el('div', { class: 'rv-diff hidden' });
    const label = item ? `Rewrite · ${snippet(item.text, 40)}` : part.id === 'new' ? 'Suggested wording' : 'Rewrite (passage not in pool)';
    card.append(
      el('div', { class: 'rv-head' },
        el('span', {}, applied ? '✓ Applied' : label),
        el('span', { class: 'spacer' }),
        item ? el('button', {
          class: 'small', onclick: () => {
            if (diffBox.classList.toggle('hidden')) return;
            const html = diffWordsHtml(item.status === 'applied' && applied ? (item.history?.slice(-1)[0]?.text || item.text) : item.text, part.text);
            diffBox.innerHTML = html ?? '<em>Too long to compare.</em>';
          },
        }, 'Diff') : null,
        el('button', { class: 'small', onclick: () => { navigator.clipboard.writeText(part.text); toast('Copied'); } }, 'Copy'),
        !item && !applied ? el('button', { class: 'small', title: 'Insert at the cursor in the manuscript', onclick: () => this.insertAtCursor(part.text, msg, key) }, 'Insert at cursor') : null,
        item && !applied ? el('button', {
          class: 'small accent', onclick: () => {
            Pool.apply(item.id, part.text);
            msg.applied = [...(msg.applied || []), key];
            this.renderChat();
          },
        }, 'Apply') : null),
      el('div', { class: 'rv-body' }, part.text),
      diffBox);
    return card;
  },

  // ------------------------------------------------- insert / change cards --
  locate(part) {
    if (part.type === 'insert') {
      const at = TextOps.findAnchor(Editor.text, part.anchor, S.project.pool);
      return at ? { at, ...TextOps.blockInsert(Editor.text, at, part.position, part.text) } : null;
    }
    const f = TextOps.findLoose(Editor.text, part.find);
    return f ? { start: f.start, end: f.end, ambiguous: f.count > 1 } : null;
  },

  editCard(part, msg, key) {
    const appliedId = (msg.appliedItems || {})[key];
    const applied = (msg.applied || []).includes(key);
    const isInsert = part.type === 'insert';
    const loc = applied ? null : this.locate(part);
    const card = el('div', { class: `revision ${applied ? 'applied' : ''} ${!applied && !loc ? 'unplaced' : ''}` });
    const where = isInsert
      ? `${part.position === 'before' ? 'Add before' : 'Add after'} ${/^(start|end)$/i.test(part.anchor) ? `the ${part.anchor.toLowerCase()} of the book` : `“${snippet(part.anchor, 48)}”`}`
      : part.text ? `Change “${snippet(part.find, 48)}”` : `Delete “${snippet(part.find, 48)}”`;
    const status = applied ? '✓ Applied' : !loc ? `⚠ ${isInsert ? "Can't find where to put this" : "Can't find that text"}` : '';
    const diffBox = el('div', { class: 'rv-diff hidden' });
    const btn = (label, fn, cls = 'small') => el('button', { class: cls, onclick: fn }, label);

    card.append(el('div', { class: 'rv-head' },
      el('span', { class: 'rv-where', title: isInsert ? part.anchor : part.find }, status ? `${status} · ${where}` : where),
      el('span', { class: 'spacer' }),
      !isInsert && !applied ? btn('Diff', () => {
        if (diffBox.classList.toggle('hidden')) return;
        diffBox.innerHTML = diffWordsHtml(part.find, part.text) ?? '<em>Too long to compare.</em>';
      }) : null,
      !applied && loc ? btn('Show', () => {
        const l = this.locate(part);
        if (!l) return toast('That spot has moved — not found any more', true);
        if (isInsert) Editor.reveal(l.pos, l.pos); else Editor.reveal(l.start, l.end);
      }) : null,
      applied && appliedId ? btn('Go to', () => { const it = Pool.get(appliedId); if (it) Pool.goTo(it); }) : null,
      btn('Copy', () => { navigator.clipboard.writeText(part.text); toast('Copied'); }),
      !applied && isInsert && part.text ? btn('Insert at cursor', () => this.insertAtCursor(part.text, msg, key)) : null,
      !applied && loc ? btn('Apply', () => this.applyEdit(part, msg, key), 'small accent') : null));
    if (part.text) card.append(el('div', { class: 'rv-body' }, part.text));
    else card.append(el('div', { class: 'rv-body muted' }, el('del', {}, part.find)));
    if (!applied && loc?.ambiguous) card.append(el('div', { class: 'rv-note' }, 'That text appears more than once. Apply will use the first one. Press Show to check it.'));
    card.append(diffBox);
    return card;
  },

  markApplied(msg, key, itemId) {
    msg.applied = [...(msg.applied || []), key];
    if (itemId) msg.appliedItems = { ...(msg.appliedItems || {}), [key]: itemId };
    markDirty(true);
    this.renderChat();
  },

  applyEdit(part, msg, key) {
    const loc = this.locate(part);
    if (!loc) return toast("Can't find that spot in the manuscript any more", true);
    let start, end, newText, oldText;
    if (part.type === 'insert') {
      Editor.replaceRange(loc.pos, loc.pos, loc.insert);
      start = loc.bodyStart; end = loc.bodyEnd; oldText = ''; newText = Editor.text.slice(start, end);
    } else {
      oldText = Editor.text.slice(loc.start, loc.end);
      Editor.replaceRange(loc.start, loc.end, part.text);
      start = loc.start; end = loc.start + part.text.length; newText = part.text;
    }
    const id = Pool.logAiEdit({
      kind: part.type, start, end, text: newText, oldText,
      note: part.type === 'insert' ? `Added by AI (${part.position} “${snippet(part.anchor, 40)}”)` : newText ? 'Changed by AI' : 'Deleted by AI',
    });
    this.markApplied(msg, key, id);
    if (newText) Editor.reveal(start, end); else Editor.reveal(start, start);
    toast(part.type === 'insert' ? 'Added — Ctrl+Z in the manuscript undoes it' : 'Changed — Ctrl+Z in the manuscript undoes it');
  },

  insertAtCursor(text, msg, key) {
    const s = Editor.selection();
    Editor.replaceRange(s.start, s.end, text);
    const id = Pool.logAiEdit({ kind: 'insert', start: s.start, end: s.start + text.length, text, oldText: s.text, note: 'Added by AI at cursor' });
    this.markApplied(msg, key, id);
    Editor.reveal(s.start, s.start + text.length);
  },
};
