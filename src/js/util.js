// =============================================================================
// util.js — small helpers shared by every module
// =============================================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Build an element: el('div', {class:'x', onclick: fn}, 'text', childEl, ...)
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = !!v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

// Convert a disk path (Windows or POSIX) into a file:// URL the window can load.
function fileUrl(p) {
  if (!p || isNetworkPath(p)) return ''; // never load files from other computers
  let s = p.replace(/\\/g, '/');
  if (!s.startsWith('/')) s = '/' + s;
  return 'file://' + encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

// Turn a stored media reference into something <img>/<audio> can load.
// Desktop: a disk path -> file:// URL. Browser: a reference -> blob: URL.
async function mediaUrl(p) {
  return window.crucible.urlFor ? window.crucible.urlFor(p) : fileUrl(p);
}

// Pickers return either plain paths (desktop) or {path, name} (browser).
function asPick(p) {
  if (!p) return null;
  return typeof p === 'string' ? { path: p, name: baseName(p) } : p;
}

function baseName(p) {
  return (p || '').split(/[\\/]/).pop();
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function countWords(s) {
  s = s || '';
  if (s.includes(':::')) s = s.replace(/^:::.*$/gm, ''); // alignment markers aren't words
  if (s.includes('<!--')) s = s.replace(/<!--[\s\S]*?-->/g, ''); // nor are hidden comments
  const m = s.match(/[A-Za-z0-9\u00C0-\u024F'’-]+/g);
  return m ? m.length : 0;
}

function fmtTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function snippet(s, n = 160) {
  s = (s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

let toastTimer;
function toast(msg, isErr = false, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), ms);
}

// ------------------------------------------------------------------ modals --
// openModal({title, body: Node, buttons:[{label, accent, onClick -> false keeps open}], wide})
function openModal({ title, body, buttons = [{ label: 'Close' }], wide = false, cls = '', onClose = null }) {
  const back = el('div', { class: 'modal-back' });
  let closed = false;
  const close = () => { back.remove(); if (!closed) { closed = true; onClose?.(); } };
  const footer = el('footer');
  for (const b of buttons) {
    footer.append(el('button', {
      class: (b.accent ? 'accent ' : '') + (b.cls || ''),
      onclick: async () => {
        const r = b.onClick ? await b.onClick(close) : undefined;
        if (r !== false) close();
      },
    }, b.label));
  }
  const modal = el('div', { class: `modal ${wide ? 'wide' : ''} ${cls}` },
    title ? el('header', {}, title) : null,
    el('div', { class: 'mbody' }, body),
    buttons.length ? footer : null);
  back.append(modal);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey, true); }
  };
  document.addEventListener('keydown', onKey, true);
  $('#modalRoot').append(back);
  setTimeout(() => modal.querySelector('input,textarea,select')?.focus(), 30);
  return { close, modal };
}

function promptModal(title, label, initial = '', multiline = false) {
  return new Promise((resolve) => {
    const input = multiline
      ? el('textarea', { rows: 4, style: 'width:100%' })
      : el('input', { style: 'width:100%' });
    input.value = initial;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const { close } = openModal({
      title,
      body: el('div', {}, label ? el('p', { class: 'muted' }, label) : null, input),
      buttons: [
        { label: 'Cancel', onClick: () => finish(null) },
        { label: 'OK', accent: true, onClick: () => finish(input.value) },
      ],
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (!multiline || e.ctrlKey)) { e.preventDefault(); finish(input.value); close(); }
    });
    // Resolve null if the modal is dismissed another way.
    const obs = new MutationObserver(() => { if (!document.body.contains(input)) { finish(null); obs.disconnect(); } });
    obs.observe($('#modalRoot'), { childList: true });
  });
}

function confirmModal(title, message, okLabel = 'OK') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openModal({
      title,
      body: el('p', {}, message),
      buttons: [
        { label: 'Cancel', onClick: () => finish(false) },
        { label: okLabel, accent: true, onClick: () => finish(true) },
      ],
    });
    const obs = new MutationObserver(() => { if (!$('#modalRoot').children.length) { finish(false); obs.disconnect(); } });
    obs.observe($('#modalRoot'), { childList: true });
  });
}

// --------------------------------------------------------------- word diff --
// Word-level diff (longest common subsequence) used to show what an AI
// revision changes. Returns HTML with <del>/<ins>.
function diffWordsHtml(a, b) {
  const A = a.split(/(\s+)/);
  const B = b.split(/(\s+)/);
  if (A.length * B.length > 4_000_000) return null; // too big to diff quickly
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // Walk the table into a list of operations: '=' same, '-' removed, '+' added.
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push(['=', A[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['-', A[i++]]);
    else ops.push(['+', B[j++]]);
  }
  while (i < n) ops.push(['-', A[i++]]);
  while (j < m) ops.push(['+', B[j++]]);

  // Group each run of changes into one removed phrase + one added phrase.
  // Unchanged spaces between two changes are absorbed into the run.
  let out = '', del = '', ins = '';
  const flush = () => {
    if (del) out += `<del>${escapeHtml(del)}</del>`;
    if (ins) out += `<ins>${escapeHtml(ins)}</ins>`;
    del = ins = '';
  };
  for (let k = 0; k < ops.length; k++) {
    const [op, tok] = ops[k];
    if (op === '-') del += tok;
    else if (op === '+') ins += tok;
    else if ((del || ins) && /^\s+$/.test(tok) && ops[k + 1] && ops[k + 1][0] !== '=') { del += tok; ins += tok; }
    else { flush(); out += escapeHtml(tok); }
  }
  flush();
  return out;
}

// -------------------------------------------------------------- safety --
// Every piece of HTML made from a manuscript, a note or an AI reply passes
// through here before it is shown or exported. It uses DOMPurify (a widely
// audited sanitizer) with an ALLOW-list: only the plain formatting tags that
// Markdown produces survive, with a handful of harmless attributes. No
// scripts, styles, frames, forms, SVG, <template> or <base>; no event
// handlers; links only to web pages, e-mail or anchors; pictures only from
// the book's own folder or embedded data.
const SAFE_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'em', 'strong', 'b', 'i', 'u', 's', 'del', 'ins', 'sub', 'sup',
  'small', 'mark', 'blockquote', 'hr', 'br', 'img', 'ul', 'ol', 'li', 'pre', 'code', 'div', 'span', 'a', 'table', 'thead',
  'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'abbr', 'kbd', 'q', 'cite', 'dl', 'dt', 'dd', 'figure', 'figcaption'];
const SAFE_ATTRS = ['href', 'title', 'alt', 'src', 'class', 'colspan', 'rowspan', 'start', 'align'];
// A safe picture source: a relative path inside the book folder (no scheme,
// no leading slash or backslash, so never another computer on the network),
// or an image embedded as data.
const safeImgSrc = (v) => /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]*$/i.test(v)
  || (!!v && !/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[\\/]/.test(v) && !/[\\]/.test(v) && !/^\s*$/.test(v));
const safeHref = (v) => /^(?:https?:\/\/|mailto:|#)/i.test(v);
let purifyReady = false;
function sanitizeHtml(html) {
  const P = window.DOMPurify;
  if (!P || !P.isSupported) return escapeHtml(html); // never fall back to raw HTML
  if (!purifyReady) {
    P.addHook('afterSanitizeAttributes', (n) => {
      if (n.hasAttribute('href')) {
        const v = n.getAttribute('href').replace(/[\u0000- ]/g, '');
        if (safeHref(v)) n.setAttribute('href', v); else n.removeAttribute('href');
      }
      if (n.hasAttribute('src') && !(n.tagName === 'IMG' && safeImgSrc(n.getAttribute('src').trim()))) n.removeAttribute('src');
      if (n.tagName === 'A' && /^https?:/i.test(n.getAttribute('href') || '')) n.setAttribute('rel', 'noopener noreferrer');
    });
    purifyReady = true;
  }
  return P.sanitize(String(html), {
    ALLOWED_TAGS: SAFE_TAGS, ALLOWED_ATTR: [...SAFE_ATTRS, 'rel'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|data:image\/|(?![a-z][a-z0-9+.-]*:))/i,
    KEEP_CONTENT: true, SAFE_FOR_TEMPLATES: false, RETURN_TRUSTED_TYPE: false,
  });
}

// A path that points at another computer (\\server\share, //server, or
// file://server/…). Windows would contact that server, and hand over the
// user's login credentials, just to check the file exists, so Crucible
// never touches such paths.
function isNetworkPath(p) {
  return typeof p === 'string' && (/^[\\/]{2}/.test(p) || /^file:\/\/(?!\/)[^/]/i.test(p) || /^file:\/{4,}/i.test(p));
}

// Heading text without the trailing spaces/#s. Done by hand rather than with
// a regex, because a regex like (.+?)[ \t#]*$ takes minutes on a single
// enormous line (a doctored manuscript could freeze Crucible that way).
function headTitle(raw) {
  let e = raw.length;
  while (e > 0 && (raw[e - 1] === ' ' || raw[e - 1] === '\t' || raw[e - 1] === '#' || raw[e - 1] === '\r')) e--;
  return e ? raw.slice(0, e) : raw;
}

// Pure helpers used by the editor; kept here so they can be unit-tested.
const TextOps = {
  // Find the changed region between two versions of the text.
  changedRegion(oldT, newT) {
    let p = 0;
    const minLen = Math.min(oldT.length, newT.length);
    while (p < minLen && oldT.charCodeAt(p) === newT.charCodeAt(p)) p++;
    let s = 0;
    while (s < minLen - p && oldT.charCodeAt(oldT.length - 1 - s) === newT.charCodeAt(newT.length - 1 - s)) s++;
    return { start: p, oldEnd: oldT.length - s, newEnd: newT.length - s };
  },

  // Move a stored {start,end} range so it still points at the same words after an edit.
  shiftRange(r, ch) {
    const delta = (ch.newEnd - ch.start) - (ch.oldEnd - ch.start);
    if (r.end <= ch.start) return r;                                   // edit is after the range
    if (r.start >= ch.oldEnd) return { start: r.start + delta, end: r.end + delta }; // edit is before
    if (ch.start >= r.start && ch.oldEnd <= r.end) return { start: r.start, end: r.end + delta }; // edit inside
    // partial overlap: stretch the range to cover the edited span
    return { start: Math.min(r.start, ch.start), end: Math.max(ch.newEnd, r.end + delta) };
  },

  // Find where a stored passage is now. Prefers the stored offset, else the
  // occurrence closest to it.
  locate(text, item) {
    if (!item.text) return null;
    if (text.substr(item.start, item.text.length) === item.text) return item.start;
    let best = null, idx = text.indexOf(item.text);
    while (idx !== -1) {
      if (best === null || Math.abs(idx - item.start) < Math.abs(best - item.start)) best = idx;
      idx = text.indexOf(item.text, idx + 1);
    }
    return best;
  },

  // Headings → outline entries with offsets and section word counts.
  outline(text) {
    const out = [];
    const re = /^(#{1,3})[ \t]+([^\n]+)/gm;
    let m;
    while ((m = re.exec(text))) out.push({ level: m[1].length, title: headTitle(m[2]), offset: m.index });
    out.forEach((h, i) => {
      const end = i + 1 < out.length ? out[i + 1].offset : text.length;
      h.words = countWords(text.slice(h.offset + h.title.length + h.level + 1, end));
    });
    return out;
  },

  // Find text even if the AI changed curly/straight quotes, dashes or spacing.
  // Returns {start, end, count} in the ORIGINAL text, or null.
  findLoose(text, needle) {
    if (!needle) return null;
    let i = text.indexOf(needle);
    if (i !== -1) {
      let count = 0, j = i;
      while (j !== -1) { count++; j = text.indexOf(needle, j + 1); }
      return { start: i, end: i + needle.length, count };
    }
    const norm = (c) => ({ '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', ' ': ' ' }[c] || c);
    // Normalized copy of the text, remembering where each char came from.
    let nt = '';
    const map = [];
    for (let k = 0; k < text.length; k++) {
      const c = norm(text[k]);
      if (/\s/.test(c)) {
        if (nt.endsWith(' ')) continue;
        nt += ' ';
      } else nt += c;
      map.push(k);
    }
    const nn = [...needle].map(norm).join('').replace(/\s+/g, ' ').trim();
    if (!nn) return null;
    i = nt.indexOf(nn);
    if (i === -1) return null;
    let count = 0, j = i;
    while (j !== -1) { count++; j = nt.indexOf(nn, j + 1); }
    return { start: map[i], end: map[i + nn.length - 1] + 1, count };
  },

  // Resolve an AI-supplied anchor to a range in the manuscript.
  // anchor: "start" | "end" | pool item id | heading line/title | exact quote
  findAnchor(text, anchor, poolItems = []) {
    const a = (anchor || '').trim();
    if (!a) return null;
    if (/^(start|beginning|top)$/i.test(a)) return { start: 0, end: 0, kind: 'start' };
    if (/^(end|bottom)$/i.test(a)) return { start: text.length, end: text.length, kind: 'end' };
    const item = poolItems.find((p) => p.id === a);
    if (item) {
      const pos = TextOps.locate(text, item);
      if (pos !== null) return { start: pos, end: pos + item.text.length, kind: 'passage' };
    }
    // Heading: "## Chapter One: Dust" or just "Chapter One: Dust"
    const hm = a.slice(0, 2000).match(/^(#{1,6})?[ \t]*([^\n]+)/) || [null, null, a];
    const wantLevel = hm[1] ? hm[1].length : 0;
    const title = headTitle(hm[2]).trim().toLowerCase();
    const re = /^(#{1,6})[ \t]+([^\n]+)/gm;
    let m, best = null;
    while ((m = re.exec(text))) {
      if (headTitle(m[2]).trim().toLowerCase() === title) {
        const hit = { start: m.index, end: m.index + m[0].length, kind: 'heading' };
        if (!wantLevel || m[1].length === wantLevel) return hit;
        best = best || hit;
      }
    }
    if (best) return best;
    const q = TextOps.findLoose(text, a.replace(/^["“']|["”']$/g, ''));
    return q ? { start: q.start, end: q.end, kind: 'quote', ambiguous: q.count > 1 } : null;
  },

  // Where a new block goes, and the exact string to insert so it ends up as
  // its own paragraph(s) with blank lines around it.
  blockInsert(text, at, position, content) {
    let pos;
    if (at.kind === 'start') pos = 0;
    else if (at.kind === 'end') pos = text.length;
    else if (at.kind === 'heading') {
      pos = position === 'after' ? at.end : text.lastIndexOf('\n', at.start - 1) + 1;
    } else {
      const para = position === 'after' ? TextOps.paragraphAt(text, at.end) : TextOps.paragraphAt(text, at.start);
      pos = position === 'after' ? para.end : para.start;
    }
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    const trailingNL = (before.match(/\n*$/) || [''])[0].length;
    const leadingNL = (after.match(/^\n*/) || [''])[0].length;
    const body = content.replace(/^\n+|\s+$/g, '');
    const lead = before.trim() ? '\n'.repeat(Math.max(0, 2 - trailingNL)) : '';
    const trail = after.trim() ? '\n'.repeat(Math.max(0, 2 - leadingNL)) : (after.length ? '' : '\n');
    return { pos, insert: lead + body + trail, bodyStart: pos + lead.length, bodyEnd: pos + lead.length + body.length };
  },

  // Paragraph (blank-line separated block) around an offset.
  paragraphAt(text, pos) {
    let s = text.lastIndexOf('\n\n', Math.max(0, pos - 1));
    s = s === -1 ? 0 : s + 2;
    let e = text.indexOf('\n\n', pos);
    e = e === -1 ? text.length : e;
    return { start: s, end: e };
  },
};

// ------------------------------------------------------------ alignment --
// Alignment is stored as Pandoc-style fenced blocks, readable in any editor:
//   ::: center
//   The End
//   :::
// "left" = normal text (no block). Supported: center, right (and justify).
const Align = {
  RE: /^:::[ \t]*(left|center|centre|right|justify)[ \t]*\n([\s\S]*?)\n:::[ \t]*$/gim,
  norm: (a) => { a = a.toLowerCase(); return a === 'centre' ? 'center' : a; },

  // Before Markdown → HTML: blocks become <div class="align-x">, with blank
  // lines around the inner text so it's still parsed as Markdown.
  toHtmlMd(md) {
    if (!md.includes(':::')) return md;
    return md.replace(this.RE, (_m, a, inner) => `<div class="align-${this.norm(a)}">\n\n${inner}\n\n</div>`);
  },

  // All alignment blocks: [{start, end, align, innerStart, innerEnd}]
  blocks(text) {
    if (!text.includes(':::')) return [];
    const out = [];
    this.RE.lastIndex = 0;
    let m;
    while ((m = this.RE.exec(text))) {
      const open = m[0].indexOf('\n') + 1;
      out.push({ start: m.index, end: m.index + m[0].length, align: this.norm(m[1]), innerStart: m.index + open, innerEnd: m.index + open + m[2].length });
    }
    return out;
  },

  at(text, start, end = start) {
    return this.blocks(text).find((b) => b.start <= start && end <= b.end) || null;
  },

  // Work out the edit for aligning the paragraph(s) covering start..end.
  // Returns {from, to, insert, selStart, selEnd} or {error}.
  plan(text, start, end, align) {
    const b = this.at(text, start, end);
    if (b) {
      const inner = text.slice(b.innerStart, b.innerEnd);
      if (align === 'left') return { from: b.start, to: b.end, insert: inner, selStart: b.start, selEnd: b.start + inner.length };
      if (align === b.align) return { error: `Already ${align === 'center' ? 'centered' : 'aligned ' + align}.` };
      const head = `::: ${align}\n`;
      const repl = head + inner + '\n:::';
      return { from: b.start, to: b.end, insert: repl, selStart: b.start + head.length, selEnd: b.start + head.length + inner.length };
    }
    if (align === 'left') return { error: 'That text is already normal (left) aligned.' };
    let a = TextOps.paragraphAt(text, start).start;
    let z = TextOps.paragraphAt(text, Math.max(start, end > start ? end - 1 : end)).end;
    while (z > a && /\s/.test(text[z - 1])) z--; // keep trailing blank lines outside the block
    while (a < z && text[a] === '\n') a++;
    const slice = text.slice(a, z);
    if (!slice.trim()) return { error: 'Put the cursor in a paragraph first.' };
    if (/^#{1,6}\s/.test(slice.trim())) return { error: 'Headings are already centered in the book.' };
    if (slice.includes(':::')) return { error: 'Part of that text is already aligned. Align it separately.' };
    const head = `::: ${align}\n`;
    return { from: a, to: z, insert: `${head}${slice}\n:::`, selStart: a + head.length, selEnd: a + head.length + slice.length };
  },
};

// ------------------------------------------------------------- chapters --
// The Chapter builder works on a model of the book:
//   preamble   everything before the first chapter heading (title, epigraph…)
//   chapters[] { title, image, rest, raw }
// A chapter is a heading at the "chapter level" (# or ##) plus everything up
// to the next heading at that level (so ### scenes stay inside it).
// A chapter image is a normal Markdown image line right under the heading:
//   ## Chapter One: Dust
//
//   ![chapter-image](images/chapter-ab12cd.png)
// Unchanged chapters are written back byte-for-byte, so opening the builder and
// pressing Apply without edits changes nothing.
const ChapterOps = {
  IMG_RE: /^\n+!\[chapter-image\]\(([^)\s]*)\)[ \t]*(?=\n|$)/,

  // Chapters are ## when the book has one # title and ## headings under it.
  detectLevel(text) {
    const hs = TextOps.outline(text);
    const l1 = hs.filter((h) => h.level === 1).length;
    const l2 = hs.filter((h) => h.level === 2).length;
    if (l1 <= 1 && l2 >= 1) return 2;
    if (l1 >= 1) return 1;
    return 2;
  },

  encodeImg: (rel) => rel.split('/').map(encodeURIComponent).join('/'),
  decodeImg(src) {
    try { return src.split('/').map(decodeURIComponent).join('/'); } catch { return src; }
  },

  parse(text, level) {
    const re = new RegExp(`^#{${level}}[ \\t]+([^\\n]+)`, 'gm');
    const heads = [];
    let m;
    while ((m = re.exec(text))) heads.push({ start: m.index, lineEnd: m.index + m[0].length, title: headTitle(m[1]) });
    const chapters = heads.map((h, i) => {
      const end = i + 1 < heads.length ? heads[i + 1].start : text.length;
      const after = text.slice(h.lineEnd, end);
      const im = after.match(this.IMG_RE);
      const image = im ? this.decodeImg(im[1]) : null;
      return {
        key: `c${i}`, title: h.title, origTitle: h.title, image, origImage: image,
        raw: text.slice(h.start, end), rest: im ? after.slice(im[0].length) : after, dirty: false,
      };
    });
    return { level, origLevel: level, preamble: text.slice(0, heads.length ? heads[0].start : text.length), chapters };
  },

  isChanged(c, model) {
    return c.dirty || c.raw == null || c.title !== c.origTitle || c.image !== c.origImage || model.level !== model.origLevel;
  },

  build(model) {
    let out = model.preamble;
    for (const c of model.chapters) {
      if (out && !out.endsWith('\n\n')) out = out.replace(/\n*$/, '\n\n');
      if (!this.isChanged(c, model)) { out += c.raw; continue; }
      const title = (c.title || '').replace(/\s+/g, ' ').trim() || 'Untitled chapter';
      let rest = c.rest == null ? '\n\n' : c.rest;
      if (rest && !rest.startsWith('\n')) rest = '\n\n' + rest;
      out += `${'#'.repeat(model.level)} ${title}`
        + (c.image ? `\n\n![chapter-image](${this.encodeImg(c.image)})` : '')
        + rest;
    }
    return out;
  },

  newChapter(title) {
    return { key: `n${Math.random().toString(36).slice(2, 8)}`, title, origTitle: null, image: null, origImage: null, raw: null, rest: '\n\n', dirty: true };
  },

  // Remove a chapter heading but keep its text (joins the previous chapter).
  mergeIntoPrevious(model, i) {
    const c = model.chapters[i];
    const body = c.rest.replace(/^\n+/, '');
    if (i === 0) {
      model.preamble = model.preamble.replace(/\n*$/, model.preamble.trim() ? '\n\n' : '') + body;
    } else {
      const prev = model.chapters[i - 1];
      prev.rest = prev.rest.replace(/\n*$/, '\n\n') + body;
      prev.dirty = true;
    }
    model.chapters.splice(i, 1);
  },

  // ----- numbering
  ONES: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'],
  TENS: ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'],
  numberWord(n) {
    const cap = (w) => w.split('-').map((x) => x[0].toUpperCase() + x.slice(1)).join('-');
    if (n < 20) return cap(this.ONES[n]);
    if (n < 100) return cap(this.TENS[Math.floor(n / 10)] + (n % 10 ? '-' + this.ONES[n % 10] : ''));
    return String(n);
  },
  // "Chapter 3: Dust", "Chapter Three - Dust", "3. Dust" → "Dust"
  stripNumber(title) {
    const word = `(?:${this.TENS.slice(2).join('|')})(?:[- ](?:${this.ONES.slice(1, 10).join('|')}))?|${this.ONES.join('|')}`;
    const num = `(?:\\d+|${word})`;
    const re = new RegExp(`^(?:chapter\\s+${num}\\b\\s*(?:[:.\\-—–]\\s*)?|${num}\\s*[:.\\-—–]\\s+)`, 'i');
    return title.replace(re, '').trim();
  },
  numbered(title, n, style) {
    const rest = this.stripNumber(title);
    if (style === 'chapter-num') return rest ? `Chapter ${n}: ${rest}` : `Chapter ${n}`;
    if (style === 'chapter-word') return rest ? `Chapter ${this.numberWord(n)}: ${rest}` : `Chapter ${this.numberWord(n)}`;
    if (style === 'num') return rest ? `${n}. ${rest}` : `${n}.`;
    if (style === 'none') return rest || `Chapter ${n}`;
    return title;
  },
};

// --------------------------------------------------------------- scenes --
// Scenes inside a chapter are separated by a sub-heading (### when chapters
// are ##) or a scene-break line (***, * * *, ---, ___). Text before the
// first separator is the chapter's opening scene.
// Scene details live in an invisible comment at the start of the scene:
//   <!-- scene when="1952-06-14" track="Past" summary="She finds the letter" color="red" -->
// It moves with the scene and never shows in previews or exports.
const SceneOps = {
  META_RE: /<!--\s*scene\b([^>]*?)-->/,
  BREAK_RE: /^[ \t]*(?:\*[ \t]*\*[ \t]*\*[ \t*]*|-{3,}[ \t]*|_{3,}[ \t]*)$/,
  FIELDS: ['when', 'track', 'summary', 'color'],

  parseMeta(body) {
    const m = (body || '').match(this.META_RE);
    const out = { when: '', track: '', summary: '', color: '' };
    if (!m) return out;
    for (const [, k, v] of m[1].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) {
      if (k in out) out[k] = v.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    }
    return out;
  },

  formatMeta(meta) {
    const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/--/g, '&#45;&#45;').replace(/\s+/g, ' ').trim();
    const parts = this.FIELDS.filter((k) => meta[k] && String(meta[k]).trim()).map((k) => `${k}="${esc(meta[k])}"`);
    return parts.length ? `<!-- scene ${parts.join(' ')} -->` : '';
  },

  // Put (or replace, or remove) the meta comment at the start of a body.
  withMeta(body, meta) {
    const line = this.formatMeta(meta);
    const lead = (body.match(/^\n*/) || [''])[0];
    let rest = body.slice(lead.length);
    const m = rest.match(new RegExp(`^[ \\t]*${this.META_RE.source}[ \\t]*\\n?`));
    if (m) rest = rest.slice(m[0].length).replace(/^\n+/, '');
    if (!line) return lead + rest;
    return `${lead || '\n\n'}${line}\n${rest ? '\n' + rest.replace(/^\n+/, '') : ''}`;
  },

  // Split a chapter's text (ChapterOps chapter.rest) into scenes.
  split(rest, subLevel) {
    const headRe0 = new RegExp(`^#{${subLevel}}[ \\t]+([^\\n]+)`);
    const headRe = { exec: (l) => { const m = headRe0.exec(l); if (m) m[1] = headTitle(m[1]); return m; } };
    const lines = rest.split('\n');
    const scenes = [];
    let cur = { kind: 'intro', head: '', title: '', lines: [] };
    for (const line of lines) {
      const h = headRe.exec(line);
      if (h || this.BREAK_RE.test(line)) {
        scenes.push(cur);
        cur = h ? { kind: 'heading', head: line, title: h[1], lines: [] } : { kind: 'break', head: line.trim(), title: '', lines: [] };
      } else cur.lines.push(line);
    }
    scenes.push(cur);
    const out = scenes.map((s) => ({ kind: s.kind, head: s.head, title: s.title, body: s.lines.join('\n') }));
    // Drop an empty opening before the first real scene.
    if (out.length > 1 && out[0].kind === 'intro' && !out[0].body.trim()) out.shift();
    out.forEach((s) => { s.meta = this.parseMeta(s.body); s.words = countWords(s.body.replace(this.META_RE, '')); });
    return out;
  },

  join(scenes, defaultBreak = '***') {
    const parts = scenes.map((s, i) => {
      const body = s.body.replace(/^\n+/, '').replace(/\s+$/, '');
      if (s.kind === 'heading') return s.head + (body ? '\n\n' + body : '');
      if (i === 0) return body;
      return (s.kind === 'break' && s.head ? s.head : defaultBreak) + (body ? '\n\n' + body : '');
    }).filter((p) => p !== '');
    return parts.length ? `\n\n${parts.join('\n\n')}\n\n` : '\n\n';
  },

  // The most common scene-break line in the book (for new breaks).
  breakStyle(text) {
    const counts = {};
    for (const l of text.split('\n')) if (this.BREAK_RE.test(l)) counts[l.trim()] = (counts[l.trim()] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '***';
  },

  // A label for a scene card.
  label(s) {
    if (s.title) return s.title;
    if (s.meta.summary) return s.meta.summary;
    const t = s.body.replace(this.META_RE, '').replace(/^:::.*$/gm, ' ').replace(/[#>*_`!\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
    return t.split(' ').slice(0, 10).join(' ') + (t.split(' ').length > 10 ? '…' : '');
  },

  // Sort key for an in-story date: 1952-06-14, 1952-06, 1952, 14:30 times,
  // "June 14, 1952", "Day 12". Returns null when it can't be read.
  dateKey(when) {
    const s = (when || '').trim();
    if (!s) return null;
    let m = s.match(/^(-?\d{1,6})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?(?:[ T,]+(\d{1,2}):(\d{2}))?/);
    if (m) return +m[1] * 1e8 + (+m[2] || 0) * 1e6 + (+m[3] || 0) * 1e4 + (+m[4] || 0) * 100 + (+m[5] || 0);
    m = s.match(/^day\s*(\d+)/i);
    if (m) return +m[1];
    const t = Date.parse(s);
    if (!Number.isNaN(t)) {
      const d = new Date(t);
      return d.getFullYear() * 1e8 + (d.getMonth() + 1) * 1e6 + d.getDate() * 1e4 + d.getHours() * 100 + d.getMinutes();
    }
    return null;
  },

  // Board model for the whole book: chapters, each with its scenes.
  board(text) {
    const level = ChapterOps.detectLevel(text);
    const model = ChapterOps.parse(text, level);
    const sub = Math.min(6, level + 1);
    model.chapters.forEach((c) => { c.scenes = this.split(c.rest, sub); c.scenesOrig = [...c.scenes]; });
    model.breakStyle = this.breakStyle(text);
    return model;
  },

  // Rebuild the text, touching only chapters whose scenes changed.
  buildBoard(model) {
    for (const c of model.chapters) {
      const same = c.scenes.length === c.scenesOrig.length && c.scenes.every((s, i) => s === c.scenesOrig[i] && !s.dirty);
      if (!same) { c.rest = this.join(c.scenes, model.breakStyle); c.dirty = true; }
    }
    return ChapterOps.build(model);
  },

  setMeta(scene, meta) {
    scene.meta = { ...scene.meta, ...meta };
    scene.body = this.withMeta(scene.body, scene.meta);
    scene.dirty = true;
  },
};

if (typeof module !== 'undefined') module.exports = { TextOps, ChapterOps, SceneOps, Align, diffWordsHtml, countWords, isNetworkPath };
