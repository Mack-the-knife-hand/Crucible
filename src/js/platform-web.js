// =============================================================================
// platform-web.js — lets Crucible run in a plain browser (Edge / Chrome)
// -----------------------------------------------------------------------------
// The desktop app gets `window.crucible` from preload.js (Electron). In a
// browser there is no Electron, so this file builds the SAME API on top of
// browser features. All the other modules don't know or care which one
// they're talking to.
//
// Two storage modes:
//
//  FOLDER MODE (Edge/Chrome — the normal case)
//    You pick the folder that holds your manuscript. Crucible reads and writes
//    the real .md file, and keeps its data in a "<Book>.crucible" folder beside
//    it — exactly the same layout as the desktop app, so both can open the
//    same book. Browsers ask you to re-allow access to the folder once per
//    session; that's a browser security rule, not something Crucible controls.
//
//  BROWSER-STORAGE MODE (fallback: Firefox/Safari, or if folder access is
//    blocked by policy)
//    The book lives inside the browser's own storage (IndexedDB). Use
//    "Download .md" to get the file out. Clearing browser data erases it.
//
// YOUR CRUCIBLE FOLDER (the "home" folder — e.g. the thumb-drive folder that
//    holds crucible.html). Once connected, Crucible keeps crucible-settings.json
//    there: settings are read from it at the start of each session and written
//    to it on every change, so they travel with the folder to any computer.
//    Books, songs and pictures inside this folder are remembered by their path
//    inside it ("home:Books/My Novel/My Novel.md"), so they work anywhere too.
//
// Media references (songs, linked pictures, memory photos) can't be stored as
// disk paths in a browser, so they're stored as short reference strings:
//    mem:<file>        a file in the open book's memory folder
//    h:<id>            a single file you picked (handle saved in IndexedDB)
//    df:<dirId>/<rel>  a song inside a music folder you added
//    sess:<id>         picked without folder access — this session only
//    home:<path>       a file inside your Crucible folder (portable)
// =============================================================================

(function () {
  if (window.crucible) return; // running inside the desktop app

  const hasFSA = typeof window.showDirectoryPicker === 'function';
  const idOf = () => Math.random().toString(36).slice(2, 10);
  const MAX_BACKUPS = 30;

  // ------------------------------------------------------------ IndexedDB --
  const DB = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('crucible', 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore('kv');   // settings, handles, recent
          r.result.createObjectStore('vfs');  // browser-storage-mode files
        };
        r.onsuccess = () => res((this._db = r.result));
        r.onerror = () => rej(r.error);
      });
    },
    async tx(store, mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error || new Error('Storage aborted (browser storage full?)'));
      });
    },
    get: (s, k) => DB.tx(s, 'readonly', (o) => o.get(k)),
    set: (s, k, v) => DB.tx(s, 'readwrite', (o) => o.put(v, k)),
    del: (s, k) => DB.tx(s, 'readwrite', (o) => o.delete(k)),
    keys: (s) => DB.tx(s, 'readonly', (o) => o.getAllKeys()),
  };

  async function ensurePerm(handle, mode = 'read') {
    if (!handle.queryPermission) return true;
    if ((await handle.queryPermission({ mode })) === 'granted') return true;
    try {
      return (await handle.requestPermission({ mode })) === 'granted';
    } catch {
      return false; // no user gesture available
    }
  }

  // ------------------------------------------------------- storage roots --
  // A "root" is the folder that holds the book. Same methods for both modes.
  class FolderRoot {
    constructor(dir) { this.dir = dir; this.kind = 'folder'; }
    async _parent(rel, create) {
      const parts = rel.split('/').filter(Boolean);
      const name = parts.pop();
      let d = this.dir;
      for (const p of parts) d = await d.getDirectoryHandle(p, { create });
      return { d, name };
    }
    async read(rel, blob = false) {
      try {
        const { d, name } = await this._parent(rel, false);
        const f = await (await d.getFileHandle(name)).getFile();
        return blob ? f : await f.text();
      } catch { return null; }
    }
    async write(rel, data) {
      const { d, name } = await this._parent(rel, true);
      const fh = await d.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
    }
    async list(relDir) {
      try {
        let d = this.dir;
        for (const p of relDir.split('/').filter(Boolean)) d = await d.getDirectoryHandle(p);
        const out = [];
        for await (const [name, h] of d.entries()) if (h.kind === 'file') out.push(name);
        return out;
      } catch { return []; }
    }
    async remove(rel) {
      try { const { d, name } = await this._parent(rel, false); await d.removeEntry(name); } catch { /* gone */ }
    }
    async exists(rel) { return (await this.read(rel, true)) !== null; }
  }

  class BrowserRoot {
    constructor(prefix) { this.prefix = prefix; this.kind = 'browser'; }
    async read(rel, blob = false) {
      const v = await DB.get('vfs', this.prefix + rel);
      if (v === undefined) return null;
      if (blob) return v instanceof Blob ? v : new Blob([v]);
      return v instanceof Blob ? v.text() : v;
    }
    write(rel, data) { return DB.set('vfs', this.prefix + rel, data); }
    async list(relDir) {
      const pre = this.prefix + relDir.replace(/\/?$/, '/');
      return (await DB.keys('vfs')).filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map((k) => k.slice(pre.length));
    }
    remove(rel) { return DB.del('vfs', this.prefix + rel); }
    async exists(rel) { return (await DB.get('vfs', this.prefix + rel)) !== undefined; }
  }

  // The open book: key looks like "Folder/Book.md" (also what you see in the UI).
  const books = new Map(); // key -> { root, file }
  const sidecarOf = (file) => file.replace(/\.[^.]+$/, '') + '.crucible';
  const bookOf = (key) => {
    const b = books.get(key);
    if (!b) throw new Error('That book is no longer open — open it again.');
    return b;
  };

  async function rememberBook(key, root, file) {
    books.set(key, { root, file });
    if (root.kind === 'folder') await DB.set('kv', 'book:' + key, { dir: root.dir, file });
    else await DB.set('kv', 'book:' + key, { browser: root.prefix, file });
    const s = await loadSettings();
    s.recent = [key, ...(s.recent || []).filter((r) => r !== key)].slice(0, 10);
    const rel = root.kind === 'folder' ? await inHome(root.dir) : null;
    if (rel) {
      const p = [...rel, file].join('/');
      s.recentHome = [p, ...(s.recentHome || []).filter((r) => r !== p)].slice(0, 10);
    }
    await DB.set('kv', 'settings', s);
    if (rel) await writeSettingsFile(s);
  }

  async function loadAt(key) {
    const { root, file } = bookOf(key);
    const text = await root.read(file);
    if (text === null) throw new Error(`Couldn't read ${file}`);
    let project = {};
    try { project = JSON.parse((await root.read(`${sidecarOf(file)}/project.json`)) || '{}'); } catch { /* fresh */ }
    return { path: key, text: text.replace(/\r\n/g, '\n'), project, sidecar: `${key.split('/')[0]}/${sidecarOf(file)}` };
  }

  // Simple choose-from-list modal (uses the shared modal helpers in util.js).
  function chooseFrom(title, items) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const list = el('div', { class: 'pick-list' });
      let m;
      items.forEach((it) => list.append(el('div', { class: 'mi', onclick: () => { finish(it); m.close(); } }, it)));
      m = openModal({ title, body: list, buttons: [{ label: 'Cancel', onClick: () => finish(null) }] });
      const obs = new MutationObserver(() => { if (!document.body.contains(list)) { finish(null); obs.disconnect(); } });
      obs.observe($('#modalRoot'), { childList: true });
    });
  }

  // <input type=file> picker for browsers without folder access.
  function inputPick({ accept = '', multiple = false } = {}) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept;
      inp.multiple = multiple;
      inp.onchange = () => resolve([...inp.files]);
      inp.addEventListener('cancel', () => resolve([]));
      inp.click();
    });
  }

  const isAbort = (e) => e && (e.name === 'AbortError');
  let folderBlocked = false; // set if the browser/policy refuses folder access
  const folderMode = () => hasFSA && !folderBlocked;

  async function pickDir(id) {
    try {
      return await window.showDirectoryPicker({ id, mode: 'readwrite', ...(home ? { startIn: home } : {}) });
    } catch (e) {
      if (isAbort(e)) return null;
      folderBlocked = true;
      toast('Folder access is blocked in this browser — using browser storage instead.', true, 6000);
      return undefined; // signals "fall back"
    }
  }

  // ------------------------------------------------------- home folder --
  const SETTINGS_FILE = 'crucible-settings.json';
  let home = null; // the connected Crucible folder (permission granted this session)
  const storedHome = async () => (await DB.get('kv', 'home'))?.handle || null;
  const homeRef = (parts) => 'home:' + parts.map(encodeURIComponent).join('/');
  const homeParts = (ref) => ref.slice(5).split('/').map(decodeURIComponent);
  async function inHome(handle) {
    if (!home || !handle || !home.resolve) return null;
    try { return await home.resolve(handle); } catch { return null; }
  }
  async function homeFile(parts) {
    if (!home) throw new Error('Open your Crucible folder first (it holds this file).');
    let d = home;
    const ps = [...parts];
    const name = ps.pop();
    for (const p of ps) d = await d.getDirectoryHandle(p);
    return d.getFileHandle(name);
  }
  async function homeDir(parts) {
    let d = home;
    for (const p of parts) d = await d.getDirectoryHandle(p);
    return d;
  }
  async function reachable(dir) {
    try {
      for await (const _ of dir.keys()) break; // eslint-disable-line no-unused-vars
      return true;
    } catch { return false; }
  }
  let writingFile = Promise.resolve();
  function writeSettingsFile(s) {
    if (!home) return Promise.resolve();
    const data = SettingsCore.portableSettings(s, {
      includeKeys: s.keysInFile !== false, platform: 'web', version: window.CRUCIBLE_VERSION || 'dev', plainKeyOf: (p) => p.apiKey || '',
    });
    // Queue writes so two quick changes can't interleave.
    writingFile = writingFile.then(() => new FolderRoot(home).write(SETTINGS_FILE, JSON.stringify(data, null, 2)))
      .catch((e) => toast(`Couldn't update ${SETTINGS_FILE}: ${e.message}`, true, 6000));
    return writingFile;
  }

  // ------------------------------------------------------------- settings --
  // Defaults + upgrades: shared with the desktop app (settings-core.js).
  async function loadSettings() {
    return SettingsCore.migrateSettings(await DB.get('kv', 'settings'));
  }
  function publicSettings(s) {
    return { ...s, providers: s.providers.map((p) => ({ ...p, apiKey: undefined, hasKey: !!p.apiKey })) };
  }
  // Settings from a file you didn't write here (Import, a restored backup, or
  // a Crucible folder this browser hasn't used before) never change where an
  // AI sends your text by themselves; the changes wait for your OK.
  const pendingEndpoints = new Map();
  function holdEndpoints(file, r, replace) {
    if (!r.endpointChanges.length) return null;
    const token = idOf();
    pendingEndpoints.set(token, { file, replace });
    return token;
  }

  async function saveSettings(incoming) {
    const cur = await loadSettings();
    const next = { ...cur, ...incoming };
    if (incoming.providers) {
      next.providers = incoming.providers.map((p) => {
        const old = cur.providers.find((o) => o.id === p.id);
        const fresh = typeof p.newApiKey === 'string' && p.newApiKey.trim() ? p.newApiKey.trim() : '';
        const apiKey = SettingsCore.keyFor(old, p, fresh); // address changed → key dropped
        const { newApiKey, hasKey, ...rest } = p;
        return { ...rest, id: p.id || idOf(), apiKey };
      });
    }
    next.memoryLimit = SettingsCore.clampMemoryLimit(next.memoryLimit);
    await DB.set('kv', 'settings', next);
    await writeSettingsFile(next);
    return publicSettings(next);
  }

  // ---------------------------------------------------------- media refs --
  const sessionBlobs = new Map(); // sess:<id> -> File
  const urlCache = new Map();     // ref -> object URL
  let currentKey = null;

  async function blobFor(ref) {
    if (ref.startsWith('sess:')) return sessionBlobs.get(ref) || null;
    if (ref.startsWith('home:')) return (await homeFile(homeParts(ref))).getFile();
    if (ref.startsWith('mem:')) {
      const { root, file } = bookOf(currentKey);
      return root.read(`${sidecarOf(file)}/memory/${ref.slice(4)}`, true);
    }
    if (ref.startsWith('h:')) {
      const rec = await DB.get('kv', 'handle:' + ref.slice(2));
      if (!rec) return null;
      if (rec.blob) return rec.blob;
      if (!(await ensurePerm(rec.handle))) throw new Error('Permission to read that file was not given.');
      return rec.handle.getFile();
    }
    if (ref.startsWith('df:')) {
      const [dirId, ...rest] = ref.slice(3).split('/');
      const rec = await DB.get('kv', 'dir:' + dirId);
      if (!rec) return null;
      if (!(await ensurePerm(rec.handle))) throw new Error(`Permission to read the "${rec.handle.name}" folder was not given.`);
      let d = rec.handle;
      const parts = rest.map(decodeURIComponent);
      const name = parts.pop();
      for (const p of parts) d = await d.getDirectoryHandle(p);
      return (await d.getFileHandle(name)).getFile();
    }
    return null;
  }

  async function urlFor(ref) {
    if (!ref) return '';
    if (urlCache.has(ref)) return urlCache.get(ref);
    const b = await blobFor(ref);
    if (!b) throw new Error('File not found');
    const u = URL.createObjectURL(b);
    urlCache.set(ref, u);
    return u;
  }

  function forgetUrls(prefix) {
    for (const [k, u] of urlCache) if (k.startsWith(prefix)) { URL.revokeObjectURL(u); urlCache.delete(k); }
  }

  async function exists(ref) {
    if (!ref) return false;
    if (ref.startsWith('sess:')) return sessionBlobs.has(ref);
    if (ref.startsWith('home:')) { try { await homeFile(homeParts(ref)); return true; } catch { return false; } }
    if (ref.startsWith('mem:')) return currentKey && books.has(currentKey) && bookOf(currentKey).root.exists(`${sidecarOf(bookOf(currentKey).file)}/memory/${ref.slice(4)}`);
    if (ref.startsWith('h:')) return !!(await DB.get('kv', 'handle:' + ref.slice(2)));
    if (ref.startsWith('df:')) return !!(await DB.get('kv', 'dir:' + ref.slice(3).split('/')[0]));
    return !!(await DB.get('kv', 'book:' + ref));
  }

  // Pick single files and remember them. Returns [{path: ref, name}]
  async function pickFiles(accept, exts, multiple) {
    if (folderMode() && window.showOpenFilePicker) {
      let hs;
      try {
        hs = await window.showOpenFilePicker({ multiple, types: [{ description: 'Files', accept: { [accept]: exts } }] });
      } catch (e) { if (isAbort(e)) return []; hs = null; }
      if (hs) {
        const out = [];
        for (const h of hs) {
          const rel = await inHome(h);
          if (rel) { out.push({ path: homeRef(rel), name: h.name, file: await h.getFile() }); continue; }
          const id = idOf();
          await DB.set('kv', 'handle:' + id, { handle: h });
          out.push({ path: 'h:' + id, name: h.name, file: await h.getFile() });
        }
        return out;
      }
    }
    return (await inputPick({ accept: exts.join(','), multiple })).map((f) => {
      const id = 'sess:' + idOf();
      sessionBlobs.set(id, f);
      return { path: id, name: f.name, file: f };
    });
  }

  const AUDIO = ['.mp3', '.m4a', '.ogg', '.wav', '.flac', '.aac'];
  const IMAGES = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
  const TEXTS = ['.md', '.markdown', '.txt'];
  const extOf = (n) => (n.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };

  // ------------------------------------------------------------------ AI --
  function blobToBase64(b) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(b);
    });
  }

  async function callAI({ providerId, system, messages, imageFiles }) {
    const s = await loadSettings();
    const p = s.providers.find((x) => x.id === (providerId || s.activeProviderId));
    if (!p) throw new Error('No AI provider selected. Add one in Settings.');
    const key = p.apiKey || '';
    const images = [];
    for (const f of imageFiles || []) {
      try {
        const b = await blobFor('mem:' + f);
        if (b) images.push({ mime: MIME[extOf(f)] || 'image/png', data: await blobToBase64(b) });
      } catch { /* skip */ }
    }
    const lastUser = messages.map((m) => m.role).lastIndexOf('user');
    const maxTokens = Number(p.maxTokens) || 4096;
    const temperature = p.temperature === '' || p.temperature == null ? undefined : Number(p.temperature);
    const timeoutMs = (Number(p.timeoutSec) || 180) * 1000;
    const trim = (u) => (u || '').replace(/\/+$/, '');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);

    const post = async (url, headers, body) => {
      let r;
      try {
        // redirect: 'error': never re-send the key and the text to wherever a
        // server redirects (see main.js aiFetch).
        r = await fetch(url, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), redirect: 'error' });
      } catch (e) {
        if (e.name === 'AbortError') throw new Error(`The AI didn't answer within ${timeoutMs / 1000}s.`);
        throw new Error(`Couldn't reach ${new URL(url).host}. The server may be down, blocked by your network, redirecting elsewhere (Crucible never follows AI redirects; check http vs https in the Base URL), or not allowing browser requests (for Ollama set OLLAMA_ORIGINS=*; for LM Studio turn on "Enable CORS").`);
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error?.message || j.message || `HTTP ${r.status}`);
      return j;
    };

    try {
      if (p.type === 'anthropic') {
        const msgs = messages.map((m, i) => (i === lastUser && images.length
          ? { role: 'user', content: [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } })), { type: 'text', text: m.content }] }
          : { role: m.role, content: m.content }));
        const body = { model: p.model, max_tokens: maxTokens, system, messages: msgs };
        if (temperature !== undefined) body.temperature = temperature;
        const j = await post(`${trim(p.baseUrl) || 'https://api.anthropic.com'}/v1/messages`, {
          'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
        }, body);
        return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      }
      if (p.type === 'gemini') {
        const contents = messages.map((m, i) => {
          const parts = [{ text: m.content }];
          if (i === lastUser) images.forEach((im) => parts.unshift({ inline_data: { mime_type: im.mime, data: im.data } }));
          return { role: m.role === 'assistant' ? 'model' : 'user', parts };
        });
        const base = trim(p.baseUrl) || 'https://generativelanguage.googleapis.com/v1beta';
        const j = await post(`${base}/models/${encodeURIComponent(p.model)}:generateContent`, { 'x-goog-api-key': key }, {
          system_instruction: { parts: [{ text: system }] }, contents,
          generationConfig: { maxOutputTokens: maxTokens, ...(temperature !== undefined ? { temperature } : {}) },
        });
        return (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
      }
      const msgs = [{ role: 'system', content: system }];
      messages.forEach((m, i) => msgs.push(i === lastUser && images.length
        ? { role: 'user', content: [...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data}` } })), { type: 'text', text: m.content }] }
        : { role: m.role, content: m.content }));
      let body = SettingsCore.openAIChatBody(p.baseUrl, { model: p.model, messages: msgs, maxTokens, temperature });
      for (let attempt = 0; ; attempt++) {
        try {
          const j = await post(`${trim(p.baseUrl) || 'https://api.openai.com/v1'}/chat/completions`, key ? { authorization: `Bearer ${key}` } : {}, body);
          return j.choices?.[0]?.message?.content || '';
        } catch (e) {
          const fixed = attempt < 2 ? SettingsCore.fixOpenAIBody(e.message, body) : null;
          if (!fixed) throw e;
          body = fixed; // the server told us which parameter name it wants: retry
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------- export --
  function printHtml(html, title) {
    return new Promise((resolve) => {
      const fr = document.createElement('iframe');
      fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      // Scripts can never run in the print frame (no allow-scripts); printing
      // needs allow-modals, and same-origin lets Crucible call print().
      fr.setAttribute('sandbox', 'allow-same-origin allow-modals');
      fr.srcdoc = html;
      fr.onload = () => {
        const oldTitle = document.title;
        document.title = title; // becomes the suggested PDF file name
        setTimeout(() => {
          try { fr.contentWindow.focus(); fr.contentWindow.print(); } finally {
            document.title = oldTitle;
            setTimeout(() => fr.remove(), 1000);
            resolve();
          }
        }, 150);
      };
      document.body.append(fr);
    });
  }

  // -------------------------------------------------------------- dirty --
  let dirty = false;
  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // =============================================================== API ====
  window.crucible = {
    platform: 'web',
    cssPaging: true,
    get storageMode() { return folderMode() ? 'folder' : 'browser'; },
    getVersion: async () => window.CRUCIBLE_VERSION || 'dev',

    // ------------------------------------------------- package & back up ----
    // Scan what would go into the backup. Returns groups the user can tick.
    async packageScan() {
      const BACKUP = /^Crucible backup .*\.zip$/i;
      const files = []; // {group, name, size, mtime, open(): Promise<Blob>}
      const notes = [];
      const walk = async (dir, rel, group, filter = () => true, depth = 0) => {
        if (depth > 12) return;
        for await (const [name, h] of dir.entries()) {
          if (name.endsWith('.crswap') || name === 'System Volume Information' || name.startsWith('$RECYCLE')) continue;
          if (h.kind === 'directory') { await walk(h, [...rel, name], group, filter, depth + 1); continue; }
          if (BACKUP.test(name) || !filter([...rel, name])) continue;
          try {
            const f = await h.getFile();
            const isAudio = AUDIO.includes(extOf(name));
            const isSettings = rel.length === 0 && name === SETTINGS_FILE;
            if (isSettings) continue; // replaced by a fresh snapshot
            files.push({ group: typeof group === 'function' ? group([...rel, name], isAudio) : group, name: [...rel, name].join('/'), size: f.size, mtime: f.lastModified, open: () => h.getFile() });
          } catch { notes.push(`Couldn't read ${[...rel, name].join('/')}; skipped.`); }
        }
      };
      let source = null;
      if (home && (await reachable(home))) {
        source = home.name;
        await walk(home, [], (parts, isAudio) => (isAudio ? 'music' : parts.length === 1 && extOf(parts[0]) === '.html' ? 'program' : 'books'));
      } else if (folderMode()) {
        notes.push('Your Crucible folder isn\'t open this session, so only the open book and settings can be included. Open it first (Welcome screen or Settings) to back up everything.');
      }
      // The open book, if it lives outside the Crucible folder.
      if (currentKey && books.has(currentKey)) {
        const { root, file } = bookOf(currentKey);
        if (root.kind === 'folder' && !(await inHome(root.dir))) {
          const side = sidecarOf(file);
          await walk(root.dir, ['Other books', root.dir.name], 'outside', (parts) => {
            const r = parts.slice(2);
            return r[0] === file || r[0] === side || r[0] === 'images';
          });
        } else if (root.kind === 'browser') {
          for (const k of await DB.keys('vfs')) {
            if (!k.startsWith(root.prefix)) continue;
            const v = await DB.get('vfs', k);
            const b = v instanceof Blob ? v : new Blob([v]);
            files.push({ group: 'books', name: `Books/${k}`, size: b.size, mtime: Date.now(), open: async () => b });
          }
          if (!source) notes.push('This browser can\'t read folders, so crucible.html itself can\'t be included. Keep a copy of it with the backup.');
        }
      }
      const s = await loadSettings();
      const outsideSongs = (s.playlist || []).filter((x) => !String(x.path).startsWith('home:')).length;
      if (outsideSongs) notes.push(`${outsideSongs} playlist song(s) live outside your Crucible folder and aren't included. Move them into its Music folder to include them.`);
      const sum = (g) => files.filter((f) => f.group === g).reduce((a, f) => [a[0] + 1, a[1] + f.size], [0, 0]);
      const groups = [
        { id: 'program', label: 'Crucible program (crucible.html)', optional: false },
        { id: 'books', label: 'Books, story memory, chapter images, backups and other files', optional: false },
        { id: 'outside', label: 'The open book (stored outside your Crucible folder)', optional: true },
        { id: 'music', label: 'Music', optional: true },
      ].map((g) => ({ ...g, count: sum(g.id)[0], bytes: sum(g.id)[1], checked: true })).filter((g) => g.count);
      groups.push({ id: 'settings', label: 'Settings (crucible-settings.json: AIs, playlist, layout)', optional: false, count: 1, bytes: 0, checked: true });
      this._pkg = { files, source };
      return { source, groups, notes, keysInFile: s.keysInFile !== false, token: 'web' };
    },

    async packageWrite(_token, { groups, includeKeys, readme }, onProgress, signal) {
      const pk = this._pkg;
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
      const name = `Crucible backup ${stamp}.zip`;
      let sink = null, where = 'your Downloads folder', sameFolder = false;
      if (window.showSaveFilePicker) {
        let fh = null;
        try {
          fh = await window.showSaveFilePicker({ suggestedName: name, id: 'crucible-backup', startIn: 'documents', types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }] });
        } catch (e) { if (isAbort(e)) return { canceled: true }; }
        if (fh) {
          const w = await fh.createWritable();
          sink = { write: (u) => w.write(u), close: () => w.close(), abort: () => w.abort().catch(() => {}) };
          where = fh.name;
          sameFolder = !!(await inHome(fh));
        }
      }
      if (!sink) {
        const parts = [];
        sink = { write: async (u) => { parts.push(u); }, close: async () => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob(parts, { type: 'application/zip' }));
          a.download = name; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        }, abort: () => {} };
      }
      const s = await loadSettings();
      const settingsText = JSON.stringify(SettingsCore.portableSettings(s, { includeKeys, platform: 'web', version: window.CRUCIBLE_VERSION || 'dev', plainKeyOf: (p) => p.apiKey || '' }), null, 2);
      const text = (n, t) => { const b = new Blob([t]); return { name: n, size: b.size, mtime: new Date(), stream: () => b.stream() }; };
      const lazy = (f) => ({
        name: f.name, size: f.size, mtime: new Date(f.mtime),
        stream: () => {
          let reader;
          return new ReadableStream({
            async pull(ctrl) {
              if (!reader) reader = (await f.open()).stream().getReader();
              const { done, value } = await reader.read();
              if (done) ctrl.close(); else ctrl.enqueue(value);
            },
            cancel() { reader?.cancel(); },
          });
        },
      });
      const entries = [
        ...pk.files.filter((f) => groups[f.group] !== false).map(lazy),
        ...(groups.settings !== false ? [text('crucible-settings.json', settingsText)] : []),
        text('READ ME - Crucible backup.txt', readme),
      ];
      try {
        const r = await Zip.writeZip(entries, sink, { onProgress, signal });
        return { ok: true, name, where, sameFolder, ...r };
      } catch (e) {
        sink.abort?.();
        if (e.message === 'Cancelled') return { canceled: true };
        throw e;
      }
    },

    // ------------------------------------------------------------ restore ----
    // Unpack a Package & back up zip into a NEW folder (never overwrites),
    // then make that folder the Crucible folder and load its settings.
    async restorePackage(onProgress, signal) {
      if (!folderMode()) return { ok: false, reason: 'This browser can\'t write folders. Use Edge or Chrome to restore a backup.' };
      let file = null;
      if (window.showOpenFilePicker) {
        try {
          const [h] = await window.showOpenFilePicker({ id: 'crucible-backup', types: [{ description: 'Crucible backup', accept: { 'application/zip': ['.zip'] } }] });
          file = await h.getFile();
        } catch (e) { if (isAbort(e)) return { canceled: true }; }
      }
      if (!file) [file] = await inputPick({ accept: '.zip' });
      if (!file) return { canceled: true };
      const zip = await Zip.readZip({ size: file.size, read: async (o, l) => new Uint8Array(await file.slice(o, o + l).arrayBuffer()) });
      const names = zip.entries.map((e) => e.name);
      if (!names.includes('crucible-settings.json') && !names.includes('READ ME - Crucible backup.txt')) {
        return { ok: false, reason: 'That zip isn\'t a Crucible backup (no crucible-settings.json or READ ME inside).' };
      }
      let parent;
      try { parent = await window.showDirectoryPicker({ id: 'crucible-restore', mode: 'readwrite' }); } catch (e) { if (isAbort(e)) return { canceled: true }; throw e; }
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
      let folderName = `Crucible (restored ${stamp})`;
      for (let i = 2; ; i++) {
        try { await parent.getDirectoryHandle(folderName); folderName = `Crucible (restored ${stamp}) ${i}`; } catch { break; }
      }
      const dest = await parent.getDirectoryHandle(folderName, { create: true });
      const total = zip.entries.reduce((a, e) => a + e.size, 0);
      let done = 0, files = 0;
      for (const en of zip.entries) {
        if (signal?.aborted) return { canceled: true, partial: folderName };
        const parts = Zip.safeParts(en.name);
        if (!parts.length) continue;
        let d = dest;
        for (const p of en.dir ? parts : parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
        if (en.dir) continue;
        const w = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
        const reader = zip.open(en).getReader();
        try {
          for (;;) {
            const { done: end, value } = await reader.read();
            if (end) break;
            await w.write(value);
            done += value.length;
            onProgress(done, total, en.name);
          }
          await w.close();
        } catch (e) { await w.abort().catch(() => {}); throw e; }
        files++;
      }
      const r = await this.connectHomeHandle(dest);
      return { ok: true, folder: `${parent.name}/${folderName}`, files, settings: r.settings, loaded: r.loaded, imported: { endpointChanges: r.endpointChanges, confirmToken: r.confirmToken } };
    },

    // Use a specific folder handle as the Crucible folder (after a restore).
    async connectHomeHandle(h) {
      home = h;
      await DB.set('kv', 'home', { handle: h });
      const text = await new FolderRoot(h).read(SETTINGS_FILE);
      let loaded = false, endpointChanges = [], confirmToken = null;
      if (text) {
        try {
          const file = JSON.parse(text);
          const r = SettingsCore.mergeImported(await loadSettings(), file, { platform: 'web', replace: true, endpoints: 'ask' });
          await DB.set('kv', 'settings', r.next);
          ({ endpointChanges } = r);
          confirmToken = holdEndpoints(file, r, true);
          loaded = true;
        } catch { /* keep current */ }
      } else await writeSettingsFile(await loadSettings());
      return { loaded, settings: publicSettings(await loadSettings()), endpointChanges, confirmToken };
    },

    // ---------------------------------------------------- Crucible folder ----
    async homeInfo() {
      const h = home || (folderMode() ? await storedHome() : null);
      return h ? { name: h.name, connected: !!home } : null;
    },

    // Connect (or reconnect) your Crucible folder and load its settings file.
    // pickNew: always show the folder picker.
    async connectHome(pickNew = false) {
      if (!folderMode()) return { ok: false, reason: 'unsupported' };
      let h = pickNew ? null : await storedHome();
      if (h) {
        let allowed;
        try { allowed = await ensurePerm(h, 'readwrite'); } catch { allowed = null; }
        if (allowed === false) return { ok: false, reason: 'denied' };
        // A locked (BitLocker), unplugged or re-lettered drive still has a
        // remembered handle, but nothing behind it. Check before trusting it.
        if (allowed === null || !(await reachable(h))) return { ok: false, reason: 'missing', name: h.name };
      } else {
        try {
          h = await window.showDirectoryPicker({ id: 'crucible-home', mode: 'readwrite' });
        } catch (e) {
          if (isAbort(e)) return { ok: false, reason: 'cancelled' };
          folderBlocked = true;
          return { ok: false, reason: 'blocked' };
        }
      }
      // The folder's settings file is the source of truth for your settings,
      // EXCEPT where your AIs send your writing: any address that isn't
      // already in this browser's settings waits for your OK, every time,
      // including for a folder Crucible remembers. (Remembering a folder is
      // not approval of what its file says; a rejected address is asked
      // about again, never applied.)
      home = h;
      await DB.set('kv', 'home', { handle: h });
      const text = await new FolderRoot(h).read(SETTINGS_FILE);
      let loaded = false, endpointChanges = [], confirmToken = null;
      if (text) {
        try {
          const file = JSON.parse(text);
          const r = SettingsCore.mergeImported(await loadSettings(), file, { platform: 'web', replace: true, endpoints: 'ask' });
          await DB.set('kv', 'settings', r.next);
          ({ endpointChanges } = r);
          confirmToken = holdEndpoints(file, r, true);
          loaded = true;
        } catch (e) {
          toast(`${SETTINGS_FILE} couldn't be read (${e.message}). Keeping this browser's settings.`, true, 7000);
        }
      } else {
        await writeSettingsFile(await loadSettings()); // first time: create it
      }
      return { ok: true, name: h.name, loaded, created: !text, settings: publicSettings(await loadSettings()), endpointChanges, confirmToken };
    },

    // Books (.md) inside your Crucible folder, most recently used first.
    async listHomeBooks() {
      if (!home) return [];
      const found = [];
      const walk = async (d, rel, depth) => {
        if (depth > 3 || found.length > 200) return;
        const names = new Set();
        const files = [];
        for await (const [name, h] of d.entries()) {
          names.add(name);
          if (name.startsWith('.') || name.endsWith('.crucible') || name === 'node_modules') continue;
          if (h.kind === 'directory') await walk(h, [...rel, name], depth + 1);
          else if (['.md', '.markdown'].includes(extOf(name)) && !/^readme\.md$/i.test(name)) files.push(name);
        }
        // A manuscript Crucible has opened has a "<name>.crucible" folder beside it.
        for (const f of files) found.push({ path: [...rel, f].join('/'), book: names.has(sidecarOf(f)) });
      };
      try { await walk(home, [], 0); } catch { /* drive went away mid-scan */ }
      const recent = (await loadSettings()).recentHome || [];
      const rank = (p) => { const i = recent.indexOf(p); return i === -1 ? 999 : i; };
      return found.sort((a, b) => (b.book - a.book) || rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
    },

    async openHomeBook(relPath) {
      const parts = relPath.split('/');
      const file = parts.pop();
      const dir = parts.length ? await homeDir(parts) : home;
      const key = `${dir.name}/${file}`;
      await rememberBook(key, new FolderRoot(dir), file);
      currentKey = key;
      forgetUrls('mem:');
      return loadAt(key);
    },

    // ---------------------------------------------------------- books ----
    async openBook() {
      if (folderMode()) {
        const dir = await pickDir('crucible-book');
        if (dir === null) return null;
        if (dir) {
          const files = (await new FolderRoot(dir).list('')).filter((n) => TEXTS.includes(extOf(n))).sort();
          if (!files.length) { toast(`No .md file in "${dir.name}". Pick the folder that contains your manuscript.`, true, 6000); return null; }
          const file = files.length === 1 ? files[0] : await chooseFrom(`Which manuscript in "${dir.name}"?`, files);
          if (!file) return null;
          const key = `${dir.name}/${file}`;
          await rememberBook(key, new FolderRoot(dir), file);
          currentKey = key;
          forgetUrls('mem:');
          return loadAt(key);
        }
      }
      // Browser-storage mode: copy the chosen file into the browser.
      const [f] = await inputPick({ accept: '.md,.markdown,.txt' });
      if (!f) return null;
      const key = `Browser storage/${f.name}`;
      const root = new BrowserRoot(`${f.name}/`);
      if (!(await root.exists(f.name))) await root.write(f.name, await f.text());
      else if (await confirmModal('Already in browser storage', `"${f.name}" is already stored in this browser. Replace that copy with the file you just picked? (Change pool, memory and chat are kept either way.)`, 'Replace')) {
        await root.write(f.name, await f.text());
      }
      await rememberBook(key, root, f.name);
      currentKey = key;
      forgetUrls('mem:');
      return loadAt(key);
    },

    async openBookPath(key) {
      const rec = await DB.get('kv', 'book:' + key);
      if (!rec) throw new Error('Crucible no longer has access to that book — use Open.');
      if (rec.dir) {
        if (!(await ensurePerm(rec.dir, 'readwrite'))) throw new Error('Folder access was not allowed.');
        books.set(key, { root: new FolderRoot(rec.dir), file: rec.file });
      } else books.set(key, { root: new BrowserRoot(rec.browser), file: rec.file });
      await rememberBook(key, books.get(key).root, rec.file);
      currentKey = key;
      forgetUrls('mem:');
      return loadAt(key);
    },

    async saveBook(args) {
      try {
        return await this._saveBook(args);
      } catch (e) {
        if (['NotFoundError', 'NotReadableError', 'InvalidStateError', 'NoModificationAllowedError'].includes(e.name)) {
          const err = new Error("Can't reach the book's folder. If it's on a drive, make sure the drive is plugged in and unlocked, then save again. Your work is still open here.");
          err.driveGone = true;
          throw err;
        }
        throw e;
      }
    },

    async _saveBook({ bookPath, text, project }) {
      const { root, file } = bookOf(bookPath);
      const side = sidecarOf(file);
      const old = await root.read(file);
      if (old !== null && old !== text) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const base = file.replace(/\.[^.]+$/, '');
        await root.write(`${side}/backups/${base}_${stamp}.md`, old);
        const all = (await root.list(`${side}/backups`)).filter((f) => f.endsWith('.md')).sort();
        for (const o of all.slice(0, Math.max(0, all.length - MAX_BACKUPS))) await root.remove(`${side}/backups/${o}`);
      }
      await root.write(file, text);
      await root.write(`${side}/project.json`, JSON.stringify(project, null, 2));
      return { ok: true, savedAt: Date.now() };
    },

    async saveBookAs({ text, project, currentPath }) {
      let name = await promptModal('Save manuscript as', 'File name', currentPath ? currentPath.split('/').pop() : 'Untitled.md');
      if (!name) return null;
      name = name.replace(/[\\/:*?"<>|]+/g, '').trim();
      if (!/\.(md|markdown|txt)$/i.test(name)) name += '.md';
      let root, key;
      if (folderMode()) {
        const dir = await pickDir('crucible-book');
        if (dir === null) return null;
        if (dir) { root = new FolderRoot(dir); key = `${dir.name}/${name}`; }
      }
      if (!root) { root = new BrowserRoot(`${name}/`); key = `Browser storage/${name}`; }
      if (await root.exists(name) && !(await confirmModal('Replace file?', `"${name}" already exists there. Replace it?`, 'Replace'))) return null;
      // Carry story memory, linked pictures and chapter images across.
      if (currentPath && books.has(currentPath)) {
        const from = bookOf(currentPath);
        for (const sub of ['memory', 'linked']) {
          const dir = `${sidecarOf(from.file)}/${sub}`;
          for (const f of await from.root.list(dir)) {
            await root.write(`${sidecarOf(name)}/${sub}/${f}`, await from.root.read(`${dir}/${f}`, true));
          }
        }
        if (from.root.dir !== root.dir || from.root.prefix !== root.prefix) {
          for (const f of await from.root.list('images')) {
            if (!(await root.exists(`images/${f}`))) await root.write(`images/${f}`, await from.root.read(`images/${f}`, true));
          }
        }
      }
      books.set(key, { root, file: name });
      const r = await this._saveBook({ bookPath: key, text, project });
      await rememberBook(key, root, name);
      currentKey = key;
      forgetUrls('mem:');
      return { ...r, path: key, sidecar: sidecarOf(name) };
    },

    async listBackups(bookPath) {
      const { root, file } = bookOf(bookPath);
      return (await root.list(`${sidecarOf(file)}/backups`)).filter((f) => f.endsWith('.md')).sort().reverse();
    },
    async readBackup({ bookPath, name }) {
      const { root, file } = bookOf(bookPath);
      return (await root.read(`${sidecarOf(file)}/backups/${name}`)) || '';
    },

    // Download the manuscript (main way out of browser-storage mode).
    downloadText(name, text) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },

    // -------------------------------------------------- chapter images ----
    async chooseChapterImage(bookPath) {
      const { root } = bookOf(bookPath);
      const [p] = await pickFiles('image/*', IMAGES, false);
      if (!p) return null;
      const name = `chapter-${idOf()}${extOf(p.name)}`;
      await root.write(`images/${name}`, p.file);
      if (p.path.startsWith('h:')) await DB.del('kv', 'handle:' + p.path.slice(2));
      if (p.path.startsWith('sess:')) sessionBlobs.delete(p.path);
      return { rel: `images/${name}`, name: p.name };
    },
    // Linked pictures are copied into "<Book>.crucible/linked/" so they travel
    // with the book. from: a picture linked earlier (copied in once).
    async linkPicture({ bookPath, from } = {}) {
      const { root, file } = bookOf(bookPath);
      let blob, name, pickRef = null;
      if (from) {
        try { blob = await blobFor(from); } catch { blob = null; }
        name = from.split('/').pop().replace(/^[\w-]+_/, '');
      } else {
        const [p] = await pickFiles('image/*', IMAGES, false);
        if (!p) return null;
        blob = p.file; name = p.name; pickRef = p.path;
      }
      if (!blob || blob.size > 100 * 1024 * 1024) return null;
      const h = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      const img = (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) || (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff)
        || (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) || (h[0] === 0x42 && h[1] === 0x4d)
        || (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50);
      if (!img) return null;
      let ext = extOf(name || '');
      if (!IMAGES.includes(ext)) ext = '.png';
      const safe = (name || 'picture').replace(/\.[^.]+$/, '').replace(/[^\w.\- ]+/g, '_').slice(-60) + ext;
      const stored = `${idOf()}_${safe}`;
      await root.write(`${sidecarOf(file)}/linked/${stored}`, blob);
      if (pickRef && pickRef.startsWith('h:')) await DB.del('kv', 'handle:' + pickRef.slice(2)); // the copy is what's kept
      return { ref: `bk:linked/${stored}`, name: name || safe };
    },

    // Writing-area background photo. In your Crucible folder when one is
    // connected (so it travels with the drive), otherwise kept in this browser.
    async chooseBackground() {
      const [p] = await pickFiles('image/*', IMAGES, false);
      if (!p) return null;
      if (p.file.size > 20 * 1024 * 1024) throw new Error('That picture is too large (20 MB at most).');
      if (p.path.startsWith('home:')) return { ref: p.path, name: p.name };
      const id = idOf();
      let ref;
      if (home) {
        const stored = `${id}${extOf(p.name) || '.png'}`;
        await new FolderRoot(home).write(`Crucible backgrounds/${stored}`, p.file);
        ref = homeRef(['Crucible backgrounds', stored]);
      } else {
        await DB.set('kv', 'handle:' + id, { blob: p.file });
        ref = 'h:' + id;
      }
      if (p.path.startsWith('h:')) await DB.del('kv', 'handle:' + p.path.slice(2));
      return { ref, name: p.name };
    },
    async backgroundUrl(ref) {
      try { return ref ? await urlFor(ref) : null; } catch { return null; }
    },

    async readBookImage({ bookPath, rel }) {
      if (!books.has(bookPath)) return null;
      if (typeof rel !== 'string') return null;
      const clean = rel.split('/').filter((s) => s && s !== '.' && s !== '..').join('/');
      // Only real pictures: the name must be an image type and the file must
      // start like one, so a manuscript can't pull other files into exports.
      if (!IMAGES.includes(extOf(clean))) return null;
      const b = await bookOf(bookPath).root.read(clean, true);
      if (!b) return null;
      const h = new Uint8Array(await b.slice(0, 12).arrayBuffer());
      const img = (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) || (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff)
        || (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) || (h[0] === 0x42 && h[1] === 0x4d)
        || (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50);
      if (!img) return null;
      const typed = b.type ? b : new Blob([b], { type: MIME[extOf(clean)] || 'image/png' });
      return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(typed); });
    },

    // --------------------------------------------------------- memory ----
    async addMemory(bookPath) {
      const { root, file } = bookOf(bookPath);
      const picked = await pickFiles('application/octet-stream', [...IMAGES, ...TEXTS], true);
      const items = [];
      for (const p of picked) {
        const ext = extOf(p.name);
        const kind = IMAGES.includes(ext) ? 'image' : TEXTS.includes(ext) ? 'text' : null;
        if (!kind) continue;
        const id = idOf();
        const stored = `${id}_${p.name}`;
        await root.write(`${sidecarOf(file)}/memory/${stored}`, p.file);
        items.push({ id, kind, name: p.name, file: stored, notes: '', tags: '', includeInAI: true, sendImage: false, added: Date.now() });
        // The copy now lives with the book; drop the temporary pick.
        if (p.path.startsWith('h:')) await DB.del('kv', 'handle:' + p.path.slice(2));
        if (p.path.startsWith('sess:')) sessionBlobs.delete(p.path);
      }
      return items;
    },
    async newMemoryNote({ bookPath, name }) {
      const { root, file } = bookOf(bookPath);
      const id = idOf();
      const safe = (name || 'note').replace(/[^\w\- ]+/g, '').trim() || 'note';
      const stored = `${id}_${safe}.md`;
      await root.write(`${sidecarOf(file)}/memory/${stored}`, `# ${name || 'Note'}\n\n`);
      return { id, kind: 'text', name: `${safe}.md`, file: stored, notes: '', tags: '', includeInAI: true, sendImage: false, added: Date.now() };
    },
    async readMemoryText({ bookPath, file: f }) {
      const { root, file } = bookOf(bookPath);
      return (await root.read(`${sidecarOf(file)}/memory/${f}`)) || '';
    },
    async writeMemoryText({ bookPath, file: f, text }) {
      const { root, file } = bookOf(bookPath);
      await root.write(`${sidecarOf(file)}/memory/${f}`, text);
    },
    memoryPath: async ({ file }) => 'mem:' + file,
    async deleteMemory({ bookPath, file: f }) {
      const { root, file } = bookOf(bookPath);
      await root.remove(`${sidecarOf(file)}/memory/${f}`);
      forgetUrls('mem:' + f);
    },

    // ---------------------------------------------------- music & files ----
    pickSongs: () => pickFiles('audio/*', AUDIO, true).then((a) => a.map(({ path, name }) => ({ path, name }))),
    async pickMusicFolder() {
      if (!folderMode()) {
        toast('This browser can\'t open folders — pick the songs instead (they\'ll play this session).', true, 5000);
        return this.pickSongs();
      }
      let dir;
      try { dir = await window.showDirectoryPicker({ id: 'crucible-music', mode: 'read', ...(home ? { startIn: home } : {}) }); } catch { return []; }
      const relDir = await inHome(dir);
      const dirId = idOf();
      if (!relDir) await DB.set('kv', 'dir:' + dirId, { handle: dir });
      const out = [];
      const walk = async (d, rel, depth) => {
        if (depth > 4) return;
        for await (const [name, h] of d.entries()) {
          if (h.kind === 'directory') await walk(h, [...rel, name], depth + 1);
          else if (AUDIO.includes(extOf(name))) {
            out.push({
              path: relDir ? homeRef([...relDir, ...rel, name]) : `df:${dirId}/${[...rel, name].map(encodeURIComponent).join('/')}`,
              name: name.replace(/\.[^.]+$/, ''),
            });
          }
        }
      };
      await walk(dir, [], 0);
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },
    pickImage: () => pickFiles('image/*', IMAGES, false).then((a) => (a[0] ? { path: a[0].path, name: a[0].name } : null)),
    fileExists: exists,
    urlFor,
    reveal: () => toast('Browsers can\'t open folders in Explorer — the file is in the folder you chose.'),

    // ----------------------------------------------------------- misc ----
    getSettings: async () => publicSettings(await loadSettings()),
    saveSettings,
    async exportSettings({ includeKeys } = {}) {
      return SettingsCore.portableSettings(await loadSettings(), {
        includeKeys, platform: 'web', version: window.CRUCIBLE_VERSION || 'dev', plainKeyOf: (p) => p.apiKey || '',
      });
    },
    async confirmImportedEndpoints(token) {
      const p = pendingEndpoints.get(token);
      if (!p) throw new Error('Nothing waiting to be confirmed.');
      pendingEndpoints.delete(token);
      const r = SettingsCore.mergeImported(await loadSettings(), p.file, { platform: 'web', replace: p.replace, endpoints: 'apply' });
      await DB.set('kv', 'settings', r.next);
      await writeSettingsFile(r.next);
      return { settings: publicSettings(r.next), keysMissing: r.keysMissing };
    },

    async importSettings(file) {
      const r = SettingsCore.mergeImported(await loadSettings(), file, { platform: 'web', endpoints: 'ask' });
      await DB.set('kv', 'settings', r.next);
      return { settings: publicSettings(r.next), keysMissing: r.keysMissing, skippedSongs: r.skippedSongs, providers: r.providers, endpointChanges: r.endpointChanges, confirmToken: holdEndpoints(file, r, false) };
    },
    async saveTextFile({ suggestedName, text }) { this.downloadText(suggestedName, text); return suggestedName; },
    async saveBinary({ suggestedName, blob, kind }) {
      if (window.showSaveFilePicker) {
        let fh;
        try {
          fh = await window.showSaveFilePicker({ suggestedName, id: 'crucible-export', types: [{ description: kind.description, accept: { [kind.mime]: [`.${kind.ext}`] } }] });
        } catch (e) { if (isAbort(e)) return { canceled: true }; }
        if (fh) { const w = await fh.createWritable(); await w.write(blob); await w.close(); return { ok: true, name: fh.name }; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = suggestedName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      return { ok: true, name: suggestedName };
    },
    async openDataFile() {
      const [f] = await inputPick({ accept: '.csv,.tsv,.txt,.json,text/csv,application/json' });
      return f ? { name: f.name, text: await f.text() } : null;
    },
    async openTextFile() {
      const [f] = await inputPick({ accept: '.json,application/json' });
      return f ? f.text() : null;
    },
    aiChat: async (args) => {
      try { return { ok: true, text: await callAI(args) }; } catch (e) { return { ok: false, error: e.message }; }
    },
    async exportPdf({ html, suggestedName }) {
      await printHtml(html, (suggestedName || 'book.pdf').replace(/\.pdf$/i, ''));
      return { ok: true, printed: true };
    },
    replaceMisspelling: async () => {},
    onSpelling: () => {},
    setDirty: (d) => { dirty = !!d; },
    setTitle: (t) => { document.title = t; },
    onSaveAndQuit: () => {},
    quitNow: () => {},
  };
})();
