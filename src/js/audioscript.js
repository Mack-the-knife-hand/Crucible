// =============================================================================
// audioscript.js — the audiobook's pure helpers (no screen, no disk)
// -----------------------------------------------------------------------------
// Shared by the Audiobook studio (audiobook.js) and the unit tests.
//
//   segment()      splits a stretch of manuscript into spoken pieces: what's
//                  inside quotation marks is dialogue (read by the actor you
//                  pick), everything else is narration (read by your Narrator).
//   spoken()       the words a voice actually receives: Markdown, quotation
//                  marks and hidden comments removed, your pronunciation list
//                  applied ("Mamgu" -> "Mam-ghee").
//   gapAfter()     how long a pause goes between two clips: inside a
//                  paragraph, between paragraphs, or at a scene break.
//   chapters()     chapter ranges, so each chapter becomes its own audio file.
//   Master         the sound work for export: limiter, room tone, WAV writer.
// =============================================================================

(function (root) {
  const OPEN = '“';
  const CLOSE = '”';
  const MAX_CHARS = 1500; // longer pieces are split at sentence ends

  // Lines that are never spoken: images, alignment fences, scene breaks, HTML comments.
  const SILENT_LINE = /^\s*(?:!\[[^\]]*\]\([^)]*\)|:::.*|(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,}|\[TOC\]|<!--[\s\S]*?-->)\s*$/i;
  const SCENE_BREAK = /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,}|#{1,6}[ \t].*)\s*$/m;

  function clean(s) {
    return String(s)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^:::.*$/gm, ' ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/[*_`~]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const hasWords = (s) => /[\p{L}\p{N}]/u.test(clean(s));

  // Paragraph ranges [start, end) inside [from, to), skipping silent lines.
  function paragraphs(text, from, to) {
    const out = [];
    let s = text.lastIndexOf('\n\n', Math.max(0, from - 1));
    s = s === -1 ? 0 : s + 2;
    while (s < to) {
      let e = text.indexOf('\n\n', s);
      if (e === -1) e = text.length;
      const a = Math.max(s, from), b = Math.min(e, to);
      if (b > a) out.push({ pStart: s, pEnd: e, start: a, end: b });
      s = e + 2;
      while (s < text.length && text[s] === '\n') s++;
    }
    return out;
  }

  // Quote spans inside one paragraph, as [start, end) including the marks.
  // Curly quotes pair up; straight " toggles. A quote left open runs to the
  // end of the paragraph (speeches that continue into the next paragraph).
  function quoteSpans(text, pStart, pEnd) {
    const spans = [];
    let open = -1, kind = '';
    for (let i = pStart; i < pEnd; i++) {
      const ch = text[i];
      if (open === -1) {
        if (ch === OPEN || ch === '"') { open = i; kind = ch; }
      } else if ((kind === OPEN && ch === CLOSE) || (kind === '"' && ch === '"')) {
        spans.push([open, i + 1]);
        open = -1;
      }
    }
    if (open !== -1) spans.push([open, pEnd]);
    return spans;
  }

  // Split a long piece at sentence ends so no request is too large.
  function splitLong(text, start, end, max = MAX_CHARS) {
    if (end - start <= max) return [[start, end]];
    const out = [];
    let a = start;
    while (end - a > max) {
      const win = text.slice(a, a + max);
      let cut = -1;
      const re = /[.!?…]["”’)\]]*\s+/g;
      let m;
      while ((m = re.exec(win))) if (m.index + m[0].length > max * 0.4) cut = m.index + m[0].length;
      if (cut === -1) { const sp = win.lastIndexOf(' '); cut = sp > max * 0.4 ? sp + 1 : max; }
      out.push([a, a + cut]);
      a += cut;
    }
    if (end > a) out.push([a, end]);
    return out;
  }

  const trimRange = (text, a, b) => {
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    return [a, b];
  };

  // Pieces of [from, to) in reading order: { start, end, kind: 'dialogue'|'narration' }.
  // split: false keeps every paragraph whole (one actor reads all of it).
  function segment(text, from, to, { split = true, max = MAX_CHARS } = {}) {
    const out = [];
    const push = (a, b, kind) => {
      [a, b] = trimRange(text, a, b);
      if (b <= a) return;
      const body = text.slice(a, b);
      if (SILENT_LINE.test(body) || !hasWords(body)) return;
      for (const [x, y] of splitLong(text, a, b, max)) {
        const [p, q] = trimRange(text, x, y);
        if (q > p && hasWords(text.slice(p, q))) out.push({ start: p, end: q, kind });
      }
    };
    for (const p of paragraphs(text, from, to)) {
      // Pieces are found on whole lines (so quote marks pair up correctly even
      // when the selection starts mid-speech), then cut to the selection.
      const cut = (a, b, kind) => push(Math.max(a, p.start), Math.min(b, p.end), kind);
      let ls = p.pStart;
      for (const line of text.slice(p.pStart, p.pEnd).split('\n')) {
        const la = ls, lb = ls + line.length;
        ls = lb + 1;
        // Silent lines inside a "paragraph" (an image right under a heading).
        if (SILENT_LINE.test(line) || lb <= p.start || la >= p.end) continue;
        // Headings are always narration, read on their own.
        if (/^#{1,6}[ \t]/.test(line) || !split) { cut(la, lb, 'narration'); continue; }
        let cur = la;
        for (const [qa, qb] of quoteSpans(text, la, lb)) {
          if (qa > cur) cut(cur, qa, 'narration');
          cut(qa, qb, 'dialogue');
          cur = qb;
        }
        if (cur < lb) cut(cur, lb, 'narration');
      }
    }
    // Merge consecutive lines of the same kind within one paragraph is not
    // needed: Markdown paragraphs are single lines in practice.
    return out;
  }

  // Pronunciation list: [{ from, to, matchCase }]. Whole words only.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function applyLexicon(s, lexicon = []) {
    let out = s;
    for (const e of lexicon) {
      if (!e || !e.from || e.to == null) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc(e.from)}(?![\\p{L}\\p{N}])`, e.matchCase ? 'gu' : 'giu');
      out = out.replace(re, () => e.to);
    }
    return out;
  }

  // What the voice receives for a slice of the manuscript.
  function spoken(slice, lexicon) {
    const t = clean(slice).replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();
    return applyLexicon(t, lexicon);
  }

  // Pause after a clip, from the text between it and the next one.
  // Returns 'inline' | 'para' | 'scene'.
  function gapAfter(text, endPrev, startNext) {
    const between = text.slice(endPrev, startNext);
    if (SCENE_BREAK.test(between) && between.includes('\n')) return 'scene';
    if (between.includes('\n')) return 'para';
    return 'inline';
  }
  // A clip that is itself a heading gets the long pause after it too.
  const isHeading = (text, start) => /^#{1,6}[ \t]/.test(text.slice(start, start + 8));

  // Chapter ranges at the book's chapter level (same rule as the Chapter builder).
  function chapters(text) {
    const heads = [];
    const re = /^(#{1,3})[ \t]+([^\n]+)/gm;
    let m;
    while ((m = re.exec(text))) heads.push({ level: m[1].length, start: m.index, title: m[2].replace(/[ \t#]+$/, '').trim() });
    const l1 = heads.filter((h) => h.level === 1).length;
    const l2 = heads.filter((h) => h.level === 2).length;
    const level = l1 <= 1 && l2 >= 1 ? 2 : l1 >= 1 ? 1 : 2;
    const hs = heads.filter((h) => h.level === level);
    const out = [];
    if (!hs.length) return [{ n: 1, title: 'Book', start: 0, end: text.length }];
    if (hs[0].start > 0) out.push({ n: 0, title: 'Opening', start: 0, end: hs[0].start });
    hs.forEach((h, i) => out.push({ n: i + 1, title: h.title, start: h.start, end: i + 1 < hs.length ? hs[i + 1].start : text.length }));
    return out;
  }

  const fileSafe = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
  const two = (n) => String(n).padStart(2, '0');
  const clock = (sec) => {
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
  };

  // ----------------------------------------------------------- mastering --
  const Master = {
    RATE: 44100,
    db: (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity),
    lin: (db) => Math.pow(10, db / 20),

    // Trim near-silence from both ends, keeping a short natural margin.
    trim(x, rate = 44100, thresholdDb = -48, marginSec = 0.04) {
      const th = this.lin(thresholdDb);
      let a = 0, b = x.length;
      while (a < b && Math.abs(x[a]) < th) a++;
      while (b > a && Math.abs(x[b - 1]) < th) b--;
      if (b <= a) return x.subarray(0, 0);
      const m = Math.round(marginSec * rate);
      return x.subarray(Math.max(0, a - m), Math.min(x.length, b + m));
    },

    stats(x) {
      let sum = 0, peak = 0;
      for (let i = 0; i < x.length; i++) { const v = x[i]; sum += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a; }
      return { sumSq: sum, n: x.length, peak };
    },

    // Look-ahead peak limiter (in place). ceilingDb: highest allowed peak.
    limit(x, ceilingDb = -3.5, rate = 44100) {
      const ceil = this.lin(ceilingDb);
      const look = Math.max(1, Math.round(0.005 * rate));
      const rel = Math.exp(-1 / (0.08 * rate));
      // Gain each sample needs. Only samples over the ceiling need any, so the
      // work is proportional to the loud peaks, not the length of the book.
      let g = null;
      for (let i = 0; i < x.length; i++) {
        const a = x[i] < 0 ? -x[i] : x[i];
        if (a <= ceil) continue;
        g ||= new Float32Array(x.length).fill(1);
        const need = ceil / a;
        // Ease into the reduction over the look-ahead so it never clicks.
        for (let j = Math.max(0, i - look); j <= i; j++) {
          const v = 1 - (1 - need) * (1 - (i - j) / (look + 1));
          if (v < g[j]) g[j] = v;
        }
      }
      if (!g) return x;
      let cur = 1;
      for (let i = 0; i < x.length; i++) {
        cur = Math.min(g[i], 1 - (1 - cur) * rel); // instant attack, smooth release
        const v = x[i] * cur;
        x[i] = v > ceil ? ceil : v < -ceil ? -ceil : v;
      }
      return x;
    },

    // Quiet, steady "room tone" so silences aren't dead digital zero.
    noise(seed = 1) {
      let s = seed >>> 0 || 1, last = 0;
      return (n, levelDb) => {
        const out = new Float32Array(n);
        const amp = this.lin(levelDb) * 1.7; // ~RMS of the filtered noise
        for (let i = 0; i < n; i++) {
          s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
          const w = s / 4294967296 - 0.5;
          last = last * 0.86 + w * 0.14; // soften the hiss
          out[i] = last * amp * 3;
        }
        return out;
      };
    },

    toInt16(x) {
      const out = new Int16Array(x.length);
      for (let i = 0; i < x.length; i++) {
        const v = Math.max(-1, Math.min(1, x[i]));
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      return out;
    },

    wavHeader(samples, rate = 44100, channels = 1) {
      const bytes = samples * 2 * channels;
      const b = new ArrayBuffer(44);
      const v = new DataView(b);
      const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
      s(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); s(8, 'WAVE'); s(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * 2 * channels, true); v.setUint16(32, 2 * channels, true); v.setUint16(34, 16, true);
      s(36, 'data'); v.setUint32(40, bytes, true);
      return new Uint8Array(b);
    },

    // Raw 16-bit PCM (what some voice services send) wrapped as a WAV file.
    pcmToWav(pcm, rate = 24000, channels = 1) {
      const body = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm.buffer || pcm);
      const out = new Uint8Array(44 + body.length);
      out.set(this.wavHeader(body.length / 2 / channels, rate, channels), 0);
      out.set(body, 44);
      return out;
    },
    isWav: (b) => b && b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x41,
  };

  // ------------------------------------------------------- voice services --
  // Requests for the two voice services, built the same way by the desktop
  // back end (main.js) and the browser edition. The key travels only in the
  // request header, and only to the address saved with that voice provider.
  const trimBase = (u) => String(u || '').replace(/\/+$/, '');
  const TTS = {
    TYPES: ['gemini-tts', 'elevenlabs'],
    isVoice: (p) => !!p && TTS.TYPES.includes(p.type),
    DEFAULTS: {
      'gemini-tts': { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.8-flash-tts', voice: 'Kore' },
      elevenlabs: { baseUrl: 'https://api.elevenlabs.io', model: 'eleven_multilingual_v2', voice: '' },
    },

    // Gemini 3.8 and later (and any designed "voice_…" ID) use the Interactions
    // API; older TTS previews use generateContent with a prebuilt voice name.
    geminiModern(model, voice) {
      if (/^voice(key)?_/.test(voice || '')) return true;
      const m = String(model || '').match(/gemini-(\d+)\.(\d+)/);
      return !m || +m[1] > 3 || (+m[1] === 3 && +m[2] >= 8);
    },

    // { url, headers, body } for one line of speech.
    request(p, { text, voice, style }, { legacy = false } = {}) {
      const d = TTS.DEFAULTS[p.type] || {};
      const base = trimBase(p.baseUrl) || d.baseUrl;
      const model = p.model || d.model;
      voice = String(voice || d.voice || '').trim();
      style = String(style || '').trim();
      if (p.type === 'elevenlabs') {
        if (!voice) throw new Error('Choose an ElevenLabs voice for this actor (Load voices, or paste a voice ID).');
        const t = style && /v3/.test(model) ? `[${style}] ${text}` : text;
        return {
          url: `${base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
          keyHeader: 'xi-api-key',
          body: { text: t, model_id: model },
        };
      }
      if (p.type === 'gemini-tts') {
        if (!legacy && TTS.geminiModern(model, voice)) {
          const part = { type: 'text', text };
          if (style) part.annotations = [{ type: 'speech_metadata', style }];
          return {
            url: `${base}/interactions`, keyHeader: 'x-goog-api-key',
            body: { model, input: [{ type: 'user_input', content: [part] }], response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice }] } },
          };
        }
        return {
          url: `${base}/models/${encodeURIComponent(model)}:generateContent`, keyHeader: 'x-goog-api-key',
          body: {
            contents: [{ parts: [{ text: style ? `Say this ${style}: ${text}` : text }] }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
          },
        };
      }
      throw new Error('That provider is not a voice service.');
    },

    // Find the audio in a JSON reply. Returns { mime, b64 } or null.
    findAudio(j) {
      let hit = null;
      const seen = new Set();
      const walk = (o) => {
        if (!o || typeof o !== 'object' || hit || seen.has(o)) return;
        seen.add(o);
        const inl = o.inlineData || o.inline_data;
        if (inl && typeof inl.data === 'string') { hit = { mime: inl.mimeType || inl.mime_type || '', b64: inl.data }; return; }
        if (o.type === 'audio' && typeof o.data === 'string') { hit = { mime: o.mime_type || o.mimeType || '', b64: o.data }; return; }
        if (o.output_audio && typeof o.output_audio.data === 'string') { hit = { mime: o.output_audio.mime_type || '', b64: o.output_audio.data }; return; }
        for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v);
      };
      walk(j);
      return hit;
    },

    // Bytes from the service → { ext, data } ready to store (WAV or MP3).
    finish(bytes, mime = '') {
      if (Master.isWav(bytes)) return { ext: 'wav', data: bytes };
      if (/mpeg|mp3/i.test(mime) || (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return { ext: 'mp3', data: bytes };
      if (/l16|pcm/i.test(mime) || !mime) {
        const rate = +((mime.match(/rate=(\d+)/) || [])[1] || 24000);
        return { ext: 'wav', data: Master.pcmToWav(bytes, rate) };
      }
      if (/wav/i.test(mime)) return { ext: 'wav', data: bytes };
      throw new Error(`The voice service sent audio in a format Crucible doesn't store (${mime}).`);
    },

    // Request for the list of voices: { url, keyHeader } and a parser.
    voicesRequest(p, kind) {
      const d = TTS.DEFAULTS[p.type] || {};
      const base = trimBase(p.baseUrl) || d.baseUrl;
      if (p.type === 'elevenlabs') return { url: `${base}/v1/voices`, keyHeader: 'xi-api-key' };
      return { url: `${base}/voices?type=${kind || 'prompted'}&pageSize=200`, keyHeader: 'x-goog-api-key' };
    },
    parseVoices(p, j) {
      if (p.type === 'elevenlabs') return (j.voices || []).map((v) => ({ id: v.voice_id, name: v.name || v.voice_id }));
      return (j.voices || []).map((v) => {
        const id = v.id || String(v.name || '').replace(/^voices\//, '');
        return { id, name: v.display_name || v.displayName || id, type: v.type || '' };
      }).filter((v) => v.id);
    },
  };

  const api = { segment, spoken, applyLexicon, clean, gapAfter, isHeading, chapters, quoteSpans, splitLong, fileSafe, clock, Master, TTS, MAX_CHARS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AudioScript = api;
})(typeof window !== 'undefined' ? window : globalThis);
