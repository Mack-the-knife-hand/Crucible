// Unit tests for the Audiobook studio's pure helpers (node test/audio-unit.js)
const assert = require('assert');
const A = require('../src/js/audioscript.js');

const pieces = (text, opts) => A.segment(text, 0, text.length, opts).map((g) => [g.kind, text.slice(g.start, g.end)]);

// ---- dialogue vs narration
{
  const t = '“Duw, Mack,” Finch said quietly. “Come into the kitchen, bach.”';
  assert.deepStrictEqual(pieces(t), [
    ['dialogue', '“Duw, Mack,”'],
    ['narration', 'Finch said quietly.'],
    ['dialogue', '“Come into the kitchen, bach.”'],
  ]);
  // Whole selection to one actor: one piece per paragraph.
  assert.deepStrictEqual(pieces(t, { split: false }), [['narration', t]]);
}
// Straight quotes, punctuation-only gaps dropped, open quote runs to paragraph end.
{
  const t = '"Morning," she said. "You want coffee?"\n\n"I\'ll take it black.\n\nAnd tell Maud."';
  const p = pieces(t);
  assert.deepStrictEqual(p[0], ['dialogue', '"Morning,"']);
  assert.deepStrictEqual(p[1], ['narration', 'she said.']);
  assert.deepStrictEqual(p[2], ['dialogue', '"You want coffee?"']);
  assert.deepStrictEqual(p[3], ['dialogue', '"I\'ll take it black.']);
  assert.strictEqual(p.length, 5);
  assert.strictEqual(p[4][0], 'narration'); // a continued speech without an opening mark reads as narration
}
// Headings, scene breaks, images and alignment fences.
{
  const t = '## Chapter 1: Nine Point Eight\n\n![chapter-image](images/c1.png)\n\n*Thursday, March 12, 1964*\n\nThe office smelled of gun oil.\n\n* * *\n\n::: center\nThe End\n:::';
  const p = pieces(t);
  assert.deepStrictEqual(p.map((x) => x[1]), ['## Chapter 1: Nine Point Eight', '*Thursday, March 12, 1964*', 'The office smelled of gun oil.', 'The End']);
  assert.ok(p.every((x) => x[0] === 'narration'));
}
// A selection that starts mid-paragraph keeps quote state.
{
  const t = 'Wade said, “Lock the back door, June bug.” She didn’t.';
  const from = t.indexOf('Lock');
  const segs = A.segment(t, from, t.length);
  assert.strictEqual(segs[0].kind, 'dialogue');
  assert.strictEqual(t.slice(segs[0].start, segs[0].end), 'Lock the back door, June bug.”');
  assert.strictEqual(t.slice(segs[1].start, segs[1].end), 'She didn’t.');
}
// Long pieces split at sentence ends.
{
  const s = 'This is one sentence of the book. ';
  const t = s.repeat(120).trim();
  const segs = A.segment(t, 0, t.length, { max: 500 });
  assert.ok(segs.length >= 8);
  assert.ok(segs.every((g) => g.end - g.start <= 500));
  assert.ok(segs.every((g) => /\.$/.test(t.slice(g.start, g.end))));
  assert.strictEqual(segs.map((g) => t.slice(g.start, g.end)).join(' '), t);
}
console.log('Audio segmenting tests passed');

// ---- what the voice receives
{
  const lex = [{ from: 'Mamgu', to: 'Mam-ghee' }, { from: 'Duw', to: 'Dee-oo', matchCase: true }];
  assert.strictEqual(A.spoken('“Duw, duw,” said *Mamgu*.', lex), 'Dee-oo, duw, said Mam-ghee.');
  assert.strictEqual(A.applyLexicon('Mamgu’s kitchen, mamgu, Mamguish', lex), 'Mam-ghee’s kitchen, Mam-ghee, Mamguish');
  assert.strictEqual(A.spoken('[Wade](x) <!-- hidden --> said ~~no~~.', []), 'Wade said no.');
}
// ---- pauses and chapters
{
  const t = 'One. Two.\n\nThree.\n\n* * *\n\nFour.';
  assert.strictEqual(A.gapAfter(t, 4, 5), 'inline');
  assert.strictEqual(A.gapAfter(t, 9, 11), 'para');
  assert.strictEqual(A.gapAfter(t, 17, t.indexOf('Four')), 'scene');
  const book = '# Oakvale 1964\n\nEpigraph.\n\n## Chapter 1: Nine Point Eight\n\nText.\n\n## Chapter 2: Cover\n\nMore.';
  const ch = A.chapters(book);
  assert.deepStrictEqual(ch.map((c) => [c.n, c.title]), [[0, 'Opening'], [1, 'Chapter 1: Nine Point Eight'], [2, 'Chapter 2: Cover']]);
  assert.strictEqual(ch[2].end, book.length);
  assert.strictEqual(A.fileSafe('01 - What: Finch/Knew?'), '01 - What FinchKnew');
  assert.strictEqual(A.clock(3725), '1:02:05');
}
console.log('Audio pause and chapter tests passed');

// ---- mastering
{
  const M = A.Master;
  const x = new Float32Array(44100);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(i / 10) * 0.99;
  M.limit(x, -3.5);
  const peak = M.stats(x).peak;
  assert.ok(M.db(peak) <= -3.49, `limited peak ${M.db(peak)}`);
  const quiet = new Float32Array(100).fill(0.1);
  assert.strictEqual(M.limit(quiet, -3.5)[0], Math.fround(0.1), 'quiet audio untouched');
  const padded = new Float32Array(44100);
  padded.fill(0.5, 20000, 21000);
  const tr = M.trim(padded);
  assert.ok(tr.length < 5000 && tr.length >= 1000);
  const wav = M.pcmToWav(new Uint8Array(4800), 24000);
  assert.ok(M.isWav(wav));
  assert.strictEqual(new DataView(wav.buffer).getUint32(24, true), 24000);
  const n = M.noise(3)(44100, -72);
  const rms = Math.sqrt(M.stats(n).sumSq / n.length);
  assert.ok(M.db(rms) < -62 && M.db(rms) > -80, `room tone ${M.db(rms)}`);
}
console.log('Audio mastering tests passed');

// ---- voice service requests
{
  const T = A.TTS;
  const g = { type: 'gemini-tts', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/', model: 'gemini-3.8-flash-tts' };
  const r = T.request(g, { text: 'Hello', voice: 'voice_abc', style: 'warm' });
  assert.strictEqual(r.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.strictEqual(r.keyHeader, 'x-goog-api-key');
  assert.deepStrictEqual(r.body.generation_config.speech_config, [{ voice: 'voice_abc' }]);
  assert.strictEqual(r.body.input[0].content[0].annotations[0].style, 'warm');
  const old = T.request({ ...g, model: 'gemini-2.5-flash-preview-tts' }, { text: 'Hi', voice: 'Kore', style: 'cheerfully' });
  assert.ok(old.url.endsWith('/models/gemini-2.5-flash-preview-tts:generateContent'));
  assert.strictEqual(old.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
  assert.strictEqual(old.body.contents[0].parts[0].text, 'Say this cheerfully: Hi');
  const e = T.request({ type: 'elevenlabs', model: 'eleven_multilingual_v2' }, { text: 'Hi', voice: 'abc123' });
  assert.strictEqual(e.url, 'https://api.elevenlabs.io/v1/text-to-speech/abc123?output_format=mp3_44100_128');
  assert.strictEqual(e.keyHeader, 'xi-api-key');
  assert.throws(() => T.request({ type: 'elevenlabs' }, { text: 'Hi', voice: '' }), /Choose an ElevenLabs voice/);
  assert.throws(() => T.request({ type: 'openai' }, { text: 'Hi' }), /not a voice service/);
  // Finding audio in the replies of both Gemini APIs.
  assert.deepStrictEqual(T.findAudio({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: 'QUJD', mime_type: 'audio/wav' }] }] }), { mime: 'audio/wav', b64: 'QUJD' });
  assert.deepStrictEqual(T.findAudio({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: 'AAAA' } }] } }] }), { mime: 'audio/L16;codec=pcm;rate=24000', b64: 'AAAA' });
  const pcm = T.finish(new Uint8Array(480), 'audio/L16;codec=pcm;rate=24000');
  assert.strictEqual(pcm.ext, 'wav');
  assert.ok(A.Master.isWav(pcm.data));
  assert.strictEqual(T.finish(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]), 'audio/mpeg').ext, 'mp3');
  assert.deepStrictEqual(T.parseVoices(g, { voices: [{ id: 'voice_x', display_name: 'Alistair Finch 1', type: 'prompted' }] }), [{ id: 'voice_x', name: 'Alistair Finch 1', type: 'prompted' }]);
  assert.deepStrictEqual(T.parseVoices({ type: 'elevenlabs' }, { voices: [{ voice_id: 'v1', name: 'Wade' }] }), [{ id: 'v1', name: 'Wade' }]);
  assert.ok(T.isVoice({ type: 'elevenlabs' }) && !T.isVoice({ type: 'gemini' }));
}
console.log('Voice service request tests passed');
