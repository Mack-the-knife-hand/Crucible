// Unit tests for the text-tracking logic (node test/unit.js)
const assert = require('assert');
const { TextOps, diffWordsHtml } = require('../src/js/util.js');

// Simulate an anchored passage through a series of edits.
function edit(text, r, start, end, ins) {
  const next = text.slice(0, start) + ins + text.slice(end);
  const ch = TextOps.changedRegion(text, next);
  return { text: next, r: TextOps.shiftRange(r, ch) };
}
let t = 'The dust rolled over Oakvale. Wade watched the road. Judy said nothing.';
const target = 'Wade watched the road.';
let r = { start: t.indexOf(target), end: t.indexOf(target) + target.length };

// 1. typing before the passage shifts it
({ text: t, r } = edit(t, r, 0, 0, 'In 1952, '));
assert.strictEqual(t.slice(r.start, r.end), target, 'insert before');
// 2. typing after doesn't move it
({ text: t, r } = edit(t, r, t.length, t.length, ' The end.'));
assert.strictEqual(t.slice(r.start, r.end), target, 'insert after');
// 3. deleting before shifts it back
({ text: t, r } = edit(t, r, 0, 9, ''));
assert.strictEqual(t.slice(r.start, r.end), target, 'delete before');
// 4. editing inside stretches it
const inside = t.indexOf('watched');
({ text: t, r } = edit(t, r, inside, inside + 'watched'.length, 'stared down'));
assert.strictEqual(t.slice(r.start, r.end), 'Wade stared down the road.', 'edit inside');
// 5. typing right at its start doesn't swallow the new text
({ text: t, r } = edit(t, r, r.start, r.start, 'Old '));
assert.strictEqual(t.slice(r.start, r.end), 'Wade stared down the road.', 'insert at start boundary');
// 6. replacing a word adjacent to the passage (same chars) still works
({ text: t, r } = edit(t, r, 0, 3, 'A'));
assert.strictEqual(t.slice(r.start, r.end), 'Wade stared down the road.', 'replace at doc start');

// locate(): prefers stored offset, else nearest duplicate
const doc = 'He nodded. Later. He nodded. Much later. He nodded.';
const second = doc.indexOf('He nodded.', 5);
assert.strictEqual(TextOps.locate(doc, { text: 'He nodded.', start: second }), second);
assert.strictEqual(TextOps.locate(doc, { text: 'He nodded.', start: second + 3 }), second, 'nearest duplicate');
assert.strictEqual(TextOps.locate(doc, { text: 'missing', start: 0 }), null);

// outline
const md = '# Book One\n\nIntro words here.\n\n## Chapter 1: Dust\n\nOne two three.\n\n### Scene\n\nFour five.\n';
const ol = TextOps.outline(md);
assert.deepStrictEqual(ol.map((h) => [h.level, h.title]), [[1, 'Book One'], [2, 'Chapter 1: Dust'], [3, 'Scene']]);
assert.strictEqual(ol[1].words, 3);

// paragraphAt
const p = TextOps.paragraphAt('A one.\n\nB two.\n\nC three.', 10);
assert.strictEqual('A one.\n\nB two.\n\nC three.'.slice(p.start, p.end), 'B two.');

// diff
const d = diffWordsHtml('Wade watched the road.', 'Wade stared down the road.');
assert.ok(/<del>watched\s*<\/del><ins>stared down\s*<\/ins>/.test(d), d);

console.log('All unit tests passed');

// ---------------------------------------------------- AI insert / change --
{
  const book = '# Oakvale\n\nA novel.\n\n## Chapter One: Dust\n\nThe dust rolled over Oakvale.\n\n## Chapter Two: The Observer\n\nCross arrived on a “Tuesday”.\n';
  const ins = (anchor, position, content) => {
    const at = TextOps.findAnchor(book, anchor, []);
    assert.ok(at, 'anchor found: ' + anchor);
    const r = TextOps.blockInsert(book, at, position, content);
    return book.slice(0, r.pos) + r.insert + book.slice(r.pos);
  };
  // Epigraph before the first chapter heading
  const ep = '> *The past is never dead.*\n>\n> — Faulkner';
  let out = ins('## Chapter One: Dust', 'before', ep);
  assert.ok(out.includes('A novel.\n\n' + ep + '\n\n## Chapter One: Dust'), out);
  // Heading given without #'s
  out = ins('Chapter One: Dust', 'before', ep);
  assert.ok(out.includes(ep + '\n\n## Chapter One: Dust'));
  // After a heading
  out = ins('## Chapter Two: The Observer', 'after', 'New opening line.');
  assert.ok(out.includes('## Chapter Two: The Observer\n\nNew opening line.\n\nCross arrived'), out);
  // After a quoted paragraph (curly quotes in book, straight in anchor)
  out = ins('Cross arrived on a "Tuesday".', 'after', 'He stayed.');
  assert.ok(out.endsWith('“Tuesday”.\n\nHe stayed.\n'), JSON.stringify(out.slice(-40)));
  // Start / end
  out = ins('start', 'before', 'For Dad.');
  assert.ok(out.startsWith('For Dad.\n\n# Oakvale'));
  out = ins('end', 'after', 'THE END');
  assert.ok(out.endsWith('Tuesday”.\n\nTHE END\n'), JSON.stringify(out.slice(-30)));
  // Loose find for changes (spacing + quote differences)
  const f = TextOps.findLoose(book, 'The dust  rolled over\nOakvale.');
  assert.strictEqual(book.slice(f.start, f.end), 'The dust rolled over Oakvale.');
  assert.strictEqual(TextOps.findAnchor(book, 'nonexistent words here', []), null);
}
console.log('Insert/change tests passed');

// ------------------------------------------------------ story memory limit --
{
  const SC = require('../src/js/settings-core.js');
  assert.strictEqual(SC.migrateSettings({}).memoryLimit, 120000, 'default 120k');
  assert.strictEqual(SC.migrateSettings({ memoryLimit: 5e6 }).memoryLimit, 2000000, 'capped at 2M');
  assert.strictEqual(SC.migrateSettings({ memoryLimit: 500 }).memoryLimit, 10000, 'floor 10k');
  assert.strictEqual(SC.migrateSettings({ memoryLimit: 'abc' }).memoryLimit, 120000, 'junk → default');
  assert.strictEqual(SC.migrateSettings({ memoryLimit: 750000 }).memoryLimit, 750000);
  const f = SC.portableSettings(SC.migrateSettings({ memoryLimit: 900000 }));
  assert.strictEqual(f.memoryLimit, 900000, 'travels in settings file');
  assert.strictEqual(SC.mergeImported(SC.migrateSettings({}), f).next.memoryLimit, 900000, 'restored on import');
}
console.log('Memory limit tests passed');

// --------------------------------------------------------- chapter builder --
{
  const { ChapterOps: C } = require('../src/js/util.js');
  const book = '# Oakvale\n\n> *Epigraph.*\n\n## Chapter One: Dust\n\nDust text.\n\n### A scene\n\nScene text.\n\n## Chapter Two: The Observer\n\nCross text.\n\n## Chapter Three: Rain\n\nRain text.';
  assert.strictEqual(C.detectLevel(book), 2);
  const m = () => C.parse(book, 2);
  // Unchanged → identical
  assert.strictEqual(C.build(m()), book, 'round trip unchanged');
  let x = m();
  assert.strictEqual(x.chapters.length, 3);
  assert.ok(x.chapters[0].rest.includes('### A scene'), 'scenes stay inside chapter');
  // Rename
  x.chapters[1].title = 'Chapter Two: The Watcher';
  assert.ok(C.build(x).includes('## Chapter Two: The Watcher\n\nCross text.'));
  // Image add / remove
  x = m(); x.chapters[0].image = 'images/chapter-a b.png';
  let out = C.build(x);
  assert.ok(out.includes('## Chapter One: Dust\n\n![chapter-image](images/chapter-a%20b.png)\n\nDust text.'), out);
  let y = C.parse(out, 2);
  assert.strictEqual(y.chapters[0].image, 'images/chapter-a b.png', 'image read back');
  y.chapters[0].image = null;
  assert.strictEqual(C.build(y), book, 'image removed cleanly');
  // Reorder: last chapter (no trailing newline) moved to the front
  x = m(); x.chapters.unshift(x.chapters.pop());
  out = C.build(x);
  assert.ok(out.includes('## Chapter Three: Rain\n\nRain text.\n\n## Chapter One: Dust'), JSON.stringify(out));
  // Delete
  x = m(); x.chapters.splice(1, 1);
  assert.ok(!C.build(x).includes('Cross text'));
  // Merge (remove heading, keep text)
  x = m(); C.mergeIntoPrevious(x, 1);
  out = C.build(x);
  assert.ok(out.includes('Scene text.\n\nCross text.\n\n## Chapter Three') && !out.includes('Chapter Two'), JSON.stringify(out));
  // New chapter at end
  x = m(); x.chapters.push(C.newChapter('Chapter Four: Fire'));
  out = C.build(x);
  assert.ok(out.endsWith('Rain text.\n\n## Chapter Four: Fire\n\n'), JSON.stringify(out.slice(-40)));
  // Numbering
  assert.strictEqual(C.numbered('Chapter One: Dust', 1, 'chapter-num'), 'Chapter 1: Dust');
  assert.strictEqual(C.numbered('Chapter 12 - Rain', 21, 'chapter-word'), 'Chapter Twenty-One: Rain');
  assert.strictEqual(C.numbered('3. Fire', 4, 'num'), '4. Fire');
  assert.strictEqual(C.numbered('One Night in Oakvale', 2, 'chapter-num'), 'Chapter 2: One Night in Oakvale', 'title words are not numbers');
  assert.strictEqual(C.numbered('Chapter Five', 5, 'none'), 'Chapter 5');
  // Level 1 books
  const b1 = '# One\n\nA.\n\n# Two\n\nB.\n';
  assert.strictEqual(C.detectLevel(b1), 1);
  assert.strictEqual(C.parse(b1, 1).chapters.length, 2);
}
console.log('Chapter builder tests passed');

// ------------------------------------------------------------- alignment --
{
  const { Align } = require('../src/js/util.js');
  const t = 'Para one.\n\nThe End\n\nPara three.';
  const pos = t.indexOf('End');
  let p = Align.plan(t, pos, pos, 'center');
  let out = t.slice(0, p.from) + p.insert + t.slice(p.to);
  assert.strictEqual(out, 'Para one.\n\n::: center\nThe End\n:::\n\nPara three.');
  assert.strictEqual(out.slice(p.selStart, p.selEnd), 'The End');
  // switch to right
  p = Align.plan(out, out.indexOf('End'), out.indexOf('End'), 'right');
  out = out.slice(0, p.from) + p.insert + out.slice(p.to);
  assert.ok(out.includes('::: right\nThe End\n:::'));
  // back to left removes the block
  p = Align.plan(out, out.indexOf('End'), out.indexOf('End'), 'left');
  out = out.slice(0, p.from) + p.insert + out.slice(p.to);
  assert.strictEqual(out, t);
  // multi-paragraph selection
  p = Align.plan(t, 2, t.length - 2, 'center');
  out = t.slice(0, p.from) + p.insert + t.slice(p.to);
  assert.strictEqual(out, '::: center\nPara one.\n\nThe End\n\nPara three.\n:::');
  assert.ok(Align.plan(t, pos, pos, 'left').error, 'already left');
  assert.ok(Align.plan('## Chapter\n\nx', 3, 3, 'center').error, 'headings refused');
  // to HTML keeps inner markdown
  assert.strictEqual(Align.toHtmlMd('::: center\n*The End*\n:::'), '<div class="align-center">\n\n*The End*\n\n</div>');
  const { countWords } = require('../src/js/util.js');
  assert.strictEqual(countWords('::: center\nThe End\n:::'), 2);
}
console.log('Alignment tests passed');
{
  const { Align } = require('../src/js/util.js');
  const t = 'Para.\n\nThe End\n';
  const p = Align.plan(t, t.indexOf('End'), t.indexOf('End'), 'center');
  assert.strictEqual(t.slice(0, p.from) + p.insert + t.slice(p.to), 'Para.\n\n::: center\nThe End\n:::\n');
}
console.log('Alignment end-of-book test passed');

// ------------------------------------------------------- scenes / corkboard --
{
  const { SceneOps: Sc, ChapterOps: C } = require('../src/js/util.js');
  const book = '# Book\n\n## One\n\nOpening.\n\n### Scene A\n\nA text.\n\n***\n\nBreak text.\n\n## Two\n\nTwo text.\n\n* * *\n\nTwo B.\n';
  let m = Sc.board(book);
  assert.deepStrictEqual(m.chapters.map((c) => c.scenes.map((s) => s.kind)), [['intro', 'heading', 'break'], ['intro', 'break']]);
  assert.strictEqual(Sc.buildBoard(m), book, 'unchanged board round-trips');
  // move "Break text" scene to start of chapter Two
  m = Sc.board(book);
  const sc = m.chapters[0].scenes.splice(2, 1)[0];
  m.chapters[1].scenes.unshift(sc);
  let out = Sc.buildBoard(m);
  assert.ok(out.includes('## One\n\nOpening.\n\n### Scene A\n\nA text.\n\n## Two\n\nBreak text.\n\n***\n\nTwo text.\n\n* * *\n\nTwo B.'), JSON.stringify(out));
  // meta
  m = Sc.board(book);
  Sc.setMeta(m.chapters[0].scenes[1], { when: '1952-06-14', summary: 'He "finds" it', track: 'Past' });
  out = Sc.buildBoard(m);
  assert.ok(out.includes('### Scene A\n\n<!-- scene when="1952-06-14" track="Past" summary="He &quot;finds&quot; it" -->\n\nA text.'), JSON.stringify(out));
  const m2 = Sc.board(out);
  assert.deepStrictEqual(m2.chapters[0].scenes[1].meta, { when: '1952-06-14', track: 'Past', summary: 'He "finds" it', color: '' });
  Sc.setMeta(m2.chapters[0].scenes[1], { when: '', summary: '', track: '' });
  assert.strictEqual(Sc.buildBoard(m2), book, 'removing meta restores text');
  // dates
  assert.ok(Sc.dateKey('1952-06-14') > Sc.dateKey('1952-06') && Sc.dateKey('2078') > Sc.dateKey('1952-12-31'));
  assert.ok(Sc.dateKey('June 14, 1952') === Sc.dateKey('1952-06-14'));
  assert.ok(Sc.dateKey('Day 3') < Sc.dateKey('Day 12'));
  assert.strictEqual(Sc.dateKey('someday'), null);
  assert.strictEqual(Sc.breakStyle(book), '***');
  const { countWords } = require('../src/js/util.js');
  assert.strictEqual(countWords('<!-- scene summary="many words here" -->\nTwo words'), 2);
}
console.log('Scene tests passed');

// ------------------------------------------------------------- data import --
{
  const { DataImport: D } = require('../src/js/dataimport.js');
  const csv = 'Name,Age,Notes\r\n"Ada, Countess",36,"Says ""hello""\nand leaves"\r\nBob,40,\r\n';
  const g = D.parseDelimited(csv);
  assert.strictEqual(g[0].records.length, 2);
  assert.strictEqual(g[0].records[0].Name, 'Ada, Countess');
  assert.strictEqual(g[0].records[0].Notes, 'Says "hello"\nand leaves');
  assert.strictEqual(D.parseDelimited('a\tb\n1\t2\n')[0].records[0].b, '2', 'TSV');
  const j = D.parseJson('{"characters":[{"name":"Ada","traits":{"eyes":"grey"},"tags":["a","b"]}],"places":[{"title":"Mill"}]}');
  assert.deepStrictEqual(j.map((x) => x.group), ['characters', 'places']);
  assert.strictEqual(j[0].records[0]['traits.eyes'], 'grey');
  assert.strictEqual(j[0].records[0].tags, 'a, b');
  assert.strictEqual(D.titleKey(j[1].records), 'title');
  const md = D.toMarkdown('characters', j[0].records, 'name');
  assert.ok(md.startsWith('# characters\n\n## Ada\n- **traits.eyes:** grey'), md);
  assert.strictEqual(D.parseJson('{"Ada":{"age":3}}')[0].records[0].name, 'Ada');
}
console.log('Data import tests passed');
{
  const { SceneOps: Sc } = require('../src/js/util.js');
  const m = Sc.board('## One\n\n::: center\nThe End\n:::\n');
  assert.strictEqual(Sc.label(m.chapters[0].scenes[0]), 'The End');
}
console.log('Scene label test passed');
// ---- Settings: AI addresses from a file need your OK, every time (1.9.2)
{
  const C = require('../src/js/settings-core.js');
  const mine = C.migrateSettings({ providers: [{ id: 'p1', name: 'Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk' }], activeProviderId: 'p1' });
  const folder = { crucibleSettings: true, providers: [{ id: 'p1', name: 'Claude', type: 'anthropic', baseUrl: 'https://evil.example' }], activeProviderId: 'p1' };
  // Rejected, then the folder is reconnected: still not applied, asked again.
  const kept = C.mergeImported(mine, folder, { replace: true });
  const again = C.mergeImported(kept.next, folder, { replace: true });
  assert.strictEqual(kept.next.providers[0].baseUrl, 'https://api.anthropic.com');
  assert.strictEqual(again.next.providers[0].baseUrl, 'https://api.anthropic.com');
  assert.strictEqual(again.endpointChanges.length, 1);
  assert.strictEqual(again.next.providers[0].apiKey, 'sk');
  // A different folder with only other AIs: yours stay while it waits / after "Keep".
  const other = { crucibleSettings: true, providers: [{ id: 'x9', name: 'Other', type: 'openai', baseUrl: 'https://other.example/v1' }], activeProviderId: 'x9' };
  const held = C.mergeImported(mine, other, { replace: true });
  assert.deepStrictEqual(held.next.providers.map((p) => p.id), ['p1']);
  assert.strictEqual(held.next.activeProviderId, 'p1');
  const used = C.mergeImported(mine, other, { replace: true, endpoints: 'apply' });
  assert.deepStrictEqual(used.next.providers.map((p) => p.id), ['x9']);
  assert.strictEqual(used.next.activeProviderId, 'x9');
  // Same addresses: your own folder still syncs without asking.
  const same = C.mergeImported(mine, { crucibleSettings: true, providers: [{ id: 'p1', name: 'Claude 2', type: 'anthropic', baseUrl: 'https://API.anthropic.com/' }], ui: { theme: 'light' } }, { replace: true });
  assert.strictEqual(same.endpointChanges.length, 0);
  assert.strictEqual(same.next.providers[0].name, 'Claude 2');
  // The active AI is never left pointing at a provider that doesn't exist.
  const gone = C.mergeImported(mine, { crucibleSettings: true, providers: [{ id: 'p1', name: 'Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com' }], activeProviderId: 'nope' }, { replace: true });
  assert.strictEqual(gone.next.activeProviderId, 'p1');
}
console.log('Endpoint approval tests passed');
// ---- audit:shipped never reports "clean" when it couldn't check (1.9.2)
{
  const { spawnSync } = require('child_process');
  const path = require('path');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'audit-shipped.js')], {
    env: { ...process.env, npm_config_registry: 'http://127.0.0.1:9/', npm_config_fetch_retries: '0' }, encoding: 'utf8', timeout: 120000,
  });
  assert.strictEqual(r.status, 2, `expected exit 2 when the registry is unreachable, got ${r.status}\n${r.stdout}`);
  assert.ok(/NOT VERIFIED/.test(r.stdout) && !/All shipped components check out/.test(r.stdout), r.stdout);
}
console.log('Audit honesty test passed');
