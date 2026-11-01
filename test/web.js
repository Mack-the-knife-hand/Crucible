// =============================================================================
// Browser-edition end-to-end test.        npm run build:web && npm run test:web
// -----------------------------------------------------------------------------
// Runs dist-web/crucible.html in real Chromium windows (via Electron; see
// web-host.js). Folder pickers are simulated with the browser's private file
// system (OPFS), which hands out the same kind of folder/file handles that
// Edge/Chrome give you when you pick a folder.
//
// Scenario — a thumb drive used on two computers:
//   "Drive/"                     ← your Crucible folder (home)
//     crucible-settings.json     ← created by Crucible
//     Books/Oakvale/Oakvale Test.md
//     Music/Night Drive.mp3
//     picks/…                    ← files picked for memory / links
//   Computer 1: set everything up.  Computer 2: fresh browser profile, same
//   drive contents — everything must come back.
// Env: CRUCIBLE_FIXTURES (test.png, test.mp3), CRUCIBLE_TEST_OUT (screenshots)
// =============================================================================
const { chromium, _electron } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', 'dist-web');
const V1 = path.join(__dirname, 'fixtures-crucible-v1.0.html');
const FIX = process.env.CRUCIBLE_FIXTURES;
const OUT = process.env.CRUCIBLE_TEST_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-web-'));
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log(`\n── ${t}`);

const BOOK = `# Oakvale

## Chapter One: Dust

The dust rolled over Oakvale like it had a grudge. Wade Miller watched the road from the porch of the sheriff's office, hat tipped low.

Judy brought him coffee and didn't say a word. She didn't need to.

***

Down at the plant, the machines never stopped.

## Chapter Two: The Observer

Cross arrived on a Tuesday, which nobody in Oakvale would remember later.
`;
const EPIGRAPH = '> *The past is never dead. It\'s not even past.*\n>\n> — William Faulkner';

// ---------------------------------------------------------------- servers --
const files = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let p = null;
  if (u === '/' || u === '/crucible.html') p = path.join(ROOT, 'crucible.html');
  else if (u === '/old/crucible.html') p = V1;
  else if (u.startsWith('/fix/') && FIX) p = path.join(FIX, u.slice(5));
  if (!p || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

let lastReq = null;
let proseCalls = 0;
let failedOnce = false;
const ai = http.createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    lastReq = { auth: req.headers.authorization, body: JSON.parse(body) };
    const last = lastReq.body.messages.at(-1);
    const text = typeof last.content === 'string' ? last.content : last.content.find((c) => c.type === 'text').text;
    let reply;
    const sys = lastReq.body.messages[0]?.content || '';
    if (sys.includes('continuity editor')) {
      // Fake continuity editor: remembers eye colour and arrival day.
      const section = (text.match(/<section[^>]*>\n([\s\S]*?)\n<\/section>/) || [])[1] || '';
      const facts = (text.match(/<facts_so_far>\n([\s\S]*?)\n<\/facts_so_far>/) || [])[1] || '';
      const out = [];
      if (section.includes('blue eyes') && facts.includes('grey eyes')) {
        const sent = section.split(/(?<=[.!?])\s+/).find((x) => x.includes('blue eyes'));
        out.push(`<issue>\n<find>${sent}</find>\n<problem>Earlier: Mara has grey eyes.</problem>\n<fix>${sent.replace('blue eyes', 'grey eyes')}</fix>\n</issue>`);
      }
      if (section.includes('arrived on Tuesday') && facts.includes('arrived on Monday')) {
        const sent = section.split(/(?<=[.!?])\s+/).find((x) => x.includes('arrived on Tuesday'));
        out.push(`<issue>\n<find>${sent}</find>\n<problem>Earlier she arrived on Monday.</problem>\n</issue>`);
      }
      const nf = [];
      if (section.includes('grey eyes')) nf.push('- Mara has grey eyes');
      if (section.includes('arrived on Monday')) nf.push('- Mara arrived on Monday');
      reply = `${out.join('\n')}\n<facts>\n${nf.join('\n') || '- nothing new'}\n</facts>`;
    } else if (sys.includes('You are a beta reader')) {
      reply = '1. Overall impression: Gripping opening.\n2. Where I was hooked: "watched the road"\n6. Would I keep reading? Yes.';
    } else if (sys.includes('ONE section of the book')) {
      // Fake proofreader: fixes known typos sentence by sentence.
      proseCalls++;
      const section = (text.match(/<section[^>]*>\n([\s\S]*?)\n<\/section>/) || [])[1] || '';
      if (section.includes('FAILONCE') && !failedOnce) {
        failedOnce = true;
        res.writeHead(500, { 'content-type': 'application/json', ...cors });
        return res.end(JSON.stringify({ error: { message: 'Simulated overload, please retry' } }));
      }
      const fixes = { teh: 'the', recieve: 'receive', 'could of': 'could have', alot: 'a lot' };
      const blocks = [];
      for (const sentence of section.split(/(?<=[.!?])\s+/)) {
        let fixed = sentence;
        for (const [bad, good] of Object.entries(fixes)) fixed = fixed.split(bad).join(good);
        if (fixed !== sentence) blocks.push(`<change>\n<find>${sentence}</find>\n<replace>${fixed}</replace>\n<why>spelling</why>\n</change>`);
      }
      if (section.includes('Typo paragraph 1.') ) blocks.push('<change><find>This sentence is not in the book.</find><replace>Nor this.</replace><why>test</why></change>');
      reply = blocks.length ? blocks.join('\n') : '<none/>';
    } else if (/epigraph/i.test(text)) {
      reply = `Here's the epigraph, plus the small fix you mentioned:\n\n<insert position="before" anchor="## Chapter One: Dust">\n${EPIGRAPH}\n</insert>\n\n<change>\n<find>Down at the plant, the machines never stopped.</find>\n<replace>Down at the plant, the presses never stopped.</replace>\n</change>`;
    } else {
      const id = (text.match(/<passage id="([\w-]+)"/) || [])[1] || 'new';
      reply = `Leaner:\n\n<revision id="${id}">Wade Miller watched the road from the sheriff's porch and said nothing at all.</revision>`;
    }
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
  });
});

// ------------------------------------------------------------ picker mocks --
const MOCKS = () => {
  const sub = async (...names) => {
    let d = await navigator.storage.getDirectory();
    for (const n of names) d = await d.getDirectoryHandle(n, { create: true });
    return d;
  };
  window.showDirectoryPicker = async ({ id } = {}) => {
    if (id === 'crucible-home') return sub('Drive');
    if (id === 'crucible-music') return sub('Drive', 'Music');
    if (id === 'crucible-restore') return sub('NewDrive');
    return sub('Drive', 'Books', 'Oakvale');
  };
  window.showOpenFilePicker = async ({ types } = {}) => {
    const acc = JSON.stringify(types || []);
    if (acc.includes('application/zip')) return [await (await sub('Incoming')).getFileHandle('backup.zip')];
    const d = await sub('Drive', 'picks');
    const names = acc.includes('audio') ? ['test.mp3'] : acc.includes('image/*') ? ['test.png'] : ['Character bible.md', 'test.png'];
    const out = [];
    for (const n of names) { try { out.push(await d.getFileHandle(n)); } catch { /* missing fixture */ } }
    return out;
  };
};

// Copy the whole simulated drive out of one profile and into another.
const DUMP = async () => {
  const toB64 = async (blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const out = [];
  const walk = async (d, rel) => {
    for await (const [n, h] of d.entries()) {
      if (h.kind === 'directory') await walk(h, [...rel, n]);
      else out.push({ path: [...rel, n], data: await toB64(await h.getFile()) });
    }
  };
  await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('Drive'), ['Drive']);
  return out;
};
const LOAD = async (filesIn) => {
  for (const f of filesIn) {
    let d = await navigator.storage.getDirectory();
    const parts = [...f.path];
    const name = parts.pop();
    for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
    const bin = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    const w = await (await d.getFileHandle(name, { create: true })).createWritable();
    await w.write(bin);
    await w.close();
  }
};
const READ = async (parts) => {
  let d = await navigator.storage.getDirectory();
  const ps = [...parts];
  const name = ps.pop();
  for (const p of ps) d = await d.getDirectoryHandle(p);
  return (await (await d.getFileHandle(name)).getFile()).text();
};

async function seed(page) {
  await page.evaluate(async ({ book, fix }) => {
    const root = await navigator.storage.getDirectory();
    const put = async (dirs, name, data) => {
      let d = root;
      for (const n of dirs) d = await d.getDirectoryHandle(n, { create: true });
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(data); await w.close();
    };
    await put(['Drive', 'Books', 'Oakvale'], 'Oakvale Test.md', book);
    await put(['Drive', 'picks'], 'Character bible.md', '# Wade Miller\nSheriff of Oakvale. Widower. Never raises his voice.\n');
    if (fix) {
      for (const n of ['test.png', 'test.mp3']) {
        const b = await (await fetch('/fix/' + n)).blob();
        await put(['Drive', 'picks'], n, b);
        if (n.endsWith('mp3')) await put(['Drive', 'Music'], 'Night Drive.mp3', b);
      }
    }
  }, { book: BOOK, fix: !!FIX });
}

(async () => {
  await new Promise((r) => files.listen(0, '127.0.0.1', r));
  await new Promise((r) => ai.listen(0, '127.0.0.1', r));
  const APP = `http://127.0.0.1:${files.address().port}/`;
  const AI_URL = `http://127.0.0.1:${ai.address().port}/v1`;

  // Each launch = a fresh browser profile (empty storage), like a new computer.
  // (Playwright's bundled headless Chromium crashes reading folder handles back
  // from IndexedDB; real Chrome/Edge and Electron's Chromium don't.)
  const electronBin = require('electron');
  const launches = [];
  const launch = async (url, init) => {
    const app = await _electron.launch({
      executablePath: electronBin, args: ['--no-sandbox', path.join(__dirname, 'web-host.js')],
      env: { ...process.env, WEB_URL: url, CRUCIBLE_TEST_OUT: OUT },
    });
    launches.push(app);
    if (init) await app.context().addInitScript(init);
    const pg = await app.firstWindow();
    if (init) await pg.reload();
    await pg.waitForLoadState('load');
    return { app, page: pg };
  };
  const pdfBrowser = await chromium.launch();

  // ======================================================= COMPUTER 1 ====
  section('Computer 1: first run from the thumb drive');
  const { page } = await launch(APP, MOCKS);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const js = (fn, arg) => page.evaluate(fn, arg);

  await seed(page);
  await js(async (url) => {
    await window.crucible.saveSettings({ providers: [{ id: 'fake1', name: 'Fake AI', type: 'openai', baseUrl: url, model: 'test-model', newApiKey: 'sk-web', maxTokens: 500 }], activeProviderId: 'fake1', ui: { theme: 'dark', fontSize: 17, view: 'split' } });
  }, AI_URL);
  await page.reload();
  await wait(400);
  check('Welcome asks for the Crucible folder', (await page.textContent('.modal')).includes('Crucible folder'));
  await page.screenshot({ path: path.join(OUT, 'w1-welcome.png') });
  await page.click('.modal footer button.accent'); // Choose Crucible folder…
  await wait(600);
  check('Settings file created in the Crucible folder', (await js(READ, ['Drive', 'crucible-settings.json'])).includes('"crucibleSettings": true'));
  check('Book chooser finds the book inside the folder', (await page.textContent('.modal')).includes('Books/Oakvale'));
  await page.screenshot({ path: path.join(OUT, 'w1b-books.png') });
  await page.click('.modal .pick-list .mi');
  await wait(500);
  check('Book opened', (await js(() => Editor.text)).includes('dust rolled'));

  section('Change pool + rewrite');
  const target = "Wade Miller watched the road from the porch of the sheriff's office, hat tipped low.";
  await js((t) => { const a = Editor.text.indexOf(t); Editor.ta.focus(); Editor.ta.setSelectionRange(a, a + t.length); }, target);
  await page.keyboard.press('Alt+a');
  await wait(150);
  check('Alt+A adds selection to pool', (await js(() => S.project.pool.length)) === 1);
  const box = await page.locator('#editor').boundingBox();
  await page.mouse.click(box.x + 200, box.y + 150, { button: 'right' });
  await wait(150);
  check('Right-click shows Crucible menu', (await page.textContent('#ctxMenu')).includes('Add to change pool'));
  await page.keyboard.press('Escape');
  await page.mouse.click(box.x + 200, box.y + 20);
  await js(() => Pool.negotiate([S.project.pool[0].id]));
  await page.fill('#chatInput', 'Make Wade more guarded.');
  await page.keyboard.press('Control+Enter');
  for (let i = 0; i < 40 && (await js(() => AI.busy)); i++) await wait(150);
  await page.click('.revision button:has-text("Apply")');
  await wait(200);
  check('Rewrite applied', (await js(() => Editor.text)).includes('said nothing at all'));

  section('AI adds and changes text');
  await js(() => { S.project.meta.negotiate = []; AI.renderContext(); });
  await page.fill('#chatInput', 'Add this epigraph before the first chapter: "The past is never dead. It\'s not even past." — William Faulkner. Also say presses instead of machines at the plant.');
  await page.keyboard.press('Control+Enter');
  for (let i = 0; i < 40 && (await js(() => AI.busy)); i++) await wait(150);
  await wait(200);
  check('AI got exact heading lines to anchor on', (lastReq?.body.messages[0].content || '').includes('## Chapter One: Dust'));
  const heads = await page.locator('.revision .rv-where').allTextContents();
  check('Insert card says where it goes', heads.some((h) => h.includes('Add before “## Chapter One: Dust”')), heads.join(' | '));
  check('Change card shown', heads.some((h) => h.startsWith('Change “Down at the plant')));
  await page.screenshot({ path: path.join(OUT, 'w2-insert-cards.png') });
  const applyBtns = page.locator('.revision:not(.applied) button:has-text("Apply")');
  await applyBtns.first().click();
  await wait(200);
  await page.locator('.revision:not(.applied) button:has-text("Apply")').first().click();
  await wait(200);
  const txt = await js(() => Editor.text);
  check('Epigraph inserted before Chapter One', txt.includes(`# Oakvale\n\n${EPIGRAPH}\n\n## Chapter One: Dust`), JSON.stringify(txt.slice(0, 160)));
  check('Change applied elsewhere in the book', txt.includes('the presses never stopped') && !txt.includes('machines never'));
  check('AI edits logged in the change pool', (await js(() => S.project.pool.filter((p) => p.ai).length)) === 2);
  await page.keyboard.press('Control+z');
  await wait(100);
  check('Ctrl+Z undoes the AI change', (await js(() => Editor.text)).includes('machines never stopped'));
  await page.keyboard.press('Control+y');
  await wait(100);
  await js(() => Editor.setView('split'));
  await wait(300);
  check('Preview shows epigraph attribution right-aligned', await js(() => !!document.querySelector('#preview blockquote p.attr')));
  await page.screenshot({ path: path.join(OUT, 'w3-epigraph.png') });

  section('Collapsible panels');
  await page.click('#left .collapse-btn');
  await wait(150);
  const leftW = await page.evaluate(() => $('#left').getBoundingClientRect().width);
  check('Left panel collapses to a rail', leftW < 50, `${leftW}px`);
  check('Rail shows pool count', (await page.textContent('#left .rail')).includes('Pool'));
  await page.keyboard.press('Control+]');
  await wait(150);
  check('Ctrl+] collapses right panel', await js(() => $('#right').classList.contains('collapsed')));
  check('Focus button lights when both hidden', await js(() => $('#btnFocus').classList.contains('on')));
  await page.screenshot({ path: path.join(OUT, 'w4-focus.png') });
  await page.click('#left .rail-tab[data-tab="pool"]');
  await wait(150);
  check('Rail tab reopens panel on that tab', await js(() => !$('#left').classList.contains('collapsed') && $('#left section[data-tab="pool"]').classList.contains('on')));
  await page.click('#btnFocus');
  await page.click('#btnFocus');
  await wait(100);
  await page.click('#right .collapse-btn');
  await wait(100);
  await js(() => { /* leave: left open, right collapsed */ });

  section('Memory, music, links');
  await js(() => App.showTab('right', 'memory'));
  await page.click('#btnAddMemory');
  await wait(600);
  const memCount = await js(() => S.project.memory.length);
  check('Memory files copied into book folder', memCount >= 1, `${memCount}`);
  await js(() => App.setCollapsed('right', true));
  if (FIX) {
    await page.click('#plListBtn');
    await page.click('#plAddFolder');
    await wait(400);
    const pl = await js(() => S.settings.playlist);
    check('Music in the Crucible folder stored as a portable path', pl.length === 1 && pl[0].path === 'home:Music/Night%20Drive.mp3', pl[0]?.path);
    await page.click('.pl-item .nm');
    await wait(800);
    check('Song plays', await js(() => !$('#audio').paused || $('#audio').currentTime > 0));
    await page.click('#plListBtn');
    await js(() => $('#audio').pause());
    await js(() => { const a = Editor.text.indexOf('Judy brought'); Editor.ta.focus(); Editor.ta.setSelectionRange(a + 3, a + 3); });
    await js(() => Links.startLink('song'));
    await page.click('.pick-list .mi');
    await wait(200);
    await js(() => Links.startLink('image'));
    await page.click('.modal footer button.accent');
    await wait(300);
    const links = await js(() => S.project.links.map((l) => l.path));
    check('Linked picture from the drive stored as a portable path', links.includes('home:picks/test.png'), links.join(', '));
  }
  await page.keyboard.press('Control+s');
  await wait(600);

  const settingsFile = JSON.parse(await js(READ, ['Drive', 'crucible-settings.json']));
  check('Settings file holds the AI provider + key', settingsFile.providers[0]?.name === 'Fake AI' && settingsFile.providers[0]?.apiKey === 'sk-web');
  check('Settings file holds the layout', settingsFile.ui.rightCollapsed === true && settingsFile.ui.leftCollapsed === false);
  if (FIX) check('Settings file holds the playlist', settingsFile.playlist[0]?.path === 'home:Music/Night%20Drive.mp3');
  check('Settings file remembers the book', (settingsFile.recentHome || [])[0] === 'Books/Oakvale/Oakvale Test.md');
  const md = await js(READ, ['Drive', 'Books', 'Oakvale', 'Oakvale Test.md']);
  check('Manuscript saved to the drive', md.includes('William Faulkner') && md.includes('said nothing at all'));

  section('Export');
  await js(() => {
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get() { const w = desc.get.call(this); if (w) w.print = () => { window.__printed = { html: this.srcdoc, title: document.title }; }; return w; },
    });
  });
  await page.click('#btnExport');
  await wait(200);
  await page.click('.modal footer button.accent');
  for (let i = 0; i < 300 && !(await js(() => !!window.__printed)); i++) await wait(100);
  const printed = await js(() => window.__printed);
  if (!printed) console.log('  (no print) errors:', errors.join(' | '));
  check('Print window gets the book', !!printed && printed.html.includes('Faulkner'));
  const pp = await pdfBrowser.newPage();
  await pp.setContent(printed.html);
  await pp.pdf({ path: path.join(OUT, 'web-export.pdf'), preferCSSPageSize: true });
  await pp.close();
  try {
    const { execSync } = require('child_process');
    const pdfPath = path.join(OUT, 'web-export.pdf');
    const nPages = +(/Pages:\s+(\d+)/.exec(execSync(`pdfinfo "${pdfPath}"`).toString())[1]);
    const pageTexts = Array.from({ length: nPages }, (_, i) => { try { return execSync(`pdftotext -f ${i + 1} -l ${i + 1} "${pdfPath}" -`).toString(); } catch { return ''; } });
    const epi = pageTexts.findIndex((t) => t.includes('Faulkner'));
    const toc = pageTexts.findIndex((t) => /^\s*Contents\s*$/m.test(t));
    const ch1 = pageTexts.findIndex((t, i) => i !== toc && t.includes('Chapter One'));
    check('PDF: epigraph on its own page, then Contents, then Chapter One', epi > 0 && toc === epi + 1 && ch1 === toc + 1 && !pageTexts[epi].includes('dust rolled'), `epigraph p${epi + 1}, contents p${toc + 1}, chapter p${ch1 + 1}`);
    // Every page number in the contents must be the page that chapter is really on.
    const entries = [...printed.html.matchAll(/<span class="toc-t">([^<]*)<\/span><span class="toc-dots"><\/span><span class="toc-pg">(\d*)<\/span>/g)].map((m) => ({ t: m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'), pg: +m[2] }));
    const bad = entries.filter((e) => !(pageTexts[e.pg - 1] || '').replace(/\s+/g, ' ').includes(e.t.split(':')[0]));
    check('PDF: contents page numbers match the real pages', entries.length >= 2 && !bad.length, `${entries.map((e) => `${e.t}→${e.pg}`).join(', ')}${bad.length ? ` WRONG: ${bad.map((e) => e.t).join(', ')}` : ''}`);
    check('PDF: contents entries are clickable links', /<a href="#toc-1">/.test(printed.html) && /id="toc-1"/.test(printed.html));
  } catch { /* poppler missing */ }
  const ico = await js(() => ({ fav: document.querySelector('link[rel="icon"]')?.href.startsWith('data:image/png'), brand: document.querySelector('.brand-icon')?.naturalWidth || 0 }));
  await js(() => Settings.about());
  await wait(300);
  const about = await js(() => document.querySelector('.modal-back:last-child .modal')?.textContent || '');
  await page.screenshot({ path: path.join(OUT, 'w25-about.png') });
  await js(() => document.querySelector('.modal-back:last-child')?.remove());
  check('About window: made by Mack, with his note', about.includes('made by Mack') && about.includes('because I love you') && about.includes('no paywalls') && about.includes('— Mack'), about.slice(0, 160));
  check('App icon in the browser tab and the top bar', ico.fav && ico.brand > 0, JSON.stringify(ico));
  check('No page errors (computer 1)', errors.length === 0, errors.join(' | '));
  const drive = await js(DUMP);

  // ======================================================= COMPUTER 2 ====
  section('Computer 2: fresh browser, same thumb drive');
  const { page: p2 } = await launch(APP, MOCKS);
  const errors2 = [];
  p2.on('pageerror', (e) => errors2.push(e.message));
  await p2.evaluate(LOAD, drive);
  await p2.reload();
  await wait(400);
  check('Fresh browser starts with no settings', (await p2.evaluate(() => S.settings.providers.length)) === 0);
  await p2.click('.modal footer button.accent'); // Choose Crucible folder…
  await wait(600);
  // A folder this browser hasn't used before: its AI addresses need your OK.
  const ask2 = await p2.evaluate(() => ({ title: document.querySelector('.modal-back:last-child .modal header')?.textContent || '', body: document.querySelector('.modal-back:last-child .modal')?.textContent || '', providers: S.settings.providers.length }));
  check('New folder: asks before using its AI addresses', ask2.title === 'Check these AI addresses' && ask2.body.includes('Fake AI') && ask2.body.includes('127.0.0.1') && ask2.providers === 0, JSON.stringify(ask2).slice(0, 200));
  await p2.click('.modal-back:last-child footer button.accent'); // Use these addresses
  await wait(400);
  await p2.screenshot({ path: path.join(OUT, 'w24-books-after-confirm.png') });
  const s2 = await p2.evaluate(() => S.settings);
  check('AI provider restored from the drive', s2.providers[0]?.name === 'Fake AI' && s2.providers[0]?.hasKey);
  check('Layout restored (right panel hidden)', await p2.evaluate(() => $('#right').classList.contains('collapsed')));
  check('View restored', await p2.evaluate(() => $('#editorWrap').dataset.view === 'split'));
  if (FIX) check('Playlist restored', s2.playlist[0]?.name === 'Night Drive');
  check('Book listed from the drive', (await p2.textContent('.modal')).includes('Oakvale Test.md'));
  await p2.click('.modal .pick-list .mi');
  await wait(500);
  check('Book, pool and AI chat come along', await p2.evaluate(() => Editor.text.includes('Faulkner') && S.project.pool.length === 3 && S.project.chat.length === 4));
  check('Memory limit default carried in settings file', (await p2.evaluate(() => S.settings.memoryLimit)) === 120000);
  if (FIX) {
    await p2.evaluate(() => Links.open(S.project.links.find((l) => l.kind === 'song')));
    await wait(800);
    check('Linked song plays on the second computer', await p2.evaluate(() => !$('#audio').paused || $('#audio').currentTime > 0));
    await p2.evaluate(() => $('#audio').pause());
  }
  lastReq = null;
  await p2.evaluate(() => { App.setCollapsed('right', false); $('#chatInput').value = 'Tighten the first line.'; return AI.send(); });
  check('Stored API key works on the second computer', lastReq?.auth === 'Bearer sk-web');
  await p2.screenshot({ path: path.join(OUT, 'w5-computer2.png') });
  check('No page errors (computer 2)', errors2.length === 0, errors2.join(' | '));

  // ============================================ STORY MEMORY LIMIT ====
  section('Story memory limit');
  check('Default limit is 120,000', (await p2.evaluate(() => S.settings.memoryLimit)) === 120000);
  await p2.evaluate(async () => {
    const big = 'BIGNOTE-START ' + 'Oakvale lore sentence for the memory test. '.repeat(1400) + ' BIGNOTE-END';
    const item = await window.crucible.newMemoryNote({ bookPath: S.path, name: 'Huge lore file' });
    await window.crucible.writeMemoryText({ bookPath: S.path, file: item.file, text: big });
    S.project.memory.push(item);
    await persistSettings({ memoryLimit: 20000 });
    App.setCollapsed('right', false);
    App.showTab('right', 'memory');
    await Memory.render();
  });
  await wait(400);
  check('Meter shows over the limit', await p2.evaluate(() => $('#memMeter').classList.contains('over') && $('#memMeter').textContent.includes('/ 20,000 characters')));
  await p2.screenshot({ path: path.join(OUT, 'w7-memory-meter.png') });
  await p2.evaluate(() => { App.showTab('right', 'ai'); $('#chatInput').value = 'Who is Wade?'; return AI.send(); });
  await wait(300);
  check('Warning names the file that was cut', (await p2.textContent('#toast')).includes('Huge lore file'));
  check('AI received at most the limit', !(lastReq.body.messages[0].content.includes('BIGNOTE-END')));
  // Raise it to the 2M maximum through the Settings screen.
  await p2.click('#btnSettings');
  await wait(300);
  await p2.click('.modal button:has-text("2M (max)")');
  await p2.screenshot({ path: path.join(OUT, 'w8-settings-limit.png') });
  await p2.click('.modal footer button.accent'); // Save
  await wait(400);
  check('Limit saved as 2,000,000', (await p2.evaluate(() => S.settings.memoryLimit)) === 2000000);
  check('Limit written to the drive settings file', JSON.parse(await p2.evaluate(READ, ['Drive', 'crucible-settings.json'])).memoryLimit === 2000000);
  await p2.evaluate(() => { $('#chatInput').value = 'And now?'; return AI.send(); });
  check('AI now receives the whole file', lastReq.body.messages[0].content.includes('BIGNOTE-END'));
  check('Meter back under the limit', await p2.evaluate(() => !$('#memMeter').classList.contains('over')));
  // Typing above the maximum is capped.
  await p2.evaluate(() => persistSettings({ memoryLimit: 9e9 }));
  check('Values above 2M are capped', (await p2.evaluate(() => S.settings.memoryLimit)) === 2000000);

  // ===================================================== AUTOSAVE ====
  section('Autosave checkbox');
  check('Autosave is off until ticked', await p2.evaluate(() => !$('#autosaveToggle').checked && !App._autosaveTimer));
  await p2.evaluate(() => { App.AUTOSAVE_MS = 400; }); // 5 minutes, shortened for the test
  await p2.click('#autosaveToggle');
  await wait(200);
  check('Ticking it starts the timer and remembers the choice', await p2.evaluate(() => !!App._autosaveTimer && S.settings.ui.autosave === true));
  check('Choice saved to the drive settings file', JSON.parse(await p2.evaluate(READ, ['Drive', 'crucible-settings.json'])).ui.autosave === true);
  await p2.evaluate(() => Editor.replaceRange(0, 0, 'AUTOSAVED LINE\n\n'));
  await wait(900);
  check('Changes are saved automatically', (await p2.evaluate(READ, ['Drive', 'Books', 'Oakvale', 'Oakvale Test.md'])).startsWith('AUTOSAVED LINE'));
  check('Status bar says autosaved', (await p2.textContent('#stDirty')).startsWith('autosaved'));
  await p2.screenshot({ path: path.join(OUT, 'w9-autosave.png'), clip: { x: 0, y: 0, width: 1366, height: 60 } });
  await p2.click('#autosaveToggle');
  await p2.evaluate(() => Editor.replaceRange(0, 0, 'NOT AUTOSAVED\n\n'));
  await wait(900);
  check('Unticking stops autosave', !(await p2.evaluate(READ, ['Drive', 'Books', 'Oakvale', 'Oakvale Test.md'])).startsWith('NOT AUTOSAVED') && (await p2.evaluate(() => S.settings.ui.autosave === false)));
  await p2.evaluate(() => { App.AUTOSAVE_MS = 5 * 60 * 1000; });

  // ===================================================== PROSE PASS ====
  section('Prose pass: correcting a large stretch');
  await p2.evaluate(() => {
    const paras = [];
    for (let i = 1; i <= 24; i++) {
      const typo = i % 3 === 0 ? 'He could of sworn teh wind changed.' : i % 4 === 0 ? 'She did not recieve the letter.' : 'The night was quiet over the plant.';
      paras.push(`Typo paragraph ${i}. ${typo} The road ran long and pale toward the river, and nobody in town remembered when it was paved.${i === 13 ? ' FAILONCE marker.' : ''}`);
    }
    Editor.replaceRange(Editor.text.length, Editor.text.length, '\n\n## Chapter Three: Typos\n\n' + paras.join('\n\n') + '\n');
    Prose.CHUNK_CHARS = 1200; // smaller sections so the test covers several requests
  });
  const typosBefore = await p2.evaluate(() => (Editor.text.match(/could of|teh |recieve/g) || []).length);
  // Outline right-click → Select this chapter
  await p2.click('#left .rail-expand').catch(() => {});
  await p2.evaluate(() => App.setCollapsed('left', false));
  await p2.click('.ol-item:has-text("Chapter Three: Typos")', { button: 'right' });
  await p2.click('#ctxMenu .mi:has-text("Select this chapter")');
  await wait(150);
  const sel = await p2.evaluate(() => { const s = Editor.selection(); return { len: s.end - s.start, starts: s.text.startsWith('## Chapter Three'), ends: s.text.trim().endsWith('was paved.') }; });
  check('Outline right-click selects the whole chapter', sel.starts && sel.ends && sel.len > 3000, `${sel.len} chars`);
  // Editor right-click → Correct prose in selection
  await p2.evaluate(() => Editor.renderContextMenu({ x: 400, y: 300 }));
  check('Right-click offers "Correct prose in selection"', (await p2.textContent('#ctxMenu')).includes('Correct prose in selection'));
  await p2.click('#ctxMenu .mi:has-text("Correct prose in selection")');
  await wait(200);
  check('Prose pass tab opens with the selection as scope', await p2.evaluate(() => $('#right section[data-tab="prose"]').classList.contains('on') && $('#proseScope').value === 'selection' && /words · about \d+ AI requests/.test($('#proseScopeInfo').textContent)));
  await p2.screenshot({ path: path.join(OUT, 'w10-prose-setup.png') });
  proseCalls = 0;
  await p2.click('#proseStart');
  for (let i = 0; i < 100 && (await p2.evaluate(() => Prose.running)); i++) await wait(100);
  check('A failed request pauses the pass with Resume', (await p2.textContent('#proseStatus')).includes('Simulated overload') && (await p2.isVisible('#proseStatus button:has-text("Resume")')));
  const firstRun = proseCalls;
  await p2.click('#proseStatus button:has-text("Resume")');
  for (let i = 0; i < 100 && (await p2.evaluate(() => Prose.running)); i++) await wait(100);
  const ps = await p2.evaluate(() => ({ chunks: S.project.prose.chunks.length, items: S.project.prose.items.map((i) => i.status), finished: !!S.project.prose.finishedAt }));
  check('Resume finishes the remaining sections', ps.finished && ps.chunks === 0 && proseCalls > firstRun, `${proseCalls} requests`);
  const typoSentences = await p2.evaluate(() => (Editor.text.match(/could of|recieve/g) || []).length);
  check('One suggestion per sentence with a typo (repeated sentences included)', ps.items.filter((s) => s === 'pending').length === typoSentences, `${ps.items.filter((s) => s === 'pending').length}/${typoSentences}`);
  check('A correction the AI misquoted is flagged, not applied', ps.items.filter((s) => s === 'unmatched').length === 1);
  check('Nothing changed in the book yet', (await p2.evaluate(() => (Editor.text.match(/could of|teh |recieve/g) || []).length)) === typosBefore);
  await p2.screenshot({ path: path.join(OUT, 'w11-prose-review.png') });
  // Keep writing above the chapter during review: suggestions must stay glued.
  await p2.evaluate(() => Editor.replaceRange(0, 0, 'A new line typed during review.\n\n'));
  check('Suggestions follow edits made during review', await p2.evaluate(() => Prose.items().filter((i) => i.anchored).every((i) => Editor.text.slice(i.start, i.end) === i.text)));
  // Accept one, skip one, accept all the rest
  await p2.click('.prose-item.st-pending button:has-text("Accept")');
  await wait(100);
  check('Accept fixes that sentence', await p2.evaluate(() => Prose.items().filter((i) => i.status === 'accepted').length === 1));
  await p2.click('.prose-item.st-pending button:has-text("Skip")');
  await p2.click('#proseAcceptAll');
  await p2.click('.modal footer button.accent');
  await wait(300);
  const after = await p2.evaluate(() => ({ left: (Editor.text.match(/could of|recieve/g) || []).length, pending: Prose.items().filter((i) => i.status === 'pending').length, accepted: Prose.items().filter((i) => i.status === 'accepted').length }));
  check('Accept all applies everything except the skipped one', after.pending === 0 && after.left === 1, JSON.stringify(after));
  // Revert one accepted change
  await p2.selectOption('#proseFilter', 'accepted');
  const revertedFind = await p2.evaluate(() => Prose.items().filter((i) => i.status === 'accepted').sort((a, b) => a.start - b.start)[0].original);
  await p2.click('.prose-item.st-accepted button:has-text("Revert")');
  await wait(100);
  check('Revert puts the original words back', await p2.evaluate((t) => Editor.text.includes(t), revertedFind));
  check('Prose pass doesn\'t flood the change pool', (await p2.evaluate(() => S.project.pool.length)) === 3);
  await p2.keyboard.press('Control+s');
  await wait(500);
  const projDisk = JSON.parse(await p2.evaluate(READ, ['Drive', 'Books', 'Oakvale', 'Oakvale Test.crucible', 'project.json']));
  check('Review state is saved with the book', projDisk.prose && projDisk.prose.items.length === ps.items.length);
  await p2.selectOption('#proseFilter', 'pending');

  // ================================================ CHAPTER BUILDER ====
  section('Chapter builder');
  await p2.evaluate(() => { App.setCollapsed('left', false); App.showTab('left', 'outline'); Editor.ta.setSelectionRange(0, 0); });
  const textBeforeCB = await p2.evaluate(() => Editor.text);
  await p2.click('#btnChapters');
  await wait(200);
  const titles = () => p2.evaluate(() => [...document.querySelectorAll('.cb-title')].map((i) => i.value));
  check('Builder lists the book\'s chapters', JSON.stringify(await titles()) === JSON.stringify(['Chapter One: Dust', 'Chapter Two: The Observer', 'Chapter Three: Typos']), (await titles()).join(' | '));
  check('Detects ## chapters under a # title', await p2.evaluate(() => Chapters.model.level === 2 && /Before the first chapter/.test($('.cb-pre').textContent)));
  await p2.click('.modal footer button.accent'); // Apply with no edits
  await wait(150);
  check('Apply with no edits changes nothing', (await p2.evaluate(() => Editor.text)) === textBeforeCB);
  await p2.click('#btnChapters');
  await wait(200);
  // Rename chapter two
  await p2.fill('.cb-row:nth-child(2) .cb-title', 'Chapter Two: The Watcher');
  // Add a chapter at the end and name it
  await p2.click('.cb-add button:has-text("at end")');
  await wait(100);
  check('New chapter matches the book\'s numbering style', (await titles())[3] === 'Chapter Four', (await titles())[3]);
  await p2.fill('.cb-row:nth-child(4) .cb-title', 'Chapter Four: Rain');
  // Move the new chapter up one (above Typos)
  await p2.click('.cb-row:nth-child(4) button[title="Move up"]');
  // Remove the Typos chapter, text and all
  await p2.click('.cb-row:nth-child(4) button[title="Remove chapter"]');
  await wait(100);
  check('Removing a chapter asks how', (await p2.textContent('.modal-back:last-child .modal')).includes('Keep the text'));
  await p2.click('.modal-back:last-child footer button:has-text("Delete chapter & text")');
  await wait(100);
  // Chapter image on chapter one
  await p2.click('.cb-row:nth-child(1) .cb-img input');
  await wait(500);
  check('Ticking Image picks and shows a thumbnail', await p2.evaluate(() => { const t = document.querySelector('.cb-row:nth-child(1) .cb-thumb'); return !!t && t.complete && t.naturalWidth > 0; }));
  await p2.screenshot({ path: path.join(OUT, 'w12-chapter-builder.png') });
  await p2.click('.modal footer button.accent'); // Apply
  await wait(300);
  const cbText = await p2.evaluate(() => Editor.text);
  const cbHeads = cbText.match(/^## .+$/gm);
  check('Chapters renamed, added, reordered, removed', JSON.stringify(cbHeads) === JSON.stringify(['## Chapter One: Dust', '## Chapter Two: The Watcher', '## Chapter Four: Rain']) && !cbText.includes('Typo paragraph'), cbHeads.join(' | '));
  check('Chapter image written under the heading', /## Chapter One: Dust\n\n!\[chapter-image\]\(images\/chapter-\w+\.png\)\n\nThe dust rolled/.test(cbText));
  check('Epigraph before chapter one untouched', cbText.includes('> — William Faulkner\n\n## Chapter One: Dust'));
  const imgRel = cbText.match(/\]\((images\/chapter-\w+\.png)\)/)[1];
  const imgOnDisk = await p2.evaluate(async (rel) => {
    let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Drive');
    for (const n of ['Books', 'Oakvale', 'images']) d = await d.getDirectoryHandle(n);
    return (await (await d.getFileHandle(rel.split('/')[1])).getFile()).size;
  }, imgRel);
  check('Image copied into the book\'s images folder', imgOnDisk > 500);
  check('Change pool items still found after restructuring', await p2.evaluate(() => S.project.pool.every((p) => !p.missing && Editor.text.slice(p.start, p.end) === p.text)));
  await p2.evaluate(() => Editor.setView('split'));
  await wait(500);
  check('Preview shows the chapter image', await p2.evaluate(() => { const i = document.querySelector('#preview img.chapter-image'); return !!i && i.complete && i.naturalWidth > 0; }));
  await p2.evaluate(() => { const h = [...document.querySelectorAll('#preview h2')].find((x) => x.textContent.includes('Chapter One')); $('#previewPane').scrollTop = h.offsetTop - 40; });
  await p2.screenshot({ path: path.join(OUT, 'w13-chapter-image-preview.png') });
  // One undo restores everything
  await p2.evaluate(() => { Editor.ta.focus(); document.execCommand('undo'); });
  await wait(150);
  check('One Ctrl+Z undoes the whole set of changes', (await p2.evaluate(() => Editor.text)) === textBeforeCB);
  await p2.evaluate(() => { Editor.ta.focus(); document.execCommand('redo'); });
  await wait(150);
  // Big changes (moving whole chapters on a long book) take the fast path
  // with Crucible's own one-step undo. Force that path here.
  await p2.evaluate(() => { Editor.NATIVE_INSERT_MAX = 10; });
  const beforeMove = await p2.evaluate(() => Editor.text);
  await p2.click('#btnChapters');
  await wait(200);
  await p2.click('.cb-row:nth-child(3) button[title="Move up"]');
  await p2.click('.cb-row:nth-child(2) button[title="Move up"]');
  await p2.click('.modal footer button.accent');
  await wait(200);
  const movedHeads = (await p2.evaluate(() => Editor.text)).match(/^## .+$/gm);
  check('Big change applied quickly', movedHeads[0] === '## Chapter Four: Rain' && (await p2.evaluate(() => Editor.bulkUndo.length)) === 1, movedHeads.join(' | '));
  await p2.evaluate(() => Editor.ta.focus());
  await p2.keyboard.press('Control+z');
  await wait(150);
  check('Ctrl+Z undoes a big change in one step', (await p2.evaluate(() => Editor.text)) === beforeMove);
  await p2.keyboard.press('Control+y');
  await wait(150);
  check('Ctrl+Y redoes it', (await p2.evaluate(() => Editor.text.match(/^## .+$/m)[0])) === '## Chapter Four: Rain');
  check('Pool items still found after big change + undo/redo', await p2.evaluate(() => S.project.pool.every((p) => !p.missing && Editor.text.slice(p.start, p.end) === p.text)));
  await p2.keyboard.press('Control+z');
  await wait(150);
  await p2.evaluate(() => { Editor.NATIVE_INSERT_MAX = 4000; });

  // Keep-the-text removal
  await p2.click('#btnChapters');
  await wait(200);
  await p2.click('.cb-row:nth-child(2) button[title="Remove chapter"]');
  await p2.click('.modal-back:last-child footer button:has-text("Keep the text")');
  await p2.click('.modal-back:last-child footer button.accent');
  await wait(200);
  const merged = await p2.evaluate(() => Editor.text);
  check('"Keep the text" removes only the heading', !merged.includes('The Watcher') && merged.includes('Cross arrived on a Tuesday'));
  // PDF gets the image embedded
  await p2.evaluate(() => {
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', { configurable: true, get() { const w = desc.get.call(this); if (w) w.print = () => { window.__printed = { html: this.srcdoc }; }; return w; } });
  });
  await p2.click('#btnExport');
  await p2.click('.modal footer button.accent');
  await wait(800);
  const ph = await p2.evaluate(() => window.__printed?.html || '');
  check('PDF has the chapter image embedded', /<img[^>]*class="chapter-image"[^>]*src="data:image\/png;base64,/.test(ph) || /<img[^>]*src="data:image\/png;base64,[^"]+"[^>]*class="chapter-image"/.test(ph));
  const pp2 = await pdfBrowser.newPage();
  await pp2.setContent(ph);
  await pp2.pdf({ path: path.join(OUT, 'chapter-image.pdf'), preferCSSPageSize: true });
  await pp2.close();

  // ===================================================== ALIGNMENT ====
  section('Text alignment');
  await p2.evaluate(() => { Editor.replaceRange(Editor.text.length, Editor.text.length, '\n\nThe End\n'); const a = Editor.text.lastIndexOf('The End'); Editor.ta.focus(); Editor.ta.setSelectionRange(a + 2, a + 2); Editor.onCaret(); });
  check('Align buttons show "left" for normal text', await p2.evaluate(() => $('#alignSeg button.on').dataset.align === 'left'));
  await p2.click('#alignSeg button[data-align="center"]');
  await wait(100);
  check('Center wraps the paragraph in an alignment block', (await p2.evaluate(() => Editor.text)).includes('::: center\nThe End\n:::'));
  check('Center button now lit', await p2.evaluate(() => $('#alignSeg button.on').dataset.align === 'center'));
  await p2.evaluate(() => Editor.setView('split'));
  await wait(400);
  check('Preview centers it', await p2.evaluate(() => { const d = document.querySelector('#preview .align-center'); return !!d && getComputedStyle(d).textAlign === 'center' && d.textContent.trim() === 'The End'; }));
  await p2.click('#alignSeg button[data-align="right"]');
  await wait(100);
  check('Right switches the same block', (await p2.evaluate(() => Editor.text)).includes('::: right\nThe End\n:::') && !(await p2.evaluate(() => Editor.text)).includes('::: center'));
  await p2.keyboard.press('Control+z');
  await wait(100);
  check('Ctrl+Z undoes alignment', (await p2.evaluate(() => Editor.text)).includes('::: center\nThe End\n:::'));
  await p2.evaluate(() => { const p = document.querySelector('#preview .align-center'); $('#previewPane').scrollTop = p.offsetTop - 200; });
  await p2.screenshot({ path: path.join(OUT, 'w14-align.png') });
  const tocT = await p2.evaluate(() => {
    const md = '# My Book\n\nA dedication.\n\n[TOC]\n\n## Part\n\n# One\n\ntext\n\n## Scene A\n\nx\n\n# Two\n\ny\n';
    const o = { ...Export.defaults(), title: 'My Book', breakLevel: '1' };
    const at = (h) => { const i = h.indexOf('class="toc"'); return i; };
    const ch = Export.buildHtml(md, { ...o, toc: 'chapters' });
    const sc = Export.buildHtml(md, { ...o, toc: 'scenes' });
    const none = Export.buildHtml(md, { ...o, toc: 'none' });
    const auto = Export.buildHtml(md.replace('[TOC]\n\n', ''), { ...o, toc: 'chapters' });
    return {
      marker: at(ch) > ch.indexOf('A dedication') && at(ch) < ch.indexOf('>Part<'),
      chItems: (ch.match(/<li class="toc-ch"/g) || []).length, titleSkipped: !/toc-t">My Book</.test(ch),
      scItems: (sc.match(/<li class="toc-sc"/g) || []).length,
      none: !none.includes('class="toc"') && !none.includes('[TOC]'),
      auto: auto.indexOf('class="toc"') < auto.indexOf('id="toc-1"') && auto.indexOf('class="toc"') > auto.indexOf('A dedication'),
    };
  });
  // ---- Security: replay the independent review's attacks ----------------
  section('Security');
  const hostile = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hostile-zips.json'), 'utf8'));
  const sec = await p2.evaluate(async ({ hostile }) => {
    const r = {};
    const trap = '# Trap\n\n## Chapter One\n\n<div><template shadowrootmode="open"><img src="x" onerror="parent.__pwned=1"><iframe src="file:///etc/passwd"></iframe></template></div>\n\n<a href="java&#x09;script:parent.__pwned=1">click</a> <svg><animate attributeName="href" values="javascript:parent.__pwned=1"/></svg> <img src="//127.0.0.1/share/x.png"> <base href="https://evil.example/">\n\nText.\n\n## Chapter Two\n\nMore.\n';
    const html = Export.buildHtml(trap, { ...Export.defaults(), cssPaging: true });
    r.exportClean = !/template|onerror|<iframe|javascript:|<svg|<base|\/\/127/i.test(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''));
    r.exportCsp = html.includes(Export.PRINT_CSP) && /default-src 'none'/.test(Export.PRINT_CSP);
    // Layout frames are sandboxed (no scripts can run in them).
    let sandboxSeen = null;
    const mo = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.tagName === 'IFRAME') sandboxSeen = n.getAttribute('sandbox'); })));
    mo.observe(document.body, { childList: true });
    // Even if raw, unsanitized HTML reached the layout frame, nothing runs.
    await Export.paginate('<!doctype html><html><head></head><body><img src="x" onerror="parent.__pwned=1"><script>parent.__pwned=1</script><h2 id="toc-1">A</h2></body></html>', Export.defaults());
    mo.disconnect();
    r.sandbox = sandboxSeen;
    // The page itself only runs Crucible's own scripts.
    const d = document.createElement('div');
    d.innerHTML = '<img src="x" onerror="window.__pwned=1">';
    document.body.append(d);
    await new Promise((res) => setTimeout(res, 300));
    d.remove();
    r.pwned = !!window.__pwned;
    // Settings: a changed address drops the key; imports don't switch your AI.
    const cur = SettingsCore.migrateSettings({ providers: [{ id: 'p1', name: 'Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-real' }, { id: 'p2', name: 'Local', type: 'openai', baseUrl: 'http://localhost:11434/v1', apiKey: '' }], activeProviderId: 'p2' });
    const evil = { crucibleSettings: true, providers: [{ id: 'p1', name: 'Claude', type: 'openai', baseUrl: 'https://evil.example/v1' }, { id: 'p9', name: 'Claude ', type: 'openai', baseUrl: 'https://evil.example/v1' }], activeProviderId: 'p9' };
    const m = SettingsCore.mergeImported(cur, evil, { platform: 'web' });
    // Without your OK the address isn't changed at all (so the key stays with
    // its own server) and the new AI isn't added; with your OK the key is dropped.
    r.addressKept = m.next.providers.find((p) => p.id === 'p1').baseUrl === 'https://api.anthropic.com' && !m.next.providers.some((p) => p.id === 'p9') && m.endpointChanges.length === 2;
    r.keyDropped = SettingsCore.mergeImported(cur, evil, { platform: 'web', endpoints: 'apply' }).next.providers.find((p) => p.id === 'p1').apiKey === '';
    r.activeKept = m.next.activeProviderId === 'p2';
    // The finding the earlier test missed: the ACTIVE AI's address (no key needed).
    const act = SettingsCore.mergeImported(cur, { crucibleSettings: true, providers: [{ id: 'p2', name: 'Local', type: 'openai', baseUrl: 'https://evil.example/v1' }] }, { platform: 'web' });
    r.activeAddressKept = act.next.activeProviderId === 'p2' && act.next.providers.find((p) => p.id === 'p2').baseUrl === 'http://localhost:11434/v1' && act.endpointChanges.length === 1;
    const tenant = SettingsCore.migrateSettings({ providers: [{ id: 't', name: 'T', type: 'openai', baseUrl: 'https://ai.example.com/TenantA/v1', apiKey: 'sk-t' }] });
    r.pathCase = SettingsCore.endpointChanged(tenant.providers[0], { type: 'openai', baseUrl: 'https://ai.example.com/tenanta/v1' })
      && !SettingsCore.endpointChanged(tenant.providers[0], { type: 'openai', baseUrl: 'HTTPS://AI.Example.com:443/TenantA/v1/' });
    const same = SettingsCore.mergeImported(cur, { crucibleSettings: true, providers: [{ id: 'p1', name: 'Claude (renamed)', type: 'anthropic', baseUrl: 'https://api.anthropic.com/' }] }, { platform: 'web' });
    r.keyKeptSameAddress = same.next.providers.find((p) => p.id === 'p1').apiKey === 'sk-real';
    // Zip bombs and overlapping entries are refused.
    const src = (b64) => { const u = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); return { size: u.length, read: async (o, l) => u.slice(o, o + l) }; };
    try {
      const z = await Zip.readZip(src(hostile.bomb));
      const rd = z.open(z.entries[0]).getReader(); let got = 0;
      for (;;) { const x = await rd.read(); if (x.done) break; got += x.value.length; }
      r.bomb = `unpacked ${got}`;
    } catch (e) { r.bomb = 'refused'; }
    try { await Zip.readZip(src(hostile.overlap)); r.overlap = 'accepted'; } catch { r.overlap = 'refused'; }
    r.devNames = Zip.safeParts('Books/CON.txt').join('/') === 'Books/_CON.txt' && Zip.safeParts('nul').join('') === '_nul';
    // "Pictures" must really be pictures.
    const dir = await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Drive')).getDirectoryHandle('Books')).getDirectoryHandle('Oakvale');
    const w = await (await dir.getFileHandle('fake.png', { create: true })).createWritable(); await w.write('TOP-SECRET not a picture'); await w.close();
    r.fakeImage = await window.crucible.readBookImage({ bookPath: S.path, rel: 'fake.png' });
    r.badLang = DocExport.lang('en"/><evil', 'en') === 'en' && DocExport.lang('pt-BR', 'en') === 'pt-BR';
    r.netPath = isNetworkPath('\\\\server\\share\\x.mp3') && isNetworkPath('//server/x') && isNetworkPath('file://server/x') && !isNetworkPath('C:\\Music\\x.mp3') && fileUrl('\\\\server\\x') === '';
    r.longLine = (() => { const t0 = performance.now(); TextOps.outline('## ' + ' #'.repeat(60000) + 'x\n'); return Math.round(performance.now() - t0); })();
    return r;
  }, { hostile });
  check('Security: a booby-trapped manuscript exports clean', sec.exportClean && sec.exportCsp, JSON.stringify(sec));
  check('Security: print/layout frames are sandboxed; nothing ran', sec.sandbox === 'allow-same-origin' && !sec.pwned && !(await p2.evaluate(() => window.__pwned)), `sandbox=${sec.sandbox}`);
  check('Security: only Crucible\'s own scripts can run in the page', !sec.pwned);
  check('Security: a doctored settings file can\'t redirect your key or switch your AI', sec.addressKept && sec.keyDropped && sec.activeKept && sec.keyKeptSameAddress, JSON.stringify(sec));
  check('Security: an imported file can\'t move your ACTIVE AI without your OK', sec.activeAddressKept, JSON.stringify(sec));
  check('Security: path letter-case matters, server-name case doesn\'t', sec.pathCase);
  check('Security: zip bombs, overlapping entries and device names refused', sec.bomb === 'refused' && sec.overlap === 'refused' && sec.devNames, `${sec.bomb} / ${sec.overlap}`);
  check('Security: "pictures" must really be pictures', sec.fakeImage === null);
  check('Security: export language can\'t inject XML; network paths refused', sec.badLang && sec.netPath);
  check('Security: a giant heading line can\'t freeze the editor', sec.longLine < 1000, `${sec.longLine} ms`);

  check('Contents: [TOC] line places it; book title left out', tocT.marker && tocT.titleSkipped && tocT.chItems === 2, JSON.stringify(tocT));
  check('Contents: scenes option lists scenes; "none" removes it and the marker', tocT.scItems === 2 && tocT.none, JSON.stringify(tocT));
  check('Contents: without a marker it goes just before the first chapter', tocT.auto, JSON.stringify(tocT));
  // Insert-TOC command + preview
  const tocCmd = await p2.evaluate(() => {
    const t0 = Editor.text;
    const keep = [Editor.ta.selectionStart, Editor.ta.selectionEnd];
    const v0 = document.querySelector('#editorWrap').dataset.view;
    const i = t0.indexOf('## Chapter One');
    Editor.ta.setSelectionRange(i + 3, i + 3);
    Editor.insertToc();
    const t1 = Editor.text;
    Editor.setView('split');
    const pv = document.querySelector('#preview .toc')?.textContent || '';
    Editor.insertToc(); // a second one isn't added
    const twice = (Editor.text.match(/^\[TOC\]$/gm) || []).length;
    Editor.replaceAll(t0);
    Editor.setView(v0);
    Editor.ta.setSelectionRange(...keep);
    return { placed: t1.slice(i, i + 7) === '[TOC]\n\n', pv: pv.includes('Chapter One'), twice };
  });
  check('Right-click "Insert table of contents here" adds a [TOC] line; preview shows the contents', tocCmd.placed && tocCmd.pv && tocCmd.twice === 1, JSON.stringify(tocCmd));
  const alignHtml = await p2.evaluate(() => Export.buildHtml(Editor.text, { ...Export.defaults(), cssPaging: true }));
  check('PDF output centers it', alignHtml.includes('<div class="align-center">') && alignHtml.includes('.align-center, .align-center p { text-align: center'));
  await p2.click('#alignSeg button[data-align="left"]');
  await wait(100);
  check('Left removes the block again', !(await p2.evaluate(() => Editor.text)).includes(':::'));
  await p2.click('#alignSeg button[data-align="center"]');

  // =============================================== PACKAGE & BACK UP ====
  section('Package & back up');
  await p2.evaluate(() => {
    window.showSaveFilePicker = async ({ suggestedName }) => {
      const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('OtherDrive', { create: true });
      window.__zipName = suggestedName;
      return d.getFileHandle(suggestedName, { create: true });
    };
  });
  await p2.click('#btnPackage');
  await wait(800);
  const pkText = await p2.textContent('.modal');
  check('Package window lists what goes in', pkText.includes('Books, story memory') && pkText.includes('Music') && pkText.includes('Settings') && pkText.includes('Drive'));
  await p2.screenshot({ path: path.join(OUT, 'w15-package.png') });
  await p2.click('.modal .pk-keys input'); // toggle keys OFF (default on: keys kept in file)
  await p2.click('.modal footer button.accent');
  for (let i = 0; i < 100 && !(await p2.evaluate(() => /Backup saved/.test(document.querySelector('.modal')?.textContent || ''))); i++) await wait(100);
  check('Backup finishes', (await p2.textContent('.modal')).includes('Backup saved'));
  await p2.screenshot({ path: path.join(OUT, 'w16-package-done.png') });
  const zipB64 = await p2.evaluate(async () => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('OtherDrive');
    const f = await (await d.getFileHandle(window.__zipName)).getFile();
    const bytes = new Uint8Array(await f.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const zipPath = path.join(OUT, 'package-test.zip');
  fs.writeFileSync(zipPath, Buffer.from(zipB64, 'base64'));
  const { execFileSync } = require('child_process');
  const zr = JSON.parse(execFileSync('python3', ['-c', `
import zipfile, json, sys
z = zipfile.ZipFile(sys.argv[1])
s = json.loads(z.read('crucible-settings.json'))
print(json.dumps({'bad': z.testzip(), 'names': z.namelist(), 'key': s['providers'][0].get('apiKey'), 'readme': z.read('READ ME - Crucible backup.txt').decode()[:400]}))
`, zipPath]).toString());
  check('Zip is valid (Python testzip)', zr.bad === null);
  check('Zip has the program, settings and READ ME', ['crucible-settings.json', 'READ ME - Crucible backup.txt'].every((n) => zr.names.includes(n)));
  check('Zip has the book, its .crucible folder and chapter images', zr.names.includes('Books/Oakvale/Oakvale Test.md') && zr.names.some((n) => n.startsWith('Books/Oakvale/Oakvale Test.crucible/project.json')) && zr.names.some((n) => n.startsWith('Books/Oakvale/images/chapter-')));
  check('Zip has the music', zr.names.includes('Music/Night Drive.mp3'));
  check('API keys left out when unticked', !zr.key);
  check('Old settings file replaced by a fresh snapshot (no duplicate)', zr.names.filter((n) => n === 'crucible-settings.json').length === 1);
  await p2.click('.modal footer button.accent'); // Done

  // ================================================== MARGIN NOTES ====
  section('Margin notes');
  await p2.evaluate(() => { App.setCollapsed('left', false); const a = Editor.text.indexOf('Judy brought'); Editor.ta.focus(); Editor.ta.setSelectionRange(a, a + 12); });
  await p2.keyboard.press('Alt+n');
  await wait(150);
  await p2.fill('.modal textarea', 'Check her motivation here.');
  await p2.click('.modal footer button.accent');
  await wait(150);
  check('Alt+N adds a margin note', (await p2.evaluate(() => S.project.notes.length)) === 1 && (await p2.textContent('#notesBadge')) === '1');
  await p2.evaluate(() => Editor.replaceRange(0, 0, 'Typed above.\n\n'));
  check('Note follows edits', await p2.evaluate(() => { const n = S.project.notes[0]; return Editor.text.slice(n.start, n.end) === n.text; }));
  await p2.evaluate(() => { const n = S.project.notes[0]; Editor.ta.setSelectionRange(n.start + 3, n.start + 3); Editor.onCaret(); });
  await wait(300);
  check('Status bar shows the note at the cursor', (await p2.textContent('#stNotes')).includes('1 note here'));
  await p2.click('#stNotes');
  await wait(150);
  check('Clicking it opens the Notes tab', await p2.evaluate(() => $('#left section[data-tab="notes"]').classList.contains('on')));
  await p2.screenshot({ path: path.join(OUT, 'w17-notes.png') });
  check('Notes never go into exports', !(await p2.evaluate(() => Export.buildHtml(Editor.text, { ...Export.defaults(), cssPaging: true }))).includes('motivation'));

  // ============================================ CORKBOARD & TIMELINE ====
  section('Corkboard & timeline');
  await p2.evaluate(() => {
    Editor.replaceRange(Editor.text.length, Editor.text.length, "\n\n## Chapter Five: Eyes\n\nMara had grey eyes like her father. She arrived on Monday.\n\n***\n\nThe second scene of five.\n\n### The market\n\nAt the market, Mara's blue eyes flashed.\n\n## Chapter Six: Later\n\nMara arrived on Tuesday, tired.\n");
  });
  await p2.evaluate(() => App.showTab('left', 'outline'));
  await p2.click('#btnCork');
  await wait(300);
  const cards = await p2.evaluate(() => Corkboard.model.chapters.map((c) => c.scenes.length));
  check('Corkboard shows scenes per chapter', cards.length >= 4 && cards[cards.length - 2] === 3, JSON.stringify(cards));
  await p2.screenshot({ path: path.join(OUT, 'w18-corkboard.png') });
  const cols = await p2.locator('.cork-col').count();
  await p2.locator(`.cork-col:nth-child(${cols - 1}) .cork-card:nth-child(3)`).dragTo(p2.locator(`.cork-col:nth-child(${cols}) .cork-card:nth-child(1)`));
  await wait(200);
  check('Dragging moves the card', await p2.evaluate(() => { const c = Corkboard.model.chapters; return c[c.length - 1].scenes[0].title === 'The market'; }));
  await p2.dblclick(`.cork-col:nth-child(${cols - 1}) .cork-card:nth-child(1)`);
  await wait(150);
  await p2.fill('.modal-back:last-child textarea', 'Mara is introduced');
  await p2.fill('.modal-back:last-child input[placeholder^="e.g. 1952"]', '1952-06-02');
  await p2.fill('.modal-back:last-child input[placeholder^="e.g. Present"]', 'Present');
  await p2.click('.modal-back:last-child footer button.accent');
  await wait(150);
  await p2.click('.modal-back:last-child footer button.accent'); // Apply
  await wait(250);
  const corkText = await p2.evaluate(() => Editor.text);
  check('Apply moves the scene in the manuscript', /## Chapter Six: Later\n\n### The market\n\nAt the market/.test(corkText), corkText.slice(-260));
  check('Card details stored as a hidden comment', corkText.includes('## Chapter Five: Eyes\n\n<!-- scene when="1952-06-02" track="Present" summary="Mara is introduced" -->'));
  await p2.click('#btnTimeline');
  await wait(300);
  await p2.click('.tl .seg button:has-text("Reading order")');
  const tlWhen = p2.locator('.tl-card:has-text("The market") .tl-when');
  await tlWhen.fill('1952-05-30');
  await tlWhen.dispatchEvent('change');
  await p2.locator('.tl-card:has-text("The market") .tl-track').fill('Present');
  await p2.locator('.tl-card:has-text("The market") .tl-track').dispatchEvent('change');
  await wait(150);
  check('Reading order flags a jump back in time', await p2.evaluate(() => !!document.querySelector('.tl-card.jump')));
  await p2.click('.tl .seg button:has-text("Story time")');
  await wait(100);
  check('Story-time lane sorts by date', (await p2.evaluate(() => [...[...document.querySelectorAll('.cork-col')].find((c) => c.querySelector('.cork-head').textContent === 'Present').querySelectorAll('.tl-title')].map((t) => t.textContent))).join('|').startsWith('The market'));
  await p2.screenshot({ path: path.join(OUT, 'w19-timeline.png') });
  await p2.click('.modal footer button.accent');
  await wait(200);
  check('Timeline dates saved into the scene', (await p2.evaluate(() => Editor.text)).includes('### The market\n\n<!-- scene when="1952-05-30" track="Present" -->'));
  await p2.keyboard.press('Control+z');
  await wait(150);
  check('One Ctrl+Z undoes the timeline changes', !(await p2.evaluate(() => Editor.text)).includes('when="1952-05-30"'));
  await p2.keyboard.press('Control+y');
  await wait(150);

  // ===================================================== CONTINUITY ====
  section('Continuity check');
  await p2.evaluate(() => {
    App.showTab('right', 'prose');
    S.project.prose = null; Prose.render();
    Prose.CHUNK_CHARS = 120;
    const a = Editor.text.indexOf('## Chapter Five'); Editor.ta.focus(); Editor.ta.setSelectionRange(a, Editor.text.length);
    $('#proseScope').value = 'selection'; $('#proseLevel').value = 'continuity'; $('#proseLevel').dispatchEvent(new Event('change'));
  });
  check('Continuity level always uses story memory', await p2.evaluate(() => $('#proseMemory').closest('label').classList.contains('hidden') && $('#proseStart').textContent === 'Check continuity'));
  await p2.click('#proseStart');
  for (let i = 0; i < 100 && (await p2.evaluate(() => Prose.running)); i++) await wait(100);
  const cont = await p2.evaluate(() => ({ items: Prose.items().map((i) => ({ fix: i.replace, why: i.why, find: i.find })), facts: S.project.prose.facts || '' }));
  check('Fact sheet carried between sections', cont.facts.includes('grey eyes') && cont.facts.includes('arrived on Monday'), cont.facts);
  check('Finds the eye-colour contradiction with a fix', cont.items.some((i) => i.find.includes('blue eyes') && i.fix && i.fix.includes('grey eyes')), JSON.stringify(cont.items));
  check('Flags the day contradiction without a fix', cont.items.some((i) => i.find.includes('arrived on Tuesday') && i.fix === null));
  await p2.screenshot({ path: path.join(OUT, 'w20-continuity.png') });
  await p2.click('.prose-item.issue button:has-text("Apply fix")');
  await wait(150);
  check('Apply fix corrects the text', (await p2.evaluate(() => Editor.text)).includes("Mara's grey eyes flashed"));
  await p2.click(".prose-item.issue button:has-text(\"I've fixed it\")");
  check('Problems without a fix can be marked handled', await p2.evaluate(() => Prose.items().some((i) => i.status === 'resolved')));
  await p2.evaluate(() => { Prose.CHUNK_CHARS = 4000; $('#proseLevel').value = 'proofread'; });

  // ===================================================== READ ALOUD ====
  section('Read aloud');
  await p2.evaluate(() => {
    window.__spoken = [];
    const fake = { speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 5); }, cancel() {}, pause() {}, resume() {}, getVoices: () => [] };
    Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
    const a = Editor.text.indexOf('Mara had grey eyes'); const b = Editor.text.indexOf('The second scene of five.') + 25;
    Editor.ta.focus(); Editor.ta.setSelectionRange(a, b);
    Speech.fromCursor();
  });
  await wait(30);
  check('Read-aloud bar appears', await p2.evaluate(() => !$('#readBar').classList.contains('hidden') || window.__spoken.length > 0));
  for (let i = 0; i < 30 && (await p2.evaluate(() => Speech.active)); i++) await wait(50);
  const spoken = await p2.evaluate(() => window.__spoken);
  check('Reads sentence by sentence, skipping markup', JSON.stringify(spoken) === JSON.stringify(['Mara had grey eyes like her father.', 'She arrived on Monday.', 'The second scene of five.']), JSON.stringify(spoken));
  check('Bar closes at the end', !(await p2.isVisible('#readBar')));

  // ================================================== WRITING GOALS ====
  section('Writing goals');
  await p2.evaluate(() => {
    const log = Goals.log(); const d = new Date();
    const key = (n) => { const x = new Date(d); x.setDate(x.getDate() - n); return Goals.day(x); };
    log[key(2)] = { start: 0, end: 600 }; log[key(1)] = { start: 600, end: 1200 };
  });
  await p2.click('#stGoal');
  await wait(150);
  await p2.fill('.modal input[placeholder="e.g. 500"]', '500');
  await p2.click('.modal footer button.accent');
  await wait(300);
  check('Daily goal saved (and in the settings file)', (await p2.evaluate(() => S.settings.dailyGoal)) === 500 && JSON.parse(await p2.evaluate(READ, ['Drive', 'crucible-settings.json'])).dailyGoal === 500);
  check('Streak counts consecutive days at goal', (await p2.evaluate(() => Goals.streak(500))) === 2);
  await p2.evaluate(() => { const t = Goals.log()[Goals.day()]; t.start = t.end - 40; Goals.render(); });
  check('Status bar shows today vs goal', /Today 40 \/ 500/.test(await p2.textContent('#stGoal')), await p2.textContent('#stGoal'));
  await p2.click('#stGoal');
  await wait(150);
  check('History chart drawn', (await p2.evaluate(() => document.querySelectorAll('.goal-chart rect').length)) === 30);
  await p2.screenshot({ path: path.join(OUT, 'w21-goals.png') });
  await p2.click('.modal footer button:has-text("Close")');

  // ===================================================== BETA READER ====
  section('Beta reader');
  await p2.evaluate(() => { const r = Editor.sectionRange(Editor.text.indexOf('Chapter Five') + 3); Editor.ta.focus(); Editor.ta.setSelectionRange(r.start + 5, r.start + 5); App.showTab('right', 'ai'); });
  lastReq = null;
  await p2.click('#btnBeta');
  await wait(150);
  await p2.selectOption('.modal select >> nth=0', { label: 'Literary agent' });
  await p2.selectOption('.modal select >> nth=1', 'chapter');
  await p2.click('.modal footer button.accent');
  for (let i = 0; i < 40 && (await p2.evaluate(() => AI.busy)); i++) await wait(100);
  await wait(150);
  check('Beta reader gets the persona and the chapter', (lastReq?.body.messages[0].content || '').includes('LITERARY AGENT') && JSON.stringify(lastReq?.body.messages.at(-1)).includes('Mara had grey eyes'));
  check('Reply shown in the AI desk under the persona', await p2.evaluate(() => [...document.querySelectorAll('.msg.assistant .who')].some((w) => w.textContent.startsWith('Literary agent'))));
  check("Chapter text isn't stored in the chat history", !(await p2.evaluate(() => JSON.stringify(S.project.chat))).includes('Mara had grey eyes'));
  await p2.screenshot({ path: path.join(OUT, 'w23-beta.png') });

  // ===================================================== DATA IMPORT ====
  section('Import data into story memory');
  await p2.evaluate(() => { window.crucible.openDataFile = async () => ({ name: 'cast.csv', text: 'Name,Age,Role\nMara Voss,34,Courier\n"Ellis, Jr.",12,"Her son, ""Eli"""\n' }); });
  const memBefore = await p2.evaluate(() => S.project.memory.length);
  await p2.click('#btnImportData').catch(async () => { await p2.evaluate(() => App.showTab('right', 'memory')); await p2.click('#btnImportData'); });
  await wait(200);
  check('Import preview shows records', (await p2.textContent('.modal .import-preview')).includes('## Mara Voss'));
  await p2.click('.modal footer button.accent');
  await wait(300);
  const imp = await p2.evaluate(async () => { const m = S.project.memory[S.project.memory.length - 1]; return { n: S.project.memory.length, text: await window.crucible.readMemoryText({ bookPath: S.path, file: m.file }) }; });
  check('CSV imported as a story-memory note', imp.n === memBefore + 1 && imp.text.includes('## Ellis, Jr.') && imp.text.includes('- **Role:** Her son, "Eli"'), imp.text.slice(0, 200));

  // ================================================== WORD & EPUB ====
  section('Word & EPUB export');
  await p2.evaluate(() => {
    window.showSaveFilePicker = async ({ suggestedName }) => {
      const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Exports', { create: true });
      return d.getFileHandle(suggestedName, { create: true });
    };
  });
  const toDisk = async (name) => {
    const b64 = await p2.evaluate(async (n) => {
      const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Exports');
      const u = new Uint8Array(await (await (await d.getFileHandle(n)).getFile()).arrayBuffer());
      let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s);
    }, name);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64'));
    return path.join(OUT, name);
  };
  for (const fmt of ['docx', 'epub']) {
    await p2.click('#btnExport');
    await wait(150);
    await p2.selectOption('.modal select >> nth=0', fmt);
    await wait(100);
    if (fmt === 'docx') await p2.screenshot({ path: path.join(OUT, 'w22-export-docx.png') });
    await p2.click('.modal footer button.accent');
    await wait(1500);
  }
  const docxPath = await toDisk('Oakvale Test.docx');
  const epubPath = await toDisk('Oakvale Test.epub');
  const { execFileSync: ex } = require('child_process');
  const dz = JSON.parse(ex('python3', ['-c', `
import docx, json, sys
d = docx.Document(sys.argv[1])
print(json.dumps({'heads': [p.text for p in d.paragraphs if p.style.name == 'Heading 1'], 'images': len(d.inline_shapes), 'text': ' '.join(p.text for p in d.paragraphs)}))`, docxPath]).toString());
  check('Word file opens; chapters are Heading 1', dz.heads.includes('Chapter One: Dust') && dz.heads.length >= 3, dz.heads.join(' | '));
  check('Word file has the chapter image', dz.images >= 1);
  const dx = JSON.parse(ex('python3', ['-c', `
import zipfile, json, sys
z = zipfile.ZipFile(sys.argv[1]); d = z.read('word/document.xml').decode()
print(json.dumps({'field': 'TOC \\\\o' in d, 'heading': 'w:val="TOCHeading"' in d, 'update': 'updateFields' in z.read('word/settings.xml').decode() if 'word/settings.xml' in z.namelist() else False, 'toc1': d.count('w:val="TOC1"'), 'before': d.find('TOCHeading') < d.find('Chapter One: Dust</w:t>')}))`, docxPath]).toString());
  check('Word file has a real table of contents (TOC field, updates on open)', dx.field && dx.heading && dx.update && dx.toc1 >= 3 && dx.before, JSON.stringify(dx));
  check('Word file leaves out hidden comments and notes', !dz.text.includes('Mara is introduced') && !dz.text.includes('motivation'));
  let ec = 'skipped';
  try { ex('epubcheck', [epubPath], { stdio: 'pipe' }); ec = 'ok'; } catch (e) { ec = e.code === 'ENOENT' ? 'skipped' : String(e.stdout || '') + String(e.stderr || ''); }
  check('EPUB passes epubcheck', ec === 'ok' || ec === 'skipped', ec === 'skipped' ? 'epubcheck not installed' : String(ec).slice(0, 500));
  const ez = JSON.parse(ex('python3', ['-c', `
import zipfile, json, sys, re
z = zipfile.ZipFile(sys.argv[1]); opf = z.read('OEBPS/content.opf').decode()
spine = re.findall(r'itemref idref="([^"]+)"', opf)
c = z.read('OEBPS/text/contents.xhtml').decode() if 'OEBPS/text/contents.xhtml' in z.namelist() else ''
links = re.findall(r'href="([^"#]+)#([^"]+)"', c)
ok = all(('id="%s"' % i) in z.read('OEBPS/text/' + f).decode() for f, i in links)
print(json.dumps({'spine': spine[:4], 'links': len(links), 'targets_ok': ok, 'ch1': 'Chapter One' in c}))`, epubPath]).toString());
  check('EPUB has a Contents page after the title page, with working links', ez.spine[0] === 'titlepage' && ez.spine.includes('contents') && ez.links >= 3 && ez.targets_ok && ez.ch1, JSON.stringify(ez));

  // =========================================================== RESTORE ====
  section('Restore from package');
  const { page: p7 } = await launch(APP, MOCKS);
  const errors7 = [];
  p7.on('pageerror', (e) => errors7.push(e.message));
  await p7.evaluate(async (b64) => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Incoming', { create: true });
    const w = await (await d.getFileHandle('backup.zip', { create: true })).createWritable();
    await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); await w.close();
  }, fs.readFileSync(zipPath).toString('base64'));
  await p7.reload();
  await wait(400);
  check('Welcome screen offers Restore', (await p7.textContent('.modal footer')).includes('Restore a backup'));
  await p7.click('.modal footer button:has-text("Restore a backup")');
  await wait(150);
  await p7.click('.modal-back:last-child footer button.accent'); // Choose backup…
  const askHdr = () => p7.evaluate(() => [...document.querySelectorAll('.modal header')].some((h) => h.textContent === 'Check these AI addresses'));
  for (let i = 0; i < 80 && !(await askHdr()); i++) await wait(100);
  check('Restore asks before using the backup\'s AI addresses', await askHdr());
  await p7.click('.modal-back:last-child footer button.accent'); // Use these addresses
  for (let i = 0; i < 80 && !(await p7.evaluate(() => /Your books/.test(document.querySelector('.modal header')?.textContent || ''))); i++) await wait(100);
  const rs = await p7.evaluate(() => ({ providers: S.settings.providers.map((p) => p.name), modal: document.querySelector('.modal')?.textContent || '' }));
  check('Restore loads the settings from the backup', rs.providers.includes('Fake AI'), JSON.stringify(rs.providers));
  check('Restored books are listed', rs.modal.includes('Oakvale Test.md'), rs.modal.slice(0, 200));
  const restored = await p7.evaluate(async () => {
    const nd = await (await navigator.storage.getDirectory()).getDirectoryHandle('NewDrive');
    const names = []; for await (const [n] of nd.entries()) names.push(n);
    const f = await nd.getDirectoryHandle(names[0]);
    const music = await (await f.getDirectoryHandle('Music')).getFileHandle('Night Drive.mp3').then((h) => h.getFile()).then((x) => x.size).catch(() => 0);
    return { folder: names[0], music };
  });
  check('Restored into a new "Crucible (restored …)" folder', /^Crucible \(restored /.test(restored.folder), restored.folder);
  check('Music restored byte-for-byte', restored.music === fs.statSync(path.join(FIX, 'test.mp3')).size);
  await p7.click('.modal .pick-list .mi');
  await wait(400);
  check('Restored book opens with its change pool', await p7.evaluate(() => Editor.text.includes('William Faulkner') && S.project.pool.length >= 1));
  check('No page errors (restore)', errors7.length === 0, errors7.join(' | '));

  // ================================ FOLDER SETTINGS: AI ADDRESS APPROVAL ====
  section('Folder settings: AI addresses need your OK every time');
  const { page: p8 } = await launch(APP, MOCKS);
  const errors8 = [];
  p8.on('pageerror', (e) => errors8.push(e.message));
  await p8.evaluate(LOAD, drive);
  await p8.reload();
  await wait(400);
  await p8.click('.modal footer button.accent'); // Choose Crucible folder…
  await wait(500);
  await p8.click('.modal-back:last-child footer button.accent'); // Use these addresses (first time)
  await wait(400);
  await p8.evaluate(() => document.querySelectorAll('.modal-back').forEach((m) => m.remove()));
  const base8 = await p8.evaluate(() => ({ id: S.settings.activeProviderId, url: S.settings.providers[0].baseUrl, n: S.settings.providers.length }));
  // Someone edits the folder's settings file to point your AI elsewhere.
  const writeHomeSettings = (edit) => p8.evaluate(async (edit) => {
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('Drive');
    const f = JSON.parse(await (await (await d.getFileHandle('crucible-settings.json')).getFile()).text());
    if (edit === 'redirect') f.providers = f.providers.map((p) => ({ ...p, baseUrl: 'https://evil.example/v1' }));
    if (edit === 'replace') { f.providers = [{ id: 'x9', name: 'Other AI', type: 'openai', baseUrl: 'https://other.example/v1', model: 'm' }]; f.activeProviderId = 'x9'; }
    const w = await (await d.getFileHandle('crucible-settings.json')).createWritable(); await w.write(JSON.stringify(f)); await w.close();
  }, edit);
  const askOpen = () => p8.evaluate(() => [...document.querySelectorAll('.modal header')].some((h) => h.textContent === 'Check these AI addresses'));
  const clickKeep = async () => { await p8.click('.modal-back:last-child footer button:has-text("Keep my current AIs")'); await wait(300); await p8.evaluate(() => document.querySelectorAll('.modal-back').forEach((m) => m.remove())); };
  await writeHomeSettings('redirect');
  p8.evaluate(() => App.connectHome(false)); // the REMEMBERED folder
  await wait(600);
  const fAsk1 = await askOpen();
  const fDuring1 = await p8.evaluate(() => S.settings.providers[0].baseUrl);
  await clickKeep();
  const fAfter1 = await p8.evaluate(() => S.settings.providers[0].baseUrl);
  p8.evaluate(() => App.connectHome(false)); // reconnect the same folder
  await wait(600);
  const fAsk2 = await askOpen();
  const fDuring2 = await p8.evaluate(() => S.settings.providers[0].baseUrl);
  await clickKeep();
  const fAfter2 = await p8.evaluate(() => S.settings.providers[0].baseUrl);
  check('Remembered folder: a changed AI address still needs your OK', fAsk1 && fDuring1 === base8.url && fAfter1 === base8.url, `${fDuring1} / ${fAfter1}`);
  check('Remembered folder: "Keep" survives reconnecting (asked again, never applied)', fAsk2 && fDuring2 === base8.url && fAfter2 === base8.url, `${fDuring2} / ${fAfter2}`);
  await writeHomeSettings('replace');
  p8.evaluate(() => App.connectHome(false));
  await wait(600);
  const fDuring3 = await p8.evaluate(() => ({ ids: S.settings.providers.map((p) => p.id), active: S.settings.activeProviderId }));
  const fAsk3 = await askOpen();
  await clickKeep();
  const fAfter3 = await p8.evaluate(() => ({ ids: S.settings.providers.map((p) => p.id), active: S.settings.activeProviderId }));
  check('Folder proposing other AIs: yours stay while it waits and after "Keep"', fAsk3 && fDuring3.ids.includes(base8.id) && !fDuring3.ids.includes('x9') && fAfter3.ids.includes(base8.id) && !fAfter3.ids.includes('x9') && fAfter3.active === base8.id, JSON.stringify({ fDuring3, fAfter3 }));
  // Accepting does apply it (so the prompt isn't just a dead end).
  p8.evaluate(() => App.connectHome(false));
  await wait(600);
  await p8.click('.modal-back:last-child footer button.accent'); // Use these addresses
  await wait(400);
  const fAfter4 = await p8.evaluate(() => ({ ids: S.settings.providers.map((p) => p.id), active: S.settings.activeProviderId }));
  check('…and "Use these addresses" applies the folder\'s AIs', fAfter4.ids.length === 1 && fAfter4.ids[0] === 'x9' && fAfter4.active === 'x9', JSON.stringify(fAfter4));
  check('No page errors (folder approval)', errors8.length === 0, errors8.join(' | '));

  // =========================================== UPGRADE FROM 1.0 ====
  section('Upgrade: settings from v1.0 carry into v1.1');
  const { page: p3 } = await launch(APP + 'old/crucible.html');
  await wait(400);
  await p3.evaluate(async () => {
    await window.crucible.saveSettings({
      providers: [{ id: 'old1', name: 'Claude (from 1.0)', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', newApiKey: 'sk-old' }],
      activeProviderId: 'old1', volume: 0.33, ui: { theme: 'light', fontSize: 20, view: 'preview' },
    });
  });
  await p3.goto(APP + 'crucible.html');
  await wait(500);
  const up = await p3.evaluate(() => S.settings);
  check('1.0 AI provider + key kept', up.providers[0]?.name === 'Claude (from 1.0)' && up.providers[0]?.hasKey);
  check('1.0 preferences kept', up.ui.theme === 'light' && up.ui.fontSize === 20 && up.volume === 0.33);
  check('New 1.1 settings get defaults', up.ui.autosave === false && up.ui.leftCollapsed === false && up.keysInFile === true && up.schema === 2);
  check('Theme applied after upgrade', await p3.evaluate(() => document.documentElement.dataset.theme === 'light'));

  // =========================================== EXPORT / IMPORT ====
  section('Settings export / import');
  const exported = await p3.evaluate(() => window.crucible.exportSettings({ includeKeys: false }));
  check('Export without keys leaves keys out', !exported.providers[0].apiKey && exported.providers[0].hadKey);
  const r = await p2.evaluate((f) => window.crucible.importSettings(f), exported);
  check('Import asks before adding an AI', r.providers === 1 && r.settings.providers.length === 1 && r.endpointChanges.length === 1 && r.endpointChanges[0].toHost === 'api.anthropic.com');
  const rc = await p2.evaluate((t) => window.crucible.confirmImportedEndpoints(t), r.confirmToken);
  check('Import adds providers and reports missing keys once confirmed', rc.keysMissing === 1 && rc.settings.providers.length === 2);

  // ============================================= BROWSER-STORAGE MODE ====
  section('Browsers without folder access');
  const { page: p4 } = await launch(APP, () => { window.showDirectoryPicker = undefined; window.showOpenFilePicker = undefined; });
  const errors4 = [];
  p4.on('pageerror', (e) => errors4.push(e.message));
  await wait(400);
  check('Fallback: welcome explains browser storage', (await p4.textContent('.modal')).includes("browser's own storage"));
  const tmpMd = path.join(OUT, 'Fallback Book.md');
  fs.writeFileSync(tmpMd, BOOK);
  const fc = p4.waitForEvent('filechooser');
  await p4.click('.modal footer button.accent');
  await (await fc).setFiles(tmpMd);
  await wait(500);
  await p4.evaluate(() => { Editor.replaceRange(0, 0, 'EDITED IN BROWSER\n\n'); });
  await p4.keyboard.press('Control+s');
  await wait(400);
  await p4.reload();
  await wait(400);
  await p4.click('.modal .pick-list .mi');
  await wait(400);
  check('Fallback: edits persist across reload', (await p4.evaluate(() => Editor.text)).startsWith('EDITED IN BROWSER'));
  check('No page errors (fallback mode)', errors4.length === 0, errors4.join(' | '));

  // ========================================== LOCKED / UNPLUGGED DRIVE ====
  section('Drive locked or unplugged (BitLocker)');
  const { page: p6 } = await launch(APP, MOCKS);
  const errors6 = [];
  p6.on('pageerror', (e) => errors6.push(e.message));
  await p6.evaluate(LOAD, drive);
  await p6.reload();
  await wait(400);
  await p6.click('.modal footer button.accent'); // choose Crucible folder
  await wait(500);
  await p6.click('.modal-back:last-child footer button.accent'); // OK the drive's AI addresses
  await wait(300);
  await p6.click('.modal .pick-list .mi');       // open book
  await wait(500);
  // "Pull the drive": remove it from under the open book.
  await p6.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry('Drive', { recursive: true }));
  await p6.evaluate(() => Editor.replaceRange(0, 0, 'Typed after the drive was locked.\n\n'));
  await p6.keyboard.press('Control+s');
  await wait(500);
  check('Saving to a missing drive explains what happened', (await p6.textContent('#toast')).includes('plugged in and unlocked'));
  check('Work stays open and unsaved', await p6.evaluate(() => S.dirty && Editor.text.startsWith('Typed after the drive')));
  await p6.evaluate(() => window.crucible.setDirty(false));
  await p6.reload();
  await wait(400);
  await p6.click('.modal footer button.accent'); // "Open Drive"
  await wait(500);
  check('Locked/unplugged drive gets a clear message', (await p6.textContent('.modal')).includes("Can't reach \"Drive\""));
  await p6.screenshot({ path: path.join(OUT, 'w6-drive-missing.png') });
  // "Unlock" it again (restore contents) and press Try again.
  await p6.evaluate(LOAD, drive);
  await p6.click('.modal footer button.accent'); // Try again
  await wait(600);
  check('Try again works once the drive is back', (await p6.textContent('.modal')).includes('Oakvale Test.md') && (await p6.evaluate(() => S.settings.providers.length)) === 1);
  check('No page errors (drive test)', errors6.length === 0, errors6.join(' | '));

  // ===================================================== file:// open ====
  section('Double-clicking the file');
  const { page: p5 } = await launch('file://' + path.join(ROOT, 'crucible.html'));
  const errors5 = [];
  p5.on('pageerror', (e) => errors5.push(e.message));
  p5.on('console', (m) => { if (m.type() === 'error') errors5.push(m.text()); });
  await p5.reload();
  await wait(500);
  check('Opens from file:// with folder access available', (await p5.evaluate(() => window.crucible.storageMode)) === 'folder' && errors5.length === 0, errors5.join(' | '));
  check('Version shown', (await p5.evaluate(() => window.crucible.getVersion())) === require('../package.json').version);

  for (const a of launches) {
    for (const w of a.windows()) await w.evaluate(() => window.crucible.setDirty(false)).catch(() => {});
    await a.close().catch(() => {});
  }
  await pdfBrowser.close();
  files.close();
  ai.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Output: ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
