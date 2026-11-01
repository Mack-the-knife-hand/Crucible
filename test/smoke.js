// =============================================================================
// End-to-end smoke test:  npx electron test/smoke.js  (needs a display; on a
// headless Linux box run it under xvfb-run).
// Launches the real app against a temp book, a fake local AI server and stubbed
// file dialogs, then drives it like a user: flag a passage, negotiate, apply
// the AI's revision, add memory, link a song, save, and export a PDF.
// Screenshots + the PDF land in CRUCIBLE_TEST_OUT (default: OS temp dir).
// =============================================================================

const { app, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const OUT = process.env.CRUCIBLE_TEST_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-out-'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-test-'));
const FIX = process.env.CRUCIBLE_FIXTURES; // folder with test.png + test.mp3 (optional)
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', path.join(TMP, 'userData'));
global.__crucibleTestUserData = true;

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

// ---------- sample book
const BOOK = path.join(TMP, 'Oakvale Test.md');
fs.writeFileSync(BOOK, `# Oakvale

## Chapter One: Dust

The dust rolled over Oakvale like it had a grudge. Wade Miller watched the road from the porch of the sheriff's office, hat tipped low.

Judy brought him coffee and didn't say a word. She didn't need to.

***

Down at the plant, the machines never stopped.

<!-- private note: tighten this chapter -->

## Chapter Two: The Observer

Cross arrived on a Tuesday, which nobody in Oakvale would remember later.
`);

// ---------- fake OpenAI-compatible AI server
let lastRequest = null;
const beacons = [];
const server = http.createServer((req, res) => {
  // Anything a hostile manuscript tries to fetch lands here (and is counted).
  // A server that redirects AI requests to another address.
  if (req.url.startsWith('/redirect/')) { res.writeHead(307, { location: `http://127.0.0.1:${server.address().port}/stolen` }); res.end(); return; }
  if (!req.url.startsWith('/v1/')) { beacons.push(req.url); res.writeHead(200, { 'content-type': 'image/png' }); res.end(); return; }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    lastRequest = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') };
    const userMsg = lastRequest.body.messages.at(-1);
    const text = typeof userMsg.content === 'string' ? userMsg.content : userMsg.content.find((c) => c.type === 'text').text;
    const id = (text.match(/<passage id="([\w-]+)"/) || [])[1] || 'new';
    const sys = lastRequest.body.messages[0]?.content || '';
    const content = sys.includes('ONE section of the book')
      ? (text.includes('Cross arrived on a Tuesday') ? '<change>\n<find>Cross arrived on a Tuesday, which nobody in Oakvale would remember later.</find>\n<replace>Cross arrived on a Tuesday, a day nobody in Oakvale would remember.</replace>\n<why>tighter</why>\n</change>' : '<none/>')
      : /epigraph/i.test(text)
      ? 'Done:\n\n<insert position="before" anchor="## Chapter One: Dust">\n> *Dust remembers.*\n>\n> — Anonymous\n</insert>'
      : `Here's a leaner version that keeps Wade guarded:\n\n<revision id="${id}">Wade Miller watched the road from the sheriff's porch and said nothing at all.</revision>\n\nWant it darker?`;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});

// ---------- settings with the fake provider
function writeSettings(port) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({
    providers: [{ id: 'fake1', name: 'Fake local AI', type: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', apiKey: 'raw:sk-test', maxTokens: 500 }],
    activeProviderId: 'fake1',
    playlist: [],
    ui: { theme: 'dark', fontSize: 17, view: 'split' },
    // A book opened with an earlier version: it's trusted on first run.
    recent: [BOOK],
  }));
}

// ---------- stub native dialogs
const pdfOut = path.join(OUT, 'Oakvale Test.pdf');
const RESTORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-restore-'));
dialog.showSaveDialog = async (_w, o = {}) => {
  const t = o.title || '';
  if (/backup/i.test(t)) return { canceled: false, filePath: path.join(OUT, 'desktop-backup.zip') };
  if (/Word document/i.test(t)) return { canceled: false, filePath: path.join(OUT, 'desktop.docx') };
  if (/EPUB/i.test(t)) return { canceled: false, filePath: path.join(OUT, 'desktop.epub') };
  return { canceled: false, filePath: pdfOut };
};
dialog.showOpenDialog = async (_w, opts) => {
  if (/songs/i.test(opts.title)) return { canceled: false, filePaths: [path.join(FIX || TMP, 'test.mp3')] };
  if (/Choose a Crucible backup/i.test(opts.title)) return { canceled: false, filePaths: [path.join(OUT, 'desktop-backup.zip')] };
  if (/Where should the backup be restored/i.test(opts.title)) return { canceled: false, filePaths: [RESTORE_DIR] };
  if (/Import data/i.test(opts.title)) {
    const csv = path.join(TMP, 'cast.csv');
    fs.writeFileSync(csv, 'Name,Role\nMara,Courier\n');
    return { canceled: false, filePaths: [csv] };
  }
  if (/memory/i.test(opts.title)) {
    const notes = path.join(TMP, 'Character bible.md');
    fs.writeFileSync(notes, '# Wade Miller\nSheriff of Oakvale. Widower. Never raises his voice.\n');
    const files = [notes];
    if (FIX && fs.existsSync(path.join(FIX, 'test.png'))) files.push(path.join(FIX, 'test.png'));
    return { canceled: false, filePaths: files };
  }
  return { canceled: true, filePaths: [] };
};
dialog.showMessageBoxSync = () => 1;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
}

async function run(win) {
  const js = (code) => win.webContents.executeJavaScript(code);
  const errors = [];
  win.webContents.on('console-message', (e) => {
    if (process.env.DEBUG) console.log('  [renderer]', e.message ?? e.params?.message);
    const lvl = e.level ?? e.params?.level;
    if (lvl === 'error' || lvl === 3) errors.push(e.message ?? e.params?.message);
  });

  await wait(800);
  await js(`App.openPath(${JSON.stringify(BOOK)})`);
  await wait(300);
  check('Book opens', (await js('Editor.text')).includes('dust rolled'));
  check('Outline built from headings', (await js('Editor.outline.length')) === 3);

  // Flag a passage and negotiate it.
  const target = "Wade Miller watched the road from the porch of the sheriff's office, hat tipped low.";
  await js(`(() => { const t = Editor.text; const a = t.indexOf(${JSON.stringify(target)}); Editor.ta.focus(); Editor.ta.setSelectionRange(a, a + ${target.length}); })()`);
  await js('Pool.addFromSelection(false, true)');
  await wait(200);
  check('Passage added to change pool', (await js('S.project.pool.length')) === 1);
  check('Passage put on the negotiation table', (await js('AI.activeItems().length')) === 1);

  // Right-click menu renders.
  await js(`Editor.showContextMenu({ preventDefault(){}, clientX: 500, clientY: 300 })`);
  check('Right-click menu shows pool option', (await js(`$('#ctxMenu').textContent`)).includes('Add to change pool'));
  await wait(250);
  await shot(win, '1-context-menu');
  await js(`$('#ctxMenu').classList.add('hidden')`);

  // Story memory.
  await js('Memory.add()');
  await wait(400);
  check('Memory files added', (await js('S.project.memory.length')) >= 1);
  await js(`S.project.memory.filter(m => m.kind === 'image').forEach(m => m.sendImage = true); Memory.render()`);

  // Negotiate with the (fake) AI.
  await js(`$('#chatInput').value = 'Make Wade more guarded.'; AI.send()`);
  for (let i = 0; i < 40 && (await js('AI.busy')); i++) await wait(150);
  await wait(200);
  const sys = lastRequest?.body?.messages?.[0]?.content || '';
  check('AI request reached provider', !!lastRequest && lastRequest.url === '/v1/chat/completions');
  check('API key sent as Bearer token', lastRequest?.auth === 'Bearer sk-test');
  check('Story memory included in prompt', sys.includes('Never raises his voice'));
  const lastUser = lastRequest?.body?.messages?.at(-1);
  const userText = typeof lastUser?.content === 'string' ? lastUser.content : lastUser?.content?.find((c) => c.type === 'text')?.text;
  check('Passage + context sent to AI', !!userText && userText.includes('<target>') && userText.includes('Judy brought him coffee'));
  if (FIX) check('Memory photo attached for vision', Array.isArray(lastUser?.content) && lastUser.content.some((c) => c.type === 'image_url'));
  check('Revision card rendered', (await js(`document.querySelectorAll('.revision').length`)) === 1);
  await js(`document.querySelector('.revision .rv-head button').click()`); // Diff
  await wait(100);
  check('Diff shows changes', (await js(`document.querySelector('.rv-diff').innerHTML`)).includes('<ins>'));
  await shot(win, '2-negotiation');

  // Apply it.
  await js(`[...document.querySelectorAll('.revision button')].find(b => b.textContent === 'Apply').click()`);
  await wait(200);
  const newText = "Wade Miller watched the road from the sheriff's porch and said nothing at all.";
  check('Revision applied to manuscript', (await js('Editor.text')).includes(newText) && !(await js('Editor.text')).includes('hat tipped low'));
  check('Pool item marked applied', (await js('S.project.pool[0].status')) === 'applied');

  // Undo works on the applied change.
  await js(`Editor.ta.focus(); document.execCommand('undo')`);
  await wait(100);
  check('Ctrl+Z undoes an AI change', (await js('Editor.text')).includes('hat tipped low'));
  await js(`Editor.ta.focus(); document.execCommand('redo')`);
  await wait(100);

  // Type above the passage: anchor must follow.
  await js(`Editor.replaceRange(0, 0, 'DRAFT 3\\n\\n')`);
  await wait(100);
  check('Pool anchor follows edits above it',
    await js(`(() => { const p = S.project.pool[0]; return Editor.text.slice(p.start, p.end) === p.text; })()`));

  // Link a song to the "Judy" paragraph (cursor, no selection).
  if (FIX) {
    await js(`(() => { const a = Editor.text.indexOf('Judy brought'); Editor.ta.focus(); Editor.ta.setSelectionRange(a + 3, a + 3); })()`);
    await js(`Links.startLink('song')`);
    await wait(200);
    await js(`[...document.querySelectorAll('.modal footer button')].find(b => b.textContent.startsWith('Browse')).click()`);
    await wait(300);
    check('Song linked to paragraph', (await js('S.project.links.length')) === 1 && (await js('S.project.links[0].text')).startsWith('Judy brought'));
    await js(`Links.open(S.project.links[0])`);
    await wait(800);
    check('Linked song plays in player', (await js(`!$('#audio').paused || $('#audio').currentTime > 0`)) && (await js(`$('#plTitle').textContent`)) === 'test.mp3');
    await js(`$('#audio').pause()`);
    await js(`App.showTab('left','links')`);
    await wait(200);
    await shot(win, '3-links');
    await js(`App.showTab('left','pool'); $('#poolFilter').value='all'; Pool.render()`);
  }

  // Save.
  await js('App.save()');
  await wait(400);
  const side = path.join(TMP, 'Oakvale Test.crucible');
  const savedMd = fs.readFileSync(BOOK, 'utf8');
  check('Manuscript saved to .md', savedMd.includes(newText) && savedMd.startsWith('DRAFT 3'));
  check('Song/picture links NOT written into the manuscript', !savedMd.includes('test.mp3'));
  const proj = JSON.parse(fs.readFileSync(path.join(side, 'project.json'), 'utf8'));
  check('Project sidecar saved', proj.pool.length === 1 && proj.chat.length === 2);
  check('Backup made on save', fs.readdirSync(path.join(side, 'backups')).length === 1);
  check('Memory copied into book folder', fs.readdirSync(path.join(side, 'memory')).length >= 1);

  // Reopen and confirm anchors are intact.
  await js(`App.openPath(${JSON.stringify(BOOK)})`);
  await wait(300);
  check('Pool survives reopen', await js(`(() => { const p = S.project.pool[0]; return p && Editor.text.slice(p.start, p.end) === p.text; })()`));
  await js(`App.showTab('left','pool'); $('#poolFilter').value='all'; Pool.render()`);
  await wait(200);
  await shot(win, '4-after-reopen');

  // AI adds an epigraph (insert, not just rewrite).
  await js(`S.project.meta.negotiate = []; $('#chatInput').value = 'Add an epigraph before chapter one'; AI.send()`);
  for (let i = 0; i < 40 && (await js('AI.busy')); i++) await wait(150);
  await js(`[...document.querySelectorAll('.revision:not(.applied) button')].find(b => b.textContent === 'Apply').click()`);
  await wait(200);
  check('AI inserts an epigraph before Chapter One', (await js('Editor.text')).includes('> — Anonymous\n\n## Chapter One: Dust'));

  // Collapsible panels persist in settings.
  await js(`App.setCollapsed('left', true)`);
  await wait(200);
  check('Left panel collapses', (await js(`$('#left').getBoundingClientRect().width`)) < 50);
  const sfile = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
  check('Panel state saved with versioned settings', sfile.ui.leftCollapsed === true && sfile.schema === 2);
  await js(`App.setCollapsed('left', false)`);

  // Settings export (with decrypted key) → import round trip.
  const exp = await js(`window.crucible.exportSettings({ includeKeys: true })`);
  check('Export includes the real API key when asked', exp.providers[0].apiKey === 'sk-test' && exp.from === 'desktop');
  exp.providers[0].id = 'copy1'; exp.providers[0].name = 'Imported AI';
  const imp = await js(`window.crucible.importSettings(${JSON.stringify(exp)})`);
  check('Import asks before adding a new AI', !imp.settings.providers.some((p) => p.name === 'Imported AI') && imp.endpointChanges.length === 1 && imp.endpointChanges[0].toHost.startsWith('127.0.0.1'));
  const impOk = await js(`window.crucible.confirmImportedEndpoints(${JSON.stringify(imp.confirmToken)})`);
  check('Import adds the provider with its key once confirmed', impOk.settings.providers.some((p) => p.name === 'Imported AI' && p.hasKey));
  check('Version reported', (await js('window.crucible.getVersion()')) === require('../package.json').version);

  // Prose pass over the whole book.
  await js(`$('#proseScope').value = 'book'; $('#proseLevel').value = 'line'; Prose.start()`);
  for (let i = 0; i < 60 && (await js('Prose.running')); i++) await wait(100);
  check('Prose pass returns a suggestion', (await js(`Prose.items().filter(i => i.status === 'pending').length`)) === 1);
  await js(`Prose.accept(Prose.items()[0])`);
  check('Prose suggestion applied', (await js('Editor.text')).includes('a day nobody in Oakvale would remember.'));

  // Package & back up (desktop)
  if (FIX) await js(`persistSettings({ playlist: [{ path: ${JSON.stringify(path.join(FIX || '', 'test.mp3'))}, name: 'test' }] })`);
  await js(`$('#btnPackage').click()`);
  await wait(600);
  check('Package window opens', (await js(`document.querySelector('.modal')?.textContent || ''`)).includes('Recent books'));
  await js(`document.querySelector('.modal footer button.accent').click()`);
  for (let i = 0; i < 80 && !fs.existsSync(path.join(OUT, 'desktop-backup.zip')); i++) await wait(150);
  await wait(500);
  const { execFileSync } = require('child_process');
  const zr = JSON.parse(execFileSync('python3', ['-c', `
import zipfile, json, sys
z = zipfile.ZipFile(sys.argv[1]); s = json.loads(z.read('crucible-settings.json'))
print(json.dumps({'bad': z.testzip(), 'names': z.namelist(), 'key': s['providers'][0].get('apiKey')}))`, path.join(OUT, 'desktop-backup.zip')]).toString());
  check('Desktop backup zip is valid', zr.bad === null);
  check('Desktop backup has book, sidecar, music, browser edition, settings', ['Books/Oakvale Test/Oakvale Test.md', 'crucible.html', 'crucible-settings.json', 'READ ME - Crucible backup.txt'].every((n) => zr.names.includes(n))
    && zr.names.some((n) => n.startsWith('Books/Oakvale Test/Oakvale Test.crucible/')) && (!FIX || zr.names.includes('Music/test.mp3')), zr.names.join(', '));
  check('Desktop backup leaves API keys out unless you tick the box', !zr.key, String(zr.key));
  await js(`document.querySelectorAll('.modal-back').forEach((m) => m.remove())`);

  // ---- New in 1.7: notes, data import, Word/EPUB export, restore (desktop)
  await js(`(() => { const a = Editor.text.indexOf('Judy brought'); Editor.ta.focus(); Editor.ta.setSelectionRange(a, a + 5); Notes.add(); })()`);
  await wait(150);
  await js(`document.querySelector('.modal textarea').value = 'Desktop note'; document.querySelector('.modal footer button.accent').click()`);
  await wait(150);
  check('Margin note added (desktop)', (await js('S.project.notes.length')) === 1);
  await js('DataImport.open()');
  await wait(400);
  await js(`document.querySelector('.modal footer button.accent').click()`);
  await wait(400);
  check('CSV imported into story memory (desktop)', (await js(`S.project.memory.some((m) => m.name.startsWith('cast'))`)) === true);
  for (const fmt of ['docx', 'epub']) {
    await js(`(() => { Export.open(); const s = document.querySelector('.modal select'); s.value = '${fmt}'; s.dispatchEvent(new Event('change')); document.querySelector('.modal footer button.accent').click(); })()`);
    for (let i = 0; i < 40 && !fs.existsSync(path.join(OUT, `desktop.${fmt}`)); i++) await wait(150);
    await wait(200);
  }
  const { execFileSync: ex2 } = require('child_process');
  const dz = JSON.parse(ex2('python3', ['-c', 'import docx,json,sys;d=docx.Document(sys.argv[1]);print(json.dumps([p.text for p in d.paragraphs if p.style.name=="Heading 1"]))', path.join(OUT, 'desktop.docx')]).toString());
  check('Word export works (desktop)', dz.includes('Chapter Two: The Observer'), dz.join(' | '));
  let ec2 = 'skipped';
  try { ex2('epubcheck', [path.join(OUT, 'desktop.epub')], { stdio: 'pipe' }); ec2 = 'ok'; } catch (e) { ec2 = e.code === 'ENOENT' ? 'skipped' : String(e.stdout || '') + String(e.stderr || ''); }
  check('EPUB export passes epubcheck (desktop)', ec2 === 'ok' || ec2 === 'skipped', String(ec2).slice(0, 300));
  await js('App.save()');
  await wait(400);
  check('Book saved before restore', (await js('S.dirty')) === false);
  js('Package.restore()');
  for (let i = 0; i < 30 && !(await js(`[...document.querySelectorAll('.modal header')].some((h) => h.textContent === 'Restore from a backup')`)); i++) await wait(100);
  await js(`[...document.querySelectorAll('.modal')].find((m) => m.querySelector('header')?.textContent === 'Restore from a backup').querySelector('footer button.accent').click()`);
  for (let i = 0; i < 60 && !fs.readdirSync(RESTORE_DIR).length; i++) await wait(100);
  await wait(800);
  const rdir = fs.readdirSync(RESTORE_DIR)[0] || '';
  check('Restore unpacks into a new folder (desktop)', /^Crucible \(restored /.test(rdir) && fs.existsSync(path.join(RESTORE_DIR, rdir, 'Books', 'Oakvale Test', 'Oakvale Test.md')), rdir);
  check('Restored book opened (desktop)', (await js('S.path')).startsWith(path.join(RESTORE_DIR, rdir)));

  // Light theme screenshot.
  await js(`document.documentElement.dataset.theme='light'`);
  await wait(200);
  await shot(win, '5-light-theme');
  await js(`document.documentElement.dataset.theme='dark'`);

  // Settings modal renders.
  await js('Settings.open()');
  await wait(300);
  await shot(win, '6-settings');
  await js(`document.querySelector('.modal-back').remove()`);

  // Export PDF.
  await js('Export.open()');
  await wait(200);
  await js(`[...document.querySelectorAll('.modal footer button')].find(b => b.textContent.startsWith('Export')).click()`);
  for (let i = 0; i < 40 && !fs.existsSync(pdfOut); i++) await wait(250);
  await wait(500);
  const pdfOk = fs.existsSync(pdfOut) && fs.statSync(pdfOut).size > 5000;
  check('PDF exported', pdfOk, pdfOk ? `${fs.statSync(pdfOut).size} bytes` : '');

  check('No renderer console errors', errors.length === 0, errors.join(' | '));

  // ---- Security: replay the independent review's attacks ----------------
  // (From here on the browser logs "blocked" messages on purpose.)
  const port = server.address().port;
  const SECRET = path.join(TMP, 'secret.txt');
  fs.writeFileSync(SECRET, 'TOP-SECRET-CONTENTS-12345');
  fs.writeFileSync(path.join(TMP, 'fake-picture.png'), 'TOP-SECRET-CONTENTS-12345 not really a png');
  const strangerMd = path.join(TMP, 'never-opened.md');
  fs.writeFileSync(strangerMd, 'private');
  const tryIt = (code) => js(`(${code}).then(() => 'allowed', (e) => 'blocked')`);
  check('Security: window cannot open a book you never chose', (await tryIt(`window.crucible.openBookPath(${JSON.stringify(strangerMd)})`)) === 'blocked');
  check('Security: window cannot write files you never chose', (await tryIt(`window.crucible.saveBook({ bookPath: ${JSON.stringify(path.join(TMP, 'evil.md'))}, text: 'x', project: {} })`)) === 'blocked' && !fs.existsSync(path.join(TMP, 'evil.md')));
  check('Security: window cannot read story memory of an unknown book', (await tryIt(`window.crucible.readMemoryText({ bookPath: ${JSON.stringify(strangerMd)}, file: 'x' })`)) === 'blocked');
  const curBook = await js('S.path');
  check('Security: "pictures" must really be pictures', (await js(`window.crucible.readBookImage({ bookPath: ${JSON.stringify(curBook)}, rel: '../../${path.basename(TMP)}/fake-picture.png' })`)) === null
    && (await js(`window.crucible.readBookImage({ bookPath: ${JSON.stringify(strangerMd)}, rel: 'secret.txt' })`)) === null);
  check('Security: never looks up paths on other computers', (await js(`window.crucible.fileExists(${JSON.stringify('\\\\127.0.0.1\\share\\x.mp3')})`)) === false && (await js(`window.crucible.fileExists('//127.0.0.1/share/x.mp3')`)) === false);
  // A booby-trapped manuscript: hidden script, a frame pulling a local file,
  // a picture and a stylesheet that phone home.
  const payload = `# Trap\n\n## Chapter One\n\n<template shadowrootmode="open"><img src="x" onerror="document.title='PWNED'"><iframe src="file://${SECRET}"></iframe><img src="http://127.0.0.1:${port}/beacon-img"><style>@import url(http://127.0.0.1:${port}/beacon-css);</style></template>\n\n<img src="//127.0.0.1/share/x.png"> <a href="java&#x09;script:alert(1)">click</a> <svg><animate attributeName="href" values="javascript:alert(1)"/></svg>\n\nText.\n\n## Chapter Two\n\nMore.\n`;
  const san = await js(`sanitizeHtml(marked.parse(${JSON.stringify(payload)}))`);
  check('Security: sanitizer strips the hidden payload', !/template|onerror|iframe|<style|javascript|svg|animate|\/\/127/i.test(san), san.slice(0, 300));
  const trapPdf = path.join(OUT, 'trap.pdf');
  const saveDlg = dialog.showSaveDialog;
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: trapPdf });
  const before = beacons.length;
  // Feed the raw (unsanitized) payload straight to the print window, as if
  // the sanitizer had been bypassed: the print window must still refuse it.
  await js(`window.crucible.exportPdf({ html: ${JSON.stringify(`<!doctype html><html><head><meta charset="utf-8"></head><body><p>VISIBLE-MARKER</p><div>${payload.replace(/\n/g, '<br>')}</div><iframe src="file://${SECRET}"></iframe><img src="http://127.0.0.1:${port}/beacon-raw"></body></html>`)}, options: { pageSize: 'letter' }, suggestedName: 'trap.pdf' })`);
  dialog.showSaveDialog = saveDlg;
  await wait(500);
  let trapText = '';
  try { trapText = require('child_process').execFileSync('pdftotext', [trapPdf, '-']).toString(); } catch { trapText = '(pdftotext unavailable)'; }
  check('Security: PDF export cannot read local files', fs.existsSync(trapPdf) && trapText.includes('VISIBLE-MARKER') && !trapText.includes('TOP-SECRET'), trapText.slice(0, 200));
  check('Security: PDF export cannot contact the internet', beacons.length === before, beacons.slice(before).join(', '));
  check('Security: no script ran', (await js('document.title')) !== 'PWNED');
  // Finding 4: no OS encryption here (no keyring), so the key must not be on disk.
  const onDisk = fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8');
  const pubS = await js('window.crucible.getSettings()');
  check('Security: without OS encryption, keys never touch the disk', !onDisk.includes('sk-test') && !/"raw:/.test(onDisk) && pubS.keyStorage === (require('electron').safeStorage.isEncryptionAvailable() ? pubS.keyStorage : 'session') && pubS.providers[0].hasKey, `keyStorage=${pubS.keyStorage}`);
  // Finding 1: an AI server that redirects gets nothing forwarded.
  await js(`window.crucible.getSettings().then((s) => window.crucible.saveSettings({ providers: [...s.providers, { id: 'redir', name: 'Redirecting AI', type: 'anthropic', baseUrl: 'http://127.0.0.1:${port}/redirect', model: 'm', newApiKey: 'sk-redirect-test' }] }))`);
  const nb = beacons.length;
  const red = await js(`window.crucible.aiChat({ providerId: 'redir', system: 's', messages: [{ role: 'user', content: 'MANUSCRIPT TEXT' }] })`);
  check('Security: AI requests never follow redirects (key and text stay put)', !red.ok && /redirect/i.test(red.error) && !beacons.slice(nb).some((u) => u.startsWith('/stolen')), red.error);
  // Findings 2 + 3: an imported file can't move the AI you're using, or keep
  // a key across a path change that only differs in letter case.
  const impE = await js(`window.crucible.getSettings().then((s) => window.crucible.importSettings({ crucibleSettings: true, providers: [{ id: s.activeProviderId, name: 'Fake local AI', type: 'openai', baseUrl: 'https://attacker.example/v1' }] }))`);
  const activeNow = impE.settings.providers.find((p) => p.id === impE.settings.activeProviderId);
  check('Security: an imported file can\'t change where your active AI sends text', activeNow.baseUrl.startsWith('http://127.0.0.1') && impE.endpointChanges.length === 1 && !!impE.confirmToken, activeNow.baseUrl);
  const conf = await js(`window.crucible.confirmImportedEndpoints(${JSON.stringify(impE.confirmToken)})`);
  check('Security: …and only changes it after you confirm', conf.settings.providers.find((p) => p.id === impE.settings.activeProviderId).baseUrl === 'https://attacker.example/v1');
  await js(`window.crucible.getSettings().then((s) => window.crucible.saveSettings({ providers: [{ id: 'case', name: 'Tenant', type: 'openai', baseUrl: 'https://ai.example.com/TenantA/v1', newApiKey: 'sk-tenant' }] }))`);
  const caseR = await js(`window.crucible.saveSettings({ providers: [{ id: 'case', name: 'Tenant', type: 'openai', baseUrl: 'https://ai.example.com/tenanta/v1' }] })`);
  check('Security: a path that differs only in letter case counts as a new address', !caseR.providers[0].hasKey);
  // A settings change that points an AI at a new address drops its key.
  await js(`window.crucible.saveSettings({ providers: [{ id: 'fake1', name: 'Fake local AI', type: 'openai', baseUrl: 'http://127.0.0.1:${port}/v1', model: 'test-model', newApiKey: 'sk-test' }], activeProviderId: 'fake1' })`);
  const sres = await js(`window.crucible.getSettings().then((s) => window.crucible.saveSettings({ providers: s.providers.map((p) => ({ ...p, baseUrl: 'https://attacker.example/v1' })) }))`);
  check('Security: changing an AI\'s address drops its saved key', sres.providers.every((p) => !p.hasKey), JSON.stringify(sres.providers.map((p) => p.hasKey)));

}

app.whenReady().then(() => {
  server.listen(0, '127.0.0.1', () => {
    writeSettings(server.address().port);
    let started = false;
    app.on('browser-window-created', (_e, win) => {
      if (started) return; // later windows (e.g. the hidden PDF renderer) are not the app window
      started = true;
      win.webContents.once('did-finish-load', async () => {
        try { await run(win); } catch (e) { check('Smoke test crashed', false, e.stack); }
        const failed = results.filter((r) => !r.ok).length;
        console.log(`\n${results.length - failed}/${results.length} checks passed. Output: ${OUT}`);
        server.close();
        BrowserWindow.getAllWindows().forEach((w) => w.destroy());
        app.exit(failed ? 1 : 0);
      });
    });
    require('../main.js');
  });
});
