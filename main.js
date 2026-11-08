// =============================================================================
// Crucible — main process
// -----------------------------------------------------------------------------
// Electron apps have two halves:
//   * The MAIN process (this file) runs in Node.js. It can touch the disk,
//     open native dialogs, store secrets, and make network calls.
//   * The RENDERER process (src/*) is the window you see. It is sandboxed like
//     a web page and asks the main process to do privileged work through IPC
//     ("inter-process communication") messages, exposed safely by preload.js.
//
// Data layout on disk for a book at  /path/MyNovel.md :
//   /path/MyNovel.md                    <- your manuscript (plain Markdown, the source of truth)
//   /path/MyNovel.crucible/project.json <- change pool, links, memory index, AI chat
//   /path/MyNovel.crucible/memory/      <- photos + fact files you add to the AI memory
//   /path/MyNovel.crucible/backups/     <- rolling copies of the manuscript on every save
//
// Songs and linked pictures are stored only as file PATHS — never copied into
// the book or the PDF.
// =============================================================================

const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, session } = require('electron');
const { pathToFileURL, fileURLToPath } = require('url');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');

const MAX_BACKUPS = 30;

// Settings always live in <AppData>/Crucible no matter how the app is named or
// packaged in future versions. (Tests set their own folder first.)
if (!global.__crucibleTestUserData) app.setPath('userData', path.join(app.getPath('appData'), 'Crucible'));
let mainWindow = null;
let rendererDirty = false; // tracks unsaved changes so we can warn on close

// ---------------------------------------------------------------- helpers ----

const uid = () => crypto.randomBytes(6).toString('hex');

function sidecarDir(bookPath) {
  // "MyNovel.md" -> "MyNovel.crucible"
  const dir = path.dirname(bookPath);
  const base = path.basename(bookPath, path.extname(bookPath));
  return path.join(dir, `${base}.crucible`);
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
  return p;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Write to a temp file then rename: if the power drops mid-write you keep the
// old file instead of a half-written one.
async function atomicWrite(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, data, 'utf8');
  await fsp.rename(tmp, file);
}

function emptyProject() {
  return { version: 1, pool: [], links: [], memory: [], chat: [], meta: {} };
}

// ------------------------------------------------------------- settings ----
// Global settings (not per book): AI providers, music playlist, UI prefs.
// API keys are encrypted with the operating system's keychain via safeStorage
// (Windows DPAPI, macOS Keychain, Linux libsecret) when it is available.

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

// API keys are saved only when the operating system can encrypt them
// (Windows DPAPI, macOS Keychain, a Linux keyring). Linux's "basic_text"
// fallback is NOT real encryption, so it doesn't count. Without secure
// storage, keys are kept in memory for this session only and never written
// to disk; Settings says so, and you re-enter them next time.
const sessionKeys = new Map();
function secureStorageOk() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      return !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend());
    }
    return true;
  } catch { return false; }
}
function encryptKey(plain) {
  if (!plain) return '';
  if (secureStorageOk()) return 'enc:' + safeStorage.encryptString(plain).toString('base64');
  const ref = `mem:${uid()}`;
  sessionKeys.set(ref, plain);
  return ref;
}

function decryptKey(stored) {
  if (!stored) return '';
  if (stored.startsWith('mem:')) return sessionKeys.get(stored) || '';
  if (stored.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    } catch {
      return '';
    }
  }
  if (stored.startsWith('raw:')) return stored.slice(4); // older versions; migrated on load
  return '';
}
const hasUsableKey = (stored) => !!stored && (!stored.startsWith('mem:') || sessionKeys.has(stored));

// Defaults + upgrades live in a file shared with the browser edition.
const SettingsCore = require('./src/js/settings-core.js');

async function loadSettings() {
  const s = SettingsCore.migrateSettings(await readJson(settingsFile(), {}));
  // Keys saved in plain text by older versions: encrypt them now, or (with no
  // secure storage) move them into memory and take them out of the file.
  let changed = false;
  for (const p of s.providers) {
    if (typeof p.apiKey === 'string' && p.apiKey.startsWith('raw:')) { p.apiKey = encryptKey(p.apiKey.slice(4)); changed = true; }
    else if (typeof p.apiKey === 'string' && p.apiKey && !/^(enc|mem):/.test(p.apiKey)) { p.apiKey = encryptKey(p.apiKey); changed = true; }
  }
  if (changed) await writeSettings(s);
  return s;
}

async function writeSettings(s) {
  await ensureDir(path.dirname(settingsFile()));
  await atomicWrite(settingsFile(), JSON.stringify(s, null, 2));
}

// The renderer never receives real keys — only a flag saying one is stored.
function publicSettings(s) {
  return {
    ...s,
    providers: s.providers.map((p) => ({ ...p, apiKey: undefined, hasKey: hasUsableKey(p.apiKey) })),
    keyStorage: secureStorageOk() ? 'encrypted' : 'session',
  };
}

async function saveSettings(incoming) {
  const current = await loadSettings();
  const next = { ...current, ...incoming };
  if (incoming.providers) {
    next.providers = incoming.providers.map((p) => {
      const old = current.providers.find((o) => o.id === p.id);
      const fresh = typeof p.newApiKey === 'string' && p.newApiKey.trim() ? encryptKey(p.newApiKey.trim()) : '';
      const apiKey = SettingsCore.keyFor(old, p, fresh); // address changed → key dropped
      const { newApiKey, hasKey, ...rest } = p;
      return { ...rest, id: p.id || uid(), apiKey };
    });
  }
  next.memoryLimit = SettingsCore.clampMemoryLimit(next.memoryLimit);
  await writeSettings(next);
  return publicSettings(next);
}

async function exportSettings({ includeKeys }) {
  const s = await loadSettings();
  return SettingsCore.portableSettings(s, {
    includeKeys, platform: 'desktop', version: require('./package.json').version, plainKeyOf: (p) => decryptKey(p.apiKey),
  });
}

// Settings from a file (Import, or a restored backup) never change where an
// AI sends your text by themselves: those changes wait here until you OK them.
const pendingEndpoints = new Map();
function holdEndpoints(file, r) {
  if (!r.endpointChanges.length) return null;
  const token = uid();
  pendingEndpoints.set(token, file);
  return token;
}
async function importSettings(file) {
  const r = SettingsCore.mergeImported(await loadSettings(), file, { platform: 'desktop', encrypt: encryptKey, endpoints: 'ask' });
  await writeSettings(r.next);
  return { settings: publicSettings(r.next), keysMissing: r.keysMissing, skippedSongs: r.skippedSongs, providers: r.providers, endpointChanges: r.endpointChanges, confirmToken: holdEndpoints(file, r) };
}
async function confirmEndpoints(token) {
  const file = pendingEndpoints.get(token);
  if (!file) throw new Error('Nothing waiting to be confirmed.');
  pendingEndpoints.delete(token);
  const r = SettingsCore.mergeImported(await loadSettings(), file, { platform: 'desktop', encrypt: encryptKey, endpoints: 'apply' });
  await writeSettings(r.next);
  return { settings: publicSettings(r.next), keysMissing: r.keysMissing };
}

async function addRecent(bookPath) {
  const s = await loadSettings();
  s.recent = [bookPath, ...s.recent.filter((r) => r !== bookPath)].slice(0, 10);
  await writeSettings(s);
}

// ------------------------------------------------------ trusted books ----
// The window can only touch books YOU picked: through an Open/Save dialog,
// or by restoring a backup. Their paths are remembered here, in a file only
// this process writes (the window can change settings.json, but not this).
// Every request that names a book is checked against the list, so even if
// something hostile ever ran inside the window it couldn't use Crucible to
// read or write other files on the computer.
const trustFile = () => path.join(app.getPath('userData'), 'trusted-books.json');
let trusted = null;
const caseless = process.platform === 'win32' || process.platform === 'darwin';
const pathKey = (p) => { const r = path.resolve(p); return caseless ? r.toLowerCase() : r; };
// \\server\share, //server, \\?\… : another computer, or a raw device path.
const isNetPath = (p) => /^[\\/]{2}/.test(String(p));
const looksLikeBook = (p) => typeof p === 'string' && path.isAbsolute(p) && !isNetPath(p) && /\.(md|markdown|txt)$/i.test(p);
async function loadTrust() {
  if (trusted) return trusted;
  const list = await readJson(trustFile(), null);
  if (Array.isArray(list)) trusted = new Set(list.filter((x) => typeof x === 'string'));
  else {
    // First run of this version: the books you'd already opened stay usable.
    trusted = new Set(((await loadSettings()).recent || []).filter(looksLikeBook).map(pathKey));
    await saveTrust();
  }
  return trusted;
}
async function saveTrust() {
  await ensureDir(path.dirname(trustFile()));
  await atomicWrite(trustFile(), JSON.stringify([...trusted].slice(-1000), null, 1));
}
async function trustBook(p) {
  if (!looksLikeBook(p)) return;
  await loadTrust();
  trusted.add(pathKey(p));
  await saveTrust();
}
async function isTrustedBook(p) {
  return looksLikeBook(p) && (await loadTrust()).has(pathKey(p));
}
async function checkBook(p) {
  if (!(await isTrustedBook(p))) throw new Error('Crucible only works with books you open or save yourself. Use Open… to choose this book.');
  return path.resolve(p);
}

// Pictures: only real image files (checked by their first bytes, not just
// the name), so a manuscript can't smuggle other files into an export.
function isImageBytes(b) {
  if (!b || b.length < 12) return false;
  const h = (i) => b[i];
  return (h(0) === 0x89 && h(1) === 0x50 && h(2) === 0x4e && h(3) === 0x47) // PNG
    || (h(0) === 0xff && h(1) === 0xd8 && h(2) === 0xff) // JPEG
    || (h(0) === 0x47 && h(1) === 0x49 && h(2) === 0x46) // GIF
    || (h(0) === 0x52 && h(1) === 0x49 && h(2) === 0x46 && h(3) === 0x46 && h(8) === 0x57 && h(9) === 0x45 && h(10) === 0x42 && h(11) === 0x50) // WEBP
    || (h(0) === 0x42 && h(1) === 0x4d); // BMP
}

// ---------------------------------------------------------- book files ----

async function openBookAt(bookPath) {
  bookPath = await checkBook(bookPath);
  const text = await fsp.readFile(bookPath, 'utf8');
  const side = sidecarDir(bookPath);
  const project = Object.assign(emptyProject(), await readJson(path.join(side, 'project.json'), {}));
  await addRecent(bookPath);
  return { path: bookPath, text: text.replace(/\r\n/g, '\n'), project, sidecar: side };
}

async function saveBook({ bookPath, text, project }) {
  bookPath = await checkBook(bookPath);
  if (typeof text !== 'string') throw new Error('Nothing to save.');
  const side = await ensureDir(sidecarDir(bookPath));
  const backups = await ensureDir(path.join(side, 'backups'));

  // Back up the PREVIOUS version before overwriting it.
  if (fs.existsSync(bookPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.basename(bookPath, path.extname(bookPath));
    await fsp.copyFile(bookPath, path.join(backups, `${base}_${stamp}.md`));
    const all = (await fsp.readdir(backups)).filter((f) => f.endsWith('.md')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - MAX_BACKUPS))) {
      await fsp.unlink(path.join(backups, old)).catch(() => {});
    }
  }

  await atomicWrite(bookPath, text);
  await atomicWrite(path.join(side, 'project.json'), JSON.stringify(project, null, 2));
  return { ok: true, savedAt: Date.now(), sidecar: side };
}

// -------------------------------------------------------------- memory ----

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const TEXT_EXT = ['.md', '.markdown', '.txt'];
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
};

async function addMemoryFiles(bookPath) {
  bookPath = await checkBook(bookPath);
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Add photos or fact files to story memory',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images & notes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'md', 'markdown', 'txt'] },
    ],
  });
  if (res.canceled) return [];
  const memDir = await ensureDir(path.join(sidecarDir(bookPath), 'memory'));
  const items = [];
  for (const src of res.filePaths) {
    const ext = path.extname(src).toLowerCase();
    const kind = IMAGE_EXT.includes(ext) ? 'image' : TEXT_EXT.includes(ext) ? 'text' : null;
    if (!kind) continue;
    // Copy into the book's memory folder so the memory travels with the book.
    const id = uid();
    const stored = `${id}_${path.basename(src)}`;
    await fsp.copyFile(src, path.join(memDir, stored));
    items.push({
      id, kind, name: path.basename(src), file: stored,
      notes: '', tags: '', includeInAI: true, sendImage: false, added: Date.now(),
    });
  }
  return items;
}

async function newMemoryNote(bookPath, name) {
  bookPath = await checkBook(bookPath);
  const memDir = await ensureDir(path.join(sidecarDir(bookPath), 'memory'));
  const id = uid();
  const safe = (name || 'note').replace(/[^\w\- ]+/g, '').trim() || 'note';
  const stored = `${id}_${safe}.md`;
  await fsp.writeFile(path.join(memDir, stored), `# ${name || 'Note'}\n\n`, 'utf8');
  return { id, kind: 'text', name: `${safe}.md`, file: stored, notes: '', tags: '', includeInAI: true, sendImage: false, added: Date.now() };
}

const memPath = (bookPath, file) => path.join(sidecarDir(bookPath), 'memory', path.basename(file));

// --------------------------------------------------------------- AI ----
// Three wire formats cover nearly every provider:
//   anthropic  -> Claude
//   openai     -> OpenAI, plus anything "OpenAI-compatible": Ollama, LM Studio,
//                 OpenRouter, Groq, Together, Mistral, DeepSeek, xAI, etc.
//   gemini     -> Google Gemini
// Each request is built here (not in the window) so keys never leave this process
// and browser CORS rules don't get in the way.

async function loadImagesForAI(bookPath, imageFiles) {
  const out = [];
  if (!(await isTrustedBook(bookPath))) return out;
  for (const f of imageFiles || []) {
    try {
      const p = memPath(bookPath, f);
      const ext = path.extname(p).toLowerCase();
      const bytes = await fsp.readFile(p);
      if (!isImageBytes(bytes)) continue;
      const data = bytes.toString('base64');
      out.push({ mime: MIME[ext] || 'image/png', data });
    } catch { /* skip missing */ }
  }
  return out;
}

// AI requests never follow redirects. A redirect would re-send the request,
// including the key header (x-api-key / x-goog-api-key) and your manuscript
// text, to wherever the server points, so it is refused instead.
async function aiFetch(url, opts) {
  try {
    return await fetch(url, { ...opts, redirect: 'error' });
  } catch (e) {
    if (/redirect/i.test(`${e.message} ${e.cause?.message || ''}`)) {
      let host = url;
      try { host = new URL(url).host; } catch { /* keep url */ }
      throw new Error(`The AI server at ${host} tried to send the request somewhere else (a redirect). Crucible never follows redirects for AI requests, so your key and text weren't sent on. Check the Base URL in Settings (for example https:// instead of http://, or a missing /v1).`);
    }
    throw e;
  }
}

function trimBase(u) {
  return (u || '').replace(/\/+$/, '');
}

async function callAI({ providerId, system, messages, bookPath, imageFiles }) {
  const s = await loadSettings();
  const p = s.providers.find((x) => x.id === (providerId || s.activeProviderId));
  if (!p) throw new Error('No AI provider selected. Add one in Settings.');
  const key = decryptKey(p.apiKey);
  const images = await loadImagesForAI(bookPath, imageFiles);
  // Pictures ride along with the newest message (the one being answered).
  const lastUser = messages.map((m) => m.role).lastIndexOf('user');
  const maxTokens = Number(p.maxTokens) || 4096;
  const temperature = p.temperature === '' || p.temperature == null ? undefined : Number(p.temperature);
  const timeoutMs = (Number(p.timeoutSec) || 180) * 1000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (p.type === 'anthropic') {
      const msgs = messages.map((m, i) => {
        if (i === lastUser && images.length) {
          return {
            role: 'user',
            content: [
              ...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } })),
              { type: 'text', text: m.content },
            ],
          };
        }
        return { role: m.role, content: m.content };
      });
      const body = { model: p.model, max_tokens: maxTokens, system, messages: msgs };
      if (temperature !== undefined) body.temperature = temperature;
      const r = await aiFetch(`${trimBase(p.baseUrl) || 'https://api.anthropic.com'}/v1/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
      return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    }

    if (p.type === 'gemini') {
      const contents = messages.map((m, i) => {
        const parts = [{ text: m.content }];
        if (i === lastUser) {
          images.forEach((im) => parts.unshift({ inline_data: { mime_type: im.mime, data: im.data } }));
        }
        return { role: m.role === 'assistant' ? 'model' : 'user', parts };
      });
      const body = {
        system_instruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: maxTokens, ...(temperature !== undefined ? { temperature } : {}) },
      };
      const base = trimBase(p.baseUrl) || 'https://generativelanguage.googleapis.com/v1beta';
      const r = await aiFetch(`${base}/models/${encodeURIComponent(p.model)}:generateContent`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
      return (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
    }

    // Default: OpenAI-compatible chat completions
    const msgs = [{ role: 'system', content: system }];
    messages.forEach((m, i) => {
      if (i === lastUser && images.length) {
        msgs.push({
          role: 'user',
          content: [
            ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data}` } })),
            { type: 'text', text: m.content },
          ],
        });
      } else msgs.push({ role: m.role, content: m.content });
    });
    let body = SettingsCore.openAIChatBody(p.baseUrl, { model: p.model, messages: msgs, maxTokens, temperature });
    const headers = { 'content-type': 'application/json' };
    if (key) headers.authorization = `Bearer ${key}`;
    for (let attempt = 0; ; attempt++) {
      const r = await aiFetch(`${trimBase(p.baseUrl) || 'https://api.openai.com/v1'}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j.choices?.[0]?.message?.content || '';
      const msg = j.error?.message || j.message || `HTTP ${r.status}`;
      const fixed = r.status === 400 && attempt < 2 ? SettingsCore.fixOpenAIBody(msg, body) : null;
      if (!fixed) throw new Error(msg);
      body = fixed; // the server told us which parameter name it wants: retry
    }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`The AI didn't answer within ${timeoutMs / 1000}s.`);
    if (e.cause?.code === 'ECONNREFUSED') throw new Error(`Couldn't reach ${p.baseUrl || 'the provider'} — is the server running?`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------- PDF export ----
// We render the book as a styled HTML page in an invisible window, then use
// Chromium's built-in "print to PDF". No extra libraries needed.

async function exportPdf({ html, options, suggestedName }) {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export book as PDF',
    defaultPath: suggestedName || 'book.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };

  // The page is rendered in a locked-down, invisible window: no JavaScript,
  // its own private session, and a filter that refuses every request except
  // the page itself and pictures embedded in it. So nothing in a book can
  // pull other files from the computer, or anything from the internet, into
  // the PDF.
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'crucible-export-'));
  const tmp = path.join(tmpDir, 'book.html');
  await fsp.writeFile(tmp, html, 'utf8');
  const ses = session.fromPartition(`crucible-print-${uid()}`);
  ses.webRequest.onBeforeRequest((d, cb) => {
    let ok = d.url.startsWith('data:');
    if (!ok && d.url.startsWith('file:')) { try { ok = fileURLToPath(d.url) === tmp; } catch { ok = false; } }
    cb({ cancel: !ok });
  });
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false, contextIsolation: true, nodeIntegration: false, session: ses, webSecurity: true },
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await win.loadURL(pathToFileURL(tmp).href);
    const pageSizes = {
      letter: 'Letter',
      a4: 'A4',
      a5: 'A5',
      trade6x9: { width: 6, height: 9 },
      digest55x85: { width: 5.5, height: 8.5 },
    };
    const m = Number(options.marginIn) || 0.75;
    const pdf = await win.webContents.printToPDF({
      pageSize: pageSizes[options.pageSize] || 'Letter',
      printBackground: true,
      generateDocumentOutline: true, // PDF bookmarks from the chapter headings
      margins: { top: m, bottom: m, left: m, right: m },
      displayHeaderFooter: !!options.pageNumbers,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;text-align:center;font-family:Georgia,serif;font-size:9px;color:#444;">' +
        '<span class="pageNumber"></span></div>',
    });
    await fsp.writeFile(res.filePath, pdf);
    return { ok: true, path: res.filePath };
  } finally {
    win.destroy();
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ------------------------------------------------- package & back up ----
// Desktop edition: there is no single "Crucible folder", so the package is
// built from: recent books (manuscript + .crucible folder + images), playlist
// songs, a settings snapshot, the browser edition (crucible.html) and,
// optionally, the installed program folder.
const Zip = require('./src/js/zip.js');
const { Readable } = require('stream');
const pkgScans = new Map();
let pkgCancel = false;

async function walkFiles(dir, relBase, group, out, depth = 0) {
  if (depth > 12) return;
  for (const ent of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, ent.name);
    const rel = `${relBase}/${ent.name}`;
    if (ent.isDirectory()) await walkFiles(full, rel, group, out, depth + 1);
    else if (ent.isFile() && !/^Crucible backup .*\.zip$/i.test(ent.name)) {
      const st = await fsp.stat(full).catch(() => null);
      if (st) out.push({ group, name: rel, path: full, size: st.size, mtime: st.mtimeMs });
    }
  }
}

async function packageScan() {
  const s = await loadSettings();
  const files = [];
  const notes = [];
  const usedNames = new Set();
  const uniq = (n) => { let x = n, i = 2; while (usedNames.has(x)) x = `${n} (${i++})`; usedNames.add(x); return x; };
  for (const bookPath of s.recent || []) {
    if (!(await isTrustedBook(bookPath)) || !fs.existsSync(bookPath)) continue;
    const base = uniq(`Books/${path.basename(bookPath, path.extname(bookPath))}`);
    const st = await fsp.stat(bookPath);
    files.push({ group: 'books', name: `${base}/${path.basename(bookPath)}`, path: bookPath, size: st.size, mtime: st.mtimeMs });
    const side = sidecarDir(bookPath);
    if (fs.existsSync(side)) await walkFiles(side, `${base}/${path.basename(side)}`, 'books', files);
    const imgs = path.join(path.dirname(bookPath), 'images');
    if (fs.existsSync(imgs)) await walkFiles(imgs, `${base}/images`, 'books', files);
  }
  for (const song of s.playlist || []) {
    // Only actual music files from your own disk go into a backup.
    if (typeof song.path !== 'string' || !path.isAbsolute(song.path) || isNetPath(song.path) || !/\.(mp3|m4a|ogg|wav|flac|aac)$/i.test(song.path) || !fs.existsSync(song.path)) continue;
    const st = await fsp.stat(song.path);
    files.push({ group: 'music', name: `Music/${path.basename(song.path)}`, path: song.path, size: st.size, mtime: st.mtimeMs });
  }
  const webEd = path.join(__dirname, 'dist-web', 'crucible.html');
  if (fs.existsSync(webEd)) {
    const st = await fsp.stat(webEd);
    files.push({ group: 'books', name: 'crucible.html', path: webEd, size: st.size, mtime: st.mtimeMs });
  }
  if (app.isPackaged) {
    await walkFiles(path.dirname(process.execPath), 'Crucible program', 'program', files);
  } else notes.push('Running from source: the program folder isn\'t included (the source code is your copy).');
  if (!(s.recent || []).length) notes.push('No books opened yet, so none are included.');
  const sum = (g) => files.filter((f) => f.group === g).reduce((a, f) => [a[0] + 1, a[1] + f.size], [0, 0]);
  const groups = [
    { id: 'books', label: 'Recent books (manuscripts, story memory, chapter images, backups) + browser edition', optional: false },
    { id: 'music', label: 'Playlist songs', optional: true },
    { id: 'program', label: 'Crucible desktop program', optional: true },
  ].map((g) => ({ ...g, count: sum(g.id)[0], bytes: sum(g.id)[1], checked: true })).filter((g) => g.count);
  groups.push({ id: 'settings', label: 'Settings (AIs, playlist, layout)', optional: false, count: 1, bytes: 0, checked: true });
  const token = uid();
  pkgScans.set(token, files);
  // API keys are left out of backups unless you tick the box.
  return { source: null, groups, notes, keysInFile: false, token };
}

async function packageWrite(token, { groups, includeKeys, readme }, sender) {
  const files = pkgScans.get(token) || [];
  const s = await loadSettings();
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Save the Crucible backup',
    defaultPath: path.join(s.packageDir || app.getPath('documents'), `Crucible backup ${stamp}.zip`),
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  await writeSettings({ ...s, packageDir: path.dirname(res.filePath) });
  const settingsText = JSON.stringify(SettingsCore.portableSettings(s, {
    includeKeys, platform: 'desktop', version: require('./package.json').version, plainKeyOf: (p) => decryptKey(p.apiKey),
  }), null, 2);
  const text = (name, t) => { const b = Buffer.from(t); return { name, size: b.length, mtime: new Date(), stream: () => Readable.toWeb(Readable.from([b])) }; };
  const entries = [
    ...files.filter((f) => groups[f.group] !== false).map((f) => ({ name: f.name, size: f.size, mtime: new Date(f.mtime), stream: () => Readable.toWeb(fs.createReadStream(f.path)) })),
    ...(groups.settings !== false ? [text('crucible-settings.json', settingsText)] : []),
    text('READ ME - Crucible backup.txt', readme),
  ];
  const tmp = `${res.filePath}.partial`;
  const fh = await fsp.open(tmp, 'w');
  pkgCancel = false;
  const ctl = { get aborted() { return pkgCancel; } };
  let last = 0;
  try {
    const r = await Zip.writeZip(entries, { write: (u) => fh.write(u), close: () => fh.close() }, {
      signal: ctl,
      onProgress: (done, total, name) => {
        const now = Date.now();
        if (now - last > 120) { last = now; sender.send('package:progress', { done, total, name }); }
      },
    });
    await fsp.rename(tmp, res.filePath);
    const bookRoots = (s.recent || []).map((p) => path.parse(p).root.toLowerCase());
    const sameDrive = bookRoots.includes(path.parse(res.filePath).root.toLowerCase());
    return { ok: true, name: path.basename(res.filePath), where: res.filePath, sameFolder: false, sameDrive, ...r };
  } catch (e) {
    await fh.close().catch(() => {});
    await fsp.unlink(tmp).catch(() => {});
    if (e.message === 'Cancelled') return { canceled: true };
    throw e;
  }
}

async function packageRestore(sender) {
  const pick = await dialog.showOpenDialog(mainWindow, { title: 'Choose a Crucible backup to restore', properties: ['openFile'], filters: [{ name: 'Crucible backup', extensions: ['zip'] }] });
  if (pick.canceled) return { canceled: true };
  const fh = await fsp.open(pick.filePaths[0], 'r');
  try {
    const size = (await fh.stat()).size;
    const zip = await Zip.readZip({ size, read: async (o, l) => { const b = Buffer.alloc(l); await fh.read(b, 0, l, o); return new Uint8Array(b.buffer, b.byteOffset, l); } });
    const names = zip.entries.map((e) => e.name);
    if (!names.includes('crucible-settings.json') && !names.includes('READ ME - Crucible backup.txt')) {
      return { ok: false, reason: 'That zip isn\'t a Crucible backup (no crucible-settings.json or READ ME inside).' };
    }
    const where = await dialog.showOpenDialog(mainWindow, { title: 'Where should the backup be restored? (a new folder is created inside)', properties: ['openDirectory', 'createDirectory'] });
    if (where.canceled) return { canceled: true };
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');
    let dest = path.join(where.filePaths[0], `Crucible (restored ${stamp})`);
    for (let i = 2; fs.existsSync(dest); i++) dest = path.join(where.filePaths[0], `Crucible (restored ${stamp}) ${i}`);
    await ensureDir(dest);
    const total = zip.entries.reduce((a, e) => a + e.size, 0);
    const disk = await fsp.statfs(dest).catch(() => null);
    if (disk && total > disk.bavail * disk.bsize) {
      await fsp.rmdir(dest).catch(() => {});
      return { ok: false, reason: `Not enough free space: the backup needs ${(total / 1e9).toFixed(1)} GB.` };
    }
    let done = 0, files = 0, last = 0;
    pkgCancel = false;
    for (const en of zip.entries) {
      if (pkgCancel) return { canceled: true, partial: dest };
      const parts = Zip.safeParts(en.name);
      if (!parts.length) continue;
      const target = path.join(dest, ...parts);
      if (!target.startsWith(dest + path.sep)) continue;
      if (en.dir) { await ensureDir(target); continue; }
      await ensureDir(path.dirname(target));
      const out = await fsp.open(target, 'w');
      const reader = zip.open(en).getReader();
      try {
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          await out.write(r.value);
          done += r.value.length;
          if (Date.now() - last > 120) { last = Date.now(); sender.send('package:progress', { done, total, name: en.name }); }
        }
      } finally { await out.close(); }
      files++;
    }
    // Merge the backup's settings into this computer's (adds/updates, never deletes).
    let imported = null;
    const sf = path.join(dest, 'crucible-settings.json');
    if (fs.existsSync(sf)) {
      const file = JSON.parse(await fsp.readFile(sf, 'utf8'));
      const r = SettingsCore.mergeImported(await loadSettings(), file, { platform: 'desktop', encrypt: encryptKey, endpoints: 'ask' });
      await writeSettings(r.next);
      imported = { providers: r.providers, keysMissing: r.keysMissing, endpointChanges: r.endpointChanges, confirmToken: holdEndpoints(file, r) };
    }
    // Find restored books (a .md with a matching .crucible folder beside it).
    const books = [];
    const scan = async (d, depth) => {
      if (depth > 6) return;
      for (const ent of await fsp.readdir(d, { withFileTypes: true })) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) { if (!ent.name.endsWith('.crucible')) await scan(full, depth + 1); }
        else if (/\.md$/i.test(ent.name) && fs.existsSync(sidecarDir(full))) books.push(full);
      }
    };
    await scan(dest, 0);
    for (const b of books) await trustBook(b);
    const s = await loadSettings();
    s.recent = [...books, ...(s.recent || []).filter((r) => !books.includes(r))].slice(0, 10);
    await writeSettings(s);
    return { ok: true, folder: dest, files, books, imported, settings: publicSettings(s) };
  } finally { await fh.close(); }
}

// ---------------------------------------------------------------- IPC ----

// Only Crucible's own window (its top frame, showing Crucible's own page) may
// call into this process.
const appPage = () => pathToFileURL(path.join(__dirname, 'src', 'index.html')).href;
function fromApp(e) {
  const f = e.senderFrame;
  const top = e.sender.mainFrame;
  return !!mainWindow && e.sender === mainWindow.webContents && !!f && !!top && f.processId === top.processId && f.routingId === top.routingId && f.url.split('#')[0] === appPage();
}
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => {
  if (!fromApp(e)) throw new Error('Blocked: request did not come from Crucible.');
  return fn(e, ...a);
});
const listen = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (fromApp(e)) fn(e, ...a); });

function registerIpc() {
  handle('book:open', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Open manuscript',
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    });
    if (res.canceled) return null;
    await trustBook(res.filePaths[0]);
    return openBookAt(res.filePaths[0]);
  });

  handle('book:openPath', (_e, p) => openBookAt(p));

  handle('book:saveAs', async (_e, { text, project, currentPath }) => {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save manuscript as',
      defaultPath: currentPath || 'Untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await trustBook(res.filePath);
    // Carry story memory and linked pictures across to the new location.
    if (currentPath && currentPath !== res.filePath && (await isTrustedBook(currentPath))) {
      for (const sub of ['memory', 'linked']) {
        const from = path.join(sidecarDir(currentPath), sub);
        if (fs.existsSync(from)) await fsp.cp(from, path.join(sidecarDir(res.filePath), sub), { recursive: true }).catch(() => {});
      }
      // …and chapter images, if the new file is in a different folder.
      const imgs = path.join(path.dirname(currentPath), 'images');
      if (path.dirname(currentPath) !== path.dirname(res.filePath) && fs.existsSync(imgs)) {
        await fsp.cp(imgs, path.join(path.dirname(res.filePath), 'images'), { recursive: true }).catch(() => {});
      }
    }
    const r = await saveBook({ bookPath: res.filePath, text, project });
    await addRecent(res.filePath);
    return { ...r, path: res.filePath };
  });

  handle('book:save', (_e, args) => saveBook(args));

  handle('book:backups', async (_e, bookPath) => {
    bookPath = await checkBook(bookPath);
    const dir = path.join(sidecarDir(bookPath), 'backups');
    if (!fs.existsSync(dir)) return [];
    return (await fsp.readdir(dir)).filter((f) => f.endsWith('.md')).sort().reverse();
  });

  handle('book:readBackup', async (_e, { bookPath, name }) =>
    fsp.readFile(path.join(sidecarDir(await checkBook(bookPath)), 'backups', path.basename(String(name))), 'utf8'));

  // Chapter images live in an "images" folder next to the manuscript and are
  // referenced from the .md as images/chapter-xxxx.png (part of the book).
  handle('book:chooseImage', async (_e, bookPath) => {
    bookPath = await checkBook(bookPath);
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a chapter image', properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (res.canceled) return null;
    const src = res.filePaths[0];
    const dir = await ensureDir(path.join(path.dirname(bookPath), 'images'));
    const name = `chapter-${uid()}${path.extname(src).toLowerCase()}`;
    await fsp.copyFile(src, path.join(dir, name));
    return { rel: `images/${name}`, name: path.basename(src) };
  });
  // Pictures linked to passages are copied into "<Book>.crucible/linked/" so
  // they travel with the book (any computer, any drive letter). They're not
  // part of the manuscript and never go into exports. from: a picture you
  // linked earlier by its path (copied in once); otherwise a file dialog.
  handle('book:linkPicture', async (_e, { bookPath, from } = {}) => {
    bookPath = await checkBook(bookPath);
    let src = from;
    if (!src) {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose a picture to link', properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
      });
      if (res.canceled) return null;
      src = res.filePaths[0];
    }
    if (typeof src !== 'string' || !path.isAbsolute(src) || isNetPath(src) || !MIME[path.extname(src).toLowerCase()]) return null;
    const st = await fsp.stat(src).catch(() => null);
    if (!st || !st.isFile() || st.size > 100 * 1024 * 1024) return null;
    const bytes = await fsp.readFile(src);
    if (!isImageBytes(bytes)) return null;
    const dir = await ensureDir(path.join(sidecarDir(bookPath), 'linked'));
    const safe = path.basename(src).replace(/[^\w.\- ]+/g, '_').slice(-80);
    const stored = `${uid()}_${safe}`;
    await fsp.writeFile(path.join(dir, stored), bytes);
    return { ref: `bk:linked/${stored}`, name: path.basename(src) };
  });

  // Writing-area background photo: one copy kept in Crucible's own folder
  // (userData/backgrounds), referenced as "bg:<file>".
  const bgDir = () => path.join(app.getPath('userData'), 'backgrounds');
  handle('settings:chooseBackground', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a background photo for the writing area', properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    });
    if (res.canceled) return null;
    const src = res.filePaths[0];
    if (!MIME[path.extname(src).toLowerCase()] || isNetPath(src)) return null;
    const st = await fsp.stat(src).catch(() => null);
    if (!st || st.size > 20 * 1024 * 1024) throw new Error('That picture is too large (20 MB at most).');
    const bytes = await fsp.readFile(src);
    if (!isImageBytes(bytes)) throw new Error("That file isn't a picture Crucible can show.");
    const dir = await ensureDir(bgDir());
    const stored = `${uid()}${path.extname(src).toLowerCase()}`;
    await fsp.writeFile(path.join(dir, stored), bytes);
    // Only the newest is kept.
    for (const f of await fsp.readdir(dir).catch(() => [])) if (f !== stored) await fsp.unlink(path.join(dir, f)).catch(() => {});
    return { ref: `bg:${stored}`, name: path.basename(src) };
  });
  handle('settings:backgroundUrl', async (_e, ref) => {
    if (typeof ref !== 'string' || !ref.startsWith('bg:')) return null;
    const p = path.join(bgDir(), path.basename(ref.slice(3)));
    const ext = path.extname(p).toLowerCase();
    const bytes = await fsp.readFile(p).catch(() => null);
    return bytes && MIME[ext] && isImageBytes(bytes) ? `data:${MIME[ext]};base64,${bytes.toString('base64')}` : null;
  });

  handle('book:readImage', async (_e, { bookPath, rel }) => {
    // Only real pictures inside the book's own folder (links followed, then
    // checked again), never other files and never another computer.
    try {
      if (!(await isTrustedBook(bookPath)) || typeof rel !== 'string' || isNetPath(rel) || path.isAbsolute(rel)) return null;
      const base = await fsp.realpath(path.dirname(bookPath));
      const p = await fsp.realpath(path.resolve(base, rel));
      const ext = path.extname(p).toLowerCase();
      if (!p.startsWith(base + path.sep) || !MIME[ext]) return null;
      const bytes = await fsp.readFile(p);
      if (!isImageBytes(bytes)) return null;
      return `data:${MIME[ext]};base64,${bytes.toString('base64')}`;
    } catch { return null; }
  });

  handle('memory:add', (_e, bookPath) => addMemoryFiles(bookPath));
  handle('memory:newNote', (_e, { bookPath, name }) => newMemoryNote(bookPath, name));
  handle('memory:readText', async (_e, { bookPath, file }) => fsp.readFile(memPath(await checkBook(bookPath), String(file)), 'utf8').catch(() => ''));
  handle('memory:writeText', async (_e, { bookPath, file, text }) => atomicWrite(memPath(await checkBook(bookPath), String(file)), String(text)));
  handle('memory:path', async (_e, { bookPath, file }) => memPath(await checkBook(bookPath), String(file)));
  handle('memory:delete', async (_e, { bookPath, file }) => fsp.unlink(memPath(await checkBook(bookPath), String(file))).catch(() => {}));

  handle('music:pickFiles', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Add songs',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'ogg', 'wav', 'flac', 'aac'] }],
    });
    return res.canceled ? [] : res.filePaths;
  });

  handle('music:pickFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { title: 'Add a music folder', properties: ['openDirectory'] });
    if (res.canceled) return [];
    const found = [];
    const walk = async (d, depth) => {
      if (depth > 4) return;
      for (const ent of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) await walk(full, depth + 1);
        else if (/\.(mp3|m4a|ogg|wav|flac|aac)$/i.test(ent.name)) found.push(full);
      }
    };
    await walk(res.filePaths[0], 0);
    return found.sort();
  });

  handle('file:pickImage', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a picture to link',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  // Never look up paths on other computers (Windows would send your login to them).
  const localPath = (p) => typeof p === 'string' && path.isAbsolute(p) && !isNetPath(p);
  handle('file:exists', (_e, p) => localPath(p) && fs.existsSync(p));
  handle('file:reveal', (_e, p) => { if (localPath(p)) shell.showItemInFolder(p); });

  handle('settings:get', async () => publicSettings(await loadSettings()));
  handle('settings:save', (_e, s) => saveSettings(s));
  handle('settings:export', (_e, o) => exportSettings(o || {}));
  handle('settings:import', (_e, f) => importSettings(f));
  handle('settings:confirmEndpoints', (_e, token) => confirmEndpoints(String(token)));
  handle('package:scan', () => packageScan());
  handle('package:write', (e, token, opts) => packageWrite(token, opts, e.sender));
  listen('package:cancel', () => { pkgCancel = true; });
  handle('package:restore', (e) => packageRestore(e.sender));
  handle('app:version', () => require('./package.json').version);

  handle('file:saveText', async (_e, { suggestedName, text }) => {
    const res = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName, filters: [{ name: 'Settings', extensions: ['json'] }] });
    if (res.canceled || !res.filePath) return null;
    await fsp.writeFile(res.filePath, text, 'utf8');
    return res.filePath;
  });
  handle('file:saveBinary', async (_e, { suggestedName, bytes, kind }) => {
    const res = await dialog.showSaveDialog(mainWindow, { title: `Save ${kind.description}`, defaultPath: suggestedName, filters: [{ name: kind.description, extensions: [kind.ext] }] });
    if (res.canceled || !res.filePath) return { canceled: true };
    await fsp.writeFile(res.filePath, Buffer.from(bytes));
    return { ok: true, name: path.basename(res.filePath), path: res.filePath };
  });
  handle('file:openData', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { title: 'Import data into story memory', properties: ['openFile'], filters: [{ name: 'Data', extensions: ['csv', 'tsv', 'txt', 'json'] }] });
    if (res.canceled) return null;
    return { name: path.basename(res.filePaths[0]), text: await fsp.readFile(res.filePaths[0], 'utf8') };
  });
  handle('file:openText', async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Settings', extensions: ['json'] }] });
    if (res.canceled) return null;
    return fsp.readFile(res.filePaths[0], 'utf8');
  });

  handle('ai:chat', async (_e, args) => {
    try {
      return { ok: true, text: await callAI(args) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  handle('export:pdf', (_e, args) => exportPdf(args));

  listen('state:dirty', (_e, dirty) => { rendererDirty = !!dirty; });
  listen('window:title', (_e, t) => mainWindow && mainWindow.setTitle(t));
}

// --------------------------------------------------------------- window ----

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#17151a',
    title: 'Crucible',
    icon: path.join(__dirname, 'build', 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Right-click spelling suggestions get merged into our own context menu.
  mainWindow.webContents.on('context-menu', (_e, params) => {
    mainWindow.webContents.send('spell:suggestions', {
      word: params.misspelledWord,
      suggestions: params.dictionarySuggestions || [],
    });
  });
  ipcMain.removeHandler('spell:replace');
  handle('spell:replace', (_e, word) => mainWindow.webContents.replaceMisspelling(String(word)));

  // Open external links in the real browser, never inside Crucible.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault());

  // Crucible needs no camera, microphone, location, notifications…: refuse
  // every permission except reading the clipboard for Paste.
  const ses = mainWindow.webContents.session;
  const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
  // The window itself never talks to the internet (AI calls are made here, in
  // the main process) and never reads files from other computers.
  ses.webRequest.onBeforeRequest((d, cb) => {
    if (d.webContentsId !== mainWindow?.webContents.id) return cb({});
    const u = d.url;
    const ok = /^(data|blob|devtools):/i.test(u) || (/^file:\/\/\//i.test(u) && !/^file:\/{4}/i.test(u));
    cb({ cancel: !ok });
  });

  mainWindow.on('close', (e) => {
    if (!rendererDirty) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'You have unsaved changes to your manuscript.',
    });
    if (choice === 2) e.preventDefault();
    else if (choice === 0) {
      e.preventDefault();
      mainWindow.webContents.send('app:saveAndQuit');
    }
  });
}

listen('app:quitNow', () => {
  rendererDirty = false;
  app.quit();
});

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Exposed for automated tests only.
module.exports = { sidecarDir, encryptKey, decryptKey };
