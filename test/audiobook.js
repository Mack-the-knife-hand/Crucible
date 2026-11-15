// =============================================================================
// Audiobook studio end-to-end test (browser edition).
//   npm run build:web && node test/audiobook.js
// -----------------------------------------------------------------------------
// Runs dist-web/crucible.html in Electron's Chromium (see web-host.js) against a
// fake Gemini TTS server, with the folder pickers simulated by the browser's
// private file system and the microphone simulated by a test tone.
// Env: CRUCIBLE_TEST_OUT (screenshots)
// =============================================================================
const { _electron } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', 'dist-web');
const OUT = process.env.CRUCIBLE_TEST_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-audio-'));
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log(`\n── ${t}`);

const BOOK = `# Oakvale 1964

## Chapter 1: Nine Point Eight

*Thursday, March 12, 1964*

The office smelled of gun oil and old coffee.

“Duw, Mack,” Finch said quietly. “Come into the kitchen, bach.”

* * *

Judy locked the front door behind them.

## Chapter 2: Cover

“Lock the back door,” Wade said.
`;

// ---------------------------------------------------------------- servers --
const files = http.createServer((req, res) => {
  const p = path.join(ROOT, 'crucible.html');
  res.writeHead(200, { 'content-type': 'text/html' });
  fs.createReadStream(p).pipe(res);
});

// A short tone as a 24 kHz 16-bit WAV, like Gemini's Interactions API returns.
function toneWav(sec = 0.4, hz = 220) {
  const rate = 24000, n = Math.round(sec * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 9000 * Math.min(1, i / 400, (n - i) / 400)), 44 + i * 2);
  return b;
}
const ttsCalls = [];
const tts = http.createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const key = req.headers['x-goog-api-key'];
    if (key !== 'g-test-key') { res.writeHead(401, { 'content-type': 'application/json', ...cors }); return res.end(JSON.stringify({ error: { message: 'API key not valid.' } })); }
    if (req.method === 'GET' && req.url.startsWith('/v1beta/voices')) {
      const prompted = req.url.includes('type=prompted');
      if (req.url.includes('type=replicated') && !globalThis.replicatedOk) { res.writeHead(400, { 'content-type': 'application/json', ...cors }); return res.end(JSON.stringify({ error: { message: 'Unknown type.' } })); }
      res.writeHead(200, { 'content-type': 'application/json', ...cors });
      if (req.url.includes('type=replicated')) return res.end(JSON.stringify({ voices: [{ id: 'voice_mack', display_name: 'Mack', type: 'replicated' }] }));
      return res.end(JSON.stringify({ voices: prompted ? [{ id: 'voice_finch', display_name: 'Alistair Finch 1', type: 'prompted' }] : [{ id: 'Kore', display_name: 'Kore', type: 'prebuilt' }] }));
    }
    if (req.method === 'POST' && req.url === '/v1beta/interactions') {
      const j = JSON.parse(body);
      ttsCalls.push({ voice: j.generation_config.speech_config[0].voice, text: j.input[0].content[0].text, style: j.input[0].content[0].annotations?.[0]?.style, model: j.model });
      res.writeHead(200, { 'content-type': 'application/json', ...cors });
      return res.end(JSON.stringify({ id: 'i1', steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: toneWav(0.3 + Math.min(1, j.input[0].content[0].text.length / 100)).toString('base64') }] }] }));
    }
    res.writeHead(404, cors); res.end('{}');
  });
});

const MOCKS = () => {
  const sub = async (...names) => {
    let d = await navigator.storage.getDirectory();
    for (const n of names) d = await d.getDirectoryHandle(n, { create: true });
    return d;
  };
  window.showDirectoryPicker = async ({ id } = {}) => (id === 'crucible-home' ? sub('Drive') : sub('Drive', 'Books', 'Oakvale'));
  // Microphone: a steady test tone instead of a real microphone.
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const g = ctx.createGain(); g.gain.value = 0.3;
    const dst = ctx.createMediaStreamDestination();
    osc.connect(g).connect(dst); osc.start();
    return dst.stream;
  };
};
const READ = async (parts) => {
  let d = await navigator.storage.getDirectory();
  const ps = [...parts];
  const name = ps.pop();
  for (const p of ps) d = await d.getDirectoryHandle(p);
  const f = await (await d.getFileHandle(name)).getFile();
  return Array.from(new Uint8Array(await f.slice(0, 64).arrayBuffer())).concat([f.size]);
};
const LIST = async (parts) => {
  let d = await navigator.storage.getDirectory();
  for (const p of parts) d = await d.getDirectoryHandle(p);
  const out = [];
  for await (const [n, h] of d.entries()) if (h.kind === 'file') out.push({ name: n, size: (await h.getFile()).size });
  return out;
};

(async () => {
  await new Promise((r) => files.listen(0, '127.0.0.1', r));
  await new Promise((r) => tts.listen(0, '127.0.0.1', r));
  const APP = `http://127.0.0.1:${files.address().port}/`;
  const TTS_URL = `http://127.0.0.1:${tts.address().port}/v1beta`;
  const electronBin = require('electron');
  const app = await _electron.launch({
    executablePath: electronBin, args: ['--no-sandbox', path.join(__dirname, 'web-host.js')],
    env: { ...process.env, WEB_URL: APP, CRUCIBLE_TEST_OUT: OUT },
  });
  await app.context().addInitScript(MOCKS);
  const page = await app.firstWindow();
  await page.reload();
  await page.waitForLoadState('load');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !String(m.location()?.url).includes('type=replicated')) { errors.push(m.text()); console.log('CONSOLE ERROR at', JSON.stringify(m.location()), m.text().slice(0, 60)); } });
  const js = (fn, arg) => page.evaluate(fn, arg);
  const shot = (n) => page.screenshot({ path: path.join(OUT, n) });
  const until = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(fn)) return true; await wait(150); } return false; };

  try {
    section('Set up: a voice service and a book');
    await js(async (book) => {
      let d = await navigator.storage.getDirectory();
      for (const n of ['Drive', 'Books', 'Oakvale']) d = await d.getDirectoryHandle(n, { create: true });
      const w = await (await d.getFileHandle('Oakvale Test.md', { create: true })).createWritable();
      await w.write(book); await w.close();
    }, BOOK);
    await js(async (url) => {
      await window.crucible.saveSettings({
        providers: [
          { id: 'chat1', name: 'Writing AI', type: 'openai', baseUrl: 'http://127.0.0.1:9/v1', model: 'm' },
          { id: 'g1', name: 'Gemini TTS', type: 'gemini-tts', baseUrl: url, model: 'gemini-3.8-flash-tts', newApiKey: 'g-test-key', timeoutSec: 30 },
        ], activeProviderId: 'chat1',
      });
    }, TTS_URL);
    await page.reload();
    await wait(400);
    await page.click('.modal footer button.accent'); // Choose Crucible folder
    await wait(600);
    await page.click('.modal .pick-list .mi');
    await wait(500);
    check('Book opened', (await js(() => Editor.text)).includes('Nine Point Eight'));
    check('AI desk lists only the writing AI', (await js(() => [...document.querySelectorAll('#providerSelect option')].map((o) => o.textContent))).join() === 'Writing AI · m');

    section('Cast');
    await page.click('#right .tabs button[data-tab="audio"]');
    await wait(200);
    check('Audio tab shows', await page.isVisible('#auActors'));
    await page.click('#auActors button.accent'); // + Add Narrator
    await wait(200);
    await page.fill('.modal input[placeholder^="Voice name"]', 'Kore');
    await page.fill('.modal textarea', 'Calm, warm narrator.');
    await page.click('.modal button:has-text("Test voice")');
    await until(() => document.querySelector('.modal').textContent.includes('Playing'));
    check('Test voice speaks through the service', ttsCalls.length === 1 && ttsCalls[0].voice === 'Kore' && ttsCalls[0].style === 'Calm, warm narrator.');
    await shot('a1-actor.png');
    await page.click('.modal footer button.accent');
    await wait(200);
    await page.click('#auAddActor');
    await wait(200);
    await page.fill('.modal input[placeholder^="Character name"]', 'Alistair Finch');
    await page.click('.modal button:has-text("Load my voices")');
    await until(() => document.querySelector('#auVoiceList')?.options.length === 3);
    check('Load my voices lists designed and prebuilt voices', (await js(() => [...document.querySelectorAll('#auVoiceList option')].map((o) => o.value).filter(Boolean).join())) === 'voice_finch,Kore');
    globalThis.replicatedOk = true;
    await page.click('.modal button:has-text("Load my voices")');
    await until(() => document.querySelector('#auVoiceList')?.options.length === 4);
    check('Cloned (replicated) voices are listed first', (await js(() => [...document.querySelectorAll('#auVoiceList option')].map((o) => o.value).filter(Boolean).join())) === 'voice_mack,voice_finch,Kore');
    await page.selectOption('#auVoiceList', 'Kore');
    check('Picking from the voice list fills the voice box', (await js(() => document.querySelector('.modal input[placeholder^="Voice name"]').value)) === 'Kore');
    await page.fill('.modal input[placeholder^="Voice name"]', 'voice_finch');
    await page.click('.modal footer button.accent');
    await wait(200);
    await page.click('#auAddActor');
    await wait(200);
    await page.fill('.modal input[placeholder^="Character name"]', 'Me');
    await page.selectOption('.modal select >> nth=0', 'mic');
    await page.click('.modal footer button.accent');
    await wait(200);
    const cast = await js(() => Audiobook.data().actors.map((a) => `${a.name}:${a.narrator ? 'N' : ''}:${a.engine}:${a.voice}`));
    check('Three actors, one narrator', cast.join('|') === 'Narrator:N:tts:Kore|Alistair Finch::tts:voice_finch|Me::mic:', cast.join('|'));

    section('Actor whose voice service was removed and added again');
    await js(() => { Audiobook.data().actors[0].providerId = 'gone'; Audiobook.render(); });
    check('Cast list warns', (await page.textContent('#auActors')).includes('no voice service'));
    section('Pronunciation list');
    await js(() => { Audiobook.data().lexicon = [{ from: 'Duw', to: 'Dee-oo', matchCase: true }, { from: 'bach', to: 'bahkh' }]; Audiobook.render(); });
    check('Count shown', (await page.textContent('#auLexCount')) === '2');

    section('Voice a passage');
    const para = '“Duw, Mack,” Finch said quietly. “Come into the kitchen, bach.”';
    const finchId = await js(() => Audiobook.data().actors[1].id);
    await js((t) => { const a = Editor.text.indexOf(t); Editor.ta.focus(); Editor.ta.setSelectionRange(a, a + t.length); Audiobook.renderSelection(); }, para);
    check('Selection summary', (await page.textContent('#auSelInfo')).includes('3 pieces: 2 in quotes, 1 narration'), await page.textContent('#auSelInfo'));
    await page.selectOption('#auActorPick', finchId);
    ttsCalls.length = 0;
    await page.click('#auVoice');
    await until(() => !Audiobook.busy && Audiobook.data().clips.every((c) => c.status === 'ok'));
    const clips = await js(() => Audiobook.data().clips.map((c) => ({ who: Audiobook.actor(c.actorId).name, text: c.text, st: c.status, file: c.file, dur: c.dur })));
    check('Narrator re-attached to the only voice service', (await js(() => Audiobook.data().actors[0].providerId)) === 'g1');
    check('Three clips made', clips.length === 3 && clips.every((c) => c.st === 'ok'), JSON.stringify(clips.map((c) => c.st)));
    check('Quotes to Finch, the rest to the Narrator', clips.map((c) => c.who).join() === 'Alistair Finch,Narrator,Alistair Finch');
    check('Voices sent the right IDs', ttsCalls.map((c) => c.voice).join() === 'voice_finch,Kore,voice_finch');
    check('Pronunciation list applied, quote marks removed', ttsCalls[0].text === 'Dee-oo, Mack,' && ttsCalls[2].text === 'Come into the kitchen, bahkh.', JSON.stringify(ttsCalls.map((c) => c.text)));
    check('Clip lengths measured', clips.every((c) => c.dur > 0.2));
    const stored = await js(LIST, ['Drive', 'Books', 'Oakvale', 'Oakvale Test.crucible', 'audio']);
    check('Clip files saved with the book', stored.length === 3 && stored.every((f) => f.name.endsWith('.wav') && f.size > 1000), JSON.stringify(stored));
    await wait(500); // the backdrop redraws shortly after a change
    const marks = await js(() => [...document.querySelectorAll('#hlBackdrop mark.hl-au')].map((m) => m.style.getPropertyValue('--au')));
    const markInfo = await js(() => [...document.querySelectorAll('#hlBackdrop mark')].map((m) => `${m.className}:${m.style.getPropertyValue('--au')}:${m.textContent.slice(0, 12)}`));
    check('Voiced text underlined in actor colours', marks.length === 3 && new Set(marks).size === 2, markInfo.join(' | '));
    check('Clip list shows this chapter', (await page.textContent('#auChapter')) === 'Chapter 1: Nine Point Eight' && (await page.locator('#auClips .au-clip').count()) === 3);
    await shot('a2-voiced.png');

    section('Edit voiced text → out of date → redo');
    await js(() => { const a = Editor.text.indexOf('Finch said quietly'); Editor.ta.focus(); Editor.ta.setSelectionRange(a + 'Finch said '.length, a + 'Finch said quietly'.length); document.execCommand('insertText', false, 'softly'); });
    await wait(700);
    check('Edited clip marked out of date', (await js(() => Audiobook.data().clips.filter((c) => Audiobook.stale(c)).length)) === 1);
    check('Dashed underline on changed words', (await page.locator('#hlBackdrop mark.hl-au-stale').count()) >= 1);
    check('Redo button offered', (await page.textContent('#auStale')).includes('1 out-of-date'));
    ttsCalls.length = 0;
    await page.click('#auStale');
    await until(() => !Audiobook.busy && Audiobook.data().clips.every((c) => c.status === 'ok' && !Audiobook.stale(c)));
    check('Regenerated with the new words', ttsCalls.length === 1 && ttsCalls[0].text === 'Finch said softly.', JSON.stringify(ttsCalls));
    check('Old file replaced, not piled up', (await js(LIST, ['Drive', 'Books', 'Oakvale', 'Oakvale Test.crucible', 'audio'])).length === 3);

    section('Record a line yourself');
    const meId = await js(() => Audiobook.data().actors[2].id);
    const line = '“Lock the back door,” Wade said.';
    await js((t) => { const a = Editor.text.indexOf(t); Editor.ta.focus(); Editor.ta.setSelectionRange(a, a + t.length); Audiobook.renderSelection(); }, line);
    await page.selectOption('#auActorPick', meId);
    await page.click('#auVoice');
    await page.waitForSelector('.rec-modal');
    check('Recorder shows the line', (await page.textContent('.rec-line')).includes('Lock the back door'));
    await page.click('.rec-btns button:has-text("Record")');
    await wait(900);
    await page.click('.rec-btns button:has-text("Stop")');
    await page.waitForSelector('.rec-btns button:has-text("Keep"):not([disabled])');
    await shot('a3-recorder.png');
    await page.click('.rec-btns button:has-text("Keep")');
    await wait(500);
    const mic = await js((id) => Audiobook.data().clips.filter((c) => c.actorId === id).map((c) => ({ st: c.status, file: c.file, dur: c.dur })), meId);
    check('Microphone take kept as a clip', mic.length === 1 && mic[0].st === 'ok' && /\.(webm|ogg)$/.test(mic[0].file) && mic[0].dur > 0.3, JSON.stringify(mic));
    // The rest of that selection (narration) went to the narrator's AI voice.
    check('Narration around it still voiced by the Narrator', (await js(() => Audiobook.data().clips.length)) === 5);
    if (await page.isVisible('.rec-modal')) await page.click('.modal footer button:has-text("Finish")');

    section('Save keeps the cast and clips');
    await js(() => App.save());
    await wait(500);
    const pj = JSON.parse(await js(async () => {
      let d = await navigator.storage.getDirectory();
      for (const n of ['Drive', 'Books', 'Oakvale', 'Oakvale Test.crucible']) d = await d.getDirectoryHandle(n);
      return (await (await d.getFileHandle('project.json')).getFile()).text();
    }));
    check('project.json has actors, clips and pronunciation list', pj.audio?.actors.length === 3 && pj.audio.clips.length === 5 && pj.audio.lexicon.length === 2);

    section('Export');
    await js(() => { Editor.ta.setSelectionRange(0, 0); Audiobook.renderClips(); });
    await page.click('#auExport');
    await wait(300);
    const cov = await page.textContent('.au-cov');
    check('Coverage table lists chapters', cov.includes('Chapter 1: Nine Point Eight') && cov.includes('Chapter 2: Cover'));
    await shot('a4-export.png');
    await page.click('.modal footer button.accent');
    await until(() => /Done|✕/.test(document.querySelector('.au-exmsg')?.textContent || ''), 60000);
    const msg = await page.textContent('.au-exmsg');
    check('Export finished', msg === 'Done.', msg);
    const outDir = ['Drive', 'Books', 'Oakvale', 'Oakvale Test audiobook'];
    const made = await js(LIST, outDir);
    check('One MP3 per chapter plus the full book', made.map((f) => f.name).sort().join('|') === '01 - Chapter 1 Nine Point Eight.mp3|02 - Chapter 2 Cover.mp3|Oakvale Test - Full book.mp3', made.map((f) => f.name).join('|'));
    const head = await js(READ, [...outDir, '01 - Chapter 1 Nine Point Eight.mp3']);
    check('MP3 data (frame sync)', head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    const sizes = Object.fromEntries(made.map((f) => [f.name, f.size]));
    check('Full book = chapters joined', sizes['Oakvale Test - Full book.mp3'] === sizes['01 - Chapter 1 Nine Point Eight.mp3'] + sizes['02 - Chapter 2 Cover.mp3']);
    const report = await page.locator('.au-cov').last().textContent();
    check('Levels report says ACX ✓', (report.match(/✓/g) || []).length >= 2, report);
    await shot('a5-exported.png');
    // Decode the chapter and check its levels independently.
    const lv = await js(async (parts) => {
      let d = await navigator.storage.getDirectory();
      const ps = [...parts]; const n = ps.pop();
      for (const p of ps) d = await d.getDirectoryHandle(p);
      const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await (await (await d.getFileHandle(n)).getFile()).arrayBuffer());
      const x = buf.getChannelData(0);
      let s = 0, pk = 0, quiet = 0;
      for (let i = 0; i < x.length; i++) { s += x[i] * x[i]; pk = Math.max(pk, Math.abs(x[i])); }
      for (let i = 0; i < 22050; i++) quiet += x[i] * x[i];
      return { secs: buf.duration, rms: 20 * Math.log10(Math.sqrt(s / x.length)), peak: 20 * Math.log10(pk), floor: 20 * Math.log10(Math.sqrt(quiet / 22050)) };
    }, [...outDir, '01 - Chapter 1 Nine Point Eight.mp3']);
    check('Chapter levels within ACX range', lv.rms >= -23 && lv.rms <= -18 && lv.peak <= -2.8 && lv.floor < -60 && lv.floor > -90, JSON.stringify(lv));
    await page.click('.modal footer button:has-text("Close")');
    await js(() => { const a = Editor.text.indexOf('The office'); Editor.ta.setSelectionRange(a, a); Audiobook.renderClips(); });
    await page.click('#auExport');
    await wait(300);
    await page.selectOption('.modal select >> nth=1', 'wav');
    await page.selectOption('.modal select >> nth=0', 'chapter');
    await page.click('.modal footer button.accent');
    await until(() => /Done|✕/.test(document.querySelector('.au-exmsg')?.textContent || ''), 60000);
    const wavHead = await js(READ, [...outDir, '01 - Chapter 1 Nine Point Eight.wav']);
    const dataLen = wavHead[40] | (wavHead[41] << 8) | (wavHead[42] << 16) | (wavHead[43] << 24);
    check('WAV master: header length matches the file', String.fromCharCode(...wavHead.slice(0, 4)) === 'RIFF' && dataLen + 44 === wavHead[64], `${dataLen + 44} vs ${wavHead[64]}`);
    await page.click('.modal footer button:has-text("Close")');
    await js(() => App.save());
    await wait(400);
    section('Settings');
    await js(async () => {
      const cur = await window.crucible.getSettings();
      await window.crucible.saveSettings({ providers: [...cur.providers.map((p) => ({ ...p })), { id: 'bad', name: 'Gemini TTS copy', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.8-flash-tts' }], activeProviderId: 'chat1' });
      Object.assign(S.settings, await window.crucible.getSettings());
    });
    await page.click('#btnSettings').catch(() => {});
    await wait(400);
    const st = await page.textContent('.modal').catch(() => '');
    check('Settings shows the voice service card', st.includes('Gemini TTS') && st.includes('🎙 Voices'));
    check('A voice model on a writing card is flagged', st.includes('is a voice model, but this card is set up as a writing AI'));
    await page.click('.modal button:has-text("Make this a voice service")');
    await wait(200);
    check('One click turns it into a voice service', (await page.locator('.modal .au-tag').count()) === 2 && !(await page.textContent('.modal')).includes('is a voice model, but'));
    await page.locator('.prov-card').nth(1).scrollIntoViewIfNeeded().catch(() => {});
    await shot('a6-settings.png');
    await page.keyboard.press('Escape');
    section('Errors');
    check('No page errors', errors.length === 0, errors.join(' | '));
  } catch (e) {
    console.error(e);
    results.push(false);
    await shot('zz-failure.png').catch(() => {});
  } finally {
    await app.close().catch(() => {});
    files.close(); tts.close();
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed. Output: ${OUT}`);
  process.exit(passed === results.length ? 0 : 1);
})();
