// Deterministic regression checks for saves and navigation. No API keys/network.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const ROOT = path.join(__dirname, '..');
function setup() {
  const nodes = new Map(); let modal; const messages = [];
  const ctx = { console, structuredClone, Date, setTimeout, clearTimeout,
    window: { addEventListener() {}, crucible: { setDirty() {}, setTitle() {}, saveBook: async () => ({ savedAt: 42 }) } },
    $: id => { if (!nodes.has(id)) nodes.set(id, { textContent: '', title: '', dataset: {}, classList: { toggle() {} } }); return nodes.get(id); },
    baseName: p => p.split('/').pop(), toast: x => messages.push(x),
    el: () => ({}), openModal: o => { modal = o; },
    AI: { busy: false }, Prose: { running: false },
    Memory: { cache: {} }, BookImages: { clear() {} }, Goals: {}, Speech: { stop() {} },
    Editor: { text: 'before', setText(t) { this.text=t; } },
  };
  vm.createContext(ctx);
  for (const name of ['state', 'app']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js',name+'.js'),'utf8'),ctx);
  vm.runInContext('globalThis.S=S;globalThis.App=App;S.path="/books/test.md";S.project=blankProject();App.renderAll=()=>{};',ctx);
  return {ctx, nodes, messages, get modal(){return modal;}};
}
const tick = () => new Promise(r=>setImmediate(r));
(async()=>{
  let t=setup(),c=t.ctx,resolve,writes=0;
  c.markDirty();
  c.window.crucible.saveBook=async args=>{writes++;assert.equal(args.text,'before');return new Promise(r=>resolve=r);};
  const saving=c.App.save();assert.equal(c.S.saving,true);assert.equal(c.App.save(),saving);assert.equal(writes,1);
  c.Editor.text='after';c.S.project.notes.push({body:'new note'});c.markDirty();
  resolve({savedAt:42});assert.equal(await saving,true);assert.equal(c.S.dirty,true);assert.equal(c.S.saving,false);
  c.window.crucible.saveBook=async args=>{assert.equal(args.text,'after');return {savedAt:43};};
  await c.App.save();assert.equal(c.S.dirty,false);assert.equal(c.S.lastSaved,43);
  console.log('PASS: changes during a save remain unsaved; duplicate writes are prevented; retry saves newest text');

  t=setup();c=t.ctx;c.markDirty();let snapshot;
  c.window.crucible.saveBook=async args=>{snapshot=args.project;return new Promise(r=>resolve=r);};
  const pending=c.App.save();c.S.project.notes.push({body:'later'});c.markDirty();
  assert.equal(snapshot.notes.length,0);resolve({savedAt:50});await pending;assert.equal(c.S.dirty,true);
  console.log('PASS: companion data is saved from an independent snapshot');

  t=setup();c=t.ctx;c.markDirty();c.window.crucible.saveBook=async()=>{throw Error('drive unplugged');};
  assert.equal(await c.App.save(),false);assert.equal(c.S.dirty,true);assert.match(t.nodes.get('#stDirty').textContent,/Save failed/);
  c.S.path=null;c.window.crucible.saveBookAs=async()=>null;
  assert.equal(await c.App.saveAs(),false);assert.equal(c.S.dirty,true);
  c.window.crucible.saveBookAs=async()=>{throw Error('permission denied');};
  assert.equal(await c.App.saveAs(),false);assert.equal(c.S.saving,false);
  console.log('PASS: failed saves and canceled Save as preserve unsaved work');

  t=setup();c=t.ctx;c.markDirty();let opened=0;
  c.window.crucible.openBookPath=async p=>{opened++;return {path:p,text:'other',project:{}};};
  let nav=c.App.openPath('/books/other.md');await tick();t.modal.onClose();await nav;assert.equal(opened,0);
  nav=c.App.openPath('/books/other.md');await tick();await t.modal.buttons[2].onClick();await nav;assert.equal(opened,1);assert.equal(c.S.path,'/books/other.md');
  console.log('PASS: recent-book navigation respects Cancel and Save and continue');

  t=setup();c=t.ctx;c.AI.busy=true;assert.equal(await c.App.confirmDiscard(),false);
  c.AI.busy=false;c.Prose.running=true;assert.equal(await c.App.confirmDiscard(),false);
  c.Prose.running=false;c.markDirty();nav=c.App.confirmDiscard();await tick();t.modal.buttons[1].onClick();assert.equal(await nav,true);
  console.log('PASS: active AI work blocks book switches; explicit discard is available');

  t=setup();c=t.ctx;c.markDirty();c.window.crucible.saveBook=()=>new Promise(r=>resolve=r);
  const late=c.App.save();const other={notes:[],meta:{}};c.S.project=other;c.S.path='/books/other.md';resolve({savedAt:90});
  assert.equal(await late,false);assert.equal(c.S.lastSaved,null);assert.equal(c.S.path,'/books/other.md');
  console.log('PASS: a late save cannot mark a different book saved');
})().catch(e=>{console.error(e);process.exitCode=1;});

// HTML parsing normalizes line endings before CSP checks, including on Windows.
{
  const fs = require('fs'), path = require('path'), crypto = require('crypto');
  const html = fs.readFileSync(path.join(__dirname, '../dist-web/crucible.html'), 'utf8').replace(/\r\n?/g, '\n');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert(scripts.length > 20);
  for (const [, code] of scripts) {
    const hash = crypto.createHash('sha256').update(code, 'utf8').digest('base64');
    assert(policy.includes("'sha256-" + hash + "'"), 'Browser-normalized script must match its CSP hash');
  }
  console.log('PASS: all browser-normalized inline scripts match the security policy');
}
